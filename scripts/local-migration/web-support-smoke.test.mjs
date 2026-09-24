import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import net from "node:net";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  assertWebSupportResponses,
  buildWebSupportEnvironment,
  closeHttpServerBounded,
  listenOnDynamicLoopbackPort,
  runWebSupportSmoke,
} from "./web-support-smoke.mjs";

function response(status, body, location = null) {
  return {
    status,
    body,
    headers: new Headers(location ? { location } : {}),
  };
}

test("built web support probes pin unauthenticated envelopes and the Auth0 redirect", () => {
  assert.doesNotThrow(() =>
    assertWebSupportResponses(
      {
        chat: response(401, { error: "Unauthorized" }),
        debugToken: response(401, { error: "Not authenticated" }),
        login: response(
          307,
          null,
          "https://synthetic-auth.invalid/authorize?client_id=client",
        ),
      },
      "https://synthetic-auth.invalid",
    ),
  );
  assert.throws(
    () =>
      assertWebSupportResponses(
        {
          chat: response(500, { error: "wrong" }),
          debugToken: response(401, { error: "Not authenticated" }),
          login: response(307, null, "https://attacker.invalid/authorize"),
        },
        "https://synthetic-auth.invalid",
      ),
    /chat|redirect/i,
  );
});

test("web support environment is loopback-scoped and replaces caller credentials", () => {
  const environment = buildWebSupportEnvironment(
    {
      PATH: "/bin",
      AUTH0_CLIENT_SECRET: "caller-secret",
      AUTH0_SECRET: "caller-cookie-secret",
      HOME: "/host/home",
    },
    {
      port: 43123,
      home: "/private/smoke-home",
      clientSecret: "smoke-client-secret",
      sessionSecret: "a".repeat(64),
    },
  );
  assert.equal(environment.APP_BASE_URL, "http://127.0.0.1:43123");
  assert.equal(environment.AUTH0_DOMAIN, "synthetic-auth.invalid");
  assert.equal(environment.AUTH0_CLIENT_SECRET, "smoke-client-secret");
  assert.equal(environment.AUTH0_SECRET, "a".repeat(64));
  assert.equal(environment.HOME, "/private/smoke-home");
  assert.equal(JSON.stringify(environment).includes("caller-secret"), false);
  assert.equal(JSON.stringify(environment).includes("/host/home"), false);
});

function fakeNextApp({ port, prepare, handle, close }) {
  return {
    async prepare() {
      await prepare?.(port);
    },
    getRequestHandler() {
      return (request, response) => {
        handle?.(request);
        response.setHeader("content-type", "application/json");
        if (request.url === "/api/chat") {
          response.statusCode = 401;
          response.end(JSON.stringify({ error: "Unauthorized" }));
        } else if (request.url?.startsWith("/api/debug/token")) {
          response.statusCode = 401;
          response.end(JSON.stringify({ error: "Not authenticated" }));
        } else if (request.url === "/auth/login") {
          response.statusCode = 307;
          response.setHeader(
            "location",
            "https://synthetic-auth.invalid/authorize?client_id=test",
          );
          response.end();
        } else {
          response.statusCode = 404;
          response.end(JSON.stringify({ error: "Not found" }));
        }
      };
    },
    async close() {
      await close?.();
    },
  };
}

test("web support smoke hides unrelated inherited credentials and restores them", async () => {
  const diagnostics = await mkdtemp(
    path.join(os.tmpdir(), "web-support-smoke-env-test-"),
  );
  const sentinelKey = "LMBG_UNRELATED_INHERITED_CREDENTIAL";
  const originalSentinel = process.env[sentinelKey];
  process.env[sentinelKey] = "must-not-reach-next";
  const observed = [];
  try {
    await runWebSupportSmoke({
      diagnosticsDirectory: diagnostics,
      sourceEnvironment: { PATH: process.env.PATH },
      nextFactory: ({ port }) =>
        fakeNextApp({
          port,
          prepare: async () => observed.push(process.env[sentinelKey]),
          handle: () => observed.push(process.env[sentinelKey]),
        }),
    });
    assert.deepEqual(observed, [undefined, undefined, undefined, undefined]);
    assert.equal(process.env[sentinelKey], "must-not-reach-next");
  } finally {
    if (originalSentinel === undefined) delete process.env[sentinelKey];
    else process.env[sentinelKey] = originalSentinel;
    await rm(diagnostics, { recursive: true, force: true });
  }
});

