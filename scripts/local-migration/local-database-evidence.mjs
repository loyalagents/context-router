import { createHash, randomBytes } from "node:crypto";
import { constants } from "node:fs";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Reporter from "./local-database-reporter.cjs";
import { redactSecrets } from "./gate-runner.mjs";

const { LIMITS, CATEGORIES, sourceName } = Reporter;
const integer = (n) => Number.isSafeInteger(n) && n >= 0 && n <= LIMITS.events;
const identity = (s) => ({ dev: s.dev, ino: s.ino, uid: s.uid });
const same = (a, b) => a.dev === b.dev && a.ino === b.ino && a.uid === b.uid;
const code = (reason) => Object.assign(new Error(reason), { evidenceReason: reason });
const hashValue = (value, length) => typeof value === "string" && new RegExp(`^[a-f0-9]{${length}}$`).test(value) ? value : null;
const runValue = (value) => typeof value === "string" && /^[1-9][0-9]{0,19}$/.test(value) ? value : null;

export function isLocalDatabaseCommand(phase, argv) {
  return phase.id === "backend-database" && JSON.stringify(argv) === JSON.stringify(["pnpm", "--filter", "backend", "test:local-database"]);
}

export function projectDatabaseCommandFailure({ phase, command }) {
  if (isLocalDatabaseCommand(phase, command?.argv)) {
    return "pnpm --filter backend test:local-database failed; structured database test evidence: see databaseTests";
  }
}

export function unavailableDatabaseEvidence(reason = "command-not-run", { source = {}, environment = {}, attemptId = randomBytes(16).toString("hex") } = {}) {
  return {
    schemaVersion: 2,
    phase: "backend-database",
    command: "pnpm --filter backend test:local-database",
    attemptId,
    source: { headSha: hashValue(source.headSha, 40) ?? hashValue(source.headSha, 64), dirty: typeof source.dirty === "boolean" ? source.dirty : null, copiedInputsSha256: hashValue(source.copiedInputsSha256, 64) },
    run: { id: runValue(environment.GITHUB_RUN_ID), attempt: runValue(environment.GITHUB_RUN_ATTEMPT) },
    availability: "unavailable", reason, complete: false, truncated: false,
    privacy: "runtime-text-omitted", failures: [], counts: null,
    progress: { runner: "not-observed", startedFiles: 0, completedFiles: 0, inFlightFiles: [], omittedInFlightFiles: 0 },
  };
}

async function assertDirectory(directory, expected, io = fs) {
  const info = await io.lstat(directory);
  if (!info.isDirectory() || !same(info, expected) || (info.mode & 0o777) !== 0o700 || await io.realpath(directory) !== directory) throw code("unsafe-file");
}

async function sourceFile(root, relative, canaries) {
  let current = root;
  for (const part of relative.split("/").slice(0, -1)) {
    current = path.join(current, part);
    if (!(await fs.lstat(current)).isDirectory()) throw code("unsafe-source");
  }
  const handle = await fs.open(path.join(root, relative), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > 1024 * 1024) throw code("unsafe-source");
    const hash = createHash("sha256");
    const buffer = Buffer.alloc(16384);
    let bytes = 0;
    for (;;) {
      const read = await handle.read(buffer, 0, buffer.length, null);
      if (!read.bytesRead) break;
      bytes += read.bytesRead;
      if (bytes > 1024 * 1024) throw code("unsafe-source");
      hash.update(buffer.subarray(0, read.bytesRead));
    }
    const after = await handle.stat();
    if (bytes !== info.size || info.size !== after.size || info.mtimeMs !== after.mtimeMs || info.ctimeMs !== after.ctimeMs) throw code("unsafe-source");
    return { file: redactSecrets(relative, canaries) === relative ? relative : null, fileSha256: hash.digest("hex"), bytes };
  } finally { await handle.close(); }
}

