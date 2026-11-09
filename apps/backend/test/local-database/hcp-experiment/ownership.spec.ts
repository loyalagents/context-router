import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  createSyntheticExperiment,
  openSyntheticExperiment,
  resetSyntheticExperiment,
} from "../../../src/composition/hcp-experiment";

// Every root is created by this test, never the installed application's paths.
describe("HCP C1 owned synthetic store", () => {
  let sandbox: string;
  let root: string;
  let store: ReturnType<typeof openSyntheticExperiment> | undefined;
  const options = () => ({ sandbox, root });
  beforeEach(() => {
    sandbox = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "hcp-c1-")),
    );
    fs.chmodSync(sandbox, 0o700);
    root = path.join(sandbox, "experiment");
  });
  afterEach(() => {
    store?.close();
    store = undefined;
    fs.rmSync(sandbox, { recursive: true });
  });

  it("initializes privately, admits only its exact owner/schema, reopens the same identity", () => {
    store = createSyntheticExperiment(options());
    const id = store.storeId;
    expect(store.settings()).toEqual({
      journalMode: "delete",
      synchronous: 3,
      fullfsync: 1,
      foreignKeys: 1,
    });
    expect(fs.statSync(root).mode & 0o777).toBe(0o700);
    for (const name of fs.readdirSync(root))
      expect(fs.statSync(path.join(root, name)).mode & 0o777).toBe(0o600);
    store.close();
    store = openSyntheticExperiment(options());
    expect(store.storeId).toBe(id);
    expect(store.inspectEntries().length).toBeGreaterThan(0);
  });

  it("refuses live ownership, including another handle in the same process", () => {
    store = createSyntheticExperiment(options());
    expect(() => openSyntheticExperiment(options())).toThrow();
    expect(() => resetSyntheticExperiment(options())).toThrow();
    expect(() => createSyntheticExperiment(options())).toThrow();
    expect(store.inspectEntries().length).toBeGreaterThan(0);
  });

  it("resets only owned data, makes the old handle terminal, and never restores old identities", () => {
    fs.writeFileSync(path.join(sandbox, "source-document"), "keep");
    store = createSyntheticExperiment(options());
    const ids = new Set([
      store.storeId,
      ...store.inspectEntries().map((e) => e.id),
    ]);
    store.close();
    resetSyntheticExperiment(options());
    expect(() => store!.inspectEntries()).toThrow();
    expect(() => openSyntheticExperiment(options())).toThrow();
    resetSyntheticExperiment(options());
    store = createSyntheticExperiment(options());
    for (const id of [
      store.storeId,
      ...store.inspectEntries().map((e) => e.id),
    ])
      expect(ids.has(id)).toBe(false);
    expect(fs.readFileSync(path.join(sandbox, "source-document"), "utf8")).toBe(
      "keep",
    );
  });

  it("refuses symlinks, escaped roots, unknown files and hardlinked database files", () => {
    expect(() =>
      createSyntheticExperiment({
        sandbox,
        root: path.join(sandbox, "..", "escape"),
      }),
    ).toThrow();
    expect(() =>
      createSyntheticExperiment({ sandbox, root: sandbox }),
    ).toThrow();
    fs.symlinkSync(sandbox, path.join(sandbox, "link"));
    expect(() =>
      createSyntheticExperiment({
        sandbox,
        root: path.join(sandbox, "link", "child"),
      }),
    ).toThrow();
    store = createSyntheticExperiment(options());
    store.close();
    fs.writeFileSync(path.join(root, "unexpected"), "untouched", {
      mode: 0o600,
    });
    expect(() => resetSyntheticExperiment(options())).toThrow();
    expect(fs.readFileSync(path.join(root, "unexpected"), "utf8")).toBe(
      "untouched",
    );
    fs.unlinkSync(path.join(root, "unexpected"));
    fs.linkSync(
      path.join(root, "entries.sqlite"),
      path.join(sandbox, "linked.sqlite"),
    );
    expect(() => openSyntheticExperiment(options())).toThrow();
    expect(() => resetSyntheticExperiment(options())).toThrow();
  });

  it("latches admission closed after losing an owned data path even if the path is restored", () => {
    store = createSyntheticExperiment(options());
    const file = path.join(root, "entries.sqlite"),
      moved = path.join(sandbox, "temporarily-moved.sqlite");
    fs.renameSync(file, moved);
    try {
      expect(() => store!.inspectEntries()).toThrow();
    } finally {
      fs.renameSync(moved, file);
    }
    expect(() => store!.inspectEntries()).toThrow();
  });

  it("refuses foreign data admission without writing even the ownership record", () => {
    store = createSyntheticExperiment(options());
    store.close();
    const file = path.join(root, "entries.sqlite");
    const db = new DatabaseSync(file);
    db.exec("PRAGMA user_version=999");
    db.close();
    const snapshot = () =>
      fs
        .readdirSync(root)
        .sort()
        .map((name) => [
          name,
          fs.readFileSync(path.join(root, name)).toString("base64"),
        ]);
    const before = snapshot();
    expect(() => openSyntheticExperiment(options())).toThrow();
    expect(snapshot()).toEqual(before);
    expect(() => resetSyntheticExperiment(options())).toThrow();
    expect(snapshot()).toEqual(before);
  });

  it.each(["wrong-version", "partial-schema", "foreign-owner"])(
    "refuses %s without altering database bytes",
    (fault) => {
      store = createSyntheticExperiment(options());
      store.close();
      const file = path.join(root, "entries.sqlite");
      const db = new DatabaseSync(file);
      if (fault === "wrong-version") db.exec("PRAGMA user_version=999");
      if (fault === "partial-schema")
        db.exec("DROP TRIGGER versions_no_update");
      if (fault === "foreign-owner")
        db.prepare("UPDATE store_metadata SET root_id=?").run("foreign");
      db.close();
      const bytes = fs.readFileSync(file);
      expect(() => openSyntheticExperiment(options())).toThrow();
      expect(() => resetSyntheticExperiment(options())).toThrow();
      expect(fs.readFileSync(file)).toEqual(bytes);
    },
  );
});
