#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import {
  createHash,
  generateKeyPairSync,
  randomBytes,
} from "node:crypto";
import { createWriteStream } from "node:fs";
import {
  access,
  chmod,
  cp,
  copyFile,
  lstat,
  mkdtemp,
  mkdir,
  open,
  readFile,
  readdir,
  readlink,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import http, { createServer } from "node:http";
import { createRequire } from "node:module";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import {
  assertCallerIntegrity,
  assertCompletedResourceLifecycle,
  buildIsolatedGateEnvironment,
  buildIsolatedGitEnvironment,
  captureCallerIntegrity,
  cloneCorepackCache,
  cloneDependencyTrees,
  combineFailures,
  copyWorkspaceFiles,
  createResourceLifecycleJournal,
  createSignalAbortController,
  createStreamingRedactor,
  hasLiveProcessGroupMembers,
  isLoopbackAddress,
  isProcessLive,
  prepareOwnedTemporaryDirectory,
  readPrivateRegularJson,
  redactSecrets,
  resourceLifecycleDynamicValues,
  runCommand,
  writeSanitizedResourceLifecycleJson,
  writeSanitizedJson,
} from "./gate-runner.mjs";
import { EXPECTED_PNPM_VERSION } from "../check-toolchain.mjs";
import {
  createIsolatedTestDatabase,
  dropIsolatedTestDatabase,
  prepareTestAdministration,
} from "./test-database.mjs";
import {
  assertCatalogState,
  createSignedTestToken,
  createTlsFixture,
  fetchJson,
  graphql,
  mcpPost,
  startJwksFixture,
} from "./restart-smoke.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultRepositoryRoot = path.resolve(scriptDirectory, "../..");
const execFileAsync = promisify(execFile);
const backendEntrypointRelative = "dist/main.js";
const expectedCatalogCount = 19;
const packagingAudience = "urn:context-router:packaging-smoke";
const aggregateGateWorkspaceMarkerRelativePath = path.join(
  ".git",
  "lmbg-workspace-owner.json",
);

export const BACKEND_DEPLOY_ARGV_PREFIX = Object.freeze([
  "pnpm",
  "--offline",
  "--filter",
  "backend",
  "deploy",
  "--prod",
]);
export const PACKAGED_SMOKE_PHASE_TIMEOUT_MS = 900_000;
export const PACKAGED_SMOKE_TERMINATION_GRACE_MS = 180_000;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function pathIsWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

function normalizedRelative(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative ? relative.split(path.sep).join("/") : ".";
}

function normalizedMode(info) {
  return info.mode & 0o777;
}

function validateAbsoluteDirectory(value, label) {
  if (!path.isAbsolute(value)) {
    throw new Error(`${label} must be an absolute path`);
  }
  return path.resolve(value);
}

export function buildBackendDeployArgv(stageBackendRoot) {
  return [
    ...BACKEND_DEPLOY_ARGV_PREFIX,
    validateAbsoluteDirectory(stageBackendRoot, "backend deploy target"),
  ];
}

export function buildPackagedNodeArgv(entrypoint) {
  return [
    "--no-global-search-paths",
    validateAbsoluteDirectory(entrypoint, "staged Node entrypoint"),
  ];
}

export const PACKAGING_CHILD_COMMAND_IDS = Object.freeze([
  "source-clone",
  "source-read-tree",
  "prisma-generate",
  "backend-build",
  "web-build",
  "backend-deploy",
  "database-migrate",
  "database-seed",
]);

export function approvedPackagingChildArgv(
  id,
  { repositoryRoot, sourceRoot, stageBackend } = {},
) {
  switch (id) {
    case "source-clone":
      return [
        "git",
        "-c",
        "core.hooksPath=/dev/null",
        "clone",
        "--quiet",
        "--no-local",
        "--no-hardlinks",
        "--no-checkout",
        validateAbsoluteDirectory(repositoryRoot, "source repository"),
        validateAbsoluteDirectory(sourceRoot, "disposable source root"),
      ];
    case "source-read-tree":
      return ["git", "read-tree", "HEAD"];
    case "prisma-generate":
      return ["pnpm", "--filter", "backend", "prisma:generate"];
    case "backend-build":
      return ["pnpm", "--filter", "backend", "build"];
    case "web-build":
      return ["pnpm", "--filter", "web", "build"];
    case "backend-deploy":
      return buildBackendDeployArgv(stageBackend);
    case "database-migrate":
      return [
        "pnpm",
        "--filter",
        "backend",
        "exec",
        "prisma",
        "migrate",
        "deploy",
      ];
    case "database-seed":
      return [
        "pnpm",
        "--filter",
        "backend",
        "exec",
        "ts-node",
        "prisma/seed-catalog-smoke.ts",
      ];
    default:
      throw new Error(`unapproved packaging child command id: ${id}`);
  }
}

export function assertApprovedPackagingChildCommand(id, argv, context) {
  const expected = approvedPackagingChildArgv(id, context);
  if (
    !Array.isArray(argv) ||
    argv.length !== expected.length ||
    argv.some((value, index) => value !== expected[index])
  ) {
    throw new Error(`packaging child command ${id} does not match its allowlist`);
  }
  return argv;
}

export function deriveStandaloneLayout({ repositoryRoot, webRoot, stageRoot }) {
  const repository = validateAbsoluteDirectory(repositoryRoot, "repository root");
  const web = validateAbsoluteDirectory(webRoot, "web root");
  const stage = validateAbsoluteDirectory(stageRoot, "stage root");
  const appRelativePath = normalizedRelative(repository, web);
  if (appRelativePath !== "apps/web") {
    throw new Error(
      `Next outputFileTracingRoot must derive apps/web, received ${appRelativePath}`,
    );
  }
  const stagedWebRoot = path.join(stage, "web");
  const stagedAppRoot = path.join(stagedWebRoot, ...appRelativePath.split("/"));
  return {
    appRelativePath,
    standaloneRoot: path.join(web, ".next", "standalone"),
    stagedWebRoot,
    stagedAppRoot,
    serverEntrypoint: path.join(stagedAppRoot, "server.js"),
  };
}

async function walkTree(root, { includeRoot = false } = {}) {
  const rootReal = await realpath(root);
  const rows = [];
  async function visit(absolute, relative) {
    const info = await lstat(absolute);
    const rowPath = relative || ".";
    if (info.isDirectory()) {
      if (relative || includeRoot) {
        rows.push({ path: rowPath, type: "directory", mode: normalizedMode(info) });
      }
      for (const name of (await readdir(absolute)).sort()) {
        await visit(path.join(absolute, name), relative ? `${relative}/${name}` : name);
      }
      return;
    }
    if (info.isFile()) {
      const content = await readFile(absolute);
      rows.push({
        path: rowPath,
        type: "file",
        mode: normalizedMode(info),
        size: info.size,
        sha256: sha256(content),
      });
      return;
    }
    if (info.isSymbolicLink()) {
      const target = await readlink(absolute);
      if (path.isAbsolute(target)) {
        throw new Error(`stage symlink escapes the stage: ${rowPath}`);
      }
      const lexicalTarget = path.resolve(path.dirname(absolute), target);
      if (!pathIsWithin(rootReal, lexicalTarget)) {
        throw new Error(`stage symlink escapes the stage: ${rowPath}`);
      }
      const resolved = await realpath(absolute).catch((error) => {
        if (error.code === "ENOENT") {
          throw new Error(`dangling stage symlink: ${rowPath}`);
        }
        if (error.code === "ELOOP") {
          throw new Error(`ambiguous stage symlink cycle: ${rowPath}`);
        }
        throw error;
      });
      if (!pathIsWithin(rootReal, resolved)) {
        throw new Error(`stage symlink escapes the stage: ${rowPath}`);
      }
      rows.push({
        path: rowPath,
        type: "symlink",
        mode: normalizedMode(info),
        target: normalizedRelative(path.dirname(absolute), lexicalTarget),
      });
      return;
    }
    throw new Error(`unsupported staged entry type: ${rowPath}`);
  }
  await visit(rootReal, "");
  return rows.sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );
}

export async function assertNoSharedRegularFiles(
  stageRoot,
  referenceRoots,
  { signal } = {},
) {
  const stage = await realpath(stageRoot);
  const suspicious = new Map();
  async function collectStage(directory) {
    for (const name of await readdir(directory)) {
      if (signal?.aborted) throw signal.reason ?? new Error("hardlink audit aborted");
      const candidate = path.join(directory, name);
      const info = await lstat(candidate);
      if (info.isDirectory()) await collectStage(candidate);
      else if (info.isFile() && info.nlink > 1) {
        suspicious.set(`${info.dev}:${info.ino}`, normalizedRelative(stage, candidate));
      }
    }
  }
  await collectStage(stage);
  if (!suspicious.size) return;

  async function inspectReference(directory) {
    for (const name of await readdir(directory)) {
      if (signal?.aborted) throw signal.reason ?? new Error("hardlink audit aborted");
      const candidate = path.join(directory, name);
      const info = await lstat(candidate);
      if (info.isDirectory()) await inspectReference(candidate);
      else if (info.isFile()) {
        const stagedPath = suspicious.get(`${info.dev}:${info.ino}`);
        if (stagedPath) {
          throw new Error(
            `staged regular file ${stagedPath} is a hardlink to mutable source/store content`,
          );
        }
      }
    }
  }
  for (const root of referenceRoots) {
    const reference = await realpath(root).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (reference) await inspectReference(reference);
  }
}

export async function assertNoStageAncestorNodeModules(
  stageBackend,
  privateRoot,
) {
  const canonicalStageBackend = await realpath(stageBackend);
  const canonicalPrivateRoot = await realpath(privateRoot);
  let current = path.dirname(canonicalStageBackend);
  let foundPrivateRoot = false;
  while (true) {
    const candidate = path.join(current, "node_modules");
    const info = await lstat(candidate).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    assert.equal(info, null, `stage ancestor owns node_modules: ${current}`);
    if (current === canonicalPrivateRoot) foundPrivateRoot = true;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  assert.equal(foundPrivateRoot, true, "private root must be a stage ancestor");
}

async function sealPayloadDirectory(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const candidate = path.join(directory, entry.name);
    const info = await lstat(candidate);
    if (info.isDirectory()) {
      await sealPayloadDirectory(candidate);
      await chmod(candidate, 0o555);
    } else if (info.isFile()) {
      await chmod(candidate, 0o444);
    } else if (!info.isSymbolicLink()) {
      throw new Error(`unsupported staged entry type: ${candidate}`);
    }
  }
}

async function atomicWriteReadonlyJson(filePath, value) {
  const temporary = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.tmp-${process.pid}-${randomBytes(8).toString("hex")}`,
  );
  let handle;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    await chmod(temporary, 0o444);
    await rename(temporary, filePath);
  } finally {
    await handle?.close().catch(() => {});
    await rm(temporary, { force: true }).catch(() => {});
  }
}

async function finalStageSnapshot(stageRoot) {
  const rows = await walkTree(stageRoot, { includeRoot: true });
  return {
    rows,
    sha256: sha256(JSON.stringify(rows)),
  };
}

export async function sealAndDescribeStage(stageRoot, metadata) {
  const stage = validateAbsoluteDirectory(stageRoot, "stage root");
  const manifestPath = path.join(stage, "manifest.json");
  const existingManifest = await lstat(manifestPath).catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (existingManifest) throw new Error("stage manifest already exists");
  for (const required of ["backend", "web"]) {
    const info = await lstat(path.join(stage, required)).catch(() => null);
    if (!info?.isDirectory() || info.isSymbolicLink()) {
      throw new Error(`staged ${required} payload must be a real directory`);
    }
  }

  // Validate the complete unsealed payload before changing its modes.
  await walkTree(stage);
  for (const required of ["backend", "web"]) {
    const directory = path.join(stage, required);
    await sealPayloadDirectory(directory);
    await chmod(directory, 0o555);
  }
  const inventory = (await walkTree(stage)).filter(
    ({ path: entry }) => entry !== "manifest.json",
  );
  const manifest = {
    ...metadata,
    inventoryExcludes: ["manifest.json"],
    inventory,
  };
  await atomicWriteReadonlyJson(manifestPath, manifest);
  await chmod(stage, 0o555);

  const manifestContent = await readFile(manifestPath);
  const finalTree = await finalStageSnapshot(stage);
  return {
    manifest,
    manifestSha256: sha256(manifestContent),
    stageTreeSha256: finalTree.sha256,
  };
}

export async function verifySealedStage(stageRoot, expected) {
  const stage = validateAbsoluteDirectory(stageRoot, "stage root");
  const manifestContent = await readFile(path.join(stage, "manifest.json"));
  const actual = {
    manifest: JSON.parse(manifestContent.toString("utf8")),
    manifestSha256: sha256(manifestContent),
    stageTreeSha256: (await finalStageSnapshot(stage)).sha256,
  };
  if (
    actual.manifestSha256 !== expected.manifestSha256 ||
    actual.stageTreeSha256 !== expected.stageTreeSha256 ||
    JSON.stringify(actual.manifest) !== JSON.stringify(expected.manifest)
  ) {
    throw new Error("stage integrity changed after sealing");
  }
  return expected;
}

function assertLoopbackOrigin(raw, label) {
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`${label} must be an HTTP loopback origin`);
  }
  if (
    parsed.protocol !== "http:" ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash ||
    !isLoopbackAddress(parsed.hostname)
  ) {
    throw new Error(`${label} must be an HTTP loopback origin`);
  }
  return parsed.origin;
}

export function buildPackagedRuntimeEnvironment(
  sourceEnvironment,
  {
    home,
    temp,
    proxyOrigin,
    webOrigin,
    databaseUrl,
    auth,
    explicitMcpResource = false,
    explicitMcpAllowedOrigins = false,
    port = 0,
  },
) {
  const homeRoot = validateAbsoluteDirectory(home, "runtime HOME");
  const tempRoot = validateAbsoluteDirectory(temp, "runtime temp root");
  const proxy = assertLoopbackOrigin(proxyOrigin, "proxy origin");
  const web = assertLoopbackOrigin(webOrigin, "web origin");
  for (const key of [
    "domain",
    "issuer",
    "audience",
    "clientId",
    "clientSecret",
    "sessionSecret",
    "caCertificate",
  ]) {
    if (typeof auth?.[key] !== "string" || !auth[key]) {
      throw new Error(`synthetic auth ${key} is required`);
    }
  }
  const passThrough = ["PATH", "LANG", "LC_ALL"];
  const environment = Object.fromEntries(
    passThrough.flatMap((key) =>
      sourceEnvironment[key] === undefined ? [] : [[key, sourceEnvironment[key]]],
    ),
  );
  Object.assign(environment, {
    NODE_ENV: "production",
    HOME: homeRoot,
    TMPDIR: tempRoot,
    TMP: tempRoot,
    TEMP: tempRoot,
    XDG_CONFIG_HOME: path.join(homeRoot, ".config"),
    XDG_CACHE_HOME: path.join(homeRoot, ".cache"),
    XDG_DATA_HOME: path.join(homeRoot, ".local", "share"),
    XDG_STATE_HOME: path.join(homeRoot, ".local", "state"),
    NEXT_TELEMETRY_DISABLED: "1",
    PRISMA_HIDE_UPDATE_MESSAGE: "1",
    COREPACK_DEFAULT_TO_LATEST: "0",
    COREPACK_ENABLE_DOWNLOAD_PROMPT: "0",
    COREPACK_ENABLE_NETWORK: "0",
    DO_NOT_TRACK: "1",
    NO_COLOR: "1",
    PORT: String(port),
    APP_HOST: "127.0.0.1",
    APP_BASE_URL: web,
    CORS_ORIGIN: web,
    MCP_SERVER_URL: proxy,
    MCP_HTTP_ENABLED: "true",
    MCP_HTTP_REQUIRE_AUTH: "true",
    MCP_STDIO_ENABLED: "false",
    MCP_TOOLS_PREFERENCES_ENABLED: "true",
    MCP_RESOURCES_SCHEMA_ENABLED: "true",
    DATABASE_URL: databaseUrl,
    AUTH0_DOMAIN: auth.domain,
    AUTH0_ISSUER: auth.issuer,
    AUTH0_AUDIENCE: auth.audience,
    AUTH0_CLIENT_ID: auth.clientId,
    AUTH0_CLIENT_SECRET: auth.clientSecret,
    AUTH0_SECRET: auth.sessionSecret,
    AUTH0_MCP_CLAUDE_CLIENT_ID: auth.clientId,
    AUTH0_MCP_CODEX_CLIENT_ID: `${auth.clientId}-codex`,
    AUTH0_MCP_FALLBACK_CLIENT_ID: `${auth.clientId}-fallback`,
    AUTH0_MCP_PUBLIC_CLIENT_ID: `${auth.clientId}-fallback`,
    GRAPHQL_PLAYGROUND: "false",
    GRAPHQL_DEBUG: "false",
    GCP_PROJECT_ID: "packaging-smoke-deny-provider",
    GOOGLE_CLOUD_PROJECT: "packaging-smoke-deny-provider",
    VERTEX_REGION: "us-central1",
    VERTEX_MODEL_ID: "packaging-smoke-no-live-model",
    METADATA_SERVER_DETECTION: "none",
    DOC_UPLOAD_MAX_BYTES: "10485760",
    DOC_UPLOAD_MAX_SUGGESTIONS: "25",
    NODE_EXTRA_CA_CERTS: validateAbsoluteDirectory(
      auth.caCertificate,
      "synthetic CA certificate",
    ),
  });
  if (explicitMcpResource) environment.MCP_RESOURCE = `${proxy}/mcp`;
  if (explicitMcpAllowedOrigins) environment.MCP_HTTP_ALLOWED_ORIGINS = web;
  return environment;
}

export function parseBackendReadinessLine(line) {
  let value;
  try {
    value = JSON.parse(String(line));
  } catch {
    return null;
  }
  if (value?.type !== "context-router.backend.ready") return null;
  if (
    value.version !== 1 ||
    !isLoopbackAddress(value.address) ||
    !Number.isInteger(value.port) ||
    value.port < 1 ||
    value.port > 65_535
  ) {
    throw new Error("backend readiness record must name a valid loopback address and port");
  }
  return { address: value.address, port: value.port };
}

async function closeServer(server, sockets) {
  for (const socket of sockets) socket.destroy();
  if (!server.listening) return;
  let timer;
  try {
    await Promise.race([
      new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("loopback server cleanup timed out")),
          5_000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function trackOwnedSocket(sockets, socket) {
  sockets.add(socket);
  socket.once("close", () => sockets.delete(socket));
  // Owned listeners can observe an expected reset when a probe or a staged
  // generation closes. Always consume the transport-level socket error; the
  // request-level owner remains responsible for the observable outcome.
  socket.on("error", () => {});
}

export async function createStableLoopbackProxy() {
  let target = null;
  const sockets = new Set();
  const upstreamSockets = new Set();
  const upstreamRequests = new Set();
  const server = createServer((request, response) => {
    if (!target) {
      response.statusCode = 503;
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ error: "Backend unavailable" }));
      return;
    }
    if (!request.url?.startsWith("/") || request.url.startsWith("//")) {
      response.statusCode = 400;
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ error: "Invalid proxy request target" }));
      return;
    }
    const targetUrl = new URL(target);
    const upstreamUrl = new URL(request.url, targetUrl);
    if (upstreamUrl.origin !== targetUrl.origin) {
      response.statusCode = 400;
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ error: "Invalid proxy request target" }));
      return;
    }
    const upstream = http.request(
      upstreamUrl,
      {
        method: request.method,
        headers: { ...request.headers, host: new URL(target).host },
      },
      (upstreamResponse) => {
        upstreamResponse.once("error", () => response.destroy());
        response.writeHead(
          upstreamResponse.statusCode ?? 502,
          upstreamResponse.headers,
        );
        upstreamResponse.pipe(response);
      },
    );
    upstreamRequests.add(upstream);
    upstream.once("close", () => upstreamRequests.delete(upstream));
    upstream.on("socket", (socket) => {
      trackOwnedSocket(upstreamSockets, socket);
    });
    upstream.once("error", () => {
      if (response.headersSent) response.destroy();
      else {
        response.statusCode = 502;
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ error: "Backend unavailable" }));
      }
    });
    request.pipe(upstream);
    request.once("error", () => upstream.destroy());
    response.once("error", () => upstream.destroy());
  });
  server.on("connection", (socket) => {
    trackOwnedSocket(sockets, socket);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return {
    origin: `http://127.0.0.1:${address.port}`,
    port: address.port,
    setTarget(origin) {
      target = assertLoopbackOrigin(origin, "proxy target");
    },
    clearTarget() {
      target = null;
    },
    async close() {
      target = null;
      for (const request of upstreamRequests) request.destroy();
      for (const socket of upstreamSockets) socket.destroy();
      await closeServer(server, sockets);
    },
  };
}

