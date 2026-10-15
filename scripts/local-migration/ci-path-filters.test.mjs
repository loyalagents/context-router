import assert from "node:assert/strict";
import { chmod, cp, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { parse } from "yaml";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const ciPath = path.join(repositoryRoot, ".github/workflows/ci.yml");
const dedicatedPath = path.join(
  repositoryRoot,
  ".github/workflows/local-migration-baseline.yml",
);

// This existing suite is discovered by both the unchanged full gate and the
// nonruntime lane. Temporary Git repositories never modify the caller checkout.
const execFileAsync = promisify(execFile);
const eligiblePaths = [
  'AGENTS.md', 'CLAUDE.md', 'docs/README.md', 'docs/plans/README.md',
  'docs/plans/backlog/stabilization/README.md',
  'docs/plans/backlog/stabilization/agent-efficiency.md',
  'docs/useful/AGENT_WORKFLOW.md', 'print-repo-structure.sh',
  'scripts/print-repo-structure.test.mjs',
];
async function policyFixture(operation) {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'ci-selection-'));
  const git = async (...args) => (await execFileAsync('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
    cwd, encoding: 'utf8', timeout: 30000,
    env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
  })).stdout.trim();
  const put = async (file, content = 'initial\n') => {
    await mkdir(path.dirname(path.join(cwd, file)), { recursive: true });
    await writeFile(path.join(cwd, file), content);
  };
  const commit = async () => { await git('add', '-A'); await git('commit', '-qm', 'fixture'); return git('rev-parse', 'HEAD'); };
  try {
    await git('init', '-q', '-b', 'main');
    await git('config', 'user.name', 'CI Fixture'); await git('config', 'user.email', 'ci@example.invalid');
    await git('config', 'core.filemode', 'true');
    for (const file of [...eligiblePaths, 'README.md', 'apps/backend/source.ts']) await put(file);
    const base = await commit();
    const environment = { GITHUB_EVENT_NAME: 'push', GITHUB_SHA: base, GITHUB_REF: 'refs/heads/main' };
    const event = { before: base, after: base, ref: 'refs/heads/main' };
    const detect = async () => {
      environment.GITHUB_SHA = await git('rev-parse', 'HEAD'); event.after = environment.GITHUB_SHA;
      return (await import('./ci-validation-policy.mjs')).selectValidation({ cwd, environment, event });
    };
    await operation({ cwd, git, put, commit, base, environment, event, detect });
  } finally { await rm(cwd, { recursive: true, force: true }); }
}

test('selection permits exactly the nine regular-file content modifications', async () => {
  await policyFixture(async f => {
    const policy = await import('./ci-validation-policy.mjs');
    assert.deepEqual([...policy.NONRUNTIME_PATHS], eligiblePaths);
    assert.equal((await f.detect()).profile, 'full', 'empty diffs are conservative');
    for (const file of eligiblePaths) await f.put(file, 'modified\n');
    await f.commit();
    const result = await f.detect();
    assert.equal(result.profile, 'nonruntime'); assert.equal(result.baseSha, f.base);
    assert.equal(result.policyVersion, 1); assert.match(result.binding, /^[a-f0-9]{64}$/);
    assert.deepEqual(result.paths, [...eligiblePaths].sort());
    await f.put('apps/backend/source.ts', 'runtime\n'); await f.commit();
    assert.equal((await f.detect()).profile, 'full', 'mixed changes');
  });
});

test('unknown paths and documentation consumers remain full qualification', async () => {
  for (const file of ['README.md', 'docs/useful/HOSTED_DEVELOPMENT.md',
    'docs/useful/local-orchestrator-commands.md', 'docs/evidence/fixture.json',
    'docs/current/local-migration-contract-baseline.json', '.github/workflows/ci.yml',
    'scripts/check-markdown-links.mjs', 'package.json', '.npmrc', 'new-unknown.md']) {
    await policyFixture(async f => {
      await f.put(file, 'changed\n'); await f.commit();
      assert.equal((await f.detect()).profile, 'full', file);
    });
  }
});

