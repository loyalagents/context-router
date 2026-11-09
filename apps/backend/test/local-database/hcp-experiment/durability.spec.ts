import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { DatabaseSync } from "node:sqlite";
import * as schema from "../../../src/infrastructure/hcp-experiment/schema";
import {
  createSyntheticExperiment,
  openSyntheticExperiment,
  resetSyntheticExperiment,
} from "../../../src/composition/hcp-experiment";

it("sets native durability before any transaction or logical admission can trigger recovery", () => {
  const sandbox = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "hcp-c1-durability-")),
  );
  fs.chmodSync(sandbox, 0o700);
  const paths = { sandbox, root: path.join(sandbox, "experiment") };
  const observed: Array<{
    boundary: string;
    synchronous: unknown;
    fullfsync: unknown;
  }> = [];
  function observe(db: DatabaseSync, boundary: string) {
    observed.push({
      boundary,
      synchronous: db.prepare("PRAGMA synchronous").get().synchronous,
      fullfsync: db.prepare("PRAGMA fullfsync").get().fullfsync,
    });
  }
  const exec = DatabaseSync.prototype.exec;
  const validate = schema.validateSchema;
  const execSpy = jest
    .spyOn(DatabaseSync.prototype, "exec")
    .mockImplementation(function (this: DatabaseSync, sql: string) {
      if (/\bBEGIN (?:EXCLUSIVE|IMMEDIATE)\b/.test(sql))
        observe(this, "transaction");
      return exec.call(this, sql);
    });
  const validationSpy = jest
    .spyOn(schema, "validateSchema")
    .mockImplementation((db, id, definition) => {
      observe(db, "schema-admission");
      return validate(db, id, definition);
    });
  try {
    const first = createSyntheticExperiment(paths);
    first.close();
    const reopened = openSyntheticExperiment(paths);
    reopened.close();
    resetSyntheticExperiment(paths);
    expect(observed.length).toBeGreaterThan(5);
    expect(observed).toEqual(
      observed.map((row) => ({ ...row, synchronous: 3, fullfsync: 1 })),
    );
  } finally {
    execSpy.mockRestore();
    validationSpy.mockRestore();
    fs.rmSync(sandbox, { recursive: true });
  }
});

it("enables fullfsync before the schema-dependent synchronous pragma can replay a hot journal", () => {
  const sandbox = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "hcp-c1-replay-sync-")),
  );
  fs.chmodSync(sandbox, 0o700);
  const exec = DatabaseSync.prototype.exec;
  const replaySettings: unknown[] = [];
  const spy = jest
    .spyOn(DatabaseSync.prototype, "exec")
    .mockImplementation(function (this: DatabaseSync, sql: string) {
      if (/PRAGMA synchronous=EXTRA/.test(sql))
        replaySettings.push(this.prepare("PRAGMA fullfsync").get().fullfsync);
      return exec.call(this, sql);
    });
  try {
    const paths = { sandbox, root: path.join(sandbox, "experiment") };
    const first = createSyntheticExperiment(paths);
    first.close();
    const reopened = openSyntheticExperiment(paths);
    reopened.close();
    resetSyntheticExperiment(paths);
    expect(replaySettings.length).toBeGreaterThan(3);
    expect(replaySettings.every((value) => value === 1)).toBe(true);
  } finally {
    spy.mockRestore();
    fs.rmSync(sandbox, { recursive: true });
  }
});

it("does not admit a handle if the post-recovery directory synchronization fails", () => {
  const sandbox = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "hcp-c1-sync-failure-")),
  );
  fs.chmodSync(sandbox, 0o700);
  const paths = { sandbox, root: path.join(sandbox, "experiment") };
  const first = createSyntheticExperiment(paths);
  first.close();
  const original = fs.fsyncSync;
  let directories = 0;
  const spy = jest
    .spyOn(require("node:fs"), "fsyncSync")
    .mockImplementation((fd: number) => {
      if (fs.fstatSync(fd).isDirectory() && ++directories === 2)
        throw new Error("injected directory sync failure");
      return original(fd);
    });
  let admitted: ReturnType<typeof openSyntheticExperiment> | undefined;
  try {
    expect(() => {
      admitted = openSyntheticExperiment(paths);
    }).toThrow("injected directory sync failure");
    expect(directories).toBe(2);
  } finally {
    spy.mockRestore();
    admitted?.close();
  }
  try {
    const recovered = openSyntheticExperiment(paths);
    recovered.close();
  } finally {
    fs.rmSync(sandbox, { recursive: true });
  }
});