export function enumerateNonLoopbackProbeTargets(
  interfaces = os.networkInterfaces(),
) {
  const targets = [];
  for (const [interfaceName, entries] of Object.entries(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.internal || isLoopbackAddress(entry.address)) continue;
      const family =
        entry.family === "IPv6" || entry.family === 6
          ? 6
          : entry.family === "IPv4" || entry.family === 4
            ? 4
            : net.isIP(String(entry.address).split("%")[0]);
      if (!family) {
        throw new Error(`unprobeable network address on ${interfaceName}`);
      }
      targets.push({
        interface: interfaceName,
        address: entry.address,
        family,
        scopeid: entry.scopeid ?? null,
      });
    }
  }
  targets.sort((left, right) =>
    `${left.interface}\0${left.family}\0${left.address}`.localeCompare(
      `${right.interface}\0${right.family}\0${right.address}`,
    ),
  );
  if (!targets.length) {
    throw new Error("no non-loopback addresses were available for isolation evidence");
  }
  return targets;
}

export function classifyNegativeProbe({ connected = false, timedOut = false, errorCode } = {}) {
  if (connected) return "reachable";
  if (timedOut) return "inconclusive";
  if (
    new Set([
      "ECONNREFUSED",
      "EHOSTUNREACH",
      "ENETUNREACH",
      "ENETDOWN",
      "EHOSTDOWN",
      "EADDRNOTAVAIL",
    ]).has(errorCode)
  ) {
    return "unreachable";
  }
  return "inconclusive";
}

export function formatNetworkProbeHost(target) {
  if (
    target.family === 6 &&
    !String(target.address).includes("%") &&
    String(target.address).toLowerCase().startsWith("fe80:")
  ) {
    return `${target.address}%${target.interface}`;
  }
  return target.address;
}

function canaryRepresentations(canary) {
  const value = String(canary);
  return [...new Set([
    value,
    encodeURIComponent(value),
    Buffer.from(value).toString("base64"),
    Buffer.from(value).toString("base64url"),
  ])].filter(Boolean);
}

export function assertNoCanaryLeak(values, canaries) {
  const combined = values.map((value) => String(value ?? "")).join("\n");
  for (const canary of canaries) {
    for (const representation of canaryRepresentations(canary)) {
      if (combined.includes(representation)) {
        throw new Error("sanitized evidence contains a canary representation");
      }
    }
  }
}

export function createSanitizedPackagingError(error, canaries) {
  const sanitized = new Error(
    redactSecrets(error?.message ?? error, expandedCanaries(canaries)),
  );
  sanitized.exitCode = error?.exitCode ?? 1;
  return sanitized;
}

export function assertCompletedLifecycle(state) {
  return assertCompletedResourceLifecycle(state);
}

function throwIfAborted(signal, message = "packaging smoke aborted") {
  if (signal?.aborted) throw signal.reason ?? new Error(message);
}

async function gitOutput(
  repositoryRoot,
  args,
  { encoding = "utf8", signal, environment } = {},
) {
  throwIfAborted(signal);
  const result = await execFileAsync("git", args, {
    cwd: repositoryRoot,
    encoding,
    maxBuffer: 64 * 1024 * 1024,
    signal,
    env: environment,
  });
  return result.stdout;
}

async function listPresentWorkspaceFiles(
  repositoryRoot,
  signal,
  environment,
) {
  const [presentBuffer, deletedBuffer] = await Promise.all([
    gitOutput(
      repositoryRoot,
      ["ls-files", "-co", "--exclude-standard", "-z"],
      { encoding: "buffer", signal, environment },
    ),
    gitOutput(repositoryRoot, ["ls-files", "--deleted", "-z"], {
      encoding: "buffer",
      signal,
      environment,
    }),
  ]);
  const deleted = new Set(
    deletedBuffer.toString("utf8").split("\0").filter(Boolean),
  );
  return presentBuffer
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .filter((entry) => !deleted.has(entry))
    .filter((entry) => {
      const parts = entry.split("/");
      return !parts.some((part) => part === ".git" || part === "node_modules");
    });
}

async function callerStatus(repositoryRoot, signal, environment) {
  return gitOutput(
    repositoryRoot,
    ["status", "--porcelain=v2", "-z", "--untracked-files=all"],
    { encoding: "buffer", signal, environment },
  );
}

async function readObservedPnpmStore(repositoryRoot) {
  const modules = await readFile(
    path.join(repositoryRoot, "node_modules", ".modules.yaml"),
    "utf8",
  );
  const store = modules.match(/^storeDir:\s*(.+)$/m)?.[1]?.trim();
  if (!store || !path.isAbsolute(store)) {
    throw new Error("installed pnpm metadata must identify an absolute offline store");
  }
  const info = await stat(store);
  if (!info.isDirectory()) throw new Error("observed pnpm store is not a directory");
  return await realpath(store);
}

async function collectPackagingProtectedRoots(repositoryRoot, storeRoot) {
  const candidates = [
    repositoryRoot,
    storeRoot,
    path.join(repositoryRoot, "node_modules"),
    path.join(repositoryRoot, "apps/backend/node_modules"),
    path.join(repositoryRoot, "apps/web/node_modules"),
    path.join(repositoryRoot, "apps/local-orchestrator/node_modules"),
  ];
  const roots = [];
  for (const candidate of candidates) {
    const info = await lstat(candidate).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (!info) continue;
    roots.push(await realpath(candidate));
  }
  return [...new Set(roots)];
}

async function assertGeneratedPathOutsideProtectedRoots(
  candidate,
  protectedRoots,
  label,
) {
  for (const protectedRoot of protectedRoots) {
    const canonicalProtected = await realpath(protectedRoot);
    if (pathIsWithin(canonicalProtected, candidate)) {
      throw new Error(
        `${label} must be outside repository, dependency, and store roots`,
      );
    }
  }
}

async function makeTreeWritable(candidate) {
  const info = await lstat(candidate).catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!info || info.isSymbolicLink()) return;
  if (info.isDirectory()) {
    await chmod(candidate, 0o700).catch(() => {});
    for (const name of await readdir(candidate).catch(() => [])) {
      await makeTreeWritable(path.join(candidate, name));
    }
  } else if (info.isFile()) {
    await chmod(candidate, 0o600).catch(() => {});
  }
}

async function removeOwnedTree(directory) {
  if (!directory) return;
  await makeTreeWritable(directory);
  await rm(directory, { recursive: true, force: true });
}

async function removeFreshDirectoryAllocation(directory, identity) {
  const info = await lstat(directory).catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!info) return;
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    info.dev !== identity.dev ||
    info.ino !== identity.ino
  ) {
    throw new Error("fresh directory allocation changed identity before rollback");
  }
  await removeOwnedTree(directory);
}

export async function preparePackagingDiagnosticsDirectory(
  requestedPath,
  {
    protectedRoots = [],
    setPrivateMode = (directory) => chmod(directory, 0o700),
    writeMarker = writeSanitizedJson,
  } = {},
) {
  let directory;
  const removeOnSuccess = !requestedPath;
  if (requestedPath) {
    if (!path.isAbsolute(requestedPath)) {
      throw new Error("packaging diagnostics path must be absolute");
    }
    const existing = await lstat(requestedPath).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (existing) {
      throw new Error(
        "packaging diagnostics path must be a new directory owned by this run",
      );
    }
    const requestedParent = await realpath(path.dirname(requestedPath));
    const canonicalRequested = path.join(
      requestedParent,
      path.basename(requestedPath),
    );
    await assertGeneratedPathOutsideProtectedRoots(
      canonicalRequested,
      protectedRoots,
      "packaging diagnostics path",
    );
    await mkdir(canonicalRequested, { mode: 0o700 });
    directory = canonicalRequested;
  } else {
    const temporaryRoot = await realpath(os.tmpdir());
    const prefix = path.join(
      temporaryRoot,
      "context-router-packaging-diagnostics-",
    );
    await assertGeneratedPathOutsideProtectedRoots(
      prefix,
      protectedRoots,
      "packaging diagnostics root",
    );
    directory = await mkdtemp(prefix);
  }
  const allocated = await lstat(directory);
  const allocationIdentity = { dev: allocated.dev, ino: allocated.ino };
  try {
    await setPrivateMode(directory);
    const directoryReal = await realpath(directory);
    const nonce = randomBytes(24).toString("hex");
    const markerPath = path.join(directoryReal, ".packaging-smoke-owner.json");
    await writeMarker(markerPath, {
      schemaVersion: 1,
      directory: directoryReal,
      nonce,
    });
    return {
      directory: directoryReal,
      markerPath,
      nonce,
      removeOnSuccess,
    };
  } catch (error) {
    const rollbackErrors = [];
    try {
      await removeFreshDirectoryAllocation(directory, allocationIdentity);
    } catch (rollbackError) {
      rollbackErrors.push(rollbackError);
    }
    throw combineFailures(error, rollbackErrors, "packaging diagnostics allocation");
  }
}

export async function createPackagingPrivateRoot(
  prefix,
  onPrivateRoot,
  { protectedRoots = [] } = {},
) {
  const canonicalParent = await realpath(path.dirname(prefix));
  const canonicalPrefix = path.join(canonicalParent, path.basename(prefix));
  await assertGeneratedPathOutsideProtectedRoots(
    canonicalPrefix,
    protectedRoots,
    "packaging private root",
  );
  const nonce = randomBytes(24).toString("hex");
  const directory = await mkdtemp(canonicalPrefix);
  const allocatedDirectory = path.resolve(directory);
  const allocated = await lstat(allocatedDirectory);
  const allocationIdentity = { dev: allocated.dev, ino: allocated.ino };
  const markerPath = path.join(
    allocatedDirectory,
    ".packaging-private-root-owner.json",
  );
  const ownership = {
    directory: allocatedDirectory,
    markerPath,
    nonce,
  };
  try {
    // Persist the exact recovery identity before any further filesystem work can
    // fail. The marker is intentionally written only after this handoff.
    await onPrivateRoot(ownership);
    await chmod(directory, 0o700);
    const canonicalDirectory = await realpath(directory);
    if (canonicalDirectory !== allocatedDirectory) {
      throw new Error("packaging private root changed identity after allocation");
    }
    await assertGeneratedPathOutsideProtectedRoots(
      canonicalDirectory,
      protectedRoots,
      "packaging private root",
    );
    await writeSanitizedJson(markerPath, {
      schemaVersion: 1,
      directory: canonicalDirectory,
      nonce,
    });
    return ownership;
  } catch (error) {
    const rollbackErrors = [];
    try {
      await removeFreshDirectoryAllocation(
        allocatedDirectory,
        allocationIdentity,
      );
    } catch (rollbackError) {
      rollbackErrors.push(rollbackError);
    }
    const combined = combineFailures(
      error,
      rollbackErrors,
      "packaging private-root allocation",
    );
    if (!rollbackErrors.length) {
      combined.allocationRolledBack = true;
      combined.ownership = ownership;
    }
    throw combined;
  }
}

