// Diagnostic only: never expose Jest strings/objects or change Jest's exit code.
const fs = require('node:fs');
const path = require('node:path');
const LIMITS = Object.freeze({ bytes: 65536, recordBytes: 512, failures: 64, files: 128, events: 100000, optionsBytes: 65536 });
const CATEGORIES = Object.freeze(['assertion', 'exception', 'suite-error', 'toBe', 'toEqual', 'toStrictEqual', 'toThrow', 'toMatch', 'toMatchObject', 'toContain', 'toHaveLength', 'toBeTruthy', 'toBeFalsy', 'toBeNull', 'toBeDefined', 'toBeUndefined', 'toBeGreaterThan', 'toBeLessThan', 'toHaveProperty']);
const integer = (n) => Number.isSafeInteger(n) && n >= 0 && n <= LIMITS.events;
const sameFile = (a, b) => a.dev === b.dev && a.ino === b.ino && a.uid === b.uid;
// Source catalog only, never a runtime path. Dots/spaces/Unicode are valid Jest names.
const sourceName = (f) => typeof f === 'string' && Buffer.byteLength(f) <= 240 &&
  f.startsWith('apps/backend/test/local-database/') && f.endsWith('.spec.ts') &&
  !/[\\\x00-\x1f\x7f]/.test(f) && f.split('/').every(p => p && p !== '.' && p !== '..');

