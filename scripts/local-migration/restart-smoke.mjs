#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  sign,
} from "node:crypto";
import { createWriteStream } from "node:fs";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import https from "node:https";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import {
  buildIsolatedGateEnvironment,
  cloneCorepackCache,
  combineFailures,
  createResourceLifecycleJournal,
  createSignalAbortController,
  createStreamingRedactor,
  isLoopbackAddress,
  redactSecrets,
  runCommand,
  writeSanitizedJson,
} from "./gate-runner.mjs";
import { EXPECTED_PNPM_VERSION } from "../check-toolchain.mjs";
import {
  createIsolatedTestDatabase,
  dropIsolatedTestDatabase,
  prepareTestAdministration,
  queryDatabase,
} from "./test-database.mjs";
import { runLocalIdentitySmoke } from "./local-identity-smoke.mjs";
import { runLocalDatabaseSmoke } from "./local-database-smoke.mjs";
import { WEB_SUPPORT_BOUNDED_TERMINATION_BUDGET_MS } from "./web-support-smoke.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultRepositoryRoot = path.resolve(scriptDirectory, "../..");
const expectedCatalogCount = 19;
export const BACKEND_PRODUCTION_ENTRYPOINT = "dist/main.js";
const audience = "urn:context-router:hosted-baseline-smoke";
const mcpScopes = [
  "preferences:read",
  "preferences:suggest",
  "preferences:write",
  "preferences:define",
  "offline_access",
];
export const WEB_SUPPORT_SUBPROCESS_TERMINATION_GRACE_MS =
  WEB_SUPPORT_BOUNDED_TERMINATION_BUDGET_MS + 5_000;
export const RESTART_SMOKE_BOUNDED_CLEANUP_BUDGET_MS = 160_000;

export { createResourceLifecycleJournal };

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

export async function runWebSupportSubprocess({
  repositoryRoot,
  environment,
  diagnosticsDirectory,
  canaries,
  signal,
  scriptPath = "scripts/local-migration/web-support-smoke.mjs",
  commandRunner = runCommand,
}) {
  return commandRunner(["node", scriptPath], {
    cwd: repositoryRoot,
    env: environment,
    timeoutMs: 120_000,
    terminationGraceMs: WEB_SUPPORT_SUBPROCESS_TERMINATION_GRACE_MS,
    logPath: path.join(diagnosticsDirectory, "web-support-smoke.log"),
    canaries,
    signal,
  });
}

function trackedCleanup(journal, id, cleanup, successStatus = "removed") {
  return async () => {
    let primaryError;
    try {
      await cleanup();
    } catch (error) {
      primaryError = error;
    }
    let journalError;
    try {
      await journal.cleanupFinished(id, {
        status: primaryError ? "failed" : successStatus,
        error: primaryError,
      });
    } catch (error) {
      journalError = error;
    }
    if (primaryError && journalError) {
      throw new Error(
        `${primaryError.message}; resource journal update failed: ${journalError.message}`,
        { cause: primaryError },
      );
    }
    if (primaryError) throw primaryError;
    if (journalError) throw journalError;
  };
}

async function registerTrackedResource(
  defer,
  journal,
  record,
  cleanup,
  successStatus = "removed",
) {
  let recorded = journal.state.resources.some((item) => item.id === record.id);
  defer(async () => {
    if (!recorded) return cleanup();
    return trackedCleanup(
      journal,
      record.id,
      cleanup,
      successStatus,
    )();
  });
  if (!recorded) {
    await journal.acquired(record);
  } else if (
    journal.state.resources.find((item) => item.id === record.id)?.status ===
    "acquiring"
  ) {
    await journal.acquired(record.id);
  }
  recorded = true;
}

function base64urlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

export function createSignedTestToken({
  privateKey,
  kid,
  issuer,
  audience: tokenAudience,
  subject,
  clientId,
  scopes = ["preferences:read"],
  nowSeconds = Math.floor(Date.now() / 1000),
}) {
  if (
    !Array.isArray(scopes) ||
    !scopes.length ||
    scopes.some((scope) => typeof scope !== "string" || !scope || /\s/.test(scope))
  ) {
    throw new Error("test-token scopes must be nonempty, whitespace-free strings");
  }
  const header = base64urlJson({ alg: "RS256", kid, typ: "JWT" });
  const payload = base64urlJson({
    iss: issuer,
    aud: tokenAudience,
    sub: subject,
    azp: clientId,
    scope: scopes.join(" "),
    iat: nowSeconds,
    nbf: nowSeconds - 5,
    exp: nowSeconds + 300,
  });
  const input = `${header}.${payload}`;
  const signingKey = privateKey?.type === "private" ? privateKey : createPrivateKey(privateKey);
  const signature = sign("RSA-SHA256", Buffer.from(input), signingKey);
  return `${input}.${signature.toString("base64url")}`;
}

export function assertCatalogState(rows, expectedCount = expectedCatalogCount) {
  assert.equal(rows.length, expectedCount, `catalog count must be ${expectedCount}`);
  const sorted = [...rows].sort((left, right) => left.slug.localeCompare(right.slug));
  const slugs = new Set();
  const ids = new Set();
  for (const row of sorted) {
    if (slugs.has(row.slug)) throw new Error(`duplicate catalog slug: ${row.slug}`);
    if (!row.id || ids.has(row.id)) throw new Error(`missing or duplicate catalog id for ${row.slug}`);
    slugs.add(row.slug);
    ids.add(row.id);
  }
  return sorted;
}

export function assertGenerationStatesEqual(first, second) {
  if (first.principalId !== second.principalId) {
    throw new Error(`principal changed across restart: ${first.principalId} -> ${second.principalId}`);
  }
  assert.deepEqual(
    assertCatalogState(first.catalog, first.catalog.length),
    assertCatalogState(second.catalog, first.catalog.length),
    "catalog IDs/slugs changed across restart",
  );
}

export async function waitForReadiness({
  deadlineMs,
  request,
  processStatus,
  signal,
  now = Date.now,
  delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
}) {
  const startedAt = now();
  let lastFailure = "not attempted";
  while (now() - startedAt <= deadlineMs) {
    if (signal?.aborted) throw signal.reason ?? new Error("readiness aborted");
    const status = processStatus();
    if (status.exited) {
      throw new Error(
        `backend exited before readiness (exit=${status.exitCode ?? "null"}, signal=${status.signal ?? "null"})`,
      );
    }
    try {
      const response = await request();
      if (
        response.status === 200 &&
        response.body?.status === "ok" &&
        !Number.isNaN(Date.parse(response.body.timestamp))
      ) {
        return response;
      }
      lastFailure = `status=${response.status}`;
    } catch (error) {
      lastFailure = error.message;
    }
    await delay(100);
  }
  throw new Error(`backend readiness timed out after ${deadlineMs}ms (${lastFailure})`);
}