export async function assertPackagingPrivateRootOwnership(ownership) {
  if (!ownership?.directory || !ownership.markerPath || !ownership.nonce) {
    throw new Error("packaging private-root ownership is incomplete");
  }
  const [directoryInfo, markerInfo] = await Promise.all([
    lstat(ownership.directory),
    lstat(ownership.markerPath),
  ]);
  if (
    !directoryInfo.isDirectory() ||
    directoryInfo.isSymbolicLink() ||
    !markerInfo.isFile() ||
    markerInfo.isSymbolicLink() ||
    (await realpath(ownership.directory)) !== ownership.directory
  ) {
    throw new Error("packaging private-root ownership path is invalid");
  }
  const marker = JSON.parse(await readFile(ownership.markerPath, "utf8"));
  if (
    marker.schemaVersion !== 1 ||
    marker.directory !== ownership.directory ||
    marker.nonce !== ownership.nonce
  ) {
    throw new Error("packaging private-root ownership marker did not verify");
  }
  return ownership.directory;
}

export async function assertPackagingDiagnosticsOwnership(ownership) {
  const directoryInfo = await lstat(ownership.directory);
  if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) {
    throw new Error("packaging diagnostics ownership directory is invalid");
  }
  if ((await realpath(ownership.directory)) !== ownership.directory) {
    throw new Error("packaging diagnostics ownership directory changed identity");
  }
  const markerInfo = await lstat(ownership.markerPath);
  if (!markerInfo.isFile() || markerInfo.isSymbolicLink()) {
    throw new Error("packaging diagnostics ownership marker is invalid");
  }
  const marker = JSON.parse(await readFile(ownership.markerPath, "utf8"));
  if (
    marker.schemaVersion !== 1 ||
    marker.directory !== ownership.directory ||
    marker.nonce !== ownership.nonce
  ) {
    throw new Error("packaging diagnostics ownership marker did not verify");
  }
  return ownership.directory;
}

async function ensurePrivateTree(root) {
  const rootReal = await realpath(root);
  async function visit(candidate) {
    const info = await lstat(candidate);
    if (info.isSymbolicLink()) {
      throw new Error(`mutable private tree contains a symlink: ${candidate}`);
    }
    if (info.isDirectory()) {
      await chmod(candidate, 0o700);
      for (const name of await readdir(candidate)) await visit(path.join(candidate, name));
      return;
    }
    if (info.isFile()) {
      await chmod(candidate, 0o600);
      return;
    }
    throw new Error(`mutable private tree contains an unsupported entry: ${candidate}`);
  }
  await visit(rootReal);
}

async function assertPrivateTree(root) {
  if (process.platform === "win32") return;
  async function visit(candidate) {
    const info = await lstat(candidate);
    if (info.isDirectory()) {
      assert.equal(info.mode & 0o777, 0o700, `${candidate} must use mode 0700`);
      for (const name of await readdir(candidate)) await visit(path.join(candidate, name));
    } else if (info.isFile()) {
      assert.equal(info.mode & 0o777, 0o600, `${candidate} must use mode 0600`);
    } else if (!info.isSymbolicLink()) {
      throw new Error(`unsupported private entry: ${candidate}`);
    }
  }
  await visit(root);
}

export async function verifyGateWorkspaceOwnership(repositoryRoot, environment) {
  const values = [
    environment.MIGRATION_PACKAGING_GATE_WORKSPACE,
    environment.MIGRATION_PACKAGING_GATE_OWNERSHIP_MARKER,
    environment.MIGRATION_PACKAGING_GATE_OWNERSHIP_FILE,
    environment.MIGRATION_PACKAGING_COREPACK_HOME,
  ];
  if (values.every((value) => value === undefined)) return null;
  if (values.some((value) => typeof value !== "string" || !value)) {
    throw new Error("aggregate-gate packaging ownership variables must be supplied together");
  }
  const [workspace, marker, markerPath, corepackHome] = values;
  if (!/^[a-f0-9]{48}$/.test(marker)) {
    throw new Error("aggregate-gate packaging ownership marker is invalid");
  }
  const workspaceReal = await realpath(workspace);
  if (workspaceReal !== (await realpath(repositoryRoot))) {
    throw new Error("aggregate-gate packaging workspace does not match the launch workspace");
  }
  if (!path.isAbsolute(markerPath) || !path.isAbsolute(corepackHome)) {
    throw new Error("aggregate-gate packaging ownership paths must be absolute");
  }
  let record;
  let canonicalMarkerPath;
  try {
    [{ value: record }, canonicalMarkerPath] = await Promise.all([
      readPrivateRegularJson(markerPath),
      realpath(markerPath),
    ]);
  } catch {
    throw new Error(
      "aggregate-gate packaging ownership file must be a private regular JSON file",
    );
  }
  const expectedWorkspaceMarkerPath = path.join(
    workspaceReal,
    aggregateGateWorkspaceMarkerRelativePath,
  );
  if (
    canonicalMarkerPath !== markerPath ||
    !record ||
    typeof record !== "object" ||
    Array.isArray(record) ||
    record.schemaVersion !== 1 ||
    record.ownershipMarker !== marker ||
    record.workspace !== workspaceReal ||
    record.ownershipMarkerPath !== markerPath ||
    record.workspaceMarkerPath !== expectedWorkspaceMarkerPath ||
    typeof record.device !== "string" ||
    !record.device ||
    typeof record.inode !== "string" ||
    !record.inode
  ) {
    throw new Error("aggregate-gate packaging ownership record did not verify");
  }
  let workspaceInfo;
  let canonicalWorkspaceMarker;
  let workspaceMarker;
  try {
    [
      workspaceInfo,
      canonicalWorkspaceMarker,
      { value: workspaceMarker },
    ] = await Promise.all([
      lstat(workspaceReal),
      realpath(expectedWorkspaceMarkerPath),
      readPrivateRegularJson(expectedWorkspaceMarkerPath),
    ]);
  } catch {
    throw new Error("aggregate-gate packaging workspace ownership did not verify");
  }
  if (
    !workspaceInfo.isDirectory() ||
    workspaceInfo.isSymbolicLink() ||
    String(workspaceInfo.dev) !== record.device ||
    String(workspaceInfo.ino) !== record.inode ||
    canonicalWorkspaceMarker !== expectedWorkspaceMarkerPath ||
    !workspaceMarker ||
    typeof workspaceMarker !== "object" ||
    Array.isArray(workspaceMarker) ||
    workspaceMarker.schemaVersion !== 1 ||
    workspaceMarker.workspace !== workspaceReal ||
    workspaceMarker.ownershipMarker !== marker ||
    workspaceMarker.device !== record.device ||
    workspaceMarker.inode !== record.inode
  ) {
    throw new Error("aggregate-gate packaging workspace ownership did not verify");
  }
  const corepackReal = await realpath(corepackHome);
  if (!(await stat(corepackReal)).isDirectory()) {
    throw new Error("aggregate-gate Corepack home is not a directory");
  }
  return { workspace: workspaceReal, marker, markerPath, corepackHome: corepackReal };
}

export function directCallerIntegrityPaths({
  repositoryRoot,
  presentFiles,
  storeRoot,
  sourceCorepack,
}) {
  return [...new Set([
    ...presentFiles.map((entry) => path.join(repositoryRoot, entry)),
    path.join(repositoryRoot, "node_modules"),
    path.join(repositoryRoot, "apps/backend/node_modules"),
    path.join(repositoryRoot, "apps/web/node_modules"),
    path.join(repositoryRoot, "apps/local-orchestrator/node_modules"),
    path.join(repositoryRoot, "apps/backend/dist"),
    path.join(repositoryRoot, "apps/web/.next"),
    path.join(repositoryRoot, "apps/backend/src/generated/prisma"),
    path.join(repositoryRoot, "apps/web/lib/generated"),
    storeRoot,
    sourceCorepack,
  ])];
}

async function prepareExecutionContext({
  repositoryRoot,
  environment,
  diagnostics,
  signal,
  onPrivateRoot = () => {},
  protectedRoots = [],
}) {
  const gate = await verifyGateWorkspaceOwnership(repositoryRoot, environment);
  const storeRoot = await readObservedPnpmStore(repositoryRoot);
  if (gate) {
    const privateRootOwnership = await createPackagingPrivateRoot(
      path.join(diagnostics, `owned-${gate.marker.slice(0, 12)}-`),
      onPrivateRoot,
      { protectedRoots },
    );
    const privateRoot = privateRootOwnership.directory;
    return {
      mode: "aggregate-gate",
      sourceRoot: gate.workspace,
      privateRoot,
      privateRootOwnership,
      corepackHome: gate.corepackHome,
      storeRoot,
      callerStatusBefore: null,
      callerIntegrity: await captureCallerIntegrity([
        path.join(gate.workspace, "node_modules"),
        path.join(gate.workspace, "apps/backend/node_modules"),
        path.join(gate.workspace, "apps/web/node_modules"),
        path.join(gate.workspace, "apps/local-orchestrator/node_modules"),
        gate.corepackHome,
        storeRoot,
      ]),
    };
  }

  const privateRootOwnership = await createPackagingPrivateRoot(
    path.join(os.tmpdir(), "context-router-packaging-smoke-"),
    onPrivateRoot,
    { protectedRoots },
  );
  const privateRoot = privateRootOwnership.directory;
  const gitHome = path.join(privateRoot, "git-home");
  await mkdir(gitHome, { recursive: true, mode: 0o700 });
  const gitEnvironment = buildIsolatedGitEnvironment(environment, gitHome);
  const presentFiles = await listPresentWorkspaceFiles(
    repositoryRoot,
    signal,
    gitEnvironment,
  );
  const callerStatusBefore = await callerStatus(
    repositoryRoot,
    signal,
    gitEnvironment,
  );
  const sourceCorepack =
    environment.COREPACK_HOME ??
    path.join(
      environment.XDG_CACHE_HOME ?? path.join(environment.HOME ?? os.homedir(), ".cache"),
      "node",
      "corepack",
    );
  const callerIntegrity = await captureCallerIntegrity(
    directCallerIntegrityPaths({
      repositoryRoot,
      presentFiles,
      storeRoot,
      sourceCorepack,
    }),
    { signal },
  );
  const sourceRoot = path.join(privateRoot, "source");
  await runCommand(
    assertApprovedPackagingChildCommand(
      "source-clone",
      approvedPackagingChildArgv("source-clone", {
        repositoryRoot,
        sourceRoot,
      }),
      { repositoryRoot, sourceRoot },
    ),
    {
      cwd: privateRoot,
      env: gitEnvironment,
      timeoutMs: 120_000,
      logPath: path.join(diagnostics, "source-clone.log"),
      signal,
    },
  );
  await runCommand(assertApprovedPackagingChildCommand(
    "source-read-tree",
    ["git", "read-tree", "HEAD"],
  ), {
    cwd: sourceRoot,
    env: gitEnvironment,
    timeoutMs: 30_000,
    logPath: path.join(diagnostics, "source-read-tree.log"),
    signal,
  });
  await copyWorkspaceFiles(
    repositoryRoot,
    sourceRoot,
    presentFiles,
    { signal },
  );
  await cloneDependencyTrees(
    repositoryRoot,
    sourceRoot,
    ["", "apps/backend", "apps/web", "apps/local-orchestrator"],
    { signal },
  );
  const corepackHome = path.join(privateRoot, "corepack");
  await cloneCorepackCache(sourceCorepack, corepackHome, {
    signal,
    requiredPnpmVersion: EXPECTED_PNPM_VERSION,
  });
  return {
    mode: "direct",
    sourceRoot,
    privateRoot,
    privateRootOwnership,
    corepackHome,
    storeRoot,
    callerStatusBefore,
    callerIntegrity,
    gitEnvironment,
  };
}

export function strictToolEnvironment(
  sourceEnvironment,
  { home, corepackHome, storeRoot, databaseUrl, proxyOrigin },
) {
  const environment = buildIsolatedGateEnvironment(
    sourceEnvironment,
    home,
    corepackHome,
  );
  return {
    ...environment,
    NODE_ENV: "production",
    DATABASE_URL:
      databaseUrl ??
      "postgresql://packaging-smoke:packaging-smoke@127.0.0.1:1/context_router_packaging_test",
    npm_config_offline: "true",
    npm_config_package_import_method: "copy",
    npm_config_store_dir: storeRoot,
    NEXT_PUBLIC_BACKEND_URL: proxyOrigin,
    NEXT_PUBLIC_GRAPHQL_URL: `${proxyOrigin}/graphql`,
  };
}

async function sha256File(filePath) {
  return sha256(await readFile(filePath));
}

async function assertRegularFile(filePath, label) {
  const info = await lstat(filePath).catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!info?.isFile() || info.isSymbolicLink()) {
    throw new Error(`${label} must be a regular file`);
  }
  return info;
}

async function findFiles(root, predicate) {
  const results = [];
  async function visit(directory) {
    for (const name of (await readdir(directory)).sort()) {
      const candidate = path.join(directory, name);
      const info = await lstat(candidate);
      if (info.isDirectory()) await visit(candidate);
      else if (info.isFile() && predicate(candidate)) results.push(candidate);
    }
  }
  await visit(root);
  return results;
}

async function assertBuiltPublicUrls(staticRoot, proxyOrigin) {
  const files = await findFiles(staticRoot, () => true);
  let foundProxy = false;
  for (const file of files) {
    const bytes = await readFile(file);
    if (bytes.includes(Buffer.from(proxyOrigin))) foundProxy = true;
    if (
      bytes.includes(Buffer.from("http://localhost:3000")) ||
      bytes.includes(Buffer.from("http://127.0.0.1:3000"))
    ) {
      throw new Error("staged web bundle retained the default/dead backend endpoint");
    }
  }
  if (!foundProxy) throw new Error("staged web bundle omitted the stable proxy origin");
}

async function readPackageVersion(packageRoot) {
  const manifest = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
  return manifest.version ?? null;
}

