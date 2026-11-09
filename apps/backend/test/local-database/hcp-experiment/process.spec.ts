import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import {
  createSyntheticExperiment,
  openSyntheticExperiment,
  resetSyntheticExperiment,
} from "../../../src/composition/hcp-experiment";
const deadline = Date.parse("2026-11-08T12:00:00Z");

describe("HCP C1 owned process loss and recovery", () => {
  let sandbox: string;
  const children: Array<{ child: ChildProcess; exited: Promise<void> }> = [];
  const paths = () => ({ sandbox, root: path.join(sandbox, "experiment") });
  beforeEach(() => {
    sandbox = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "hcp-c1-")),
    );
    fs.chmodSync(sandbox, 0o700);
  });
  afterEach(async () => {
    for (const c of children) {
      if (c.child.exitCode === null && c.child.signalCode === null)
        c.child.kill("SIGKILL");
      await c.exited;
    }
    children.length = 0;
    fs.rmSync(sandbox, { recursive: true });
  });
  function start(action: string, boundary = "none", now = deadline - 1) {
    const child = spawn(
      process.execPath,
      [
        "--no-global-search-paths",
        path.join(__dirname, "process.cjs"),
        sandbox,
        paths().root,
        action,
        boundary,
        String(now),
      ],
      { env: {}, stdio: ["ignore", "pipe", "pipe"] },
    );
    const exited = new Promise<void>((resolve) =>
      child.once("exit", () => resolve()),
    );
    children.push({ child, exited });
    const message = new Promise<any>((resolve, reject) => {
      let text = "",
        errors = "";
      const timer = setTimeout(
        () => reject(new Error("Child boundary deadline: " + errors)),
        8000,
      );
      child.stderr!.on("data", (b) => (errors += b));
      child.stdout!.on("data", (b) => {
        text += b;
        if (text.includes("\n")) {
          clearTimeout(timer);
          resolve(JSON.parse(text.split("\n")[0]));
        }
      });
      child.once("error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
      child.once("exit", () => {
        if (!text.includes("\n")) {
          clearTimeout(timer);
          reject(new Error("No child boundary: " + errors));
        }
      });
    });
    return {
      child,
      exited,
      message,
      async kill() {
        child.kill("SIGKILL");
        await exited;
      },
    };
  }

  it("keeps the lease exclusive after commits/checks and persists an acknowledged initialization across SIGKILL/reap", async () => {
    const owner = start("create");
    const first = await owner.message;
    expect(first.admitted).toBe(true);
    for (const action of ["attempt", "reset"]) {
      const contender = start(action);
      expect((await contender.message).refused).toBe(true);
      await contender.exited;
    }
    await owner.kill();
    const reopened = openSyntheticExperiment(paths(), {
      clock: () => deadline - 1,
    });
    try {
      expect(reopened.storeId).toBe(first.storeId);
      expect(reopened.inspectAudit().length).toBe(first.auditCount);
    } finally {
      reopened.close();
    }
  });

  it("admits at most one of two concurrent processes", async () => {
    const initial = createSyntheticExperiment(paths());
    initial.close();
    const a = start("open"),
      b = start("open");
    const results = await Promise.all([a.message, b.message]);
    expect(results.filter((x) => x.admitted)).toHaveLength(1);
    expect(results.filter((x) => x.refused)).toHaveLength(1);
  });

  it.each(["after-data-file", "before-commit"])(
    "refuses partial initialization after loss at %s",
    async (boundary) => {
      const owner = start("create", boundary);
      expect((await owner.message).boundary).toBe(boundary);
      await owner.kill();
      expect(() => openSyntheticExperiment(paths())).toThrow();
      expect(() => resetSyntheticExperiment(paths())).toThrow();
      // No automatic repair/cleanup of incomplete schema; harness owns stopped sandbox teardown.
    },
  );

  it("finishes only complete initialization after loss between durable data commit and publication", async () => {
    const owner = start("create", "after-data-commit");
    expect((await owner.message).boundary).toBe("after-data-commit");
    await owner.kill();
    const reopened = openSyntheticExperiment(paths(), {
      clock: () => deadline - 1,
    });
    try {
      expect(reopened.inspectEntries()).toHaveLength(7);
      expect(reopened.inspectAudit()).toHaveLength(8);
    } finally {
      reopened.close();
    }
  });

  it.each(["after-reset-intent", "after-reset-unlink"])(
    "resumes bounded reset at %s without resurrecting identity",
    async (boundary) => {
      const store = createSyntheticExperiment(paths());
      const old = store.storeId;
      store.close();
      const owner = start("reset", boundary);
      expect((await owner.message).boundary).toBe(boundary);
      await owner.kill();
      expect(() => openSyntheticExperiment(paths())).toThrow();
      resetSyntheticExperiment(paths());
      const fresh = createSyntheticExperiment(paths());
      try {
        expect(fresh.storeId).not.toBe(old);
      } finally {
        fresh.close();
      }
    },
  );

  it.each(["before-commit", "after-data-commit"])(
    "recovers expiry interrupted at %s, retaining one transition per entry",
    async (boundary) => {
      const owner = start("create");
      await owner.message;
      await owner.kill();
      const recovery = start("open", boundary, deadline + 48 * 3600000);
      expect((await recovery.message).boundary).toBe(boundary);
      await recovery.kill();
      const reopened = openSyntheticExperiment(paths(), {
        clock: () => deadline + 48 * 3600000,
      });
      const audit = reopened.inspectAudit();
      try {
        const events = audit.filter((e) => e.eventType === "context.expired");
        expect(events).toHaveLength(5);
        expect(new Set(events.map((e) => e.entryId)).size).toBe(5);
        expect(
          reopened.inspectEntries().every((e) => e.record.status !== "active"),
        ).toBe(true);
      } finally {
        reopened.close();
      }
      const again = openSyntheticExperiment(paths(), {
        clock: () => deadline + 49 * 3600000,
      });
      try {
        expect(again.inspectAudit()).toEqual(audit);
      } finally {
        again.close();
      }
    },
  );

  it("recovers an observed hot rollback journal after page spill and process loss", async () => {
    const owner = start("create");
    await owner.message;
    await owner.kill();
    const recovery = start(
      "open",
      "hot-before-commit",
      deadline + 48 * 3600000,
    );
    expect(await recovery.message).toEqual({
      boundary: "hot-before-commit",
      hotJournal: true,
    });
    await recovery.kill();
    const reopened = openSyntheticExperiment(paths(), {
      clock: () => deadline + 48 * 3600000,
    });
    try {
      const expired = reopened
        .inspectAudit()
        .filter((e) => e.eventType === "context.expired");
      expect(expired).toHaveLength(5);
      expect(new Set(expired.map((e) => e.entryId)).size).toBe(5);
      expect(
        reopened.inspectEntries().every((e) => e.record.status !== "active"),
      ).toBe(true);
      expect(
        fs.existsSync(path.join(paths().root, "entries.sqlite-journal")),
      ).toBe(false);
    } finally {
      reopened.close();
    }
  });

  it("refuses a live or unproven recorded owner even when the OS lock is available", () => {
    const store = createSyntheticExperiment(paths());
    store.close();
    const file = path.join(paths().root, "lease.sqlite");
    for (const pid of [process.pid, -1]) {
      const db = new DatabaseSync(file);
      db.prepare("UPDATE lease SET owner_pid=?").run(pid);
      db.close();
      expect(() => openSyntheticExperiment(paths())).toThrow();
      expect(() => resetSyntheticExperiment(paths())).toThrow();
    }
  });
});
