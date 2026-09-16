#!/usr/bin/env node

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import http from "node:http";
import { chmod, mkdtemp, mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  combineFailures,
  redactSecrets,
  writeSanitizedJson,
} from "./gate-runner.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const syntheticAuthDomain = "synthetic-auth.invalid";
export const WEB_SUPPORT_RESOURCE_TIMEOUT_MS = 5_000;
export const WEB_SUPPORT_BOUNDED_CLEANUP_BUDGET_MS =
  WEB_SUPPORT_RESOURCE_TIMEOUT_MS * 5;
export const WEB_SUPPORT_BOUNDED_TERMINATION_BUDGET_MS =
  WEB_SUPPORT_BOUNDED_CLEANUP_BUDGET_MS + WEB_SUPPORT_RESOURCE_TIMEOUT_MS;

export function buildWebSupportEnvironment(
  sourceEnvironment,
  { port, home, clientSecret, sessionSecret },
) {
  const inherited = [
    "PATH",
    "TMPDIR",
    "TMP",
    "TEMP",
    "LANG",
    "LC_ALL",
    "NODE_EXTRA_CA_CERTS",
  ];
  const environment = Object.fromEntries(
    inherited.flatMap((key) =>
      sourceEnvironment[key] === undefined ? [] : [[key, sourceEnvironment[key]]],
    ),
  );
  return {
    ...environment,
    NODE_ENV: "production",
    HOME: home,
    XDG_CONFIG_HOME: path.join(home, ".config"),
    XDG_CACHE_HOME: path.join(home, ".cache"),
    XDG_DATA_HOME: path.join(home, ".local", "share"),
    XDG_STATE_HOME: path.join(home, ".local", "state"),
    APP_BASE_URL: `http://127.0.0.1:${port}`,
    AUTH0_DOMAIN:
      sourceEnvironment.MIGRATION_WEB_SUPPORT_AUTH0_DOMAIN ??
      syntheticAuthDomain,
    AUTH0_CLIENT_ID: "local-migration-web-smoke",
    AUTH0_CLIENT_SECRET: clientSecret,
    AUTH0_SECRET: sessionSecret,
    AUTH0_AUDIENCE: "https://context-router.local",
    NEXT_PUBLIC_BACKEND_URL: "http://127.0.0.1:9",
    NEXT_PUBLIC_GRAPHQL_URL: "http://127.0.0.1:9/graphql",
  };
}

async function fetchResponse(url, options = {}, signal) {
  const requestSignal = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(10_000)])
    : AbortSignal.timeout(10_000);
  const response = await fetch(url, {
    redirect: "manual",
    signal: requestSignal,
    ...options,
  });
  const text = await response.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return { status: response.status, headers: response.headers, body };
}

export function assertWebSupportResponses(responses, expectedAuthOrigin) {
  assert.equal(responses.chat.status, 401, "POST /api/chat must reject a missing session");
  assert.deepEqual(responses.chat.body, { error: "Unauthorized" });
  assert.equal(
    responses.debugToken.status,
    401,
    "GET /api/debug/token must reject a missing session",
  );
  assert.deepEqual(responses.debugToken.body, { error: "Not authenticated" });
  assert.ok(
    responses.login.status >= 300 && responses.login.status < 400,
    `GET /auth/login must redirect, received ${responses.login.status}`,
  );
  const location = responses.login.headers.get("location");
  assert.ok(location, "GET /auth/login must return a Location header");
  assert.equal(
    new URL(location).origin,
    expectedAuthOrigin,
    "GET /auth/login redirected outside the configured synthetic Auth0 domain",
  );
}