async function defaultWaitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return true;
  return new Promise((resolve) => {
    const onExit = () => {
      clearTimeout(timer);
      resolve(true);
    };
    const timer = setTimeout(() => {
      child.off?.("close", onExit);
      resolve(false);
    }, timeoutMs);
    child.once?.("close", onExit);
  });
}

export async function stopBackendProcess(
  child,
  { timeoutMs = 3_000, waitForExit = (target) => defaultWaitForExit(target, timeoutMs) } = {},
) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return {
      requested: null,
      exitCode: child.exitCode,
      signal: child.signalCode,
      usedSigkill: false,
    };
  }
  child.kill("SIGTERM");
  if (await waitForExit(child, timeoutMs)) {
    return {
      requested: "SIGTERM",
      exitCode: child.exitCode,
      signal: child.signalCode,
      usedSigkill: false,
    };
  }
  child.kill("SIGKILL");
  if (!(await waitForExit(child, timeoutMs))) {
    child.stdout?.destroy?.();
    child.stderr?.destroy?.();
    child.unref?.();
    throw new Error("backend did not exit after bounded SIGTERM and SIGKILL");
  }
  return {
    requested: "SIGTERM",
    exitCode: child.exitCode,
    signal: child.signalCode,
    usedSigkill: true,
  };
}

export function enumerateNonLoopbackAddresses(interfaces = os.networkInterfaces()) {
  return [...new Set(
    Object.values(interfaces)
      .flatMap((entries) => entries ?? [])
      .filter((entry) => !entry.internal && !isLoopbackAddress(entry.address))
      .map((entry) => entry.address),
  )].sort();
}

async function tcpReachable(host, port, timeoutMs = 500) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    let settled = false;
    const finish = (reachable) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(reachable);
    };
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.setTimeout(timeoutMs, () => finish(false));
  });
}

export async function assertNonLoopbackUnreachable(
  addresses,
  port,
  connect = (host) => tcpReachable(host, port),
  signal,
) {
  for (const address of addresses) {
    if (signal?.aborted) throw signal.reason ?? new Error("network probe aborted");
    if (await connect(address, port)) {
      throw new Error(`service is reachable through non-loopback address ${address}:${port}`);
    }
  }
}

