import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { PassthroughFileFilter } from '../src/filters/passthrough-file-filter';
import { PassthroughSuggestionFilter } from '../src/filters/passthrough-suggestion-filter';
import { runImport } from '../src/run-import';
import { RequestError } from '../src/server/request-error';
import { CliOptions, DocumentAnalysisResult } from '../src/types';

function buildOptions(overrides: Partial<CliOptions> = {}): CliOptions {
  return {
    folder: '/tmp/folder',
    backendUrl: 'http://localhost:3000',
    token: 'secret-token',
    apply: false,
    concurrency: 1,
    fileFilter: 'passthrough',
    suggestionFilter: 'passthrough',
    ...overrides,
  };
}

test('runImport records analysis request failures and continues', async (t) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'run-import-errors-'));
  t.after(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  await writeFile(path.join(tempRoot, 'a.txt'), 'file-a');
  await writeFile(path.join(tempRoot, 'b.txt'), 'file-b');

  const manifest = await runImport(
    buildOptions({ folder: tempRoot }),
    {
      analysisClient: {
        analyzeFile: async (file) => {
          if (file.relativePath === 'a.txt') {
            throw new RequestError('Network down', 'network');
          }
          return {
            analysisId: 'analysis-b',
            suggestions: [],
            filteredSuggestions: [],
            documentSummary: 'No preferences',
            status: 'no_matches',
            statusReason: 'No useful preferences',
            filteredCount: 0,
          } satisfies DocumentAnalysisResult;
        },
      },
      applyClient: {
        applySuggestions: async () => {
          throw new Error('should not be called in dry-run mode');
        },
      },
      fileFilter: new PassthroughFileFilter(),
      suggestionFilter: new PassthroughSuggestionFilter(),
    },
  );

  assert.equal(manifest.version, 1);
  assert.equal(manifest.summary.analysisAttempted, 2);
  assert.equal(manifest.summary.analysisRequestErrors, 1);
  assert.equal(manifest.summary.analysisNoMatches, 1);
  assert.equal(manifest.summary.hasFailures, true);

  const failedRecord = manifest.files.find((record) => record.relativePath === 'a.txt');
  assert.equal(failedRecord?.analysis?.status, 'request_error');
  assert.equal(failedRecord?.analysis?.error?.kind, 'network');
});

test('runImport records filtered suggestions and summary counts in dry-run mode', async (t) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'run-import-filtered-'));
  t.after(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  await writeFile(path.join(tempRoot, 'prefs.txt'), 'brief responses');

  const manifest = await runImport(
    buildOptions({ folder: tempRoot }),
    {
      analysisClient: {
        analyzeFile: async () =>
          ({
            analysisId: 'analysis-1',
            status: 'success',
            statusReason: null,
            documentSummary: 'Preference note',
            filteredCount: 1,
            suggestions: [
              {
                id: 'analysis-1:candidate:1',
                slug: 'system.response_tone',
                operation: 'CREATE',
                newValue: 'brief',
                confidence: 0.88,
                sourceSnippet: 'brief responses',
              },
            ],
            filteredSuggestions: [
              {
                id: 'analysis-1:filtered:unknown',
                slug: 'custom.unknown',
                operation: 'CREATE',
                newValue: 'x',
                confidence: 0.2,
                sourceSnippet: 'unknown',
                filterReason: 'UNKNOWN_SLUG',
              },
            ],
          }) satisfies DocumentAnalysisResult,
      },
      applyClient: {
        applySuggestions: async () => {
          throw new Error('should not be called in dry-run mode');
        },
      },
      fileFilter: new PassthroughFileFilter(),
      suggestionFilter: new PassthroughSuggestionFilter(),
    },
  );

  assert.equal(manifest.summary.backendFilteredSuggestions, 1);
  assert.equal(manifest.summary.validSuggestionsFound, 1);
  assert.equal(manifest.summary.suggestionsAccepted, 1);
  assert.equal(manifest.files[0].analysis?.filteredSuggestions[0].filterReason, 'UNKNOWN_SLUG');
});

test('runImport maps accepted suggestions into apply requests with evidence', async (t) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'run-import-apply-'));
  t.after(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  await writeFile(path.join(tempRoot, 'prefs.md'), '# Preferences\nbrief responses');

  let capturedBatch:
    | {
        analysisId: string;
        suggestions: Array<{ suggestionId: string; evidence?: Record<string, unknown> }>;
      }
    | undefined;

  const manifest = await runImport(
    buildOptions({ folder: tempRoot, apply: true }),
    {
      analysisClient: {
        analyzeFile: async () =>
          ({
            analysisId: 'analysis-apply',
            status: 'success',
            statusReason: null,
            documentSummary: 'Preference note',
            filteredCount: 0,
            suggestions: [
              {
                id: 'analysis-apply:candidate:1',
                slug: 'system.response_tone',
                operation: 'CREATE',
                newValue: 'brief',
                confidence: 0.93,
                sourceSnippet: 'brief responses',
                sourceMeta: {
                  line: 2,
                },
              },
            ],
            filteredSuggestions: [],
          }) satisfies DocumentAnalysisResult,
      },
      applyClient: {
        applySuggestions: async (batch) => {
          capturedBatch = batch;
          return {
            analysisId: batch.analysisId,
            requestedCount: batch.suggestions.length,
            appliedCount: 1,
            matchedSuggestionIds: [batch.suggestions[0].suggestionId],
            unmatchedSuggestionIds: [],
            ambiguousSuggestionIds: [],
            appliedPreferences: [
              {
                id: 'pref-1',
                slug: 'system.response_tone',
                value: 'brief',
                status: 'ACTIVE',
                sourceType: 'INFERRED',
              },
            ],
          };
        },
      },
      fileFilter: new PassthroughFileFilter(),
      suggestionFilter: new PassthroughSuggestionFilter(),
    },
  );

  assert.ok(capturedBatch);
  assert.equal(capturedBatch.analysisId, 'analysis-apply');
  assert.equal(capturedBatch.suggestions[0].suggestionId, 'analysis-apply:candidate:1');
  assert.equal(capturedBatch.suggestions[0].evidence?.snippet, 'brief responses');
  assert.equal(capturedBatch.suggestions[0].evidence?.relativePath, 'prefs.md');
  assert.equal(manifest.summary.applyRequested, 1);
  assert.equal(manifest.summary.applyMatched, 1);
  assert.equal(manifest.summary.hasFailures, false);
});
