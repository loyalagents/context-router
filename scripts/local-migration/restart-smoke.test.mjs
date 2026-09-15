import assert from "node:assert/strict";
import { generateKeyPairSync, verify } from "node:crypto";
import { EventEmitter } from "node:events";
import { access, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  assertCatalogState,
  assertGenerationStatesEqual,
  assertNonLoopbackUnreachable,
  buildSmokeBackendEnvironment,
  buildSmokeBuildEnvironment,
  buildSmokeToolEnvironment,
  cleanupBackendProcess,
  createResourceLifecycleJournal,
  createSignedTestToken,
  enumerateNonLoopbackAddresses,
  runRestartSmoke,
  runWebSupportSubprocess,
  stopBackendProcess,
  WEB_SUPPORT_SUBPROCESS_TERMINATION_GRACE_MS,
  waitForReadiness,
  withCleanupStack,
} from "./restart-smoke.mjs";
import { WEB_SUPPORT_BOUNDED_TERMINATION_BUDGET_MS } from "./web-support-smoke.mjs";

async function waitForFile(filePath, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await access(filePath);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  throw new Error(`timed out waiting for ${filePath}`);
}

test("ephemeral test token is RS256-signed and contains the bounded M2M claims", () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const token = createSignedTestToken({
    privateKey,
    kid: "smoke-key",
    issuer: "https://127.0.0.1:4443/",
    audience: "urn:context-router:smoke",
    subject: "migration-smoke@clients",
    clientId: "migration-smoke-client",
    nowSeconds: 1_700_000_000,
  });
  const [encodedHeader, encodedPayload, encodedSignature] = token.split(".");
  assert.deepEqual(JSON.parse(Buffer.from(encodedHeader, "base64url").toString()), {
    alg: "RS256",
    kid: "smoke-key",
    typ: "JWT",
  });
  const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString());
  assert.deepEqual(payload, {
    iss: "https://127.0.0.1:4443/",
    aud: "urn:context-router:smoke",
    sub: "migration-smoke@clients",
    azp: "migration-smoke-client",
    scope: "preferences:read",
    iat: 1_700_000_000,
    nbf: 1_699_999_995,
    exp: 1_700_000_300,
  });
  assert.equal(
    verify(
      "RSA-SHA256",
      Buffer.from(`${encodedHeader}.${encodedPayload}`),
      publicKey,
      Buffer.from(encodedSignature, "base64url"),
    ),
    true,
  );
});

test("catalog state rejects duplicates and generation comparison pins IDs, slugs, count, and principal", () => {
  const state = {
    catalog: [
      { id: "id-a", slug: "a" },
      { id: "id-b", slug: "b" },
    ],
    principalId: "principal-1",
  };
  assert.deepEqual(assertCatalogState(state.catalog, 2), state.catalog);
  assert.doesNotThrow(() => assertGenerationStatesEqual(state, structuredClone(state)));
  assert.throws(
    () => assertCatalogState([...state.catalog, { id: "id-c", slug: "a" }], 3),
    /duplicate catalog slug/,
  );
  assert.throws(
    () => assertGenerationStatesEqual(state, { ...state, principalId: "principal-2" }),
    /principal changed/,
  );
});

test("readiness fails promptly on early exit and times out boundedly", async () => {
  await assert.rejects(
    waitForReadiness({
      deadlineMs: 100,
      request: async () => {
        throw new Error("not ready");
      },
      processStatus: () => ({ exited: true, exitCode: 12, signal: null }),
      delay: async () => {},
    }),
    /exited before readiness.*12/,
  );

  let now = 0;
  await assert.rejects(
    waitForReadiness({
      deadlineMs: 20,
      request: async () => ({ status: 503, body: {} }),
      processStatus: () => ({ exited: false }),
      now: () => (now += 10),
      delay: async () => {},
    }),
    /readiness timed out/,
  );
});