async function packageManifestFromResolved(resolvedPath, expectedName) {
  let current = path.dirname(resolvedPath);
  while (true) {
    const candidate = path.join(current, "package.json");
    const content = await readFile(candidate, "utf8").catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (content) {
      const manifest = JSON.parse(content);
      if (manifest.name === expectedName) return { path: candidate, manifest };
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new Error(`could not locate package manifest for ${expectedName}`);
}

export async function assertPackageResolutionWithinRoot(
  stageRoot,
  resolvedPath,
  manifestPath,
  packageName,
) {
  const [stageReal, resolvedReal, manifestReal] = await Promise.all([
    realpath(stageRoot),
    realpath(resolvedPath),
    realpath(manifestPath),
  ]);
  if (
    !pathIsWithin(stageReal, resolvedReal) ||
    !pathIsWithin(stageReal, manifestReal)
  ) {
    throw new Error(
      `staged dependency ${packageName} escaped the staged web closure`,
    );
  }
  return { resolved: resolvedReal, manifest: manifestReal };
}

async function collectNativeEvidence(
  sourceRoot,
  stageBackend,
  webEntrypoint,
  stagedWebRoot,
) {
  const sourceRequire = createRequire(path.join(sourceRoot, "apps/web/package.json"));
  const backendRequire = createRequire(path.join(stageBackend, "package.json"));
  const webRequire = createRequire(webEntrypoint);
  const sourceNextRequire = createRequire(sourceRequire.resolve("next/package.json"));
  const closure = {};
  const stageBackendReal = await realpath(stageBackend);
  const backendManifest = JSON.parse(
    await readFile(path.join(stageBackend, "package.json"), "utf8"),
  );
  if (
    backendManifest.dependencies?.auth0 !== undefined ||
    backendManifest.optionalDependencies?.auth0 !== undefined ||
    backendManifest.peerDependencies?.auth0 !== undefined
  ) {
    throw new Error("staged backend manifest retained the Auth0 server SDK");
  }
  try {
    backendRequire.resolve("auth0");
    throw new Error("staged backend unexpectedly resolved the Auth0 server SDK");
  } catch (error) {
    if (error?.code !== "MODULE_NOT_FOUND") throw error;
  }
  for (const packageName of ["@google-cloud/vertexai", "@prisma/client", "pg"]) {
    const resolved = await realpath(backendRequire.resolve(packageName));
    if (!pathIsWithin(stageBackendReal, resolved)) {
      throw new Error(`backend dependency ${packageName} escaped the staged closure`);
    }
    if (packageName !== "@prisma/client") backendRequire(packageName);
    const packageManifest = await packageManifestFromResolved(resolved, packageName);
    closure[packageName] = packageManifest.manifest.version;
  }
  backendRequire(path.join(stageBackend, "dist/app.module.js"));

  const swcPackages = [
    "@next/swc-darwin-arm64",
    "@next/swc-darwin-x64",
    "@next/swc-linux-arm64-gnu",
    "@next/swc-linux-arm64-musl",
    "@next/swc-linux-x64-gnu",
    "@next/swc-linux-x64-musl",
    "@next/swc-win32-arm64-msvc",
    "@next/swc-win32-x64-msvc",
  ];
  const loadedSwc = [];
  for (const packageName of swcPackages) {
    try {
      const resolved = sourceNextRequire.resolve(packageName);
      sourceNextRequire(packageName);
      const packageManifest = await packageManifestFromResolved(resolved, packageName);
      loadedSwc.push({
        package: packageName,
        version: packageManifest.manifest.version,
      });
    } catch {
      // Packages for other targets are expected in a cross-platform lockfile.
    }
  }
  if (!loadedSwc.length) {
    throw new Error("no target-native Next SWC package loaded after the production build");
  }

  let sharp;
  try {
    let sharpRequire = webRequire;
    try {
      sharpRequire.resolve("sharp");
    } catch {
      sharpRequire = createRequire(webRequire.resolve("next/package.json"));
    }
    const resolved = sharpRequire.resolve("sharp");
    const packageManifest = await packageManifestFromResolved(resolved, "sharp");
    await assertPackageResolutionWithinRoot(
      stagedWebRoot,
      resolved,
      packageManifest.path,
      "sharp",
    );
    const sharpModule = sharpRequire("sharp");
    sharp = {
      version: packageManifest.manifest.version,
      vips: sharpModule.versions?.vips ?? null,
    };
  } catch (error) {
    throw new Error(`staged target-native sharp package failed to load: ${error.message}`);
  }
  const auth0Resolved = webRequire.resolve("@auth0/nextjs-auth0/server");
  const auth0Manifest = await packageManifestFromResolved(
    auth0Resolved,
    "@auth0/nextjs-auth0",
  );
  await assertPackageResolutionWithinRoot(
    stagedWebRoot,
    auth0Resolved,
    auth0Manifest.path,
    "@auth0/nextjs-auth0",
  );
  return {
    backendDependencyClosure: closure,
    webDependencyClosure: {
      "@auth0/nextjs-auth0": auth0Manifest.manifest.version,
    },
    swc: loadedSwc,
    sharp,
  };
}

async function assembleAndSealStage({
  sourceRoot,
  privateRoot,
  diagnostics,
  environment,
  toolEnvironment,
  proxyOrigin,
  storeRoot,
  signal,
}) {
  const stageRoot = path.join(privateRoot, "stage");
  const stageBackend = path.join(stageRoot, "backend");
  await mkdir(stageRoot, { recursive: true, mode: 0o700 });
  await chmod(stageRoot, 0o700);
  await runCommand(assertApprovedPackagingChildCommand(
    "backend-deploy",
    buildBackendDeployArgv(stageBackend),
    { stageBackend },
  ), {
    cwd: sourceRoot,
    env: toolEnvironment,
    timeoutMs: 180_000,
    logPath: path.join(diagnostics, "backend-deploy.log"),
    signal,
  });
  assert.deepEqual((await readdir(stageBackend)).sort(), [
    "dist",
    "node_modules",
    "package.json",
    "pnpm-lock.yaml",
  ]);

  const layout = deriveStandaloneLayout({
    repositoryRoot: sourceRoot,
    webRoot: path.join(sourceRoot, "apps/web"),
    stageRoot,
  });
  await cp(layout.standaloneRoot, layout.stagedWebRoot, {
    recursive: true,
    dereference: false,
    verbatimSymlinks: true,
  });
  const sourceStatic = path.join(sourceRoot, "apps/web/.next/static");
  const stagedStatic = path.join(layout.stagedAppRoot, ".next/static");
  await mkdir(path.dirname(stagedStatic), { recursive: true });
  await cp(sourceStatic, stagedStatic, {
    recursive: true,
    dereference: false,
    verbatimSymlinks: true,
  });
  const sourcePublic = path.join(sourceRoot, "apps/web/public");
  const publicInfo = await lstat(sourcePublic).catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (publicInfo) {
    if (!publicInfo.isDirectory() || publicInfo.isSymbolicLink()) {
      throw new Error("apps/web/public must be a real directory when present");
    }
    await cp(sourcePublic, path.join(layout.stagedAppRoot, "public"), {
      recursive: true,
      dereference: false,
      verbatimSymlinks: true,
    });
  }
  await assertRegularFile(
    path.join(stageBackend, backendEntrypointRelative),
    "staged backend entrypoint",
  );
  await assertRegularFile(layout.serverEntrypoint, "staged web entrypoint");
  await assertRegularFile(
    path.join(stageBackend, "dist/config/preferences.catalog.json"),
    "staged preference catalog",
  );
  await assertNoSharedRegularFiles(stageRoot, [sourceRoot, storeRoot], { signal });
  await assertBuiltPublicUrls(stagedStatic, proxyOrigin);
  const stagedWebPackages = [];
  for (const manifestPath of await findFiles(
    layout.stagedWebRoot,
    (candidate) => path.basename(candidate) === "package.json",
  )) {
    let manifest;
    try {
      manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    } catch {
      continue;
    }
    if (
      manifest &&
      (manifest.name === "next" ||
        manifest.name === "@auth0/nextjs-auth0" ||
        manifest.name === "sharp" ||
        manifest.name?.startsWith("@next/swc-") ||
        manifest.name?.startsWith("@img/"))
    ) {
      stagedWebPackages.push({
        name: manifest.name,
        version: manifest.version ?? null,
        path: normalizedRelative(layout.stagedWebRoot, manifestPath),
      });
    }
  }
  await writeSanitizedJson(
    path.join(diagnostics, "staged-native-package-inventory.json"),
    stagedWebPackages,
  );
  const native = await collectNativeEvidence(
    sourceRoot,
    stageBackend,
    layout.serverEntrypoint,
    layout.stagedWebRoot,
  );
  const sourceSchemaPath = path.join(sourceRoot, "apps/backend/src/schema.gql");
  const sourceCatalogPath = path.join(
    sourceRoot,
    "apps/backend/src/config/preferences.catalog.json",
  );
  const stagedCatalogPath = path.join(
    stageBackend,
    "dist/config/preferences.catalog.json",
  );
  const sourceCatalogHash = await sha256File(sourceCatalogPath);
  assert.equal(await sha256File(stagedCatalogPath), sourceCatalogHash);
  const libc =
    process.platform === "linux"
      ? process.report?.getReport?.().header?.glibcVersionRuntime ?? "unknown"
      : null;
  const sealed = await sealAndDescribeStage(stageRoot, {
    schemaVersion: 1,
    proof: "hosted-artifact-feasibility",
    platform: process.platform,
    architecture: process.arch,
    libc,
    node: process.version,
    pnpm: EXPECTED_PNPM_VERSION,
    appRelativePath: layout.appRelativePath,
    backendEntrypoint: `backend/${backendEntrypointRelative}`,
    webEntrypoint: normalizedRelative(stageRoot, layout.serverEntrypoint),
    publicPresent: Boolean(publicInfo),
    buildTimePublicUrls: {
      backend: proxyOrigin,
      graphql: `${proxyOrigin}/graphql`,
    },
    schemaSha256: await sha256File(sourceSchemaPath),
    catalogSha256: sourceCatalogHash,
    native,
  });
  await writeSanitizedJson(
    path.join(diagnostics, "stage-integrity.json"),
    {
      manifestSha256: sealed.manifestSha256,
      stageTreeSha256: sealed.stageTreeSha256,
    },
  );
  return { stageRoot, stageBackend, layout, sealed, native };
}

function expandedCanaries(canaries) {
  return [...new Set(canaries.flatMap((canary) => canaryRepresentations(canary)))];
}

function signalProcessTree(child, signalName) {
  if (process.platform !== "win32" && child.pid) {
    try {
      process.kill(-child.pid, signalName);
      return true;
    } catch (error) {
      if (error.code === "ESRCH") return false;
      throw error;
    }
  }
  return child.kill(signalName);
}

async function waitForProcessGroupExit(pid, timeoutMs) {
  if (process.platform === "win32" || !pid) return;
  const deadline = Date.now() + timeoutMs;
  while (await hasLiveProcessGroupMembers(pid)) {
    if (Date.now() >= deadline) {
      throw new Error(`owned process group ${pid} did not settle`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

export async function waitWithTimeout(promise, timeoutMs, message, signal) {
  throwIfAborted(signal, message);
  let timer;
  let abort;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  const aborted = signal
    ? new Promise((_, reject) => {
        abort = () => reject(signal.reason ?? new Error("operation aborted"));
        signal.addEventListener("abort", abort, { once: true });
      })
    : new Promise(() => {});
  try {
    return await Promise.race([promise, timeout, aborted]);
  } finally {
    clearTimeout(timer);
    if (abort) signal.removeEventListener("abort", abort);
  }
}

export async function requireTcpConnection({
  host,
  port,
  timeoutMs = 2_000,
  signal,
  connect,
}) {
  throwIfAborted(signal, "TCP connection probe aborted");
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer;
    let socket;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      socket?.destroy();
      if (error) reject(error);
      else resolve();
    };
    const abort = () =>
      finish(
        signal.reason instanceof Error
          ? signal.reason
          : new Error("TCP connection probe aborted"),
      );
    try {
      socket = connect ? connect({ host, port }) : net.connect({ host, port });
      socket.once("connect", () => finish());
      socket.once("error", finish);
      timer = setTimeout(
        () => finish(new Error(`TCP connection probe timed out for ${host}:${port}`)),
        timeoutMs,
      );
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
    } catch (error) {
      finish(error);
    }
  });
}

export async function startManagedChild({
  name,
  entrypoint,
  cwd,
  environment,
  diagnostics,
  canaries,
  readinessParser,
  signal,
}) {
  throwIfAborted(signal);
  const logPath = path.join(diagnostics, `${name}.log`);
  await mkdir(path.dirname(logPath), { recursive: true, mode: 0o700 });
  const log = createWriteStream(logPath, { flags: "w", mode: 0o600 });
  let logFailure;
  log.on("error", (error) => {
    logFailure ??= error;
  });
  const redactionCanaries = expandedCanaries(canaries);
  const tail = [];
  const append = (source) => (value) => {
    const tagged = `[${source}] ${value}`;
    tail.push(tagged.slice(-16_384));
    while (tail.join("").length > 32_768 && tail.length > 1) tail.shift();
    if (!log.destroyed && !logFailure) log.write(tagged);
  };
  const stdout = createStreamingRedactor(append("stdout"), redactionCanaries);
  const stderr = createStreamingRedactor(append("stderr"), redactionCanaries);
  const child = spawn(process.execPath, buildPackagedNodeArgv(entrypoint), {
    cwd,
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });
  const status = {
    pid: child.pid,
    exited: false,
    exitCode: null,
    signal: null,
    error: null,
    abortSignalError: null,
  };
  let lineBuffer = "";
  let resolveReady;
  let rejectReady;
  const readyPromise = readinessParser
    ? new Promise((resolve, reject) => {
        resolveReady = resolve;
        rejectReady = reject;
      })
    : null;
  // Observe rejection at construction time. Callers may need to persist the
  // PID before awaiting readiness, and a fast child exit must not become an
  // unhandled rejection during that journal write.
  readyPromise?.catch(() => {});
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout.write(chunk);
    if (!readinessParser) return;
    lineBuffer += chunk;
    const lines = lineBuffer.split(/\r?\n/);
    lineBuffer = lines.pop() ?? "";
    for (const line of lines) {
      try {
        const ready = readinessParser(line);
        if (ready) {
          resolveReady?.(ready);
          resolveReady = null;
          rejectReady = null;
        }
      } catch (error) {
        rejectReady?.(error);
        resolveReady = null;
        rejectReady = null;
      }
    }
  });
  child.stderr.on("data", (chunk) => stderr.write(chunk));
  const closePromise = new Promise((resolve) => {
    child.once("error", (error) => {
      status.exited = true;
      status.error = error.message;
      rejectReady?.(error);
      resolve(status);
    });
    child.once("close", (exitCode, childSignal) => {
      status.exited = true;
      status.exitCode = exitCode;
      status.signal = childSignal;
      rejectReady?.(
        new Error(
          `${name} exited before readiness (${exitCode ?? childSignal ?? "unknown"})`,
        ),
      );
      resolve(status);
    });
  });
  const abort = () => {
    try {
      signalProcessTree(child, "SIGTERM");
    } catch (error) {
      status.abortSignalError ??= error;
    }
  };
  signal?.addEventListener("abort", abort, { once: true });
  let logFinished = false;
  async function finishLog() {
    if (logFinished) return;
    logFinished = true;
    signal?.removeEventListener("abort", abort);
    stdout.end();
    stderr.end();
    await new Promise((resolve) => {
      if (log.destroyed) return resolve();
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        logFailure ??= new Error(`${name} log close timed out`);
        log.destroy();
        finish();
      }, 2_000);
      log.once("finish", finish);
      log.once("close", finish);
      log.end();
    });
    if (logFailure) throw logFailure;
  }
  return {
    name,
    child,
    status,
    readyPromise,
    closePromise,
    outputTail: () => tail.join(""),
    finishLog,
  };
}

export async function stopManagedChild(
  managed,
  signalName,
  { timeoutMs = 20_000, requireRunning = true } = {},
) {
  const alreadyExited = managed.status.exited;
  const errors = [];
  let escalated = false;
  let signalDelivered = false;
  try {
    signalDelivered = signalProcessTree(managed.child, signalName);
  } catch (error) {
    errors.push(error);
  }
  if (!managed.status.exited) {
    try {
      await waitWithTimeout(
        managed.closePromise,
        timeoutMs,
        `${managed.name} did not stop after ${signalName}`,
      );
    } catch (error) {
      errors.push(error);
    }
  }
  try {
    await waitForProcessGroupExit(managed.child.pid, timeoutMs);
  } catch (error) {
    escalated = true;
    errors.push(error);
    try {
      signalProcessTree(managed.child, "SIGKILL");
      await waitForProcessGroupExit(managed.child.pid, 2_000);
      if (!managed.status.exited) {
        await waitWithTimeout(
          managed.closePromise,
          2_000,
          `${managed.name} did not settle after SIGKILL`,
        );
      }
    } catch (killError) {
      errors.push(killError);
    }
  }
  try {
    await managed.finishLog();
  } catch (error) {
    errors.push(error);
  }
  if (managed.status.abortSignalError) errors.push(managed.status.abortSignalError);
  if (requireRunning && alreadyExited) {
    errors.push(new Error(`${managed.name} exited before shutdown was requested`));
  }
  if (requireRunning && !alreadyExited && !signalDelivered) {
    errors.push(
      new Error(`${managed.name} exited before ${signalName} could be delivered`),
    );
  }
  const signalNumber = os.constants.signals[signalName];
  const exitedForRequestedSignal =
    managed.status.signal === signalName ||
    (process.platform !== "win32" &&
      signalDelivered &&
      Number.isInteger(signalNumber) &&
      managed.status.exitCode === 128 + signalNumber);
  if (
    requireRunning &&
    !alreadyExited &&
    signalDelivered &&
    managed.status.exitCode !== 0 &&
    !exitedForRequestedSignal
  ) {
    errors.push(
      new Error(
        `${managed.name} exited unexpectedly (${managed.status.exitCode ?? managed.status.signal ?? managed.status.error ?? "unknown"})`,
      ),
    );
  }
  if (managed.status.error) {
    errors.push(new Error(`${managed.name} process error: ${managed.status.error}`));
  }
  if (escalated) {
    errors.push(new Error(`${managed.name} required SIGKILL escalation`));
  }
  const combined = combineFailures(null, errors, `${managed.name} shutdown`);
  if (combined) throw combined;
  return { exitCode: managed.status.exitCode, signal: managed.status.signal };
}

