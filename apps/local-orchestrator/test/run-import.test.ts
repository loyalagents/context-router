import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { PassthroughFileFilter } from '../src/filters/passthrough-file-filter';
import { PassthroughSuggestionFilter } from '../src/filters/passthrough-suggestion-filter';
import { writeManifest } from '../src/reporting/manifest';
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

test('runImport records ambiguous apply reconciliation when multiple accepted suggestions share a slug', async (t) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'run-import-ambiguous-'));
  t.after(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  await writeFile(path.join(tempRoot, 'prefs.txt'), 'brief and concise');

  const manifest = await runImport(
    buildOptions({ folder: tempRoot, apply: true }),
    {
      analysisClient: {
        analyzeFile: async () =>
          ({
            analysisId: 'analysis-ambiguous',
            status: 'success',
            statusReason: null,
            documentSummary: 'Preference note',
            filteredCount: 0,
            suggestions: [
              {
                id: 'analysis-ambiguous:candidate:1',
                slug: 'system.response_tone',
                operation: 'CREATE',
                newValue: 'brief',
                confidence: 0.9,
                sourceSnippet: 'brief',
              },
              {
                id: 'analysis-ambiguous:candidate:2',
                slug: 'system.response_tone',
                operation: 'UPDATE',
                newValue: 'concise',
                confidence: 0.8,
                sourceSnippet: 'concise',
              },
            ],
            filteredSuggestions: [],
          }) satisfies DocumentAnalysisResult,
      },
      applyClient: {
        applySuggestions: async (batch) => ({
          analysisId: batch.analysisId,
          requestedCount: batch.suggestions.length,
          appliedCount: 1,
          matchedSuggestionIds: [],
          unmatchedSuggestionIds: [],
          ambiguousSuggestionIds: batch.suggestions.map(
            (suggestion) => suggestion.suggestionId,
          ),
          appliedPreferences: [
            {
              id: 'pref-1',
              slug: 'system.response_tone',
              value: 'brief',
              status: 'ACTIVE',
              sourceType: 'INFERRED',
            },
          ],
        }),
      },
      fileFilter: new PassthroughFileFilter(),
      suggestionFilter: new PassthroughSuggestionFilter(),
    },
  );

  assert.deepEqual(manifest.files[0].apply?.matchedSuggestionIds, []);
  assert.deepEqual(manifest.files[0].apply?.unmatchedSuggestionIds, []);
  assert.deepEqual(manifest.files[0].apply?.ambiguousSuggestionIds, [
    'analysis-ambiguous:candidate:1',
    'analysis-ambiguous:candidate:2',
  ]);
  assert.equal(manifest.summary.applyRequested, 2);
  assert.equal(manifest.summary.applyAmbiguous, 2);
  assert.equal(manifest.summary.hasFailures, true);
});

test('runImport records apply transport failures as unmatched suggestions', async (t) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'run-import-apply-error-'));
  t.after(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  await writeFile(path.join(tempRoot, 'prefs.txt'), 'brief responses');

  const manifest = await runImport(
    buildOptions({ folder: tempRoot, apply: true }),
    {
      analysisClient: {
        analyzeFile: async () =>
          ({
            analysisId: 'analysis-transport',
            status: 'success',
            statusReason: null,
            documentSummary: 'Preference note',
            filteredCount: 0,
            suggestions: [
              {
                id: 'analysis-transport:candidate:1',
                slug: 'system.response_tone',
                operation: 'CREATE',
                newValue: 'brief',
                confidence: 0.91,
                sourceSnippet: 'brief responses',
              },
            ],
            filteredSuggestions: [],
          }) satisfies DocumentAnalysisResult,
      },
      applyClient: {
        applySuggestions: async () => {
          throw new RequestError('Socket hang up', 'network');
        },
      },
      fileFilter: new PassthroughFileFilter(),
      suggestionFilter: new PassthroughSuggestionFilter(),
    },
  );

  assert.equal(manifest.files[0].apply?.error, 'Socket hang up');
  assert.deepEqual(manifest.files[0].apply?.matchedSuggestionIds, []);
  assert.deepEqual(manifest.files[0].apply?.unmatchedSuggestionIds, [
    'analysis-transport:candidate:1',
  ]);
  assert.equal(manifest.summary.applyRequested, 1);
  assert.equal(manifest.summary.applyUnmatched, 1);
  assert.equal(manifest.summary.hasFailures, true);
});