test("bounded process stop records SIGTERM success and scoped SIGKILL fallback", async () => {
  const gracefulSignals = [];
  const graceful = await stopBackendProcess(
    {
      exitCode: null,
      signalCode: null,
      kill(signal) {
        gracefulSignals.push(signal);
        this.exitCode = 0;
        return true;
      },
    },
    { waitForExit: async () => true, timeoutMs: 10 },
  );
  assert.deepEqual(gracefulSignals, ["SIGTERM"]);
  assert.equal(graceful.usedSigkill, false);

  const forcedSignals = [];
  const child = {
    exitCode: null,
    signalCode: null,
    kill(signal) {
      forcedSignals.push(signal);
      if (signal === "SIGKILL") this.signalCode = signal;
      return true;
    },
  };
  let waits = 0;
  const forced = await stopBackendProcess(child, {
    waitForExit: async () => ++waits > 1,
    timeoutMs: 10,
  });
  assert.deepEqual(forcedSignals, ["SIGTERM", "SIGKILL"]);
  assert.equal(forced.usedSigkill, true);
});

test("network negative probes cover only non-internal, non-loopback interfaces", async () => {
  assert.deepEqual(
    enumerateNonLoopbackAddresses({
      lo0: [{ address: "127.0.0.1", internal: true }],
      en0: [
        { address: "192.0.2.4", internal: false },
        { address: "::1", internal: false },
      ],
    }),
    ["192.0.2.4"],
  );
  const attempted = [];
  await assert.doesNotReject(
    assertNonLoopbackUnreachable(["192.0.2.4", "2001:db8::1"], 4010, async (host) => {
      attempted.push(host);
      return false;
    }),
  );
  assert.deepEqual(attempted, ["192.0.2.4", "2001:db8::1"]);
  await assert.rejects(
    assertNonLoopbackUnreachable(["192.0.2.4"], 4010, async () => true),
    /reachable through non-loopback/,
  );
});

test("cleanup stack runs in reverse order and preserves cleanup failures with the primary error", async () => {
  const calls = [];
  await assert.rejects(
    withCleanupStack(async (defer) => {
      defer(async () => calls.push("first"));
      defer(async () => {
        calls.push("second");
        throw new Error("cleanup failed");
      });
      throw new Error("primary failed");
    }),
    (error) => {
      assert.match(error.message, /primary failed/);
      assert.match(error.message, /cleanup failed/);
      return true;
    },
  );
  assert.deepEqual(calls, ["second", "first"]);
});

test("cancellation still runs every registered cleanup in reverse order", async () => {
  const controller = new AbortController();
  const calls = [];
  await assert.rejects(
    withCleanupStack(async (defer) => {
      for (const resource of ["container", "database", "secret", "jwks"]) {
        defer(async () => calls.push(resource));
      }
      controller.abort(new Error("received SIGTERM"));
      throw controller.signal.reason;
    }),
    /received SIGTERM/,
  );
  assert.deepEqual(calls, ["jwks", "secret", "database", "container"]);
});

test("smoke environments replace hostile caller homes and disable package downloads", () => {
  const tool = buildSmokeToolEnvironment(
    {
      PATH: "/bin",
      HOME: "/host/home",
      XDG_CONFIG_HOME: "/host/config",
      PNPM_HOME: "/host/pnpm",
      COREPACK_HOME: "/host/corepack",
    },
    "postgresql://user:secret@127.0.0.1/test",
    "/smoke/home",
    "/smoke/corepack",
  );
  assert.equal(tool.HOME, "/smoke/home");
  assert.equal(tool.XDG_CONFIG_HOME, "/smoke/home/.config");
  assert.equal(tool.PNPM_HOME, undefined);
  assert.equal(tool.COREPACK_HOME, "/smoke/corepack");
  assert.equal(tool.COREPACK_ENABLE_NETWORK, "0");
  assert.equal(buildSmokeBuildEnvironment(tool).NODE_ENV, "production");

  const backend = buildSmokeBackendEnvironment({
    sourceEnvironment: tool,
    databaseUrl: tool.DATABASE_URL,
    appPort: 4010,
    jwksPort: 4443,
    caCertificate: "/smoke/ca.pem",
    clientIds: { claude: "a", codex: "b", fallback: "c" },
    clientSecret: "synthetic-secret",
  });
  assert.equal(backend.HOME, "/smoke/home");
  assert.equal(backend.XDG_CONFIG_HOME, "/smoke/home/.config");
  assert.equal(backend.PNPM_HOME, undefined);
});

