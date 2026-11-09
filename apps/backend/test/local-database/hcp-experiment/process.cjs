const {
  createSyntheticExperiment,
  openSyntheticExperiment,
  resetSyntheticExperiment,
} = require("../../../dist/composition/hcp-experiment.js");
const {
  syntheticFixtures,
} = require("../../../dist/infrastructure/hcp-experiment/fixtures.js");
const [sandbox, root, action, boundary, nowText] = process.argv.slice(2);
const paths = { sandbox, root };
const clock = () => Number(nowText);
const say = (value) =>
  require("node:fs").writeSync(1, JSON.stringify(value) + "\n");
if (boundary === "hot-before-commit") {
  // Force real SQLite page spill, not just a kill with all changes in memory.
  const { DatabaseSync } = require("node:sqlite");
  const exec = DatabaseSync.prototype.exec;
  DatabaseSync.prototype.exec = function (sql) {
    if (sql.includes("BEGIN IMMEDIATE"))
      exec.call(this, "PRAGMA cache_size=1; PRAGMA cache_spill=ON");
    return exec.call(this, sql);
  };
}
const fault = (point) => {
  if (boundary === "hot-before-commit" && point === "before-commit") {
    const journal = require("node:fs").readFileSync(
      require("node:path").join(root, "entries.sqlite-journal"),
    );
    say({
      boundary,
      hotJournal: journal.subarray(0, 8).toString("hex") === "d9d505f920a163d7",
    });
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
  }
  if (point === boundary) {
    say({ boundary: point });
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
  }
};
try {
  if (action === "reset") {
    resetSyntheticExperiment(paths, { fault });
    say({ reset: true });
  } else {
    const fixtures = syntheticFixtures();
    for (const fixture of fixtures)
      for (const version of fixture.versions)
        version.assertion.validUntil = "2026-11-08T12:00:00.000Z";
    const store =
      action === "create"
        ? createSyntheticExperiment(paths, { clock, fault, fixtures })
        : openSyntheticExperiment(paths, { clock, fault });
    // Exercise filesystem/health checks before reporting ownership to contenders.
    const entries = store.inspectEntries(),
      audit = store.inspectAudit();
    store.settings();
    say({
      admitted: true,
      storeId: store.storeId,
      count: entries.length,
      expired: entries.filter((e) => e.record.status === "expired").length,
      auditCount: audit.length,
    });
    if (action === "attempt") store.close();
    else setInterval(() => {}, 1000);
  }
} catch (e) {
  say({ refused: true, error: e.message });
  process.exitCode = 1;
}