async function findFreeLoopbackPort() {
  const server = net.createServer();
  const sockets = new Set();
  server.on("connection", (socket) => trackOwnedSocket(sockets, socket));
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const port = address.port;
  await closeServer(server, sockets);
  return port;
}

async function waitForWebReady(managed, origin, signal) {
  const deadline = Date.now() + 30_000;
  let lastError;
  while (Date.now() < deadline) {
    throwIfAborted(signal);
    if (managed.status.exited) {
      throw new Error(
        `${managed.name} exited before readiness: ${redactSecrets(managed.outputTail())}`,
      );
    }
    try {
      const response = await fetch(`${origin}/`, {
        redirect: "manual",
        signal: AbortSignal.timeout(2_000),
      });
      if (response.status >= 200 && response.status < 400) {
        console.log(
          JSON.stringify({
            type: "context-router.web.ready",
            version: 1,
            address: "127.0.0.1",
            port: Number(new URL(origin).port),
          }),
        );
        return;
      }
      lastError = new Error(`web readiness returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`web readiness timed out: ${lastError?.message ?? "unknown"}`);
}

function isAddressInUseFailure(error, managed) {
  return /(?:\bEADDRINUSE\b|address already in use)/i.test(
    `${error?.message ?? error}\n${managed?.outputTail?.() ?? ""}`,
  );
}

export async function startWebWithAddressRetry({
  maxAttempts = 3,
  allocatePort,
  start,
  waitReady,
  stop,
  beginAttempt = async () => null,
  recordStarted = async () => {},
  recordStopped = async () => {},
}) {
  if (!Number.isInteger(maxAttempts) || maxAttempts <= 0) {
    throw new Error("web address retry count must be positive");
  }
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const port = await allocatePort();
    let attemptContext;
    let started;
    let registeredManaged;
    let readinessAttempted = false;
    const registerManaged = (managed) => {
      registeredManaged ??= managed;
      return managed;
    };
    try {
      attemptContext = await beginAttempt({ port, attempt });
      started = await start({
        port,
        attempt,
        attemptContext,
        registerManaged,
      });
      if (started?.managed) registerManaged(started.managed);
      await recordStarted({ started, attemptContext, port, attempt });
      readinessAttempted = true;
      await waitReady(started);
      return { ...started, port, attempts: attempt, attemptContext };
    } catch (error) {
      const cleanupErrors = [];
      const managed = started?.managed ?? registeredManaged;
      const recordedStart = started ?? (managed ? { managed } : undefined);
      if (managed) {
        try {
          await stop(managed, {
            started: recordedStart,
            attemptContext,
            port,
            attempt,
          });
        } catch (stopError) {
          cleanupErrors.push(stopError);
        }
      }
      try {
        await recordStopped({
          started: recordedStart,
          attemptContext,
          port,
          attempt,
          error,
          cleanupErrors,
        });
      } catch (recordError) {
        cleanupErrors.push(recordError);
      }
      const combined = combineFailures(error, cleanupErrors, "web address retry");
      if (
        !cleanupErrors.length &&
        attempt < maxAttempts &&
        readinessAttempted &&
        managed &&
        isAddressInUseFailure(error, managed)
      ) {
        continue;
      }
      throw combined;
    }
  }
  throw new Error("web address retry exhausted without a result");
}

export function createWebAttemptLifecycleHooks({ generation, journal }) {
  const webId = `web-generation-${generation}`;
  return {
    async beginAttempt({ port, attempt }) {
      const id = `${webId}-attempt-${attempt}`;
      await journal.acquiring({
        id,
        type: "staged-web-process",
        owned: true,
        identity: { generation, attempt, address: "127.0.0.1", port },
        recovery: `Verify the recorded PID belongs to ${id}, then signal only its owned process group.`,
      });
      return { id };
    },
    async recordStarted({ started, attemptContext, port, attempt }) {
      await journal.acquired(attemptContext.id, {
        identity: { pid: started.managed.child.pid, port, attempt },
      });
    },
    async recordStopped({ started, attemptContext, cleanupErrors }) {
      if (!attemptContext?.id) return;
      const resource = journal.state.resources.find(
        (item) => item.id === attemptContext.id,
      );
      if (resource?.status === "acquiring") {
        await journal.acquired(attemptContext.id, {
          identity: { pid: started?.managed?.child.pid ?? null },
        });
      }
      await journal.cleanupFinished(attemptContext.id, {
        status: cleanupErrors.length
          ? "failed"
          : started?.managed
            ? "exited"
            : "not-owned",
        error: cleanupErrors[0],
      });
    },
  };
}

async function negativeConnectProbe(
  target,
  port,
  { timeoutMs = 1_000, signal } = {},
) {
  throwIfAborted(signal, "listener isolation probe aborted");
  return new Promise((resolve, reject) => {
    const socket = net.connect({
      host: formatNetworkProbeHost(target),
      port,
      family: target.family,
    });
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", abort);
      socket.destroy();
      resolve(result);
    };
    const abort = () => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", abort);
      socket.destroy();
      reject(
        signal.reason instanceof Error
          ? signal.reason
          : new Error("listener isolation probe aborted"),
      );
    };
    socket.setTimeout(timeoutMs, () => finish({ timedOut: true }));
    socket.once("connect", () => finish({ connected: true }));
    socket.once("error", (error) => finish({ errorCode: error.code }));
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
}

function assignUniqueLsofField(row, field, value) {
  if (row[field] !== undefined && row[field] !== value) {
    throw new Error(`ambiguous lsof ${field} field`);
  }
  row[field] = value;
}

export function parseDarwinLsofListenerRows(output) {
  const text = Buffer.isBuffer(output) ? output.toString("utf8") : String(output);
  if (!text.includes("\0")) {
    throw new Error("lsof listener output is not NUL-delimited");
  }
  const rows = [];
  let processId;
  let row;
  const finishRow = () => {
    if (!row) return;
    for (const field of ["pid", "fd", "protocol", "endpoint", "state"]) {
      if (row[field] === undefined || row[field] === "") {
        throw new Error(`lsof listener row is missing ${field}`);
      }
    }
    rows.push(row);
    row = undefined;
  };
  for (const rawField of text.split("\0")) {
    const field = rawField.replace(/^[\r\n]+|[\r\n]+$/g, "");
    if (!field) continue;
    const code = field[0];
    const value = field.slice(1);
    if (code === "p") {
      finishRow();
      if (!/^[1-9][0-9]*$/.test(value)) {
        throw new Error("lsof listener process id is malformed");
      }
      processId = Number(value);
      continue;
    }
    if (code === "f") {
      finishRow();
      if (!processId || !value) {
        throw new Error("lsof listener file row lacks process identity");
      }
      row = { pid: processId, fd: value };
      continue;
    }
    if (!row) throw new Error(`lsof listener field ${code} lacks a file row`);
    if (code === "P") assignUniqueLsofField(row, "protocol", value);
    else if (code === "n") assignUniqueLsofField(row, "endpoint", value);
    else if (code === "T") {
      const separator = value.indexOf("=");
      if (separator <= 0) throw new Error("lsof listener TCP field is malformed");
      if (value.slice(0, separator) === "ST") {
        assignUniqueLsofField(row, "state", value.slice(separator + 1));
      }
    } else {
      throw new Error(`unexpected lsof listener field ${code}`);
    }
  }
  finishRow();
  if (!rows.length) throw new Error("lsof listener output contains no file rows");
  return rows;
}

function parseLsofEndpoint(endpoint) {
  let address;
  let portText;
  if (endpoint.startsWith("[")) {
    const match = /^\[([^\]]+)]:(\d+)$/.exec(endpoint);
    if (!match) throw new Error("lsof listener endpoint is malformed");
    [, address, portText] = match;
  } else {
    const separator = endpoint.lastIndexOf(":");
    if (separator <= 0) throw new Error("lsof listener endpoint is malformed");
    address = endpoint.slice(0, separator);
    portText = endpoint.slice(separator + 1);
  }
  if (!/^[0-9]+$/.test(portText)) {
    throw new Error("lsof listener port is not numeric");
  }
  const port = Number(portText);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("lsof listener port is outside the TCP range");
  }
  return { address, port };
}

const executeDarwinLsof = (executable, args, options) =>
  execFileAsync(executable, args, options);

export async function collectDarwinListenerEvidence(
  listener,
  { execute = executeDarwinLsof, signal } = {},
) {
  if (listener.address !== "127.0.0.1") {
    throw new Error(
      `${listener.name} listener address must be exactly 127.0.0.1`,
    );
  }
  if (!Number.isInteger(listener.pid) || listener.pid <= 0) {
    throw new Error(`${listener.name} has no valid owned listener PID`);
  }
  const executable = "/usr/sbin/lsof";
  const args = [
    "-nP",
    "-a",
    "-p",
    String(listener.pid),
    `-iTCP:${listener.port}`,
    "-sTCP:LISTEN",
    "-F0pfnPT",
  ];
  let result;
  try {
    result = await execute(executable, args, {
      encoding: "utf8",
      env: {
        PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
        LANG: "C",
        LC_ALL: "C",
      },
      timeout: 5_000,
      maxBuffer: 64 * 1024,
      signal,
    });
  } catch (error) {
    throw new Error(`${listener.name} native listener inspection failed`, {
      cause: error,
    });
  }
  if (String(result.stderr ?? "").trim()) {
    throw new Error(`${listener.name} native listener inspection wrote stderr`);
  }
  const expectedEndpoint = `127.0.0.1:${listener.port}`;
  const evidence = parseDarwinLsofListenerRows(result.stdout).map((row) => {
    const endpoint = parseLsofEndpoint(row.endpoint);
    if (
      row.pid !== listener.pid ||
      endpoint.port !== listener.port ||
      row.protocol !== "TCP" ||
      row.state !== "LISTEN"
    ) {
      throw new Error(`${listener.name} native listener row did not match ownership`);
    }
    return {
      method: "darwin-lsof-listener-table",
      tool: executable,
      listener: listener.name,
      pid: row.pid,
      fd: row.fd,
      protocol: row.protocol,
      address: endpoint.address,
      port: endpoint.port,
      state: row.state,
      classification: "loopback-only",
    };
  });
  const endpoints = new Set(
    evidence.map((row) => `${row.address}:${row.port}`),
  );
  if (endpoints.size !== 1 || !endpoints.has(expectedEndpoint)) {
    throw new Error(
      `${listener.name} native listener endpoint set is not exactly ${expectedEndpoint}`,
    );
  }
  return evidence;
}

export async function collectListenerIsolationEvidence(
  listeners,
  {
    platform = process.platform,
    collectDarwin = collectDarwinListenerEvidence,
    enumerateTargets = enumerateNonLoopbackProbeTargets,
    probe = negativeConnectProbe,
    signal,
  } = {},
) {
  const evidence = [];
  const failures = [];
  for (const listener of listeners) {
    if (listener.address !== "127.0.0.1") {
      throw new Error(
        `${listener.name} listener address must be exactly 127.0.0.1`,
      );
    }
  }
  if (platform === "darwin") {
    for (const listener of listeners) {
      evidence.push(...(await collectDarwin(listener, { signal })));
    }
    return { evidence, failures, method: "darwin-lsof-listener-table" };
  }
  if (platform !== "linux") {
    throw new Error(`unsupported listener isolation platform: ${platform}`);
  }
  const targets = enumerateTargets();
  for (const listener of listeners) {
    for (const target of targets) {
      throwIfAborted(signal, "listener isolation probe aborted");
      const result = await probe(target, listener.port, { signal });
      const classification = classifyNegativeProbe(result);
      evidence.push({
        listener: listener.name,
        interface: target.interface,
        address: target.address,
        family: target.family,
        scopeid: target.scopeid,
        classification,
      });
      if (classification !== "unreachable") {
        failures.push(
          `${listener.name} non-loopback probe was ${classification} on ${target.interface}/${target.address}`,
        );
      }
    }
  }
  return { evidence, failures, method: "linux-interface-negative-reachability" };
}

async function firstStaticAsset(layout) {
  const staticRoot = path.join(layout.stagedAppRoot, ".next/static");
  const files = await findFiles(staticRoot, () => true);
  if (!files.length) throw new Error("staged web static tree is empty");
  return `/_next/static/${normalizedRelative(staticRoot, files[0])}`;
}

async function probeGeneration({
  generation,
  proxy,
  stage,
  hostileCwd,
  runtimeRoot,
  databaseUrl,
  auth,
  token,
  marker,
  canaries,
  diagnostics,
  journal,
  signal,
}) {
  const generationHome = path.join(runtimeRoot, `generation-${generation}`);
  const generationTemp = path.join(generationHome, "tmp");
  await mkdir(generationTemp, { recursive: true, mode: 0o700 });
  const explicitMcpResource = generation === 2;
  const explicitMcpAllowedOrigins = generation === 1;
  let web;
  let webResourceId;
  let webPort;
  let webOrigin;
  let baseEnvironment;
  let backend;
  const backendId = `backend-generation-${generation}`;
  let primaryError;
  let result;
  try {
    const webLifecycle = createWebAttemptLifecycleHooks({ generation, journal });
    const startedWeb = await startWebWithAddressRetry({
      allocatePort: findFreeLoopbackPort,
      ...webLifecycle,
      start: async ({ port, attemptContext, registerManaged }) => {
        const origin = `http://127.0.0.1:${port}`;
        const runtimeEnvironment = buildPackagedRuntimeEnvironment(process.env, {
          home: generationHome,
          temp: generationTemp,
          proxyOrigin: proxy.origin,
          webOrigin: origin,
          databaseUrl,
          auth,
          explicitMcpResource,
          explicitMcpAllowedOrigins,
        });
        const managed = await startManagedChild({
          name: attemptContext.id,
          entrypoint: stage.layout.serverEntrypoint,
          cwd: hostileCwd,
          environment: {
            ...runtimeEnvironment,
            HOSTNAME: "127.0.0.1",
            PORT: String(port),
          },
          diagnostics,
          canaries,
          signal,
        });
        registerManaged(managed);
        return { managed, origin, environment: runtimeEnvironment };
      },
      waitReady: ({ managed, origin }) =>
        waitForWebReady(managed, origin, signal),
      stop: (managed) =>
        stopManagedChild(managed, "SIGTERM", { requireRunning: false }),
    });
    web = startedWeb.managed;
    webResourceId = startedWeb.attemptContext.id;
    webPort = startedWeb.port;
    webOrigin = startedWeb.origin;
    baseEnvironment = startedWeb.environment;
    await journal.acquiring({
      id: backendId,
      type: "staged-backend-process",
      owned: true,
      identity: { generation, requestedPort: 0 },
      recovery: `Verify the recorded PID belongs to ${backendId}, then signal only its owned process group.`,
    });
    backend = await startManagedChild({
      name: backendId,
      entrypoint: path.join(stage.stageBackend, backendEntrypointRelative),
      cwd: hostileCwd,
      environment: baseEnvironment,
      diagnostics,
      canaries,
      readinessParser: parseBackendReadinessLine,
      signal,
    });
    await journal.acquired(backendId, { identity: { pid: backend.child.pid } });
    const ready = await waitWithTimeout(
      backend.readyPromise,
      30_000,
      `${backendId} readiness timed out`,
      signal,
    );
    const backendOrigin = `http://${ready.address}:${ready.port}`;
    proxy.setTarget(backendOrigin);

    const health = await fetchJson(`${proxy.origin}/health`, { signal });
    assert.equal(health.status, 200);
    const principal = await graphql(
      proxy.origin,
      `query PackagingSmokePrincipal { me { userId email } }`,
      token,
      signal,
    );
    assert.equal(principal.status, 200);
    assert.equal(principal.body.errors, undefined);
    const catalog = await graphql(
      proxy.origin,
      `query PackagingSmokeCatalog {
        preferenceCatalog { id slug }
        activePreferences { id slug value userId }
      }`,
      token,
      signal,
    );
    assert.equal(catalog.status, 200);
    assert.equal(catalog.body.errors, undefined);
    assertCatalogState(catalog.body.data.preferenceCatalog);
    if (generation === 1) {
      const written = await graphql(
        proxy.origin,
        `mutation PackagingSmokeWrite {
          setPreference(input: { slug: "profile.first_name", value: "${marker}" }) {
            id slug value userId
          }
        }`,
        token,
        signal,
      );
      assert.equal(written.status, 200);
      assert.equal(written.body.errors, undefined);
      assert.equal(written.body.data.setPreference.value, marker);
    } else {
      const persisted = catalog.body.data.activePreferences.find(
        (preference) => preference.slug === "profile.first_name",
      );
      assert.equal(persisted?.value, marker, "generation two must read generation-one state");
    }

    const cors = await fetchJson(`${proxy.origin}/graphql`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
        origin: webOrigin,
      },
      body: JSON.stringify({ query: `query PackagingSmokeCors { __typename }` }),
      signal,
    });
    assert.equal(cors.status, 200);
    assert.equal(cors.headers.get("access-control-allow-origin"), webOrigin);

    const mcpSchema = await mcpPost(
      proxy.origin,
      token,
      {
        jsonrpc: "2.0",
        id: generation,
        method: "resources/read",
        params: { uri: "schema://graphql" },
      },
      signal,
    );
    assert.equal(mcpSchema.status, 200);
    assert.equal(mcpSchema.body.result.contents[0].uri, "schema://graphql");
    assert.equal(
      sha256(mcpSchema.body.result.contents[0].text),
      stage.sealed.manifest.schemaSha256,
    );
    const mcpOrigin = await fetchJson(`${proxy.origin}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${token}`,
        origin: webOrigin,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: `origin-${generation}`,
        method: "tools/list",
        params: {},
      }),
      signal,
    });
    assert.equal(mcpOrigin.status, 200);
    assert.equal(mcpOrigin.headers.get("access-control-allow-origin"), webOrigin);
    const protectedMetadata = await fetchJson(
      `${proxy.origin}/.well-known/oauth-protected-resource/mcp`,
      { signal },
    );
    assert.equal(protectedMetadata.status, 200);
    assert.equal(protectedMetadata.body.resource, `${proxy.origin}/mcp`);

    const webPage = await fetch(`${webOrigin}/`, {
      redirect: "manual",
      signal: AbortSignal.timeout(5_000),
    });
    assert.equal(webPage.status, 200);
    assert.match(await webPage.text(), /Context Router/);
    const staticResponse = await fetch(`${webOrigin}${await firstStaticAsset(stage.layout)}`, {
      signal: AbortSignal.timeout(5_000),
    });
    assert.equal(staticResponse.status, 200);
    const chat = await fetchJson(`${webOrigin}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "synthetic" }),
      signal,
    });
    assert.equal(chat.status, 401);
    const debug = await fetchJson(`${webOrigin}/api/debug/token?format=json`, { signal });
    assert.equal(debug.status, 401);

    const isolation = await collectListenerIsolationEvidence([
      {
        name: backendId,
        pid: backend.child.pid,
        address: ready.address,
        port: ready.port,
      },
      {
        name: webResourceId,
        pid: web.child.pid,
        address: "127.0.0.1",
        port: webPort,
      },
      {
        name: "stable-proxy",
        pid: process.pid,
        address: "127.0.0.1",
        port: proxy.port,
      },
    ], { signal });
    result = {
      generation,
      principalId: principal.body.data.me.userId,
      catalog: catalog.body.data.preferenceCatalog,
      backend: ready,
      web: { address: "127.0.0.1", port: webPort },
      explicitMcpResource,
      explicitMcpAllowedOrigins,
      isolation: isolation.evidence,
      isolationFailures: isolation.failures,
      isolationMethod: isolation.method,
    };
  } catch (error) {
    primaryError = error;
  }

  proxy.clearTarget();
  const shutdownErrors = [];
  const shutdownSignal = generation === 1 ? "SIGINT" : "SIGTERM";
  if (backend) {
    try {
      await stopManagedChild(backend, shutdownSignal, {
        requireRunning: !primaryError,
      });
      await journal.cleanupFinished(backendId, { status: "exited" });
    } catch (error) {
      shutdownErrors.push(error);
      try {
        await journal.cleanupFinished(backendId, { status: "failed", error });
      } catch (journalError) {
        shutdownErrors.push(journalError);
      }
    }
  }
  if (web) {
    try {
      await stopManagedChild(web, shutdownSignal, {
        requireRunning: !primaryError,
      });
      await journal.cleanupFinished(webResourceId, { status: "exited" });
    } catch (error) {
      shutdownErrors.push(error);
      try {
        await journal.cleanupFinished(webResourceId, {
          status: "failed",
          error,
        });
      } catch (journalError) {
        shutdownErrors.push(journalError);
      }
    }
  }
  const combined = combineFailures(primaryError, shutdownErrors, `generation ${generation}`);
  if (combined) throw combined;
  return result;
}

async function runStartupSignalMatrix({
  stage,
  hostileCwd,
  runtimeRoot,
  proxy,
  databaseUrl,
  auth,
  diagnostics,
  canaries,
  journal,
  signal,
}) {
  const evidence = [];
  for (const childType of ["web", "backend"]) {
    for (const signalName of ["SIGINT", "SIGTERM"]) {
      const id = `startup-${childType}-${signalName.toLowerCase()}`;
      const home = path.join(runtimeRoot, id);
      const temp = path.join(home, "tmp");
      await mkdir(temp, { recursive: true, mode: 0o700 });
      const webPort = await findFreeLoopbackPort();
      const webOrigin = `http://127.0.0.1:${webPort}`;
      const runtimeEnvironment = buildPackagedRuntimeEnvironment(process.env, {
        home,
        temp,
        proxyOrigin: proxy.origin,
        webOrigin,
        databaseUrl,
        auth,
      });
      const entrypoint =
        childType === "web"
          ? stage.layout.serverEntrypoint
          : path.join(stage.stageBackend, backendEntrypointRelative);
      const childEnvironment =
        childType === "web"
          ? {
              ...runtimeEnvironment,
              HOSTNAME: "127.0.0.1",
              PORT: String(webPort),
            }
          : runtimeEnvironment;
      await journal.acquiring({
        id,
        type: `staged-${childType}-startup-process`,
        owned: true,
        identity: { signal: signalName },
        recovery: `Verify the recorded PID belongs to ${id}, then signal only its owned process group.`,
      });
      let managed;
      try {
        managed = await startManagedChild({
          name: id,
          entrypoint,
          cwd: hostileCwd,
          environment: childEnvironment,
          diagnostics,
          canaries,
          readinessParser:
            childType === "backend" ? parseBackendReadinessLine : undefined,
          signal,
        });
        managed.readyPromise?.catch(() => {});
        await journal.acquired(id, { identity: { pid: managed.child.pid } });
        await stopManagedChild(managed, signalName);
        if (
          childType === "backend" &&
          managed.outputTail().includes("context-router.backend.ready")
        ) {
          throw new Error(`${id} reached readiness before the startup signal`);
        }
        await journal.cleanupFinished(id, { status: "exited" });
        evidence.push({ childType, signal: signalName, escalated: false });
      } catch (error) {
        const cleanupErrors = [];
        if (managed) {
          try {
            await stopManagedChild(managed, "SIGTERM", {
              requireRunning: false,
            });
          } catch (cleanupError) {
            cleanupErrors.push(cleanupError);
          }
        }
        const resource = journal.state.resources.find((item) => item.id === id);
        if (resource?.status === "acquiring") {
          try {
            await journal.acquired(id, {
              identity: { pid: managed?.child.pid ?? null },
            });
          } catch (journalError) {
            cleanupErrors.push(journalError);
          }
        }
        try {
          await journal.cleanupFinished(id, { status: "failed", error });
        } catch (journalError) {
          cleanupErrors.push(journalError);
        }
        throw combineFailures(error, cleanupErrors, `${id} cleanup`);
      }
    }
  }
  return evidence;
}

