import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { SqliteDatabase } from "@/infrastructure/storage/sqlite/sqlite-database";
import { decodeLocalIdentityState } from "@/modules/auth/local-identity-state.codec";
import { OwnedIdentityProcesses, waitForStopped } from "./process.fixture";

describe("concurrent bootstrap owns only its unpublished stage", () => {
  let parent: string;
  let options: { databaseRoot: string; identityRoot: string };
  let processes: OwnedIdentityProcesses;
  beforeEach(() => {
    parent = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "local-bootstrap-race-")),
    );
    options = {
      databaseRoot: path.join(parent, "data"),
      identityRoot: path.join(parent, "identity"),
    };
    fs.mkdirSync(options.databaseRoot, { mode: 0o700 });
    processes = new OwnedIdentityProcesses();
  });
  afterEach(async () => {
    await processes.dispose();
    fs.rmSync(parent, { recursive: true });
  });
  const start = () =>
    processes.start(
      options.databaseRoot,
      options.identityRoot,
      "bootstrap",
      "bootstrap.race",
    );
  async function stopped(
    owner: ReturnType<typeof start>,
    boundary: string,
    entries?: number,
  ) {
    expect(await owner.next()).toEqual({
      kind: "paused",
      boundary,
      ...(entries === undefined ? {} : { entries }),
    });
    await waitForStopped(owner.child);
  }
  function resume(owner: ReturnType<typeof start>) {
    expect(owner.child.kill("SIGCONT")).toBe(true);
  }
  async function failed(owner: ReturnType<typeof start>) {
    expect(await owner.next()).toEqual({
      kind: "failed",
      message: "Storage operation failed",
    });
    await owner.reap();
    expect(owner.child.exitCode).toBe(1);
  }

  it("cleans each fully closed loser after both observed the competing stage, allowing fresh initialization", async () => {
    const a = start(),
      b = start();
    await stopped(a, "bootstrap.empty-observed", 0);
    await stopped(b, "bootstrap.empty-observed", 0);
    resume(a);
    await stopped(a, "bootstrap.closed-stage");
    resume(b);
    await stopped(b, "bootstrap.closed-stage");
    expect(fs.readdirSync(options.databaseRoot)).toHaveLength(2);
    resume(a);
    await stopped(a, "bootstrap.entries-observed", 2);
    resume(b);
    await stopped(b, "bootstrap.entries-observed", 2);
    resume(a);
    await failed(a);
    expect(fs.readdirSync(options.databaseRoot)).toHaveLength(1);
    resume(b);
    await failed(b);
    expect(fs.readdirSync(options.databaseRoot)).toEqual([]);
    expect(
      (
        await processes.command(
          options.databaseRoot,
          options.identityRoot,
          "bootstrapInitialize",
        )
      ).kind,
    ).toBe("done");
    expect(
      (
        await processes.command(
          options.databaseRoot,
          options.identityRoot,
          "verifyReadyState",
        )
      ).kind,
    ).toBe("done");
  });

  it("a late loser starting with an absent root removes only its own stage after the winner initialized identity, catalog and data", async () => {
    fs.rmdirSync(options.databaseRoot);
    const loser = start();
    await stopped(loser, "bootstrap.empty-observed", 0);
    expect(
      (
        await processes.command(
          options.databaseRoot,
          options.identityRoot,
          "bootstrapInitialize",
        )
      ).kind,
    ).toBe("done");
    const main = path.join(options.databaseRoot, "database.sqlite");
    const identity = path.join(options.identityRoot, "identity.json");
    const before = {
      main: fs.readFileSync(main),
      identity: fs.readFileSync(identity),
      stat: fs.lstatSync(main),
    };
    const state = decodeLocalIdentityState(before.identity);
    resume(loser);
    await stopped(loser, "bootstrap.closed-stage");
    resume(loser);
    await stopped(loser, "bootstrap.entries-observed", 2);
    resume(loser);
    await failed(loser);
    expect(fs.readdirSync(options.databaseRoot)).toEqual(["database.sqlite"]);
    expect(fs.readFileSync(main).equals(before.main)).toBe(true);
    expect(fs.readFileSync(identity).equals(before.identity)).toBe(true);
    expect(fs.lstatSync(main).ino).toBe(before.stat.ino);
    expect(fs.lstatSync(main).dev).toBe(before.stat.dev);
    const database = SqliteDatabase.open({
      ...options,
      expectedTarget: state.databaseTargetId,
    });
    const connection = database.connect();
    try {
      expect(connection.get("SELECT user_id,email FROM users")).toMatchObject({
        user_id: state.principalId,
        email: "preserved@local.invalid",
      });
      expect(
        connection.get("SELECT count(*) n FROM preference_definitions").n,
      ).toBe(19);
      expect(
        connection.get(
          "SELECT user_id,label,address FROM locations WHERE location_id='bootstrap-sentinel'",
        ),
      ).toMatchObject({
        user_id: state.principalId,
        label: "preserved label",
        address: "preserved address",
      });
    } finally {
      connection.close();
    }
    expect(
      (
        await processes.command(
          options.databaseRoot,
          options.identityRoot,
          "verifyReadyState",
        )
      ).kind,
    ).toBe("done");
    expect(fs.readFileSync(identity).equals(before.identity)).toBe(true);
  });
});
