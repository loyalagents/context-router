import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildClaudeCodeArgs,
  extractClaudeCodeText,
  modelMetadata,
  thinkingMetadata,
  validateThinkingMode,
} from './claude-code-cli.mjs';

test('buildClaudeCodeArgs adds model and effort only when requested', () => {
  const defaultArgs = buildClaudeCodeArgs({
    model: 'claude-sonnet-4-20250514',
    thinkingMode: 'default',
    tools: 'Read,Glob,Grep',
    allowedTools: 'Read,Glob,Grep',
  });
  assert.equal(argValue(defaultArgs, '--model'), 'claude-sonnet-4-20250514');
  assert.equal(defaultArgs.includes('--effort'), false);
  assert.equal(argValue(defaultArgs, '--tools'), 'Read,Glob,Grep');
  assert.equal(argValue(defaultArgs, '--allowedTools'), 'Read,Glob,Grep');
  assert.equal(defaultArgs.includes('--mcp-config'), false);

  const isolatedDirectArgs = buildClaudeCodeArgs({
    model: 'claude-sonnet-4-20250514',
    thinkingMode: 'default',
    mcpConfig: '{"mcpServers":{}}',
    strictMcpConfig: true,
    settingSources: 'project',
    tools: 'Read,Glob,Grep',
    allowedTools: 'Read,Glob,Grep',
    disableSlashCommands: true,
    safeMode: true,
  });
  assert.equal(argValue(isolatedDirectArgs, '--mcp-config'), '{"mcpServers":{}}');
  assert.equal(isolatedDirectArgs.includes('--strict-mcp-config'), true);
  assert.equal(argValue(isolatedDirectArgs, '--setting-sources'), 'project');
  assert.equal(isolatedDirectArgs.includes('--disable-slash-commands'), true);
  assert.equal(isolatedDirectArgs.includes('--safe-mode'), true);

  const highArgs = buildClaudeCodeArgs({
    model: 'claude-opus-4-20250514',
    thinkingMode: 'high',
    mcpConfig: '/private/tmp/mcp.json',
    strictMcpConfig: true,
    settings: '/private/tmp/settings.json',
    tools: 'Read,Glob,Grep,ToolSearch',
    allowedTools: 'Read,Glob,Grep,ToolSearch,mcp__context-router-local__*',
  });
  assert.equal(argValue(highArgs, '--model'), 'claude-opus-4-20250514');
  assert.equal(argValue(highArgs, '--effort'), 'high');
  assert.equal(argValue(highArgs, '--mcp-config'), '/private/tmp/mcp.json');
  assert.equal(highArgs.includes('--strict-mcp-config'), true);
  assert.equal(argValue(highArgs, '--settings'), '/private/tmp/settings.json');
});

test('thinking metadata records no fake budget', () => {
  assert.equal(validateThinkingMode('default'), null);
  assert.match(validateThinkingMode('turbo'), /--thinking-mode/);
  assert.deepEqual(thinkingMetadata({ thinkingMode: 'xhigh' }), {
    mode: 'xhigh',
    budget: null,
    source: 'manual',
  });
});

test('model metadata preserves explicit source when provided', () => {
  assert.deepEqual(modelMetadata({ model: 'env-model', modelSource: 'env' }), {
    label: 'env-model',
    source: 'env',
  });
  assert.deepEqual(
    modelMetadata({ modelLabel: 'cli-label', modelLabelSource: 'manual' }),
    {
      label: 'cli-label',
      source: 'manual',
    },
  );
  assert.deepEqual(modelMetadata({}), {
    label: null,
    source: 'unspecified',
  });
});

test('extractClaudeCodeText reads common stream-json event shapes', () => {
  const stdout = [
    JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: '{"facts":[' }] },
    }),
    JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: ']}' }] },
    }),
    '',
  ].join('\n');
  assert.equal(extractClaudeCodeText(stdout), '{"facts":[]}');

  const resultStdout = `${JSON.stringify({ type: 'result', result: '{"ok":true}' })}\n`;
  assert.equal(extractClaudeCodeText(resultStdout), '{"ok":true}');
});

function argValue(args, flag) {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}