test('additions, deletions, renames, copies, type and mode changes cannot exempt', async () => {
  const cases = [
    async f => { await rm(path.join(f.cwd, 'AGENTS.md')); },
    async f => { await rename(path.join(f.cwd, 'AGENTS.md'), path.join(f.cwd, 'moved.md')); },
    async f => { await rm(path.join(f.cwd, 'CLAUDE.md')); await rename(path.join(f.cwd, 'AGENTS.md'), path.join(f.cwd, 'CLAUDE.md')); },
    async f => { await rm(path.join(f.cwd, 'AGENTS.md')); await rename(path.join(f.cwd, 'README.md'), path.join(f.cwd, 'AGENTS.md')); },
    async f => { await cp(path.join(f.cwd, 'AGENTS.md'), path.join(f.cwd, 'new.md')); },
    async f => { await chmod(path.join(f.cwd, 'AGENTS.md'), 0o755); },
    async f => { await rm(path.join(f.cwd, 'AGENTS.md')); await symlink('README.md', path.join(f.cwd, 'AGENTS.md')); },
  ];
  for (const change of cases) await policyFixture(async f => {
    await change(f); await f.commit(); assert.equal((await f.detect()).profile, 'full');
  });
  await policyFixture(async f => {
    await rm(path.join(f.cwd, 'AGENTS.md')); f.event.before = await f.commit();
    await f.put('AGENTS.md', 'added\n'); await f.commit();
    assert.equal((await f.detect()).profile, 'full', 'allowlisted additions');
  });
});

test('PR comparison includes both branch changes and the actual test merge', async () => {
  await policyFixture(async f => {
    await f.git('switch', '-qc', 'feature'); await f.put('AGENTS.md', 'branch\n'); const head = await f.commit();
    await f.git('switch', '-q', 'main'); await f.git('merge', '--no-ff', '-qm', 'test merge', 'feature');
    Object.assign(f.environment, { GITHUB_EVENT_NAME: 'pull_request', GITHUB_REF: 'refs/pull/1/merge' });
    f.event.pull_request = { base: { sha: f.base, ref: 'main' }, head: { sha: head } };
    assert.equal((await f.detect()).profile, 'nonruntime');
    await f.put('apps/backend/source.ts', 'merge-only change\n');
    await f.git('add', '-A'); await f.git('commit', '--amend', '-qm', 'merge result');
    assert.equal((await f.detect()).profile, 'full');
    f.event.pull_request.head.sha = f.base;
    await assert.rejects(f.detect, /checkout/);
  });
  await policyFixture(async f => {
    await f.git('switch', '-qc', 'feature'); await f.put('AGENTS.md', 'branch\n'); const head = await f.commit();
    await f.git('switch', '-q', 'main'); await f.put('CLAUDE.md', 'advanced\n'); await f.commit();
    await f.git('merge', '--no-ff', '-qm', 'regenerated test merge', 'feature');
    Object.assign(f.environment, { GITHUB_EVENT_NAME: 'pull_request', GITHUB_REF: 'refs/pull/1/merge' });
    f.event.pull_request = { base: { sha: f.base, ref: 'main' }, head: { sha: head } };
    assert.equal((await f.detect()).reason, 'advanced-base');
  });
});

test('push comparison accepts merge and squash results with a verified ancestor', async () => {
  for (const squash of [false, true]) await policyFixture(async f => {
    await f.git('switch', '-qc', 'feature'); await f.put('AGENTS.md', 'branch\n'); await f.commit();
    await f.git('switch', '-q', 'main');
    if (squash) { await f.git('merge', '--squash', 'feature'); await f.commit(); }
    else await f.git('merge', '--no-ff', '-qm', 'merge', 'feature');
    assert.equal((await f.detect()).profile, 'nonruntime');
  });
});