export async function createDatabaseEvidenceSession({ workspace, files, source, environment = {}, canaries = [] }) {
  const root = await fs.realpath(workspace);
  const selected = files.filter(sourceName);
  if (selected.length > LIMITS.files || new Set(selected).size !== selected.length) throw code("source-limit");
  const catalog = [];
  let sourceBytes = 0;
  for (const file of selected) {
    const entry = await sourceFile(root, file, canaries);
    sourceBytes += entry.bytes;
    if (sourceBytes > 8 * 1024 * 1024) throw code("source-limit");
    catalog.push(entry);
  }
  const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "cr-database-evidence-")));
  let handle;
  try {
    const directoryIdentity = identity(await fs.lstat(directory));
    const reportPath = path.join(directory, "results.ndjson");
    handle = await fs.open(reportPath, "wx", 0o600);
    const fileIdentity = identity(await handle.stat());
    await handle.close();
    handle = null;
    const nonce = randomBytes(16).toString("hex");
    const options = { root, reportPath, nonce, files: selected, directory: directoryIdentity, file: fileIdentity };
    const encoded = JSON.stringify(options);
    if (Buffer.byteLength(encoded) > LIMITS.optionsBytes) throw code("source-limit");
    return {
      directory, reportPath, directoryIdentity, fileIdentity, catalog, nonce,
      environment: { CR_DATABASE_EVIDENCE: encoded },
      base: unavailableDatabaseEvidence("missing", { source, environment, attemptId: nonce }),
      async dispose() {
        await assertDirectory(directory, directoryIdentity);
        const info = await fs.lstat(reportPath);
        if (!same(info, fileIdentity) || !info.isFile() || info.nlink !== 1) throw code("unsafe-file");
        await fs.unlink(reportPath);
        await fs.rmdir(directory);
      },
    };
  } catch (error) {
    await handle?.close().catch(() => {});
    await fs.rm(directory, { recursive: true, force: true });
    throw error;
  }
}

function keys(record, expected) {
  if (!record || typeof record !== "object" || Array.isArray(record) || Object.keys(record).sort().join(",") !== expected.sort().join(",")) throw code("malformed");
}

