import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { SqliteDatabase } from "../../../src/infrastructure/storage/sqlite/sqlite-database";
import { createSyntheticExperiment } from "../../../src/composition/hcp-experiment";

it("the real old SQLite adapter cannot open/bootstrap the experiment or its database under a legacy name", () => {
  const sandbox = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "hcp-c1-isolation-")),
  );
  fs.chmodSync(sandbox, 0o700);
  try {
    const root = path.join(sandbox, "experiment");
    const store = createSyntheticExperiment({ sandbox, root });
    store.close();
    const snapshot = () =>
      fs
        .readdirSync(root)
        .sort()
        .map((name) => [
          name,
          fs.readFileSync(path.join(root, name)).toString("base64"),
        ]);
    const before = snapshot();
    const old = {
      databaseRoot: root,
      identityRoot: path.join(sandbox, "identity"),
    };
    expect(() => SqliteDatabase.open(old)).toThrow();
    expect(() => SqliteDatabase.bootstrap(old)).toThrow();
    expect(snapshot()).toEqual(before);
    const copied = path.join(sandbox, "legacy-shaped");
    fs.mkdirSync(copied, { mode: 0o700 });
    fs.copyFileSync(
      path.join(root, "entries.sqlite"),
      path.join(copied, "database.sqlite"),
    );
    fs.chmodSync(path.join(copied, "database.sqlite"), 0o600);
    expect(() =>
      SqliteDatabase.open({ ...old, databaseRoot: copied }),
    ).toThrow();
  } finally {
    fs.rmSync(sandbox, { recursive: true });
  }
});

it("only explicit synthetic compositions import HCP infrastructure; no legacy module receives its handle", () => {
  const src = path.resolve(__dirname, "../../../src");
  function files(dir: string): string[] {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .flatMap((d) =>
        d.isDirectory()
          ? files(path.join(dir, d.name))
          : [path.join(dir, d.name)],
      );
  }
  const allowed = [
    "composition/hcp-experiment.ts",
    "composition/hcp-authorization.ts",
    "infrastructure/hcp-experiment/",
  ];
  for (const file of files(src).filter(
    (f) => f.endsWith(".ts") && !f.endsWith(".spec.ts"),
  )) {
    const relative = path.relative(src, file);
    if (allowed.some((a) => relative.startsWith(a))) continue;
    expect(fs.readFileSync(file, "utf8")).not.toMatch(
      /(?:from\s*|require\s*\(|import\s*\()["'][^"']*hcp-experiment/,
    );
  }
  const source = fs.readFileSync(
    path.join(src, "composition/hcp-experiment.ts"),
    "utf8",
  );
  expect(source).not.toMatch(
    /@nestjs|listen\(|createServer|modules\/|mcp\/|local-model/,
  );
  const authorization = fs.readFileSync(
    path.join(src, "composition/hcp-authorization.ts"),
    "utf8",
  );
  expect(authorization).not.toMatch(
    /@nestjs|modules\/|mcp\/|local-model|0\.0\.0\.0/,
  );
  expect(authorization).toContain('"127.0.0.1"');
});