export async function withCleanupStack(operation) {
  const cleanup = [];
  let primaryError;
  let result;
  try {
    result = await operation((callback) => cleanup.push(callback));
  } catch (error) {
    primaryError = error;
  }
  const cleanupErrors = [];
  for (const callback of cleanup.reverse()) {
    try {
      await callback();
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  if (primaryError || cleanupErrors.length) {
    const messages = [primaryError?.message, ...cleanupErrors.map((error) => `cleanup failed: ${error.message}`)].filter(Boolean);
    const combined = new Error(messages.join("; "), { cause: primaryError ?? cleanupErrors[0] });
    combined.primaryError = primaryError;
    combined.cleanupErrors = cleanupErrors;
    throw combined;
  }
  return result;
}

async function findFreeLoopbackPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

export async function createTlsFixture(
  repositoryRoot,
  secretDirectory,
  diagnosticsDirectory,
  signal,
  environment = process.env,
) {
  const caKey = path.join(secretDirectory, "ca.key");
  const caCertificate = path.join(secretDirectory, "ca.crt");
  const serverKey = path.join(secretDirectory, "server.key");
  const serverRequest = path.join(secretDirectory, "server.csr");
  const serverCertificate = path.join(secretDirectory, "server.crt");
  const extensions = path.join(secretDirectory, "server.ext");
  const caSerial = path.join(secretDirectory, "ca.srl");
  await writeFile(
    extensions,
    "subjectAltName=IP:127.0.0.1\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n",
    { mode: 0o600 },
  );
  await runCommand(
    [
      "openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-sha256", "-days", "1",
      "-subj", "/CN=Context Router Migration Smoke CA", "-addext", "basicConstraints=critical,CA:TRUE",
      "-addext", "keyUsage=critical,keyCertSign,cRLSign", "-keyout", caKey, "-out", caCertificate,
    ],
    { cwd: repositoryRoot, env: environment, timeoutMs: 30_000, logPath: path.join(diagnosticsDirectory, "openssl-ca.log"), signal },
  );
  await runCommand(
    [
      "openssl", "req", "-newkey", "rsa:2048", "-nodes", "-sha256", "-subj", "/CN=127.0.0.1",
      "-keyout", serverKey, "-out", serverRequest,
    ],
    { cwd: repositoryRoot, env: environment, timeoutMs: 30_000, logPath: path.join(diagnosticsDirectory, "openssl-server.log"), signal },
  );
  await runCommand(
    [
      "openssl", "x509", "-req", "-in", serverRequest, "-CA", caCertificate, "-CAkey", caKey,
      "-CAserial", caSerial, "-CAcreateserial", "-days", "1", "-sha256", "-extfile", extensions,
      "-out", serverCertificate,
    ],
    { cwd: repositoryRoot, env: environment, timeoutMs: 30_000, logPath: path.join(diagnosticsDirectory, "openssl-sign.log"), signal },
  );
  const [key, certificate] = await Promise.all([readFile(serverKey), readFile(serverCertificate)]);
  for (const secretPath of [caKey, serverKey, serverRequest, serverCertificate, extensions, caSerial]) {
    await unlink(secretPath).catch(() => {});
  }
  await chmod(caCertificate, 0o600);
  return { caCertificate, key, certificate };
}

export async function startJwksFixture({ key, certificate, signingPublicKey, kid }) {
  const publicKey =
    signingPublicKey?.type === "public"
      ? signingPublicKey
      : createPublicKey(signingPublicKey);
  const publicJwk = publicKey.export({ format: "jwk" });
  const expectedBody = JSON.stringify({
    keys: [{
      kty: "RSA",
      kid,
      use: "sig",
      alg: "RS256",
      n: publicJwk.n,
      e: publicJwk.e,
    }],
  });
  const sockets = new Set();
  const requests = [];
  const server = https.createServer({ key, cert: certificate }, (request, response) => {
    requests.push({ method: request.method, url: request.url });
    if (
      request.method === "GET" &&
      request.url === "/.well-known/openid-configuration"
    ) {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      const issuer = `https://127.0.0.1:${port}`;
      response.writeHead(200, {
        "content-type": "application/json",
        "cache-control": "no-store",
      });
      response.end(JSON.stringify({
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/oauth/token`,
        jwks_uri: `${issuer}/.well-known/jwks.json`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        token_endpoint_auth_methods_supported: ["client_secret_post", "none"],
        code_challenge_methods_supported: ["S256"],
      }));
      return;
    }
    if (request.method !== "GET" || request.url !== "/.well-known/jwks.json") {
      response.writeHead(404, { "content-type": "application/json" });
      response.end('{"error":"fixture_path_rejected"}');
      return;
    }
    response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    response.end(expectedBody);
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    // Backend shutdown can reset an idle keep-alive TLS connection after its
    // request has settled. The fixture owns the socket and can safely consume
    // that expected transport error.
    socket.on("error", () => {});
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : null;
  return {
    port,
    requests,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await withTimeout(
        new Promise((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        ),
        5_000,
        "JWKS fixture cleanup timed out",
      );
    },
  };
}

export function buildSmokeToolEnvironment(
  sourceEnvironment,
  databaseUrl,
  temporaryHome,
  corepackHome,
) {
  return {
    ...buildIsolatedGateEnvironment(
      sourceEnvironment,
      temporaryHome,
      corepackHome,
    ),
    DATABASE_URL: databaseUrl,
  };
}

export function buildSmokeBuildEnvironment(sourceEnvironment) {
  return { ...sourceEnvironment, NODE_ENV: "production" };
}

export function buildSmokeBackendEnvironment({
  sourceEnvironment,
  databaseUrl,
  appPort,
  jwksPort,
  caCertificate,
  clientIds,
}) {
  const allowed = [
    "PATH",
    "TMPDIR",
    "TMP",
    "TEMP",
    "LANG",
    "LC_ALL",
    "HOME",
    "XDG_CONFIG_HOME",
    "XDG_CACHE_HOME",
    "COREPACK_HOME",
    "COREPACK_ENABLE_NETWORK",
  ];
  const environment = Object.fromEntries(
    allowed.flatMap((key) =>
      sourceEnvironment[key] === undefined ? [] : [[key, sourceEnvironment[key]]],
    ),
  );
  const serverUrl = `http://127.0.0.1:${appPort}`;
  const issuer = `https://127.0.0.1:${jwksPort}/`;
  return {
    ...environment,
    NODE_ENV: "production",
    PORT: String(appPort),
    APP_HOST: "127.0.0.1",
    DATABASE_URL: databaseUrl,
    GRAPHQL_PLAYGROUND: "false",
    GRAPHQL_DEBUG: "false",
    AUTH0_ISSUER: issuer,
    AUTH0_AUDIENCE: audience,
    MCP_SERVER_URL: serverUrl,
    MCP_RESOURCE: `${serverUrl}/mcp`,
    AUTH0_MCP_CLAUDE_CLIENT_ID: clientIds.claude,
    AUTH0_MCP_CODEX_CLIENT_ID: clientIds.codex,
    AUTH0_MCP_FALLBACK_CLIENT_ID: clientIds.fallback,
    AUTH0_MCP_PUBLIC_CLIENT_ID: clientIds.fallback,
    MCP_HTTP_ENABLED: "true",
    MCP_HTTP_REQUIRE_AUTH: "true",
    MCP_STDIO_ENABLED: "false",
    MCP_TOOLS_PREFERENCES_ENABLED: "true",
    MCP_RESOURCES_SCHEMA_ENABLED: "true",
    MCP_HTTP_ALLOWED_ORIGINS: serverUrl,
    CORS_ORIGIN: serverUrl,
    GCP_PROJECT_ID: "hosted-baseline-smoke",
    GOOGLE_CLOUD_PROJECT: "hosted-baseline-smoke",
    METADATA_SERVER_DETECTION: "none",
    NODE_EXTRA_CA_CERTS: caCertificate,
  };
}

export async function fetchJson(url, options = {}, timeoutMs = 5_000) {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = options.signal
    ? AbortSignal.any([options.signal, timeoutSignal])
    : timeoutSignal;
  const response = await fetch(url, { ...options, signal });
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`expected JSON from ${url}; status=${response.status}`);
  }
  return { status: response.status, headers: response.headers, body };
}

export async function graphql(serverUrl, query, token, signal) {
  const headers = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  return fetchJson(`${serverUrl}/graphql`, {
    method: "POST",
    headers,
    body: JSON.stringify({ query }),
    signal,
  });
}

export async function mcpPost(serverUrl, token, body, signal) {
  return fetchJson(`${serverUrl}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
    signal,
  });
}

function normalizeDescriptorList(items) {
  return [...items].sort((left, right) => left.name.localeCompare(right.name));
}

function expectedCatalogRows(rawCatalog) {
  return Object.entries(rawCatalog)
    .map(([slug, item]) => ({
      slug,
      namespace: "GLOBAL",
      displayName: item.displayName ?? null,
      ownerUserId: null,
      archivedAt: null,
      description: item.description,
      valueType: item.valueType.toUpperCase(),
      scope: item.scope.toUpperCase(),
      options: item.options ?? null,
      isSensitive: item.isSensitive ?? false,
      isCore: true,
      category: item.category,
    }))
    .sort((left, right) => left.slug.localeCompare(right.slug));
}

async function startBackend({
  backendDirectory,
  environment,
  logPath,
  canaries,
  signal,
}) {
  if (signal?.aborted) throw signal.reason ?? new Error("backend start aborted");
  await mkdir(path.dirname(logPath), { recursive: true });
  if (signal?.aborted) throw signal.reason ?? new Error("backend start aborted");
  const log = createWriteStream(logPath, { flags: "w", mode: 0o600 });
  let logFailure;
  log.on("error", (error) => {
    logFailure ??= error;
  });
  const tail = [];
  const write = (source) => (chunk) => {
    const tagged = `[${source}] ${chunk}`;
    tail.push(tagged.slice(-8_192));
    while (tail.join("").length > 16_384 && tail.length > 1) tail.shift();
    if (!log.destroyed && !logFailure) log.write(tagged);
  };
  const stdout = createStreamingRedactor(write("stdout"), canaries);
  const stderr = createStreamingRedactor(write("stderr"), canaries);
  const child = spawn(process.execPath, [BACKEND_PRODUCTION_ENTRYPOINT], {
    cwd: backendDirectory,
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const status = { exited: false, exitCode: null, signal: null };
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => stdout.write(chunk));
  child.stderr.on("data", (chunk) => stderr.write(chunk));
  const closePromise = new Promise((resolve) => {
    child.once("error", (error) => {
      status.exited = true;
      status.error = error.message;
      resolve();
    });
    child.once("close", (exitCode, childSignal) => {
      status.exited = true;
      status.exitCode = exitCode;
      status.signal = childSignal;
      resolve();
    });
  });
  return {
    child,
    status,
    closePromise,
    outputTail: () => tail.join(""),
    detach() {
      child.stdout?.destroy?.();
      child.stderr?.destroy?.();
      child.unref?.();
    },
    finishLog: async (timeoutMs = 2_000) => {
      stdout.end();
      stderr.end();
      if (!log.destroyed) {
        await new Promise((resolve) => {
          let settled = false;
          const finish = () => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve();
          };
          const timer = setTimeout(() => {
            logFailure ??= new Error(
              `backend log did not close within ${timeoutMs}ms`,
            );
            log.destroy();
            finish();
          }, timeoutMs);
          log.once("finish", finish);
          log.once("close", finish);
          log.end();
        });
      }
      if (logFailure) throw logFailure;
    },
  };
}

export async function cleanupBackendProcess(
  backend,
  {
    timeoutMs = 3_000,
    writeShutdown = async () => {},
  } = {},
) {
  let shutdown;
  const errors = [];
  try {
    shutdown = await stopBackendProcess(backend.child, { timeoutMs });
  } catch (error) {
    shutdown = { error: error.message };
    errors.push(error);
    backend.detach?.();
  }
  if (backend.closePromise) {
    let timeout;
    try {
      const closed = await Promise.race([
        Promise.resolve(backend.closePromise).then(() => true),
        new Promise((resolve) => {
          timeout = setTimeout(() => resolve(false), timeoutMs);
        }),
      ]);
      if (!closed) {
        backend.detach?.();
        errors.push(
          new Error(
            `backend process close did not complete within ${timeoutMs}ms`,
          ),
        );
      }
    } catch (error) {
      errors.push(error);
    } finally {
      clearTimeout(timeout);
    }
  }
  try {
    await backend.finishLog();
  } catch (error) {
    errors.push(error);
  }
  try {
    await writeShutdown(shutdown);
  } catch (error) {
    errors.push(error);
  }
  if (errors.length) {
    throw new Error(
      errors.map((error) => error.message).join("; "),
      { cause: errors[0] },
    );
  }
  return shutdown;
}

async function directCatalogSnapshot(repositoryRoot, databaseUrl, signal) {
  const rows = await queryDatabase(
    repositoryRoot,
    databaseUrl,
    `SELECT
       id,
       namespace,
       slug,
       display_name AS "displayName",
       owner_user_id AS "ownerUserId",
       archived_at AS "archivedAt",
       description,
       value_type::text AS "valueType",
       scope::text AS scope,
       options,
       is_sensitive AS "isSensitive",
       is_core AS "isCore"
     FROM preference_definitions
     WHERE namespace = 'GLOBAL' AND archived_at IS NULL
     ORDER BY slug`,
    [],
    { signal },
  );
  return assertCatalogState(
    rows.map((row) => ({ ...row, category: row.slug.split(".")[0] })),
  );
}

async function probeMcp({
  repositoryRoot,
  serverUrl,
  token,
  contract,
  rawCatalog,
  signal,
}) {
  const require = createRequire(path.join(repositoryRoot, "apps/backend/package.json"));
  const { LATEST_PROTOCOL_VERSION } = require("@modelcontextprotocol/sdk/types.js");
  const initialize = await mcpPost(serverUrl, token, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: LATEST_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "local-migration-restart-smoke", version: "1.0.0" },
    },
  }, signal);
  assert.equal(initialize.status, 200);
  assert.equal(initialize.body.result.protocolVersion, LATEST_PROTOCOL_VERSION);
  assert.deepEqual(initialize.body.result.capabilities, contract.server.capabilities);
  assert.deepEqual(initialize.body.result.serverInfo, contract.server.identity);
  assert.equal(initialize.body.result.instructions, contract.server.instructions);

  const tools = await mcpPost(serverUrl, token, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }, signal);
  assert.equal(tools.status, 200);
  const expectedTools = contract.tools
    .filter((item) => contract.visibility["claude-read-scope"].tools.includes(item.descriptor.name))
    .map((item) => item.descriptor);
  assert.deepEqual(normalizeDescriptorList(tools.body.result.tools), normalizeDescriptorList(expectedTools));

  const resources = await mcpPost(serverUrl, token, { jsonrpc: "2.0", id: 3, method: "resources/list", params: {} }, signal);
  assert.equal(resources.status, 200);
  assert.deepEqual(resources.body.result.resources, contract.resources.map((item) => item.descriptor));

  const resource = await mcpPost(serverUrl, token, {
    jsonrpc: "2.0", id: 4, method: "resources/read", params: { uri: "schema://graphql" },
  }, signal);
  assert.equal(resource.status, 200);
  assert.equal(resource.body.result.contents.length, 1);
  assert.equal(resource.body.result.contents[0].uri, "schema://graphql");
  assert.equal(resource.body.result.contents[0].mimeType, "text/plain");
  assert.equal(
    resource.body.result.contents[0].text,
    await readFile(path.join(repositoryRoot, "apps/backend/src/schema.gql"), "utf8"),
  );

  const tool = await mcpPost(serverUrl, token, {
    jsonrpc: "2.0",
    id: 5,
    method: "tools/call",
    params: { name: "listPreferenceSlugs", arguments: {} },
  }, signal);
  assert.equal(tool.status, 200);
  assert.deepEqual(JSON.parse(tool.body.result.content[0].text), tool.body.result.structuredContent);
  assert.equal(tool.body.result.structuredContent.success, true);
  const preferences = tool.body.result.structuredContent.preferences;
  assert.equal(preferences.length, expectedCatalogCount);
  assert.deepEqual(
    preferences.map((item) => item.slug).sort(),
    Object.keys(rawCatalog).sort(),
  );
}

export function buildRetryGenerationArguments(options) {
  return {
    ...options,
    portAttempt: (options.portAttempt ?? 1) + 1,
  };
}

async function probeGeneration(options) {
  const {
    repositoryRoot,
    databaseUrl,
    backendDirectory,
    jwks,
    signingPrivateKey,
    kid,
    clientIds,
    caCertificate,
    rawCatalog,
    contract,
    httpContract,
    generation,
    diagnosticsDirectory,
    sourceEnvironment,
    signal,
    journal,
    smokeCanaries,
    portAttempt = 1,
  } = options;
  const appPort = await findFreeLoopbackPort();
  const serverUrl = `http://127.0.0.1:${appPort}`;
  const issuer = `https://127.0.0.1:${jwks.port}/`;
  const token = createSignedTestToken({
    privateKey: signingPrivateKey,
    kid,
    issuer,
    audience,
    subject: `${clientIds.claude}@clients`,
    clientId: clientIds.claude,
  });
  journal.addCanary(token);
  const backendHome = path.join(
    diagnosticsDirectory,
    `backend-home-${generation}`,
  );
  await mkdir(path.join(backendHome, ".cache"), {
    recursive: true,
    mode: 0o700,
  });
  const isolatedBackendEnvironment = {
    ...sourceEnvironment,
    HOME: backendHome,
    XDG_CONFIG_HOME: path.join(backendHome, ".config"),
    XDG_CACHE_HOME: path.join(backendHome, ".cache"),
    XDG_DATA_HOME: path.join(backendHome, ".local", "share"),
    XDG_STATE_HOME: path.join(backendHome, ".local", "state"),
  };
  const resourceId = `backend-${generation}-attempt-${portAttempt}`;
  await journal.acquiring({
    id: resourceId,
    type: "backend-process",
    owned: true,
    identity: {
      generation,
      port: appPort,
      command: [process.execPath, BACKEND_PRODUCTION_ENTRYPOINT],
    },
    recovery: `Verify the recorded PID is the generation-${generation} backend before sending SIGTERM, then SIGKILL if required.`,
  });
  let backend;
  try {
    backend = await startBackend({
      backendDirectory,
      environment: buildSmokeBackendEnvironment({
        sourceEnvironment: isolatedBackendEnvironment,
        databaseUrl,
        appPort,
        jwksPort: jwks.port,
        caCertificate,
        clientIds,
      }),
      logPath: path.join(diagnosticsDirectory, `backend-generation-${generation}.log`),
      canaries: [token, issuer.replace(/\/$/, ""), ...smokeCanaries],
      signal,
    });
  } catch (error) {
    let journalError;
    try {
      await journal.cleanupFinished(resourceId, { status: "failed", error });
    } catch (recordError) {
      journalError = recordError;
    }
    throw combineFailures(error, [journalError], `backend ${generation} start`);
  }
  let journalRecorded = true;
  let primaryError;
  let result;
  try {
    await journal.acquired(resourceId, {
      identity: { pid: backend.child.pid },
      recovery: `Verify PID ${backend.child.pid} is the generation-${generation} backend before sending SIGTERM, then SIGKILL if required.`,
    });
    await waitForReadiness({
      deadlineMs: 30_000,
      request: () => fetchJson(`${serverUrl}/health`, { signal }),
      processStatus: () => backend.status,
      signal,
    });
    const publicProbe = await graphql(
      serverUrl,
      `query HostedBaselinePublic { __typename }`,
      null,
      signal,
    );
    assert.equal(publicProbe.status, 200);
    assert.deepEqual(publicProbe.body, { data: { __typename: "Query" } });

    const guardedProbe = await graphql(
      serverUrl,
      `query HostedBaselineGuardedCatalog { preferenceCatalog { slug } }`,
      null,
      signal,
    );
    assert.equal(guardedProbe.status, 200);
    assert.equal(guardedProbe.body.data?.preferenceCatalog ?? null, null);
    assert.equal(guardedProbe.body.errors?.[0]?.message, "Unauthorized");

    const principalProbe = await graphql(
      serverUrl,
      `query HostedBaselinePrincipal { me { userId email } }`,
      token,
      signal,
    );
    assert.equal(principalProbe.status, 200);
    assert.equal(principalProbe.body.errors, undefined);

    const catalogProbe = await graphql(
      serverUrl,
      `query HostedBaselineCatalog {
        preferenceCatalog {
          id namespace slug displayName ownerUserId archivedAt description
          valueType scope options isSensitive isCore category
        }
      }`,
      token,
      signal,
    );
    assert.equal(catalogProbe.status, 200);
    assert.equal(catalogProbe.body.errors, undefined);
    const actualCatalog = [...catalogProbe.body.data.preferenceCatalog]
      .sort((left, right) => left.slug.localeCompare(right.slug));
    const expectedCatalog = expectedCatalogRows(rawCatalog);
    assert.deepEqual(
      actualCatalog.map(({ id: _id, ...item }) => item),
      expectedCatalog,
    );
    const directCatalog = await directCatalogSnapshot(repositoryRoot, databaseUrl, signal);
    assert.deepEqual(
      actualCatalog,
      directCatalog,
    );

    const getMcp = await fetchJson(`${serverUrl}/mcp`, { signal });
    assert.equal(getMcp.status, 405);
    assert.equal(getMcp.headers.get("allow"), "POST");
    assert.deepEqual(getMcp.body, { error: "Method Not Allowed" });

    const missingAuth = await mcpPost(serverUrl, null, {
      jsonrpc: "2.0", id: 0, method: "tools/list", params: {},
    }, signal);
    assert.equal(missingAuth.status, 401);
    assert.equal(
      missingAuth.headers.get("www-authenticate"),
      `Bearer resource_metadata="${serverUrl}/.well-known/oauth-protected-resource", scope="preferences:read"`,
    );
    assert.deepEqual(missingAuth.body, {
      error: "missing_token",
      error_description: "Authentication required",
    });

    const expectedProtected = {
      resource: `${serverUrl}/mcp`,
      authorization_servers: [serverUrl],
      scopes_supported: mcpScopes,
    };
    const expectedAuthorization = {
      issuer: serverUrl,
      authorization_endpoint: `${issuer}authorize?audience=${encodeURIComponent(audience)}`,
      token_endpoint: `${issuer}oauth/token`,
      jwks_uri: `${issuer}.well-known/jwks.json`,
      registration_endpoint: `${serverUrl}/oauth/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      token_endpoint_auth_methods_supported: ["none"],
      code_challenge_methods_supported: ["S256"],
      scopes_supported: mcpScopes,
    };
    for (const route of [
      "/.well-known/oauth-protected-resource",
      "/.well-known/oauth-protected-resource/mcp",
    ]) {
      const response = await fetchJson(`${serverUrl}${route}`, { signal });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("access-control-allow-origin"), "*");
      assert.equal(response.headers.get("cache-control"), "public, max-age=3600");
      assert.deepEqual(response.body, expectedProtected);
    }
    for (const route of [
      "/.well-known/oauth-authorization-server",
      "/.well-known/oauth-authorization-server/mcp",
    ]) {
      const response = await fetchJson(`${serverUrl}${route}`, { signal });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("access-control-allow-origin"), "*");
      assert.equal(response.headers.get("cache-control"), "public, max-age=3600");
      assert.deepEqual(response.body, expectedAuthorization);
    }

    const allowedDcr = await fetchJson(`${serverUrl}/oauth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ redirect_uris: ["http://localhost:8081/callback"] }),
      signal,
    });
    assert.equal(allowedDcr.status, 201);
    assert.deepEqual(allowedDcr.body, {
      client_id: clientIds.claude,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      redirect_uris: ["http://localhost:8081/callback"],
    });
    const dcrResponses = [allowedDcr];
    for (const [caseName, body] of [
      ["empty", {}],
      ["invalid", { redirect_uris: ["https://attacker.invalid/callback"] }],
      [
        "mixed",
        {
          redirect_uris: [
            "http://localhost:8081/callback",
            "http://127.0.0.1:8082/callback",
          ],
        },
      ],
    ]) {
      const response = await fetchJson(`${serverUrl}/oauth/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal,
      });
      assert.equal(response.status, contract.dcr.cases[caseName].status);
      assert.deepEqual(response.body, contract.dcr.cases[caseName].body);
      dcrResponses.push(response);
    }
    for (
      let acceptedRequestCount = dcrResponses.length;
      acceptedRequestCount < contract.dcr.rateLimit.maxRequests;
      acceptedRequestCount += 1
    ) {
      const response = await fetchJson(`${serverUrl}/oauth/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          redirect_uris: ["http://localhost:8081/callback"],
        }),
        signal,
      });
      assert.equal(response.status, 201);
    }
    const deniedDcr = await fetchJson(`${serverUrl}/oauth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        redirect_uris: ["http://localhost:8081/callback"],
      }),
      signal,
    });
    assert.equal(deniedDcr.status, contract.dcr.cases.rateLimit.status);
    assert.deepEqual(deniedDcr.body, contract.dcr.cases.rateLimit.body);
    for (const [header, expected] of Object.entries(
      httpContract.routes.dcr.errors.rateLimit.headers,
    )) {
      const actual = deniedDcr.headers.get(header);
      if (header.toLowerCase() === "content-type") {
        assert.ok(actual?.startsWith(expected), `${header} was ${actual}`);
      } else {
        assert.equal(actual, expected);
      }
    }
    for (const response of dcrResponses) {
      for (const [header, expected] of Object.entries(contract.dcr.headers)) {
        const actual = response.headers.get(header);
        if (header.toLowerCase() === "content-type") {
          assert.ok(actual?.startsWith(expected), `${header} was ${actual}`);
        } else {
          assert.equal(actual, expected);
        }
      }
    }

    await probeMcp({ repositoryRoot, serverUrl, token, contract, rawCatalog, signal });
    const addresses = enumerateNonLoopbackAddresses();
    await assertNonLoopbackUnreachable(addresses, appPort, undefined, signal);
    await assertNonLoopbackUnreachable(addresses, jwks.port, undefined, signal);

    const principal = principalProbe.body.data.me;
    const principalRows = await queryDatabase(
      repositoryRoot,
      databaseUrl,
      "SELECT user_id FROM users WHERE user_id = $1",
      [principal.userId],
      { signal },
    );
    assert.deepEqual(principalRows, [{ user_id: principal.userId }]);
    result = { catalog: directCatalog, principalId: principal.userId, port: appPort };
  } catch (error) {
    primaryError = error;
  }
  let cleanupError;
  try {
    await cleanupBackendProcess(backend, {
      writeShutdown: (shutdown) =>
        writeSanitizedJson(
          path.join(
            diagnosticsDirectory,
            `shutdown-generation-${generation}-attempt-${portAttempt}.json`,
          ),
          shutdown,
          smokeCanaries,
        ),
    });
    if (journalRecorded) {
      await journal.cleanupFinished(resourceId, { status: "closed" });
    }
  } catch (error) {
    cleanupError = error;
    if (journalRecorded) {
      try {
        await journal.cleanupFinished(resourceId, {
          status: "failed",
          error,
        });
      } catch (journalError) {
        cleanupError = combineFailures(
          cleanupError,
          [journalError],
          `backend ${generation}`,
        );
      }
    }
  }
  if (
    primaryError &&
    !cleanupError &&
    portAttempt < 3 &&
    /(?:EADDRINUSE|address already in use)/i.test(backend.outputTail())
  ) {
    return probeGeneration(buildRetryGenerationArguments(options));
  }
  const combined = combineFailures(
    primaryError,
    [cleanupError],
    `backend ${generation}`,
  );
  if (combined) throw combined;
  return result;
}

export async function runRestartSmoke({
  repositoryRoot = defaultRepositoryRoot,
  diagnosticsDirectory,
  environment = process.env,
  signal,
  workflowOverride,
} = {}) {
  const startedAt = Date.now();
  const requestedDiagnostics =
    diagnosticsDirectory ?? environment.MIGRATION_RESTART_SMOKE_DIAGNOSTICS_DIR;
  const ownsDiagnostics = !requestedDiagnostics;
  let diagnostics = requestedDiagnostics;
  const smokeCanaries = [];
  let journal;
  let success = false;
  try {
    diagnostics ??= await mkdtemp(
      path.join(os.tmpdir(), "context-router-restart-smoke-"),
    );
    await mkdir(diagnostics, { recursive: true, mode: 0o700 });
    await chmod(diagnostics, 0o700);
    journal = await createResourceLifecycleJournal(diagnostics, {
      canaries: smokeCanaries,
    });
    if (signal?.aborted) throw signal.reason ?? new Error("restart smoke aborted");
    if (workflowOverride) {
      const injectedResult = await withCleanupStack((defer) =>
        workflowOverride({
          defer,
          journal,
          diagnosticsDirectory: diagnostics,
          signal,
          registerResource: registerTrackedResource,
        }),
      );
      await journal.finish("passed");
      success = true;
      return injectedResult;
    }
    const runtimeHome = path.join(diagnostics, "runtime-home");
    const runtimeCorepack = path.join(diagnostics, "runtime-corepack");
    await mkdir(path.join(runtimeHome, ".cache"), {
      recursive: true,
      mode: 0o700,
    });
    const sourceCorepack =
      environment.COREPACK_HOME ??
      path.join(
        environment.XDG_CACHE_HOME ??
          path.join(environment.HOME ?? os.homedir(), ".cache"),
        "node",
        "corepack",
      );
    await cloneCorepackCache(sourceCorepack, runtimeCorepack, {
      signal,
      requiredPnpmVersion: EXPECTED_PNPM_VERSION,
    });
    const result = await withCleanupStack(async (defer) => {
      const administration = await prepareTestAdministration({
        repositoryRoot,
        diagnosticsDirectory: diagnostics,
        environment,
        signal,
        lifecycle: journal,
      });
      const encodedAdministrationPassword = new URL(
        administration.administrationUrl,
      ).password;
      let decodedAdministrationPassword = encodedAdministrationPassword;
      try {
        decodedAdministrationPassword = decodeURIComponent(
          encodedAdministrationPassword,
        );
      } catch {}
      for (const canary of [
        encodedAdministrationPassword,
        decodedAdministrationPassword,
      ]) {
        if (canary) journal.addCanary(canary);
      }
      await registerTrackedResource(
        defer,
        journal,
        {
          id: administration.containerName ? "container" : "administration",
          type: administration.containerName
            ? "local-administration-container"
            : "external-administration",
          owned: Boolean(administration.containerName),
          identity: administration.containerName
            ? { name: administration.containerName }
            : { source: administration.source },
          recovery:
            administration.recovery ??
            "The supplied administration server is not owned by the smoke.",
        },
        administration.cleanup,
        administration.containerName ? "removed" : "not-owned",
      );
      const database = await createIsolatedTestDatabase(
        repositoryRoot,
        administration.administrationUrl,
        { signal, lifecycle: journal },
      );
      await registerTrackedResource(
        defer,
        journal,
        {
          id: "database",
          type: "owned-test-database",
          owned: true,
          identity: {
            name: database.databaseName,
            ownershipMarker: database.ownershipMarker,
          },
          recovery: `Using the same verified local administration endpoint, verify ownership comment "${database.ownershipMarker}", then drop only database "${database.databaseName}".`,
        },
        () =>
          dropIsolatedTestDatabase(
            repositoryRoot,
            administration.administrationUrl,
            database.databaseName,
            { expectedOwnershipMarker: database.ownershipMarker },
          ),
      );

      const toolEnvironment = buildSmokeToolEnvironment(
        environment,
        database.databaseUrl,
        runtimeHome,
        runtimeCorepack,
      );
      await runCommand(["pnpm", "--filter", "backend", "prisma:generate"], {
        cwd: repositoryRoot,
        env: toolEnvironment,
        timeoutMs: 120_000,
        logPath: path.join(diagnostics, "prisma-generate.log"),
        canaries: smokeCanaries,
        signal,
      });
      await runCommand(["pnpm", "--filter", "backend", "exec", "prisma", "migrate", "deploy"], {
        cwd: repositoryRoot,
        env: toolEnvironment,
        timeoutMs: 120_000,
        logPath: path.join(diagnostics, "migrations.log"),
        canaries: smokeCanaries,
        signal,
      });
      for (const generation of [1, 2]) {
        await runCommand(["pnpm", "--filter", "backend", "exec", "ts-node", "prisma/seed-catalog-smoke.ts"], {
          cwd: repositoryRoot,
          env: toolEnvironment,
          timeoutMs: 120_000,
          logPath: path.join(diagnostics, `catalog-seed-${generation}.log`),
          canaries: smokeCanaries,
          signal,
        });
      }
      const initialCatalog = await directCatalogSnapshot(
        repositoryRoot,
        database.databaseUrl,
        signal,
      );

      await runCommand(["pnpm", "--filter", "backend", "build"], {
        cwd: repositoryRoot,
        env: buildSmokeBuildEnvironment(toolEnvironment),
        timeoutMs: 300_000,
        logPath: path.join(diagnostics, "backend-build.log"),
        canaries: smokeCanaries,
        signal,
      });

      const { DATABASE_URL: _databaseUrl, ...webToolEnvironment } =
        toolEnvironment;
      await runCommand(["pnpm", "--filter", "web", "build"], {
        cwd: repositoryRoot,
        env: buildSmokeBuildEnvironment(webToolEnvironment),
        timeoutMs: 600_000,
        logPath: path.join(diagnostics, "web-build.log"),
        canaries: smokeCanaries,
        signal,
      });

      const secretDirectory = await mkdtemp(path.join(os.tmpdir(), "context-router-smoke-secrets-"));
      await registerTrackedResource(
        defer,
        journal,
        {
          id: "secret-directory",
          type: "secret-directory",
          owned: true,
          identity: { path: secretDirectory },
          recovery: `Remove only the exact smoke secret directory ${secretDirectory}.`,
        },
        () =>
          withTimeout(
            rm(secretDirectory, { recursive: true, force: true }),
            5_000,
            "secret-directory cleanup timed out",
          ),
      );
      await chmod(secretDirectory, 0o700);
      const tls = await createTlsFixture(
        repositoryRoot,
        secretDirectory,
        diagnostics,
        signal,
      );
      const signingKeys = generateKeyPairSync("rsa", { modulusLength: 2048 });
      const kid = randomBytes(12).toString("hex");
      const jwks = await startJwksFixture({
        key: tls.key,
        certificate: tls.certificate,
        signingPublicKey: signingKeys.publicKey,
        kid,
      });
      await registerTrackedResource(
        defer,
        journal,
        {
          id: "jwks",
          type: "loopback-oidc-jwks-server",
          owned: true,
          identity: { port: jwks.port, ownerPid: process.pid },
          recovery: `If PID ${process.pid} is still this smoke process, terminate it to close loopback JWKS port ${jwks.port}.`,
        },
        jwks.close,
        "closed",
      );
      const webClientSecret = `synthetic-web-${randomBytes(16).toString("hex")}`;
      const webSessionSecret = randomBytes(32).toString("hex");
      journal.addCanary(webClientSecret);
      journal.addCanary(webSessionSecret);
      const webResourceId = "web-support-subprocess";
      await journal.acquiring({
        id: webResourceId,
        type: "web-support-subprocess",
        owned: true,
        identity: {
          ownerPid: process.pid,
          command: ["node", "scripts/local-migration/web-support-smoke.mjs"],
        },
        recovery: `If PID ${process.pid} is still this restart smoke, terminate it so its managed web-support command group is stopped.`,
      });
      await journal.acquired(webResourceId);
      let webError;
      try {
        await runWebSupportSubprocess({
          repositoryRoot,
          environment: {
            ...webToolEnvironment,
            NODE_EXTRA_CA_CERTS: tls.caCertificate,
            MIGRATION_WEB_SUPPORT_AUTH0_DOMAIN: `127.0.0.1:${jwks.port}`,
            MIGRATION_WEB_SUPPORT_EXPECTED_AUTH_ORIGIN: `https://127.0.0.1:${jwks.port}`,
            MIGRATION_WEB_SUPPORT_CLIENT_SECRET: webClientSecret,
            MIGRATION_WEB_SUPPORT_SESSION_SECRET: webSessionSecret,
            MIGRATION_WEB_SUPPORT_DIAGNOSTICS_DIR: path.join(
              diagnostics,
              "web-support",
            ),
          },
          diagnosticsDirectory: diagnostics,
          canaries: smokeCanaries,
          signal,
        });
      } catch (error) {
        webError = error;
      }
      let webJournalError;
      try {
        await journal.cleanupFinished(webResourceId, {
          status: "exited",
          error: webError,
        });
      } catch (error) {
        webJournalError = error;
      }
      if (webError || webJournalError) {
        throw combineFailures(
          webError,
          [webJournalError],
          "web support subprocess",
        );
      }
      const clientIds = {
        claude: `migration-smoke-${randomBytes(8).toString("hex")}`,
        codex: `migration-smoke-codex-${randomBytes(8).toString("hex")}`,
        fallback: `migration-smoke-fallback-${randomBytes(8).toString("hex")}`,
      };
      const [rawCatalog, contract, httpContract] = await Promise.all([
        readFile(path.join(repositoryRoot, "apps/backend/src/config/preferences.catalog.json"), "utf8").then(JSON.parse),
        readFile(path.join(repositoryRoot, "apps/backend/test/contracts/fixtures/mcp-contract-baseline.json"), "utf8").then(JSON.parse),
        readFile(path.join(repositoryRoot, "apps/backend/test/contracts/fixtures/http-contracts.v1.json"), "utf8").then(JSON.parse),
      ]);
      assert.deepEqual(
        initialCatalog.map((item) => item.slug),
        Object.keys(rawCatalog).sort(),
      );

      const generationArguments = {
        repositoryRoot,
        databaseUrl: database.databaseUrl,
        backendDirectory: path.join(repositoryRoot, "apps/backend"),
        jwks,
        signingPrivateKey: signingKeys.privateKey,
        kid,
        clientIds,
        caCertificate: tls.caCertificate,
        rawCatalog,
        contract,
        httpContract,
        diagnosticsDirectory: diagnostics,
        sourceEnvironment: toolEnvironment,
        signal,
        journal,
        smokeCanaries,
      };
      const first = await probeGeneration({ ...generationArguments, generation: 1 });
      const second = await probeGeneration({ ...generationArguments, generation: 2 });
      assertGenerationStatesEqual(first, second);
      assert.deepEqual(first.catalog, initialCatalog);
      const jwksHits = jwks.requests.filter(
        (request) => request.method === "GET" && request.url === "/.well-known/jwks.json",
      );
      assert.ok(jwksHits.length >= 4, `expected independent JWT/MCP JWKS fetches across generations; observed ${jwksHits.length}`);
      const discoveryHits = jwks.requests.filter(
        (request) =>
          request.method === "GET" &&
          request.url === "/.well-known/openid-configuration",
      );
      assert.ok(
        discoveryHits.length >= 1,
        "expected the built web login route to request local OIDC discovery",
      );
      assert.equal(
        jwks.requests.every(
          (request) =>
            request.method === "GET" &&
            new Set([
              "/.well-known/openid-configuration",
              "/.well-known/jwks.json",
            ]).has(request.url),
        ),
        true,
        "OIDC/JWKS fixture received an unexpected request",
      );
      const hostileLocalCwd = path.join(secretDirectory, "hostile-local-cwd");
      await mkdir(hostileLocalCwd, { mode: 0o700 });
      await writeFile(
        path.join(hostileLocalCwd, ".env"),
        "DATABASE_URL=postgresql://hostile:hostile@203.0.113.9:5432/hostile\nAUTH0_ISSUER=https://hostile.invalid/\n",
        { mode: 0o600 },
      );
      const localIdentity = await runLocalIdentitySmoke({
        repositoryRoot,
        entrypoint: path.join(
          repositoryRoot,
          "apps/backend/dist/local-identity-postgres-reference.js",
        ),
        cwd: hostileLocalCwd,
        home: path.join(secretDirectory, "local-identity-home"),
        temporaryDirectory: path.join(secretDirectory, "local-identity-tmp"),
        stateParent: secretDirectory,
        tlsParent: secretDirectory,
        caPem: await readFile(tls.caCertificate, "utf8"),
        serverKey: tls.key,
        serverCertificate: tls.certificate,
        diagnosticsDirectory: diagnostics,
        journal,
        canaries: smokeCanaries,
        environment,
        signal,
        migrateDatabase: async (localDatabaseUrl) => {
          await runCommand(
            [
              "pnpm",
              "--filter",
              "backend",
              "exec",
              "prisma",
              "migrate",
              "deploy",
            ],
            {
              cwd: repositoryRoot,
              env: buildSmokeToolEnvironment(
                environment,
                localDatabaseUrl,
                runtimeHome,
                runtimeCorepack,
              ),
              timeoutMs: 120_000,
              logPath: path.join(
                diagnostics,
                "local-identity-migrations.log",
              ),
              canaries: smokeCanaries,
              signal,
            },
          );
        },
      });
      const localDatabase = await runLocalDatabaseSmoke({
        entrypoint: path.join(repositoryRoot, "apps/backend/dist/local-identity.js"),
        cwd: hostileLocalCwd,
        home: path.join(secretDirectory, "local-database-home"),
        temporaryDirectory: path.join(secretDirectory, "local-database-tmp"),
        stateParent: secretDirectory,
        journal,
        environment,
        signal,
      });
      return {
        databaseName: database.databaseName,
        administrationSource: administration.source,
        generations: [
          { number: 1, port: first.port, principalStable: true, catalogCount: first.catalog.length },
          { number: 2, port: second.port, principalStable: true, catalogCount: second.catalog.length },
        ],
        jwksFetches: jwksHits.length,
        localIdentity,
        localDatabase,
        elapsedMs: Date.now() - startedAt,
      };
    });
    await journal.finish("passed");
    success = true;
    return result;
  } catch (error) {
    const diagnosticErrors = [];
    if (journal) {
      try {
        await journal.finish(signal?.aborted ? "cancelled" : "failed", error);
      } catch (journalError) {
        diagnosticErrors.push(journalError);
      }
    }
    if (diagnostics) {
      try {
        const message = redactSecrets(
          error?.stack ?? error?.message ?? error,
          smokeCanaries,
        );
        await writeFile(path.join(diagnostics, "failure.log"), `${message}\n`, {
          mode: 0o600,
        });
      } catch (writeError) {
        diagnosticErrors.push(writeError);
      }
    }
    const combined = combineFailures(
      error,
      diagnosticErrors,
      "restart smoke",
    );
    combined.message = redactSecrets(combined.message, smokeCanaries);
    combined.exitCode = error.exitCode ?? signal?.reason?.exitCode ?? 1;
    combined.signal = error.signal ?? signal?.reason?.signal ?? null;
    if (diagnostics) combined.diagnosticsDirectory = diagnostics;
    throw combined;
  } finally {
    if (success && ownsDiagnostics && diagnostics) {
      await rm(diagnostics, { recursive: true, force: true });
    }
  }
}

async function main() {
  const cancellation = createSignalAbortController();
  try {
    const result = await runRestartSmoke({ signal: cancellation.signal });
    console.log(
      `restart-smoke: ok; generations=2 catalog=${result.generations[0].catalogCount} ` +
        `jwksFetches=${result.jwksFetches} elapsedMs=${result.elapsedMs}`,
    );
  } catch (error) {
    console.error(`restart-smoke: ${redactSecrets(error.message)}`);
    if (error.diagnosticsDirectory) console.error(`restart-smoke: sanitized diagnostics retained at ${error.diagnosticsDirectory}`);
    process.exitCode = error.exitCode ?? cancellation.signal.reason?.exitCode ?? 1;
  } finally {
    cancellation.dispose();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
