import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import * as syncFs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
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
const reporter = path.resolve("scripts/local-migration/local-database-reporter.cjs");

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
  r.onRunComplete(null, { numFailedTests: 2 });
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
  r.onRunComplete(null, { numFailedTests: 70 });
  const full = await readFile(s.reportPath, "utf8");
  const report = await collectDatabaseEvidence(s);
  assert.equal(report.complete, true);
  assert.equal(report.truncated, true);
  assert.equal(report.reason, "record-limit");
  assert.equal(report.counts.failedTests, 70);
  assert.ok(Buffer.byteLength(full) < Reporter.LIMITS.bytes);
  for (const bad of [full.replace(s.nonce, "0".repeat(32)), full + '{}\n', full.replace('"recorded":64', '"recorded":63'), full.replace('"ordinal":2', '"ordinal":1'), full.replace('"runnerFailedTests":70', '"runnerFailedTests":69'), full.replace('"type":"failure"', '"type":"unknown"')]) {
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
  r.onRunComplete(null, { numFailedTests: 0 });
  assert.notEqual((await collectDatabaseEvidence(s)).availability, "complete");
  await fs.unlink(s.reportPath);
  await fs.copyFile(decoy, s.reportPath);
  r = new Reporter({}, optionsValue);
  r.onRunComplete(null, { numFailedTests: 0 });
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
  new Reporter({}, optionsValue).onRunComplete(null, { numFailedTests: 0 });
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
    if (session && (await readFile(session.reportPath, "utf8")).includes('"type":"failure"')) break;
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
    execute() { new Reporter({}, optionsValue).onRunComplete(null, { numFailedTests: 0 }); return { exitCode: 0, marker: "original" }; },
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

test("suite-load failures and sources with symlink boundaries are handled safely", async (t) => {
  const { s, optionsValue, root, testFile } = await sessionFixture(t);
  const r = new Reporter({}, optionsValue);
  r.onTestResult({ path: path.join(root, testFile) }, { testExecError: { message: "load-secret", stack: "stack-secret" } });
  r.onRunComplete(null, { numFailedTests: 0 });
  const report = await collectDatabaseEvidence(s);
  assert.equal(report.availability, "complete");
  assert.equal(report.failures[0].category, "suite-load");
  assert.equal(report.counts.failedSuites, 1);
  assert.ok(!JSON.stringify(report).includes("secret"));
  const unsafe = path.join(root, "apps/backend/test/local-database/unsafe.spec.ts");
  await fs.symlink(path.join(root, testFile), unsafe);
  await assert.rejects(createDatabaseEvidenceSession({ workspace: root, files: ["apps/backend/test/local-database/unsafe.spec.ts"], source }));
});

test("consumer detects replacement during reads and export refuses a replaced temporary file", async (t) => {
  const { s, optionsValue, root } = await sessionFixture(t);
  new Reporter({}, optionsValue).onRunComplete(null, { numFailedTests: 0 });
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
