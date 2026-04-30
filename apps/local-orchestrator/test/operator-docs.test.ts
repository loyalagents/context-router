import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { buildHelpText } from '../src/cli';

test('operator command doc stays aligned with the shipped CLI surface', async () => {
  const docPath = path.resolve(
    __dirname,
    '..',
    '..',
    '..',
    'docs',
    'useful',
    'local-orchestrator-commands.md',
  );
  const commandsDoc = await readFile(docPath, 'utf8');
  const help = buildHelpText();

  assert.match(commandsDoc, /CONTEXT_ROUTER_BEARER_TOKEN/);
  assert.match(commandsDoc, /--include-hidden/);
  assert.match(commandsDoc, /--ai-filter-stage both/);
  assert.match(commandsDoc, /--ai-command \.\/path\/to\/filter-preferences\.js/);
  assert.equal(commandsDoc.includes('--ai-command-arg'), false);
  assert.equal(commandsDoc.includes('claude-filter.mjs'), false);
  assert.equal(commandsDoc.includes('codex-filter.mjs'), false);

  assert.match(help, /--include-hidden/);
  assert.match(help, /--ai-command <path-or-name>/);
  assert.equal(help.includes('--ai-command-arg'), false);
});
