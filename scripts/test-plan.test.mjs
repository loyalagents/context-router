import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, renameSync, readdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { checks, collectChanges, decodeGitOutput, formatPlan, git, parseArgs, parsePaths, planChanges, webGroups } from './test-plan.mjs';

const cli = fileURLToPath(new URL('./test-plan.mjs', import.meta.url));
const groups = webGroups();
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'focused-plan-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const run = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const put = (file, text = 'initial\n') => { mkdirSync(join(root, file, '..'), { recursive: true }); writeFileSync(join(root, file), text); };
  run('init', '-b', 'main');
  run('config', 'user.email', 'fixture@example.invalid');
  run('config', 'user.name', 'Planner fixture');
  run('config', 'commit.gpgsign', 'false');
  put('initial.txt');
  run('add', '.'); run('commit', '-m', 'initial');
  return { root, run, put, commit() { run('add', '.'); run('commit', '-m', 'change'); return run('rev-parse', 'HEAD'); } };
}
const plan = paths => planChanges({ base: 'main', baseCommit: 'a'.repeat(40), head: 'b'.repeat(40), mergeBase: 'a'.repeat(40), paths, sources: {} }, groups);
const ids = result => [...result.commands, ...(result.widerValidation ?? [])].map(check => check.id).filter(id => !id.startsWith('whitespace'));

test('unions committed, staged, unstaged and untracked paths, including cancellation and rename sides', t => {
  const f = fixture(t);
  f.put('rename old.txt'); f.put('delete.txt'); f.put('cancel.txt'); f.commit();
  const base = f.run('rev-parse', 'HEAD');
  f.put('committed.txt'); f.put('initial.txt', 'committed change\n'); f.commit();
  f.put('initial.txt', 'initial\n'); // Committed change reversed locally remains selected.
  f.put('cancel.txt', 'staged change\n'); f.run('add', 'cancel.txt');
  f.put('cancel.txt'); // Index/worktree cancel in a combined HEAD diff.
  renameSync(join(f.root, 'rename old.txt'), join(f.root, 'rename new.txt'));
  rmSync(join(f.root, 'delete.txt'));
  f.run('add', '-A');
  f.put('unstaged.txt'); f.run('add', 'unstaged.txt'); f.put('unstaged.txt', 'other\n');
  const unusual = 'odd\nname\t$(touch PWNED).txt'; f.put(unusual);
  f.put('.gitignore', 'ignored.txt\n'); f.put('ignored.txt');
  const changes = collectChanges(f.root, base);
  for (const file of ['committed.txt', 'initial.txt', 'rename old.txt', 'rename new.txt', 'delete.txt', 'unstaged.txt', unusual]) assert.ok(changes.paths.includes(file), file);
  assert.ok(changes.sources.committed.includes('initial.txt'));
  assert.ok(changes.sources.staged.includes('delete.txt'));
  assert.ok(changes.sources.unstaged.includes('unstaged.txt'));
  assert.ok(changes.sources.untracked.includes(unusual));
  assert.ok(!changes.paths.includes('ignored.txt'));
  assert.equal(changes.mergeBase, base);
});

test('staged/unstaged cancellation cannot disappear from the union', t => {
  const f = fixture(t);
  f.put('initial.txt', 'staged\n'); f.run('add', 'initial.txt'); f.put('initial.txt');
  const changes = collectChanges(f.root, 'HEAD');
  assert.deepEqual(changes.paths, ['initial.txt']);
  assert.deepEqual(changes.sources.staged, ['initial.txt']);
  assert.deepEqual(changes.sources.unstaged, ['initial.txt']);
});

