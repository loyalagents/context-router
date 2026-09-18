#!/usr/bin/env node

import { createHash, randomBytes } from "node:crypto";
import { promises as dns } from "node:dns";
import {
  chmod,
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
import { constants as fsConstants, createWriteStream } from "node:fs";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";

const DATABASE_NAME_PATTERN = /^context_router_[a-f0-9]{8,64}_test$/;
const FULL_SHA_PATTERN = /^[a-f0-9]{40}$/;
const LIVE_PROVIDER_PATTERN =
  /(?:--provider(?:=|\s+)(?:vertex|claude|codex|openrouter)|\blive[-_:]|eval-harbor:smoke|run_smoke|bootstrap_runner|docker\s+pull|pnpm\s+install|npm\s+install)/i;
const APPROVED_HOSTED_COMMANDS = new Map([
  ["contract-baseline", [
    ["node", "--test", "scripts/local-migration/check-contract-baseline.test.mjs", "scripts/local-migration/gate-runner.test.mjs", "scripts/local-migration/gate-phases.test.mjs", "scripts/local-migration/restart-smoke.test.mjs", "scripts/local-migration/test-database.test.mjs", "scripts/local-migration/web-support-smoke.test.mjs", "scripts/local-migration/eval-test-discovery.test.mjs", "scripts/local-migration/toolchain-contract.test.mjs", "scripts/local-migration/ci-path-filters.test.mjs", "scripts/local-migration/runtime-process.test.mjs", "scripts/local-migration/web-runtime-config.test.mjs", "scripts/local-migration/runtime-resources.test.mjs", "scripts/local-migration/packaging-smoke.test.mjs"],
    ["node", "scripts/local-migration/check-contract-baseline.mjs"],
  ]],
  ["documentation", [
    ["node", "--test", "scripts/check-markdown-links.test.mjs"],
    ["node", "scripts/check-markdown-links.mjs"],
  ]],
  ["backend-unit-build", [
    ["pnpm", "--filter", "backend", "prisma:generate"],
    ["pnpm", "--filter", "backend", "typecheck:seed"],
    ["pnpm", "--filter", "backend", "build"],
    ["pnpm", "--filter", "backend", "test:unit"],
  ]],
  ["backend-database", [
    ["pnpm", "--filter", "backend", "exec", "prisma", "migrate", "deploy"],
    ["pnpm", "--filter", "backend", "test:integration"],
    ["pnpm", "--filter", "backend", "test:e2e:tests-only"],
  ]],
  ["local-orchestrator", [
    ["pnpm", "--filter", "local-orchestrator", "test"],
    ["pnpm", "--filter", "local-orchestrator", "lint"],
    ["pnpm", "--filter", "local-orchestrator", "build"],
  ]],
  ["eval-fixtures", [["pnpm", "eval:verify"]]],
  ["eval-deterministic-scenarios", [
    ["pnpm", "eval:run", "--scenario", "samir-desai-i9-template-smoke"],
    ["pnpm", "eval:run", "--scenario", "elena-marquez-i9-template-smoke"],
  ]],
  ["web-production-build", [["pnpm", "--filter", "web", "build"]]],
  ["harbor-static", [["bash", "examples/eval-harbor/scripts/check_static.sh"]]],
  ["restart-smoke", [["node", "scripts/local-migration/restart-smoke.mjs"]]],
  ["packaged-composition-smoke", [["node", "scripts/local-migration/packaging-smoke.mjs"]]],
  ["repository-integrity", [["node", "scripts/local-migration/check-generated-integrity.mjs"]]],
]);
const TERMINAL_LINUX_PROCESS_STATES = new Set(["Z", "X", "x"]);

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function parseLinuxProcessStat(value) {
  const record = String(value ?? "");
  const open = record.indexOf("(");
  const close = record.lastIndexOf(") ");
  const pid = Number(record.slice(0, open).trim());
  const fields = close > open
    ? record.slice(close + 2).trim().split(/\s+/)
    : [];
  const state = fields[0];
  const processGroupId = Number(fields[2]);
  if (
    open <= 0 ||
    close <= open ||
    !Number.isInteger(pid) ||
    pid <= 0 ||
    !/^[A-Za-z]$/.test(state ?? "") ||
    !Number.isInteger(processGroupId) ||
    processGroupId <= 0
  ) {
    throw new Error("invalid Linux process stat record");
  }
  return { state, processGroupId };
}

function processTargetExists(target, signalProcess) {
  try {
    signalProcess(target, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    throw error;
  }
}

export async function hasLiveProcessGroupMembers(
  processGroupId,
  {
    platform = process.platform,
    signalProcess = process.kill,
    listProcessIds = () => readdir("/proc"),
    readProcessStat = (pid) => readFile(`/proc/${pid}/stat`, "utf8"),
  } = {},
) {
  if (
    platform === "win32" ||
    !Number.isInteger(processGroupId) ||
    processGroupId <= 0
  ) {
    return false;
  }
  try {
    if (!processTargetExists(-processGroupId, signalProcess)) return false;
  } catch {
    return true;
  }
  if (platform !== "linux") return true;

  let processIds;
  try {
    processIds = await listProcessIds();
  } catch {
    return true;
  }
  let sawTerminalMember = false;
  for (const candidate of processIds) {
    const pid = String(candidate);
    if (!/^[1-9][0-9]*$/.test(pid)) continue;
    let statRecord;
    try {
      statRecord = await readProcessStat(pid);
    } catch (error) {
      if (error?.code === "ENOENT" || error?.code === "ESRCH") continue;
      return true;
    }
    let parsed;
    try {
      parsed = parseLinuxProcessStat(statRecord);
    } catch {
      return true;
    }
    if (parsed.processGroupId !== processGroupId) continue;
    if (!TERMINAL_LINUX_PROCESS_STATES.has(parsed.state)) return true;
    sawTerminalMember = true;
  }
  if (sawTerminalMember) return false;
  try {
    return processTargetExists(-processGroupId, signalProcess);
  } catch {
    return true;
  }
}

export async function isProcessLive(
  pid,
  {
    platform = process.platform,
    signalProcess = process.kill,
    readProcessStat = (candidate) =>
      readFile(`/proc/${candidate}/stat`, "utf8"),
  } = {},
) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    if (!processTargetExists(pid, signalProcess)) return false;
  } catch {
    return true;
  }
  if (platform !== "linux") return true;
  let statRecord;
  try {
    statRecord = await readProcessStat(pid);
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ESRCH") return false;
    return true;
  }
  try {
    return !TERMINAL_LINUX_PROCESS_STATES.has(
      parseLinuxProcessStat(statRecord).state,
    );
  } catch {
    return true;
  }
}

