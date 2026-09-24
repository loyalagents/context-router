import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { parse } from "yaml";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const ciPath = path.join(repositoryRoot, ".github/workflows/ci.yml");
const dedicatedPath = path.join(
  repositoryRoot,
  ".github/workflows/local-migration-baseline.yml",
);

function selectedFilters(filters, relativePath) {
  return Object.entries(filters)
    .filter(([, globs]) =>
      globs.some((glob) => path.matchesGlob(relativePath, glob)),
    )
    .map(([name]) => name)
    .sort();
}

test("toolchain and aggregate-gate files select the required standard CI jobs", async () => {
  const workflow = parse(await readFile(ciPath, "utf8"));
  const filters = parse(
    workflow.jobs.changes.steps.find((step) => step.id === "filter").with
      .filters,
  );
  const buildJobs = [
    "backend",
    "eval_fixtures",
    "frontend",
    "local_orchestrator",
  ];
  const aggregateJobs = [...buildJobs, "eval_harbor"].sort();

  for (const relativePath of [
    ".nvmrc",
    ".npmrc",
    "scripts/check-toolchain.mjs",
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
  ]) {
    assert.deepEqual(
      selectedFilters(filters, relativePath),
      buildJobs,
      relativePath,
    );
  }

  for (const relativePath of [
    "scripts/local-migration/packaging-smoke.mjs",
    ".github/workflows/local-migration-baseline.yml",
    "docs/current/local-migration-contract-baseline.json",
  ]) {
    assert.deepEqual(
      selectedFilters(filters, relativePath),
      aggregateJobs,
      relativePath,
    );
  }
});

test("the dedicated migration gate runs on every pull request to main", async () => {
  const workflow = parse(await readFile(dedicatedPath, "utf8"));
  const pullRequest = workflow.on.pull_request;

  assert.deepEqual(pullRequest.branches, ["main"]);
  assert.equal("paths" in pullRequest, false);
  assert.equal("paths-ignore" in pullRequest, false);
});

test("CI provisions the PostgreSQL image required by offline TLS fixtures", async () => {
  for (const [workflowPath, job] of [
    [ciPath, "backend-tests"],
    [dedicatedPath, "local-migration-baseline"],
  ]) {
    const workflow = parse(await readFile(workflowPath, "utf8"));
    assert.equal(
      workflow.jobs[job].services.postgres.image,
      "postgres:15-alpine",
      `${job} must preload the image used with --pull=never`,
    );
  }
});

test("standard CI discovers the standalone SQLite suite and its compiled-worker prerequisite without a database URL", async () => {
  const workflow = parse(await readFile(ciPath, "utf8"));
  const steps = workflow.jobs["backend-tests"].steps;
  const local = steps.filter((step) => step.run === "pnpm test:local-database");
  assert.equal(local.length, 1);
  assert.equal(local[0].env?.DATABASE_URL, undefined);
  const manifest = JSON.parse(
    await readFile(
      new URL("../../apps/backend/package.json", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(
    manifest.scripts["pretest:local-database"],
    "pnpm prisma:generate && pnpm build",
  );
  assert.match(
    manifest.scripts["test:local-database"],
    /--selectProjects local-database/,
  );
});

test("default backend test routes build compiled CLI and workers without dropping projects", async () => {
  const manifest = JSON.parse(
    await readFile(
      new URL("../../apps/backend/package.json", import.meta.url),
      "utf8",
    ),
  );
  const root = JSON.parse(
    await readFile(new URL("../../package.json", import.meta.url), "utf8"),
  );
  const { default: jest } = await import("../../apps/backend/jest.config.js");
  assert.equal(manifest.scripts.pretest, "pnpm prisma:generate && pnpm build");
  assert.equal(manifest.scripts.test, "jest --runInBand");
  assert.equal(root.scripts.test, "pnpm -r test");
  assert.equal(root.scripts["test:backend"], "pnpm --filter backend test");
  assert.deepEqual(
    jest.projects.map((project) => project.displayName),
    ["unit", "local-database", "integration", "e2e"],
  );
});