async function raceWithSignal(operation, signal) {
  if (!signal) return operation;
  if (signal.aborted) throw signal.reason ?? new Error("web support smoke aborted");
  return new Promise((resolve, reject) => {
    const abort = () =>
      reject(signal.reason ?? new Error("web support smoke aborted"));
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve(operation).then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}

async function withTimeout(operation, timeoutMs, message) {
  let timeout;
  try {
    return await Promise.race([
      operation,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

export async function closeHttpServerBounded(
  server,
  sockets,
  timeoutMs = WEB_SUPPORT_RESOURCE_TIMEOUT_MS,
) {
  for (const socket of sockets) socket.destroy();
  if (!server.listening) return;
  await withTimeout(
    new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    ),
    timeoutMs,
    "web support listener cleanup timed out",
  );
}

export async function closeNextAppBounded(
  nextApp,
  timeoutMs = WEB_SUPPORT_RESOURCE_TIMEOUT_MS,
) {
  if (!nextApp?.close) return;
  await withTimeout(
    Promise.resolve().then(() => nextApp.close()),
    timeoutMs,
    "web support Next cleanup timed out",
  );
}

async function createWebSupportJournal(diagnosticsDirectory, canaries) {
  const filePath = path.join(
    diagnosticsDirectory,
    "web-support-resource-lifecycle.json",
  );
  const state = {
    schemaVersion: 1,
    status: "running",
    startedAt: new Date().toISOString(),
    resources: [],
  };
  const persist = () => writeSanitizedJson(filePath, state, canaries);
  await persist();
  return {
    filePath,
    state,
    async acquiring(record) {
      state.resources.push({
        ...record,
        status: "acquiring",
        cleanup: { status: "pending" },
      });
      await persist();
    },
    async acquired(id, identity = {}) {
      const resource = state.resources.find((item) => item.id === id);
      assert.ok(resource, `unknown web support resource ${id}`);
      resource.status = "acquired";
      resource.identity = { ...resource.identity, ...identity };
      resource.acquiredAt = new Date().toISOString();
      await persist();
    },
    async cleaned(id, status, error) {
      const resource = state.resources.find((item) => item.id === id);
      assert.ok(resource, `unknown web support resource ${id}`);
      resource.cleanup = {
        status,
        finishedAt: new Date().toISOString(),
        ...(error ? { error: redactSecrets(error.message, canaries) } : {}),
      };
      resource.recoveryRequired = Boolean(error);
      await persist();
    },
    async finish(status, error) {
      state.status = status;
      state.finishedAt = new Date().toISOString();
      if (error) state.error = redactSecrets(error.message, canaries);
      await persist();
    },
  };
}

function replaceProcessEnvironment(environment) {
  const original = { ...process.env };
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, environment);
  return () => {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, original);
  };
}

export async function listenOnDynamicLoopbackPort(
  server,
  timeoutMs = WEB_SUPPORT_RESOURCE_TIMEOUT_MS,
) {
  const controller = new AbortController();
  const timeoutError = new Error(
    `web support listener acquisition timed out after ${timeoutMs}ms`,
  );
  let timeout;
  await new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      server.off("listening", onListening);
      server.off("error", onError);
      server.off("close", onClose);
      callback(value);
    };
    const onListening = () => finish(resolve);
    const onError = (error) => finish(reject, error);
    const onClose = () =>
      finish(
        reject,
        controller.signal.reason ??
          new Error("web support listener closed during acquisition"),
      );
    server.once("listening", onListening);
    server.once("error", onError);
    server.once("close", onClose);
    timeout = setTimeout(() => controller.abort(timeoutError), timeoutMs);
    try {
      server.listen({
        port: 0,
        host: "127.0.0.1",
        signal: controller.signal,
      });
    } catch (error) {
      finish(reject, error);
    }
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : null;
  if (!Number.isInteger(port)) {
    throw new Error("web support listener did not receive a TCP port");
  }
  return port;
}

async function probeBuiltWebSupport({ baseUrl, signal, expectedAuthOrigin }) {
  const responses = {
    chat: await fetchResponse(
      `${baseUrl}/api/chat`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "contract probe" }),
      },
      signal,
    ),
    debugToken: await fetchResponse(
      `${baseUrl}/api/debug/token?format=json`,
      {},
      signal,
    ),
    login: await fetchResponse(`${baseUrl}/auth/login`, {}, signal),
  };
  assertWebSupportResponses(responses, expectedAuthOrigin);
  return responses;
}

