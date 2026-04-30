import assert from 'node:assert/strict';
import test from 'node:test';
import { buildHelpText, parseCliArgs } from '../src/cli';

test('parseCliArgs returns help command', () => {
  const command = parseCliArgs(['--help'], {});
  assert.equal(command.kind, 'help');
});

test('parseCliArgs applies defaults and env token', () => {
  const command = parseCliArgs(
    ['--folder', './notes'],
    { CONTEXT_ROUTER_BEARER_TOKEN: 'env-token' },
  );

  assert.equal(command.kind, 'run');
  assert.equal(command.options?.apply, false);
  assert.equal(command.options?.backendUrl, 'http://localhost:3000');
  assert.equal(command.options?.concurrency, 1);
  assert.equal(command.options?.aiFilter, false);
  assert.equal(command.options?.aiFilterStage, 'suggestion');
  assert.equal(command.options?.aiAdapter, 'command');
  assert.equal(command.options?.aiTimeoutMs, 30000);
  assert.equal(command.options?.token, 'env-token');
  assert.match(command.options?.folder ?? '', /notes$/);
});

test('parseCliArgs ignores a standalone double-dash separator', () => {
  const command = parseCliArgs(
    ['--', '--folder', './notes', '--token', 'abc'],
    {},
  );

  assert.equal(command.kind, 'run');
  assert.equal(command.options?.token, 'abc');
  assert.match(command.options?.folder ?? '', /notes$/);
});

test('parseCliArgs rejects missing folder', () => {
  assert.throws(
    () => parseCliArgs(['--token', 'abc'], {}),
    /Missing required --folder argument/,
  );
});

test('parseCliArgs rejects missing token when env fallback is absent', () => {
  assert.throws(
    () => parseCliArgs(['--folder', './notes'], {}),
    /Missing bearer token/,
  );
});

test('parseCliArgs rejects invalid concurrency', () => {
  assert.throws(
    () =>
      parseCliArgs(
        ['--folder', './notes', '--token', 'abc', '--concurrency', '0'],
        {},
      ),
    /--concurrency must be a positive integer/,
  );
});

test('parseCliArgs requires --ai-goal when AI filtering is enabled', () => {
  assert.throws(
    () =>
      parseCliArgs(
        ['--folder', './notes', '--token', 'abc', '--ai-filter'],
        {},
      ),
    /--ai-goal is required/,
  );
});

test('parseCliArgs requires --ai-command for the command adapter', () => {
  assert.throws(
    () =>
      parseCliArgs(
        [
          '--folder',
          './notes',
          '--token',
          'abc',
          '--ai-filter',
          '--ai-goal',
          'Only keep communication preferences',
        ],
        {},
      ),
    /--ai-command is required/,
  );
});

test('parseCliArgs rejects AI options when AI filtering is disabled', () => {
  assert.throws(
    () =>
      parseCliArgs(
        ['--folder', './notes', '--token', 'abc', '--ai-command', './filter'],
        {},
      ),
    /AI options require --ai-filter/,
  );
});

test('parseCliArgs accepts AI options with command adapter and stage', () => {
  const command = parseCliArgs(
    [
      '--folder',
      './notes',
      '--token',
      'abc',
      '--ai-filter',
      '--ai-filter-stage',
      'both',
      '--ai-adapter',
      'command',
      '--ai-command',
      './filter-command',
      '--ai-goal',
      'Only keep communication preferences',
      '--ai-timeout-ms',
      '45000',
    ],
    {},
  );

  assert.equal(command.kind, 'run');
  assert.equal(command.options?.aiFilter, true);
  assert.equal(command.options?.aiFilterStage, 'both');
  assert.equal(command.options?.aiAdapter, 'command');
  assert.equal(command.options?.aiCommand, './filter-command');
  assert.equal(
    command.options?.aiGoal,
    'Only keep communication preferences',
  );
  assert.equal(command.options?.aiTimeoutMs, 45000);
});

test('buildHelpText includes basic usage', () => {
  const help = buildHelpText();
  assert.match(help, /--folder <path>/);
  assert.match(help, /--apply/);
  assert.match(help, /--ai-filter/);
  assert.match(help, /--ai-command <path-or-name>/);
});
