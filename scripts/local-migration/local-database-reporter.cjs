// Diagnostic only: never expose Jest strings/objects or change Jest's exit code.
const fs = require('node:fs');
const path = require('node:path');
const LIMITS = Object.freeze({ bytes: 65536, recordBytes: 512, failures: 64, files: 128, events: 100000, optionsBytes: 65536 });
const CATEGORIES = Object.freeze(['assertion', 'exception', 'suite-load', 'toBe', 'toEqual', 'toStrictEqual', 'toThrow', 'toMatch', 'toMatchObject', 'toContain', 'toHaveLength', 'toBeTruthy', 'toBeFalsy', 'toBeNull', 'toBeDefined', 'toBeUndefined', 'toBeGreaterThan', 'toBeLessThan', 'toHaveProperty']);
const integer = (n) => Number.isSafeInteger(n) && n >= 0 && n <= LIMITS.events;
const sameFile = (a, b) => a.dev === b.dev && a.ino === b.ino && a.uid === b.uid;

class DatabaseReporter {
  constructor(_config, options, _context, io = fs) {
    this.io = io;
    this.fd = null;
    this.bytes = 0;
    this.recorded = 0;
    this.failedTests = 0;
    this.failedSuites = 0;
    this.ordinals = new Map();
    this.truncated = false;
    this.disabled = false;
    try {
      const raw = options?.nonce ? options : process.env.CR_DATABASE_EVIDENCE;
      if (typeof raw === 'string' && Buffer.byteLength(raw) > LIMITS.optionsBytes) throw Error();
      this.options = typeof raw === 'string' ? JSON.parse(raw) : raw;
      const o = this.options;
      if (!o || !/^[a-f0-9]{32}$/.test(o.nonce) || !Array.isArray(o.files) || o.files.length > LIMITS.files || !path.isAbsolute(o.root) || path.basename(o.reportPath) !== 'results.ndjson') throw Error();
      if (o.files.some((f) => typeof f !== 'string' || f.length > 240 || !/^apps\/backend\/test\/local-database\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.spec\.ts$/.test(f))) throw Error();
      const directory = io.lstatSync(path.dirname(o.reportPath));
      if (!directory.isDirectory() || !sameFile(directory, o.directory) || (directory.mode & 0o777) !== 0o700) throw Error();
      this.fd = io.openSync(o.reportPath, fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
      const info = io.fstatSync(this.fd);
      if (!info.isFile() || !sameFile(info, o.file) || info.size !== 0 || info.nlink !== 1 || (info.mode & 0o777) !== 0o600) throw Error();
      this.owned = true;
      this.append({ type: 'header', schemaVersion: 1, nonce: o.nonce });
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
    // Best effort fixed marker, including after a failed terminal close.
    if (this.owned) { try { this.append({ type: 'io-error' }); } catch {} }
    try { this.io.closeSync(this.fd); } catch {}
    this.fd = null;
  }

  identify(test) {
    const absolute = test?.path;
    if (typeof absolute !== 'string' || absolute.length > 4096) return null;
    const index = this.options.files.findIndex((file) => path.join(this.options.root, file) === absolute);
    return index < 0 ? null : index;
  }

  record(record) {
    if (this.recorded >= LIMITS.failures) { this.truncated = true; return; }
    this.append({ type: 'failure', ...record });
    this.recorded += 1;
  }

  onTestCaseResult(test, result) {
    if (this.disabled) return;
    try {
      const file = this.identify(test);
      const ordinal = (this.ordinals.get(file) ?? 0) + 1;
      if (ordinal > LIMITS.events) { this.truncated = true; return; }
      this.ordinals.set(file, ordinal);
      if (result?.status !== 'failed') return;
      this.failedTests = Math.min(LIMITS.events, this.failedTests + 1);
      let category = 'exception';
      // Inspect at most four structured entries; never inspect messages/stacks/values.
      if (Array.isArray(result.failureDetails)) {
        for (let i = 0; i < Math.min(4, result.failureDetails.length); i += 1) {
          const matcher = result.failureDetails[i]?.matcherResult;
          if (matcher) { category = CATEGORIES.includes(matcher.name) ? matcher.name : 'assertion'; break; }
        }
      }
      const line = integer(result.location?.line) && result.location.line > 0 ? result.location.line : null;
      const column = integer(result.location?.column) ? result.location.column : null;
      this.record({ file, ordinal, line, column, category });
    } catch { this.fail(); }
  }

  onTestResult(test, result) {
    if (this.disabled) return;
    try {
      if (!result?.testExecError) return;
      this.failedSuites = Math.min(LIMITS.events, this.failedSuites + 1);
      this.record({ file: this.identify(test), ordinal: null, line: null, column: null, category: 'suite-load' });
    } catch { this.fail(); }
  }

  onRunComplete(_contexts, results) {
    if (this.disabled) return;
    try {
      this.append({ type: 'complete', failedTests: this.failedTests, failedSuites: this.failedSuites, recorded: this.recorded, truncated: this.truncated, runnerFailedTests: integer(results?.numFailedTests) ? results.numFailedTests : null });
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