class DatabaseReporter {
  constructor(_config, options, _context, io = fs) {
    this.io = io;
    this.fd = null;
    this.bytes = 0;
    this.recorded = { attempts: 0, final: 0 };
    this.files = new Map();
    this.limits = new Set();
    this.scanned = 0;
    this.disabled = false;
    try {
      const raw = options?.nonce ? options : process.env.CR_DATABASE_EVIDENCE;
      if (typeof raw === 'string' && Buffer.byteLength(raw) > LIMITS.optionsBytes) throw Error();
      this.options = typeof raw === 'string' ? JSON.parse(raw) : raw;
      const o = this.options;
      if (!o || !/^[a-f0-9]{32}$/.test(o.nonce) || !Array.isArray(o.files) || o.files.length > LIMITS.files || !path.isAbsolute(o.root) || path.basename(o.reportPath) !== 'results.ndjson') throw Error();
      if (o.files.some(f => !sourceName(f))) throw Error();
      const directory = io.lstatSync(path.dirname(o.reportPath));
      if (!directory.isDirectory() || !sameFile(directory, o.directory) || (directory.mode & 0o777) !== 0o700) throw Error();
      this.fd = io.openSync(o.reportPath, fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
      const info = io.fstatSync(this.fd);
      if (!info.isFile() || !sameFile(info, o.file) || info.size !== 0 || info.nlink !== 1 || (info.mode & 0o777) !== 0o600) throw Error();
      this.owned = true;
      this.append({ type: 'header', schemaVersion: 2, nonce: o.nonce });
    } catch { this.fail(); }
  }

  append(record) {
    const bytes = Buffer.from(JSON.stringify(record) + '\n');
    if (bytes.length > LIMITS.recordBytes || this.bytes + bytes.length > LIMITS.bytes) throw Error();
    let offset = 0;
    while (offset < bytes.length) {
      const written = this.io.writeSync(this.fd, bytes, offset, bytes.length - offset);
      if (!Number.isInteger(written) || written <= 0) throw Error();
      offset += written;
    }
    this.bytes += bytes.length;
  }

  fail() {
    this.disabled = true;
    if (this.fd === null) return;
    if (this.owned) { try { this.append({ type: 'io-error' }); } catch {} }
    try { this.io.closeSync(this.fd); } catch {}
    this.fd = null;
  }

  limit(kind) {
    if (this.limits.has(kind)) return;
    this.append({ type: 'limit', kind });
    this.limits.add(kind);
  }

  file(test) {
    const absolute = test?.path;
    // Unidentifiable paths must not share a null map key or grow memory unboundedly.
    if (typeof absolute !== 'string' || absolute.length > 4096 || !path.isAbsolute(absolute)) { this.limit('files'); return null; }
    if (this.files.has(absolute)) return this.files.get(absolute);
    if (this.files.size === LIMITS.files) { this.limit('files'); return null; }
    const index = this.options.files.findIndex(file => path.join(this.options.root, file) === absolute);
    const entry = { run: this.files.size, ordinal: 0, complete: false };
    this.append({ type: 'file-start', run: entry.run, file: index < 0 ? null : index });
    this.files.set(absolute, entry);
    return entry;
  }

  record(kind, entry, result, ordinal) {
    if (this.recorded[kind] === LIMITS.failures) { this.limit(kind); return; }
    let category = ordinal === null ? 'suite-error' : 'exception';
    // Inspect at most four structured entries; never inspect messages/stacks/values.
    if (ordinal !== null && Array.isArray(result?.failureDetails)) {
      for (let i = 0; i < Math.min(4, result.failureDetails.length); i += 1) {
        const matcher = result.failureDetails[i]?.matcherResult;
        if (matcher) { category = CATEGORIES.includes(matcher.name) && matcher.name !== 'suite-error' ? matcher.name : 'assertion'; break; }
      }
    }
    const line = ordinal !== null && integer(result?.location?.line) && result.location.line > 0 ? result.location.line : null;
    const column = ordinal !== null && integer(result?.location?.column) ? result.location.column : null;
    this.append({ type: kind === 'attempts' ? 'attempt-failure' : 'final-failure', run: entry.run, ordinal, line, column, category });
    this.recorded[kind] += 1;
  }

  onTestStart(test) {
    if (this.disabled) return;
    try { this.file(test); } catch { this.fail(); }
  }

  onTestCaseResult(test, result) {
    if (this.disabled) return;
    try {
      const entry = this.file(test);
      if (!entry || entry.complete) return;
      if (entry.ordinal === LIMITS.events) { this.limit('attempts'); return; }
      entry.ordinal += 1;
      if (result?.status === 'failed') this.record('attempts', entry, result, entry.ordinal);
    } catch { this.fail(); }
  }

  onTestResult(test, result) {
    if (this.disabled) return;
    try {
      const entry = this.file(test);
      if (!entry || entry.complete) return;
      let failedTests = 0;
      const results = Array.isArray(result?.testResults) ? result.testResults : [];
      const remaining = LIMITS.events - this.scanned;
      if (!Array.isArray(result?.testResults) || results.length > remaining) this.limit('counts');
      for (let i = 0; i < Math.min(results.length, remaining); i += 1) {
        if (results[i]?.status === 'failed') { failedTests += 1; this.record('final', entry, results[i], i + 1); }
      }
      this.scanned += Math.min(results.length, remaining);
      const suiteErrors = result?.testExecError ? 1 : 0;
      if (suiteErrors) this.record('final', entry, null, null);
      // Commit this file's final results together; a killed write leaves attempts provisional.
      this.append({ type: 'file-complete', run: entry.run, failedTests, suiteErrors });
      entry.complete = true;
    } catch { this.fail(); }
  }

  onRunComplete(_contexts, results) {
    if (this.disabled) return;
    try {
      this.append({ type: 'complete', runnerFailedTests: integer(results?.numFailedTests) ? results.numFailedTests : null, runnerSuiteErrors: integer(results?.numRuntimeErrorTestSuites) ? results.numRuntimeErrorTestSuites : null });
      this.io.fsyncSync(this.fd);
      this.io.closeSync(this.fd);
      this.fd = null;
      this.disabled = true;
    } catch { this.fail(); }
  }
}

module.exports = DatabaseReporter;
module.exports.LIMITS = LIMITS;
module.exports.CATEGORIES = CATEGORIES;
module.exports.sourceName = sourceName;