test('unavailable, nonancestor, malformed, shallow and unsupported comparisons fail closed', async () => {
  await policyFixture(async f => {
    await f.put('AGENTS.md', 'changed\n'); await f.commit();
    const policy = await import('./ci-validation-policy.mjs'); await f.detect();
    for (const before of ['', '0'.repeat(40), 'f'.repeat(40), 'HEAD']) {
      await assert.rejects(policy.selectValidation({ cwd: f.cwd, environment: f.environment, event: { ...f.event, before } }));
    }
    for (const name of ['merge_group', 'workflow_dispatch', 'pull_request_target']) {
      await assert.rejects(policy.selectValidation({ cwd: f.cwd, environment: { ...f.environment, GITHUB_EVENT_NAME: name }, event: f.event }), /event/);
    }
    await assert.rejects(policy.selectValidation({ cwd: f.cwd, environment: { ...f.environment, GITHUB_SHA: f.base }, event: f.event }), /checkout/);
    await assert.rejects(policy.selectValidation({ cwd: f.cwd, environment: f.environment, event: { ...f.event, after: f.base } }), /checkout/);
    await assert.rejects(policy.selectValidation({ cwd: f.cwd, environment: f.environment, event: { ...f.event, ref: 'refs/heads/other' } }), /event/);
    await assert.rejects(policy.selectValidation({ cwd: f.cwd,
      environment: { ...f.environment, GITHUB_EVENT_NAME: 'pull_request', GITHUB_REF: 'refs/pull/1/merge' },
      event: { pull_request: { base: { sha: f.base, ref: 'main' }, head: { sha: f.environment.GITHUB_SHA } } },
    }), /checkout/, 'one-parent PR checkout is not a test merge');
    await f.put('AGENTS.md', 'dirty\n'); await assert.rejects(f.detect, /clean/);
    await f.git('reset', '--hard', 'HEAD');
    await writeFile(path.join(f.cwd, '.git/shallow'), f.environment.GITHUB_SHA + '\n');
    await assert.rejects(f.detect, /history/); await rm(path.join(f.cwd, '.git/shallow'));
    const head = await f.git('rev-parse', 'HEAD');
    await f.git('switch', '-qc', 'other', f.base); await f.put('CLAUDE.md', 'diverged\n');
    const other = await f.commit(); await f.git('checkout', '-q', head); f.event.before = other;
    await assert.rejects(f.detect, /base/);
  });
});

test('incomplete Git data, command failures and ambiguous bases never produce exemptions', async () => {
  await policyFixture(async f => {
    await f.put('AGENTS.md', 'changed\n'); await f.commit(); await f.detect();
    const policy = await import('./ci-validation-policy.mjs');
    for (const output of ['', ':100644 100644 ' + 'a'.repeat(40) + ' ' + 'b'.repeat(40) + ' M\0AGENTS.md', 'truncated\0']) {
      const git = async args => args.includes('--raw') ? output : policy.runGit(f.cwd, args);
      if (output === '') assert.equal((await policy.selectValidation({ cwd: f.cwd, environment: f.environment, event: f.event, git })).profile, 'full');
      else await assert.rejects(policy.selectValidation({ cwd: f.cwd, environment: f.environment, event: f.event, git }), /diff/);
    }
    await assert.rejects(policy.selectValidation({ cwd: f.cwd, environment: f.environment, event: f.event, git: async () => { throw new Error('maxBuffer exceeded'); } }));
    const failedDiff = async args => {
      if (args.includes('--raw')) throw new Error('Git diff failed with partial stdout');
      return policy.runGit(f.cwd, args);
    };
    await assert.rejects(policy.selectValidation({ cwd: f.cwd, environment: f.environment, event: f.event, git: failedDiff }));
    await f.git('switch', '-qc', 'feature'); await f.put('CLAUDE.md', 'pr\n'); const head = await f.commit();
    await f.git('switch', '-q', 'main'); const base = await f.git('rev-parse', 'HEAD');
    await f.git('merge', '--no-ff', '-qm', 'merge', 'feature');
    Object.assign(f.environment, { GITHUB_EVENT_NAME: 'pull_request', GITHUB_SHA: await f.git('rev-parse', 'HEAD'), GITHUB_REF: 'refs/pull/1/merge' });
    f.event.pull_request = { base: { sha: base, ref: 'main' }, head: { sha: head } };
    const git = async args => args[0] === 'merge-base' && args[1] === '--all' ? base + '\n' + head + '\n' : policy.runGit(f.cwd, args);
    await assert.rejects(policy.selectValidation({ cwd: f.cwd, environment: f.environment, event: f.event, git }), /base/);
  });
});

