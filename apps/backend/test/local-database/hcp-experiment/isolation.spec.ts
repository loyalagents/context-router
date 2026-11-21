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
    "hcp-source.ts",
    "composition/hcp-experiment.ts",
    "composition/hcp-authorization.ts",
    "infrastructure/hcp-experiment/",
  ];
  for (const file of files(src).filter(
    (f) => f.endsWith(".ts") && !f.endsWith(".spec.ts"),
  )) {
    const relative = path.relative(src, file);
    if (
      allowed.some((a) =>
        a.endsWith("/") ? relative.startsWith(a) : relative === a,
      )
    )
      continue;
    expect(fs.readFileSync(file, "utf8")).not.toMatch(
      /(?:from\s*|require\s*\(|import\s*\()["'][^"']*hcp-(?:experiment|authorization|source)/,
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
  for (const name of [
    "hcp-source.ts",
    "infrastructure/hcp-experiment/source.ts",
  ]) {
    const source = fs.readFileSync(path.join(src, name), "utf8");
    expect(source).not.toMatch(
      /@nestjs|modules\/|local-ui|mcp\/|local-model|Prisma|SqliteDatabase|PreferenceService|process\.env\.(?:HOME|DATABASE|LOCAL_)/,
    );
  }
  const presentation = fs.readFileSync(
    path.join(src, "infrastructure/hcp-experiment/management-presentation.ts"),
    "utf8",
  );
  expect(presentation).not.toMatch(
    /(?:from\s*|require\s*\(|import\s*\()["']|\b(?:fetch|XMLHttpRequest|localStorage|sessionStorage)\b|<script/,
  );
  const browser = fs.readFileSync(
    path.resolve(src, "../../web/hcp-source-browser.mjs"),
    "utf8",
  );
  expect(browser).not.toMatch(
    /ignoreHTTPSErrors:\s*true|--ignore-certificate|--disable-web-security|@apollo|local-ui\.mjs|next\/|NODE_TLS_REJECT/,
  );
});
