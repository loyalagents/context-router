#!/usr/bin/env node

import { createHash, randomBytes } from "node:crypto";
import { promises as dns } from "node:dns";
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  readlink,
  realpath,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createWriteStream } from "node:fs";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";

const DATABASE_NAME_PATTERN = /^context_router_[a-f0-9]{8,64}_test$/;
const FULL_SHA_PATTERN = /^[a-f0-9]{40}$/;
const LIVE_PROVIDER_PATTERN =
  /(?:--provider(?:=|\s+)(?:vertex|claude|codex|openrouter)|\blive[-_:]|eval-harbor:smoke|run_smoke|bootstrap_runner|docker\s+pull|pnpm\s+install|npm\s+install)/i;

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function redactSecrets(value, canaries = []) {
  let redacted = String(value ?? "");
  redacted = redacted.replace(
    /(postgres(?:ql)?:\/\/)([^\s/@]+(?::[^\s/@]*)?)@/gi,
    "$1<redacted>@",
  );
  redacted = redacted.replace(
    /\b(Authorization\s*:\s*)Bearer\s+[^\s,"']+/gi,
    "$1Bearer <redacted>",
  );
  redacted = redacted.replace(/\bBearer\s+[^\s,"']+/gi, "Bearer <redacted>");
  redacted = redacted.replace(
    /\b[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/g,
    "<redacted-jwt>",
  );
  redacted = redacted.replace(
    /\b([A-Z][A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|API_KEY)[A-Z0-9_]*\s*=\s*)[^\s]+/g,
    "$1<redacted>",
  );
  for (const canary of canaries) {
    if (!canary) continue;
    redacted = redacted.replace(
      new RegExp(escapeRegExp(String(canary)), "g"),
      "<redacted-canary>",
    );
  }
  return redacted;
}

/**
 * Hold incomplete lines so a credential split across stream chunks is never
 * emitted before the redactor has seen the complete value.
 */
export function createStreamingRedactor(write, canaries = []) {
  let pending = "";
  let droppingOverlongLine = false;
  const maximumLineLength = 65_536;
  return {
    write(chunk) {
      let input = String(chunk);
      if (droppingOverlongLine) {
        const newline = input.indexOf("\n");
        if (newline < 0) return;
        droppingOverlongLine = false;
        input = input.slice(newline + 1);
      }
      pending += input;
      const lastNewline = pending.lastIndexOf("\n");
      if (lastNewline < 0) {
        if (pending.length > maximumLineLength) {
          pending = "";
          droppingOverlongLine = true;
          write("<redacted-overlong-line>\n");
        }
        return;
      }
      const complete = pending.slice(0, lastNewline + 1);
      pending = pending.slice(lastNewline + 1);
      write(redactSecrets(complete, canaries));
    },
    end() {
      if (pending) write(redactSecrets(pending, canaries));
      pending = "";
    },
  };
}

export function validateGeneratedDatabaseName(databaseName) {
  if (!DATABASE_NAME_PATTERN.test(databaseName)) {
    throw new Error(
      "refusing unsafe database target: expected a generated test database named context_router_<hex>_test",
    );
  }
  return databaseName;
}

export function generateDatabaseName() {
  return validateGeneratedDatabaseName(
    `context_router_${randomBytes(12).toString("hex")}_test`,
  );
}

export function isLoopbackAddress(address) {
  if (!address) return false;
  const normalized = String(address).split("%")[0].toLowerCase();
  if (normalized === "::1") return true;
  if (normalized.startsWith("::ffff:")) {
    return isLoopbackAddress(normalized.slice("::ffff:".length));
  }
  if (net.isIP(normalized) === 4) {
    return normalized.split(".")[0] === "127";
  }
  return false;
}

function sanitizedEndpoint(parsed) {
  const clone = new URL(parsed.href);
  if (clone.username || clone.password) {
    clone.username = "<redacted>";
    clone.password = "";
  }
  return clone.toString();
}

export async function assertSafePostgresEndpoint(
  rawUrl,
  {
    lookup = (hostname) => dns.lookup(hostname, { all: true, verbatim: true }),
    inspectPeer,
  } = {},
) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("PostgreSQL administration URL is malformed");
  }
  if (!new Set(["postgres:", "postgresql:"]).has(parsed.protocol)) {
    throw new Error("PostgreSQL administration URL must use postgres: or postgresql:");
  }
  if (parsed.searchParams.has("schema")) {
    throw new Error("PostgreSQL schema parameter is forbidden; the gate requires an isolated database public schema");
  }

  const unixSocket = parsed.searchParams.get("host");
  if (unixSocket) {
    if (!path.isAbsolute(unixSocket) || unixSocket.includes("\0")) {
      throw new Error("PostgreSQL Unix socket host must be an absolute local path");
    }
    const peer = inspectPeer ? await inspectPeer(rawUrl) : null;
    if (peer) {
      throw new Error("PostgreSQL Unix socket inspection unexpectedly reported a TCP peer");
    }
    return { parsed, hostname: parsed.hostname, unixSocket, endpoint: sanitizedEndpoint(parsed) };
  }

  const hostname = parsed.hostname;
  if (!hostname) throw new Error("PostgreSQL administration URL has no host");
  const addresses = net.isIP(hostname)
    ? [{ address: hostname, family: net.isIP(hostname) }]
    : await lookup(hostname);
  if (!addresses.length) throw new Error("PostgreSQL host resolved to no addresses");
  const unsafe = addresses.find(({ address }) => !isLoopbackAddress(address));
  if (unsafe) {
    throw new Error(
      `refusing PostgreSQL endpoint with non-loopback DNS address ${unsafe.address}: ${sanitizedEndpoint(parsed)}`,
    );
  }
  if (!inspectPeer) {
    throw new Error("PostgreSQL endpoint safety requires inspection of the connected socket peer");
  }
  const peerAddress = await inspectPeer(rawUrl);
  if (!isLoopbackAddress(peerAddress)) {
    throw new Error(
      `connected PostgreSQL peer is not loopback (${peerAddress ?? "unknown"}): ${sanitizedEndpoint(parsed)}`,
    );
  }
  return { parsed, hostname, unixSocket: null, endpoint: sanitizedEndpoint(parsed) };
}

export async function assertServerVerifiedTestDatabase(
  expectedDatabaseName,
  queryCurrentDatabase,
) {
  validateGeneratedDatabaseName(expectedDatabaseName);
  const row = await queryCurrentDatabase();
  if (row?.current_database !== expectedDatabaseName) {
    throw new Error(
      `server reported unexpected database ${row?.current_database ?? "<missing>"}; refusing test operations`,
    );
  }
  return row;
}

export async function validateMergeBase(candidate, git) {
  const baseSha = String(candidate ?? "").trim().toLowerCase();
  if (!FULL_SHA_PATTERN.test(baseSha)) {
    throw new Error("migration gate base must be a full 40-character hexadecimal commit SHA");
  }
  if (/^0+$/.test(baseSha)) {
    throw new Error("migration gate base must not be an all-zero SHA");
  }
  const available = await git(["cat-file", "-e", `${baseSha}^{commit}`]);
  if (available.exitCode !== 0) {
    throw new Error(`migration gate base ${baseSha} is not available as a commit; fetch full history first`);
  }
  const ancestor = await git(["merge-base", "--is-ancestor", baseSha, "HEAD"]);
  if (ancestor.exitCode !== 0) {
    throw new Error(`migration gate base ${baseSha} is not an ancestor of HEAD`);
  }
  return baseSha;
}

export function validatePhaseManifest(manifest) {
  const errors = [];
  if (manifest?.schemaVersion !== 1) errors.push("phase manifest schemaVersion must be 1");
  if (!Array.isArray(manifest?.supportedModes) || !manifest.supportedModes.length) {
    errors.push("phase manifest must declare supported modes");
  }
  if (!Array.isArray(manifest?.phases) || !manifest.phases.length) {
    errors.push("phase manifest must declare phases");
    return errors;
  }
  const ids = new Set();
  const supportedModes = new Set(manifest.supportedModes ?? []);
  const roadmapOwners = new Set(
    Array.from({ length: 10 }, (_, index) => String(index + 1).padStart(2, "0")),
  );
  for (const [index, phase] of manifest.phases.entries()) {
    if (!phase.id || ids.has(phase.id)) errors.push(`phase ${index + 1} has a missing or duplicate id`);
    ids.add(phase.id);
    if (phase.order !== index + 1) errors.push("phase orders must be contiguous and match manifest order");
    if (!roadmapOwners.has(phase.ownerStep)) errors.push(`phase ${phase.id ?? index + 1} has no valid roadmap owner step`);
    if (!new Set(["active", "retired"]).has(phase.status)) errors.push(`phase ${phase.id ?? index + 1} has invalid lifecycle status`);
    if (!Number.isInteger(phase.timeoutMs) || phase.timeoutMs <= 0) errors.push(`phase ${phase.id ?? index + 1} has an invalid timeout`);
    if (!Array.isArray(phase.modes) || !phase.modes.length) errors.push(`phase ${phase.id ?? index + 1} has no supported mode`);
    for (const mode of phase.modes ?? []) {
      if (!supportedModes.has(mode)) errors.push(`phase ${phase.id ?? index + 1} references unknown mode ${mode}`);
    }
    if (!Array.isArray(phase.predecessors)) errors.push(`phase ${phase.id ?? index + 1} lacks predecessor metadata`);
    if (!Array.isArray(phase.replacementEvidence)) errors.push(`phase ${phase.id ?? index + 1} lacks replacement evidence metadata`);
    if (phase.status === "retired" && !phase.replacementEvidence?.length) errors.push(`retired phase ${phase.id ?? index + 1} requires replacement evidence`);
    for (const evidence of phase.replacementEvidence ?? []) {
      if (typeof evidence !== "string" || !evidence.trim()) errors.push(`phase ${phase.id ?? index + 1} has invalid replacement evidence`);
    }
    if (!phase.retirementCondition) errors.push(`phase ${phase.id ?? index + 1} lacks a retirement condition`);
    if (!Array.isArray(phase.commands) || !phase.commands.length) errors.push(`phase ${phase.id ?? index + 1} has no commands`);
    for (const command of phase.commands ?? []) {
      if (!Array.isArray(command.argv) || !command.argv.length) errors.push(`phase ${phase.id ?? index + 1} has an invalid command`);
      if (LIVE_PROVIDER_PATTERN.test((command.argv ?? []).join(" "))) {
        errors.push(`phase ${phase.id ?? index + 1} contains a prohibited live-provider or installer command`);
      }
    }
  }
  for (const [index, phase] of manifest.phases.entries()) {
    for (const predecessor of phase.predecessors ?? []) {
      const predecessorIndex = manifest.phases.findIndex((item) => item.id === predecessor);
      if (predecessorIndex < 0 || predecessorIndex >= index) {
        errors.push(`phase ${phase.id} has an invalid predecessor ${predecessor}`);
      }
    }
  }
  for (const mode of manifest.supportedModes ?? []) {
    const hasSmoke = manifest.phases.some(
      (phase) =>
        phase.status === "active" &&
        phase.kind === "restart-smoke" &&
        phase.modes?.includes(mode),
    );
    if (!hasSmoke) errors.push(`supported mode ${mode} has no restart smoke`);
  }
  return [...new Set(errors)];
}

export async function runPhaseSequence(
  phases,
  {
    execute,
    onPhaseStart = () => {},
    onPhaseFinish = () => {},
    onSummary = () => {},
    onCleanup = () => {},
  },
) {
  const results = phases.map(({ id }) => ({ id, status: "pending", elapsedMs: 0 }));
  let primaryError;
  for (const [index, phase] of phases.entries()) {
    const startedAt = Date.now();
    try {
      await onPhaseStart(phase);
      for (const command of phase.commands) await execute(command, phase);
      const result = { id: phase.id, status: "passed", elapsedMs: Date.now() - startedAt };
      results[index] = result;
      await onPhaseFinish(phase, result);
    } catch (error) {
      results[index] = {
        id: phase.id,
        status: "failed",
        elapsedMs: Date.now() - startedAt,
        exitCode: error?.exitCode ?? 1,
        signal: error?.signal ?? null,
      };
      for (let skipped = index + 1; skipped < results.length; skipped += 1) {
        results[skipped].status = "skipped";
      }
      const wrapped = new Error(
        `phase ${phase.id} failed: ${redactSecrets(error?.message ?? error)}`,
        { cause: error },
      );
      wrapped.phase = phase.id;
      wrapped.exitCode = error?.exitCode ?? 1;
      wrapped.signal = error?.signal ?? null;
      primaryError = wrapped;
      break;
    }
  }
  await onSummary(results);
  let cleanupError;
  try {
    await onCleanup();
  } catch (error) {
    cleanupError = error;
  }
  if (primaryError && cleanupError) {
    const combined = new Error(
      `${primaryError.message}; cleanup failure: ${redactSecrets(cleanupError.message)}`,
      { cause: primaryError },
    );
    combined.phase = primaryError.phase;
    combined.exitCode = primaryError.exitCode;
    combined.cleanupError = cleanupError;
    throw combined;
  }
  if (primaryError) throw primaryError;
  if (cleanupError) throw cleanupError;
  return results;
}

export async function runCommand(
  argv,
  {
    cwd,
    env = process.env,
    timeoutMs = 300_000,
    logPath,
    canaries = [],
    echo = false,
  } = {},
) {
  if (!Array.isArray(argv) || !argv.length) throw new Error("command argv is empty");
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) throw new Error("command timeout must be positive");
  if (logPath) await mkdir(path.dirname(logPath), { recursive: true });
  const logStream = logPath
    ? createWriteStream(logPath, { flags: "w", mode: 0o600 })
    : null;
  const tail = [];
  let tailLength = 0;
  const write = (source) => (chunk) => {
    const tagged = `[${source}] ${chunk}`;
    logStream?.write(tagged);
    if (echo) process.stdout.write(tagged);
    const bounded = tagged.slice(-16_384);
    tail.push(bounded);
    tailLength += bounded.length;
    while (tailLength > 16_384 && tail.length > 1) {
      tailLength -= tail.shift().length;
    }
  };
  const stdout = createStreamingRedactor(write("stdout"), canaries);
  const stderr = createStreamingRedactor(write("stderr"), canaries);
  const child = spawn(argv[0], argv.slice(1), {
    cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => stdout.write(chunk));
  child.stderr.on("data", (chunk) => stderr.write(chunk));

  let timedOut = false;
  let forceTimeout;
  const signalProcessTree = (signal) => {
    if (process.platform !== "win32" && child.pid) {
      try {
        process.kill(-child.pid, signal);
        return;
      } catch {}
    }
    child.kill(signal);
  };
  const timeout = setTimeout(() => {
    timedOut = true;
    signalProcessTree("SIGTERM");
    forceTimeout = setTimeout(() => signalProcessTree("SIGKILL"), 2_000);
    forceTimeout.unref();
  }, timeoutMs);
  timeout.unref();

  let result;
  try {
    result = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (exitCode, signal) => resolve({ exitCode, signal }));
    });
  } finally {
    clearTimeout(timeout);
    if (forceTimeout) clearTimeout(forceTimeout);
    stdout.end();
    stderr.end();
    if (logStream) {
      await new Promise((resolve) => logStream.end(resolve));
    }
  }

  if (timedOut) {
    const error = new Error(
      `command timed out after ${timeoutMs}ms: ${redactSecrets(argv.join(" "), canaries)}`,
    );
    error.exitCode = 124;
    error.signal = result.signal;
    error.outputTail = tail.join("");
    throw error;
  }
  if (result.exitCode !== 0) {
    const error = new Error(
      `command exited ${result.exitCode ?? `on ${result.signal}`}: ${redactSecrets(argv.join(" "), canaries)}`,
    );
    error.exitCode = result.exitCode ?? 1;
    error.signal = result.signal;
    error.outputTail = tail.join("");
    throw error;
  }
  return { ...result, outputTail: tail.join("") };
}