test('Git output overflow rejects the actual subprocess rather than accepting partial stdout', async () => {
  await policyFixture(async f => {
    await f.put('large.txt', 'x'.repeat(8 * 1024 * 1024 + 1024)); await f.commit();
    const { runGit } = await import('./ci-validation-policy.mjs');
    await assert.rejects(runGit(f.cwd, ['show', 'HEAD:large.txt']), error => error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER');
  });
});

test('aggregation requires actual expected outcomes and the identical classification binding', async () => {
  const { validateSelectionResults } = await import('./ci-validation-policy.mjs');
  for (const profile of ['nonruntime', 'full']) {
    const selection = { profile, binding: 'a'.repeat(64) };
    const outcomes = { selection: 'success', nonruntime: profile === 'nonruntime' ? 'success' : 'skipped', source: profile === 'full' ? 'success' : 'skipped', packaging: profile === 'full' ? 'success' : 'skipped' };
    const exported = { profile, binding: selection.binding };
    assert.doesNotThrow(() => validateSelectionResults(selection, exported, outcomes));
    for (const key of Object.keys(outcomes)) for (const result of ['failure', 'cancelled', 'skipped', 'success', '', undefined, 'neutral']) {
      if (result !== outcomes[key]) assert.throws(() => validateSelectionResults(selection, exported, { ...outcomes, [key]: result }));
    }
    for (const changed of [{}, { profile }, { ...exported, binding: 'b'.repeat(64) }, { ...exported, profile: profile === 'full' ? 'nonruntime' : 'full' }]) {
      assert.throws(() => validateSelectionResults(selection, changed, outcomes));
    }
  }
});

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
    'bash scripts/local-migration/ci-private-node.sh', 'node scripts/check-toolchain.mjs', '/usr/bin/clang --version && /usr/bin/xcrun --show-sdk-path',
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


test("CI lanes retain prerequisites and run unless successful selection explicitly exempts them", async () => {
  const workflow = parse(await readFile(dedicatedPath, "utf8"));
  assert.deepEqual(Object.keys(workflow.jobs).sort(), ["local-migration-baseline", "nonruntime-checks", "packaging-qualification", "source-qualification", "validation-selection"]);
  assert.equal(workflow.concurrency, undefined);
  for (const [jobId, profile] of [["source-qualification", "ci-source"], ["packaging-qualification", "ci-packaging"]]) {
    const job = workflow.jobs[jobId];
    assert.equal(job.needs, 'validation-selection');
    assert.equal(job.if, "always() && (needs.validation-selection.result != 'success' || needs.validation-selection.outputs.profile != 'nonruntime')");
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
  assert.deepEqual(combined.needs, ['validation-selection', 'nonruntime-checks', 'source-qualification', 'packaging-qualification']);
  assert.equal(combined.if, "always()");
  const verdict = combined.steps.find(s => s.id === 'validation-result');
  assert.equal(verdict.run, 'node scripts/local-migration/ci-validation-policy.mjs --aggregate');
  assert.equal(verdict.if, undefined);
  assert.deepEqual(verdict.env, {
    SELECTION_RESULT: '${{ needs.validation-selection.result }}',
    SELECTION_PROFILE: '${{ needs.validation-selection.outputs.profile }}',
    SELECTION_BINDING: '${{ needs.validation-selection.outputs.binding }}',
    NONRUNTIME_RESULT: '${{ needs.nonruntime-checks.result }}',
    SOURCE_RESULT: '${{ needs.source-qualification.result }}',
    PACKAGING_RESULT: '${{ needs.packaging-qualification.result }}',
  });
  assert.equal(combined.steps.filter(s => s.uses?.startsWith("actions/download-artifact@")).length, 2);
  for (const step of combined.steps.filter(s => s.uses?.startsWith('actions/download-artifact@') || s.name === 'Verify complete qualification')) {
    assert.equal(step.if, "steps.validation-result.outputs.profile == 'full'");
    assert.ok(combined.steps.indexOf(step) > combined.steps.indexOf(verdict));
  }
  for (const step of combined.steps) assert.equal(step["continue-on-error"], undefined);
});

test('nonruntime checks and classification retain complete consumers and always-on workflow triggers', async () => {
  const workflow = parse(await readFile(dedicatedPath, 'utf8'));
  assert.deepEqual(workflow.on, { push: { branches: ['main'] }, pull_request: { branches: ['main'] } });
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  const select = workflow.jobs['validation-selection'];
  assert.equal(select.needs, undefined); assert.equal(select.if, undefined);
  assert.deepEqual(select.outputs, { profile: '${{ steps.selection.outputs.profile }}', binding: '${{ steps.selection.outputs.binding }}' });
  assert.equal(select.steps.find(s => s.id === 'selection').run, 'node scripts/local-migration/ci-validation-policy.mjs --select');
  const checks = workflow.jobs['nonruntime-checks'];
  assert.equal(checks.needs, 'validation-selection');
  assert.equal(checks.if, "needs.validation-selection.result == 'success' && needs.validation-selection.outputs.profile == 'nonruntime'");
  assert.deepEqual(checks.steps.map(s => s.run).filter(Boolean), [
    'node scripts/check-toolchain.mjs', 'pnpm install --frozen-lockfile',
    'node --test scripts/check-markdown-links.test.mjs scripts/print-repo-structure.test.mjs scripts/local-migration/ci-path-filters.test.mjs scripts/local-migration/check-contract-baseline.test.mjs',
    'node scripts/check-markdown-links.mjs', 'node scripts/local-migration/check-nonruntime.mjs',
  ]);
  assert.equal(checks.steps.at(-1).env.MIGRATION_GATE_BASE_SHA, "${{ github.event_name == 'pull_request' && github.event.pull_request.base.sha || github.event.before }}");
  assert.equal(checks.services, undefined);
  for (const job of [select, checks, workflow.jobs['local-migration-baseline']]) {
    assert.equal(job.steps[0].with['fetch-depth'], 0);
    for (const step of job.steps) assert.equal(step['continue-on-error'], undefined);
  }
});

test('selection CLI explains non-applicability without receipts and rejects failed outcomes', async () => {
  await policyFixture(async f => {
    await f.put('AGENTS.md', 'changed\n'); await f.commit(); const selected = await f.detect();
    const io = await mkdtemp(path.join(os.tmpdir(), 'ci-selection-io-'));
    try {
      const eventFile = path.join(io, 'event.json'), output = path.join(io, 'output'), summary = path.join(io, 'summary');
      await writeFile(eventFile, JSON.stringify(f.event));
      const env = { ...process.env, ...f.environment, GITHUB_EVENT_PATH: eventFile, GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: summary,
        SELECTION_RESULT: 'success', SELECTION_PROFILE: selected.profile, SELECTION_BINDING: selected.binding,
        NONRUNTIME_RESULT: 'success', SOURCE_RESULT: 'skipped', PACKAGING_RESULT: 'skipped' };
      const run = (mode, extra = {}) => execFileAsync(process.execPath, [path.join(repositoryRoot, 'scripts/local-migration/ci-validation-policy.mjs'), mode], {
        cwd: f.cwd, env: { ...env, ...extra }, timeout: 30000, encoding: 'utf8',
      });
      assert.match((await run('--select')).stdout, /Selected nonruntime/);
      assert.equal(await readFile(output, 'utf8'), `profile=nonruntime\nbinding=${selected.binding}\n`);
      assert.match((await run('--aggregate')).stdout, /qualification not applicable/);
      assert.match(await readFile(summary, 'utf8'), /AGENTS.md/);
      const previousOutput = await readFile(output, 'utf8');
      for (const extra of [{ NONRUNTIME_RESULT: 'failure' }, { SELECTION_RESULT: 'cancelled' }, { SOURCE_RESULT: 'success' }, { SELECTION_BINDING: '' }]) {
        await assert.rejects(run('--aggregate', extra), error => error.code === 1 && /no exemption/.test(error.stderr));
      }
      await writeFile(eventFile, '{malformed');
      await assert.rejects(run('--select'), error => error.code === 1 && !error.stderr.includes('malformed'));
      assert.equal(await readFile(output, 'utf8'), previousOutput, 'failures export no routing success');
      // The fixture has no qualification receipts, dependencies or combiner.
    } finally { await rm(io, { recursive: true, force: true }); }
  });
});

test('nonruntime checker actually compares the base and rejects changed documentation consumers', async () => {
  const scratch = await mkdtemp(path.join(os.tmpdir(), 'ci-doc-consumer-'));
  const checkout = path.join(scratch, 'repository');
  try {
    await execFileAsync('git', ['-c', 'core.hooksPath=/dev/null', 'clone', '--shared', '--no-hardlinks', '--quiet', repositoryRoot, checkout], { timeout: 30000 });
    for (const file of ['ci-validation-policy.mjs', 'check-nonruntime.mjs']) {
      await cp(path.join(repositoryRoot, 'scripts/local-migration', file), path.join(checkout, 'scripts/local-migration', file));
    }
    // The checker only reads dependencies; builds and package installs never run.
    await symlink(path.join(repositoryRoot, 'node_modules'), path.join(checkout, 'node_modules'));
    const base = (await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: checkout, encoding: 'utf8' })).stdout.trim();
    const run = extra => execFileAsync(process.execPath, ['scripts/local-migration/check-nonruntime.mjs'], {
      cwd: checkout, timeout: 30000, encoding: 'utf8',
      env: { ...process.env, MIGRATION_GATE_BASE_SHA: base, RUNNER_TEMP: scratch, ...extra },
    });
    assert.match((await run()).stdout, /baseComparison=performed/);
    await assert.rejects(run({ MIGRATION_GATE_BASE_SHA: '0'.repeat(40) }));
    const doc = path.join(checkout, 'docs/useful/AGENT_WORKFLOW.md');
    await writeFile(doc, (await readFile(doc, 'utf8')) + '\nCall `POST /api/preferences/analysis`.\n');
    await assert.rejects(run(), error => error.code === 1 && /contract reference/.test(error.stderr));
  } finally { await rm(scratch, { recursive: true, force: true }); }
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

test('historical corpus selects shared product lanes and frontend runs the bounded foundation suite',async()=>{
 const workflow=parse(await readFile(ciPath,'utf8')),filters=parse(workflow.jobs.changes.steps.find(step=>step.id==='filter').with.filters);
 for(const file of ['examples/demo-10-2026/001_user_001/home.jsonl','apps/backend/scripts/demo/domain.mjs'])assert.deepEqual(selectedFilters(filters,file),['backend','desktop','frontend']);
 const step=workflow.jobs['frontend-build'].steps.find(step=>step.name==='Test historical demo foundation without provider sessions');
 assert.equal(step.run,'node --test --test-concurrency=1 examples/demo-10-2026/*.test.mjs');
 assert.equal(step['working-directory'],'.');assert.equal(step['timeout-minutes'],5);assert.deepEqual(step.env,{PLAYWRIGHT_BROWSERS_PATH:'${{ runner.temp }}/playwright'});
});

test('all jobs with trusted client fixtures inherit one private pinned Node before qualification',async()=>{
 for(const [file,job] of [[ciPath,'frontend-build'],[ciPath,'desktop-native'],[dedicatedPath,'source-qualification'],[dedicatedPath,'packaging-qualification']]){
  const steps=parse(await readFile(file,'utf8')).jobs[job].steps,setup=steps.findIndex(s=>s.uses==='actions/setup-node@v4'),privateNode=steps.findIndex(s=>s.run?.split('\n').includes('bash scripts/local-migration/ci-private-node.sh')),install=steps.findIndex(s=>s.run==='pnpm install --frozen-lockfile');
  assert.ok(setup<privateNode&&privateNode<install,job);if(file===ciPath){assert.equal(steps[privateNode]['working-directory'],'.');assert.equal(steps[privateNode]['timeout-minutes'],1);}else{assert.equal(steps[privateNode].name,'Verify toolchain and seed offline Corepack runtime');assert.equal(steps[privateNode]['timeout-minutes'],5);}
 }
 const script=await readFile(path.join(repositoryRoot,'scripts/local-migration/ci-private-node.sh'),'utf8');
 assert.ok(script.includes('mktemp -d "$HOME/.context-router-ci-node.XXXXXX"'));assert.ok(script.includes('install -m 700 "$ci_node_source" "$ci_node_root/node"'));assert.ok(script.includes('cmp "$ci_node_source" "$ci_node_root/node"'));assert.ok(script.includes('= v24.21.0'));assert.ok(script.includes('>> "$GITHUB_PATH"'));
});