test("resource journal is private, redacted, and retains exact recovery on cleanup failure", async () => {
  const diagnostics = await mkdtemp(path.join(os.tmpdir(), "restart-journal-test-"));
  const secret = "bare-resource-secret";
  try {
    const journal = await createResourceLifecycleJournal(diagnostics, {
      canaries: [secret],
    });
    await journal.acquiring({
      id: "database",
      type: "postgres-database",
      owned: true,
      identity: { name: "context_router_0123456789abcdef01234567_test" },
      recovery: `drop exact database; never print ${secret}`,
    });
    await journal.acquired("database");
    await journal.cleanupFinished("database", {
      status: "failed",
      error: new Error(`cleanup exposed ${secret}`),
    });
    await journal.finish("failed", new Error(`primary ${secret}`));
    const contents = await readFile(journal.filePath, "utf8");
    const parsed = JSON.parse(contents);
    assert.equal(contents.includes(secret), false);
    assert.equal(parsed.resources[0].recoveryRequired, true);
    assert.equal(
      parsed.resources[0].identity.name,
      "context_router_0123456789abcdef01234567_test",
    );
    assert.equal((await stat(journal.filePath)).mode & 0o777, 0o600);
  } finally {
    await rm(diagnostics, { recursive: true, force: true });
  }
});

test("backend cleanup is bounded when close never arrives and still finalizes diagnostics", async () => {
  const child = new EventEmitter();
  child.exitCode = null;
  child.signalCode = null;
  child.kill = () => true;
  let detached = false;
  let logFinished = false;
  let shutdownWritten = false;
  const startedAt = Date.now();
  await assert.rejects(
    cleanupBackendProcess(
      {
        child,
        detach() {
          detached = true;
        },
        async finishLog() {
          logFinished = true;
        },
      },
      {
        timeoutMs: 10,
        writeShutdown: async () => {
          shutdownWritten = true;
        },
      },
    ),
    /did not exit after bounded/,
  );
  assert.ok(Date.now() - startedAt < 500);
  assert.equal(detached, true);
  assert.equal(logFinished, true);
  assert.equal(shutdownWritten, true);
});

test("backend cleanup waits for process close and trailing output before finalizing logs", async () => {
  let closeResolved = false;
  let logFinalized = false;
  const backend = {
    child: { exitCode: 0, signalCode: null },
    closePromise: new Promise((resolve) => {
      setTimeout(() => {
        closeResolved = true;
        resolve();
      }, 20);
    }),
    async finishLog() {
      assert.equal(closeResolved, true);
      logFinalized = true;
    },
  };
  await cleanupBackendProcess(backend, { timeoutMs: 100 });
  assert.equal(logFinalized, true);
});

test("backend close timeout is reported but cannot skip log finalization", async () => {
  let logFinalized = false;
  await assert.rejects(
    cleanupBackendProcess(
      {
        child: { exitCode: 0, signalCode: null },
        closePromise: new Promise(() => {}),
        async finishLog() {
          logFinalized = true;
        },
        detach() {},
      },
      { timeoutMs: 10 },
    ),
    /process close did not complete/,
  );
  assert.equal(logFinalized, true);
});

