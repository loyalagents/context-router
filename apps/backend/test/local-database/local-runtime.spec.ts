import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { createLocalDatabaseConfiguration } from "@/config/local-database.config";
import { SqliteDatabase } from "@/infrastructure/storage/sqlite/sqlite-database";
import { decodeLocalIdentityState } from "@/modules/auth/local-identity-state.codec";

const READINESS =
  '{"type":"context-router.local-identity.preview.ready","version":1}\n';
describe("actual local database configuration and command runtime", () => {
  let parent: string, databaseRoot: string, identityRoot: string;
  const children: Array<{
    child: ChildProcess;
    exit: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  }> = [];
  beforeEach(() => {
    parent = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "local-runtime-test-")),
    );
    databaseRoot = path.join(parent, "data");
    identityRoot = path.join(parent, "identity");
  });
  afterEach(async () => {
    const closed = await Promise.allSettled(
      children.splice(0).map(async (item) => {
        if (item.child.exitCode === null && item.child.signalCode === null)
          item.child.kill("SIGKILL");
        await bounded(item.exit);
      }),
    );
    if (closed.some((item) => item.status === "rejected"))
      throw new Error("Owned CLI exit uncertain; fixture retained");
    fs.rmSync(parent, { recursive: true, force: true });
  });
  async function bounded<T>(promise: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout>;
    try {
      return await Promise.race([
        promise,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("Owned local command deadline")),
            8000,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  function start(
    command: string,
    roots = true,
    reference = false,
    entrypoint?: string,
    failCatalog = false,
  ) {
    const child = spawn(
      process.execPath,
      [
        "--no-global-search-paths",
        ...(failCatalog
          ? [
              "--require",
              path.join(__dirname, "fixtures/fail-second-catalog.cjs"),
            ]
          : []),
        ...(!reference
          ? [
              "--require",
              path.join(__dirname, "fixtures/deny-provider-network.cjs"),
            ]
          : []),
        entrypoint ??
          path.resolve(
            __dirname,
            reference
              ? "../../dist/local-identity-postgres-reference.js"
              : "../../dist/local-identity.js",
          ),
        command,
      ],
      {
        cwd: parent,
        env: {
          ...(roots
            ? {
                LOCAL_DATABASE_ROOT: databaseRoot,
                LOCAL_IDENTITY_STATE_ROOT: identityRoot,
              }
            : {}),
          HOME: path.join(parent, "hostile-home"),
          DATABASE_URL: "postgresql://ignored:private@127.0.0.1:1/ignored",
          LOCAL_DATABASE_TLS_CA_PEM: "ignored",
          NODE_ENV: "production",
          NODE_PG_FORCE_NATIVE: "1",
          PGBINARY: "private-driver-canary",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "",
      stderr = "";
    let readyResolve!: () => void;
    const ready = new Promise<void>((resolve) => {
      readyResolve = resolve;
    });
    child.stdout.on("data", (bytes) => {
      stdout += bytes;
      if (stdout.includes(READINESS)) readyResolve();
    });
    child.stderr.on("data", (bytes) => {
      stderr += bytes;
    });
    const exit = new Promise<{
      code: number | null;
      signal: NodeJS.Signals | null;
    }>((resolve, reject) => {
      child.once("error", () => reject(new Error("Owned CLI spawn failed")));
      child.once("close", (code, signal) => resolve({ code, signal }));
    });
    children.push({ child, exit });
    return { child, exit, ready, output: () => ({ stdout, stderr }) };
  }
  async function admin(command: string, roots = true, reference = false) {
    const process = start(command, roots, reference);
    const status = await bounded(process.exit);
    return { ...status, ...process.output() };
  }
  const state = () =>
    decodeLocalIdentityState(
      fs.readFileSync(path.join(identityRoot, "identity.json")),
    );
  function snapshot() {
    const db = SqliteDatabase.open({ databaseRoot, identityRoot }),
      c = db.connect();
    try {
      return {
        targetId: db.targetId,
        users: c.all("SELECT * FROM users").map((row) => ({ ...row })),
        bindings: c.all("SELECT * FROM external_identities"),
        catalog: c
          .all(
            "SELECT id,namespace,slug,display_name,value_type,options FROM preference_definitions ORDER BY id",
          )
          .map((row) => ({ ...row })),
      };
    } finally {
      c.close();
    }
  }
  it("uses only two explicit absolute independent roots and ignores hosted/ambient values", () => {
    expect(
      createLocalDatabaseConfiguration({
        LOCAL_DATABASE_ROOT: databaseRoot,
        LOCAL_IDENTITY_STATE_ROOT: identityRoot,
        DATABASE_URL: "private-canary",
        HOME: parent,
      }),
    ).toEqual({ kind: "sqlite", databaseRoot, stateRoot: identityRoot });
    expect(fs.readdirSync(parent)).toEqual([]);
  });
  it.each([
    "missing-database",
    "missing-identity",
    "relative",
    "overlap",
    "noncanonical",
    "nul",
  ])("rejects %s roots without fallback or filesystem creation", (kind) => {
    const env: NodeJS.ProcessEnv = {
      LOCAL_DATABASE_ROOT: databaseRoot,
      LOCAL_IDENTITY_STATE_ROOT: identityRoot,
      HOME: parent,
      DATABASE_URL: "private-canary",
    };
    if (kind === "missing-database") delete env.LOCAL_DATABASE_ROOT;
    if (kind === "missing-identity") delete env.LOCAL_IDENTITY_STATE_ROOT;
    if (kind === "relative") env.LOCAL_DATABASE_ROOT = "data";
    if (kind === "overlap") env.LOCAL_DATABASE_ROOT = identityRoot + "/data";
    if (kind === "noncanonical")
      env.LOCAL_DATABASE_ROOT = parent + "/unused/../data";
    if (kind === "nul") env.LOCAL_DATABASE_ROOT += "\0";
    expect(() => createLocalDatabaseConfiguration(env)).toThrow(
      /^Invalid local database configuration$/,
    );
    expect(fs.readdirSync(parent)).toEqual([]);
  });
  it("initializes the actual CLI without providers/server, with fixed output and only the catalog plus one principal", async () => {
    expect(await admin("initialize")).toEqual({
      code: 0,
      signal: null,
      stdout:
        '{"type":"context-router.local-identity.admin","version":1,"operation":"initialize","status":"ok","generation":1}\n',
      stderr: "",
    });
    const ready = state(),
      stored = snapshot();
    expect(stored.targetId).toBe(ready.databaseTargetId);
    expect(stored.users.map((row) => row.user_id)).toEqual([ready.principalId]);
    expect(stored.bindings).toEqual([]);
    expect(stored.catalog).toHaveLength(19);
    expect(fs.readdirSync(identityRoot)).toEqual(["identity.json"]);
    expect(fs.readdirSync(databaseRoot)).toEqual(["database.sqlite"]);
    expect(await admin("initialize")).toEqual({
      code: 1,
      signal: null,
      stdout: "",
      stderr: "Local identity command failed\n",
    });
    expect(snapshot()).toEqual(stored);
  });
  it("starts actual non-listening preview twice with durable state, rotates, and preserves principal/catalog IDs", async () => {
    expect((await admin("initialize")).code).toBe(0);
    const original = state(),
      initial = snapshot();
    for (const signal of ["SIGTERM", "SIGINT"] as const) {
      const preview = start("preview");
      await bounded(
        Promise.race([
          preview.ready,
          preview.exit.then(() => {
            throw new Error("Preview exited before ready");
          }),
        ]),
      );
      expect(preview.output()).toEqual({ stdout: READINESS, stderr: "" });
      expect(preview.child.kill(signal)).toBe(true);
      expect(await bounded(preview.exit)).toEqual({
        code: signal === "SIGTERM" ? 143 : 130,
        signal: null,
      });
      expect(preview.output()).toEqual({ stdout: READINESS, stderr: "" });
      expect(snapshot()).toEqual(initial);
      expect(state()).toEqual(original);
    }
    expect((await admin("rotate")).code).toBe(0);
    const rotated = state();
    expect(rotated.principalId).toBe(original.principalId);
    expect(rotated.credential).not.toBe(original.credential);
    expect(rotated.generation).toBe(2);
    expect(snapshot()).toEqual(initial);
  });
  it("withholds readiness on actual startup catalog failure, retains committed prefix, and resumes idempotently", async () => {
    const initialize = start("initialize", true, false, undefined, true);
    expect(await bounded(initialize.exit)).toEqual({ code: 1, signal: null });
    expect(initialize.output()).toEqual({
      stdout: "",
      stderr: "Local identity command failed\n",
    });
    const original = state(),
      first = snapshot();
    expect(first.users).toHaveLength(1);
    expect(first.bindings).toHaveLength(0);
    expect(first.catalog).toHaveLength(1);
    const preview = start("preview", true, false, undefined, true);
    expect(await bounded(preview.exit)).toEqual({ code: 1, signal: null });
    expect(preview.output()).toEqual({
      stdout: "",
      stderr: "Local identity command failed\n",
    });
    const partial = snapshot();
    expect(partial.catalog).toHaveLength(2);
    expect(partial.catalog).toEqual(expect.arrayContaining(first.catalog));
    expect(state()).toEqual(original);
    const resumed = start("preview");
    await bounded(
      Promise.race([
        resumed.ready,
        resumed.exit.then(() => {
          throw new Error("Exited before readiness");
        }),
      ]),
    );
    expect(resumed.output()).toEqual({ stdout: READINESS, stderr: "" });
    resumed.child.kill("SIGTERM");
    expect(await bounded(resumed.exit)).toEqual({ code: 143, signal: null });
    const complete = snapshot();
    expect(complete.catalog).toHaveLength(19);
    expect(complete.catalog).toEqual(expect.arrayContaining(partial.catalog));
    expect(complete.users).toEqual(first.users);
    expect(state()).toEqual(original);
  });
  it.each(["preview", "rotate", "recover-initialize", "recover-rotation"])(
    "does not bootstrap missing state through %s",
    async (command) => {
      expect(await admin(command)).toEqual({
        code: 1,
        signal: null,
        stdout: "",
        stderr: "Local identity command failed\n",
      });
      expect(fs.readdirSync(parent)).toEqual([]);
    },
  );
  it("has a narrow explicit bootstrap recovery command and leaves the PostgreSQL reference vocabulary unchanged", async () => {
    expect(await admin("recover-database-bootstrap")).toEqual({
      code: 0,
      signal: null,
      stdout:
        '{"type":"context-router.local-database.bootstrap-recovery","version":1,"status":"none"}\n',
      stderr: "",
    });
    expect(fs.readdirSync(parent)).toEqual([]);
    expect(await admin("recover-database-bootstrap", true, true)).toEqual({
      code: 2,
      signal: null,
      stdout: "",
      stderr: "Invalid local identity command\n",
    });
  });
  it("retains the journaled launcher export and explicit argv contract on the PostgreSQL reference shim", async () => {
    const wrapper = path.join(parent, "reference-launcher.cjs"),
      reference = path.resolve(
        __dirname,
        "../../dist/local-identity-postgres-reference.js",
      );
    fs.writeFileSync(
      wrapper,
      `require(${JSON.stringify(reference)}).runLocalIdentityEntrypoint({argv:['unsupported']}).then(code=>{process.exitCode=code})`,
      { mode: 0o600 },
    );
    const process = start("initialize", true, true, wrapper);
    expect(await bounded(process.exit)).toEqual({ code: 2, signal: null });
    expect(process.output()).toEqual({
      stdout: "",
      stderr: "Invalid local identity command\n",
    });
  });
  it("keeps incomplete reference packages inside the fixed loader failure boundary", async () => {
    const entry = path.join(parent, "incomplete-reference.js");
    fs.copyFileSync(
      path.resolve(
        __dirname,
        "../../dist/local-identity-postgres-reference.js",
      ),
      entry,
    );
    const incomplete = start("initialize", true, true, entry);
    expect(await bounded(incomplete.exit)).toEqual({ code: 1, signal: null });
    expect(incomplete.output()).toEqual({
      stdout: "",
      stderr: "Local identity command failed\n",
    });
  });
  it("rejects missing local roots despite ambient hosted configuration", async () => {
    expect(await admin("initialize", false)).toEqual({
      code: 1,
      signal: null,
      stdout: "",
      stderr: "Local identity command failed\n",
    });
    expect(fs.readdirSync(parent)).toEqual([]);
  });
});
