import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import * as syncFs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";
import { runCommand, runPhaseSequence, combineFailures } from "./gate-runner.mjs";
import {
  collectDatabaseEvidence,
  createDatabaseEvidenceSession,
  exportDatabaseEvidence,
  parseDatabaseEvidence,
  persistDatabaseEvidence,
  projectDatabaseCommandFailure,
  runWithDatabaseEvidence,
} from "./local-database-evidence.mjs";
import Reporter from "./local-database-reporter.cjs";
import { executeGatePhaseCommand } from "./migration-gate.mjs";

const require = createRequire(new URL("../../apps/backend/package.json", import.meta.url));
const jest = require.resolve("jest/bin/jest");
const source = { headSha: "a".repeat(40), dirty: true, copiedInputsSha256: "b".repeat(64) };
const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const reporter = fileURLToPath(new URL("./local-database-reporter.cjs", import.meta.url));
const capture = promisify(execFile);

async function fixture(t) {
  const root = await fs.realpath(await mkdtemp(path.join(os.tmpdir(), "cr-jest-evidence-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  const testFile = "apps/backend/test/local-database/evidence.spec.ts";
  await mkdir(path.dirname(path.join(root, testFile)), { recursive: true });
  await writeFile(path.join(root, testFile), `
describe('nested private-dynamic-name', () => {
  test('early-failure-identification', () => { expect('private-actual').toBe('private-expected'); });
});

`);
  await writeFile(path.join(root, "jest.config.cjs"), `module.exports = {
  rootDir: __dirname, testMatch: ['**/*.spec.ts'], transform: {}, cache: false,
  testEnvironment: 'node', testLocationInResults: true,
};\n`);
  return { root, testFile };
}

test("real Jest early failure is lost from the retained tail after substantial later output", async (t) => {
  const { root } = await fixture(t);
  const logPath = path.join(root, "command.log");
  // A wrapper models later command output after Jest's own final failure summary.
  const wrapper = path.join(root, "run.cjs");
  await writeFile(wrapper, `
const { spawnSync } = require('node:child_process');
const result = spawnSync(process.execPath, [${JSON.stringify(jest)}, '--config', './jest.config.cjs', '--runInBand'], { stdio: 'inherit' });
process.stdout.write('later output\\n'.repeat(4096), () => { process.exitCode = result.status; });
`);
  await assert.rejects(runCommand([process.execPath, wrapper], { cwd: root, logPath }), (error) => {
    assert.equal(error.exitCode, 1);
    assert.ok(error.outputTail.length <= 16_384);
    assert.ok(!error.outputTail.includes("early-failure-identification"));
    return true;
  });
  const output = await readFile(logPath, "utf8");
  assert.ok(output.includes("early-failure-identification"));
  assert.ok(output.length > 32_768);
});

test("actual Jest collection and export preserves safe locations despite later output", async (t) => {
  const { root, testFile } = await fixture(t);
  await writeFile(path.join(root, testFile), `
describe('name-secret', () => {
  test.each(['dynamic-secret', 'other-secret'])('private %s', (value) => {
    expect(value).toBe('expected-secret');
  });
});
`);
  const summary = {};
  await assert.rejects(executeGatePhaseCommand({
    phase: { id: "backend-database", kind: "commands" },
    databaseDiagnostics: {
      commandArgv: ["pnpm", "--filter", "backend", "test:local-database"], summary,
      workspace: root, files: [testFile], source,
      environment: { GITHUB_RUN_ID: "123", GITHUB_RUN_ATTEMPT: "2" },
    },
    async executeCommand(evidenceEnvironment) {
      const wrapper = path.join(root, "run.cjs");
      await writeFile(wrapper, `
const { spawnSync } = require('node:child_process');
const result = spawnSync(process.execPath, [${JSON.stringify(jest)}, '--config', './jest.config.cjs', '--runInBand', '--reporters', 'default', '--reporters', ${JSON.stringify(reporter)}], { stdio: 'inherit' });
process.stdout.write('later output\\n'.repeat(4096), () => { process.exitCode = result.status; });
`);
      return runCommand([process.execPath, wrapper], { cwd: root, env: { ...process.env, ...evidenceEnvironment } });
    },
  }), (error) => error.exitCode === 1 && !error.outputTail.includes("private %s"));
  const observed = summary.databaseTests;
  assert.equal(observed.availability, "complete", JSON.stringify(observed));
  assert.equal(observed.failures.length, 2);
  assert.equal(observed.failures[0].file, testFile);
  assert.equal(observed.failures[0].line, 3);
  assert.equal(observed.failures[0].category, "toBe");
  assert.notEqual(observed.failures[0].ordinal, observed.failures[1].ordinal);
  assert.deepEqual(observed.source, source);
  assert.deepEqual(observed.run, { id: "123", attempt: "2" });
  const exported = await exportDatabaseEvidence(observed, { RUNNER_TEMP: root, MIGRATION_GATE_CI_DATABASE_REPORT: "1" });
  assert.equal(exported.availability, "available");
  const content = await readFile(exported.path, "utf8");
  for (const secret of ["name-secret", "dynamic-secret", "other-secret", "expected-secret", root]) assert.ok(!content.includes(secret));
  assert.deepEqual(JSON.parse(content), observed);
});

test("reporter preparation and collection never replace primary command outcome", async () => {
  const primary = Object.assign(new Error("original"), { exitCode: 23 });
  let executed = false;
  let report;
  await assert.rejects(runWithDatabaseEvidence({
    workspace: "/unavailable", files: [], source, environment: {},
    prepare() { throw new Error("setup-secret"); },
    onEvidence(value) { report = value; },
    async execute(environment) { executed = true; assert.deepEqual(environment, {}); throw primary; },
  }), (error) => error === primary);
  assert.ok(executed);
  assert.equal(report.availability, "unavailable");
  assert.equal(report.reason, "setup-failed");
  assert.ok(!JSON.stringify(report).includes("setup-secret"));
});

test("missing and malformed reports are explicit without disclosing input", async (t) => {
  const { root, testFile } = await fixture(t);
  const session = await createDatabaseEvidenceSession({ workspace: root, files: [testFile], source, environment: {} });
  t.after(() => session.dispose());
  assert.equal((await collectDatabaseEvidence(session)).reason, "missing");
  await writeFile(session.reportPath, '{"secret":"canary"}\n');
  const report = await collectDatabaseEvidence(session);
  assert.equal(report.reason, "malformed");
  assert.ok(!JSON.stringify(report).includes("canary"));
});

async function sessionFixture(t, options = {}) {
  const f = await fixture(t);
  const s = await createDatabaseEvidenceSession({ workspace: f.root, files: [f.testFile], source, environment: {}, ...options });
  t.after(() => s.dispose());
  const optionsValue = JSON.parse(s.environment.CR_DATABASE_EVIDENCE);
  return { ...f, s, optionsValue };
}

const failed = { status: "failed", location: { line: 3, column: 4 }, failureDetails: [{ matcherResult: { name: "toEqual", actual: "actual-secret", expected: "expected-secret", message: "message-secret" }, stack: "stack-secret" }], title: "title-secret", fullName: "full-name-secret", ancestorTitles: ["ancestor-secret"] };

test("projection omits all runtime text, including known and unknown secret paths", async (t) => {
  const f = await fixture(t);
  const secretFile = "apps/backend/test/local-database/path-secret.spec.ts";
  await writeFile(path.join(f.root, secretFile), "source-only");
  const s = await createDatabaseEvidenceSession({ workspace: f.root, files: [secretFile], source, environment: { GITHUB_RUN_ID: "bad-secret" }, canaries: ["path-secret"] });
  t.after(() => s.dispose());
  const r = new Reporter({}, JSON.parse(s.environment.CR_DATABASE_EVIDENCE));
  r.onTestCaseResult({ path: path.join(f.root, secretFile) }, failed);
  r.onTestCaseResult({ path: "/private/path-secret/unknown.spec.ts" }, failed);
  r.onTestResult({ path: path.join(f.root, secretFile) }, { testResults: [failed] });
  r.onTestResult({ path: "/private/path-secret/unknown.spec.ts" }, { testResults: [failed] });
  r.onRunComplete(null, { numFailedTests: 2, numRuntimeErrorTestSuites: 0 });
  const report = await collectDatabaseEvidence(s);
  assert.equal(report.availability, "complete");
  assert.equal(report.failures[0].file, null);
  assert.match(report.failures[0].fileSha256, /^[a-f0-9]{64}$/);
  assert.equal(report.failures[1].fileSha256, null);
  assert.equal(report.run.id, null);
  assert.ok(!JSON.stringify(report).includes("secret"));
  assert.ok(!(await readFile(s.reportPath, "utf8")).includes("secret"));
});

test("partial prefixes, record limits, malformed ordering and binding are explicit", async (t) => {
  const { s, optionsValue, root, testFile } = await sessionFixture(t);
  const r = new Reporter({}, optionsValue);
  for (let i = 0; i < 70; i++) r.onTestCaseResult({ path: path.join(root, testFile) }, failed);
  const prefix = await readFile(s.reportPath, "utf8");
  const partial = parseDatabaseEvidence(prefix + '{"partial-secret":', s);
  assert.equal(partial.availability, "partial");
  assert.equal(partial.reason, "partial-write");
  assert.equal(partial.failures.length, 64);
  assert.equal(partial.truncated, true);
  r.onTestResult({ path: path.join(root, testFile) }, { testResults: Array(70).fill(failed) });
  r.onRunComplete(null, { numFailedTests: 70, numRuntimeErrorTestSuites: 0 });
  const full = await readFile(s.reportPath, "utf8");
  const report = await collectDatabaseEvidence(s);
  assert.equal(report.complete, true);
  assert.equal(report.truncated, true);
  assert.equal(report.reason, "record-limit");
  assert.equal(report.counts.failedTests, 70);
  assert.ok(Buffer.byteLength(full) < Reporter.LIMITS.bytes);
  for (const bad of [full.replace(s.nonce, "0".repeat(32)), full + '{}\n', full.replace('"failedTests":70', '"failedTests":63'), full.replace('"ordinal":2', '"ordinal":1'), full.replace('"runnerFailedTests":70', '"runnerFailedTests":69'), full.replace('"type":"attempt-failure"', '"type":"unknown"')]) {
    assert.throws(() => parseDatabaseEvidence(bad, s));
  }
  await writeFile(s.reportPath, "x".repeat(65537));
  assert.equal((await collectDatabaseEvidence(s)).reason, "oversized");
});

test("producer contains open/write/sync/close failures and never exposes getLastError", async (t) => {
  for (const method of ["openSync", "writeSync", "fsyncSync", "closeSync"]) {
    await t.test(method, async (t) => {
      const { s, optionsValue, root, testFile } = await sessionFixture(t);
      let failedOnce = false;
      const io = { ...syncFs, [method](...args) { if (!failedOnce) { failedOnce = true; throw new Error("io-secret"); } return syncFs[method](...args); } };
      const r = new Reporter({}, optionsValue, null, io);
      assert.doesNotThrow(() => { r.onTestCaseResult({ path: path.join(root, testFile) }, failed); r.onRunComplete(null, { numFailedTests: 1 }); });
      assert.equal(r.getLastError, undefined);
      const report = await collectDatabaseEvidence(s);
      assert.notEqual(report.availability, "complete");
      assert.ok(!JSON.stringify(report).includes("io-secret"));
    });
  }
});

test("consumer refuses symlinks, replaced inodes, hardlinks, modes and replaced directories", async (t) => {
  const { s, optionsValue, root } = await sessionFixture(t);
  const decoy = path.join(root, "private-file");
  await writeFile(decoy, "untouched-secret", { mode: 0o600 });
  const saved = s.reportPath + ".saved";
  await fs.rename(s.reportPath, saved);
  await fs.symlink(decoy, s.reportPath);
  let r = new Reporter({}, optionsValue);
  r.onRunComplete(null, { numFailedTests: 0, numRuntimeErrorTestSuites: 0 });
  assert.notEqual((await collectDatabaseEvidence(s)).availability, "complete");
  await fs.unlink(s.reportPath);
  await fs.copyFile(decoy, s.reportPath);
  r = new Reporter({}, optionsValue);
  r.onRunComplete(null, { numFailedTests: 0, numRuntimeErrorTestSuites: 0 });
  assert.equal(await readFile(s.reportPath, "utf8"), "untouched-secret");
  assert.equal((await collectDatabaseEvidence(s)).reason, "unsafe-file");
  await fs.unlink(s.reportPath);
  await fs.rename(saved, s.reportPath);
  await fs.link(s.reportPath, saved);
  assert.equal((await collectDatabaseEvidence(s)).reason, "unsafe-file");
  await fs.unlink(saved);
  await fs.chmod(s.reportPath, 0o644);
  assert.equal((await collectDatabaseEvidence(s)).reason, "unsafe-file");
  await fs.chmod(s.reportPath, 0o600);
  await fs.rename(s.directory, s.directory + ".saved");
  await fs.symlink(s.directory + ".saved", s.directory);
  assert.equal((await collectDatabaseEvidence(s)).reason, "unsafe-file");
  await fs.unlink(s.directory);
  await fs.rename(s.directory + ".saved", s.directory);
  assert.equal(await readFile(decoy, "utf8"), "untouched-secret");
});

test("reader and export failures are explicit, leave existing targets untouched", async (t) => {
  const { s, optionsValue, root } = await sessionFixture(t);
  new Reporter({}, optionsValue).onRunComplete(null, { numFailedTests: 0, numRuntimeErrorTestSuites: 0 });
  for (const method of ["read", "close"]) {
    const io = { ...fs, async open(...args) {
      const h = await fs.open(...args);
      return { stat: h.stat.bind(h), read: h.read.bind(h), close: h.close.bind(h), async [method](...values) { if (method === "close") await h.close(); throw Error("read-secret"); } };
    } };
    assert.equal((await collectDatabaseEvidence(s, { io })).reason, method === "close" ? "read-close-failed" : "read-failed");
  }
  const report = await collectDatabaseEvidence(s);
  const env = { RUNNER_TEMP: root, MIGRATION_GATE_CI_DATABASE_REPORT: "1" };
  for (const method of ["writeFile", "sync", "close"]) {
    const io = { ...fs, async open(...args) {
      const h = await fs.open(...args);
      return { stat: h.stat.bind(h), writeFile: h.writeFile.bind(h), sync: h.sync.bind(h), close: h.close.bind(h), async [method]() { if (method === "close") await h.close(); throw Error("export-secret"); } };
    } };
    assert.equal((await exportDatabaseEvidence(report, env, { io })).availability, "unavailable");
  }
  const existing = path.join(root, "local-migration-database-failures.json");
  await writeFile(existing, "previous-attempt");
  assert.equal((await exportDatabaseEvidence(report, env)).availability, "unavailable");
  assert.equal(await readFile(existing, "utf8"), "previous-attempt");
  await fs.unlink(existing);
  const decoy = path.join(root, "decoy");
  await writeFile(decoy, "private");
  await fs.symlink(decoy, existing);
  assert.equal((await exportDatabaseEvidence(report, env)).availability, "unavailable");
  assert.equal(await readFile(decoy, "utf8"), "private");
});

test("real Jest cancellation retains prior failures and the original signal/exit", async (t) => {
  const { root, testFile } = await fixture(t);
  await writeFile(path.join(root, testFile), "test('private fail', () => expect(1).toBe(2)); afterAll(() => new Promise(() => {}));\n");
  const controller = new AbortController();
  let observed;
  let session;
  const pending = runWithDatabaseEvidence({
    workspace: root, files: [testFile], source, environment: {},
    async prepare(options) { session = await createDatabaseEvidenceSession(options); return session; },
    onEvidence(report) { observed = report; },
    execute(env) { return runCommand([process.execPath, jest, "--config", "./jest.config.cjs", "--runInBand", "--reporters", reporter], { cwd: root, env: { ...process.env, ...env }, signal: controller.signal }); },
  });
  const rejection = assert.rejects(pending, (e) => e.exitCode === 130 && e.signal === "SIGINT");
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    if (session && (await readFile(session.reportPath, "utf8")).includes('"type":"attempt-failure"')) break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  controller.abort(Object.assign(new Error("SIGINT"), { exitCode: 130, signal: "SIGINT" }));
  await rejection;
  assert.equal(observed.availability, "partial");
  assert.equal(observed.failures.length, 1);
  assert.equal(observed.cleanup, "complete");
});

test("report cleanup and publication failures remain diagnostic, fresh exports alone enable upload", async (t) => {
  const { s, optionsValue, root, testFile } = await sessionFixture(t);
  let report;
  const result = await runWithDatabaseEvidence({
    workspace: root, files: [testFile], source,
    async prepare() { return { ...s, async dispose() { throw Error("cleanup-secret"); } }; },
    execute() { new Reporter({}, optionsValue).onRunComplete(null, { numFailedTests: 0, numRuntimeErrorTestSuites: 0 }); return { exitCode: 0, marker: "original" }; },
    onEvidence(value) { report = value; },
  });
  assert.equal(result.marker, "original");
  assert.equal(report.cleanup, "failed");
  assert.equal(report.commandResult.exitCode, 0);
  const env = { RUNNER_TEMP: root, MIGRATION_GATE_CI_DATABASE_REPORT: "1", GITHUB_OUTPUT: path.join(root, "output") };
  const summary = { databaseTests: report };
  await persistDatabaseEvidence(summary, env);
  assert.equal(summary.databaseTestsExport.availability, "available");
  assert.equal(await readFile(env.GITHUB_OUTPUT, "utf8"), "database_report_ready=true\n");
  const stale = { databaseTests: report };
  await persistDatabaseEvidence(stale, env);
  assert.equal(stale.databaseTestsExport.availability, "unavailable");
  assert.equal(await readFile(env.GITHUB_OUTPUT, "utf8"), "database_report_ready=true\n");
  const failed = { databaseTests: report };
  await persistDatabaseEvidence(failed, env, { publish() { throw Error("publish-secret"); } });
  assert.deepEqual(failed.databaseTestsExport, { availability: "unavailable", reason: "export-failed" });
});

test("suite errors and sources with symlink boundaries are handled safely", async (t) => {
  const { s, optionsValue, root, testFile } = await sessionFixture(t);
  const r = new Reporter({}, optionsValue);
  r.onTestResult({ path: path.join(root, testFile) }, { testResults: [], testExecError: { message: "load-secret", stack: "stack-secret" } });
  r.onRunComplete(null, { numFailedTests: 0, numRuntimeErrorTestSuites: 1 });
  const report = await collectDatabaseEvidence(s);
  assert.equal(report.availability, "complete");
  assert.equal(report.failures[0].category, "suite-error");
  assert.equal(report.counts.suiteErrors, 1);
  assert.ok(!JSON.stringify(report).includes("secret"));
  const unsafe = path.join(root, "apps/backend/test/local-database/unsafe.spec.ts");
  await fs.symlink(path.join(root, testFile), unsafe);
  await assert.rejects(createDatabaseEvidenceSession({ workspace: root, files: ["apps/backend/test/local-database/unsafe.spec.ts"], source }));
});

test("consumer detects replacement during reads and export refuses a replaced temporary file", async (t) => {
  const { s, optionsValue, root } = await sessionFixture(t);
  new Reporter({}, optionsValue).onRunComplete(null, { numFailedTests: 0, numRuntimeErrorTestSuites: 0 });
  const original = s.reportPath + ".saved";
  let switched = false;
  const io = { ...fs, async open(...args) {
    const h = await fs.open(...args);
    return { stat: h.stat.bind(h), close: h.close.bind(h), async read(...values) {
      const read = await h.read(...values);
      if (!switched) { switched = true; await fs.rename(s.reportPath, original); await writeFile(s.reportPath, "replacement-secret"); }
      return read;
    } };
  } };
  assert.equal((await collectDatabaseEvidence(s, { io })).reason, "replaced-or-changed");
  await fs.unlink(s.reportPath);
  await fs.rename(original, s.reportPath);
  const report = await collectDatabaseEvidence(s);
  const decoy = path.join(root, "decoy");
  await writeFile(decoy, "export-secret");
  const maliciousIo = { ...fs, async link(from, to) { await fs.unlink(from); await fs.symlink(decoy, from); await fs.link(from, to); } };
  const exported = await exportDatabaseEvidence(report, { RUNNER_TEMP: root, MIGRATION_GATE_CI_DATABASE_REPORT: "1" }, { io: maliciousIo });
  assert.equal(exported.availability, "unavailable");
});

test("public failure projection omits unknown secrets even without a report, preserving primary failure", async () => {
  const command = { argv: ["pnpm", "--filter", "backend", "test:local-database"] };
  const primary = Object.assign(new Error("unknown-message-secret"), { outputTail: "unknown-tail-secret", exitCode: 23, signal: "SIGTERM" });
  for (const projection of [projectDatabaseCommandFailure, () => { throw Error("projection-secret"); }]) {
    await assert.rejects(runPhaseSequence([{ id: "backend-database", commands: [command] }], {
      execute() { throw primary; }, projectFailureMessage: projection,
    }), (error) => {
      assert.equal(error.cause, primary);
      assert.equal(error.exitCode, 23);
      assert.equal(error.signal, "SIGTERM");
      assert.ok(!error.message.includes("secret"));
      assert.match(error.message, /databaseTests|diagnostic projection unavailable/);
      return true;
    });
  }
  for (const argv of [["pnpm", "--filter", "backend", "test:integration"], command.argv]) {
    await assert.rejects(runPhaseSequence([{ id: "backend-database", commands: [{ argv }] }], {
      execute() { if (argv !== command.argv) throw primary; },
      onPhaseFinish() { throw primary; }, projectFailureMessage: projectDatabaseCommandFailure,
    }), (error) => error.message.includes("unknown-tail-secret"));
  }
  assert.equal(primary.message, "unknown-message-secret");
  assert.equal(primary.outputTail, "unknown-tail-secret");
});

test("command cleanup failures remain visible without changing primary exit or error", async () => {
  const error = combineFailures(Object.assign(Error("primary-secret"), { exitCode: 23 }), [Error("cleanup-secret")]);
  let report;
  await assert.rejects(runWithDatabaseEvidence({
    workspace: "/missing", files: [], source, prepare() { throw Error(); },
    execute() { throw error; }, onEvidence(value) { report = value; },
  }), (observed) => observed === error);
  assert.equal(report.commandResult.exitCode, 23);
  assert.equal(report.commandResult.secondaryFailureCount, 1);
  assert.ok(!JSON.stringify(report).includes("secret"));
});

test("actual repository Jest configuration enables locations only in the reported local project", async () => {
  for (const enabled of [false, true]) {
    const env = { ...process.env };
    delete env.CR_DATABASE_EVIDENCE;
    if (enabled) env.CR_DATABASE_EVIDENCE = "1";
    const { stdout } = await capture(process.execPath, [jest, "--showConfig"], { cwd: path.join(repoRoot, "apps/backend"), env, maxBuffer: 512 * 1024 });
    const normalized = JSON.parse(stdout);
    for (const project of normalized.configs) {
      assert.equal(project.testLocationInResults, enabled && project.displayName.name === "local-database", project.displayName.name);
    }
    assert.equal((normalized.globalConfig.reporters ?? []).some(([file]) => file === reporter), enabled);
  }
});

test("actual multi-project configuration and ts-jest retain a failed TypeScript declaration", async (t) => {
  const { root, testFile } = await fixture(t);
  await writeFile(path.join(root, testFile), `declare const test: (name: string, fn: () => void) => void;
declare const expect: (value: unknown) => { toBe(value: unknown): void };
test('typescript-name-secret', () => expect('typescript-value-secret').toBe('expected-secret'));
`);
  await writeFile(path.join(root, "jest.config.cjs"), `
const config = require(${JSON.stringify(path.join(repoRoot, "apps/backend/jest.config.js"))});
config.projects = config.projects.map(p => ({ ...p, rootDir: p.displayName === 'local-database' ? ${JSON.stringify(path.join(root, "apps/backend"))} : ${JSON.stringify(path.join(repoRoot, "apps/backend"))}, transform: { '^.+\\\\.(t|j)s$': ${JSON.stringify(require.resolve("ts-jest"))} } }));
module.exports = config;
`);
  let report;
  let commandError;
  await assert.rejects(runWithDatabaseEvidence({
    workspace: root, files: [testFile], source,
    onEvidence(value) { report = value; },
    execute(env) { return runCommand([process.execPath, jest, "--config", "./jest.config.cjs", "--selectProjects", "local-database", "--runInBand"], { cwd: root, env: { ...process.env, ...env } }); },
  }), (error) => { commandError = error; return error.exitCode === 1; });
  assert.equal(report.availability, "complete", JSON.stringify(report) + commandError?.outputTail);
  assert.equal(report.failures.length, 1);
  assert.equal(report.failures[0].category, "toBe");
  assert.equal(report.failures[0].line, 3);
  assert.ok(report.failures[0].column > 0);
  assert.ok(!JSON.stringify(report).includes("secret"));
});

test("only a clean successful command and evidence cleanup may skip local publication", async () => {
  const clean = {
    complete: true, truncated: false, failures: [], cleanup: "complete", reason: "collected",
    commandResult: { exitCode: 0, signal: null, secondaryFailureCount: 0 },
  };
  for (const [report, expected] of [
    [clean, false],
    [{ ...clean, commandResult: { ...clean.commandResult, exitCode: 124 } }, true],
    [{ ...clean, commandResult: { ...clean.commandResult, signal: "SIGTERM" } }, true],
    [{ ...clean, commandResult: { ...clean.commandResult, secondaryFailureCount: 1 } }, true],
    [{ ...clean, cleanup: "failed" }, true],
    [{ ...clean, commandResult: null }, true],
    [{ ...clean, truncated: true }, true],
  ]) {
    let called = false;
    const summary = { databaseTests: structuredClone(report) };
    await persistDatabaseEvidence(summary, {}, { async publish() { called = true; return { availability: "available" }; } });
    assert.equal(called, expected, JSON.stringify(report));
    assert.deepEqual(summary.databaseTests, report);
  }
});

test("a timeout before any failure retains only the unfinished file as a lead", async (t) => {
  const { root, testFile } = await fixture(t);
  const passing = "apps/backend/test/local-database/alpha.spec.ts";
  await writeFile(path.join(root, passing), "test('passing-secret', () => expect(1).toBe(1));\n");
  await writeFile(path.join(root, testFile), "test('hanging-secret', () => new Promise(() => {}), 60000);\n");
  await writeFile(path.join(root, "sequencer.cjs"), `module.exports = class { sort(tests) { return tests.sort((a,b) => a.path.localeCompare(b.path)); } cacheResults() {} };\n`);
  let report;
  await assert.rejects(runWithDatabaseEvidence({
    workspace: root, files: [passing, testFile], source,
    onEvidence(value) { report = value; },
    execute(env) { return runCommand([process.execPath, jest, "--config", "./jest.config.cjs", "--runInBand", "--testSequencer", "./sequencer.cjs", "--reporters", reporter], { cwd: root, env: { ...process.env, ...env }, timeoutMs: 4000 }); },
  }), (error) => error.exitCode === 124 && error.signal === "SIGTERM");
  assert.equal(report.availability, "partial");
  assert.equal(report.progress.runner, "started");
  assert.equal(report.progress.startedFiles, 2);
  assert.equal(report.progress.completedFiles, 1);
  assert.deepEqual(report.progress.inFlightFiles.map(f => f.file), [testFile]);
  assert.equal(report.failures.length, 0);
  assert.ok(!JSON.stringify(report).includes("secret"));
});

test("retries use final file results, including duplicate titles and skipped or todo cases", async (t) => {
  const { root, testFile } = await fixture(t);
  await writeFile(path.join(root, testFile), `
jest.retryTimes(1);
let attempts = 0;
test.each([0, 1])('duplicate-secret', () => expect(++attempts).toBeGreaterThan(1));
test('final-secret', () => expect('actual-secret').toBe('expected-secret'));
test.skip('skipped-secret', () => {});
test.todo('todo-secret');
`);
  let report;
  await assert.rejects(runWithDatabaseEvidence({
    workspace: root, files: [testFile], source,
    onEvidence(value) { report = value; },
    execute(env) { return runCommand([process.execPath, jest, "--config", "./jest.config.cjs", "--runInBand", "--reporters", reporter], { cwd: root, env: { ...process.env, ...env } }); },
  }), (error) => error.exitCode === 1);
  assert.equal(report.availability, "complete");
  assert.equal(report.counts.failedTests, 1);
  assert.equal(report.failures.length, 1);
  assert.equal(report.failures[0].ordinal, 3);
  assert.equal(report.failures[0].ordinalKind, "final-result");
  assert.equal(report.failures[0].provisional, false);
  assert.equal(report.progress.inFlightFiles.length, 0);
  assert.ok(!JSON.stringify(report).includes("secret"));
});

test("real afterAll errors are suite errors rather than suite load errors", async (t) => {
  const { root, testFile } = await fixture(t);
  await writeFile(path.join(root, testFile), "test('passed-secret', () => {}); afterAll(() => { throw Error('teardown-secret'); });\n");
  let report;
  await assert.rejects(runWithDatabaseEvidence({
    workspace: root, files: [testFile], source,
    onEvidence(value) { report = value; },
    execute(env) { return runCommand([process.execPath, jest, "--config", "./jest.config.cjs", "--runInBand", "--reporters", reporter], { cwd: root, env: { ...process.env, ...env } }); },
  }), (error) => error.exitCode === 1);
  assert.equal(report.availability, "complete");
  assert.equal(report.failures[0].category, "suite-error");
  assert.equal(report.counts.failedTests, 0);
  assert.equal(report.counts.suiteErrors, 1);
  assert.ok(!JSON.stringify(report).includes("secret"));
});

test("dotted source names and SHA-256 heads retain source binding", async (t) => {
  const { root } = await fixture(t);
  const testFile = "apps/backend/test/local-database/extra.cases.spec.ts";
  await writeFile(path.join(root, testFile), "test('name-secret', () => expect(1).toBe(2));\n");
  let report;
  await assert.rejects(runWithDatabaseEvidence({
    workspace: root, files: [testFile], source: { ...source, headSha: "c".repeat(64) },
    onEvidence(value) { report = value; },
    execute(env) { return runCommand([process.execPath, jest, "--config", "./jest.config.cjs", "--runInBand", "--runTestsByPath", testFile, "--reporters", reporter], { cwd: root, env: { ...process.env, ...env } }); },
  }), (error) => error.exitCode === 1);
  assert.equal(report.source.headSha, "c".repeat(64));
  assert.equal(report.failures[0].file, testFile);
  assert.equal(report.failures[0].fileId, 0);
});

test("failure before the Jest reporter starts is explicit and never restores arbitrary output", async (t) => {
  const { root, testFile } = await fixture(t);
  let report;
  const phase = { id: "backend-database", commands: [{ argv: ["pnpm", "--filter", "backend", "test:local-database"] }] };
  await assert.rejects(runPhaseSequence([phase], {
    projectFailureMessage: projectDatabaseCommandFailure,
    execute() { return runWithDatabaseEvidence({
      workspace: root, files: [testFile], source,
      onEvidence(value) { report = value; },
      execute() { return runCommand([process.execPath, "-e", "console.error('build-secret'); process.exitCode = 2"], { cwd: root }); },
    }); },
  }), (error) => error.exitCode === 2 && !error.message.includes("build-secret"));
  assert.equal(report.progress.runner, "not-observed");
  assert.equal(report.progress.startedFiles, 0);
  assert.equal(report.commandResult.exitCode, 2);
});


test("file completion commits final results; an interrupted batch keeps attempt ordinals", async (t) => {
  const { s, optionsValue, root, testFile } = await sessionFixture(t);
  const r = new Reporter({}, optionsValue);
  const file = { path: path.join(root, testFile) };
  r.onTestCaseResult(file, { status: "passed" });
  r.onTestCaseResult(file, failed);
  r.onTestResult(file, { testResults: [failed] });
  r.onRunComplete(null, { numFailedTests: 1, numRuntimeErrorTestSuites: 0 });
  const wire = await readFile(s.reportPath, "utf8");
  const prefix = wire.slice(0, wire.indexOf('{"type":"file-complete"'));
  const partial = parseDatabaseEvidence(prefix, s);
  assert.equal(partial.failures.length, 1);
  assert.equal(partial.failures[0].ordinal, 2);
  assert.equal(partial.failures[0].ordinalKind, "attempt");
  assert.equal(partial.failures[0].provisional, true);
  assert.equal(partial.progress.inFlightFiles.length, 1);
  const complete = parseDatabaseEvidence(wire, s);
  assert.equal(complete.failures[0].ordinal, 1);
  assert.equal(complete.failures[0].ordinalKind, "final-result");
  assert.equal(complete.failures[0].provisional, false);
});

test("retry attempts can hit their cap without truncating complete final evidence", async (t) => {
  const { s, optionsValue, root, testFile } = await sessionFixture(t);
  const r = new Reporter({}, optionsValue);
  const file = { path: path.join(root, testFile) };
  for (let i = 0; i < 70; i++) r.onTestCaseResult(file, failed);
  r.onTestResult(file, { testResults: [{ status: "passed" }] });
  r.onRunComplete(null, { numFailedTests: 0, numRuntimeErrorTestSuites: 0 });
  const report = await collectDatabaseEvidence(s);
  assert.equal(report.complete, true);
  assert.equal(report.truncated, false);
  assert.equal(report.failures.length, 0);
  assert.equal(report.counts.exact, true);
});

test("unknown files stay distinct and caps produce lower-bound counts", async (t) => {
  const { s, optionsValue } = await sessionFixture(t);
  const r = new Reporter({}, optionsValue);
  for (let i = 0; i < 130; i++) {
    const file = { path: `/private/unknown-secret/${i}.spec.ts` };
    r.onTestCaseResult(file, failed);
    r.onTestResult(file, { testResults: [failed] });
  }
  r.onTestStart({ path: "x".repeat(5000) });
  r.onTestStart({ path: null });
  r.onRunComplete(null, { numFailedTests: 130, numRuntimeErrorTestSuites: 0 });
  const report = await collectDatabaseEvidence(s);
  assert.equal(report.complete, true);
  assert.equal(report.truncated, true);
  assert.equal(report.counts.exact, false);
  assert.equal(report.counts.failedTests, 128);
  assert.equal(report.progress.startedFiles, 128);
  assert.equal(new Set(report.failures.map(f => f.fileRun)).size, 64);
  assert.ok(report.failures.every(f => f.fileId === null));
  assert.ok(!JSON.stringify(report).includes("secret"));
});

test("bounded result scanning keeps captured evidence instead of rejecting runner totals", async (t) => {
  const { s, optionsValue, root, testFile } = await sessionFixture(t);
  const r = new Reporter({}, optionsValue);
  r.onTestResult({ path: path.join(root, testFile) }, { testResults: [...Array(100000).fill({ status: "passed" }), failed] });
  r.onRunComplete(null, { numFailedTests: 1, numRuntimeErrorTestSuites: 0 });
  const report = await collectDatabaseEvidence(s);
  assert.equal(report.complete, true);
  assert.equal(report.truncated, true);
  assert.equal(report.counts.exact, false);
});

test("maximum producer shapes retain the last file and expanded reports remain exportable", async (t) => {
  const { s, optionsValue, root } = await sessionFixture(t);
  const r = new Reporter({}, optionsValue);
  const worst = { ...failed, location: { line: 100000, column: 100000 }, failureDetails: [{ matcherResult: { name: "toBeGreaterThan" } }] };
  for (let i = 0; i < 128; i++) {
    const file = { path: `/unknown/${i}` };
    r.onTestStart(file);
    if (i === 0) {
      for (let j = 0; j < 99936; j++) r.onTestCaseResult(file, { status: "passed" });
      for (let j = 0; j < 64; j++) r.onTestCaseResult(file, worst);
      r.onTestResult(file, { testResults: [...Array(99936).fill({ status: "passed" }), ...Array(64).fill(worst)] });
    } else if (i < 127) r.onTestResult(file, { testResults: [] });
  }
  const prefix = await readFile(s.reportPath, "utf8");
  assert.ok(Buffer.byteLength(prefix) < Reporter.LIMITS.bytes);
  assert.equal(parseDatabaseEvidence(prefix, s).progress.inFlightFiles[0].fileRun, 127);
  r.onTestResult({ path: "/unknown/127" }, { testResults: [] });
  r.onRunComplete(null, { numFailedTests: 64, numRuntimeErrorTestSuites: 0 });
  assert.equal((await collectDatabaseEvidence(s)).complete, true);

  // A more expensive public shape: all 128 files unfinished with maximum source names.
  const records = [{ type: "header", schemaVersion: 2, nonce: s.nonce }];
  const catalog = [];
  for (let i = 0; i < 128; i++) {
    catalog.push({ file: 'x'.repeat(240), fileSha256: 'a'.repeat(64) });
    records.push({ type: "file-start", run: i, file: i });
    if (i < 64) records.push({ type: "attempt-failure", run: i, ordinal: 100000, line: 100000, column: 100000, category: "toBeGreaterThan" });
  }
  const report = parseDatabaseEvidence(records.map(r => JSON.stringify(r) + "\n").join(""), { ...s, catalog });
  assert.equal(report.progress.startedFiles, 128);
  assert.equal(report.truncated, true);
  assert.ok(report.progress.omittedInFlightFiles > 0);
  assert.ok(report.progress.inFlightFiles.length > 0);
  assert.equal(report.failures.length, 64);
  const exported = await exportDatabaseEvidence(report, { RUNNER_TEMP: root, MIGRATION_GATE_CI_DATABASE_REPORT: "1" });
  assert.equal(exported.availability, "available");
  assert.ok((await fs.stat(exported.path)).size <= 65536);
});

test("local export failures clean owned paths or explicitly retain replaced paths", async (t) => {
  for (const stage of ["realpath", "open", "published-stat", "replacement", "temporary-replacement"]) {
    await t.test(stage, async (t) => {
      const { root } = await fixture(t);
      let directory;
      let linked = false;
      let injected = false;
      const io = { ...fs,
        async mkdtemp() { directory = await fs.mkdtemp(path.join(root, "report-")); return directory; },
        async realpath(p) { if (stage === "realpath" && !injected) { injected = true; throw Error("secret"); } return fs.realpath(p); },
        async open(...args) { if (stage === "open") throw Error("secret"); return fs.open(...args); },
        async link(from, to) {
          await fs.link(from, to); linked = true;
          if (stage === "replacement") { await fs.unlink(to); await writeFile(to, "foreign-secret"); }
          if (stage === "temporary-replacement") { await fs.unlink(from); await writeFile(from, "foreign-secret"); }
        },
        async lstat(p) { if (stage === "published-stat" && linked && !injected && p.endsWith(".json")) { injected = true; throw Error("secret"); } return fs.lstat(p); },
      };
      const exported = await exportDatabaseEvidence({ safe: true }, {}, { io });
      assert.equal(exported.availability, "unavailable");
      if (stage.endsWith("replacement")) {
        assert.equal(exported.cleanup, "retained");
        assert.equal(exported.retainedPath, directory);
        const name = stage === "replacement" ? "local-migration-database-failures.json" : (await fs.readdir(directory)).find(f => f.startsWith(".database-report-"));
        assert.equal(await readFile(path.join(directory, name), "utf8"), "foreign-secret");
      } else {
        assert.equal(exported.cleanup, "complete");
        await assert.rejects(fs.lstat(directory), { code: "ENOENT" });
      }
    });
  }
});

test("reporter integration test resolves repository paths independently of caller cwd", async (t) => {
  const { root } = await fixture(t);
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const { stdout } = await capture(process.execPath, ["--test", "--test-reporter=tap", "--test-name-pattern=actual repository Jest configuration", fileURLToPath(import.meta.url)], { cwd: root, env });
  assert.match(stdout, /pass 1/);
});
