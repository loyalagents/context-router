import assert from "node:assert/strict";
import { chmod, cp, lstat, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
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

import { CI_LANES, classifyChanges, validateSelectionResults } from './ci-validation-policy.mjs';

const changed = (file, extra = {}) => ({ file, status: 'M', oldMode: '100644', newMode: '100644', oldBlob: 'a'.repeat(40), newBlob: 'b'.repeat(40), ...extra });
const selected = changes => Object.entries(classifyChanges(changes)).filter(([, value]) => value).map(([lane]) => lane).sort();
const product = ['backend', 'desktop', 'eval', 'packaging', 'postgres', 'web'];

test('fixed routing covers direct and cross-package consumers without unrelated tooling', () => {
  const cases = [
    ['apps/backend/src/domains/preferences/service.ts', product],
    ['apps/backend/test/local-model/fixtures/session-fixture.mjs', product],
    ['apps/backend/src/mcp/auth/oauth-metadata.controller.ts', [...product, 'restart']],
    ['apps/backend/src/modules/auth/auth.service.ts', [...product, 'restart']],
    ['apps/backend/src/bootstrap/hosted-bootstrap.ts', [...product, 'restart']],
    ['apps/backend/src/config/preferences.catalog.json', [...product, 'restart']],
    ['apps/web/app/dashboard/page.tsx', ['packaging', 'web']],
    ['apps/web/app/globals.css', ['packaging', 'web']],
    ['apps/web/lib/auth0.ts', ['packaging', 'restart', 'web']],
    ['apps/web/app/api/debug/token/route.ts', ['packaging', 'restart', 'web']],
    ['apps/web/middleware.ts', ['backend', 'desktop', 'packaging', 'restart', 'web']],
    ['apps/web/hcp-source-browser.mjs', ['backend', 'desktop', 'packaging', 'web']],
    ['apps/web/local-ui.mjs', ['backend', 'desktop', 'packaging', 'web']],
    ['apps/desktop/native/guardian.m', ['backend', 'desktop', 'packaging', 'web']],
    ['examples/demo-10-2026/001_user_001/home.jsonl', ['backend', 'desktop', 'packaging', 'web']],
    ['apps/local-orchestrator/test/readme.test.ts', ['orchestrator']],
    ['apps/local-orchestrator/README.md', ['orchestrator']],
    ['examples/eval/scripts/generate.mjs', ['backend', 'eval', 'postgres']],
    ['examples/eval/users/elena-marquez/profile.json', ['backend', 'eval', 'postgres']],
    ['examples/eval/prompts/mcp-known-schema.md', ['backend', 'eval', 'postgres']],
    ['examples/eval-harbor/scripts/check_static.sh', ['harbor']],
    ['examples/eval_harbor_agents/agent.py', ['harbor']],
  ];
  for (const [file, lanes] of cases) assert.deepEqual(selected([changed(file)]), [...lanes].sort(), file);
  assert.deepEqual(selected([changed('apps/web/app/globals.css'), changed('apps/local-orchestrator/src/index.ts')]), ['orchestrator', 'packaging', 'web']);
});

test('unknown/shared/mechanism inputs and unsafe path/type/mode changes run every lane', () => {
  for (const file of ['.github/workflows/ci.yml', '.github/workflows/local-migration-baseline.yml', '.nvmrc', '.npmrc',
    'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'scripts/check-toolchain.mjs',
    'scripts/local-migration/installation/artifact-preflight.mjs', 'scripts/hcp/host-boundary.mjs',
    'docs/current/local-migration-contract-baseline.json', 'docs/evidence/fixture.md', 'unknown.md',
    'docs/current/guide.md.js', 'docs/current/guide name.md', 'docs/current/bad\n::warning::injected.md']) {
    assert.deepEqual(selected([changed(file)]), [...CI_LANES].sort(), file);
  }
  for (const extra of [{ status: 'T', newMode: '120000' }, { newMode: '100755' }, { oldMode: '160000', newMode: '160000' }]) {
    assert.deepEqual(selected([changed('apps/web/app/page.tsx', extra)]), [...CI_LANES].sort());
  }
  assert.deepEqual(selected([]), [...CI_LANES].sort());
});

test('maintained documentation additions, deletion and both move endpoints need only consumers', async () => {
  for (const file of [...eligiblePaths, 'README.md', 'docs/current/new.md', 'docs/plans/active/area/README.md']) {
    assert.deepEqual(selected([changed(file)]), [], file);
  }
  for (const extra of [{ status: 'A', oldMode: '000000', oldBlob: '0'.repeat(40) }, { status: 'D', newMode: '000000', newBlob: '0'.repeat(40) }]) {
    assert.deepEqual(selected([changed('docs/current/guide.md', extra)]), []);
  }
  assert.deepEqual(selected([changed('docs/current/guide.md', { oldMode: '100755', newMode: '100755' })]), [...CI_LANES].sort());
  await policyFixture(async f => {
    await f.put('docs/current/new.md'); await f.commit();
    assert.equal((await f.detect()).profile, 'nonruntime');
    f.event.before = await f.git('rev-parse', 'HEAD');
    await rename(path.join(f.cwd, 'docs/current/new.md'), path.join(f.cwd, 'docs/current/moved.md')); await f.commit();
    assert.equal((await f.detect()).profile, 'nonruntime');
    f.event.before = await f.git('rev-parse', 'HEAD');
    await rename(path.join(f.cwd, 'docs/current/moved.md'), path.join(f.cwd, 'runtime.md')); await f.commit();
    assert.equal((await f.detect()).profile, 'full');
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
    assert.equal((await f.detect()).profile, 'selective');
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

test('valid criss-cross PR history requires full qualification and binds every merge base', async () => {
  await policyFixture(async f => {
    const policy = await import('./ci-validation-policy.mjs');
    await f.git('switch', '-qc', 'feature'); await f.put('AGENTS.md', 'left\n'); const left = await f.commit();
    await f.git('switch', '-q', 'main'); await f.put('CLAUDE.md', 'right\n'); const right = await f.commit();
    await f.git('switch', '-q', 'feature'); await f.git('merge', '--no-ff', '-qm', 'cross left', right);
    await f.put('AGENTS.md', 'eligible content after crossing\n'); const head = await f.commit();
    await f.git('switch', '-q', 'main'); await f.git('merge', '--no-ff', '-qm', 'cross right', left);
    const base = await f.git('rev-parse', 'HEAD');
    assert.deepEqual((await f.git('merge-base', '--all', base, head)).split('\n').sort(), [left, right].sort());
    await f.git('merge', '--no-ff', '-qm', 'test merge', head);
    Object.assign(f.environment, { GITHUB_EVENT_NAME: 'pull_request', GITHUB_REF: 'refs/pull/1/merge' });
    f.event.pull_request = { base: { sha: base, ref: 'main' }, head: { sha: head } };
    const selected = await f.detect();
    assert.equal(selected.profile, 'full'); assert.equal(selected.reason, 'ambiguous-base');
    assert.equal(selected.baseSha, base); assert.deepEqual(selected.paths, ['AGENTS.md']);
    const withBases = bases => policy.selectValidation({ cwd: f.cwd, environment: f.environment, event: f.event,
      git: args => args[0] === 'merge-base' && args[1] === '--all' ? Promise.resolve(bases.join('\n') + '\n') : policy.runGit(f.cwd, args) });
    assert.equal((await withBases([right, left])).binding, selected.binding, 'ordering is not identity');
    assert.notEqual((await withBases([right, f.base])).binding, selected.binding, 'different bases change identity');
    const exported = { profile: selected.profile, binding: selected.binding, lanes: selected.lanes };
    const outcomes = { selection: 'success', contracts: 'success', ...Object.fromEntries(policy.CI_LANES.map(lane => [lane, 'success'])) };
    assert.doesNotThrow(() => policy.validateSelectionResults(selected, exported, outcomes));
    for (const lane of policy.CI_LANES) assert.throws(() => policy.validateSelectionResults(selected, exported, { ...outcomes, [lane]: 'skipped' }));
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

test('incomplete Git data, command failures and malformed bases never produce exemptions', async () => {
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
    for (const output of ['', base + '\n' + base + '\n', base + '\ninvalid\n']) {
      const git = async args => args[0] === 'merge-base' && args[1] === '--all' ? output : policy.runGit(f.cwd, args);
      await assert.rejects(policy.selectValidation({ cwd: f.cwd, environment: f.environment, event: f.event, git }), /base/);
    }
  });
});

test('Git output overflow rejects the actual subprocess rather than accepting partial stdout', async () => {
  await policyFixture(async f => {
    await f.put('large.txt', 'x'.repeat(8 * 1024 * 1024 + 1024)); await f.commit();
    const { runGit } = await import('./ci-validation-policy.mjs');
    await assert.rejects(runGit(f.cwd, ['show', 'HEAD:large.txt']), error => error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER');
  });
});

test('invalid UTF-8 Git output fails with a safe encoding category', async () => {
  await policyFixture(async f => {
    await f.put('binary.dat', Buffer.from([0xff])); await f.commit();
    const { runGit } = await import('./ci-validation-policy.mjs');
    await assert.rejects(runGit(f.cwd, ['show', 'HEAD:binary.dat']), /Git output encoding.*UTF-8/);
  });
});


test('aggregate rejects failed/cancelled/missing/unexpected outcomes and changed selection', () => {
  for (const changes of [[changed('README.md')], [changed('apps/web/app/page.tsx')], []]) {
    const lanes = classifyChanges(changes);
    const profile = Object.values(lanes).every(Boolean) ? 'full' : Object.values(lanes).some(Boolean) ? 'selective' : 'nonruntime';
    const selection = { profile, lanes, binding: 'a'.repeat(64) };
    const outcomes = { selection: 'success', contracts: 'success', ...Object.fromEntries(CI_LANES.map(lane => [lane, lanes[lane] ? 'success' : 'skipped'])) };
    assert.doesNotThrow(() => validateSelectionResults(selection, selection, outcomes));
    for (const key of Object.keys(outcomes)) for (const result of ['failure', 'cancelled', 'skipped', 'success', '', undefined, 'neutral']) {
      if (result !== outcomes[key]) assert.throws(() => validateSelectionResults(selection, selection, { ...outcomes, [key]: result }));
    }
    for (const exported of [{}, { ...selection, binding: 'b'.repeat(64) }, { ...selection, lanes: {} }]) {
      assert.throws(() => validateSelectionResults(selection, exported, outcomes));
    }
  }
});

test('main workflow routes every lane, binds immutable checkout and aggregates all outcomes', async () => {
  const workflow = parse(await readFile(dedicatedPath, 'utf8'));
  assert.deepEqual(workflow.on, { push: { branches: ['main'] }, pull_request: { branches: ['main'] } });
  assert.deepEqual(Object.keys(workflow.jobs).sort(), ['validation-selection', 'contracts', ...CI_LANES, 'local-migration-baseline'].sort());
  for (const lane of CI_LANES) {
    const job = workflow.jobs[lane];
    assert.equal(job.needs, 'validation-selection');
    assert.equal(job.if, "${{ !cancelled() && (needs.validation-selection.result != 'success' || fromJSON(needs.validation-selection.outputs.lanes)." + lane + ") }}");
    assert.ok(job['timeout-minutes'] > 0);
  }
  for (const job of Object.values(workflow.jobs)) {
    assert.equal(job.steps.find(step => step.uses?.startsWith('actions/checkout@')).with.ref, '${{ github.sha }}');
    assert.ok(job.steps.every(step => !step['continue-on-error']));
  }
  const aggregate = workflow.jobs['local-migration-baseline'];
  assert.equal(aggregate.if, 'always()');
  assert.deepEqual(aggregate.needs, ['validation-selection', 'contracts', ...CI_LANES]);
  const verdict = aggregate.steps.find(step => step.run === 'node scripts/local-migration/ci-validation-policy.mjs --aggregate');
  assert.equal(verdict.env.NEEDS_JSON, '${{ toJSON(needs) }}');
  const maintenance = parse(await readFile(ciPath, 'utf8'));
  assert.deepEqual(maintenance.on.push.branches, ['hosted-v1-maintenance']);
  assert.deepEqual(maintenance.on.pull_request.branches, ['hosted-v1-maintenance']);
});

test('concurrency cancels only superseded PRs and cannot coalesce pending pushes', async () => {
  const workflow = parse(await readFile(dedicatedPath, 'utf8'));
  assert.equal(workflow.concurrency.group, "${{ github.workflow }}-${{ github.event_name == 'pull_request' && github.event.pull_request.number || github.run_id }}");
  assert.equal(workflow.concurrency['cancel-in-progress'], "${{ github.event_name == 'pull_request' }}");
});

test('runtime jobs retain finite real suites, prepared builds and local-only environment', async () => {
  const { jobs } = parse(await readFile(dedicatedPath, 'utf8'));
  const commands = lane => jobs[lane].steps.flatMap(step => step.run?.trim().split('\n') ?? []);
  const backend = commands('backend');
  for (const command of ['prisma:generate', 'build', 'test:unit', 'test:local-database:tests-only', 'test:local-model', 'test:local-mcp', 'test:local-ui']) {
    assert.ok(backend.includes('pnpm --filter backend ' + command), command);
  }
  assert.ok(backend.indexOf('pnpm --filter backend build') < backend.indexOf('pnpm --filter backend test:local-database:tests-only'));
  assert.ok(!backend.includes('pnpm --filter backend test:local-database'), 'no repeated pretest build');
  assert.doesNotMatch(JSON.stringify(jobs.backend), /DATABASE_URL|MIGRATION_TEST_ADMIN_URL/);
  assert.equal(jobs.backend.services, undefined);
  for (const command of ['typecheck:seed', 'test:integration', 'test:e2e:tests-only']) assert.ok(commands('postgres').includes('pnpm --filter backend ' + command));
  for (const scenario of ['samir-desai-i9-template-smoke', 'elena-marquez-i9-template-smoke']) assert.ok(commands('postgres').includes('pnpm eval:run --scenario ' + scenario));
  assert.equal(jobs.postgres.services.postgres.image, 'postgres:15-alpine');
  assert.ok(commands('web').includes('pnpm --filter web test:local-ui'));
  assert.ok(commands('web').includes('node --test --test-concurrency=1 examples/demo-10-2026/*.test.mjs'));
  for (const command of ['test', 'build:native', 'test:native']) assert.ok(commands('desktop').includes('pnpm --filter desktop ' + command));
  assert.equal(jobs.desktop['runs-on'], 'macos-15');
  assert.ok(commands('packaging').includes('pnpm migration:smoke:packaging'));
  assert.ok(commands('restart').includes('pnpm migration:smoke:restart'));
  for (const lane of ['web', 'packaging', 'restart']) {
    assert.ok(commands(lane).includes('pnpm --filter web exec playwright install --with-deps chromium'));
  }
  for (const lane of ['backend', 'web', 'desktop', 'packaging', 'restart']) {
    assert.ok(commands(lane).includes('bash scripts/local-migration/ci-private-node.sh'));
  }
  for (const lane of ['packaging', 'restart']) {
    const all = commands(lane);
    assert.ok(all.includes('corepack prepare pnpm@10.25.0 --activate'));
    assert.ok(all.includes('pnpm --filter backend exec prisma --version'));
    assert.equal(jobs[lane].services.postgres.image, 'postgres:15-alpine');
    assert.ok(all.indexOf('pnpm --filter backend exec prisma --version') < all.findIndex(command => command.startsWith('pnpm migration:smoke:')));
  }
  assert.ok(commands('web').some(command => command.includes('git show HEAD:apps/backend/src/schema.gql')));
  assert.ok(commands('web').includes('node scripts/local-migration/check-generated-integrity.mjs'));
});

test('contracts always execute actual documentation consumers and gate behavior tests', async () => {
  const job = parse(await readFile(dedicatedPath, 'utf8')).jobs.contracts;
  assert.equal(job.if, undefined);
  const commands = job.steps.map(step => step.run ?? '').join('\n');
  for (const target of ['scripts/check-markdown-links.test.mjs', 'scripts/print-repo-structure.test.mjs',
    'scripts/local-migration/ci-path-filters.test.mjs', 'scripts/local-migration/check-contract-baseline.test.mjs',
    'scripts/local-migration/gate-phases.test.mjs', 'scripts/local-migration/gate-runner.test.mjs',
    'scripts/local-migration/check-nonruntime.mjs', 'scripts/check-markdown-links.mjs',
    'test/contracts/runtime-composition.spec.ts', 'scripts/local-migration/web-runtime-config.test.mjs', 'test/operator-docs.test.ts']) assert.ok(commands.includes(target), target);
  assert.doesNotMatch(commands, /pnpm --filter (?:backend|web) build/);
});

test('selection CLI binds lane outputs and actual needs without exposing raw filenames', async () => {
  await policyFixture(async f => {
    await f.put('docs/current/bad\n::warning::injected.md'); await f.commit();
    const selection = await f.detect();
    const io = await mkdtemp(path.join(os.tmpdir(), 'ci-output-'));
    try {
      const eventPath = path.join(io, 'event.json'), output = path.join(io, 'output'), summary = path.join(io, 'summary');
      await writeFile(eventPath, JSON.stringify(f.event));
      const needs = { 'validation-selection': { result: 'success', outputs: { profile: selection.profile, lanes: JSON.stringify(selection.lanes), binding: selection.binding } }, contracts: { result: 'success' },
        ...Object.fromEntries(CI_LANES.map(lane => [lane, { result: selection.lanes[lane] ? 'success' : 'skipped' }])) };
      const run = (mode, extra = {}) => execFileAsync(process.execPath, [path.join(repositoryRoot, 'scripts/local-migration/ci-validation-policy.mjs'), mode], {
        cwd: f.cwd, timeout: 30000, encoding: 'utf8', env: { ...process.env, ...f.environment, GITHUB_EVENT_PATH: eventPath, GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: summary, NEEDS_JSON: JSON.stringify(needs), ...extra },
      });
      assert.match((await run('--aggregate')).stdout, /Selected checks passed/);
      const exports = await readFile(output, 'utf8');
      assert.match(exports, /profile=full/); assert.ok(exports.includes('lanes=' + JSON.stringify(selection.lanes)));
      for (const result of ['failure', 'cancelled', 'skipped']) {
        needs.backend.result = result;
        await assert.rejects(run('--aggregate', { NEEDS_JSON: JSON.stringify(needs) }));
      }
      await assert.rejects(run('--aggregate', { NEEDS_JSON: '{}' }));
      await assert.rejects(run('--select', { GITHUB_SHA: f.base }));
      assert.equal(await readFile(output, 'utf8'), exports, 'failure exports no success');
      assert.doesNotMatch(await readFile(summary, 'utf8'), /warning|injected|docs\/current/);
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
    // diff --check examines committed base-to-head changes and reports on stdout.
    await execFileAsync('git', ['restore', '--source', base, '--', 'docs/useful/AGENT_WORKFLOW.md'], { cwd: checkout });
    const guidance = path.join(checkout, 'AGENTS.md');
    await writeFile(guidance, (await readFile(guidance, 'utf8')) + '\nTrailing whitespace.  \n##[add-mask]review-fixture  \nCR\r::warning::review-fixture  \n');
    await execFileAsync('git', ['add', 'AGENTS.md'], { cwd: checkout });
    await execFileAsync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'user.name=CI Fixture', '-c', 'user.email=ci@example.invalid', 'commit', '-qm', 'whitespace fixture'], { cwd: checkout });
    await assert.rejects(run(), error => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /AGENTS\.md:\d+: trailing whitespace/);
      assert.doesNotMatch(error.stderr, /<Buffer|##\[/);
      assert.match(error.stderr, /# #\[add-mask\]review-fixture/);
      for (const line of error.stderr.split(/\r\n?|\n/).filter(line => line.length > 0)) assert.match(line, /^Nonruntime check failed: /);
      return true;
    });
  } finally { await rm(scratch, { recursive: true, force: true }); }
});
