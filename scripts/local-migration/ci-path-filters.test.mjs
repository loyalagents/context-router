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

test("only fresh, explicitly exported database evidence is uploaded with bounded retention", async () => {
  const workflow = parse(await readFile(dedicatedPath, "utf8"));
  for (const [jobId, profile] of [["source-qualification", "ci-source"], ["packaging-qualification", "ci-packaging"]]) {
  const steps = workflow.jobs[jobId].steps;
  const gate = steps.find((step) => step.id === "migration-gate");
  assert.equal(gate.run, "pnpm migration:gate --" + profile);
  assert.equal(gate["continue-on-error"], undefined);
  assert.equal(gate.env.MIGRATION_GATE_CI_DATABASE_REPORT, "1");
  const uploads = steps.filter((step) => step.name === "Upload sanitized database failure evidence");
  assert.equal(uploads.length, 1);
  assert.deepEqual(uploads[0].with, {
    name: (profile === "ci-source" ? "" : profile + "-") + "local-database-failure-evidence-${{ github.run_id }}-${{ github.run_attempt }}",
    path: "${{ runner.temp }}/local-migration-database-failures.json",
    "if-no-files-found": "warn", "retention-days": 7,
  });
  assert.equal(uploads[0].if, "always() && steps.migration-gate.outputs.database_report_ready == 'true'");
  assert.equal(uploads[0]["continue-on-error"], true);
  assert.equal(uploads[0]["timeout-minutes"], 2);
  assert.equal(steps.filter((step) => step["continue-on-error"]).length, 1);
  }
});

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
    [dedicatedPath, "source-qualification"],
    [dedicatedPath, "packaging-qualification"],
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
  for (const [file, job] of [[ciPath, 'frontend-build'], [dedicatedPath, 'source-qualification'], [dedicatedPath, 'packaging-qualification']]) {
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


test("CI lanes start independently with complete prerequisites and a fail-closed stable combined check", async () => {
  const workflow = parse(await readFile(dedicatedPath, "utf8"));
  assert.deepEqual(Object.keys(workflow.jobs).sort(), ["local-migration-baseline", "packaging-qualification", "source-qualification"]);
  assert.equal(workflow.concurrency, undefined);
  for (const [jobId, profile] of [["source-qualification", "ci-source"], ["packaging-qualification", "ci-packaging"]]) {
    const job = workflow.jobs[jobId];
    assert.equal(job.needs, undefined);
    assert.equal(job.if, undefined);
    assert.equal(job.strategy, undefined);
    assert.equal(job["runs-on"], "ubuntu-latest");
    assert.equal(job.services.postgres.image, "postgres:15-alpine");
    assert.equal(job.steps[0].with["fetch-depth"], 0);
    const gate = job.steps.find(s => s.id === "migration-gate");
    assert.equal(gate.run, "pnpm migration:gate --" + profile);
    assert.equal(gate["continue-on-error"], undefined);
    assert.equal(gate["timeout-minutes"], 118);
    const required = job.steps.find(s => s.name === "Upload required qualification receipt");
    assert.ok(required);
    assert.equal(required.if, "success()");
    assert.equal(required["continue-on-error"], undefined);
    assert.equal(required.with["if-no-files-found"], "error");
    assert.equal(required.with.name, profile + "-${{ github.run_id }}-${{ github.run_attempt }}");
    assert.equal(required.with.path, "${{ runner.temp }}/" + profile + ".json");
  }
  const combined = workflow.jobs["local-migration-baseline"];
  assert.deepEqual(combined.needs, ["source-qualification", "packaging-qualification"]);
  assert.equal(combined.if, "always()");
  assert.equal(combined.steps[0].name, "Require successful execution lanes");
  assert.match(combined.steps[0].run, /SOURCE_RESULT.*success/);
  assert.match(combined.steps[0].run, /PACKAGING_RESULT.*success/);
  assert.equal(combined.steps[0].env.SOURCE_RESULT, "${{ needs.source-qualification.result }}");
  assert.equal(combined.steps[0].env.PACKAGING_RESULT, "${{ needs.packaging-qualification.result }}");
  assert.equal(combined.steps.filter(s => s.uses?.startsWith("actions/download-artifact@")).length, 2);
  for (const step of combined.steps) assert.equal(step["continue-on-error"], undefined);
});

// GitHub evaluates job env before a runner exists; runner context is step-only.
test("CI private caches initialize in a runner step before package setup", async () => {
  const workflow = parse(await readFile(dedicatedPath, "utf8"));
  for (const jobId of ["source-qualification", "packaging-qualification"]) {
    const job = workflow.jobs[jobId];
    assert.doesNotMatch(JSON.stringify(job.env ?? {}), /\$\{\{\s*runner\./);
    const initialize = job.steps.findIndex(step => step.name === "Initialize private runner caches");
    const packageSetup = job.steps.findIndex(step => step.uses?.startsWith("pnpm/action-setup@"));
    assert.ok(initialize >= 0 && initialize < packageSetup);
    const step = job.steps[initialize];
    assert.equal(step["timeout-minutes"], 1);
    assert.equal(step.if, undefined);
    assert.equal(step["continue-on-error"], undefined);
    assert.equal(step.run, [
      '{',
      '  echo "COREPACK_HOME=$RUNNER_TEMP/corepack"',
      '  echo "npm_config_store_dir=$RUNNER_TEMP/pnpm-store"',
      '  echo "npm_config_cache=$RUNNER_TEMP/npm-cache"',
      '  echo "XDG_CACHE_HOME=$RUNNER_TEMP/xdg-cache"',
      '  echo "PLAYWRIGHT_BROWSERS_PATH=$RUNNER_TEMP/playwright"',
      '} >> "$GITHUB_ENV"',
      '',
    ].join("\n"));
  }
});

// A cold install skips Prisma's postinstall; packaging must not hydrate its
// snapshotted dependencies or create executable files in the private tool home.
test("packaging seeds its pinned Prisma engine before the gate captures dependencies", async () => {
  const workflow = parse(await readFile(dedicatedPath, "utf8"));
  const job = workflow.jobs["packaging-qualification"];
  const seed = job.steps.findIndex(step => step.name === "Prepare pinned Prisma engine prerequisite");
  const install = job.steps.findIndex(step => step.run === "pnpm install --frozen-lockfile");
  const gate = job.steps.findIndex(step => step.id === "migration-gate");
  assert.ok(seed > install && seed < gate, "cold packaging dependencies must be prepared before gate snapshot");
  assert.equal(job.steps[seed].run, "pnpm --filter backend exec prisma --version");
  assert.equal(job.steps[seed]["timeout-minutes"], 2);
  assert.equal(job.steps[seed].if, undefined);
  assert.equal(job.steps[seed]["continue-on-error"], undefined);
  const manifest = JSON.parse(await readFile(path.join(repositoryRoot, "apps/backend/package.json"), "utf8"));
  const lock = parse(await readFile(path.join(repositoryRoot, "pnpm-lock.yaml"), "utf8"));
  assert.equal(lock.importers["apps/backend"].devDependencies.prisma.specifier, manifest.devDependencies.prisma);
  assert.equal(lock.importers["apps/backend"].devDependencies.prisma.version.split("(")[0], "7.4.2");
  assert.equal(workflow.jobs["source-qualification"].steps.some(step => step.name === job.steps[seed].name), false);
});


test("CI receipt transports and independent provenance use exact matching attempt bindings", async () => {
  const workflow = parse(await readFile(dedicatedPath, "utf8"));
  const combined = workflow.jobs["local-migration-baseline"];
  const verify = combined.steps.find(s => s.name === "Verify complete qualification");
  const base = "${{ github.event_name == 'pull_request' && github.event.pull_request.base.sha || github.event.before }}";
  const head = "${{ github.event_name == 'pull_request' && github.event.pull_request.head.sha || '' }}";
  for (const [job, profile] of [["source-qualification", "ci-source"], ["packaging-qualification", "ci-packaging"]]) {
    const steps = workflow.jobs[job].steps;
    const gate = steps.find(s => s.id === "migration-gate");
    const upload = steps.find(s => s.name === "Upload required qualification receipt");
    const downloads = combined.steps.filter(s => s.uses?.startsWith("actions/download-artifact@") && s.with.name === upload.with.name);
    assert.equal(downloads.length, 1);
    assert.equal(downloads[0].uses, "actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093");
    assert.deepEqual(downloads[0].with, { name: profile + "-${{ github.run_id }}-${{ github.run_attempt }}", path: "${{ runner.temp }}/qualification-receipts" });
    assert.equal(upload.with.path, "${{ runner.temp }}/" + profile + ".json");
    for (const step of [gate, verify]) {
      assert.equal(step.env.MIGRATION_GATE_BASE_SHA, base);
      assert.equal(step.env.MIGRATION_GATE_PR_HEAD_SHA, head);
    }
    const artifact = steps.find(s => s.name === "Upload sanitized database failure evidence");
    const summary = steps.find(s => s.name === "Persist sanitized gate evidence");
    assert.ok(summary.run.includes(artifact.with.name.split("-${{")[0] + " artifact"));
  }
});
