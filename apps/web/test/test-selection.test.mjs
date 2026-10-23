import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { validateWebTestGroups } from './check-test-groups.mjs';

const files = (await readdir(import.meta.dirname)).filter(name => name.endsWith('.test.mjs'));
const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

test('focused direct web commands partition every umbrella test and include irregular browser names', async () => {
  const { helpers, browser } = validateWebTestGroups(manifest.scripts, files);
  assert.deepEqual([...helpers, ...browser].sort(), [...files].sort());
  assert.ok(browser.includes('client-names.test.mjs'));
  assert.ok(helpers.includes('client-name-format.test.mjs'));
  assert.equal(manifest.scripts['test:local-ui'], 'node --unhandled-rejections=strict --test --test-concurrency=1 test/*.test.mjs');
  assert.equal(manifest.scripts.test, 'pnpm test:local-ui');
  for (const group of ['helpers', 'browser']) assert.equal(manifest.scripts['pretest:' + group], 'node test/check-test-groups.mjs');
  const root = JSON.parse(await readFile(new URL('../../../package.json', import.meta.url), 'utf8'));
  assert.equal(root.scripts['test:web'], 'pnpm --filter web test');
});

test('new, removed, duplicate or changed web groups fail census validation', () => {
  for (const discovered of [[...files, 'future.test.mjs'], files.slice(1), [...files, files[0]]]) {
    assert.throws(() => validateWebTestGroups(manifest.scripts, discovered), /census/);
  }
  for (const change of [
    scripts => { scripts['test:helpers'] += ' test/browser.test.mjs'; },
    scripts => { scripts['test:browser'] = scripts['test:browser'].replace('test/client-names.test.mjs', 'test/missing.test.mjs'); },
    scripts => { scripts['test:browser'] = scripts['test:browser'].replace('--test-concurrency=1', '--test-concurrency=4'); },
    scripts => { scripts['test:helpers'] = 'node another-wrapper.mjs'; },
  ]) {
    const scripts = { ...manifest.scripts }; change(scripts);
    assert.throws(() => validateWebTestGroups(scripts, files), /command|census/);
  }
});
