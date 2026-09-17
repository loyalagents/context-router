import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(import.meta.dirname, "../..");

test("the eval test script uses the quoted recursive test-file glob", async () => {
  const packageJson = JSON.parse(
    await readFile(path.join(repositoryRoot, "package.json"), "utf8"),
  );

  assert.equal(
    packageJson.scripts["eval:test"],
    "node --test 'examples/eval/scripts/**/*.test.mjs'",
  );
});

test("Node discovers top-level and nested test files once without running non-tests", async () => {
  const fixtureRoot = await mkdtemp(
    path.join(os.tmpdir(), "context-router-eval-discovery-"),
  );
  const markerPath = path.join(fixtureRoot, "executed.txt");
  const nestedDirectory = path.join(fixtureRoot, "nested");
  await mkdir(nestedDirectory);

  const testFixture = (marker, name) => `
    import { appendFileSync } from "node:fs";
    import test from "node:test";
    appendFileSync(${JSON.stringify(markerPath)}, ${JSON.stringify(`${marker}\n`)});
    test(${JSON.stringify(name)}, () => {});
  `;

  await Promise.all([
    writeFile(
      path.join(fixtureRoot, "top.test.mjs"),
      testFixture("top", "top-level fixture"),
    ),
    writeFile(
      path.join(nestedDirectory, "deep.test.mjs"),
      testFixture("nested", "nested fixture"),
    ),
    writeFile(
      path.join(nestedDirectory, "not-a-test.mjs"),
      `
        import { appendFileSync } from "node:fs";
        appendFileSync(${JSON.stringify(markerPath)}, "non-test\\n");
        throw new Error("non-test fixture executed");
      `,
    ),
  ]);

  try {
    const { NODE_TEST_CONTEXT: _nodeTestContext, ...childEnvironment } =
      process.env;
    const result = await execFileAsync(
      process.execPath,
      ["--test", "**/*.test.mjs"],
      { cwd: fixtureRoot, encoding: "utf8", env: childEnvironment },
    );
    assert.match(result.stdout, /\btests 2\b/);
    assert.match(result.stdout, /\bpass 2\b/);
    assert.doesNotMatch(
      result.stdout + result.stderr,
      /non-test fixture executed/,
    );

    const markers = (await readFile(markerPath, "utf8"))
      .trim()
      .split("\n")
      .sort();
    assert.deepEqual(markers, ["nested", "top"]);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});
