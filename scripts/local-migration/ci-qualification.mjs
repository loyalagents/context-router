#!/usr/bin/env node
// Three reviewed CI projections, not a general phase scheduler.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { validateApprovedPhaseCommands, validatePhaseManifest } from "./gate-runner.mjs";

const PROFILES = Object.freeze({
  "ci-source": Object.freeze(["contract-baseline", "documentation", "backend-unit-build", "backend-database", "local-orchestrator", "eval-fixtures", "eval-deterministic-scenarios", "harbor-static", "restart-smoke", "repository-integrity"]),
  "ci-packaging": Object.freeze(["packaged-composition-smoke", "repository-integrity"]),
  "ci-ui": Object.freeze(["web-production-build", "repository-integrity"]),
});
// Fixed prerequisites execute inside the existing web phase work budget. They
// are part of the CI partition/receipt census, never the full local manifest.
const UI_PREPARATION = Object.freeze([
  Object.freeze(["pnpm", "--filter", "backend", "prisma:generate"]),
  Object.freeze(["pnpm", "--filter", "backend", "build"]),
]);
const COMPLETION = Object.freeze({ boundedStages: true, preflight: true, childSettlement: true, workspaceRemoved: true, diagnosticsRemoved: true, gateLifecycle: true });
const MAX_RECEIPT_BYTES = 262144;
const hash = value => createHash("sha256").update(value).digest("hex");
const PUBLIC_FAILURES = new Set([
  "dependency-results", "receipt-invalid", "receipt-files", "provenance", "source",
  "base", "contract", "runner-toolchain", "invocation",
]);
export class QualificationError extends Error {
  constructor(code, message = "validation failed") {
    super("CI qualification " + message);
    this.code = code;
  }
}
export function formatQualificationFailure(error) {
  const category = error instanceof QualificationError && PUBLIC_FAILURES.has(error.code)
    ? error.code : "validation-incomplete";
  return "ci-qualification: failed; " + category;
}
function inCategory(code, operation) {
  try { return operation(); }
  catch (error) {
    if (error instanceof QualificationError) throw new QualificationError(code, error.message);
    throw error;
  }
}
const fail = message => { throw new QualificationError("receipt-invalid", message); };
function requireValue(condition, message) { if (!condition) fail(message); }
function equal(actual, expected, label) {
  try { assert.deepEqual(actual, expected); } catch { fail(label + " mismatch"); }
}
function keys(value, expected, label) {
  requireValue(value && typeof value === "object" && !Array.isArray(value), label + " must be an object");
  equal(Object.keys(value).sort(), [...expected].sort(), label + " fields");
}
function hex(value, length, label) {
  requireValue(typeof value === "string" && new RegExp("^[a-f0-9]{" + length + "}$").test(value) && !/^0+$/.test(value), label + " identity invalid");
}
function token(value, pattern, label) {
  requireValue(typeof value === "string" && value.length <= 512 && pattern.test(value), label + " invalid");
}
function validateManifest(manifest) {
  const errors = [...validatePhaseManifest(manifest), ...validateApprovedPhaseCommands(manifest)];
  requireValue(!errors.length, "manifest/command policy invalid: " + errors.join("; "));
}
export function parseQualificationProfile(argv) {
  if (!argv.length) return "full";
  if (argv.length === 1 && ["--smoke-only", "--ci-source", "--ci-packaging", "--ci-ui"].includes(argv[0])) return argv[0].slice(2);
  throw new QualificationError("invocation", "argument profile must be full, --smoke-only, --ci-source, --ci-packaging or --ci-ui");
}
export function selectQualificationPhases(manifest, profile) {
  inCategory("contract", () => validateManifest(manifest));
  if (profile === "full") return manifest.phases.filter(p => p.status === "active");
  requireValue(Object.hasOwn(PROFILES, profile), "unknown profile");
  return PROFILES[profile].map(id => {
    const phase = manifest.phases.find(p => p.id === id);
    return profile === "ci-ui" && id === "web-production-build"
      ? { ...phase, commands: [...UI_PREPARATION.map(argv => ({ argv: [...argv] })), ...phase.commands] }
      : phase;
  });
}
export function qualificationContract(manifestText, schemaText) {
  const manifest = JSON.parse(manifestText);
  inCategory("contract", () => validateManifest(manifest));
  JSON.parse(schemaText);
  const coverage = Object.fromEntries(Object.keys(PROFILES).map(profile => [profile,
    selectQualificationPhases(manifest, profile).map(p => ({
      id: p.id, commands: p.commands.map(c => c.argv), modes: p.modes, evidenceClasses: p.evidenceClasses,
    })),
  ]));
  return {
    manifestSha256: hash(manifestText), schemaSha256: hash(schemaText),
    partitionVersion: 2, partitionSha256: hash(JSON.stringify({ version: 2, profiles: PROFILES, uiPreparation: UI_PREPARATION })),
    coverage,
  };
}
function contractIdentity(contract) {
  const { coverage, ...identity } = contract;
  return identity;
}
function validateProvenance(provenance) {
  keys(provenance, ["repository", "event", "workflowRef", "runId", "runAttempt", "checkoutSha", "pullRequestHeadSha"], "provenance");
  token(provenance.repository, /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, "repository");
  requireValue(["push", "pull_request"].includes(provenance.event), "provenance event invalid");
  requireValue(typeof provenance.workflowRef === "string" && provenance.workflowRef.startsWith(provenance.repository + "/.github/workflows/local-migration-baseline.yml@refs/") && !/[\r\n\0]/.test(provenance.workflowRef), "provenance workflow invalid");
  for (const key of ["runId", "runAttempt"]) token(provenance[key], /^[1-9][0-9]*$/, "provenance " + key);
  hex(provenance.checkoutSha, 40, "provenance checkout");
  if (provenance.event === "pull_request") hex(provenance.pullRequestHeadSha, 40, "provenance PR head");
  else equal(provenance.pullRequestHeadSha, null, "provenance push PR head");
}
export function qualificationProvenance(environment) {
  const result = {
    repository: environment.GITHUB_REPOSITORY, event: environment.GITHUB_EVENT_NAME,
    workflowRef: environment.GITHUB_WORKFLOW_REF, runId: environment.GITHUB_RUN_ID,
    runAttempt: environment.GITHUB_RUN_ATTEMPT, checkoutSha: environment.GITHUB_SHA,
    pullRequestHeadSha: environment.MIGRATION_GATE_PR_HEAD_SHA || null,
  };
  inCategory("provenance", () => validateProvenance(result));
  return result;
}
// GitHub PR checkouts are test merges; agreement between receipt metadata alone
// does not prove that the claimed PR head participates in the checked-out commit.
export async function verifyQualificationCheckout(provenance, git) {
  const result = await git(["rev-list", "--parents", "-n", "1", "HEAD"]);
  inCategory("provenance", () => {
    requireValue(result.exitCode === 0 && typeof result.stdout === "string", "checkout ancestry unavailable");
    const commits = result.stdout.trim().split(/\s+/);
    commits.forEach(sha => hex(sha, 40, "checkout ancestry"));
    equal(commits[0], provenance.checkoutSha, "actual checkout HEAD");
    if (provenance.event === "pull_request") {
      equal(commits.length, 3, "PR merge parent count");
      equal(commits[2], provenance.pullRequestHeadSha, "PR merge second parent");
    }
  });
}
export function qualificationRunner(environment) {
  return { os: environment.RUNNER_OS, arch: environment.RUNNER_ARCH, image: environment.ImageOS, imageVersion: environment.ImageVersion };
}
function validateSource(source, provenance) {
  keys(source, ["headSha", "dirty", "copiedInputsSha256"], "source");
  hex(source.headSha, 40, "source HEAD"); hex(source.copiedInputsSha256, 64, "source copied inputs");
  equal(source.headSha, provenance.checkoutSha, "source checkout");
  equal(source.dirty, false, "source clean state");
}
function validateVersions(versions) {
  keys(versions, ["node", "pnpm", "python", "postgres", "chromium", "playwright"], "toolchain");
  equal(versions.node, "v24.21.0", "toolchain Node");
  equal(versions.pnpm, "10.25.0", "toolchain pnpm");
  token(versions.python, /^3\.12\.[0-9]+$/, "toolchain Python");
  token(versions.postgres, /^15\.[0-9]+(?: \([^\r\n]*\))?$/, "toolchain PostgreSQL");
  token(versions.chromium, /^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$/, "toolchain Chromium");
  equal(versions.playwright, "1.63.0", "toolchain Playwright");
}
function smokeFor(profile) {
  return profile === "ci-source" ? { "restart-smoke": true }
    : profile === "ci-packaging" ? { "packaged-composition-smoke": true } : {};
}
function validateReceipt(receipt, contract) {
  keys(receipt, ["schemaVersion", "profile", "status", "provenance", "source", "base", "contract", "versions", "runner", "coverage", "verification", "completion"], "receipt");
  equal(receipt.schemaVersion, 1, "receipt schema");
  requireValue(Object.hasOwn(PROFILES, receipt.profile), "receipt lane invalid");
  equal(receipt.status, "passed", "receipt status");
  inCategory("provenance", () => validateProvenance(receipt.provenance));
  inCategory("source", () => validateSource(receipt.source, receipt.provenance));
  inCategory("base", () => {
    keys(receipt.base, ["sha", "manifestSha256"], "base");
    hex(receipt.base.sha, 40, "base"); hex(receipt.base.manifestSha256, 64, "base manifest");
  });
  inCategory("contract", () => equal(receipt.contract, contractIdentity(contract), "contract"));
  inCategory("runner-toolchain", () => {
    validateVersions(receipt.versions);
    keys(receipt.runner, ["os", "arch", "image", "imageVersion"], "runner");
    equal(receipt.runner.os, "Linux", "receipt runner OS");
    equal(receipt.runner.arch, "X64", "receipt runner architecture");
    token(receipt.runner.image, /^ubuntu[0-9]{2}$/, "receipt runner image family");
    token(receipt.runner.imageVersion, /^[A-Za-z0-9_.-]+$/, "receipt runner image release");
  });
  equal(receipt.completion, COMPLETION, "completion");
  equal(receipt.verification, {
    callerIntegrity: true, generatedIntegrity: true, cleanup: true,
    baseComparison: receipt.profile === "ci-source" ? "performed" : "not-in-profile",
    smokeLifecycle: smokeFor(receipt.profile),
  }, "integrity/lifecycle/cleanup verification");
  requireValue(Array.isArray(receipt.coverage), "coverage missing");
  equal(receipt.coverage.length, contract.coverage[receipt.profile].length, "coverage census");
  receipt.coverage.forEach((row, index) => {
    keys(row, ["id", "commands", "modes", "evidenceClasses", "status", "elapsedMs"], "coverage");
    const { status, elapsedMs, ...covered } = row;
    equal(covered, contract.coverage[receipt.profile][index], "coverage");
    equal(status, "passed", "coverage outcome");
    requireValue(Number.isSafeInteger(elapsedMs) && elapsedMs >= 0, "coverage duration invalid");
  });
  return receipt;
}
export function createLaneReceipt({ profile, summary, completion, contract, provenance, runner }) {
  requireValue(Object.hasOwn(PROFILES, profile), "receipt profile invalid");
  equal(summary.status, "passed", "receipt finalized status");
  equal(summary.mode, profile, "receipt finalized profile");
  equal(summary.failure, null, "receipt failure");
  equal(summary.cleanupErrors, [], "cleanup errors");
  requireValue(!Object.hasOwn(summary, "cleanupPending"), "cleanup pending");
  equal(summary.callerIntegrity, true, "caller integrity");
  equal(summary.baseComparison, profile === "ci-source" ? "performed" : "not-in-profile", "base comparison");
  equal(summary.smokeLifecycle, smokeFor(profile), "smoke lifecycle");
  equal(summary.cleanup?.map(({ resource, status }) => ({ resource, status })), [
    { resource: "database", status: "removed" }, { resource: "administration", status: "clean" },
  ], "cleanup resource census");
  equal(summary.phases?.map(({ id, status }) => ({ id, status })), PROFILES[profile].map(id => ({ id, status: "passed" })), "receipt phase outcomes");
  const receipt = {
    schemaVersion: 1, profile, status: "passed", provenance, source: summary.source,
    base: { sha: summary.baseSha, manifestSha256: summary.baseManifestSha256 },
    contract: contractIdentity(contract), versions: summary.versions, runner,
    coverage: contract.coverage[profile].map((row, i) => ({ ...row, status: summary.phases[i].status, elapsedMs: summary.phases[i].elapsedMs })),
    verification: { callerIntegrity: summary.callerIntegrity, generatedIntegrity: summary.phases.at(-1).status === "passed", cleanup: true, baseComparison: summary.baseComparison, smokeLifecycle: summary.smokeLifecycle },
    completion,
  };
  return structuredClone(validateReceipt(receipt, contract));
}
export function validateLaneReceipts(receipts, expected) {
  inCategory("dependency-results", () => equal(expected.dependencyResults, { source: "success", packaging: "success", ui: "success" }, "dependency results"));
  requireValue(Array.isArray(receipts) && receipts.length === 3, "receipt set missing or duplicated");
  equal(receipts.map(r => r?.profile).sort(), Object.keys(PROFILES).sort(), "receipt lanes");
  for (const receipt of receipts) {
    validateReceipt(receipt, expected.contract);
    inCategory("provenance", () => equal(receipt.provenance, expected.provenance, "provenance"));
    inCategory("source", () => equal(receipt.source, expected.source, "source"));
    inCategory("base", () => equal(receipt.base, expected.base, "base"));
  }
  // Supported Python/Postgres patches and image releases can roll out between
  // runners. Platform/image family and pinned runtimes/browser must still match.
  inCategory("runner-toolchain", () => {
    for (const receipt of receipts.slice(1)) {
      for (const field of ["node", "pnpm", "playwright", "chromium"]) {
        equal(receipts[0].versions[field], receipt.versions[field], "toolchain across lanes " + field);
      }
      for (const field of ["os", "arch", "image"]) {
        equal(receipts[0].runner[field], receipt.runner[field], "receipt runner across lanes " + field);
      }
    }
  });
  return { status: "passed", source: expected.source, base: expected.base, provenance: expected.provenance };
}
// The target is acquired exclusively; cleanup never removes a preexisting or
// replaced path. Late failure may invalidate a receipt, never replace the failure.
export async function publishLaneReceipt(target, receipt, { signal, assertDeadline = () => {}, write } = {}) {
  let handle, identity;
  const check = () => { if (signal?.aborted) throw signal.reason ?? new Error("receipt publication cancelled"); assertDeadline(); };
  try {
    check();
    handle = await open(target, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    identity = await handle.stat();
    const content = JSON.stringify(receipt, null, 2) + "\n";
    requireValue(Buffer.byteLength(content) <= MAX_RECEIPT_BYTES, "receipt size bound exceeded");
    if (write) await write(target, content); else await handle.writeFile(content);
    await handle.sync();
    check();
    const current = await lstat(target);
    requireValue(current.isFile() && !current.isSymbolicLink() && current.dev === identity.dev && current.ino === identity.ino, "receipt publication identity changed");
    await handle.close(); handle = null;
    check();
  } catch (error) {
    await handle?.close().catch(() => {});
    if (identity) {
      const current = await lstat(target).catch(() => null);
      if (current?.isFile() && !current.isSymbolicLink() && current.dev === identity.dev && current.ino === identity.ino) await rm(target).catch(() => {});
    }
    throw error;
  }
}
export async function readLaneReceipts(directory) {
  const files = await readdir(directory);
  inCategory("receipt-files", () => equal(files.sort(), ["ci-packaging.json", "ci-source.json", "ci-ui.json"], "receipt files"));
  const result = [];
  for (const profile of Object.keys(PROFILES)) {
    const file = path.join(directory, profile + ".json");
    const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK).catch(error => {
      if (error.code === "ELOOP") throw new QualificationError("receipt-files", "receipt must be a regular non-symlink file");
      throw error;
    });
    try {
      const before = await handle.stat();
      requireValue(before.isFile() && before.size > 0 && before.size <= MAX_RECEIPT_BYTES, "receipt file size/type bound invalid");
      const buffer = Buffer.alloc(MAX_RECEIPT_BYTES + 1);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      const after = await handle.stat(), current = await lstat(file);
      requireValue(bytesRead === before.size && before.size === after.size && before.mtimeMs === after.mtimeMs && current.isFile() && !current.isSymbolicLink() && current.dev === before.dev && current.ino === before.ino, "receipt changed while reading");
      const receipt = JSON.parse(buffer.subarray(0, bytesRead).toString("utf8"));
      equal(receipt.profile, profile, "receipt filename lane");
      result.push(receipt);
    } finally { await handle.close(); }
  }
  return result;
}
