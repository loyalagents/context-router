#!/usr/bin/env node
// Two reviewed CI projections, not a general phase scheduler.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { validateApprovedPhaseCommands, validatePhaseManifest } from "./gate-runner.mjs";

const PROFILES = Object.freeze({
  "ci-source": Object.freeze(["contract-baseline", "documentation", "backend-unit-build", "backend-database", "local-orchestrator", "eval-fixtures", "eval-deterministic-scenarios", "web-production-build", "harbor-static", "restart-smoke", "repository-integrity"]),
  "ci-packaging": Object.freeze(["packaged-composition-smoke", "repository-integrity"]),
});
const COMPLETION = Object.freeze({ boundedStages: true, preflight: true, childSettlement: true, workspaceRemoved: true, diagnosticsRemoved: true, gateLifecycle: true });
const MAX_RECEIPT_BYTES = 262144;
const hash = value => createHash("sha256").update(value).digest("hex");
const fail = message => { throw new Error("CI qualification " + message); };
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
  if (argv.length === 1 && ["--smoke-only", "--ci-source", "--ci-packaging"].includes(argv[0])) return argv[0].slice(2);
  fail("argument profile must be full, --smoke-only, --ci-source or --ci-packaging");
}
export function selectQualificationPhases(manifest, profile) {
  validateManifest(manifest);
  if (profile === "full") return manifest.phases.filter(p => p.status === "active");
  requireValue(Object.hasOwn(PROFILES, profile), "unknown profile");
  return PROFILES[profile].map(id => manifest.phases.find(p => p.id === id));
}
export function qualificationContract(manifestText, schemaText) {
  const manifest = JSON.parse(manifestText);
  validateManifest(manifest);
  JSON.parse(schemaText);
  const coverage = Object.fromEntries(Object.keys(PROFILES).map(profile => [profile,
    selectQualificationPhases(manifest, profile).map(p => ({
      id: p.id, commands: p.commands.map(c => c.argv), modes: p.modes, evidenceClasses: p.evidenceClasses,
    })),
  ]));
  return {
    manifestSha256: hash(manifestText), schemaSha256: hash(schemaText),
    partitionVersion: 1, partitionSha256: hash(JSON.stringify({ version: 1, profiles: PROFILES })),
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
  validateProvenance(result);
  return result;
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
  return profile === "ci-source" ? { "restart-smoke": true } : { "packaged-composition-smoke": true };
}
function validateReceipt(receipt, contract) {
  keys(receipt, ["schemaVersion", "profile", "status", "provenance", "source", "base", "contract", "versions", "runner", "coverage", "verification", "completion"], "receipt");
  equal(receipt.schemaVersion, 1, "receipt schema");
  requireValue(Object.hasOwn(PROFILES, receipt.profile), "receipt lane invalid");
  equal(receipt.status, "passed", "receipt status");
  validateProvenance(receipt.provenance); validateSource(receipt.source, receipt.provenance);
  keys(receipt.base, ["sha", "manifestSha256"], "base");
  hex(receipt.base.sha, 40, "base"); hex(receipt.base.manifestSha256, 64, "base manifest");
  equal(receipt.contract, contractIdentity(contract), "contract");
  validateVersions(receipt.versions);
  keys(receipt.runner, ["os", "arch", "image", "imageVersion"], "runner");
  equal(receipt.runner.os, "Linux", "receipt runner OS");
  equal(receipt.runner.arch, "X64", "receipt runner architecture");
  for (const field of ["image", "imageVersion"]) token(receipt.runner[field], /^[A-Za-z0-9_.-]+$/, "receipt runner image");
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
  equal(expected.dependencyResults, { source: "success", packaging: "success" }, "dependency results");
  requireValue(Array.isArray(receipts) && receipts.length === 2, "receipt pair missing or duplicated");
  equal(receipts.map(r => r?.profile).sort(), Object.keys(PROFILES).sort(), "receipt lanes");
  for (const receipt of receipts) {
    validateReceipt(receipt, expected.contract);
    equal(receipt.provenance, expected.provenance, "provenance");
    equal(receipt.source, expected.source, "source");
    equal(receipt.base, expected.base, "base");
  }
  equal(receipts[0].versions, receipts[1].versions, "toolchain across lanes");
  equal(receipts[0].runner, receipts[1].runner, "receipt runner across lanes");
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
  equal((await readdir(directory)).sort(), ["ci-packaging.json", "ci-source.json"], "receipt files");
  const result = [];
  for (const profile of Object.keys(PROFILES)) {
    const file = path.join(directory, profile + ".json");
    const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK).catch(() => fail("receipt must be a regular non-symlink file"));
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
