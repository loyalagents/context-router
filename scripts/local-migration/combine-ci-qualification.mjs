#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { validateMergeBase } from "./gate-runner.mjs";
import {
  qualificationContract, qualificationProvenance,
  readLaneReceipts, validateLaneReceipts,
} from "./ci-qualification.mjs";

async function combineFromEnvironment(environment = process.env) {
  const dependencyResults = { source: environment.SOURCE_RESULT, packaging: environment.PACKAGING_RESULT };
  assert.deepEqual(dependencyResults, { source: "success", packaging: "success" }, "dependency results");
  const repositoryRoot = path.resolve(import.meta.dirname, "../..");
  const exec = promisify(execFile);
  const git = async args => {
    try { const r = await exec("git", args, { cwd: repositoryRoot, timeout: 30000 }); return { exitCode: 0, stdout: r.stdout }; }
    catch (error) { return { exitCode: error.code, stdout: error.stdout }; }
  };
  const provenance = qualificationProvenance(environment);
  const baseSha = await validateMergeBase(environment.MIGRATION_GATE_BASE_SHA, git);
  const runnerTemp = await realpath(environment.RUNNER_TEMP);
  const receipts = await readLaneReceipts(path.join(runnerTemp, "qualification-receipts"));
  const contract = qualificationContract(
    await readFile(path.join(repositoryRoot, "scripts/local-migration/gate-phases.json"), "utf8"),
    await readFile(path.join(repositoryRoot, "scripts/local-migration/gate-phases.schema.json"), "utf8"),
  );
  // Recompute source and base input bindings independently in owned scratch space.
  // No package install, generator, application build, database or browser runs here.
  const { copyGateSourceInputs, exportBaseContracts } = await import("./migration-gate.mjs");
  const scratch = await mkdtemp(path.join(runnerTemp, "qualification-verify-"));
  try {
    const { source } = await copyGateSourceInputs(repositoryRoot, path.join(scratch, "source"));
    const base = await exportBaseContracts(baseSha, scratch);
    const combined = validateLaneReceipts(receipts, { contract, provenance, source, base: { sha: baseSha, manifestSha256: base.manifestSha256 }, dependencyResults });
    console.log("ci-qualification: passed; both finalized lanes, all approved coverage and source/base bindings verified");
    return combined;
  } finally { await rm(scratch, { recursive: true, force: true }); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    assert.ok(process.argv.length === 3 && process.argv[2] === "--combine", "argument must be --combine");
    await combineFromEnvironment();
  } catch (error) {
    // Receipt content is untrusted: do not echo values or arbitrary parse errors.
    console.error("ci-qualification: failed; required dependency, receipt or provenance validation did not complete");
    process.exitCode = 1;
  }
}