async function runOccupiedPortFailure({
  stage,
  hostileCwd,
  runtimeRoot,
  proxy,
  databaseUrl,
  auth,
  diagnostics,
  canaries,
  journal,
  signal,
}) {
  const id = "backend-occupied-port";
  const holderId = "occupied-port-holder";
  const holderSockets = new Set();
  await journal.acquiring({
    id: holderId,
    type: "occupied-port-holder",
    owned: true,
    identity: { address: "127.0.0.1", requestedPort: 0 },
    recovery: `Close only the exact journal-owned loopback holder listener.`,
  });
  let holder;
  let holderError;
  let managed;
  let primaryError;
  let result;
  const cleanupErrors = [];
  try {
    holder = net.createServer((socket) => socket.end("owned-holder"));
    holder.on("connection", (socket) => {
      trackOwnedSocket(holderSockets, socket);
    });
    holder.on("error", (error) => {
      holderError ??= error;
    });
    await new Promise((resolve, reject) => {
      holder.once("error", reject);
      holder.listen(0, "127.0.0.1", resolve);
    });
    const address = holder.address();
    assert.ok(address && typeof address === "object");
    await journal.acquired(holderId, {
      identity: { address: "127.0.0.1", port: address.port },
    });
    const home = path.join(runtimeRoot, id);
    const temp = path.join(home, "tmp");
    await mkdir(temp, { recursive: true, mode: 0o700 });
    const base = buildPackagedRuntimeEnvironment(process.env, {
      home,
      temp,
      proxyOrigin: proxy.origin,
      webOrigin: `http://127.0.0.1:${await findFreeLoopbackPort()}`,
      databaseUrl,
      auth,
      port: address.port,
    });
    await journal.acquiring({
      id,
      type: "staged-backend-expected-failure",
      owned: true,
      identity: { address: "127.0.0.1", port: address.port },
      recovery: `Verify the recorded PID belongs to ${id}, then signal only its owned process group.`,
    });
    managed = await startManagedChild({
      name: id,
      entrypoint: path.join(stage.stageBackend, backendEntrypointRelative),
      cwd: hostileCwd,
      environment: base,
      diagnostics,
      canaries,
      readinessParser: parseBackendReadinessLine,
      signal,
    });
    managed.readyPromise.catch(() => {});
    await journal.acquired(id, { identity: { pid: managed.child.pid } });
    await waitWithTimeout(
      managed.closePromise,
      20_000,
      "occupied-port backend did not fail boundedly",
      signal,
    );
    await managed.finishLog();
    if (managed.status.exitCode === 0 || managed.outputTail().includes("context-router.backend.ready")) {
      throw new Error("occupied-port backend unexpectedly reached readiness or exited zero");
    }
    await requireTcpConnection({
      host: "127.0.0.1",
      port: address.port,
      signal,
    });
    result = { port: address.port, holderPreserved: true };
  } catch (error) {
    primaryError = error;
  } finally {
    if (managed) {
      let processCleanupError;
      try {
        await stopManagedChild(managed, "SIGTERM", { requireRunning: false });
      } catch (error) {
        processCleanupError = error;
        cleanupErrors.push(error);
      }
      try {
        await journal.cleanupFinished(id, {
          status: processCleanupError ? "failed" : "exited",
          error: processCleanupError,
        });
      } catch (error) {
        cleanupErrors.push(error);
      }
    } else {
      const backendResource = journal.state.resources.find(
        (resource) => resource.id === id,
      );
      if (backendResource) {
        try {
          if (backendResource.status === "acquiring") {
            await journal.acquired(id, { identity: { pid: null } });
          }
          await journal.cleanupFinished(id, { status: "not-owned" });
        } catch (error) {
          cleanupErrors.push(error);
        }
      }
    }
    let holderCleanupError = holderError;
    try {
      if (holder) await closeServer(holder, holderSockets);
    } catch (error) {
      holderCleanupError ??= error;
      if (holderCleanupError !== error) cleanupErrors.push(error);
    }
    if (holderCleanupError) cleanupErrors.push(holderCleanupError);
    try {
      const holderResource = journal.state.resources.find(
        (resource) => resource.id === holderId,
      );
      if (holderResource?.status === "acquiring") {
        await journal.acquired(holderId, { identity: { port: null } });
      }
      await journal.cleanupFinished(holderId, {
        status: holderCleanupError ? "failed" : holder ? "closed" : "not-owned",
        error: holderCleanupError,
      });
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  const combined = combineFailures(primaryError, cleanupErrors, "occupied-port proof");
  if (combined) throw combined;
  return result;
}

async function runPartialStartCleanup({
  stage,
  hostileCwd,
  runtimeRoot,
  proxy,
  databaseUrl,
  auth,
  diagnostics,
  canaries,
  journal,
  signal,
}) {
  const id = "web-partial-start";
  const port = await findFreeLoopbackPort();
  const home = path.join(runtimeRoot, id);
  const temp = path.join(home, "tmp");
  await mkdir(temp, { recursive: true, mode: 0o700 });
  const environment = {
    ...buildPackagedRuntimeEnvironment(process.env, {
      home,
      temp,
      proxyOrigin: proxy.origin,
      webOrigin: `http://127.0.0.1:${port}`,
      databaseUrl,
      auth,
    }),
    HOSTNAME: "127.0.0.1",
    PORT: String(port),
  };
  await journal.acquiring({
    id,
    type: "staged-web-partial-start",
    owned: true,
    identity: { port },
    recovery: `Verify the recorded PID belongs to ${id}, then signal only its owned process group.`,
  });
  let managed;
  try {
    managed = await startManagedChild({
      name: id,
      entrypoint: stage.layout.serverEntrypoint,
      cwd: hostileCwd,
      environment,
      diagnostics,
      canaries,
      signal,
    });
    await journal.acquired(id, { identity: { pid: managed.child.pid } });
  } catch (error) {
    const cleanupErrors = [];
    if (managed) {
      try {
        await stopManagedChild(managed, "SIGTERM", { requireRunning: false });
      } catch (cleanupError) {
        cleanupErrors.push(cleanupError);
      }
    }
    const resource = journal.state.resources.find((item) => item.id === id);
    if (resource?.status === "acquiring") {
      try {
        await journal.acquired(id, {
          identity: { pid: managed?.child.pid ?? null },
        });
      } catch (journalError) {
        cleanupErrors.push(journalError);
      }
    }
    try {
      await journal.cleanupFinished(id, { status: "failed", error });
    } catch (journalError) {
      cleanupErrors.push(journalError);
    }
    throw combineFailures(error, cleanupErrors, `${id} cleanup`);
  }
  const injected = new Error("injected partial-start failure");
  const cleanupErrors = [];
  try {
    await stopManagedChild(managed, "SIGTERM");
    await journal.cleanupFinished(id, { status: "exited" });
  } catch (error) {
    cleanupErrors.push(error);
    try {
      await journal.cleanupFinished(id, { status: "failed", error });
    } catch (journalError) {
      cleanupErrors.push(journalError);
    }
  }
  const combined = combineFailures(injected, cleanupErrors, "partial-start injection");
  assert.match(combined.message, /injected partial-start failure/);
  if (cleanupErrors.length) throw combined;
  await writeSanitizedJson(
    path.join(diagnostics, "partial-start-evidence.json"),
    { primary: injected.message, cleanup: "complete", pid: managed.child.pid },
    expandedCanaries(canaries),
  );
  return { primaryPreserved: true, cleanupComplete: true };
}

async function runOrphanRegression({
  runtimeRoot,
  hostileCwd,
  diagnostics,
  canaries,
  journal,
  signal,
}) {
  if (process.platform === "win32") {
    return { status: "analysis-only", reason: "job-object coverage is not implemented" };
  }
  const fixtureRoot = path.join(runtimeRoot, "orphan-fixture");
  await mkdir(fixtureRoot, { recursive: true, mode: 0o700 });
  const grandchildPath = path.join(fixtureRoot, "grandchild.mjs");
  const parentPath = path.join(fixtureRoot, "parent.mjs");
  await writeFile(grandchildPath, "setInterval(() => {}, 1000);\n", { mode: 0o600 });
  await writeFile(
    parentPath,
    [
      'import { spawn } from "node:child_process";',
      'const child = spawn(process.execPath, [new URL("./grandchild.mjs", import.meta.url).pathname], { stdio: "ignore" });',
      "child.unref();",
      'process.stdout.write(JSON.stringify({ type: "packaging-orphan-ready", parentPid: process.pid, grandchildPid: child.pid }) + "\\n");',
      "",
    ].join("\n"),
    { mode: 0o600 },
  );
  const id = "posix-orphan-regression";
  await journal.acquiring({
    id,
    type: "owned-posix-process-tree",
    owned: true,
    identity: {},
    recovery: `Verify the recorded PIDs belong to ${id}, then signal only the owned process group.`,
  });
  let managed;
  let ready;
  try {
    managed = await startManagedChild({
      name: id,
      entrypoint: parentPath,
      cwd: hostileCwd,
      environment: Object.fromEntries(
        ["PATH", "LANG", "LC_ALL"].flatMap((key) =>
          process.env[key] === undefined ? [] : [[key, process.env[key]]],
        ),
      ),
      diagnostics,
      canaries,
      readinessParser(line) {
        try {
          const record = JSON.parse(line);
          return record.type === "packaging-orphan-ready" ? record : null;
        } catch {
          return null;
        }
      },
      signal,
    });
    await journal.acquired(id, { identity: { pid: managed.child.pid } });
    ready = await waitWithTimeout(
      managed.readyPromise,
      5_000,
      "orphan fixture did not start",
      signal,
    );
    await journal.acquired(id, {
      identity: { parentPid: ready.parentPid, grandchildPid: ready.grandchildPid },
    });
    await waitWithTimeout(
      managed.closePromise,
      5_000,
      "orphan fixture parent did not exit boundedly",
      signal,
    );
    await stopManagedChild(managed, "SIGTERM", { requireRunning: false });
    const deadline = Date.now() + 3_000;
    while (Date.now() < deadline) {
      const parentLive = await isProcessLive(ready.parentPid);
      const grandchildLive = await isProcessLive(ready.grandchildPid);
      if (!parentLive && !grandchildLive) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (
      (await isProcessLive(ready.parentPid)) ||
      (await isProcessLive(ready.grandchildPid))
    ) {
      throw new Error("owned nested-grandchild process survived scoped shutdown");
    }
    await journal.cleanupFinished(id, { status: "exited" });
    return {
      status: "passed",
      parentQuiescent: true,
      grandchildQuiescent: true,
    };
  } catch (error) {
    const cleanupErrors = [];
    if (managed) {
      try {
        await stopManagedChild(managed, "SIGTERM", { requireRunning: false });
      } catch (cleanupError) {
        cleanupErrors.push(cleanupError);
      }
    }
    const resource = journal.state.resources.find((item) => item.id === id);
    if (resource?.status === "acquiring") {
      try {
        await journal.acquired(id, {
          identity: { pid: managed?.child.pid ?? null },
        });
      } catch (journalError) {
        cleanupErrors.push(journalError);
      }
    }
    try {
      await journal.cleanupFinished(id, { status: "failed", error });
    } catch (journalError) {
      cleanupErrors.push(journalError);
    }
    throw combineFailures(error, cleanupErrors, `${id} cleanup`);
  }
}

function appendCanaryInspectionText(value, output) {
  if (typeof value === "string") {
    output.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) appendCanaryInspectionText(item, output);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    output.push(key);
    appendCanaryInspectionText(item, output);
  }
}

export async function diagnosticContents(root) {
  const values = [];
  for (const file of await findFiles(root, () => true)) {
    const content = await readFile(file, "utf8");
    if (path.basename(file).endsWith("resource-lifecycle.json")) {
      for (const value of resourceLifecycleDynamicValues(JSON.parse(content))) {
        appendCanaryInspectionText(value, values);
      }
    } else {
      values.push(content);
    }
  }
  return values;
}

export async function sanitizeDiagnostics(root, canaries) {
  const expanded = expandedCanaries(canaries);
  for (const file of await findFiles(root, () => true)) {
    const content = await readFile(file, "utf8");
    if (path.basename(file).endsWith("resource-lifecycle.json")) {
      await writeSanitizedResourceLifecycleJson(
        file,
        JSON.parse(content),
        expanded,
      );
      continue;
    }
    const sanitized = redactSecrets(content, expanded);
    if (sanitized !== content) await writeFile(file, sanitized, { mode: 0o600 });
  }
}

function addJournalCanaries(journal, canaries, ...values) {
  for (const value of values.flat()) {
    if (!value) continue;
    if (!canaries.includes(value)) canaries.push(value);
    for (const representation of canaryRepresentations(value)) {
      journal.addCanary(representation);
    }
  }
}

export async function finalizePackagingSmokeEvidence({
  diagnostics,
  diagnosticsOwnership,
  ownsDiagnostics,
  summary,
  journal,
  primaryError,
  cleanupErrors,
  signal,
  canaries,
  verifyOwnership = assertPackagingDiagnosticsOwnership,
  removeDiagnostics = removeOwnedTree,
  validateLifecycle = assertCompletedLifecycle,
  validateContents = async () => {
    await sanitizeDiagnostics(diagnostics, canaries);
    await ensurePrivateTree(diagnostics);
    await assertPrivateTree(diagnostics);
    assertNoCanaryLeak(await diagnosticContents(diagnostics), canaries);
  },
}) {
  const redactionCanaries = expandedCanaries(canaries);
  let ownershipVerified = false;
  let cancellationRecorded = false;
  const recordError = (error) => {
    if (error) cleanupErrors.push(error);
  };
  const observeCancellation = () => {
    if (!signal?.aborted) return false;
    if (!cancellationRecorded) {
      cancellationRecorded = true;
      if (!primaryError) {
        recordError(
          signal.reason instanceof Error
            ? signal.reason
            : new Error("packaging smoke cancelled"),
        );
      }
    }
    return true;
  };
  const terminalStatus = () =>
    signal?.aborted
      ? "cancelled"
      : primaryError || cleanupErrors.length
        ? "failed"
        : "passed";
  const refreshSummary = (status = terminalStatus()) => {
    summary.status = status;
    summary.cleanupErrors = cleanupErrors.map((error) =>
      redactSecrets(error.message, redactionCanaries),
    );
    if (status !== "running") delete summary.cleanupPending;
  };
  const persistSummary = () =>
    writeSanitizedJson(
      path.join(diagnostics, "summary.json"),
      summary,
      redactionCanaries,
    );
  const terminalLifecycle = (status) => {
    const snapshot = structuredClone(journal.state);
    snapshot.status = status;
    return snapshot;
  };
  const evidenceState = async (completionCommitted = false) => {
    let diagnosticsRetained = true;
    try {
      await lstat(diagnostics);
    } catch (error) {
      if (error.code === "ENOENT") diagnosticsRetained = false;
      else recordError(error);
    }
    return { summary, diagnosticsRetained, completionCommitted };
  };
  const persistTerminal = async (requestedStatus = terminalStatus()) => {
    observeCancellation();
    const requestedPass =
      requestedStatus === "passed" && terminalStatus() === "passed";
    if (requestedPass) {
      refreshSummary("running");
      summary.cleanupPending = "lifecycle-finalization";
      await persistSummary().catch(recordError);
      observeCancellation();
      if (terminalStatus() === "passed") {
        await journal.finish("passed").catch(recordError);
      }
      observeCancellation();
      if (terminalStatus() === "passed") {
        refreshSummary("passed");
        await persistSummary().catch(recordError);
        observeCancellation();
      }
    }
    if (!requestedPass || terminalStatus() !== "passed") {
      const status = terminalStatus();
      refreshSummary(status);
      await journal
        .finish(status, primaryError ?? cleanupErrors[0])
        .catch(recordError);
      observeCancellation();
      refreshSummary(terminalStatus());
      await persistSummary().catch(recordError);
      observeCancellation();
      refreshSummary(terminalStatus());
    }
  };

  observeCancellation();
  try {
    await verifyOwnership(diagnosticsOwnership);
    ownershipVerified = true;
  } catch (error) {
    recordError(error);
  }
  observeCancellation();
  if (!ownershipVerified) {
    refreshSummary();
    return evidenceState();
  }

  try {
    await validateContents();
  } catch (error) {
    recordError(error);
  }
  observeCancellation();
  try {
    validateLifecycle(terminalLifecycle(terminalStatus()));
  } catch (error) {
    recordError(error);
  }

  if (primaryError || cleanupErrors.length || !ownsDiagnostics) {
    await persistTerminal();
    return evidenceState(
      terminalStatus() === "passed" &&
        summary.status === "passed" &&
        journal.state.status === "passed" &&
        !signal?.aborted,
    );
  }

  // Automatic diagnostics removal is itself part of success. Persist only a
  // nonterminal, non-pass recovery record until verified removal completes.
  refreshSummary("running");
  summary.cleanupPending = "automatic-diagnostics-removal";
  try {
    await persistSummary();
    if (observeCancellation()) {
      await persistTerminal();
      return evidenceState();
    }
    await validateContents();
    if (observeCancellation()) {
      await persistTerminal();
      return evidenceState();
    }
    validateLifecycle(terminalLifecycle("passed"));
    await verifyOwnership(diagnosticsOwnership);
    if (observeCancellation()) {
      await persistTerminal();
      return evidenceState();
    }
    await removeDiagnostics(diagnostics);
    const cancelled = observeCancellation();
    refreshSummary(cancelled ? "cancelled" : "passed");
    return evidenceState(!cancelled);
  } catch (error) {
    recordError(error);
  }

  // A partially removed tree is never adopted. Rewrite terminal failure
  // evidence only if the original ownership marker still verifies.
  try {
    await verifyOwnership(diagnosticsOwnership);
    ownershipVerified = true;
  } catch (error) {
    ownershipVerified = false;
    recordError(error);
  }
  if (ownershipVerified) await persistTerminal("failed");
  else refreshSummary();
  return evidenceState();
}

async function runPackagingSmokeWithPrivateUmask({
  repositoryRoot = defaultRepositoryRoot,
  diagnosticsDirectory,
  environment = process.env,
  signal,
} = {}) {
  const startedAt = Date.now();
  const requestedDiagnostics =
    diagnosticsDirectory ?? environment.MIGRATION_PACKAGING_SMOKE_DIAGNOSTICS_DIR;
  const protectedStoreRoot = await readObservedPnpmStore(repositoryRoot);
  const protectedRoots = await collectPackagingProtectedRoots(
    repositoryRoot,
    protectedStoreRoot,
  );
  const diagnosticsOwnership = await preparePackagingDiagnosticsDirectory(
    requestedDiagnostics,
    { protectedRoots },
  );
  const ownsDiagnostics = diagnosticsOwnership.removeOnSuccess;
  const diagnostics = diagnosticsOwnership.directory;

  const hostileSecret = `hostile-${randomBytes(18).toString("base64url")}`;
  const urlSecret = `url-${randomBytes(18).toString("base64url")}`;
  const filenameSecret = `filename-${randomBytes(18).toString("hex")}`;
  const userMarker = `Packaged${randomBytes(10).toString("hex")}`;
  const clientSecret = `client-${randomBytes(24).toString("base64url")}`;
  const sessionSecret = randomBytes(32).toString("hex");
  const canaries = [
    hostileSecret,
    urlSecret,
    filenameSecret,
    userMarker,
    clientSecret,
    sessionSecret,
  ];
  const journalCanaries = expandedCanaries(canaries);
  const journal = await createResourceLifecycleJournal(diagnostics, {
    canaries: journalCanaries,
  });
  let context;
  let ownedPrivateRootOwnership;
  let privateRootRolledBack = false;
  let sourceSnapshot;
  let proxy;
  let stage;
  let administration;
  let database;
  let jwks;
  let secretDirectory;
  let primaryError;
  let finalization;
  const cleanupErrors = [];
  let boundedCleanupSignal;
  const getCleanupSignal = () => {
    boundedCleanupSignal ??= AbortSignal.timeout(120_000);
    return boundedCleanupSignal;
  };
  let summary = {
    schemaVersion: 1,
    status: "running",
    proof: "hosted-artifact-feasibility",
    startedAt: new Date().toISOString(),
  };

  try {
    throwIfAborted(signal);
    await journal.acquiring({
      id: "private-root",
      type: "packaging-private-root",
      owned: true,
      identity: {},
      recovery: `Verify the recorded path, nonce, and marker, then remove only that packaging root.`,
    });
    context = await prepareExecutionContext({
      repositoryRoot,
      environment,
      diagnostics,
      signal,
      protectedRoots,
      async onPrivateRoot(ownership) {
        ownedPrivateRootOwnership = ownership;
        await journal.acquired("private-root", {
          identity: {
            path: ownership.directory,
            markerPath: ownership.markerPath,
            nonce: ownership.nonce,
            mode: "preparing",
          },
        });
      },
    });
    await journal.acquired("private-root", {
      identity: { mode: context.mode },
    });
    summary.mode = context.mode;

    const runtimeRoot = path.join(context.privateRoot, "runtime");
    const hostileCwd = path.join(runtimeRoot, "hostile-cwd");
    const toolHome = path.join(runtimeRoot, "tool-home");
    for (const directory of [runtimeRoot, hostileCwd, toolHome]) {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await chmod(directory, 0o700);
    }
    await mkdir(path.join(hostileCwd, "src"), { recursive: true, mode: 0o700 });
    await Promise.all([
      writeFile(
        path.join(hostileCwd, ".env"),
        `AUTH0_CLIENT_SECRET=${hostileSecret}\nPORT=1\nAPP_HOST=0.0.0.0\n`,
        { mode: 0o600 },
      ),
      writeFile(
        path.join(hostileCwd, ".env.local"),
        `DATABASE_URL=postgresql://hostile:${urlSecret}@203.0.113.1:5432/hostile\n`,
        { mode: 0o600 },
      ),
      writeFile(
        path.join(hostileCwd, "src/schema.gql"),
        `type ${filenameSecret} { poisoned: String }\n`,
        { mode: 0o600 },
      ),
      writeFile(path.join(hostileCwd, filenameSecret), hostileSecret, {
        mode: 0o600,
      }),
    ]);

    proxy = await createStableLoopbackProxy();
    await journal.acquired({
      id: "stable-proxy",
      type: "loopback-http-proxy",
      owned: true,
      identity: { address: "127.0.0.1", port: proxy.port },
      recovery: `Close only the packaging proxy listener on its recorded loopback port.`,
    });

    const toolEnvironment = strictToolEnvironment(environment, {
      home: toolHome,
      corepackHome: context.corepackHome,
      storeRoot: context.storeRoot,
      proxyOrigin: proxy.origin,
    });
    const commandCanaries = expandedCanaries(canaries);
    await runCommand(assertApprovedPackagingChildCommand(
      "prisma-generate",
      ["pnpm", "--filter", "backend", "prisma:generate"],
    ), {
      cwd: context.sourceRoot,
      env: toolEnvironment,
      timeoutMs: 120_000,
      logPath: path.join(diagnostics, "prisma-generate.log"),
      canaries: commandCanaries,
      signal,
    });
    await runCommand(assertApprovedPackagingChildCommand(
      "backend-build",
      ["pnpm", "--filter", "backend", "build"],
    ), {
      cwd: context.sourceRoot,
      env: toolEnvironment,
      timeoutMs: 300_000,
      logPath: path.join(diagnostics, "backend-build.log"),
      canaries: commandCanaries,
      signal,
    });
    const { DATABASE_URL: _databaseUrl, ...webBuildEnvironment } = toolEnvironment;
    await runCommand(assertApprovedPackagingChildCommand(
      "web-build",
      ["pnpm", "--filter", "web", "build"],
    ), {
      cwd: context.sourceRoot,
      env: webBuildEnvironment,
      timeoutMs: 600_000,
      logPath: path.join(diagnostics, "web-build.log"),
      canaries: commandCanaries,
      signal,
    });

    sourceSnapshot = await captureCallerIntegrity(
      [context.sourceRoot, context.corepackHome],
      { signal },
    );

    await journal.acquiring({
      id: "sealed-stage",
      type: "read-only-packaged-stage",
      owned: true,
      identity: {},
      recovery: `Remove only the stage nested beneath the journal-owned packaging root.`,
    });
    stage = await assembleAndSealStage({
      sourceRoot: context.sourceRoot,
      privateRoot: context.privateRoot,
      diagnostics,
      environment,
      toolEnvironment,
      proxyOrigin: proxy.origin,
      storeRoot: context.storeRoot,
      signal,
    });
    await journal.acquired("sealed-stage", {
      identity: {
        manifestSha256: stage.sealed.manifestSha256,
        stageTreeSha256: stage.sealed.stageTreeSha256,
      },
    });
    await verifySealedStage(stage.stageRoot, stage.sealed);

    administration = await prepareTestAdministration({
      repositoryRoot: context.sourceRoot,
      diagnosticsDirectory: diagnostics,
      environment,
      signal,
      cleanupSignal: getCleanupSignal,
      lifecycle: journal,
    });
    try {
      const password = new URL(administration.administrationUrl).password;
      if (password) {
        addJournalCanaries(journal, canaries, password);
        try {
          addJournalCanaries(journal, canaries, decodeURIComponent(password));
        } catch {}
      }
    } catch {}
    database = await createIsolatedTestDatabase(
      context.sourceRoot,
      administration.administrationUrl,
      {
        signal,
        cleanupSignal: getCleanupSignal,
        lifecycle: journal,
      },
    );
    const databaseToolEnvironment = strictToolEnvironment(environment, {
      home: toolHome,
      corepackHome: context.corepackHome,
      storeRoot: context.storeRoot,
      databaseUrl: database.databaseUrl,
      proxyOrigin: proxy.origin,
    });
    await runCommand(
      assertApprovedPackagingChildCommand(
        "database-migrate",
        [
          "pnpm",
          "--filter",
          "backend",
          "exec",
          "prisma",
          "migrate",
          "deploy",
        ],
      ),
      {
        cwd: context.sourceRoot,
        env: databaseToolEnvironment,
        timeoutMs: 120_000,
        logPath: path.join(diagnostics, "database-migrate.log"),
        canaries: expandedCanaries(canaries),
        signal,
      },
    );
    const seedCatalog = (attempt) =>
      runCommand(
        assertApprovedPackagingChildCommand(
          "database-seed",
          [
            "pnpm",
            "--filter",
            "backend",
            "exec",
            "ts-node",
            "prisma/seed-catalog-smoke.ts",
          ],
        ),
        {
          cwd: context.sourceRoot,
          env: databaseToolEnvironment,
          timeoutMs: 120_000,
          logPath: path.join(diagnostics, `database-seed-${attempt}.log`),
          canaries: expandedCanaries(canaries),
          signal,
        },
      );

    secretDirectory = path.join(runtimeRoot, "synthetic-secrets");
    await mkdir(secretDirectory, { recursive: true, mode: 0o700 });
    await chmod(secretDirectory, 0o700);
    await journal.acquired({
      id: "synthetic-secrets",
      type: "synthetic-credential-directory",
      owned: true,
      identity: {},
      recovery: `Remove only the synthetic secret directory beneath the owned packaging root.`,
    });
    const tls = await createTlsFixture(
      context.sourceRoot,
      secretDirectory,
      diagnostics,
      signal,
      toolEnvironment,
    );
    const { privateKey: signingPrivateKey, publicKey: signingPublicKey } =
      generateKeyPairSync("rsa", { modulusLength: 2048 });
    const kid = `packaging-${randomBytes(8).toString("hex")}`;
    jwks = await startJwksFixture({
      key: tls.key,
      certificate: tls.certificate,
      signingPublicKey,
      kid,
    });
    await journal.acquired({
      id: "synthetic-jwks",
      type: "loopback-synthetic-jwks",
      owned: true,
      identity: { address: "127.0.0.1", port: jwks.port },
      recovery: `Close only the recorded synthetic JWKS listener.`,
    });
    const issuer = `https://127.0.0.1:${jwks.port}/`;
    const auth = {
      domain: `127.0.0.1:${jwks.port}`,
      issuer,
      audience: packagingAudience,
      clientId: "packaging-smoke-client",
      clientSecret,
      sessionSecret,
      caCertificate: tls.caCertificate,
    };
    const token = createSignedTestToken({
      privateKey: signingPrivateKey,
      kid,
      issuer,
      audience: packagingAudience,
      subject: "packaging-smoke@clients",
      clientId: auth.clientId,
      scopes: [
        "preferences:read",
        "preferences:write",
        "preferences:suggest",
        "preferences:define",
      ],
    });
    addJournalCanaries(journal, canaries, token);

    const occupiedPort = await runOccupiedPortFailure({
      stage,
      hostileCwd,
      runtimeRoot,
      proxy,
      databaseUrl: database.databaseUrl,
      auth,
      diagnostics,
      canaries,
      journal,
      signal,
    });
    const partialStart = await runPartialStartCleanup({
      stage,
      hostileCwd,
      runtimeRoot,
      proxy,
      databaseUrl: database.databaseUrl,
      auth,
      diagnostics,
      canaries,
      journal,
      signal,
    });
    const startupSignals = await runStartupSignalMatrix({
      stage,
      hostileCwd,
      runtimeRoot,
      proxy,
      databaseUrl: database.databaseUrl,
      auth,
      diagnostics,
      canaries,
      journal,
      signal,
    });
    const orphanRegression = await runOrphanRegression({
      runtimeRoot,
      hostileCwd,
      diagnostics,
      canaries,
      journal,
      signal,
    });

    const generations = [];
    for (const generation of [1, 2]) {
      await seedCatalog(generation);
      generations.push(
        await probeGeneration({
          generation,
          proxy,
          stage,
          hostileCwd,
          runtimeRoot,
          databaseUrl: database.databaseUrl,
          auth,
          token,
          marker: userMarker,
          canaries,
          diagnostics,
          journal,
          signal,
        }),
      );
    }
    assert.equal(generations[0].principalId, generations[1].principalId);
    assert.deepEqual(
      assertCatalogState(generations[0].catalog),
      assertCatalogState(generations[1].catalog),
    );
    assert.equal(generations[0].catalog.length, expectedCatalogCount);
    const isolationFailures = generations.flatMap(
      (generation) => generation.isolationFailures,
    );
    await verifySealedStage(stage.stageRoot, stage.sealed);
    await assertCallerIntegrity(sourceSnapshot, { signal });
    assert.equal(
      await readFile(path.join(hostileCwd, "src/schema.gql"), "utf8"),
      `type ${filenameSecret} { poisoned: String }\n`,
    );
    await assertPrivateTree(runtimeRoot);

    summary = {
      ...summary,
      status: "passed",
      finishedAt: new Date().toISOString(),
      elapsedMs: Date.now() - startedAt,
      platform: process.platform,
      architecture: process.arch,
      node: process.version,
      pnpm: EXPECTED_PNPM_VERSION,
      manifestSha256: stage.sealed.manifestSha256,
      stageTreeSha256: stage.sealed.stageTreeSha256,
      publicPresent: stage.sealed.manifest.publicPresent,
      native: stage.native,
      occupiedPort,
      partialStart,
      startupSignals,
      orphanRegression,
      seedRuns: 2,
      networkIsolationFailures: isolationFailures,
      generations: generations.map((generation) => ({
        generation: generation.generation,
        principalStable: generation.principalId === generations[0].principalId,
        catalogCount: generation.catalog.length,
        backend: generation.backend,
        web: generation.web,
        explicitMcpResource: generation.explicitMcpResource,
        explicitMcpAllowedOrigins: generation.explicitMcpAllowedOrigins,
        listenerEvidenceMethod: generation.isolationMethod,
        listenerEvidenceCount: generation.isolation.length,
        listenerEvidence: generation.isolation,
      })),
      selectedRouteProofOnly: true,
      zeroEgressClaim: false,
    };
    if (isolationFailures.length) {
      throw new Error(
        `network-isolation evidence is inconclusive for ${isolationFailures.length} listener/address probes; first: ${isolationFailures[0]}`,
      );
    }
  } catch (error) {
    if (
      error?.allocationRolledBack &&
      error.ownership?.directory === ownedPrivateRootOwnership?.directory
    ) {
      privateRootRolledBack = true;
    }
    primaryError = error;
    summary = {
      ...summary,
      status: signal?.aborted ? "cancelled" : "failed",
      finishedAt: new Date().toISOString(),
      elapsedMs: Date.now() - startedAt,
      failure: redactSecrets(error?.message ?? error, expandedCanaries(canaries)),
    };
  } finally {
    const cleanupSignal = getCleanupSignal();
    if (database && administration && context) {
      let error;
      try {
        await dropIsolatedTestDatabase(
          context.sourceRoot,
          administration.administrationUrl,
          database.databaseName,
          {
            expectedOwnershipMarker: database.ownershipMarker,
            signal: cleanupSignal,
          },
        );
      } catch (cleanupError) {
        error = cleanupError;
        cleanupErrors.push(cleanupError);
      }
      await journal.cleanupFinished("database", {
        status: error ? "failed" : "removed",
        error,
      }).catch((journalError) => cleanupErrors.push(journalError));
    }
    if (administration) {
      let error;
      try {
        await administration.cleanup({ signal: cleanupSignal });
      } catch (cleanupError) {
        error = cleanupError;
        cleanupErrors.push(cleanupError);
      }
      const id = administration.containerName ? "container" : "administration";
      await journal.cleanupFinished(id, {
        status: error
          ? "failed"
          : administration.containerName
            ? "removed"
            : "not-owned",
        error,
      }).catch((journalError) => cleanupErrors.push(journalError));
    }
    if (jwks) {
      let error;
      try {
        await jwks.close();
      } catch (cleanupError) {
        error = cleanupError;
        cleanupErrors.push(cleanupError);
      }
      await journal.cleanupFinished("synthetic-jwks", {
        status: error ? "failed" : "closed",
        error,
      }).catch((journalError) => cleanupErrors.push(journalError));
    }
    if (proxy) {
      let error;
      try {
        await proxy.close();
      } catch (cleanupError) {
        error = cleanupError;
        cleanupErrors.push(cleanupError);
      }
      await journal.cleanupFinished("stable-proxy", {
        status: error ? "failed" : "closed",
        error,
      }).catch((journalError) => cleanupErrors.push(journalError));
    }
    if (sourceSnapshot) {
      try {
        await assertCallerIntegrity(sourceSnapshot, { signal: cleanupSignal });
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    const privateRootOwnership =
      context?.privateRootOwnership ?? ownedPrivateRootOwnership;
    const privateRoot = privateRootOwnership?.directory;
    if (privateRoot) {
      if (privateRootRolledBack) {
        try {
          const privateResource = journal.state.resources.find(
            (item) => item.id === "private-root",
          );
          if (privateResource?.status === "acquiring") {
            await journal.acquired("private-root", {
              identity: { mode: "preparation-rolled-back" },
            });
          }
          await journal.cleanupFinished("private-root", { status: "removed" });
        } catch (error) {
          cleanupErrors.push(error);
        }
      } else {
        try {
          await assertPackagingPrivateRootOwnership(privateRootOwnership);
          await removeOwnedTree(privateRoot);
          for (const id of ["sealed-stage", "synthetic-secrets"]) {
            const resource = journal.state.resources.find((item) => item.id === id);
            if (!resource) continue;
            if (resource.status === "acquiring") await journal.acquired(id);
            await journal.cleanupFinished(id, { status: "removed" });
          }
          const privateResource = journal.state.resources.find(
            (item) => item.id === "private-root",
          );
          if (privateResource?.status === "acquiring") {
            await journal.acquired("private-root", {
              identity: { mode: context?.mode ?? "preparation-failed" },
            });
          }
          await journal.cleanupFinished("private-root", { status: "removed" });
        } catch (error) {
          cleanupErrors.push(error);
          for (const id of [
            journal.state.resources.some((item) => item.id === "sealed-stage")
              ? "sealed-stage"
              : null,
            journal.state.resources.some((item) => item.id === "synthetic-secrets")
              ? "synthetic-secrets"
              : null,
            "private-root",
          ].filter(Boolean)) {
            try {
              await journal.cleanupFinished(id, { status: "failed", error });
            } catch (journalError) {
              cleanupErrors.push(journalError);
            }
          }
        }
      }
      if (context) {
        try {
          await assertCallerIntegrity(context.callerIntegrity, {
            signal: cleanupSignal,
          });
          if (
            context.callerStatusBefore &&
            !(
              await callerStatus(
                repositoryRoot,
                cleanupSignal,
                context.gitEnvironment,
              )
            ).equals(context.callerStatusBefore)
          ) {
            throw new Error("caller Git status changed during packaging smoke");
          }
        } catch (error) {
          cleanupErrors.push(error);
        }
      }
    }
    finalization = await finalizePackagingSmokeEvidence({
      diagnostics,
      diagnosticsOwnership,
      ownsDiagnostics,
      summary,
      journal,
      primaryError,
      cleanupErrors,
      signal,
      canaries,
    });
  }

  if (
    signal?.aborted &&
    !finalization?.completionCommitted &&
    !primaryError &&
    !cleanupErrors.some((error) => error === signal.reason)
  ) {
    cleanupErrors.push(
      signal.reason instanceof Error
        ? signal.reason
        : new Error("packaging smoke cancelled before success commit"),
    );
  }

  const combined = combineFailures(primaryError, cleanupErrors, "packaging smoke");
  if (combined) {
    const sanitized = createSanitizedPackagingError(combined, canaries);
    console.error(
      finalization?.diagnosticsRetained
        ? `packaging-smoke: sanitized diagnostics retained at ${diagnostics}`
        : `packaging-smoke: diagnostics were removed before failure was observed (${diagnostics})`,
    );
    throw sanitized;
  }
  console.log(
    `packaging-smoke: ok; platform=${process.platform} architecture=${process.arch} ` +
      `node=${process.version} pnpm=${EXPECTED_PNPM_VERSION} ` +
      `manifest=${summary.manifestSha256} stage=${summary.stageTreeSha256} ` +
      `selected-route-proof=true zero-egress-claim=false elapsedMs=${summary.elapsedMs}`,
  );
  return summary;
}

export async function withPrivateFileCreationMask(operation) {
  const previousUmask = process.umask(0o077);
  try {
    return await operation();
  } finally {
    process.umask(previousUmask);
  }
}

export async function runPackagingSmoke(options) {
  return withPrivateFileCreationMask(() =>
    runPackagingSmokeWithPrivateUmask(options),
  );
}

async function main() {
  const cancellation = createSignalAbortController();
  try {
    await runPackagingSmoke({ signal: cancellation.signal });
  } catch (error) {
    console.error(`packaging-smoke: failed: ${redactSecrets(error?.message ?? error)}`);
    process.exitCode = error?.exitCode ?? 1;
  } finally {
    cancellation.dispose();
  }
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  await main();
}
