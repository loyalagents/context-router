import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { buildHelpText } from '../src/cli';

test('README command examples stay aligned with the CLI surface', async () => {
  const readmePath = path.resolve(
    __dirname,
    '..',
    'README.md',
  );
  const readme = await readFile(readmePath, 'utf8');
  const help = buildHelpText();

  assert.match(readme, /pnpm --filter local-orchestrator start -- \\/);
  assert.match(readme, /--folder \.\/my-files \\/);
  assert.match(readme, /--token "\$CONTEXT_ROUTER_BEARER_TOKEN"/);
  assert.match(readme, /--apply/);
  assert.match(readme, /--ai-filter/);
  assert.match(
    readme,
    /--ai-command \.\/apps\/local-orchestrator\/scripts\/claude-filter\.mjs/,
  );
  assert.match(
    readme,
    /--ai-command \.\/apps\/local-orchestrator\/scripts\/codex-filter\.mjs/,
  );
  assert.match(readme, /--ai-command-arg --model/);

  assert.match(help, /--folder <path>/);
  assert.match(help, /--token <token>/);
  assert.match(help, /--apply/);
  assert.match(help, /--ai-filter/);
  assert.match(help, /--ai-command <path-or-name>/);
  assert.match(help, /--ai-command-arg <value>/);
});