test('runImport produces a stable manifest shape for a mixed dry run', async (t) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'run-import-manifest-'));
  t.after(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  await writeFile(path.join(tempRoot, 'prefs.txt'), 'brief responses');
  await writeFile(path.join(tempRoot, 'skip.docx'), 'unsupported');
  await writeFile(path.join(tempRoot, '.prettierrc'), '{ "semi": false }');

  const manifest = await runImport(
    buildOptions({ folder: tempRoot }),
    {
      analysisClient: {
        analyzeFile: async () =>
          ({
            analysisId: 'analysis-manifest',
            status: 'success',
            statusReason: null,
            documentSummary: 'Preference note',
            filteredCount: 1,
            suggestions: [
              {
                id: 'analysis-manifest:candidate:1',
                slug: 'system.response_tone',
                operation: 'CREATE',
                newValue: 'brief',
                confidence: 0.77,
                sourceSnippet: 'brief responses',
              },
            ],
            filteredSuggestions: [
              {
                id: 'analysis-manifest:filtered:1',
                slug: 'custom.unknown',
                operation: 'CREATE',
                newValue: 'x',
                confidence: 0.1,
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

  const stableManifest = JSON.parse(
    JSON.stringify(manifest, (_key, value) => {
      if (value === tempRoot) {
        return '<folder>';
      }
      if (typeof value === 'string' && value.startsWith(tempRoot)) {
        return value.replace(tempRoot, '<folder>');
      }
      return value;
    }),
  );

  assert.deepEqual(stableManifest, {
    version: 1,
    startedAt: stableManifest.startedAt,
    finishedAt: stableManifest.finishedAt,
    config: {
      folder: '<folder>',
      backendUrl: 'http://localhost:3000',
      apply: false,
      concurrency: 1,
      fileFilter: 'passthrough',
      suggestionFilter: 'passthrough',
    },
    hiddenEntriesSkipped: 1,
    files: [
      {
        path: '<folder>/prefs.txt',
        relativePath: 'prefs.txt',
        sizeBytes: 15,
        extension: '.txt',
        originalMimeType: 'text/plain',
        uploadMimeType: 'text/plain',
        file: {
          path: '<folder>/prefs.txt',
          relativePath: 'prefs.txt',
          sizeBytes: 15,
          extension: '.txt',
          originalMimeType: 'text/plain',
          uploadMimeType: 'text/plain',
          uploadFileName: 'prefs.txt',
          coercedToPlainText: false,
        },
        discovery: {
          action: 'analyze',
          reason: 'supported_extension',
        },
        fileFilter: {
          action: 'analyze',
          reason: 'passthrough',
          score: 1,
        },
        analysis: {
          attempted: true,
          status: 'success',
          statusReason: null,
          analysisId: 'analysis-manifest',
          documentSummary: 'Preference note',
          suggestions: [
            {
              id: 'analysis-manifest:candidate:1',
              slug: 'system.response_tone',
              operation: 'CREATE',
              newValue: 'brief',
              confidence: 0.77,
              sourceSnippet: 'brief responses',
            },
          ],
          filteredSuggestions: [
            {
              id: 'analysis-manifest:filtered:1',
              slug: 'custom.unknown',
              operation: 'CREATE',
              newValue: 'x',
              confidence: 0.1,
              sourceSnippet: 'unknown',
              filterReason: 'UNKNOWN_SLUG',
            },
          ],
          filteredCount: 1,
        },
        suggestionDecisions: [
          {
            suggestionId: 'analysis-manifest:candidate:1',
            action: 'apply',
            reason: 'passthrough',
            score: 0.77,
          },
        ],
      },
      {
        path: '<folder>/skip.docx',
        relativePath: 'skip.docx',
        sizeBytes: 11,
        extension: '.docx',
        originalMimeType: null,
        uploadMimeType: null,
        discovery: {
          action: 'skip',
          reason: 'unsupported_extension',
          details: 'Unsupported extension ".docx"',
        },
      },
    ],
    summary: {
      discoveredVisibleFiles: 2,
      hiddenEntriesSkipped: 1,
      unsupportedFilesSkipped: 1,
      skippedByFileFilter: 0,
      analysisAttempted: 1,
      analysisSucceeded: 1,
      analysisNoMatches: 0,
      analysisParseErrors: 0,
      analysisAiErrors: 0,
      analysisRequestErrors: 0,
      backendFilteredSuggestions: 1,
      validSuggestionsFound: 1,
      suggestionsAccepted: 1,
      suggestionsSkippedByFilter: 0,
      applyRequested: 0,
      applyMatched: 0,
      applyUnmatched: 0,
      applyAmbiguous: 0,
      hasFailures: false,
    },
  });
});

test('writeManifest writes stable JSON with version field', async (t) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'run-import-write-'));
  t.after(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  const manifestPath = path.join(tempRoot, 'manifest.json');
  const manifest = await runImport(
    buildOptions({ folder: tempRoot }),
    {
      analysisClient: {
        analyzeFile: async () => {
          throw new Error('should not be called when folder is empty');
        },
      },
      applyClient: {
        applySuggestions: async () => {
          throw new Error('should not be called when folder is empty');
        },
      },
      fileFilter: new PassthroughFileFilter(),
      suggestionFilter: new PassthroughSuggestionFilter(),
    },
  );

  await writeManifest(manifest, manifestPath);

  const content = await readFile(manifestPath, 'utf8');
  assert.match(content, /"version": 1/);
  assert.match(content, /"summary":/);
});