export function parseDatabaseEvidence(content, session) {
  const report = structuredClone(session.base);
  if (!content.length) return report;
  if (Buffer.byteLength(content) > LIMITS.bytes) throw code("oversized");
  const lines = content.split("\n");
  const partialWrite = lines.pop() !== "";
  if (lines.length > 2 * LIMITS.files + 2 * LIMITS.failures + 7) throw code("oversized");
  let header = false;
  let completion;
  let ioError = false;
  const files = [];
  const limits = new Set();
  const recorded = { "attempt-failure": 0, "final-failure": 0 };
  for (const line of lines) {
    if (Buffer.byteLength(line) > LIMITS.recordBytes) throw code("oversized");
    let record;
    try { record = JSON.parse(line); } catch { throw code("malformed"); }
    if (!header) {
      keys(record, ["type", "schemaVersion", "nonce"]);
      if (record.type !== "header" || record.schemaVersion !== 2 || record.nonce !== session.nonce) throw code("binding-mismatch");
      header = true;
      continue;
    }
    if (ioError) throw code("malformed");
    if (record.type === "io-error") {
      keys(record, ["type"]);
      ioError = true;
      continue;
    }
    if (completion) throw code("malformed");
    if (record.type === "limit") {
      keys(record, ["type", "kind"]);
      if (!["attempts", "final", "files", "counts"].includes(record.kind) || limits.has(record.kind)) throw code("malformed");
      limits.add(record.kind);
    } else if (record.type === "file-start") {
      keys(record, ["type", "run", "file"]);
      if (record.run !== files.length || files.length >= LIMITS.files || !(record.file === null || integer(record.file) && record.file < session.catalog.length)) throw code("malformed");
      files.push({ run: record.run, file: record.file, attempts: [], final: [], complete: false });
    } else if (record.type === "attempt-failure" || record.type === "final-failure") {
      keys(record, ["type", "run", "ordinal", "line", "column", "category"]);
      const file = files[record.run];
      if (!integer(record.run) || !file || file.complete || recorded[record.type] >= LIMITS.failures || !CATEGORIES.includes(record.category)) throw code("malformed");
      const failures = record.type === "attempt-failure" ? file.attempts : file.final;
      if (record.type === "attempt-failure" && file.final.length) throw code("malformed");
      for (const field of ["ordinal", "line", "column"]) if (!(record[field] === null || integer(record[field]))) throw code("malformed");
      if (record.category === "suite-error") {
        if (record.type !== "final-failure" || record.ordinal !== null || record.line !== null || record.column !== null || failures.some(f => f.ordinal === null)) throw code("malformed");
      } else if (!record.ordinal || record.ordinal <= (failures.at(-1)?.ordinal ?? 0) || failures.some(f => f.ordinal === null) || record.line === 0) throw code("malformed");
      failures.push(record);
      recorded[record.type] += 1;
    } else if (record.type === "file-complete") {
      keys(record, ["type", "run", "failedTests", "suiteErrors"]);
      const file = files[record.run];
      if (!integer(record.run) || !file || file.complete || !integer(record.failedTests) || ![0, 1].includes(record.suiteErrors)) throw code("malformed");
      const tests = file.final.filter(f => f.ordinal !== null).length;
      const suites = file.final.length - tests;
      if (record.failedTests < tests || record.suiteErrors < suites || (!limits.has("final") && (record.failedTests !== tests || record.suiteErrors !== suites))) throw code("malformed");
      Object.assign(file, { complete: true, failedTests: record.failedTests, suiteErrors: record.suiteErrors });
    } else if (record.type === "complete") {
      keys(record, ["type", "runnerFailedTests", "runnerSuiteErrors"]);
      if (![record.runnerFailedTests, record.runnerSuiteErrors].every(n => n === null || integer(n))) throw code("malformed");
      completion = record;
    } else throw code("malformed");
  }
  if (!header) { report.reason = "partial-write"; report.truncated = partialWrite; return report; }
  const reference = (file) => ({ fileRun: file.run, fileId: file.file, file: session.catalog[file.file]?.file ?? null, fileSha256: session.catalog[file.file]?.fileSha256 ?? null });
  const unfinished = files.filter(file => !file.complete);
  const completed = files.filter(file => file.complete);
  const failedTests = completed.reduce((sum, file) => sum + file.failedTests, 0);
  const suiteErrors = completed.reduce((sum, file) => sum + file.suiteErrors, 0);
  if (failedTests > LIMITS.events) throw code("malformed");
  const exact = !limits.has("files") && !limits.has("counts") && !unfinished.length;
  if (completion) {
    for (const [observed, runner] of [[failedTests, completion.runnerFailedTests], [suiteErrors, completion.runnerSuiteErrors]]) {
      if (runner !== null && (observed > runner || exact && observed !== runner)) throw code("malformed");
    }
  }
  for (const file of files) {
    for (const failure of file.complete ? file.final : file.attempts) {
      report.failures.push({ ...reference(file), ordinal: failure.ordinal, ordinalKind: failure.ordinal === null ? null : file.complete ? "final-result" : "attempt", provisional: !file.complete, line: failure.line, column: failure.column, category: failure.category });
    }
  }
  report.truncated = partialWrite || limits.has("final") || limits.has("files") || limits.has("counts") || (limits.has("attempts") && unfinished.length > 0) || report.failures.length > LIMITS.failures;
  report.failures = report.failures.slice(0, LIMITS.failures);
  report.complete = Boolean(completion) && !partialWrite && !ioError && !unfinished.length;
  report.progress = { runner: completion ? "completed" : "started", startedFiles: files.length, completedFiles: completed.length, inFlightFiles: unfinished.map(reference), omittedInFlightFiles: 0 };
  report.counts = completion ? { failedTests, suiteErrors, recorded: report.failures.length, exact: exact && completion.runnerFailedTests !== null && completion.runnerSuiteErrors !== null } : null;
  // Expanded catalog paths can outweigh wire records. Reserve space for outcome/cleanup.
  while (Buffer.byteLength(JSON.stringify(report, null, 2)) > LIMITS.bytes - 2048) {
    report.truncated = true;
    if (report.progress.inFlightFiles.length) { report.progress.inFlightFiles.pop(); report.progress.omittedInFlightFiles += 1; }
    else report.failures.pop();
  }
  if (report.counts) report.counts.recorded = report.failures.length;
  report.availability = report.complete ? "complete" : "partial";
  report.reason = ioError ? "reporter-io-failed" : partialWrite ? "partial-write" : !report.complete ? "runner-incomplete" : report.truncated ? "record-limit" : "collected";
  return report;
}