test("web support smoke reserves its loopback port throughout Next preparation and journals cleanup", async () => {
  const diagnostics = await mkdtemp(
    path.join(os.tmpdir(), "web-support-smoke-test-"),
  );
  let contenderRejected = false;
  try {
    const result = await runWebSupportSmoke({
      diagnosticsDirectory: diagnostics,
      sourceEnvironment: { PATH: process.env.PATH },
      nextFactory: ({ port }) =>
        fakeNextApp({
          port,
          prepare: async () => {
            const contender = net.createServer();
            const error = await new Promise((resolve) => {
              contender.once("error", resolve);
              contender.listen(port, "127.0.0.1");
            });
            contenderRejected = error?.code === "EADDRINUSE";
            contender.close();
          },
        }),
    });
    assert.equal(contenderRejected, true);
    assert.deepEqual(result.statuses, {
      chat: 401,
      debugToken: 401,
      login: 307,
    });
    const journalPath = path.join(
      diagnostics,
      "web-support-resource-lifecycle.json",
    );
    const journal = JSON.parse(await readFile(journalPath, "utf8"));
    assert.equal((await stat(journalPath)).mode & 0o777, 0o600);
    assert.equal(journal.status, "passed");
    assert.deepEqual(
      journal.resources.map(({ id, cleanup }) => [id, cleanup.status]),
      [
        ["temporary-home", "removed"],
        ["loopback-listener", "closed"],
        ["next-app", "closed"],
      ],
    );
  } finally {
    await rm(diagnostics, { recursive: true, force: true });
  }
});

test("web support smoke preserves primary, listener, Next, and home cleanup failures while attempting all cleanup", async () => {
  const diagnostics = await mkdtemp(
    path.join(os.tmpdir(), "web-support-smoke-failure-test-"),
  );
  const cleanupCalls = [];
  try {
    await assert.rejects(
      runWebSupportSmoke({
        diagnosticsDirectory: diagnostics,
        sourceEnvironment: { PATH: process.env.PATH },
        nextFactory: ({ port }) =>
          fakeNextApp({
            port,
            close: async () => {
              cleanupCalls.push("next");
              throw new Error("Next cleanup failed");
            },
          }),
        probe: async () => {
          throw new Error("OIDC/JWKS probe failed");
        },
        closeServer: async (server, sockets) => {
          cleanupCalls.push("listener");
          await closeHttpServerBounded(server, sockets);
          throw new Error("listener cleanup failed");
        },
        removeDirectory: async (directory) => {
          cleanupCalls.push("home");
          await rm(directory, { recursive: true, force: true });
          throw new Error("home cleanup failed");
        },
      }),
      (error) => {
        assert.match(error.message, /OIDC\/JWKS probe failed/);
        assert.match(error.message, /listener cleanup failed/);
        assert.match(error.message, /Next cleanup failed/);
        assert.match(error.message, /home cleanup failed/);
        return true;
      },
    );
    assert.deepEqual(cleanupCalls, ["listener", "next", "home"]);
    const journal = JSON.parse(
      await readFile(
        path.join(diagnostics, "web-support-resource-lifecycle.json"),
        "utf8",
      ),
    );
    assert.equal(journal.status, "failed");
    assert.equal(journal.resources.every(({ recoveryRequired }) => recoveryRequired), true);
  } finally {
    await rm(diagnostics, { recursive: true, force: true });
  }
});

test("web support cancellation interrupts preparation and still closes Next, listener, and home", async () => {
  const diagnostics = await mkdtemp(
    path.join(os.tmpdir(), "web-support-smoke-cancel-test-"),
  );
  const controller = new AbortController();
  const cleanupCalls = [];
  try {
    await assert.rejects(
      runWebSupportSmoke({
        diagnosticsDirectory: diagnostics,
        signal: controller.signal,
        sourceEnvironment: { PATH: process.env.PATH },
        nextFactory: ({ port }) =>
          fakeNextApp({
            port,
            prepare: async () => {
              controller.abort(new Error("cancelled during Next preparation"));
              await new Promise(() => {});
            },
            close: async () => cleanupCalls.push("next"),
          }),
        closeServer: async (server, sockets) => {
          cleanupCalls.push("listener");
          await closeHttpServerBounded(server, sockets);
        },
        preparationSettleTimeoutMs: 20,
        removeDirectory: async (directory) => {
          cleanupCalls.push("home");
          await rm(directory, { recursive: true, force: true });
        },
      }),
      (error) => {
        assert.match(error.message, /cancelled during Next preparation/);
        assert.match(error.message, /preparation did not settle within 20ms/);
        return true;
      },
    );
    assert.deepEqual(cleanupCalls, ["listener", "next", "home"]);
  } finally {
    await rm(diagnostics, { recursive: true, force: true });
  }
});