export function redactSecrets(value, canaries = []) {
  let redacted = String(value ?? "");
  redacted = redacted.replace(
    /\b([a-z][a-z0-9+.-]*:\/\/)([^\s/@?#]+(?::[^\s/@?#]*)?)@/gi,
    "$1<redacted>@",
  );
  redacted = redacted.replace(
    /([?&](?:access[_-]?token|api[_-]?key|authorization|client[_-]?secret|password|token)=)[^&#\s]*/gi,
    "$1<redacted>",
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
    /\b([A-Z_][A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|API_KEY)[A-Z0-9_]*\s*=\s*)[^\s]+/gi,
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

export async function validatePostgresEndpointBeforeConnect(
  rawUrl,
  {
    lookup = (hostname) => dns.lookup(hostname, { all: true, verbatim: true }),
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
  for (const parameter of ["host", "port"]) {
    if (parsed.searchParams.getAll(parameter).length > 1) {
      throw new Error(`duplicate PostgreSQL ${parameter} parameter is forbidden`);
    }
  }

  const unixSocket = parsed.searchParams.get("host");
  if (unixSocket) {
    if (!path.isAbsolute(unixSocket) || unixSocket.includes("\0")) {
      throw new Error("PostgreSQL Unix socket host must be an absolute local path");
    }
    const normalized = new URL(parsed);
    normalized.searchParams.delete("host");
    normalized.searchParams.set("host", unixSocket);
    return {
      parsed,
      hostname: parsed.hostname,
      unixSocket,
      addresses: [],
      endpoint: sanitizedEndpoint(parsed),
      normalizedConnectionString: normalized.toString(),
    };
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, "");
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
  return {
    parsed,
    hostname,
    unixSocket: null,
    addresses,
    endpoint: sanitizedEndpoint(parsed),
  };
}

export function pinPostgresConnectionString(rawUrl, endpoint) {
  if (endpoint.unixSocket) return endpoint.normalizedConnectionString;
  const address = endpoint.addresses?.[0]?.address;
  if (!isLoopbackAddress(address)) {
    throw new Error("cannot pin PostgreSQL connection without a validated loopback address");
  }
  const parsed = new URL(rawUrl);
  parsed.hostname = net.isIP(address) === 6 ? `[${address}]` : address;
  return parsed.toString();
}

export function assertConnectedPostgresPeer(endpoint, peerAddress) {
  if (endpoint.unixSocket) {
    if (peerAddress) {
      throw new Error("PostgreSQL Unix socket inspection unexpectedly reported a TCP peer");
    }
    return;
  }
  if (!isLoopbackAddress(peerAddress)) {
    throw new Error(
      `connected PostgreSQL peer is not loopback (${peerAddress ?? "unknown"}): ${endpoint.endpoint}`,
    );
  }
}

export async function assertSafePostgresEndpoint(
  rawUrl,
  {
    lookup = (hostname) => dns.lookup(hostname, { all: true, verbatim: true }),
    inspectPeer,
  } = {},
) {
  const endpoint = await validatePostgresEndpointBeforeConnect(rawUrl, {
    lookup,
  });
  if (!inspectPeer) {
    throw new Error("PostgreSQL endpoint safety requires inspection of the connected socket peer");
  }
  const peerAddress = await inspectPeer(rawUrl);
  assertConnectedPostgresPeer(endpoint, peerAddress);
  return endpoint;
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
  const shallow = await git(["rev-parse", "--is-shallow-repository"]);
  if (shallow.exitCode !== 0 || String(shallow.stdout).trim() !== "false") {
    throw new Error("migration gate requires complete, non-shallow Git history");
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

export function validatePhaseManifest(
  manifest,
  { decisionExists = () => false } = {},
) {
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
  const supportedModeRecords = Array.isArray(manifest.supportedModes)
    ? manifest.supportedModes
    : [];
  const supportedModes = new Set();
  const activeModes = new Set();
  const modesById = new Map();
  for (const mode of supportedModeRecords) {
    if (!mode?.id) {
      errors.push("supported mode lacks an id");
      continue;
    }
    if (supportedModes.has(mode.id)) {
      errors.push(`duplicate supported mode ${mode.id}`);
      continue;
    }
    supportedModes.add(mode.id);
    modesById.set(mode.id, mode);
    if (!new Set(["active", "retired"]).has(mode.status)) {
      errors.push(`supported mode ${mode.id} has invalid lifecycle status`);
    } else if (mode.status === "active") {
      activeModes.add(mode.id);
    }
    if (!Array.isArray(mode.successorModes)) {
      errors.push(`supported mode ${mode.id} lacks successor mode metadata`);
    } else if (mode.status === "active" && mode.successorModes.length) {
      errors.push(`active supported mode ${mode.id} must not declare successor modes`);
    } else if (
      mode.status === "retired" &&
      mode.successorModes.length !== 1
    ) {
      errors.push(`retired supported mode ${mode.id} requires exactly one active successor mode`);
    }
  }
  for (const mode of supportedModeRecords) {
    if (!mode?.id || mode.status !== "retired") continue;
    for (const successorId of mode.successorModes ?? []) {
      const successor = modesById.get(successorId);
      if (!successor || successor.status !== "active") {
        errors.push(
          `retired supported mode ${mode.id} has invalid active successor ${successorId}`,
        );
      }
    }
  }
  const coreEvidenceClasses = new Set([
    "contract",
    "build",
    "state",
    "restart",
    "integrity",
  ]);
  const decisionEvidenceClasses = new Set([
    "documentation",
    "tooling",
    "evaluation",
    "research",
  ]);
  const roadmapOwners = new Set(
    Array.from({ length: 11 }, (_, index) => String(index + 1).padStart(2, "0")),
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
      if (!supportedModes.has(mode)) {
        errors.push(`phase ${phase.id ?? index + 1} references unknown mode ${mode}`);
      } else if (phase.status === "active" && !activeModes.has(mode)) {
        errors.push(`active phase ${phase.id ?? index + 1} references non-active mode ${mode}`);
      }
    }
    if (!Array.isArray(phase.predecessors)) errors.push(`phase ${phase.id ?? index + 1} lacks predecessor metadata`);
    if (!Array.isArray(phase.evidenceClasses) || !phase.evidenceClasses.length) errors.push(`phase ${phase.id ?? index + 1} lacks evidence classes`);
    if (!Array.isArray(phase.replacementEvidence)) errors.push(`phase ${phase.id ?? index + 1} lacks replacement evidence metadata`);
    if (phase.status === "retired" && !phase.replacementEvidence?.length) errors.push(`retired phase ${phase.id ?? index + 1} requires replacement evidence`);
    if (phase.status === "active" && phase.replacementEvidence?.length) errors.push(`active phase ${phase.id ?? index + 1} must not declare replacement evidence`);
    if (phase.kind === "restart-smoke" && !phase.evidenceClasses?.includes("restart")) errors.push(`restart smoke ${phase.id ?? index + 1} must provide restart evidence`);
    if (phase.kind === "packaged-smoke") {
      if (phase.id !== "packaged-composition-smoke") errors.push("packaged smoke must use the approved phase id");
      if (phase.ownerStep !== "02") errors.push("packaged smoke must be owned by Step 02");
      if (phase.timeoutMs !== 900_000) errors.push("packaged smoke must use the approved 900000ms timeout");
      if (phase.terminationGraceMs !== 180_000) errors.push("packaged smoke must use the approved 180000ms termination grace");
      if (!jsonArrayEqual(phase.modes, ["hosted-baseline"])) {
        errors.push("packaged smoke must use exactly the hosted-baseline mode");
      }
      if (!jsonArrayEqual(phase.predecessors, ["restart-smoke"])) {
        errors.push("packaged smoke must immediately follow restart-smoke");
      }
      if (!jsonArrayEqual(phase.evidenceClasses, ["build", "restart", "integrity"])) {
        errors.push("packaged smoke must provide exactly build, restart, and integrity evidence");
      }
    } else if (phase.terminationGraceMs !== undefined) {
      errors.push(`phase ${phase.id ?? index + 1} must not declare terminationGraceMs`);
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
  const activeTimeoutTotal = manifest.phases
    .filter((phase) => phase.status === "active")
    .reduce((total, phase) => total + (phase.timeoutMs ?? 0), 0);
  if (activeTimeoutTotal > 94 * 60_000) {
    errors.push("active phase timeouts exceed the approved 94-minute budget");
  }
  const phasesById = new Map(
    manifest.phases.map((phase) => [phase.id, phase]),
  );
  const repositoryIntegrity = phasesById.get("repository-integrity");
  if (
    repositoryIntegrity &&
    !jsonArrayEqual(repositoryIntegrity.predecessors, ["packaged-composition-smoke"])
  ) {
    errors.push(
      "repository integrity must immediately follow packaged-composition-smoke",
    );
  }
  for (const [index, phase] of manifest.phases.entries()) {
    for (const predecessor of phase.predecessors ?? []) {
      const predecessorIndex = manifest.phases.findIndex((item) => item.id === predecessor);
      if (predecessorIndex < 0 || predecessorIndex >= index) {
        errors.push(`phase ${phase.id} has an invalid predecessor ${predecessor}`);
      } else if (
        phase.status === "active" &&
        manifest.phases[predecessorIndex].status !== "active"
      ) {
        errors.push(`active phase ${phase.id} has retired predecessor ${predecessor}`);
      }
    }
    const coveredPairs = new Set();
    for (const evidence of phase.replacementEvidence ?? []) {
      if (evidence?.kind === "phase") {
        const successor = phasesById.get(evidence.phaseId);
        const modesCoveredBySuccessor = (evidence.coveredModes ?? []).every(
          (mode) => {
            const modeRecord = modesById.get(mode);
            if (!modeRecord) return false;
            const requiredSuccessorModes =
              modeRecord.status === "retired"
                ? modeRecord.successorModes ?? []
                : [mode];
            return requiredSuccessorModes.some(
              (successorMode) =>
                activeModes.has(successorMode) &&
                successor?.modes?.includes(successorMode),
            );
          },
        );
        const valid =
          successor &&
          successor.status === "active" &&
          modesCoveredBySuccessor &&
          (evidence.evidenceClasses ?? []).every((evidenceClass) =>
            successor.evidenceClasses?.includes(evidenceClass),
          );
        if (!valid) {
          errors.push(`phase ${phase.id} has invalid or unresolved replacement evidence`);
          continue;
        }
      } else if (evidence?.kind === "decision") {
        const validClasses = (evidence.evidenceClasses ?? []).every(
          (evidenceClass) => decisionEvidenceClasses.has(evidenceClass),
        );
        const validModes = (evidence.coveredModes ?? []).every((mode) =>
          supportedModes.has(mode),
        );
        if (
          !validClasses ||
          !validModes ||
          !decisionExists(evidence.path, evidence.decisionId)
        ) {
          errors.push(`phase ${phase.id} has invalid or unresolved decision evidence`);
          continue;
        }
      } else {
        errors.push(`phase ${phase.id} has invalid replacement evidence`);
        continue;
      }
      for (const mode of evidence.coveredModes ?? []) {
        for (const evidenceClass of evidence.evidenceClasses ?? []) {
          coveredPairs.add(`${mode}\0${evidenceClass}`);
        }
      }
    }
    if (phase.status === "retired") {
      for (const mode of phase.modes ?? []) {
        for (const evidenceClass of phase.evidenceClasses ?? []) {
          if (!coveredPairs.has(`${mode}\0${evidenceClass}`)) {
            errors.push(
              `retired phase ${phase.id} lacks replacement evidence for ${mode}/${evidenceClass}`,
            );
          }
        }
      }
    }
  }
  for (const mode of supportedModeRecords) {
    if (!mode?.id) continue;
    for (const required of coreEvidenceClasses) {
      if (!(mode.requiredEvidenceClasses ?? []).includes(required)) {
        errors.push(`supported mode ${mode.id} omits required ${required} evidence class`);
      }
    }
    if (mode.status !== "active") continue;
    const availableEvidence = new Set(
      manifest.phases
        .filter(
          (phase) =>
            phase.status === "active" && phase.modes?.includes(mode.id),
        )
        .flatMap((phase) => phase.evidenceClasses ?? []),
    );
    for (const required of mode.requiredEvidenceClasses ?? []) {
      if (!availableEvidence.has(required)) {
        errors.push(`supported mode ${mode.id} has no active ${required} evidence`);
      }
    }
    const hasSmoke = manifest.phases.some(
      (phase) =>
        phase.status === "active" &&
        phase.kind === "restart-smoke" &&
        phase.modes?.includes(mode.id),
    );
    if (!hasSmoke) errors.push(`supported mode ${mode.id} has no restart smoke`);
  }
  return [...new Set(errors)];
}

function acceptedDecisionStatus(content, decisionId) {
  const heading = new RegExp(
    `^### ${decisionId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:.*$`,
    "m",
  );
  const match = heading.exec(content);
  if (!match) return false;
  const sectionStart = match.index + match[0].length;
  const remainder = content.slice(sectionStart);
  const nextDecision = remainder.search(/^### LM-[0-9]{3}:/m);
  const section = nextDecision < 0 ? remainder : remainder.slice(0, nextDecision);
  return /^- Status:\s*Accepted\s*$/m.test(section);
}

export async function loadAcceptedDecisionEvidence(repositoryRoot, manifest) {
  const repositoryReal = await realpath(repositoryRoot);
  const statuses = new Map();
  const decisionEvidence = (manifest.phases ?? [])
    .flatMap((phase) => phase.replacementEvidence ?? [])
    .filter((evidence) => evidence?.kind === "decision");
  for (const evidence of decisionEvidence) {
    assertSafeRelativePath(evidence.path);
    const candidate = path.resolve(repositoryReal, evidence.path);
    if (!pathIsWithin(repositoryReal, candidate)) {
      throw new Error(`decision evidence escapes repository: ${evidence.path}`);
    }
    const info = await lstat(candidate).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (!info || !info.isFile() || info.isSymbolicLink()) {
      throw new Error(
        `decision evidence must be an existing regular repository file: ${evidence.path}`,
      );
    }
    const candidateReal = await realpath(candidate);
    if (!pathIsWithin(repositoryReal, candidateReal)) {
      throw new Error(`decision evidence escapes repository: ${evidence.path}`);
    }
    const content = await readFile(candidateReal, "utf8");
    statuses.set(
      `${evidence.path}\0${evidence.decisionId}`,
      acceptedDecisionStatus(content, evidence.decisionId),
    );
  }
  return (evidencePath, decisionId) =>
    statuses.get(`${evidencePath}\0${decisionId}`) === true;
}

export function validateApprovedPhaseCommands(manifest) {
  const errors = [];
  const supportedModeIds = (manifest.supportedModes ?? []).map((mode) => mode?.id);
  if (!jsonArrayEqual(supportedModeIds, ["hosted-baseline"])) {
    errors.push("version-one command policy supports exactly hosted-baseline");
  }
  const activePhases = (manifest.phases ?? []).filter(
    (phase) => phase.status === "active",
  );
  const hostedPhases = (manifest.phases ?? []).filter(
    (phase) =>
      phase.status === "active" && phase.modes?.includes("hosted-baseline"),
  );
  const hostedIds = hostedPhases.map((phase) => phase.id);
  if (!jsonArrayEqual(hostedIds, [...APPROVED_HOSTED_COMMANDS.keys()])) {
    errors.push("hosted-baseline phase set/order differs from the approved command policy");
  }
  if (!jsonArrayEqual(activePhases.map((phase) => phase.id), hostedIds)) {
    errors.push("active phase exists outside the approved hosted-baseline command policy");
  }
  for (const phase of hostedPhases) {
    const actual = (phase.commands ?? []).map((command) => command.argv);
    const expected = APPROVED_HOSTED_COMMANDS.get(phase.id);
    if (!expected || !jsonArrayEqual(actual, expected)) {
      errors.push(`phase ${phase.id} command matrix differs from approved policy`);
    }
  }
  for (const phase of manifest.phases ?? []) {
    for (const command of phase.commands ?? []) {
      const argv = command.argv ?? [];
      if (
        (["sh", "bash", "zsh"].includes(argv[0]) && argv[1] === "-c") ||
        (argv[0] === "node" && new Set(["-e", "--eval", "-p", "--print"]).has(argv[1]))
      ) {
        errors.push(`phase ${phase.id} contains prohibited shell/eval indirection`);
      }
    }
  }
  return [...new Set(errors)];
}

function jsonArrayEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export class GateCancellationError extends Error {
  constructor(signalName) {
    super(`received ${signalName}`);
    this.name = "GateCancellationError";
    this.signal = signalName;
    this.exitCode = signalName === "SIGINT" ? 130 : 143;
  }
}

export function createSignalAbortController(processLike = process) {
  const controller = new AbortController();
  const listeners = new Map();
  for (const signalName of ["SIGINT", "SIGTERM"]) {
    const listener = () => {
      if (!controller.signal.aborted) {
        controller.abort(new GateCancellationError(signalName));
      }
    };
    listeners.set(signalName, listener);
    processLike.on(signalName, listener);
  }
  return {
    signal: controller.signal,
    dispose() {
      for (const [signalName, listener] of listeners) {
        processLike.off(signalName, listener);
      }
      listeners.clear();
    },
  };
}

const contractBaselineComparisonCommand = [
  "node",
  "scripts/local-migration/check-contract-baseline.mjs",
];

export function readContractBaselineComparisonEvidence(argv, outputTail) {
  if (!jsonArrayEqual(argv, contractBaselineComparisonCommand)) return null;
  const normalizedOutput = String(outputTail ?? "").replace(
    /\[(?:stdout|stderr)\]\s*/g,
    "",
  );
  const evidenceLines = normalizedOutput
    .split(/\r?\n/)
    .filter((line) => line.startsWith("contract-baseline: ok;"));
  const statuses = evidenceLines.flatMap((line) =>
    [...line.matchAll(/\bbaseComparison=([^\s]+)/g)].map((match) => match[1]),
  );
  if (
    evidenceLines.length !== 1 ||
    statuses.length !== 1 ||
    statuses[0] !== "performed"
  ) {
    throw new Error(
      "contract baseline checker did not emit required baseComparison=performed evidence",
    );
  }
  return "performed";
}

export function assertContractBaselineComparisonPerformed(status) {
  if (status !== "performed") {
    throw new Error(
      "contract-baseline phase did not record required base comparison evidence",
    );
  }
  return status;
}

export function buildPhaseEnvironment(base, phaseId, values) {
  const productionBuildCommands = new Set([
    JSON.stringify(["pnpm", "--filter", "backend", "build"]),
    JSON.stringify(["pnpm", "--filter", "web", "build"]),
  ]);
  const environment = {
    ...base,
    NODE_ENV: productionBuildCommands.has(JSON.stringify(values.commandArgv ?? []))
      ? "production"
      : "test",
  };
  if (phaseId === "contract-baseline") {
    environment.MIGRATION_GATE_REQUIRE_BASE_COMPARISON = "1";
    environment.MIGRATION_GATE_BASE_SHA = values.baseSha;
    environment.MIGRATION_GATE_BASELINE_DIR = values.baseDirectory;
    environment.MIGRATION_GATE_BASELINE_MANIFEST_SHA256 =
      values.baseManifestSha256;
  }
  if (
    new Set([
      "backend-unit-build",
      "backend-database",
      "eval-deterministic-scenarios",
    ]).has(phaseId)
  ) {
    environment.DATABASE_URL = values.databaseUrl;
  }
  if (phaseId === "restart-smoke") {
    environment.MIGRATION_TEST_ADMIN_URL = values.administrationUrl;
    environment.MIGRATION_RESTART_SMOKE_DIAGNOSTICS_DIR = path.join(
      values.diagnosticsDirectory,
      "restart-smoke",
    );
  }
  if (phaseId === "packaged-composition-smoke") {
    environment.MIGRATION_TEST_ADMIN_URL = values.administrationUrl;
    environment.MIGRATION_PACKAGING_SMOKE_DIAGNOSTICS_DIR = path.join(
      values.diagnosticsDirectory,
      "packaging-smoke",
    );
    environment.MIGRATION_PACKAGING_GATE_WORKSPACE = values.workspace;
    environment.MIGRATION_PACKAGING_GATE_OWNERSHIP_MARKER =
      values.workspaceOwnershipMarker;
    environment.MIGRATION_PACKAGING_GATE_OWNERSHIP_FILE =
      values.workspaceOwnershipMarkerPath;
    environment.MIGRATION_PACKAGING_COREPACK_HOME = values.corepackHome;
  }
  if (phaseId === "harbor-static") {
    environment.PYTHON_BIN = values.pythonBin;
    environment.PYTHONPYCACHEPREFIX = values.pythonCacheDirectory;
  }
  if (phaseId === "repository-integrity") {
    environment.MIGRATION_GATE_TRACKED_SDL_SHA256 = values.trackedSdlSha256;
    environment.MIGRATION_GATE_DIAGNOSTICS_DIR = values.diagnosticsDirectory;
  }
  return environment;
}

export function buildIsolatedGitEnvironment(source, temporaryHome) {
  const passThrough = ["PATH", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL"];
  return {
    ...Object.fromEntries(
      passThrough.flatMap((key) =>
        source[key] === undefined ? [] : [[key, source[key]]],
      ),
    ),
    HOME: temporaryHome,
    XDG_CONFIG_HOME: path.join(temporaryHome, ".config"),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_TERMINAL_PROMPT: "0",
  };
}

export function buildIsolatedGateEnvironment(
  source,
  temporaryHome,
  corepackHome,
) {
  if (!path.isAbsolute(temporaryHome) || !path.isAbsolute(corepackHome)) {
    throw new Error("gate HOME and Corepack cache must be absolute disposable paths");
  }
  const passThrough = [
    "PATH",
    "TMPDIR",
    "TMP",
    "TEMP",
    "LANG",
    "LC_ALL",
    "SHELL",
    "TERM",
    "COLORTERM",
  ];
  const environment = Object.fromEntries(
    passThrough.flatMap((key) =>
      source[key] === undefined ? [] : [[key, source[key]]],
    ),
  );
  return {
    ...environment,
    HOME: temporaryHome,
    XDG_CONFIG_HOME: path.join(temporaryHome, ".config"),
    XDG_CACHE_HOME: path.join(temporaryHome, ".cache"),
    CI: "1",
    NODE_ENV: "test",
    NEXT_TELEMETRY_DISABLED: "1",
    PRISMA_HIDE_UPDATE_MESSAGE: "1",
    COREPACK_HOME: corepackHome,
    COREPACK_DEFAULT_TO_LATEST: "0",
    COREPACK_ENABLE_DOWNLOAD_PROMPT: "0",
    COREPACK_ENABLE_NETWORK: "0",
    DO_NOT_TRACK: "1",
    NO_COLOR: "1",
    GRAPHQL_PLAYGROUND: "false",
    GRAPHQL_DEBUG: "false",
    CORS_ORIGIN: "http://localhost:3001",
    MCP_HTTP_ALLOWED_ORIGINS: "http://localhost:3001",
    GCP_PROJECT_ID: "migration-gate-deny-provider",
    GOOGLE_CLOUD_PROJECT: "migration-gate-deny-provider",
    VERTEX_REGION: "us-central1",
    VERTEX_MODEL_ID: "migration-gate-no-live-model",
    METADATA_SERVER_DETECTION: "none",
    DOC_UPLOAD_MAX_BYTES: "10485760",
    DOC_UPLOAD_MAX_SUGGESTIONS: "25",
    MCP_SERVER_URL: "http://127.0.0.1:3001",
    MCP_RESOURCE: "http://127.0.0.1:3001/mcp",
    MCP_HTTP_ENABLED: "true",
    MCP_HTTP_REQUIRE_AUTH: "true",
    MCP_STDIO_ENABLED: "false",
    MCP_TOOLS_PREFERENCES_ENABLED: "true",
    MCP_RESOURCES_SCHEMA_ENABLED: "true",
    AUTH0_DOMAIN: "migration-gate.invalid",
    AUTH0_ISSUER: "https://migration-gate.invalid/",
    AUTH0_AUDIENCE: "urn:context-router:migration-gate",
    AUTH0_CLIENT_ID: "migration-gate-client",
    AUTH0_CLIENT_SECRET: "synthetic-migration-gate-secret",
    AUTH0_MCP_CLAUDE_CLIENT_ID: "migration-gate-claude",
    AUTH0_MCP_CODEX_CLIENT_ID: "migration-gate-codex",
    AUTH0_MCP_FALLBACK_CLIENT_ID: "migration-gate-fallback",
    AUTH0_MCP_PUBLIC_CLIENT_ID: "migration-gate-fallback",
  };
}

export function gitWithoutHooks(args) {
  return [
    "git",
    "-c",
    "core.hooksPath=/dev/null",
    "-c",
    "init.templateDir=",
    ...args,
  ];
}

export function combineFailures(primaryError, secondaryErrors = [], context = "operation") {
  const secondary = secondaryErrors.filter(Boolean);
  if (!primaryError && !secondary.length) return null;
  if (primaryError && !secondary.length) return primaryError;
  const combined = new Error(
    [
      primaryError?.message,
      ...secondary.map((error) => `${context} cleanup/diagnostics failed: ${error.message}`),
    ]
      .filter(Boolean)
      .join("; "),
    { cause: primaryError ?? secondary[0] },
  );
  combined.primaryError = primaryError ?? null;
  combined.secondaryErrors = secondary;
  combined.exitCode = primaryError?.exitCode ?? secondary[0]?.exitCode ?? 1;
  combined.signal = primaryError?.signal ?? secondary[0]?.signal ?? null;
  combined.phase = primaryError?.phase ?? null;
  return combined;
}

const LIFECYCLE_CONTROL_TOKEN_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const LIFECYCLE_STATE_KEYS = new Set([
  "schemaVersion",
  "status",
  "startedAt",
  "resources",
  "finishedAt",
  "error",
]);
const LIFECYCLE_RESOURCE_KEYS = new Set([
  "id",
  "type",
  "owned",
  "identity",
  "recovery",
  "status",
  "cleanup",
  "acquiredAt",
  "recoveryRequired",
]);
const LIFECYCLE_ACQUISITION_KEYS = new Set([
  "id",
  "type",
  "owned",
  "identity",
  "recovery",
]);
const LIFECYCLE_ACQUIRED_UPDATE_KEYS = new Set(["identity", "recovery"]);
const LIFECYCLE_CLEANUP_KEYS = new Set(["status", "finishedAt", "error"]);

function assertLifecycleRecord(value, allowedKeys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  const unexpected = Object.keys(value).filter((key) => !allowedKeys.has(key));
  if (unexpected.length) {
    throw new Error(`${label} has unexpected fields: ${unexpected.join(", ")}`);
  }
}

function assertLifecycleControlToken(value, label) {
  if (
    typeof value !== "string" ||
    !LIFECYCLE_CONTROL_TOKEN_PATTERN.test(value)
  ) {
    throw new Error(`${label} must be a lowercase lifecycle control token`);
  }
  return value;
}

function assertLifecycleTimestamp(value, label) {
  if (
    typeof value !== "string" ||
    !Number.isFinite(Date.parse(value))
  ) {
    throw new Error(`${label} must be an ISO timestamp`);
  }
  return value;
}

function sanitizeLifecycleDynamicValue(value, canaries) {
  if (value === undefined || value === null) return value;
  if (typeof value === "string") return redactSecrets(value, canaries);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeLifecycleDynamicValue(item, canaries));
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        redactSecrets(key, canaries),
        sanitizeLifecycleDynamicValue(item, canaries),
      ]),
    );
  }
  return redactSecrets(String(value), canaries);
}

export function sanitizeResourceLifecycleState(state, canaries = []) {
  assertLifecycleRecord(state, LIFECYCLE_STATE_KEYS, "lifecycle state");
  if (state.schemaVersion !== 1) {
    throw new Error("lifecycle state schemaVersion must be 1");
  }
  if (!Array.isArray(state.resources)) {
    throw new Error("lifecycle state resources must be an array");
  }
  const sanitized = {
    schemaVersion: 1,
    status: assertLifecycleControlToken(state.status, "lifecycle status"),
    startedAt: assertLifecycleTimestamp(
      state.startedAt,
      "lifecycle startedAt",
    ),
    resources: state.resources.map((resource, index) => {
      const label = `lifecycle resource ${index + 1}`;
      assertLifecycleRecord(resource, LIFECYCLE_RESOURCE_KEYS, label);
      if (typeof resource.owned !== "boolean") {
        throw new Error(`${label} owned must be boolean`);
      }
      assertLifecycleRecord(
        resource.cleanup,
        LIFECYCLE_CLEANUP_KEYS,
        `${label} cleanup`,
      );
      const result = {
        id: assertLifecycleControlToken(resource.id, `${label} id`),
        type: assertLifecycleControlToken(resource.type, `${label} type`),
        owned: resource.owned,
        ...(resource.identity === undefined
          ? {}
          : {
              identity: sanitizeLifecycleDynamicValue(
                resource.identity,
                canaries,
              ),
            }),
        ...(resource.recovery === undefined
          ? {}
          : {
              recovery: sanitizeLifecycleDynamicValue(
                resource.recovery,
                canaries,
              ),
            }),
        status: assertLifecycleControlToken(
          resource.status,
          `${label} status`,
        ),
        cleanup: {
          status: assertLifecycleControlToken(
            resource.cleanup.status,
            `${label} cleanup status`,
          ),
          ...(resource.cleanup.finishedAt === undefined
            ? {}
            : {
                finishedAt: assertLifecycleTimestamp(
                  resource.cleanup.finishedAt,
                  `${label} cleanup finishedAt`,
                ),
              }),
          ...(resource.cleanup.error === undefined
            ? {}
            : {
                error: sanitizeLifecycleDynamicValue(
                  resource.cleanup.error,
                  canaries,
                ),
              }),
        },
      };
      if (resource.acquiredAt !== undefined) {
        result.acquiredAt = assertLifecycleTimestamp(
          resource.acquiredAt,
          `${label} acquiredAt`,
        );
      }
      if (resource.recoveryRequired !== undefined) {
        if (typeof resource.recoveryRequired !== "boolean") {
          throw new Error(`${label} recoveryRequired must be boolean`);
        }
        result.recoveryRequired = resource.recoveryRequired;
      }
      return result;
    }),
  };
  if (state.finishedAt !== undefined) {
    sanitized.finishedAt = assertLifecycleTimestamp(
      state.finishedAt,
      "lifecycle finishedAt",
    );
  }
  if (state.error !== undefined) {
    sanitized.error = sanitizeLifecycleDynamicValue(state.error, canaries);
  }
  return sanitized;
}

export function resourceLifecycleDynamicValues(state) {
  if (!state || !Array.isArray(state.resources)) return [];
  return [
    state.error,
    ...state.resources.flatMap((resource) => [
      resource.identity,
      resource.recovery,
      resource.cleanup?.error,
    ]),
  ].filter((value) => value !== undefined);
}

export async function writeSanitizedResourceLifecycleJson(
  filePath,
  state,
  canaries = [],
) {
  return writeSanitizedJson(
    filePath,
    sanitizeResourceLifecycleState(state, canaries),
  );
}

export async function createResourceLifecycleJournal(
  diagnosticsDirectory,
  { canaries = [], filename = "resource-lifecycle.json" } = {},
) {
  const filePath = path.join(diagnosticsDirectory, filename);
  const state = {
    schemaVersion: 1,
    status: "running",
    startedAt: new Date().toISOString(),
    resources: [],
  };
  const persist = () =>
    writeSanitizedResourceLifecycleJson(filePath, state, canaries);
  await persist();
  const resource = (id) => {
    const found = state.resources.find((item) => item.id === id);
    if (!found) throw new Error(`unknown lifecycle resource ${id}`);
    return found;
  };
  return {
    filePath,
    state,
    addCanary(value) {
      if (value && !canaries.includes(value)) canaries.push(value);
    },
    async acquiring(record) {
      assertLifecycleRecord(
        record,
        LIFECYCLE_ACQUISITION_KEYS,
        "lifecycle acquisition",
      );
      if (!record?.id || state.resources.some((item) => item.id === record.id)) {
        throw new Error(
          `duplicate or missing lifecycle resource id: ${record?.id ?? "<missing>"}`,
        );
      }
      assertLifecycleControlToken(record.id, "lifecycle resource id");
      assertLifecycleControlToken(record.type, "lifecycle resource type");
      if (typeof record.owned !== "boolean") {
        throw new Error("lifecycle resource owned must be boolean");
      }
      state.resources.push({
        ...record,
        status: "acquiring",
        cleanup: { status: "pending" },
      });
      await persist();
    },
    async acquired(recordOrId, updates = {}) {
      if (typeof recordOrId !== "string") {
        await this.acquiring(recordOrId);
        return this.acquired(recordOrId.id);
      }
      assertLifecycleRecord(
        updates,
        LIFECYCLE_ACQUIRED_UPDATE_KEYS,
        "lifecycle acquisition update",
      );
      const record = resource(recordOrId);
      const previousIdentity = record.identity;
      Object.assign(record, updates);
      if (updates.identity) {
        record.identity = { ...previousIdentity, ...updates.identity };
      }
      record.status = "acquired";
      record.acquiredAt = new Date().toISOString();
      await persist();
    },
    async cleanupFinished(id, { status = "removed", error } = {}) {
      const record = resource(id);
      record.cleanup = {
        status,
        finishedAt: new Date().toISOString(),
        ...(error
          ? { error: redactSecrets(error.message ?? error, canaries) }
          : {}),
      };
      record.recoveryRequired = status === "failed";
      await persist();
    },
    async finish(status, error) {
      state.status = status;
      state.finishedAt = new Date().toISOString();
      if (error) state.error = redactSecrets(error.message ?? error, canaries);
      await persist();
    },
  };
}

const TERMINAL_RESOURCE_CLEANUP_STATUSES = new Set([
  "clean",
  "closed",
  "exited",
  "not-owned",
  "removed",
]);

export function assertCompletedResourceLifecycle(state) {
  if (state?.schemaVersion !== 1) {
    throw new Error("lifecycle journal schemaVersion must be 1");
  }
  if (!new Set(["passed", "failed", "cancelled"]).has(state?.status)) {
    throw new Error("lifecycle journal has no terminal status");
  }
  if (!Array.isArray(state.resources)) {
    throw new Error("lifecycle journal resources are missing");
  }
  const resourceIds = new Set();
  for (const resource of state.resources) {
    if (
      typeof resource?.id !== "string" ||
      !resource.id ||
      typeof resource.type !== "string" ||
      !resource.type ||
      resourceIds.has(resource.id)
    ) {
      throw new Error("lifecycle journal has a missing or duplicate resource identity");
    }
    resourceIds.add(resource.id);
    if (
      resource.status !== "acquired" ||
      !TERMINAL_RESOURCE_CLEANUP_STATUSES.has(resource.cleanup?.status) ||
      resource.recoveryRequired
    ) {
      throw new Error(
        `lifecycle resource ${resource.id ?? "<unknown>"} is incomplete`,
      );
    }
  }
  return state;
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
  let summaryError;
  try {
    await onSummary(results);
  } catch (error) {
    summaryError = error;
  }
  let cleanupError;
  try {
    await onCleanup();
  } catch (error) {
    cleanupError = error;
  }
  const combined = combineFailures(
    primaryError,
    [summaryError, cleanupError],
    "phase sequence",
  );
  if (combined) throw combined;
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
    signal,
    terminationGraceMs = 5_000,
    closeDeadlineMs = 2_000,
    prepareLogDirectory = (directory) => mkdir(directory, { recursive: true }),
    createLogStream = (filePath) =>
      createWriteStream(filePath, { flags: "w", mode: 0o600 }),
    spawnProcess = spawn,
    inspectProcessGroup = hasLiveProcessGroupMembers,
    signalProcess = process.kill,
  } = {},
) {
  if (!Array.isArray(argv) || !argv.length) throw new Error("command argv is empty");
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) throw new Error("command timeout must be positive");
  if (!Number.isInteger(terminationGraceMs) || terminationGraceMs <= 0) {
    throw new Error("command termination grace must be a positive integer");
  }
  if (!Number.isInteger(closeDeadlineMs) || closeDeadlineMs <= 0) {
    throw new Error("command close deadline must be a positive integer");
  }
  let child;
  let logStream;
  let logFailure;
  const tail = [];
  let tailLength = 0;
  const write = (source) => (chunk) => {
    const tagged = `[${source}] ${chunk}`;
    if (logStream && !logStream.destroyed && !logFailure) {
      logStream.write(tagged);
    }
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
  let terminationReason = null;
  let terminationStarted = false;
  let forceTimeout;
  let closeTimeout;
  let terminationDeadlineAt;
  let settlementDeadlineError;
  let descendantEscalationError;
  const terminationSignalErrors = [];
  const signalProcessTree = (signalName) => {
    if (!child) return false;
    if (process.platform !== "win32" && child.pid) {
      try {
        signalProcess(-child.pid, signalName);
        return true;
      } catch (error) {
        if (error.code !== "ESRCH") throw error;
      }
    }
    return child.kill(signalName);
  };
  const recordSignalFailure = (signalName) => {
    try {
      signalProcessTree(signalName);
    } catch (error) {
      terminationSignalErrors.push(error);
    }
  };
  const startTermination = () => {
    if (!child || terminationStarted) return;
    terminationStarted = true;
    terminationDeadlineAt = performance.now() + terminationGraceMs;
    recordSignalFailure("SIGTERM");
    const diagnosticCloseBudgetMs = Math.min(
      2_000,
      Math.max(1, Math.floor(terminationGraceMs / 4)),
    );
    const processTerminationBudgetMs = Math.max(
      1,
      terminationGraceMs - diagnosticCloseBudgetMs,
    );
    const boundedCloseDeadlineMs = Math.min(
      closeDeadlineMs,
      Math.max(1, Math.floor(processTerminationBudgetMs / 2)),
    );
    const gracefulWindowMs = Math.max(
      0,
      processTerminationBudgetMs - boundedCloseDeadlineMs,
    );
    forceTimeout = setTimeout(() => {
      recordSignalFailure("SIGKILL");
      closeTimeout = setTimeout(() => {
        settlementDeadlineError ??= new Error(
          `command child did not settle within ${terminationGraceMs}ms after termination`,
        );
        recordSignalFailure("SIGKILL");
      }, boundedCloseDeadlineMs);
      closeTimeout.unref();
    }, gracefulWindowMs);
    forceTimeout.unref();
  };
  const terminate = (reason) => {
    if (!terminationReason) terminationReason = reason;
    startTermination();
  };
  const abortListener = () => {
    terminate({
      kind: "abort",
      reason: signal.reason ?? new Error("command aborted"),
    });
  };
  signal?.addEventListener("abort", abortListener, { once: true });

  let result;
  let timeout;
  try {
    if (signal?.aborted) throw signal.reason ?? new Error("command aborted");
    if (logPath) {
      await prepareLogDirectory(path.dirname(logPath));
      if (signal?.aborted) throw signal.reason ?? new Error("command aborted");
      logStream = createLogStream(logPath);
      logStream.on("error", (error) => {
        logFailure ??= error;
        terminate({ kind: "log", reason: error });
      });
    }
    if (signal?.aborted) throw signal.reason ?? new Error("command aborted");
    child = spawnProcess(argv[0], argv.slice(1), {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => stdout.write(chunk));
    child.stderr.on("data", (chunk) => stderr.write(chunk));
    if (terminationReason) startTermination();
    timeout = setTimeout(
      () => terminate({ kind: "timeout" }),
      timeoutMs,
    );
    timeout.unref();
    const childSettlement = new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (exitCode, childSignal) =>
        resolve({ exitCode, signal: childSignal }),
      );
    });
    result = await childSettlement;
    if (
      process.platform !== "win32" &&
      child.pid &&
      (await inspectProcessGroup(child.pid))
    ) {
      // The leader may close before descendants. Do not return control to
      // cleanup until the complete owned process group is observably quiescent.
      descendantEscalationError = new Error(
        "command leader exited while its owned process group remained",
      );
      signalProcessTree("SIGKILL");
      const descendantDeadlineAt = performance.now() + closeDeadlineMs;
      while (await inspectProcessGroup(child.pid)) {
        if (performance.now() >= descendantDeadlineAt) {
          settlementDeadlineError ??= new Error(
            `owned process group ${child.pid} did not settle within ${closeDeadlineMs}ms after SIGKILL`,
          );
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }
    result.closeDeadlineExceeded = Boolean(settlementDeadlineError);
  } finally {
    if (timeout) clearTimeout(timeout);
    if (forceTimeout) clearTimeout(forceTimeout);
    if (closeTimeout) clearTimeout(closeTimeout);
    signal?.removeEventListener("abort", abortListener);
    stdout.end();
    stderr.end();
    if (logStream) {
      await new Promise((resolve) => {
        if (logStream.destroyed) {
          resolve();
          return;
        }
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          clearTimeout(deadline);
          resolve();
        };
        const logCloseBudgetMs = terminationDeadlineAt
          ? Math.max(1, Math.floor(terminationDeadlineAt - performance.now()))
          : 2_000;
        const deadline = setTimeout(() => {
          logFailure ??= new Error(
            `diagnostic log did not close within ${logCloseBudgetMs}ms`,
          );
          logStream.destroy();
          finish();
        }, logCloseBudgetMs);
        logStream.once("finish", finish);
        logStream.once("close", finish);
        logStream.end();
      });
    }
  }

  let commandError;
  let logError;
  if (logFailure || terminationReason?.kind === "log") {
    logError = new Error(
      `diagnostic log failed for command ${redactSecrets(argv.join(" "), canaries)}: ${redactSecrets(logFailure?.message ?? terminationReason.reason?.message ?? "unknown log error", canaries)}`,
      { cause: logFailure ?? terminationReason.reason },
    );
    logError.exitCode = 1;
    logError.signal = result?.signal ?? null;
    logError.outputTail = tail.join("");
  }
  if (terminationReason?.kind === "timeout") {
    const error = new Error(
      `command timed out after ${timeoutMs}ms: ${redactSecrets(argv.join(" "), canaries)}`,
    );
    error.exitCode = 124;
    error.signal = result?.signal ?? null;
    error.outputTail = tail.join("");
    commandError = error;
  }
  if (terminationReason?.kind === "abort") {
    const reason = terminationReason.reason;
    const error = new Error(
      `command aborted: ${redactSecrets(reason?.message ?? reason, canaries)}: ${redactSecrets(argv.join(" "), canaries)}`,
      { cause: reason instanceof Error ? reason : undefined },
    );
    error.exitCode = reason?.exitCode ??
      (reason?.message?.includes("SIGINT") ? 130 : 143);
    error.signal = reason?.signal ??
      reason?.message?.match(/SIG(?:INT|TERM)/)?.[0] ?? null;
    error.outputTail = tail.join("");
    commandError = error;
  }
  if (!commandError && result.exitCode !== 0) {
    const error = new Error(
      `command exited ${result.exitCode ?? `on ${result.signal}`}: ${redactSecrets(argv.join(" "), canaries)}`,
    );
    error.exitCode = result.exitCode ?? 1;
    error.signal = result.signal;
    error.outputTail = tail.join("");
    commandError = error;
  }
  const combined = combineFailures(
    commandError,
    [
      logError,
      settlementDeadlineError,
      descendantEscalationError,
      ...terminationSignalErrors,
    ],
    "command",
  );
  if (combined) throw combined;
  return { ...result, outputTail: tail.join("") };
}

function assertSafeRelativePath(relativePath) {
  const parts = typeof relativePath === "string"
    ? relativePath.split("/")
    : [];
  if (
    typeof relativePath !== "string" ||
    !relativePath ||
    path.isAbsolute(relativePath) ||
    path.win32.isAbsolute(relativePath) ||
    relativePath.includes("\\") ||
    parts.some((part) => !part || part === "." || part === "..") ||
    relativePath.includes("\0") ||
    path.posix.normalize(relativePath) !== relativePath
  ) {
    throw new Error(`unsafe workspace path: ${relativePath}`);
  }
}

export async function resolveOwnedArtifactPath(root, relativePath) {
  assertSafeRelativePath(relativePath);
  const rootReal = await realpath(root);
  const candidate = path.resolve(rootReal, relativePath);
  if (!pathIsWithin(rootReal, candidate)) {
    throw new Error(`unsafe owned artifact path: ${relativePath}`);
  }
  let current = rootReal;
  for (const segment of relativePath.split(/[\\/]/).slice(0, -1)) {
    current = path.join(current, segment);
    const info = await lstat(current).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (info?.isSymbolicLink() || (info && !info.isDirectory())) {
      throw new Error(`owned artifact parent is not a safe directory: ${relativePath}`);
    }
    if (!info) break;
  }
  const destination = await lstat(candidate).catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (destination) {
    throw new Error(`owned artifact destination already exists: ${relativePath}`);
  }
  return candidate;
}

function throwIfAborted(signal, fallbackMessage = "operation aborted") {
  if (signal?.aborted) {
    throw signal.reason ?? new Error(fallbackMessage);
  }
}

export async function copyWorkspaceFiles(
  sourceRoot,
  targetRoot,
  files,
  { signal } = {},
) {
  throwIfAborted(signal, "workspace copy aborted");
  await mkdir(targetRoot, { recursive: true });
  for (const relativePath of files) {
    throwIfAborted(signal, "workspace copy aborted");
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
      if (path.isAbsolute(linkTarget)) {
        throw new Error(`absolute workspace symlink is forbidden: ${relativePath}`);
      }
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
    throwIfAborted(signal, "workspace copy aborted");
  }
}

async function hashFile(filePath, signal) {
  throwIfAborted(signal, "caller integrity hashing aborted");
  const content = await readFile(filePath, signal ? { signal } : undefined);
  throwIfAborted(signal, "caller integrity hashing aborted");
  return createHash("sha256").update(content).digest("hex");
}

async function hashPath(targetPath, signal) {
  throwIfAborted(signal, "caller integrity hashing aborted");
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
  if (info.isFile()) {
    return {
      exists: true,
      kind: "file",
      sha256: await hashFile(targetPath, signal),
    };
  }
  if (info.isDirectory()) {
    const entries = [];
    async function visit(directory, relative = "") {
      throwIfAborted(signal, "caller integrity hashing aborted");
      for (const name of (await readdir(directory)).sort()) {
        throwIfAborted(signal, "caller integrity hashing aborted");
        const absolute = path.join(directory, name);
        const childRelative = path.join(relative, name);
        const child = await lstat(absolute);
        if (child.isDirectory()) await visit(absolute, childRelative);
        else if (child.isFile()) {
          entries.push([childRelative, await hashFile(absolute, signal)]);
        }
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

export async function captureCallerIntegrity(paths, { signal } = {}) {
  const snapshot = new Map();
  for (const targetPath of paths) {
    throwIfAborted(signal, "caller integrity capture aborted");
    snapshot.set(targetPath, await hashPath(targetPath, signal));
  }
  return snapshot;
}

export async function assertCallerIntegrity(snapshot, { signal } = {}) {
  const changed = [];
  for (const [targetPath, before] of snapshot) {
    throwIfAborted(signal, "caller integrity assertion aborted");
    const after = await hashPath(targetPath, signal);
    if (JSON.stringify(before) !== JSON.stringify(after)) changed.push(targetPath);
  }
  if (changed.length) throw new Error(`caller path changed during disposable gate: ${changed.join(", ")}`);
}

function pathIsWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function cloneDirectoryIsolated(source, target, allowedSourceRoot, signal) {
  await mkdir(target, { recursive: true });
  for (const name of (await readdir(source)).sort()) {
    if (signal?.aborted) throw signal.reason ?? new Error("dependency clone aborted");
    const sourcePath = path.join(source, name);
    const targetPath = path.join(target, name);
    const info = await lstat(sourcePath);
    if (info.isDirectory()) {
      await cloneDirectoryIsolated(sourcePath, targetPath, allowedSourceRoot, signal);
    } else if (info.isFile()) {
      await copyFile(sourcePath, targetPath, fsConstants.COPYFILE_FICLONE);
    } else if (info.isSymbolicLink()) {
      const linkTarget = await readlink(sourcePath);
      if (path.isAbsolute(linkTarget)) {
        throw new Error(`absolute dependency symlink is forbidden: ${sourcePath}`);
      }
      const resolved = path.resolve(path.dirname(sourcePath), linkTarget);
      if (!pathIsWithin(allowedSourceRoot, resolved)) {
        throw new Error(`dependency symlink escapes the repository: ${sourcePath}`);
      }
      await symlink(linkTarget, targetPath);
    } else {
      throw new Error(`unsupported dependency entry: ${sourcePath}`);
    }
  }
}

export async function cloneCorepackCache(
  source,
  target,
  { signal, requiredPnpmVersion } = {},
) {
  const sourceRoot = await realpath(source).catch(() => null);
  if (!sourceRoot) {
    throw new Error(
      `offline migration gate requires an existing Corepack cache: ${source}`,
    );
  }
  const pnpmRoot = path.join(sourceRoot, "v1", "pnpm");
  const versions = await readdir(pnpmRoot, { withFileTypes: true }).catch(
    () => [],
  );
  const cachedPnpmVersions = versions.filter((entry) => entry.isDirectory());
  if (!cachedPnpmVersions.length) {
    throw new Error(
      `offline migration gate requires a cached pnpm distribution under ${pnpmRoot}`,
    );
  }
  if (
    requiredPnpmVersion &&
    !cachedPnpmVersions.some((entry) => entry.name === requiredPnpmVersion)
  ) {
    throw new Error(
      `offline migration gate requires cached pnpm ${requiredPnpmVersion}`,
    );
  }
  await cloneDirectoryIsolated(sourceRoot, target, sourceRoot, signal);
  return cachedPnpmVersions.map((entry) => entry.name).sort();
}

export async function cloneDependencyTrees(
  sourceRoot,
  targetRoot,
  relativeRoots,
  { signal } = {},
) {
  const allowedSourceRoot = await realpath(sourceRoot);
  for (const relativeRoot of relativeRoots) {
    const source = path.join(allowedSourceRoot, relativeRoot, "node_modules");
    try {
      const info = await stat(source);
      if (!info.isDirectory()) continue;
    } catch {
      continue;
    }
    const target = path.join(targetRoot, relativeRoot, "node_modules");
    await mkdir(path.dirname(target), { recursive: true });
    await cloneDirectoryIsolated(source, target, allowedSourceRoot, signal);
  }
}

export async function prepareOwnedTemporaryDirectory(
  prefix,
  prepare,
  {
    onCreated = () => {},
    cleanupOnFailure = true,
    setPrivateMode = (directory) => chmod(directory, 0o700),
  } = {},
) {
  const directory = await mkdtemp(prefix);
  try {
    // Hand the exact allocation to the outer owner before chmod or any other
    // fallible preparation so bounded recovery never loses the path.
    await onCreated(directory);
    await setPrivateMode(directory);
    const value = await prepare(directory);
    return { directory, value };
  } catch (error) {
    if (cleanupOnFailure) {
      await rm(directory, { recursive: true, force: true });
    }
    throw error;
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
  const directory = path.dirname(filePath);
  await mkdir(directory, { recursive: true });
  const content = `${redactSecrets(JSON.stringify(value, null, 2), canaries)}\n`;
  const temporaryPath = path.join(
    directory,
    `.${path.basename(filePath)}.tmp-${process.pid}-${randomBytes(8).toString("hex")}`,
  );
  let handle;
  try {
    handle = await open(temporaryPath, "wx", 0o600);
    await handle.writeFile(content, { encoding: "utf8" });
    await handle.sync();
    await handle.close();
    handle = null;
    await rename(temporaryPath, filePath);
  } finally {
    await handle?.close().catch(() => {});
    await rm(temporaryPath, { force: true }).catch(() => {});
  }
}