test("restart smoke entry point preserves an unexpected runtime failure and every resource cleanup result", async () => {
  const diagnostics = await mkdtemp(
    path.join(os.tmpdir(), "restart-smoke-injection-test-"),
  );
  const cleanupCalls = [];
  try {
    await assert.rejects(
      runRestartSmoke({
        diagnosticsDirectory: diagnostics,
        workflowOverride: async ({ defer, journal, registerResource }) => {
          for (const [id, type] of [
            ["database", "postgres-database"],
            ["jwks", "loopback-oidc-jwks-server"],
            ["web-support", "web-support-subprocess"],
            ["backend", "backend-process"],
          ]) {
            await registerResource(
              defer,
              journal,
              {
                id,
                type,
                owned: true,
                identity: { test: id },
                recovery: `recover exact ${id}`,
              },
              async () => {
                cleanupCalls.push(id);
                if (id === "jwks") throw new Error("JWKS cleanup failed");
              },
              type.includes("process") ? "exited" : "removed",
            );
          }
          throw new Error("backend exited before readiness");
        },
      }),
      (error) => {
        assert.match(error.message, /backend exited before readiness/);
        assert.match(error.message, /JWKS cleanup failed/);
        assert.equal(error.diagnosticsDirectory, diagnostics);
        return true;
      },
    );
    assert.deepEqual(cleanupCalls, ["backend", "web-support", "jwks", "database"]);
    const failure = await readFile(path.join(diagnostics, "failure.log"), "utf8");
    assert.match(failure, /backend exited before readiness/);
    const journal = JSON.parse(
      await readFile(path.join(diagnostics, "resource-lifecycle.json"), "utf8"),
    );
    assert.equal(journal.status, "failed");
    assert.equal(
      journal.resources.find(({ id }) => id === "jwks").recoveryRequired,
      true,
    );
    assert.equal(
      journal.resources.find(({ id }) => id === "database").cleanup.status,
      "removed",
    );
  } finally {
    await rm(diagnostics, { recursive: true, force: true });
  }
});

test("restart smoke entry point handles cancellation through the same cleanup stack", async () => {
  const diagnostics = await mkdtemp(
    path.join(os.tmpdir(), "restart-smoke-cancel-injection-test-"),
  );
  const controller = new AbortController();
  const cleanupCalls = [];
  try {
    await assert.rejects(
      runRestartSmoke({
        diagnosticsDirectory: diagnostics,
        signal: controller.signal,
        workflowOverride: async ({ defer, journal, registerResource }) => {
          await registerResource(
            defer,
            journal,
            {
              id: "backend",
              type: "backend-process",
              owned: true,
              identity: { pid: 999999 },
              recovery: "recover exact synthetic backend",
            },
            async () => cleanupCalls.push("backend"),
            "exited",
          );
          controller.abort(new Error("cancelled by SIGTERM"));
          throw controller.signal.reason;
        },
      }),
      /cancelled by SIGTERM/,
    );
    assert.deepEqual(cleanupCalls, ["backend"]);
    const journal = JSON.parse(
      await readFile(path.join(diagnostics, "resource-lifecycle.json"), "utf8"),
    );
    assert.equal(journal.status, "cancelled");
    assert.equal(journal.resources[0].cleanup.status, "exited");
  } finally {
    await rm(diagnostics, { recursive: true, force: true });
  }
});

test("restart smoke gives the web subprocess enough SIGTERM grace to finish its bounded cleanup", async () => {
  assert.ok(
    WEB_SUPPORT_SUBPROCESS_TERMINATION_GRACE_MS >
      WEB_SUPPORT_BOUNDED_TERMINATION_BUDGET_MS,
  );
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "restart-web-child-cancel-test-"),
  );
  const fixturePath = path.join(directory, "web-child-fixture.mjs");
  const readyPath = path.join(directory, "ready");
  const cleanedPath = path.join(directory, "cleaned");
  const controller = new AbortController();
  try {
    await writeFile(
      fixturePath,
      [
        'import { writeFileSync } from "node:fs";',
        'writeFileSync(process.env.WEB_CHILD_READY, "ready");',
        'process.on("SIGTERM", () => {',
        '  setTimeout(() => {',
        '    writeFileSync(process.env.WEB_CHILD_CLEANED, "cleaned");',
        '    process.exit(0);',
        '  }, 100);',
        '});',
        'setInterval(() => {}, 1_000);',
      ].join("\n"),
      { mode: 0o600 },
    );
    const child = runWebSupportSubprocess({
      repositoryRoot: directory,
      environment: {
        ...process.env,
        WEB_CHILD_READY: readyPath,
        WEB_CHILD_CLEANED: cleanedPath,
      },
      diagnosticsDirectory: directory,
      canaries: [],
      signal: controller.signal,
      scriptPath: fixturePath,
    });
    await waitForFile(readyPath);
    controller.abort(new Error("cancelled nested web support child"));
    await assert.rejects(child, /cancelled nested web support child/);
    assert.equal(await readFile(cleanedPath, "utf8"), "cleaned");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