function assertSafeRelativePath(relativePath) {
  if (
    !relativePath ||
    path.isAbsolute(relativePath) ||
    relativePath.split(/[\\/]/).includes("..") ||
    relativePath.includes("\0")
  ) {
    throw new Error(`unsafe workspace path: ${relativePath}`);
  }
}

export async function copyWorkspaceFiles(sourceRoot, targetRoot, files) {
  await mkdir(targetRoot, { recursive: true });
  for (const relativePath of files) {
    assertSafeRelativePath(relativePath);
    const sourcePath = path.join(sourceRoot, relativePath);
    const targetPath = path.join(targetRoot, relativePath);
    const sourceInfo = await lstat(sourcePath);
    if (!sourceInfo.isFile() && !sourceInfo.isSymbolicLink()) {
      throw new Error(`workspace input is not a file: ${relativePath}`);
    }
    await mkdir(path.dirname(targetPath), { recursive: true });
    if (sourceInfo.isSymbolicLink()) {
      const linkTarget = await readlink(sourcePath);
      const resolvedTarget = await realpath(sourcePath);
      const resolvedRoot = await realpath(sourceRoot);
      if (
        resolvedTarget !== resolvedRoot &&
        !resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`)
      ) {
        throw new Error(`workspace symlink escapes the repository: ${relativePath}`);
      }
      await symlink(linkTarget, targetPath);
    } else {
      await copyFile(sourcePath, targetPath);
    }
  }
}

async function hashFile(filePath) {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

async function hashPath(targetPath) {
  let info;
  try {
    info = await lstat(targetPath);
  } catch (error) {
    if (error.code === "ENOENT") return { exists: false };
    throw error;
  }
  if (info.isSymbolicLink()) {
    return { exists: true, kind: "symlink", target: await readlink(targetPath) };
  }
  if (info.isFile()) return { exists: true, kind: "file", sha256: await hashFile(targetPath) };
  if (info.isDirectory()) {
    const entries = [];
    async function visit(directory, relative = "") {
      for (const name of (await readdir(directory)).sort()) {
        const absolute = path.join(directory, name);
        const childRelative = path.join(relative, name);
        const child = await lstat(absolute);
        if (child.isDirectory()) await visit(absolute, childRelative);
        else if (child.isFile()) entries.push([childRelative, await hashFile(absolute)]);
        else if (child.isSymbolicLink()) entries.push([childRelative, `link:${await readlink(absolute)}`]);
      }
    }
    await visit(targetPath);
    return {
      exists: true,
      kind: "directory",
      sha256: createHash("sha256").update(JSON.stringify(entries)).digest("hex"),
    };
  }
  return { exists: true, kind: "other", mode: info.mode };
}

export async function captureCallerIntegrity(paths) {
  const snapshot = new Map();
  for (const targetPath of paths) snapshot.set(targetPath, await hashPath(targetPath));
  return snapshot;
}

export async function assertCallerIntegrity(snapshot) {
  const changed = [];
  for (const [targetPath, before] of snapshot) {
    const after = await hashPath(targetPath);
    if (JSON.stringify(before) !== JSON.stringify(after)) changed.push(targetPath);
  }
  if (changed.length) throw new Error(`caller path changed during disposable gate: ${changed.join(", ")}`);
}

export async function linkDependencyTrees(sourceRoot, targetRoot, relativeRoots) {
  for (const relativeRoot of relativeRoots) {
    const source = path.join(sourceRoot, relativeRoot, "node_modules");
    try {
      const info = await stat(source);
      if (!info.isDirectory()) continue;
    } catch {
      continue;
    }
    const target = path.join(targetRoot, relativeRoot, "node_modules");
    await mkdir(path.dirname(target), { recursive: true });
    await symlink(await realpath(source), target, "dir");
  }
}

export function buildDatabaseUrl(administrationUrl, databaseName) {
  validateGeneratedDatabaseName(databaseName);
  const parsed = new URL(administrationUrl);
  parsed.pathname = `/${databaseName}`;
  parsed.searchParams.delete("schema");
  return parsed.toString();
}

export async function writeSanitizedJson(filePath, value, canaries = []) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${redactSecrets(JSON.stringify(value, null, 2), canaries)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}
