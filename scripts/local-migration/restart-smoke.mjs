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
  createStreamingRedactor,
  isLoopbackAddress,
  redactSecrets,
  runCommand,
} from "./gate-runner.mjs";
import {
  createIsolatedTestDatabase,
  dropIsolatedTestDatabase,
  prepareTestAdministration,
  queryDatabase,
} from "./test-database.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultRepositoryRoot = path.resolve(scriptDirectory, "../..");
const expectedCatalogCount = 19;
const audience = "urn:context-router:hosted-baseline-smoke";
const mcpScopes = [
  "preferences:read",
  "preferences:suggest",
  "preferences:write",
  "preferences:define",
  "offline_access",
];

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
  nowSeconds = Math.floor(Date.now() / 1000),
}) {
  const header = base64urlJson({ alg: "RS256", kid, typ: "JWT" });
  const payload = base64urlJson({
    iss: issuer,
    aud: tokenAudience,
    sub: subject,
    azp: clientId,
    scope: "preferences:read",
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
  now = Date.now,
  delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
}) {
  const startedAt = now();
  let lastFailure = "not attempted";
  while (now() - startedAt <= deadlineMs) {
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
      child.off?.("exit", onExit);
      resolve(false);
    }, timeoutMs);
    child.once?.("exit", onExit);
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
) {
  for (const address of addresses) {
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

async function createTlsFixture(repositoryRoot, secretDirectory, diagnosticsDirectory) {
  const caKey = path.join(secretDirectory, "ca.key");
  const caCertificate = path.join(secretDirectory, "ca.crt");
  const serverKey = path.join(secretDirectory, "server.key");
  const serverRequest = path.join(secretDirectory, "server.csr");
  const serverCertificate = path.join(secretDirectory, "server.crt");
  const extensions = path.join(secretDirectory, "server.ext");
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
    { cwd: repositoryRoot, timeoutMs: 30_000, logPath: path.join(diagnosticsDirectory, "openssl-ca.log") },
  );
  await runCommand(
    [
      "openssl", "req", "-newkey", "rsa:2048", "-nodes", "-sha256", "-subj", "/CN=127.0.0.1",
      "-keyout", serverKey, "-out", serverRequest,
    ],
    { cwd: repositoryRoot, timeoutMs: 30_000, logPath: path.join(diagnosticsDirectory, "openssl-server.log") },
  );
  await runCommand(
    [
      "openssl", "x509", "-req", "-in", serverRequest, "-CA", caCertificate, "-CAkey", caKey,
      "-CAcreateserial", "-days", "1", "-sha256", "-extfile", extensions, "-out", serverCertificate,
    ],
    { cwd: repositoryRoot, timeoutMs: 30_000, logPath: path.join(diagnosticsDirectory, "openssl-sign.log") },
  );
  const [key, certificate] = await Promise.all([readFile(serverKey), readFile(serverCertificate)]);
  for (const secretPath of [caKey, serverKey, serverRequest, serverCertificate, extensions, `${caCertificate}.srl`]) {
    await unlink(secretPath).catch(() => {});
  }
  await chmod(caCertificate, 0o600);
  return { caCertificate, key, certificate };
}

async function startJwksFixture({ key, certificate, signingPublicKey, kid }) {
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
      await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    },
  };
}

function minimalToolEnvironment(databaseUrl) {
  const allowed = [
    "PATH",
    "TMPDIR",
    "TMP",
    "TEMP",
    "LANG",
    "LC_ALL",
    "SHELL",
    "HOME",
    "XDG_CACHE_HOME",
    "PNPM_HOME",
    "COREPACK_HOME",
    "COREPACK_DEFAULT_TO_LATEST",
    "COREPACK_ENABLE_DOWNLOAD_PROMPT",
  ];
  const environment = Object.fromEntries(
    allowed.flatMap((key) => (process.env[key] === undefined ? [] : [[key, process.env[key]]])),
  );
  return {
    ...environment,
    CI: "1",
    NODE_ENV: "test",
    NEXT_TELEMETRY_DISABLED: "1",
    DATABASE_URL: databaseUrl,
  };
}

function backendEnvironment({ databaseUrl, appPort, jwksPort, caCertificate, clientIds, clientSecret }) {
  const allowed = ["PATH", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL"];
  const environment = Object.fromEntries(
    allowed.flatMap((key) => (process.env[key] === undefined ? [] : [[key, process.env[key]]])),
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
    AUTH0_DOMAIN: `127.0.0.1:${jwksPort}`,
    AUTH0_ISSUER: issuer,
    AUTH0_AUDIENCE: audience,
    AUTH0_CLIENT_ID: "hosted-baseline-smoke-app",
    AUTH0_CLIENT_SECRET: clientSecret,
    AUTH0_MANAGEMENT_API_AUDIENCE: `${issuer}api/v2/`,
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

async function fetchJson(url, options = {}, timeoutMs = 5_000) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`expected JSON from ${url}; status=${response.status}`);
  }
  return { status: response.status, headers: response.headers, body };
}

