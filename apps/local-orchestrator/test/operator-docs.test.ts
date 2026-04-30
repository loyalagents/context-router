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
  assert.match(
    commandsDoc,
    /--ai-command \.\/apps\/local-orchestrator\/scripts\/claude-filter\.mjs/,
  );
  assert.match(
    commandsDoc,
    /--ai-command \.\/apps\/local-orchestrator\/scripts\/codex-filter\.mjs/,
  );
  assert.match(commandsDoc, /--ai-command-arg --model/);
  assert.match(commandsDoc, /--ai-command-arg gpt-5\.4/);

  assert.match(help, /--include-hidden/);
  assert.match(help, /--ai-command <path-or-name>/);
  assert.match(help, /--ai-command-arg <value>/);
});