export async function runWebSupportSmoke({
  root = repositoryRoot,
  sourceEnvironment = process.env,
  signal,
  diagnosticsDirectory,
  nextFactory,
  probe = probeBuiltWebSupport,
  closeServer = closeHttpServerBounded,
  closeNextApp = closeNextAppBounded,
  preparationSettleTimeoutMs = WEB_SUPPORT_RESOURCE_TIMEOUT_MS,
  removeDirectory = (directory) =>
    withTimeout(
      rm(directory, { recursive: true, force: true }),
      WEB_SUPPORT_RESOURCE_TIMEOUT_MS,
      "web support temporary-home cleanup timed out",
    ),
} = {}) {
  if (signal?.aborted) throw signal.reason ?? new Error("web support smoke aborted");
  const sourceSnapshot = { ...sourceEnvironment };
  const requestedDiagnostics =
    diagnosticsDirectory ??
    sourceSnapshot.MIGRATION_WEB_SUPPORT_DIAGNOSTICS_DIR;
  const ownsDiagnostics = !requestedDiagnostics;
  const clientSecret =
    sourceSnapshot.MIGRATION_WEB_SUPPORT_CLIENT_SECRET ??
    `synthetic-client-${randomUUID()}`;
  const sessionSecret =
    sourceSnapshot.MIGRATION_WEB_SUPPORT_SESSION_SECRET ??
    randomUUID().replaceAll("-", "").repeat(2);
  const canaries = [clientSecret, sessionSecret];
  let diagnostics = requestedDiagnostics;
  let journal;
  let temporaryHome;
  const sockets = new Set();
  let server;
  let nextApp;
  let nextPreparationPromise;
  let nextPreparationSettled = false;
  let restoreEnvironment;
  let primaryError;
  let result;
  try {
    diagnostics ??= await mkdtemp(
      path.join(os.tmpdir(), "context-router-web-support-diagnostics-"),
    );
    await mkdir(diagnostics, { recursive: true, mode: 0o700 });
    await chmod(diagnostics, 0o700);
    journal = await createWebSupportJournal(diagnostics, canaries);

    temporaryHome = await mkdtemp(
      path.join(os.tmpdir(), "context-router-web-support-smoke-"),
    );
    await chmod(temporaryHome, 0o700);
    await journal.acquiring({
      id: "temporary-home",
      type: "private-temporary-home",
      owned: true,
      identity: { path: temporaryHome },
      recovery: `Remove only the exact web support temporary home ${temporaryHome}.`,
    });
    await journal.acquired("temporary-home");

    await journal.acquiring({
      id: "loopback-listener",
      type: "loopback-http-listener",
      owned: true,
      identity: { host: "127.0.0.1", port: "dynamic", ownerPid: process.pid },
      recovery: `If PID ${process.pid} is still this web support smoke, terminate it to close its loopback listener.`,
    });
    server = http.createServer((_request, response) => {
      response.statusCode = 503;
      response.end("preparing");
    });
    server.on("connection", (socket) => {
      sockets.add(socket);
      socket.once("close", () => sockets.delete(socket));
    });
    const port = await listenOnDynamicLoopbackPort(server);
    await journal.acquired("loopback-listener", { port });
    if (signal?.aborted) {
      throw signal.reason ?? new Error("web support smoke aborted");
    }
    const environment = buildWebSupportEnvironment(sourceSnapshot, {
      port,
      home: temporaryHome,
      clientSecret,
      sessionSecret,
    });
    await Promise.all(
      [
        environment.XDG_CONFIG_HOME,
        environment.XDG_CACHE_HOME,
        environment.XDG_DATA_HOME,
        environment.XDG_STATE_HOME,
      ].map((directory) => mkdir(directory, { recursive: true, mode: 0o700 })),
    );
    restoreEnvironment = replaceProcessEnvironment(environment);
    const expectedAuthOrigin =
      sourceSnapshot.MIGRATION_WEB_SUPPORT_EXPECTED_AUTH_ORIGIN ??
      `https://${syntheticAuthDomain}`;

    const createNext =
      nextFactory ??
      (({ port: nextPort }) => {
        const requireFromWeb = createRequire(
          path.join(root, "apps/web/package.json"),
        );
        const next = requireFromWeb("next");
        return next({
          dev: false,
          dir: path.join(root, "apps/web"),
          hostname: "127.0.0.1",
          port: nextPort,
        });
      });
    await journal.acquiring({
      id: "next-app",
      type: "in-process-next-app",
      owned: true,
      identity: { ownerPid: process.pid, port },
      recovery: `If PID ${process.pid} is still this web support smoke, terminate it to stop the in-process Next app.`,
    });
    nextApp = createNext({ port, root });
    await journal.acquired("next-app");
    nextPreparationPromise = Promise.resolve()
      .then(() => nextApp.prepare())
      .finally(() => {
        nextPreparationSettled = true;
      });
    await raceWithSignal(nextPreparationPromise, signal);
    if (signal?.aborted) throw signal.reason ?? new Error("web support smoke aborted");
    const handler = nextApp.getRequestHandler();
    server.removeAllListeners("request");
    server.on("request", (request, response) => handler(request, response));
    const responses = await probe({
      baseUrl: `http://127.0.0.1:${port}`,
      signal,
      expectedAuthOrigin,
    });
    result = {
      port,
      statuses: Object.fromEntries(
        Object.entries(responses).map(([name, response]) => [name, response.status]),
      ),
    };
  } catch (error) {
    primaryError = error;
  }

  const cleanupErrors = [];
  let listenerError;
  if (server) {
    try {
      await closeServer(server, sockets);
    } catch (error) {
      listenerError = error;
      cleanupErrors.push(error);
    }
  }
  if (journal?.state.resources.some(({ id }) => id === "loopback-listener")) {
    try {
      await journal.cleaned(
        "loopback-listener",
        listenerError ? "failed" : server ? "closed" : "not-acquired",
        listenerError,
      );
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  const nextCleanupErrors = [];
  if (nextApp) {
    const preparationWasPending = Boolean(
      nextPreparationPromise && !nextPreparationSettled,
    );
    try {
      await closeNextApp(nextApp);
    } catch (error) {
      nextCleanupErrors.push(error);
      cleanupErrors.push(error);
    }
    if (nextPreparationPromise && !nextPreparationSettled) {
      try {
        await withTimeout(
          nextPreparationPromise.catch(() => undefined),
          preparationSettleTimeoutMs,
          `web support Next preparation did not settle within ${preparationSettleTimeoutMs}ms after cleanup began`,
        );
      } catch (error) {
        nextCleanupErrors.push(error);
        cleanupErrors.push(error);
      }
    }
    if (preparationWasPending && nextPreparationSettled) {
      try {
        await closeNextApp(nextApp);
      } catch (error) {
        nextCleanupErrors.push(error);
        cleanupErrors.push(error);
      }
    }
  }
  const nextError = combineFailures(
    null,
    nextCleanupErrors,
    "web support Next",
  );
  if (journal?.state.resources.some(({ id }) => id === "next-app")) {
    try {
      await journal.cleaned(
        "next-app",
        nextError ? "failed" : nextApp ? "closed" : "not-acquired",
        nextError,
      );
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  try {
    restoreEnvironment?.();
  } catch (error) {
    cleanupErrors.push(error);
  }
  let homeError;
  if (temporaryHome) {
    try {
      await removeDirectory(temporaryHome);
    } catch (error) {
      homeError = error;
      cleanupErrors.push(error);
    }
  }
  if (journal?.state.resources.some(({ id }) => id === "temporary-home")) {
    try {
      await journal.cleaned(
        "temporary-home",
        homeError ? "failed" : temporaryHome ? "removed" : "not-acquired",
        homeError,
      );
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  let combined = combineFailures(
    primaryError,
    cleanupErrors,
    "web support smoke",
  );
  if (journal) {
    try {
      await journal.finish(
        combined ? (signal?.aborted ? "cancelled" : "failed") : "passed",
        combined,
      );
    } catch (error) {
      cleanupErrors.push(error);
      combined = combineFailures(primaryError, cleanupErrors, "web support smoke");
    }
  }
  if (combined) {
    combined.message = redactSecrets(combined.message, canaries);
    if (diagnostics) combined.diagnosticsDirectory = diagnostics;
    throw combined;
  }
  if (ownsDiagnostics) {
    try {
      await rm(diagnostics, { recursive: true, force: true });
    } catch (error) {
      error.diagnosticsDirectory = diagnostics;
      throw error;
    }
  }
  return result;
}

async function main() {
  const controller = new AbortController();
  const onSignal = (name) => {
    if (!controller.signal.aborted) {
      const error = new Error(`web support smoke cancelled by ${name}`);
      error.exitCode = name === "SIGINT" ? 130 : 143;
      controller.abort(error);
    }
  };
  const onSigint = () => onSignal("SIGINT");
  const onSigterm = () => onSignal("SIGTERM");
  process.on("SIGINT", onSigint);
  process.on("SIGTERM", onSigterm);
  try {
    const result = await runWebSupportSmoke({ signal: controller.signal });
    console.log(`web-support-smoke: ok; statuses=${JSON.stringify(result.statuses)}`);
  } catch (error) {
    console.error(`web-support-smoke: ${redactSecrets(error.message)}`);
    if (error.diagnosticsDirectory) {
      console.error(
        `web-support-smoke: sanitized diagnostics retained at ${error.diagnosticsDirectory}`,
      );
    }
    process.exitCode = error.exitCode ?? 1;
  } finally {
    process.off("SIGINT", onSigint);
    process.off("SIGTERM", onSigterm);
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  await main();
}