test("web support cancellation closes Next again after delayed preparation creates resources", async () => {
  const diagnostics = await mkdtemp(
    path.join(os.tmpdir(), "web-support-smoke-delayed-prepare-test-"),
  );
  const controller = new AbortController();
  let prepared = false;
  let closed = false;
  let closeCalls = 0;
  const preparationCanFinish = Promise.withResolvers();
  try {
    await assert.rejects(
      runWebSupportSmoke({
        diagnosticsDirectory: diagnostics,
        signal: controller.signal,
        sourceEnvironment: { PATH: process.env.PATH },
        nextFactory: () => ({
          async prepare() {
            controller.abort(new Error("cancelled before delayed prepare"));
            await preparationCanFinish.promise;
            prepared = true;
          },
          getRequestHandler() {
            throw new Error("cancelled preparation must not install a handler");
          },
          async close() {
            closeCalls += 1;
            if (closeCalls === 1) {
              assert.equal(prepared, false);
              preparationCanFinish.resolve();
            }
            if (prepared) closed = true;
          },
        }),
        preparationSettleTimeoutMs: 100,
      }),
      /cancelled before delayed prepare/,
    );
    assert.equal(prepared, true);
    assert.equal(closeCalls, 2);
    assert.equal(closed, true);
    const journal = JSON.parse(
      await readFile(
        path.join(diagnostics, "web-support-resource-lifecycle.json"),
        "utf8",
      ),
    );
    assert.equal(
      journal.resources.find(({ id }) => id === "next-app").cleanup.status,
      "closed",
    );
  } finally {
    preparationCanFinish.resolve();
    await rm(diagnostics, { recursive: true, force: true });
  }
});

test("cancellation during listener acquisition waits for the bind and leaves no listener behind", async () => {
  const diagnostics = await mkdtemp(
    path.join(os.tmpdir(), "web-support-smoke-listen-cancel-test-"),
  );
  const controller = new AbortController();
  let nextCreated = false;
  try {
    queueMicrotask(() =>
      controller.abort(new Error("cancelled while listener was acquiring")),
    );
    await assert.rejects(
      runWebSupportSmoke({
        diagnosticsDirectory: diagnostics,
        signal: controller.signal,
        sourceEnvironment: { PATH: process.env.PATH },
        nextFactory: () => {
          nextCreated = true;
          return fakeNextApp({});
        },
      }),
      /cancelled while listener was acquiring/,
    );
    assert.equal(nextCreated, false);
    const journal = JSON.parse(
      await readFile(
        path.join(diagnostics, "web-support-resource-lifecycle.json"),
        "utf8",
      ),
    );
    const listener = journal.resources.find(
      ({ id }) => id === "loopback-listener",
    );
    assert.equal(listener.cleanup.status, "closed");
    const contender = net.createServer();
    await new Promise((resolve, reject) => {
      contender.once("error", reject);
      contender.listen(listener.identity.port, "127.0.0.1", resolve);
    });
    await closeHttpServerBounded(contender, new Set());
  } finally {
    await rm(diagnostics, { recursive: true, force: true });
  }
});

test("listener acquisition timeout aborts a delayed bind before returning", async () => {
  const server = new EventEmitter();
  let delayedBind;
  server.listening = false;
  server.listen = ({ signal }) => {
    delayedBind = setTimeout(() => {
      server.listening = true;
      server.emit("listening");
    }, 50);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(delayedBind);
        server.listening = false;
        server.emit("close");
      },
      { once: true },
    );
  };
  await assert.rejects(
    listenOnDynamicLoopbackPort(server, 10),
    /listener acquisition timed out after 10ms/,
  );
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(server.listening, false);
  assert.equal(server.listenerCount("listening"), 0);
  assert.equal(server.listenerCount("error"), 0);
  assert.equal(server.listenerCount("close"), 0);
});
