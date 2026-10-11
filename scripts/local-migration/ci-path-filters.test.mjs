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
    "desktop",
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

test('local UI consumers select both build owners and pinned Chromium coverage', async () => {
  const workflow = parse(await readFile(ciPath, 'utf8'));
  const filters = parse(workflow.jobs.changes.steps.find((s) => s.id === 'filter').with.filters);
  assert.ok(selectedFilters(filters, 'apps/web/local-ui.mjs').includes('backend'));
  assert.ok(selectedFilters(filters, 'apps/backend/src/local-ui/local-ui-http.ts').includes('frontend'));
  const steps = workflow.jobs['frontend-build'].steps;
  const commands = steps.map((s) => s.run);
  assert.ok(commands.indexOf('pnpm --filter backend build') < commands.indexOf('pnpm build'));
  assert.ok(commands.includes('pnpm test:local-ui'));
  for (const [file, job] of [[ciPath, 'frontend-build'], [dedicatedPath, 'local-migration-baseline']]) {
    const browserSteps = parse(await readFile(file, 'utf8')).jobs[job].steps;
    const install = browserSteps.find((s) => s.run === 'pnpm --filter web exec playwright install --with-deps chromium');
    assert.ok(install); assert.equal(install['timeout-minutes'], 10);
    assert.equal(install.env.PLAYWRIGHT_BROWSERS_PATH, '${{ runner.temp }}/playwright');
  }
});

test('desktop changes select native CI plus both shared product owners with exact prerequisites', async () => {
  const workflow = parse(await readFile(ciPath, 'utf8'));
  const filters = parse(workflow.jobs.changes.steps.find(s => s.id === 'filter').with.filters);
  for (const file of ['apps/desktop/native/guardian.m', 'apps/desktop/src/prepare.mjs', 'apps/desktop/package.json']) {
    assert.deepEqual(selectedFilters(filters, file), ['backend', 'desktop', 'frontend']);
  }
  for (const file of ['apps/backend/src/main.ts', 'apps/web/local-ui.mjs']) assert.ok(selectedFilters(filters, file).includes('desktop'));
  assert.equal(workflow.jobs.changes.outputs.desktop, '${{ steps.filter.outputs.desktop }}');
  const job = workflow.jobs['desktop-native'];
  assert.equal(job.needs, 'changes');
  assert.equal(job.if, "needs.changes.outputs.desktop == 'true'");
  assert.equal(job['runs-on'], 'macos-15');
  assert.equal(job.steps.find(s => s.uses === 'pnpm/action-setup@v6.0.8').with.version, '10.25.0');
  assert.equal(job.steps.find(s => s.uses === 'actions/setup-node@v4').with['node-version'], '24.21.0');
  const commands = job.steps.map(s => s.run).filter(Boolean);
  assert.deepEqual(commands, [
    `node -e "if(process.platform!=='darwin'||process.arch!=='arm64')process.exit(1)"`,
    'node scripts/check-toolchain.mjs', '/usr/bin/clang --version && /usr/bin/xcrun --show-sdk-path',
    'pnpm install --frozen-lockfile', 'pnpm --filter backend prisma:generate', 'pnpm --filter backend build',
    'pnpm --filter desktop test', 'pnpm --filter desktop build:native', 'pnpm --filter desktop test:native',
  ]);
  const manifest = JSON.parse(await readFile(new URL('../../apps/desktop/package.json', import.meta.url), 'utf8'));
  assert.equal(manifest.scripts.test, 'node --test test/*.test.mjs');
  assert.equal(manifest.scripts['test:native'], 'node --test --test-concurrency=1 test/native/*.test.mjs');
  const native = await readFile(new URL('../../apps/desktop/test/native/admission.test.mjs', import.meta.url), 'utf8');
  assert.match(native, /assert.equal\(process.platform, 'darwin'/);
  assert.match(native, /assert.equal\(process.arch, 'arm64'/);
  assert.doesNotMatch(native, /skip:/);
});
