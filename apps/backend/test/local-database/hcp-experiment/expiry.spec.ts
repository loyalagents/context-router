import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  createSyntheticExperiment,
  openSyntheticExperiment,
} from "../../../src/composition/hcp-experiment";
import { syntheticFixtures } from "../../../src/infrastructure/hcp-experiment/fixtures";

const deadline = Date.parse("2026-11-08T12:00:00.000Z");
describe("HCP C1 offline entry expiry recovery (application evidence only)", () => {
  let sandbox: string;
  let now: number;
  let store: ReturnType<typeof openSyntheticExperiment> | undefined;
  const options = () => ({ sandbox, root: path.join(sandbox, "experiment") });
  const clock = () => now;
  beforeEach(() => {
    sandbox = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "hcp-c1-")),
    );
    fs.chmodSync(sandbox, 0o700);
    now = deadline - 1;
  });
  afterEach(() => {
    store?.close();
    store = undefined;
    fs.rmSync(sandbox, { recursive: true });
  });
  function seed() {
    const fixtures = syntheticFixtures();
    for (const fixture of fixtures)
      for (const version of fixture.versions)
        version.assertion.validUntil = new Date(deadline).toISOString();
    store = createSyntheticExperiment(options(), { fixtures, clock });
    return store.inspectEntries();
  }

  it("expires exactly at the deadline before any internal read, retaining original versions and precedence", () => {
    const before = seed();
    now = deadline;
    const after = store!.inspectEntries();
    for (const entry of after) {
      const prior = before.find((e) => e.id === entry.id)!;
      expect(entry.record.status).toBe(
        ["deleted", "revoked"].includes(prior.record.status)
          ? prior.record.status
          : "expired",
      );
      expect(entry.record.version).toBe(prior.record.version);
      expect(entry.content).toEqual(prior.content);
      expect(entry.record.provenance).toEqual(prior.record.provenance);
    }
    const expired = store!
      .inspectAudit()
      .filter((e) => e.eventType === "context.expired");
    expect(expired.length).toBe(
      before.filter(
        (e) => !["deleted", "revoked", "expired"].includes(e.record.status),
      ).length,
    );
    expect(
      expired.every(
        (e) =>
          e.timestamp === new Date(now).toISOString() &&
          e.data.effectiveAt === new Date(deadline).toISOString(),
      ),
    ).toBe(true);
    const versioned = after.find((e) => e.record.version === 2)!;
    expect(store!.inspectEntry(versioned.id, 1)!.record.status).toBe("expired");
  });

  it("reconciles a simulated 48-hour outage before admission, never backdates or appends twice", () => {
    seed();
    store!.close();
    now = deadline + 48 * 60 * 60 * 1000;
    store = openSyntheticExperiment(options(), { clock });
    const entries = store.inspectEntries();
    const audit = store.inspectAudit();
    const expired = audit.filter((e) => e.eventType === "context.expired");
    expect(expired.length).toBeGreaterThan(0);
    expect(
      expired.every(
        (e) =>
          e.timestamp === new Date(now).toISOString() &&
          e.data.effectiveAt === new Date(deadline).toISOString(),
      ),
    ).toBe(true);
    store.close();
    now += 1000;
    store = openSyntheticExperiment(options(), { clock });
    expect(store.inspectEntries()).toEqual(entries);
    expect(store.inspectAudit()).toEqual(audit);
  });

  it("rolls back the entire overdue batch on audit failure, closes admission, and recovers once", () => {
    const before = seed();
    const beforeAudit = store!.inspectAudit();
    store!.close();
    now = deadline + 48 * 60 * 60 * 1000;
    let attempts = 0;
    expect(() =>
      openSyntheticExperiment(options(), {
        clock,
        fault(point) {
          if (point === "before-audit" && ++attempts === 2)
            throw new Error("injected audit failure");
        },
      }),
    ).toThrow();
    const db = new DatabaseSync(path.join(options().root, "entries.sqlite"));
    try {
      expect(
        db
          .prepare("SELECT count(*) n FROM entries WHERE status='expired'")
          .get().n,
      ).toBe(0);
      expect(db.prepare("SELECT count(*) n FROM audit_events").get().n).toBe(
        beforeAudit.length,
      );
    } finally {
      db.close();
    }
    store = openSyntheticExperiment(options(), { clock });
    expect(
      store.inspectAudit().filter((e) => e.eventType === "context.expired")
        .length,
    ).toBe(
      before.filter((e) => !["revoked", "deleted"].includes(e.record.status))
        .length,
    );
  });

  it("rechecks overdue entries when a durable recovery commit crosses a later deadline", () => {
    const fixtures = syntheticFixtures();
    fixtures[0].versions.forEach(
      (v) => (v.assertion.validUntil = new Date(deadline).toISOString()),
    );
    fixtures[1].versions.forEach(
      (v) => (v.assertion.validUntil = new Date(deadline + 1000).toISOString()),
    );
    store = createSyntheticExperiment(options(), { fixtures, clock });
    store.close();
    now = deadline;
    store = openSyntheticExperiment(options(), {
      clock,
      fault(point) {
        if (point === "after-data-commit") now = deadline + 2000;
      },
    });
    // Open itself must finish all overdue transitions before returning an admitted handle.
    const db = new DatabaseSync(path.join(options().root, "entries.sqlite"));
    try {
      expect(
        db
          .prepare("SELECT count(*) n FROM entries WHERE status='expired'")
          .get().n,
      ).toBe(2);
    } finally {
      db.close();
    }
  });

  it("latches an already-open handle closed when expiry commit fails", () => {
    seed();
    store!.close();
    let fail = true;
    store = openSyntheticExperiment(options(), {
      clock,
      fault(point) {
        if (point === "before-commit" && fail)
          throw new Error("injected commit failure");
      },
    });
    now = deadline;
    expect(() => store!.inspectEntries()).toThrow();
    fail = false;
    expect(() => store!.inspectAudit()).toThrow();
    store.close();
    store = openSyntheticExperiment(options(), { clock });
    expect(
      store.inspectEntries().every((e) => e.record.status !== "active"),
    ).toBe(true);
  });
});
