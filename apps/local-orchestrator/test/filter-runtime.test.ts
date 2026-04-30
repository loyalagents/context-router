import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRuntimeFilters } from '../src/filter-runtime';
import { CliOptions } from '../src/types';

function buildOptions(overrides: Partial<CliOptions> = {}): CliOptions {
  return {
    folder: '/tmp/folder',
    backendUrl: 'http://localhost:3000',
    token: 'secret-token',
    apply: false,
    concurrency: 1,
    includeHidden: false,
    aiFilter: false,
    aiFilterStage: 'suggestion',
    aiAdapter: 'command',
    aiCommand: undefined,
    aiCommandArgs: [],
    aiGoal: undefined,
    aiTimeoutMs: 30000,
    ...overrides,
  };
}

test('buildRuntimeFilters selects passthrough filters when AI is disabled', () => {
  const runtime = buildRuntimeFilters(buildOptions());

  assert.equal(runtime.adapter, null);
  assert.equal(runtime.fileFilter.name, 'passthrough');
  assert.equal(runtime.suggestionFilter.name, 'passthrough');
});

test('buildRuntimeFilters selects the correct filters for each AI stage', () => {
  const suggestionRuntime = buildRuntimeFilters(
    buildOptions({
      aiFilter: true,
      aiFilterStage: 'suggestion',
      aiCommand: './filter-command',
      aiGoal: 'Only keep communication preferences',
    }),
  );
  assert.equal(suggestionRuntime.fileFilter.name, 'passthrough');
  assert.equal(suggestionRuntime.suggestionFilter.name, 'ai');

  const fileRuntime = buildRuntimeFilters(
    buildOptions({
      aiFilter: true,
      aiFilterStage: 'file',
      aiCommand: './filter-command',
      aiGoal: 'Only keep communication preferences',
    }),
  );
  assert.equal(fileRuntime.fileFilter.name, 'ai');
  assert.equal(fileRuntime.suggestionFilter.name, 'passthrough');

  const bothRuntime = buildRuntimeFilters(
    buildOptions({
      aiFilter: true,
      aiFilterStage: 'both',
      aiCommand: './filter-command',
      aiGoal: 'Only keep communication preferences',
    }),
  );
  assert.equal(bothRuntime.fileFilter.name, 'ai');
  assert.equal(bothRuntime.suggestionFilter.name, 'ai');
});