async function graphql(serverUrl, query, token) {
  const headers = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  return fetchJson(`${serverUrl}/graphql`, {
    method: "POST",
    headers,
    body: JSON.stringify({ query }),
  });
}

async function mcpPost(serverUrl, token, body) {
  return fetchJson(`${serverUrl}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
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

async function startBackend({ backendDirectory, environment, logPath, canaries }) {
  await mkdir(path.dirname(logPath), { recursive: true });
  const log = createWriteStream(logPath, { flags: "w", mode: 0o600 });
  const write = (source) => (chunk) => log.write(`[${source}] ${chunk}`);
  const stdout = createStreamingRedactor(write("stdout"), canaries);
  const stderr = createStreamingRedactor(write("stderr"), canaries);
  const child = spawn(process.execPath, ["dist/src/main.js"], {
    cwd: backendDirectory,
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const status = { exited: false, exitCode: null, signal: null };
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => stdout.write(chunk));
  child.stderr.on("data", (chunk) => stderr.write(chunk));
  const exitPromise = new Promise((resolve) => {
    child.once("error", (error) => {
      status.exited = true;
      status.error = error.message;
      resolve();
    });
    child.once("exit", (exitCode, signal) => {
      status.exited = true;
      status.exitCode = exitCode;
      status.signal = signal;
      resolve();
    });
  });
  return {
    child,
    status,
    exitPromise,
    finishLog: async () => {
      stdout.end();
      stderr.end();
      await new Promise((resolve) => log.end(resolve));
    },
  };
}

async function directCatalogSnapshot(repositoryRoot, databaseUrl) {
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
  );
  return assertCatalogState(
    rows.map((row) => ({ ...row, category: row.slug.split(".")[0] })),
  );
}

async function probeMcp({ repositoryRoot, serverUrl, token, contract, rawCatalog }) {
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
  });
  assert.equal(initialize.status, 200);
  assert.equal(initialize.body.result.protocolVersion, LATEST_PROTOCOL_VERSION);
  assert.deepEqual(initialize.body.result.capabilities, contract.server.capabilities);
  assert.deepEqual(initialize.body.result.serverInfo, contract.server.identity);
  assert.equal(initialize.body.result.instructions, contract.server.instructions);

  const tools = await mcpPost(serverUrl, token, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  assert.equal(tools.status, 200);
  const expectedTools = contract.tools
    .filter((item) => contract.visibility["claude-read-scope"].tools.includes(item.descriptor.name))
    .map((item) => item.descriptor);
  assert.deepEqual(normalizeDescriptorList(tools.body.result.tools), normalizeDescriptorList(expectedTools));

  const resources = await mcpPost(serverUrl, token, { jsonrpc: "2.0", id: 3, method: "resources/list", params: {} });
  assert.equal(resources.status, 200);
  assert.deepEqual(resources.body.result.resources, contract.resources.map((item) => item.descriptor));

  const resource = await mcpPost(serverUrl, token, {
    jsonrpc: "2.0", id: 4, method: "resources/read", params: { uri: "schema://graphql" },
  });
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
  });
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

async function probeGeneration({
  repositoryRoot,
  databaseUrl,
  backendDirectory,
  jwks,
  signingPrivateKey,
  kid,
  clientIds,
  clientSecret,
  caCertificate,
  rawCatalog,
  contract,
  generation,
  diagnosticsDirectory,
}) {
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
  const backend = await startBackend({
    backendDirectory,
    environment: backendEnvironment({
      databaseUrl,
      appPort,
      jwksPort: jwks.port,
      caCertificate,
      clientIds,
      clientSecret,
    }),
    logPath: path.join(diagnosticsDirectory, `backend-generation-${generation}.log`),
    canaries: [token, issuer.replace(/\/$/, ""), clientSecret],
  });
  let shutdown;
  try {
    await waitForReadiness({
      deadlineMs: 30_000,
      request: () => fetchJson(`${serverUrl}/health`),
      processStatus: () => backend.status,
    });
    const publicProbe = await graphql(serverUrl, "{ __typename }");
    assert.equal(publicProbe.status, 200);
    assert.deepEqual(publicProbe.body, { data: { __typename: "Query" } });

    const guardedProbe = await graphql(serverUrl, "{ preferenceCatalog { slug } }");
    assert.equal(guardedProbe.status, 200);
    assert.equal(guardedProbe.body.data?.preferenceCatalog ?? null, null);
    assert.equal(guardedProbe.body.errors?.[0]?.message, "Unauthorized");

    const principalProbe = await graphql(
      serverUrl,
      "query HostedBaselinePrincipal { me { userId email } }",
      token,
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
    const directCatalog = await directCatalogSnapshot(repositoryRoot, databaseUrl);
    assert.deepEqual(
      actualCatalog,
      directCatalog,
    );

    const getMcp = await fetchJson(`${serverUrl}/mcp`);
    assert.equal(getMcp.status, 405);
    assert.equal(getMcp.headers.get("allow"), "POST");
    assert.deepEqual(getMcp.body, { error: "Method Not Allowed" });

    const missingAuth = await mcpPost(serverUrl, null, {
      jsonrpc: "2.0", id: 0, method: "tools/list", params: {},
    });
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
      const response = await fetchJson(`${serverUrl}${route}`);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("access-control-allow-origin"), "*");
      assert.equal(response.headers.get("cache-control"), "public, max-age=3600");
      assert.deepEqual(response.body, expectedProtected);
    }
    for (const route of [
      "/.well-known/oauth-authorization-server",
      "/.well-known/oauth-authorization-server/mcp",
    ]) {
      const response = await fetchJson(`${serverUrl}${route}`);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("access-control-allow-origin"), "*");
      assert.equal(response.headers.get("cache-control"), "public, max-age=3600");
      assert.deepEqual(response.body, expectedAuthorization);
    }

    const allowedDcr = await fetchJson(`${serverUrl}/oauth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ redirect_uris: ["http://localhost:8081/callback"] }),
    });
    assert.equal(allowedDcr.status, 201);
    assert.deepEqual(allowedDcr.body, {
      client_id: clientIds.claude,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      redirect_uris: ["http://localhost:8081/callback"],
    });
    const deniedDcr = await fetchJson(`${serverUrl}/oauth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ redirect_uris: ["https://attacker.invalid/callback"] }),
    });
    assert.equal(deniedDcr.status, 400);
    assert.deepEqual(deniedDcr.body, contract.dcr.cases.invalid.body);

    await probeMcp({ repositoryRoot, serverUrl, token, contract, rawCatalog });
    const addresses = enumerateNonLoopbackAddresses();
    await assertNonLoopbackUnreachable(addresses, appPort);
    await assertNonLoopbackUnreachable(addresses, jwks.port);

    const principal = principalProbe.body.data.me;
    const principalRows = await queryDatabase(
      repositoryRoot,
      databaseUrl,
      "SELECT user_id FROM users WHERE email = $1",
      [`${clientIds.claude}@clients@m2m.local`],
    );
    assert.deepEqual(principalRows, [{ user_id: principal.userId }]);
    return { catalog: directCatalog, principalId: principal.userId, port: appPort };
  } finally {
    shutdown = await stopBackendProcess(backend.child).catch((error) => ({ error: error.message }));
    await backend.exitPromise;
    await backend.finishLog();
    await writeFile(
      path.join(diagnosticsDirectory, `shutdown-generation-${generation}.json`),
      `${JSON.stringify(shutdown, null, 2)}\n`,
      { mode: 0o600 },
    );
    if (shutdown?.error) throw new Error(shutdown.error);
  }
}

export async function runRestartSmoke({
  repositoryRoot = defaultRepositoryRoot,
  diagnosticsDirectory,
  environment = process.env,
} = {}) {
  const startedAt = Date.now();
  const requestedDiagnostics =
    diagnosticsDirectory ?? environment.MIGRATION_RESTART_SMOKE_DIAGNOSTICS_DIR;
  const ownsDiagnostics = !requestedDiagnostics;
  const diagnostics =
    requestedDiagnostics ??
    (await mkdtemp(path.join(os.tmpdir(), "context-router-restart-smoke-")));
  await mkdir(diagnostics, { recursive: true, mode: 0o700 });
  let success = false;
  try {
    const result = await withCleanupStack(async (defer) => {
      const administration = await prepareTestAdministration({
        repositoryRoot,
        diagnosticsDirectory: diagnostics,
        environment,
      });
      defer(administration.cleanup);
      const database = await createIsolatedTestDatabase(repositoryRoot, administration.administrationUrl);
      defer(() =>
        dropIsolatedTestDatabase(
          repositoryRoot,
          administration.administrationUrl,
          database.databaseName,
        ),
      );

      const toolEnvironment = minimalToolEnvironment(database.databaseUrl);
      await runCommand(["pnpm", "--filter", "backend", "prisma:generate"], {
        cwd: repositoryRoot,
        env: toolEnvironment,
        timeoutMs: 120_000,
        logPath: path.join(diagnostics, "prisma-generate.log"),
      });
      await runCommand(["pnpm", "--filter", "backend", "exec", "prisma", "migrate", "deploy"], {
        cwd: repositoryRoot,
        env: toolEnvironment,
        timeoutMs: 120_000,
        logPath: path.join(diagnostics, "migrations.log"),
      });
      for (const generation of [1, 2]) {
        await runCommand(["pnpm", "--filter", "backend", "exec", "ts-node", "prisma/seed-catalog-smoke.ts"], {
          cwd: repositoryRoot,
          env: toolEnvironment,
          timeoutMs: 120_000,
          logPath: path.join(diagnostics, `catalog-seed-${generation}.log`),
        });
      }
      const initialCatalog = await directCatalogSnapshot(repositoryRoot, database.databaseUrl);

      await runCommand(["pnpm", "--filter", "backend", "build"], {
        cwd: repositoryRoot,
        env: toolEnvironment,
        timeoutMs: 300_000,
        logPath: path.join(diagnostics, "backend-build.log"),
      });

      const secretDirectory = await mkdtemp(path.join(os.tmpdir(), "context-router-smoke-secrets-"));
      await chmod(secretDirectory, 0o700);
      defer(() => rm(secretDirectory, { recursive: true, force: true }));
      const tls = await createTlsFixture(repositoryRoot, secretDirectory, diagnostics);
      const signingKeys = generateKeyPairSync("rsa", { modulusLength: 2048 });
      const kid = randomBytes(12).toString("hex");
      const jwks = await startJwksFixture({
        key: tls.key,
        certificate: tls.certificate,
        signingPublicKey: signingKeys.publicKey,
        kid,
      });
      defer(jwks.close);
      const clientIds = {
        claude: `migration-smoke-${randomBytes(8).toString("hex")}`,
        codex: `migration-smoke-codex-${randomBytes(8).toString("hex")}`,
        fallback: `migration-smoke-fallback-${randomBytes(8).toString("hex")}`,
      };
      const clientSecret = `synthetic-${randomBytes(16).toString("hex")}`;
      const [rawCatalog, contract] = await Promise.all([
        readFile(path.join(repositoryRoot, "apps/backend/src/config/preferences.catalog.json"), "utf8").then(JSON.parse),
        readFile(path.join(repositoryRoot, "apps/backend/test/contracts/fixtures/mcp-contract-baseline.json"), "utf8").then(JSON.parse),
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
        clientSecret,
        caCertificate: tls.caCertificate,
        rawCatalog,
        contract,
        diagnosticsDirectory: diagnostics,
      };
      const first = await probeGeneration({ ...generationArguments, generation: 1 });
      const second = await probeGeneration({ ...generationArguments, generation: 2 });
      assertGenerationStatesEqual(first, second);
      assert.deepEqual(first.catalog, initialCatalog);
      const jwksHits = jwks.requests.filter(
        (request) => request.method === "GET" && request.url === "/.well-known/jwks.json",
      );
      assert.ok(jwksHits.length >= 4, `expected independent JWT/MCP JWKS fetches across generations; observed ${jwksHits.length}`);
      assert.deepEqual(jwks.requests, jwksHits);
      return {
        databaseName: database.databaseName,
        administrationSource: administration.source,
        generations: [
          { number: 1, port: first.port, principalStable: true, catalogCount: first.catalog.length },
          { number: 2, port: second.port, principalStable: true, catalogCount: second.catalog.length },
        ],
        jwksFetches: jwksHits.length,
        elapsedMs: Date.now() - startedAt,
      };
    });
    success = true;
    return result;
  } catch (error) {
    const message = redactSecrets(error?.stack ?? error?.message ?? error);
    await writeFile(path.join(diagnostics, "failure.log"), `${message}\n`, { mode: 0o600 });
    error.diagnosticsDirectory = diagnostics;
    throw error;
  } finally {
    if (success && ownsDiagnostics) await rm(diagnostics, { recursive: true, force: true });
  }
}

async function main() {
  try {
    const result = await runRestartSmoke();
    console.log(
      `restart-smoke: ok; generations=2 catalog=${result.generations[0].catalogCount} ` +
        `jwksFetches=${result.jwksFetches} elapsedMs=${result.elapsedMs}`,
    );
  } catch (error) {
    console.error(`restart-smoke: ${redactSecrets(error.message)}`);
    if (error.diagnosticsDirectory) console.error(`restart-smoke: sanitized diagnostics retained at ${error.diagnosticsDirectory}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
