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
  assert.equal(command.options?.fileFilter, 'passthrough');
  assert.equal(command.options?.suggestionFilter, 'passthrough');
  assert.equal(command.options?.token, 'env-token');
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

test('parseCliArgs rejects unsupported filter names', () => {
  assert.throws(
    () =>
      parseCliArgs(
        ['--folder', './notes', '--token', 'abc', '--file-filter', 'ollama'],
        {},
      ),
    /only supports "passthrough"/,
  );
});

test('buildHelpText includes basic usage', () => {
  const help = buildHelpText();
  assert.match(help, /--folder <path>/);
  assert.match(help, /--apply/);
});
