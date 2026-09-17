import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const packageManager =
  "pnpm@10.25.0+sha512.5e82639027af37cf832061bcc6d639c219634488e0f2baebe785028a793de7b525ffcd3f7ff574f5e9860654e098fe852ba8ac5dd5cefe1767d23a020a92f501";

async function readJson(relativePath) {
  return JSON.parse(
    await readFile(path.join(repositoryRoot, relativePath), "utf8"),
  );
}

function actionSelections(workflowText, actionName) {
  const lines = workflowText.split(/\r?\n/);
  const selections = [];

  for (let index = 0; index < lines.length; index += 1) {
    const use = lines[index].match(/^(\s*)- uses:\s*([^@\s]+)@([^\s]+)\s*$/);
    if (!use || use[2] !== actionName) continue;

    const stepIndent = use[1].length;
    const inputs = new Map();
    for (let next = index + 1; next < lines.length; next += 1) {
      const line = lines[next];
      if (line.trim() === "") continue;
      const indentation = line.match(/^\s*/)[0].length;
      if (indentation <= stepIndent) break;
      const input = line.match(/^\s+([\w-]+):\s*['\"]?([^'\"]+?)['\"]?\s*$/);
      if (input) inputs.set(input[1], input[2]);
    }

    selections.push({ ref: use[3], inputs });
  }

  return selections;
}

test("the repository pins the exact Node and pnpm contract", async () => {
  const [packageJson, nvmrc, npmrc] = await Promise.all([
    readJson("package.json"),
    readFile(path.join(repositoryRoot, ".nvmrc"), "utf8"),
    readFile(path.join(repositoryRoot, ".npmrc"), "utf8"),
  ]);

  assert.equal(nvmrc, "24.21.0\n");
  assert.equal(packageJson.packageManager, packageManager);
  assert.deepEqual(packageJson.engines, {
    node: "24.21.0",
    pnpm: "10.25.0",
  });
  assert.deepEqual(
    new Set(npmrc.trim().split("\n")),
    new Set([
      "engine-strict=true",
      "package-manager-strict=true",
      "package-manager-strict-version=true",
      "manage-package-manager-versions=false",
    ]),
  );

  const gitignore = await readFile(
    path.join(repositoryRoot, ".gitignore"),
    "utf8",
  );
  assert.doesNotMatch(gitignore, /^\.nvmrc$/m);
});

test("the checker accepts only Node 24.21.0 and pnpm 10.25.0", async () => {
  const { TOOLCHAIN_ERROR_MESSAGE, assertSupportedToolchain } = await import(
    "../check-toolchain.mjs"
  );

  assert.doesNotThrow(() =>
    assertSupportedToolchain({
      nodeVersion: "24.21.0",
      pnpmVersion: "10.25.0",
    }),
  );

  for (const observation of [
    { nodeVersion: "24.20.1", pnpmVersion: "10.25.0" },
    { nodeVersion: "24.21.1", pnpmVersion: "10.25.0" },
    { nodeVersion: "22.13.1", pnpmVersion: "10.25.0" },
    { nodeVersion: "25.0.0", pnpmVersion: "10.25.0" },
    { nodeVersion: "24.21.0", pnpmVersion: "9.15.9" },
    { nodeVersion: "24.21.0", pnpmVersion: "10.24.0" },
    { nodeVersion: "24.21.0", pnpmVersion: "10.26.0" },
    { nodeVersion: "24.21.0\nsecret", pnpmVersion: "10.25.0" },
    { nodeVersion: "24.21.0", pnpmVersion: "10.25.0\nsecret" },
  ]) {
    assert.throws(
      () => assertSupportedToolchain(observation),
      (error) =>
        error instanceof Error && error.message === TOOLCHAIN_ERROR_MESSAGE,
      JSON.stringify(observation),
    );
  }
});

test("the pnpm version probe does not inherit caller credentials", async () => {
  const { readCurrentToolchain } = await import("../check-toolchain.mjs");
  const canary = "toolchain-secret-canary";
  const original = process.env.TOOLCHAIN_TEST_SECRET;
  process.env.TOOLCHAIN_TEST_SECRET = canary;
  let observedOptions;

  try {
    const observed = await readCurrentToolchain({
      run: async (_file, _args, options) => {
        observedOptions = options;
        return { stdout: "10.25.0\n", stderr: "" };
      },
    });
    assert.deepEqual(observed, {
      nodeVersion: "24.21.0",
      pnpmVersion: "10.25.0",
    });
    assert.equal(observedOptions.env.TOOLCHAIN_TEST_SECRET, undefined);
    assert.doesNotMatch(
      JSON.stringify(observedOptions.env),
      new RegExp(canary),
    );
  } finally {
    if (original === undefined) delete process.env.TOOLCHAIN_TEST_SECRET;
    else process.env.TOOLCHAIN_TEST_SECRET = original;
  }
});

test("the direct gate rejects an unsupported toolchain before acquisition", async () => {
  const { runWithToolchainPreflight } = await import("./migration-gate.mjs");
  const acquired = [];
  const rejection = new Error("unsupported-toolchain");

  await assert.rejects(
    runWithToolchainPreflight(async () => acquired.push("resource"), {
      checkToolchain: async () => {
        throw rejection;
      },
    }),
    (error) => error === rejection,
  );
  assert.deepEqual(acquired, []);
});

test("the direct gate CLI rejects before creating a diagnostic root", async () => {
  const { TOOLCHAIN_ERROR_MESSAGE } = await import("../check-toolchain.mjs");
  const fixtureRoot = await mkdtemp(
    path.join(os.tmpdir(), "context-router-gate-toolchain-"),
  );
  const binDirectory = path.join(fixtureRoot, "bin");
  const temporaryDirectory = path.join(fixtureRoot, "tmp");
  await Promise.all([mkdir(binDirectory), mkdir(temporaryDirectory)]);
  const fakePnpm = path.join(binDirectory, "pnpm");
  await writeFile(fakePnpm, "#!/bin/sh\nprintf '10.24.0\\n'\n", {
    mode: 0o700,
  });
  await chmod(fakePnpm, 0o700);
  const { NODE_TEST_CONTEXT: _nodeTestContext, ...childEnvironment } =
    process.env;

  try {
    await assert.rejects(
      execFileAsync(
        process.execPath,
        [
          path.join(
            repositoryRoot,
            "scripts/local-migration/migration-gate.mjs",
          ),
        ],
        {
          cwd: repositoryRoot,
          env: {
            ...childEnvironment,
            COREPACK_ENABLE_NETWORK: "0",
            PATH: `${binDirectory}:${process.env.PATH ?? ""}`,
            TMPDIR: temporaryDirectory,
          },
          encoding: "utf8",
        },
      ),
      (error) => {
        assert.equal(error.stdout, "");
        assert.equal(error.stderr.trim(), TOOLCHAIN_ERROR_MESSAGE);
        return true;
      },
    );
    assert.deepEqual(await readdir(temporaryDirectory), []);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("the checker CLI emits one sanitized actionable message", async () => {
  const { TOOLCHAIN_ERROR_MESSAGE } = await import("../check-toolchain.mjs");
  const fixtureRoot = await mkdtemp(
    path.join(os.tmpdir(), "context-router-toolchain-check-"),
  );
  const fakePnpm = path.join(fixtureRoot, "pnpm");
  await writeFile(fakePnpm, "#!/bin/sh\nprintf '10.24.0\\n'\n", {
    mode: 0o700,
  });
  await chmod(fakePnpm, 0o700);

  try {
    await assert.rejects(
      execFileAsync(
        process.execPath,
        [path.join(repositoryRoot, "scripts/check-toolchain.mjs")],
        {
          cwd: repositoryRoot,
          env: {
            ...process.env,
            COREPACK_ENABLE_NETWORK: "0",
            PATH: `${fixtureRoot}:${process.env.PATH ?? ""}`,
          },
          encoding: "utf8",
        },
      ),
      (error) => {
        assert.equal(error.stdout, "");
        assert.equal(error.stderr.trim(), TOOLCHAIN_ERROR_MESSAGE);
        assert.doesNotMatch(error.stderr, /10\.24\.0/);
        assert.equal(error.stderr.trim().split("\n").length, 1);
        return true;
      },
    );
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("install, builds, and migration gates check the toolchain first", async () => {
  const [root, backend, web, orchestrator] = await Promise.all([
    readJson("package.json"),
    readJson("apps/backend/package.json"),
    readJson("apps/web/package.json"),
    readJson("apps/local-orchestrator/package.json"),
  ]);
  const check = "node scripts/check-toolchain.mjs";
  assert.equal(root.scripts.preinstall, check);
  assert.ok(root.scripts.build.startsWith(`${check} && `));
  assert.ok(root.scripts["migration:gate"].startsWith(`${check} && `));
  assert.ok(root.scripts["migration:smoke:restart"].startsWith(`${check} && `));
  assert.equal(
    backend.scripts.prebuild,
    "node ../../scripts/check-toolchain.mjs",
  );
  assert.equal(
    orchestrator.scripts.prebuild,
    "node ../../scripts/check-toolchain.mjs",
  );
  assert.equal(
    web.scripts.prebuild,
    "node ../../scripts/check-toolchain.mjs && pnpm run codegen",
  );
});

test("CI and supported Docker stages select only the exact pair", async () => {
  const [ci, dedicated, backendDockerfile] = await Promise.all([
    readFile(path.join(repositoryRoot, ".github/workflows/ci.yml"), "utf8"),
    readFile(
      path.join(
        repositoryRoot,
        ".github/workflows/local-migration-baseline.yml",
      ),
      "utf8",
    ),
    readFile(path.join(repositoryRoot, "apps/backend/Dockerfile"), "utf8"),
  ]);
  const workflowText = `${ci}\n${dedicated}`;
  const nodeSelections = actionSelections(workflowText, "actions/setup-node");
  const pnpmSelections = actionSelections(workflowText, "pnpm/action-setup");
  const corepackSeeds = [
    ...workflowText.matchAll(/corepack prepare pnpm@([^\s]+) --activate/g),
  ].map((match) => match[1]);

  assert.ok(nodeSelections.length > 0, "expected setup-node selections");
  assert.ok(pnpmSelections.length > 0, "expected pnpm setup selections");
  assert.ok(corepackSeeds.length > 0, "expected a Corepack pnpm seed");
  assert.deepEqual(
    nodeSelections.map(({ inputs }) => inputs.get("node-version")),
    Array(nodeSelections.length).fill("24.21.0"),
  );
  assert.deepEqual(
    pnpmSelections.map(({ inputs }) => inputs.get("version")),
    Array(pnpmSelections.length).fill("10.25.0"),
  );
  assert.deepEqual(
    pnpmSelections.map(({ ref }) => ref),
    Array(pnpmSelections.length).fill("v6.0.8"),
  );
  assert.deepEqual(corepackSeeds, Array(corepackSeeds.length).fill("10.25.0"));

  assert.equal(
    (backendDockerfile.match(/FROM node:24\.21\.0-alpine/g) ?? []).length,
    2,
  );
  assert.equal((backendDockerfile.match(/pnpm@10\.25\.0/g) ?? []).length, 2);
  assert.doesNotMatch(backendDockerfile, /node:20|pnpm@10\.24\.0/);
  await assert.rejects(
    readFile(path.join(repositoryRoot, "Dockerfile.dev"), "utf8"),
    { code: "ENOENT" },
  );
});