test('honors configured and default global ignores without executing fsmonitor', t => {
  const f = fixture(t);
  const home = mkdtempSync(join(tmpdir(), 'planner-home-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const xdg = join(home, 'xdg'); mkdirSync(join(xdg, 'git'), { recursive: true });
  writeFileSync(join(home, 'ignore'), 'global.tmp\n');
  writeFileSync(join(home, '.gitconfig'), '[core]\n excludesFile = ~/ignore\n fsmonitor = ./monitor\n');
  f.put('monitor', '#!/bin/sh\ntouch MONITOR_RAN\n');
  chmodSync(join(f.root, 'monitor'), 0o755);
  f.put('global.tmp'); f.put('visible.tmp');
  const env = { ...process.env, HOME: home, XDG_CONFIG_HOME: xdg };
  const collect = () => collectChanges(f.root, 'HEAD', args => git(f.root, args, env));
  assert.ok(!collect().paths.includes('global.tmp'));
  assert.ok(collect().paths.includes('visible.tmp'));
  assert.ok(!readdirSync(f.root).includes('MONITOR_RAN'));
  writeFileSync(join(home, '.gitconfig'), '');
  writeFileSync(join(xdg, 'git/ignore'), 'global.tmp\n');
  assert.ok(!collect().paths.includes('global.tmp'));
  const native = execFileSync('git', ['-c', 'core.fsmonitor=false', 'status', '--porcelain=v1', '--untracked-files=all'], { cwd: f.root, env, encoding: 'utf8' });
  assert.deepEqual(collect().sources.untracked.sort(), native.trim().split('\n').map(line => line.slice(3)).sort());
  delete env.XDG_CONFIG_HOME;
  mkdirSync(join(home, '.config/git'), { recursive: true });
  writeFileSync(join(home, '.config/git/ignore'), 'global.tmp\n');
  assert.ok(!collect().paths.includes('global.tmp'));
  writeFileSync(join(home, '.gitconfig'), '[malformed');
  assert.throws(collect);
});

test('uses merge-base rather than treating unrelated base-branch changes as this branch changes', t => {
  const f = fixture(t); const ancestor = f.run('rev-parse', 'HEAD');
  f.run('switch', '-c', 'feature'); f.put('feature.txt'); f.commit();
  f.run('switch', 'main'); f.put('base-only.txt'); f.commit();
  f.run('switch', 'feature');
  const changes = collectChanges(f.root, 'main');
  assert.equal(changes.mergeBase, ancestor);
  assert.deepEqual(changes.paths, ['feature.txt']);
  assert.equal(changes.head, f.run('rev-parse', 'HEAD'));
  assert.equal(changes.baseCommit, f.run('rev-parse', 'main'));
});

test('fails for unknown refs, unrelated history and unresolved conflicts', t => {
  const f = fixture(t);
  assert.throws(() => collectChanges(f.root, 'does-not-exist'));
  assert.throws(() => collectChanges(f.root, '--help'));
  f.run('switch', '-c', 'feature'); f.put('initial.txt', 'feature\n'); f.commit();
  f.run('switch', 'main'); f.put('initial.txt', 'main\n'); f.commit();
  assert.throws(() => f.run('merge', 'feature'));
  assert.throws(() => collectChanges(f.root, 'HEAD'), /unmerged/);
  f.run('merge', '--abort');
  f.run('switch', '--orphan', 'unrelated'); f.put('new.txt'); f.commit();
  assert.throws(() => collectChanges(f.root, 'main'));
});

test('rejects ambiguous merge-base and malformed/partial Git lists', () => {
  const sha = 'a'.repeat(40);
  assert.throws(() => collectChanges('.', 'main', args => args[0] === 'merge-base' ? `${sha}\n${'b'.repeat(40)}\n` : sha), /unique merge-base/);
  for (const value of ['partial', 'ok\0partial', 'ok\0\0', '../escape\0', '/absolute\0']) assert.throws(() => parsePaths(value), /Malformed/);
  assert.deepEqual(parsePaths('space name\0line\nname\0'), ['space name', 'line\nname']);
});

test('rejects invalid UTF-8 Git bytes without producing replacement filenames', () => {
  // macOS filesystems may reject such names before Git can enumerate them.
  assert.throws(() => decodeGitOutput(Buffer.from([111, 107, 0, 255, 0])), /encoded data/);
});

test('rejects invalid CLI arguments, repeated flags and missing base values', () => {
  for (const args of [['--base'], ['--base', '--json'], ['--wat'], ['--json', '--json'], ['main']]) assert.throws(() => parseArgs(args));
  assert.deepEqual(parseArgs(['--base', 'HEAD~1', '--json']), { base: 'HEAD~1', json: true, help: false });
  assert.equal(parseArgs([]).base, 'origin/main');
});

test('known backend test areas select their own supported suite with accurate prerequisites', () => {
  for (const [area, expected] of Object.entries({ integration: 'integration', e2e: 'e2e', 'local-database': 'database', 'local-model': 'model', 'local-mcp': 'mcp', 'local-ui': 'localUi' })) {
    const testFile = area === 'e2e' ? 'nested/example.e2e-spec.ts' :
      ['integration', 'local-database'].includes(area) ? 'nested/example.spec.ts' : 'example.test.mjs';
    const result = plan([`apps/backend/test/${area}/${testFile}`]);
    assert.deepEqual(ids(result), [expected]);
    assert.match(result.commands[0].prerequisites, /Prisma|prisma:generate/);
    if (['model', 'mcp', 'localUi'].includes(expected)) assert.match(result.commands[0].prerequisites, /backend build/);
    if (['integration', 'e2e'].includes(expected)) assert.match(result.commands[0].prerequisites, /PostgreSQL.*migrations.*DATABASE_URL/);
  }
  assert.deepEqual(ids(plan(['apps/backend/src/common/example.spec.ts'])), ['backend']);
  const sqlite = plan(['apps/backend/test/local-database/store.spec.ts']);
  assert.equal(sqlite.commands[0].command, 'pnpm --filter backend test:local-database');
  assert.match(sqlite.alternatives[0].condition, /independently verifying.*current source, dependency and configuration/);
  assert.match(sqlite.alternatives[0].condition, /Existence or mtime is not freshness evidence/);
});

test('shared backend fixtures and files outside suite discovery broaden beyond their directory', () => {
  for (const file of [
    'apps/backend/test/local-model/fixtures/session-fixture.mjs',
    'apps/backend/test/local-model/fixtures/pdf-fixtures.mjs',
    'apps/backend/test/local-mcp/fixtures/nested.test.mjs',
    'apps/backend/test/local-ui/nested/example.test.mjs',
    'apps/backend/test/integration/fixtures/helper.spec.ts',
    'apps/backend/test/local-database/support/helper.ts',
    'apps/backend/test/e2e/helper.spec.ts',
  ]) {
    const result = plan([file]);
    for (const id of ['backend', 'database', 'mcp', 'localUi', 'helpers', 'browser']) assert.ok(ids(result).includes(id), `${file}: ${id}`);
    assert.deepEqual(result.unresolved, [file]);
    assert.match(result.warnings.join('\n'), /native, packaging and recovery/);
  }
});

test('web helper tests use the existing validated census; helper source also retains browser consumers', () => {
  for (const file of groups.helpers) assert.deepEqual(ids(plan([`apps/web/test/${file}`])), ['webDocs', 'helpers']);
  for (const file of groups.browser) assert.deepEqual(ids(plan([`apps/web/test/${file}`])), ['webDocs', 'browser']);
  for (const file of ['lib/local-client-name.ts', 'lib/local-transport.ts', 'lib/local-upload.ts', 'components/local/permissions-draft.ts', 'app/dashboard/page.tsx']) {
    const result = plan([`apps/web/${file}`]);
    for (const id of ['helpers', 'browser', 'webDocs', 'contracts', 'demo']) assert.ok(ids(result).includes(id), `${file}: ${id}`);
    assert.match(result.commands.find(check => check.id === 'browser').prerequisites, /backend build.*web build.*pinned Chromium/);
  }
});

test('unknown, authentication, persistence and shared configuration changes broaden additively', () => {
  for (const file of ['new-area/file.ts', 'apps/backend/src/auth/guard.ts', 'apps/backend/prisma/schema.prisma', 'apps/web/lib/auth0.ts', 'apps/web/app/api/auth/route.ts', 'package.json', '.nvmrc']) {
    const result = plan(['apps/web/test/transport.test.mjs', file]);
    for (const id of ['helpers', 'browser', 'backend', 'database', 'integration', 'e2e', 'model', 'mcp', 'localUi']) assert.ok(ids(result).includes(id), `${file}: ${id}`);
    assert.deepEqual(result.unresolved, [file]);
    assert.match(formatPlan(result), /Manual impact review required/);
    assert.ok(result.warnings.length);
  }
});

test('documentation suggests actual reader suites and requires further reader discovery', () => {
  const result = plan(['docs/useful/HOSTED_DEVELOPMENT.md']);
  for (const id of ['docs', 'topology', 'webDocs', 'operatorDocs', 'contractTests', 'baseContracts']) assert.ok(ids(result).includes(id), id);
  assert.match(result.warnings.join('\n'), /old\/new paths, basenames and distinctive asserted content/);
  assert.match(result.commands.find(check => check.id === 'topology').command, /--runTestsByPath test\/contracts\/runtime-composition.spec.ts/);
  assert.match(result.reminders.join('\n'), /exact-candidate CI/);
  for (const file of ['examples/eval/prompts/task.md', 'apps/backend/test/fixtures/input.md', 'future/input.markdown']) {
    const unknown = plan([file]);
    assert.ok(ids(unknown).includes('docs')); assert.ok(ids(unknown).includes('database'));
    assert.deepEqual(unknown.unresolved, [file]);
  }
});

test('core scripts, CI and desktop suggestions retain mechanism and platform warnings', () => {
  assert.deepEqual(ids(plan(['scripts/test-plan.mjs'])), ['planner']);
  assert.deepEqual(ids(plan(['print-repo-structure.sh'])), ['structure']);
  const ci = plan(['.github/workflows/ci.yml']);
  assert.ok(ids(ci).includes('policy')); assert.ok(ci.unresolved.length);
  const desktop = plan(['apps/desktop/native/menu.m']);
  assert.ok(ids(desktop).includes('native'));
  assert.match(desktop.commands.find(check => check.id === 'native').prerequisites, /Apple Silicon Mac/);
});

test('human output escapes paths, exposes unresolved impact and does not interpolate path commands', () => {
  const file = 'odd\nname\t$(touch PWNED).ts'; const result = plan([file]);
  const rendered = formatPlan(result);
  assert.ok(!rendered.includes(file)); assert.ok(rendered.includes(JSON.stringify(file)));
  assert.ok(result.commands.every(check => !check.command.includes(file)));
  assert.deepEqual(result.unresolved, [file]);
  assert.match(rendered, /Advice only/);
  assert.ok(plan([]).commands.every(check => check.id.startsWith('whitespace')));
  assert.match(formatPlan(plan([])), /None found; this is not a qualification result/);
});

test('registry consumers, web source and component Markdown receive additive checks', () => {
  for (const file of ['apps/web/app/dashboard/preferences/components/DocumentUpload.tsx', 'apps/web/lib/local-transport.ts']) {
    const result = plan([file]);
    for (const id of ['contracts', 'webDocs', 'demo']) assert.ok(ids(result).includes(id), `${file}: ${id}`);
  }
  assert.ok(ids(plan(['apps/local-orchestrator/README.md'])).includes('orchestrator'));
  for (const file of ['examples/eval/prompts/mcp-open-schema.md', 'apps/backend/src/schema.gql', 'apps/backend/src/config/preferences.catalog.json', 'apps/backend/test/eval-runner/helper.ts']) {
    for (const id of ['evalTests', 'evalValidate']) assert.ok(ids(plan([file])).includes(id), `${file}: ${id}`);
  }
  assert.ok(ids(plan(['apps/backend/scripts/demo/operation.mjs'])).includes('demo'));
  for (const file of ['examples/eval-harbor/scripts/report_results.py', 'examples/eval_harbor_agents/codex_service_tier.py']) {
    assert.ok(ids(plan([file])).includes('harbor'), file);
  }
  assert.ok(ids(plan(['docs/current/local-migration-contract-baseline.json'])).includes('contractTests'));
  for (const file of ['apps/backend/test/contracts/fixtures/http-contracts.v1.json', 'apps/local-orchestrator/contracts/run-manifest-v3.schema.json']) {
    assert.ok(ids(plan([file])).includes('contracts'), file);
  }
});

test('supported sibling tests are direct while broad suites are separately labeled candidates', () => {
  const result = plan(['scripts/local-migration/packaging-smoke.mjs', 'package.json']);
  assert.ok(result.commands.some(check => check.command.includes('scripts/local-migration/packaging-smoke.test.mjs')));
  assert.ok(!result.commands.some(check => ['integration', 'e2e', 'browser'].includes(check.id)));
  assert.ok(result.widerValidation.some(check => check.id === 'browser'));
  assert.match(formatPlan(result), /Wider validation candidates/);
  assert.match(result.reminders.join('\n'), /not.*CI.*routing/i);
  const unknown = plan(['scripts/future.test.mjs']);
  assert.ok(!unknown.commands.some(check => check.command.includes('future.test.mjs')));
  assert.deepEqual(unknown.unresolved, ['scripts/future.test.mjs']);
  const paired = plan(['scripts/local-migration/packaging-smoke.mjs', 'scripts/local-migration/packaging-smoke.test.mjs']);
  assert.equal(paired.commands.find(check => check.id.startsWith('node:')).reasons.length, 2);
});

test('every plan offers separate committed, staged and unstaged whitespace advice', () => {
  const result = plan([]);
  const whitespace = result.commands.filter(check => check.id.startsWith('whitespace'));
  assert.equal(whitespace.length, 3);
  assert.ok(whitespace.some(check => check.command.includes(`${result.mergeBase} ${result.head}`)));
  assert.ok(whitespace.some(check => check.command.includes('--cached')));
  assert.ok(whitespace.some(check => check.command === 'git diff --check --'));
  assert.match(result.reminders.join('\n'), /untracked.*whitespace/i);
});

test('deleted or symlinked supported tests remain unresolved, and same-name backend specs are focused', t => {
  const f = fixture(t);
  const sibling = 'scripts/local-migration/packaging-smoke.test.mjs';
  const inputs = { root: f.root, contractPaths: new Set(), nodeTests: new Set([sibling]) };
  const changed = { ...plan([]), paths: ['scripts/local-migration/packaging-smoke.mjs'] };
  for (const symlink of [false, true]) {
    if (symlink) { mkdirSync(join(f.root, 'scripts/local-migration'), { recursive: true }); symlinkSync(join(f.root, 'initial.txt'), join(f.root, sibling)); }
    const result = planChanges(changed, groups, inputs);
    assert.ok(!result.commands.some(check => check.command.includes('packaging-smoke.test.mjs')));
    assert.deepEqual(result.unresolved, changed.paths);
  }
  f.put('apps/backend/src/example.spec.ts', 'test fixture');
  const focused = planChanges({ ...changed, paths: ['apps/backend/src/example.ts'] }, groups, inputs);
  assert.ok(focused.commands.some(check => check.command.endsWith("--runTestsByPath 'src/example.spec.ts'")));
  assert.ok(focused.widerValidation.length); assert.ok(focused.unresolved.length);
});

test('base-bound docs check subsumes current-only checker; SHA256 retains an explicit comparison gap', () => {
  const result = plan(['docs/current/local-migration-contract-baseline.json', 'docs/useful/HOSTED_DEVELOPMENT.md']);
  assert.ok(ids(result).includes('baseContracts')); assert.ok(!ids(result).includes('contracts'));
  const sha256 = planChanges({ ...result, mergeBase: 'a'.repeat(64) }, groups);
  assert.ok(!ids(sha256).includes('baseContracts')); assert.ok(ids(sha256).includes('contracts'));
  assert.match(sha256.warnings.join('\n'), /40-character.*base comparison/);
});

test('every fixed command references existing package scripts and executable/test files', () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  for (const [id, [command]] of Object.entries(checks)) {
    for (const segment of command.split(' && ')) {
      const words = segment.split(' ');
      if (words[0] === 'pnpm') {
        const filtered = words[1] === '--filter';
        const packageRoot = filtered ? `apps/${words[2]}/` : '';
        const script = words[filtered ? 3 : 1];
        const manifest = JSON.parse(readFileSync(join(root, packageRoot, 'package.json')));
        if (script !== 'exec') assert.equal(typeof manifest.scripts[script], 'string', `${id}: ${command}`);
        else for (const word of words) if (/\.(?:mjs|ts)$/.test(word)) assert.ok(readFileSync(join(root, packageRoot, word)).length, `${id}: ${word}`);
      } else {
        assert.equal(words[0], 'node', id);
        for (const word of words) if (word.endsWith('.mjs')) {
          if (word.includes('*')) assert.ok(readdirSync(join(root, word.slice(0, word.lastIndexOf('/')))).some(name => name.endsWith('.test.mjs')), id);
          else assert.ok(readFileSync(join(root, word)).length, `${id}: ${word}`);
        }
      }
    }
  }
});

test('CLI prints JSON/text without invoking advice or changing index, files or refs; failures are nonzero', t => {
  const f = fixture(t); f.put('package.json', '{}'); f.commit();
  f.put('apps/backend/src/change.ts');
  const bin = join(f.root, 'sentinel-bin'); mkdirSync(bin);
  const sentinel = join(f.root, 'COMMAND_WAS_RUN');
  for (const name of ['pnpm', 'npm', 'docker']) writeFileSync(join(bin, name), `#!/bin/sh\ntouch '${sentinel}'\nexit 97\n`, { mode: 0o755 });
  const beforeIndex = readFileSync(join(f.root, '.git/index'));
  const beforeStatus = f.run('status', '--porcelain=v1', '--untracked-files=all');
  const beforeHead = f.run('rev-parse', 'HEAD');
  const run = args => spawnSync(process.execPath, [cli, ...args], { cwd: f.root, encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } });
  const json = run(['--base', 'HEAD', '--json']);
  assert.equal(json.status, 0, json.stderr);
  const result = JSON.parse(json.stdout);
  assert.equal(result.adviceOnly, true); assert.equal(result.head, beforeHead);
  assert.ok(ids(result).includes('database')); assert.ok(result.unresolved.length);
  const human = run(['--base', 'HEAD']); assert.equal(human.status, 0, human.stderr);
  assert.match(human.stdout, /Unresolved impact/);
  for (const args of [['--base', 'missing'], ['--invalid']]) {
    const failure = run(args); assert.notEqual(failure.status, 0); assert.equal(failure.stdout, ''); assert.match(failure.stderr, /No plan produced/);
  }
  assert.deepEqual(readFileSync(join(f.root, '.git/index')), beforeIndex);
  assert.equal(f.run('status', '--porcelain=v1', '--untracked-files=all'), beforeStatus);
  assert.equal(f.run('rev-parse', 'HEAD'), beforeHead);
  assert.ok(!readdirSync(f.root).includes('COMMAND_WAS_RUN'));
});