export async function collectDatabaseEvidence(session, { io = fs } = {}) {
  let handle;
  let report;
  try {
    await assertDirectory(session.directory, session.directoryIdentity, io);
    handle = await io.open(session.reportPath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const before = await handle.stat();
    if (!before.isFile() || !same(before, session.fileIdentity) || before.uid !== process.getuid?.() || before.nlink !== 1 || (before.mode & 0o777) !== 0o600) throw code("unsafe-file");
    if (before.size > LIMITS.bytes) throw code("oversized");
    const buffer = Buffer.alloc(LIMITS.bytes + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    const after = await handle.stat();
    if (offset > LIMITS.bytes) throw code("oversized");
    if (offset !== before.size || after.size !== before.size || after.mode !== before.mode || after.nlink !== before.nlink || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs || !same(await io.lstat(session.reportPath), before)) throw code("replaced-or-changed");
    await assertDirectory(session.directory, session.directoryIdentity, io);
    report = parseDatabaseEvidence(buffer.subarray(0, offset).toString("utf8"), session);
  } catch (error) {
    report = { ...structuredClone(session.base), reason: error.evidenceReason ?? (error.code === "ENOENT" ? "missing" : "read-failed") };
  } finally {
    try { await handle?.close(); } catch { report = { ...structuredClone(session.base), reason: "read-close-failed" }; }
  }
  return report;
}

export async function runWithDatabaseEvidence({ workspace, files, source, environment = {}, canaries = [], execute, onEvidence = () => {}, prepare = createDatabaseEvidenceSession, collect = collectDatabaseEvidence }) {
  let session;
  let commandResult;
  let report = unavailableDatabaseEvidence("setup-failed", { source, environment });
  try { session = await prepare({ workspace, files, source, environment, canaries }); } catch {}
  try {
    const result = await execute(session?.environment ?? {});
    commandResult = { exitCode: result?.exitCode ?? 0, signal: null, secondaryFailureCount: 0 };
    return result;
  } catch (error) {
    commandResult = { exitCode: Number.isInteger(error?.exitCode) ? error.exitCode : null, signal: /^SIG[A-Z0-9]{1,8}$/.test(error?.signal ?? "") ? error.signal : null, secondaryFailureCount: Array.isArray(error?.secondaryErrors) ? Math.min(LIMITS.events, error.secondaryErrors.length) : 0 };
    throw error;
  } finally {
    if (session) {
      try { report = await collect(session); } catch { report = { ...session.base, reason: "collection-failed" }; }
      try { await session.dispose(); report.cleanup = "complete"; } catch { report.cleanup = "failed"; }
    }
    report.commandResult = commandResult;
    try { onEvidence(report); } catch {}
  }
}

export async function persistDatabaseEvidence(summary, environment = {}, { publish = exportDatabaseEvidence, appendOutput = fs.appendFile } = {}) {
  if (summary.databaseTestsExport) return;
  const report = summary.databaseTests;
  const cleanSuccess = report.complete && !report.truncated && !report.failures.length &&
    report.cleanup === "complete" && report.commandResult?.exitCode === 0 &&
    report.commandResult.signal === null && report.commandResult.secondaryFailureCount === 0;
  if (environment.MIGRATION_GATE_CI_DATABASE_REPORT !== "1" && (report.reason === "command-not-run" || cleanSuccess)) {
    summary.databaseTestsExport = { availability: "not-requested" };
    return;
  }
  try {
    const exported = await publish(report, environment);
    // Keep machine-local export paths out of the public summary.
    summary.databaseTestsExport = exported.availability === "available"
      ? { availability: "available", filename: "local-migration-database-failures.json" }
      : { availability: "unavailable", reason: "export-failed", ...(exported.cleanup ? { cleanup: exported.cleanup } : {}) };
    if (exported.local && exported.cleanup === "retained") console.log(`migration-gate: database report export cleanup incomplete; inspect private directory: ${exported.retainedPath}`);
    if (exported.availability !== "available") return;
    if (exported.local) console.log(`migration-gate: database test evidence: ${exported.path}`);
    if (environment.MIGRATION_GATE_CI_DATABASE_REPORT === "1" && environment.GITHUB_OUTPUT) {
      try { await appendOutput(environment.GITHUB_OUTPUT, "database_report_ready=true\n"); }
      catch { summary.databaseTestsExport.uploadReadiness = "unavailable"; }
    }
  } catch {
    summary.databaseTestsExport = { availability: "unavailable", reason: "export-failed" };
  }
}

// Only this sanitized projection crosses the diagnostics lifetime boundary.
// Fresh no-clobber publication prevents stale reports from masquerading as this attempt.
export async function exportDatabaseEvidence(report, environment = {}, { io = fs } = {}) {
  let directory;
  let parent;
  let temporary;
  let target;
  let written;
  let handle;
  let local = false;
  let published = false;
  let success = false;
  const outcome = { availability: "unavailable", reason: "export-failed" };
  try {
    const content = JSON.stringify(report, null, 2) + "\n";
    if (Buffer.byteLength(content) > LIMITS.bytes) throw code("oversized");
    if (environment.MIGRATION_GATE_CI_DATABASE_REPORT === "1") {
      if (!path.isAbsolute(environment.RUNNER_TEMP ?? "")) throw code("unsafe-export");
      directory = await io.realpath(environment.RUNNER_TEMP);
      parent = await io.lstat(directory);
    } else {
      directory = await io.mkdtemp(path.join(os.tmpdir(), "cr-database-report-"));
      local = true;
      parent = await io.lstat(directory);
      directory = await io.realpath(directory);
    }
    if (!parent.isDirectory() || parent.uid !== process.getuid?.() || (local && (parent.mode & 0o777) !== 0o700)) throw code("unsafe-export");
    target = path.join(directory, "local-migration-database-failures.json");
    temporary = path.join(directory, `.database-report-${randomBytes(16).toString("hex")}`);
    handle = await io.open(temporary, "wx", 0o600);
    written = await handle.stat();
    await handle.writeFile(content);
    await handle.sync();
    await handle.close();
    handle = null;
    if (!same(parent, await io.lstat(directory)) || await io.realpath(directory) !== directory) throw code("unsafe-export");
    await io.link(temporary, target);
    published = true;
    const linked = await io.lstat(target);
    if (!linked.isFile() || !same(written, linked) || linked.size !== Buffer.byteLength(content) || (linked.mode & 0o777) !== 0o600) throw code("unsafe-export");
    const pending = await io.lstat(temporary);
    if (!pending.isFile() || !same(written, pending) || !same(parent, await io.lstat(directory))) throw code("unsafe-export");
    await io.unlink(temporary);
    temporary = null;
    const final = await io.lstat(target);
    if (!same(final, written) || final.nlink !== 1 || !same(parent, await io.lstat(directory))) throw code("unsafe-export");
    success = true;
    return { availability: "available", path: target, local };
  } catch {
    return outcome;
  } finally {
    await handle?.close().catch(() => {});
    if (!success && directory) {
      try {
        // Remove only objects whose pinned identities still match; never recurse.
        const current = await io.lstat(directory);
        if (!parent || !current.isDirectory() || !same(parent, current) || current.uid !== process.getuid?.()) throw code("unsafe-export");
        for (const file of [temporary, published ? target : null].filter(Boolean)) {
          let info;
          try { info = await io.lstat(file); } catch (error) { if (error.code === "ENOENT") continue; throw error; }
          if (!written || !info.isFile() || !same(written, info) || !same(parent, await io.lstat(directory))) throw code("unsafe-export");
          await io.unlink(file);
        }
        if (local) await io.rmdir(directory);
        outcome.cleanup = "complete";
      } catch {
        outcome.cleanup = "retained";
        if (local) { outcome.local = true; outcome.retainedPath = directory; }
      }
    }
  }
}
