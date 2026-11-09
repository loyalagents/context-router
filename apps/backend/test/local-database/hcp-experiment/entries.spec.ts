import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  createSyntheticExperiment,
  openSyntheticExperiment,
} from "../../../src/composition/hcp-experiment";
import { syntheticFixtures } from "../../../src/infrastructure/hcp-experiment/fixtures";

describe("HCP C1 native versions, provenance and audit", () => {
  let sandbox: string;
  let store: ReturnType<typeof openSyntheticExperiment> | undefined;
  const options = () => ({ sandbox, root: path.join(sandbox, "experiment") });
  beforeEach(() => {
    sandbox = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "hcp-c1-")),
    );
    fs.chmodSync(sandbox, 0o700);
  });
  afterEach(() => {
    store?.close();
    store = undefined;
    fs.rmSync(sandbox, { recursive: true });
  });

  it("preserves nested values/types across JSON serialization, commit and reopen, keeping v1/v2 immutable", () => {
    const fixtures = JSON.parse(JSON.stringify(syntheticFixtures()));
    store = createSyntheticExperiment(options(), { fixtures });
    const before = store.inspectEntries();
    const current = before.find((e) => e.record.version === 2)!;
    const first = store.inspectEntry(current.id, 1)!;
    expect(first.id).toBe(current.id);
    expect(first.subject).toEqual(current.subject);
    expect(first.content).not.toEqual(current.content);
    expect(first.record.version).toBe(1);
    expect(current.record.provenance.assertedBy.assurance).toBe("unverified");
    expect(current.record.provenance.confirmations).toEqual([]);
    expect(current.record.provenance.fixture.simulated).toBe(true);
    expect(current.record.metadata.authority).toEqual({
      role: "management-client",
      grant: true,
    });
    expect(current.extension).toEqual({
      nested: [null, true, 7, "7", { unknown: ["value"] }],
    });
    expect(current.content.extension).toEqual({
      nested: [false, null, { number: 1.5 }],
    });
    const audit = store.inspectAudit();
    expect(audit.every((e) => e.data.fixture.simulated === true)).toBe(true);
    store.close();
    store = openSyntheticExperiment(options());
    expect(store.inspectEntries()).toEqual(before);
    expect(store.inspectEntry(current.id, 1)).toEqual(first);
    expect(store.inspectAudit()).toEqual(audit);
    current.content.value = "caller mutation";
    expect(store.inspectEntry(current.id)!.content.value).not.toBe(
      "caller mutation",
    );
  });

  it("retains unknown assertion, evidence, classification and private record members exactly as supplied", () => {
    const fixtures = syntheticFixtures();
    fixtures[0].classification.extension = {
      opaque: [false, null, 42, { actor: "not-authority" }],
    };
    store = createSyntheticExperiment(options(), { fixtures });
    const id = store.inspectEntries().find((e) => e.record.version === 2)!.id;
    store.close();
    store = openSyntheticExperiment(options());
    for (let version = 1; version <= 2; version++) {
      const entry = store.inspectEntry(id, version)!;
      const source = fixtures[0].versions[version - 1];
      expect(entry.assertion).toEqual(source.assertion);
      expect(entry.evidence).toEqual(source.evidence);
      expect(entry.classification).toEqual(fixtures[0].classification);
      expect(entry.record.extension).toEqual(
        source.recordExtensions!.extension,
      );
      expect(entry.record.metadata).toEqual(source.recordExtensions!.metadata);
      expect(entry.record.provenance.assertedBy.assurance).toBe("unverified");
    }
  });

  it("guards immutable versions, subject and append-only audit in SQLite", () => {
    store = createSyntheticExperiment(options());
    store.close();
    const db = new DatabaseSync(path.join(options().root, "entries.sqlite"));
    try {
      expect(() =>
        db.exec("UPDATE entry_versions SET document='{}'"),
      ).toThrow();
      expect(() => db.exec("DELETE FROM entry_versions")).toThrow();
      expect(() => db.exec("UPDATE entries SET subject='{}'")).toThrow();
      expect(() => db.exec("UPDATE audit_events SET event='{}'")).toThrow();
      expect(() => db.exec("DELETE FROM audit_events")).toThrow();
    } finally {
      db.close();
    }
  });

  it("does not accept caller-supplied provider authority or fabricated assurances", () => {
    const fixtures = syntheticFixtures();
    (fixtures[0].versions[0] as any).record = {
      provenance: { assertedBy: { assurance: "authenticated" } },
    };
    expect(() => createSyntheticExperiment(options(), { fixtures })).toThrow();
  });

  it("rolls back initialization entries and audit together on a late audit failure", () => {
    let count = 0;
    expect(() =>
      createSyntheticExperiment(options(), {
        fault(point) {
          if (point === "before-audit" && ++count === 2)
            throw new Error("injected append failure");
        },
      }),
    ).toThrow();
    expect(() => openSyntheticExperiment(options())).toThrow();
    const db = new DatabaseSync(path.join(options().root, "entries.sqlite"));
    try {
      expect(
        db
          .prepare("SELECT count(*) n FROM sqlite_schema WHERE sql IS NOT NULL")
          .get().n,
      ).toBe(0);
    } finally {
      db.close();
    }
  });
});
