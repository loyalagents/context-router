import { createHash, randomBytes } from "node:crypto";
import { constants } from "node:fs";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Reporter from "./local-database-reporter.cjs";
import { redactSecrets } from "./gate-runner.mjs";

const { LIMITS, CATEGORIES } = Reporter;
const FILE_PATTERN = /^apps\/backend\/test\/local-database\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.spec\.ts$/;
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
    schemaVersion: 1,
    phase: "backend-database",
    command: "pnpm --filter backend test:local-database",
    attemptId,
    source: { headSha: hashValue(source.headSha, 40), dirty: typeof source.dirty === "boolean" ? source.dirty : null, copiedInputsSha256: hashValue(source.copiedInputsSha256, 64) },
    run: { id: runValue(environment.GITHUB_RUN_ID), attempt: runValue(environment.GITHUB_RUN_ATTEMPT) },
    availability: "unavailable", reason, complete: false, truncated: false,
    privacy: "runtime-text-omitted", failures: [], counts: null,
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
  const selected = files.filter((file) => typeof file === "string" && file.length <= 240 && FILE_PATTERN.test(file));
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
  if (lines.length > LIMITS.failures + 3) throw code("oversized");
  let header = false;
  let completion;
  let ioError = false;
  let tests = 0;
  let suites = 0;
  const previous = new Map();
  for (const line of lines) {
    if (Buffer.byteLength(line) > LIMITS.recordBytes) throw code("oversized");
    let record;
    try { record = JSON.parse(line); } catch { throw code("malformed"); }
    if (!header) {
      keys(record, ["type", "schemaVersion", "nonce"]);
      if (record.type !== "header" || record.schemaVersion !== 1 || record.nonce !== session.nonce) throw code("binding-mismatch");
      header = true;
      continue;
    }
    if (ioError) throw code("malformed");
    if (record.type === "io-error") {
      keys(record, ["type"]);
      ioError = true;
    } else if (record.type === "failure" && !completion) {
      keys(record, ["type", "file", "ordinal", "line", "column", "category"]);
      if (report.failures.length >= LIMITS.failures || !(record.file === null || integer(record.file) && record.file < session.catalog.length) || !CATEGORIES.includes(record.category)) throw code("malformed");
      for (const field of ["ordinal", "line", "column"]) if (!(record[field] === null || integer(record[field]))) throw code("malformed");
      if (record.category === "suite-load") {
        if (record.ordinal !== null || record.line !== null || record.column !== null) throw code("malformed");
        suites += 1;
      } else {
        if (!record.ordinal || record.ordinal <= (previous.get(record.file) ?? 0) || record.line === 0) throw code("malformed");
        previous.set(record.file, record.ordinal);
        tests += 1;
      }
      const file = session.catalog[record.file];
      report.failures.push({ fileId: record.file, file: file?.file ?? null, fileSha256: file?.fileSha256 ?? null, ordinal: record.ordinal, line: record.line, column: record.column, category: record.category });
    } else if (record.type === "complete" && !completion) {
      keys(record, ["type", "failedTests", "failedSuites", "recorded", "truncated", "runnerFailedTests"]);
      if (![record.failedTests, record.failedSuites, record.recorded, record.runnerFailedTests].every(integer) || typeof record.truncated !== "boolean" || record.recorded !== report.failures.length || record.failedTests !== record.runnerFailedTests || record.failedTests < tests || record.failedSuites < suites || (!record.truncated && record.failedTests + record.failedSuites !== record.recorded)) throw code("malformed");
      completion = record;
    } else throw code("malformed");
  }
  if (!header) { report.reason = "partial-write"; report.truncated = partialWrite; return report; }
  report.complete = Boolean(completion) && !partialWrite && !ioError;
  report.truncated = partialWrite || Boolean(completion?.truncated);
  report.availability = report.complete ? "complete" : "partial";
  report.reason = ioError ? "reporter-io-failed" : partialWrite ? "partial-write" : !completion ? "runner-incomplete" : report.truncated ? "record-limit" : "collected";
  report.counts = completion ? { failedTests: completion.failedTests, failedSuites: completion.failedSuites, recorded: completion.recorded } : null;
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
  if (environment.MIGRATION_GATE_CI_DATABASE_REPORT !== "1" && (report.reason === "command-not-run" || report.complete && !report.failures.length)) {
    summary.databaseTestsExport = { availability: "not-requested" };
    return;
  }
  try {
    const exported = await publish(report, environment);
    // Keep machine-local export paths out of the public summary.
    summary.databaseTestsExport = exported.availability === "available"
      ? { availability: "available", filename: "local-migration-database-failures.json" }
      : { availability: "unavailable", reason: "export-failed" };
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
  let temporary;
  let handle;
  let local = false;
  try {
    const content = JSON.stringify(report, null, 2) + "\n";
    if (Buffer.byteLength(content) > LIMITS.bytes) throw code("oversized");
    if (environment.MIGRATION_GATE_CI_DATABASE_REPORT === "1") {
      if (!path.isAbsolute(environment.RUNNER_TEMP ?? "")) throw code("unsafe-export");
      directory = await io.realpath(environment.RUNNER_TEMP);
    } else {
      directory = await io.realpath(await io.mkdtemp(path.join(os.tmpdir(), "cr-database-report-")));
      local = true;
    }
    const parent = await io.lstat(directory);
    if (!parent.isDirectory() || parent.uid !== process.getuid?.()) throw code("unsafe-export");
    const target = path.join(directory, "local-migration-database-failures.json");
    temporary = path.join(directory, `.database-report-${randomBytes(16).toString("hex")}`);
    handle = await io.open(temporary, "wx", 0o600);
    await handle.writeFile(content);
    await handle.sync();
    const written = await handle.stat();
    await handle.close();
    handle = null;
    if (!same(parent, await io.lstat(directory)) || await io.realpath(directory) !== directory) throw code("unsafe-export");
    await io.link(temporary, target);
    const published = await io.lstat(target);
    if (!published.isFile() || !same(written, published) || published.size !== Buffer.byteLength(content) || (published.mode & 0o777) !== 0o600) throw code("unsafe-export");
    await io.unlink(temporary);
    temporary = null;
    const final = await io.lstat(target);
    if (!same(final, written) || final.nlink !== 1 || !same(parent, await io.lstat(directory))) throw code("unsafe-export");
    return { availability: "available", path: target, local };
  } catch {
    return { availability: "unavailable", reason: "export-failed" };
  } finally {
    await handle?.close().catch(() => {});
    if (temporary) await io.unlink(temporary).catch(() => {});
    if (local && temporary) await io.rmdir(directory).catch(() => {});
  }
}
