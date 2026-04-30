import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { PassthroughFileFilter } from '../src/filters/passthrough-file-filter';
import { PassthroughSuggestionFilter } from '../src/filters/passthrough-suggestion-filter';
import { SuggestionFilter } from '../src/filters/suggestion-filter';
import { writeManifest } from '../src/reporting/manifest';
import { renderSummary } from '../src/reporting/summary';
import { runImport } from '../src/run-import';
import { RequestError } from '../src/server/request-error';
import {
  BatchSuggestionFilterContext,
  CliOptions,
  DocumentAnalysisResult,
  SuggestionDecision,
} from '../src/types';

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
    aiGoal: undefined,
    aiTimeoutMs: 30000,
    ...overrides,
  };
}

class CountingSuggestionFilter implements SuggestionFilter {
  readonly name = 'counting';

  readonly calls: BatchSuggestionFilterContext[] = [];

  async decide(context: BatchSuggestionFilterContext): Promise<SuggestionDecision[]> {
    this.calls.push(context);
    return context.suggestions.map((suggestion) => ({
      suggestionId: suggestion.id,
      action: 'apply',
      reason: 'counting',
      score: suggestion.confidence,
      source: 'passthrough',
    }));
  }
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

  assert.equal(manifest.version, 3);
  assert.equal(manifest.config.aiFilter.enabled, false);
  assert.equal(manifest.summary.analysisAttempted, 2);
  assert.equal(manifest.summary.analysisRequestErrors, 1);
  assert.equal(manifest.summary.analysisNoMatches, 1);
  assert.equal(manifest.summary.hasFailures, true);

  const failedRecord = manifest.files.find((record) => record.relativePath === 'a.txt');
  assert.equal(failedRecord?.analysis?.status, 'request_error');
  assert.equal(failedRecord?.analysis?.error?.kind, 'network');
});

test('runImport persists includeHidden when hidden traversal is enabled', async (t) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'run-import-hidden-'));
  t.after(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  await writeFile(path.join(tempRoot, '.env'), 'TONE=brief\n');

  const manifest = await runImport(
    buildOptions({ folder: tempRoot, includeHidden: true }),
    {
      analysisClient: {
        analyzeFile: async () =>
          ({
            analysisId: 'analysis-hidden',
            suggestions: [],
            filteredSuggestions: [],
            documentSummary: 'Environment preferences',
            status: 'no_matches',
            statusReason: 'No durable preferences found',
            filteredCount: 0,
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

  assert.equal(manifest.config.includeHidden, true);
  assert.equal(manifest.hiddenEntriesSkipped, 0);
  assert.equal(manifest.summary.hiddenEntriesSkipped, 0);

  const envRecord = manifest.files.find((record) => record.relativePath === '.env');
  assert.equal(envRecord?.discovery.action, 'analyze');
  assert.equal(envRecord?.file?.uploadMimeType, 'text/plain');
  assert.equal(envRecord?.analysis?.status, 'no_matches');
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
  assert.equal(manifest.summary.aiAdapterFailures, 0);
  assert.equal(
    manifest.files[0].analysis?.filteredSuggestions[0].filterReason,
    'UNKNOWN_SLUG',
  );
});

test('runImport invokes the suggestion filter once per analyzed file', async (t) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'run-import-batch-'));
  t.after(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  await writeFile(path.join(tempRoot, 'prefs.txt'), 'brief and concise');

  const suggestionFilter = new CountingSuggestionFilter();

  await runImport(
    buildOptions({ folder: tempRoot }),
    {
      analysisClient: {
        analyzeFile: async () =>
          ({
            analysisId: 'analysis-batch',
            status: 'success',
            statusReason: null,
            documentSummary: 'Preference note',
            filteredCount: 0,
            suggestions: [
              {
                id: 'analysis-batch:candidate:1',
                slug: 'system.response_tone',
                operation: 'CREATE',
                newValue: 'brief',
                confidence: 0.91,
                sourceSnippet: 'brief',
              },
              {
                id: 'analysis-batch:candidate:2',
                slug: 'system.response_style',
                operation: 'CREATE',
                newValue: 'concise',
                confidence: 0.86,
                sourceSnippet: 'concise',
              },
            ],
            filteredSuggestions: [],
          }) satisfies DocumentAnalysisResult,
      },
      applyClient: {
        applySuggestions: async () => {
          throw new Error('should not be called in dry-run mode');
        },
      },
      fileFilter: new PassthroughFileFilter(),
      suggestionFilter,
    },
  );

  assert.equal(suggestionFilter.calls.length, 1);
  assert.equal(suggestionFilter.calls[0].analysis.analysisId, 'analysis-batch');
  assert.equal(suggestionFilter.calls[0].suggestions.length, 2);
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

test('runImport includes filterAudit evidence for AI-accepted suggestions', async (t) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'run-import-ai-evidence-'));
  t.after(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  await writeFile(path.join(tempRoot, 'prefs.txt'), 'brief responses');

  let capturedBatch:
    | {
        analysisId: string;
        suggestions: Array<{ suggestionId: string; evidence?: Record<string, unknown> }>;
      }
    | undefined;

  const manifest = await runImport(
    buildOptions({
      folder: tempRoot,
      apply: true,
      aiFilter: true,
      aiGoal: 'Only keep durable communication preferences',
      aiCommand: 'fake-ai-command',
    }),
    {
      analysisClient: {
        analyzeFile: async () =>
          ({
            analysisId: 'analysis-ai-evidence',
            status: 'success',
            statusReason: null,
            documentSummary: 'Preference note',
            filteredCount: 0,
            suggestions: [
              {
                id: 'analysis-ai-evidence:candidate:1',
                slug: 'system.response_tone',
                operation: 'CREATE',
                newValue: 'brief',
                confidence: 0.96,
                sourceSnippet: 'brief responses',
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
            appliedPreferences: [],
          };
        },
      },
      fileFilter: new PassthroughFileFilter(),
      suggestionFilter: {
        name: 'ai',
        decide: async (context) =>
          context.suggestions.map((suggestion) => ({
            suggestionId: suggestion.id,
            action: 'apply',
            reason: 'Stable communication preference',
            score: 0.94,
            details: 'Durable personalization signal',
            source: 'ai',
            promptVersion: 'prompt-v1',
          })),
      },
    },
  );

  assert.ok(capturedBatch);
  assert.deepEqual(capturedBatch.suggestions[0].evidence?.filterAudit, {
    stage: 'suggestion',
    adapter: 'command',
    goal: 'Only keep durable communication preferences',
    decision: 'apply',
    score: 0.94,
    reason: 'Stable communication preference',
  });
  assert.equal(manifest.summary.aiSuggestionsAccepted, 1);
  assert.equal(manifest.files[0].ai?.suggestionStage?.promptVersion, 'prompt-v1');
});

test('runImport does not attach filterAudit for passthrough or fallback decisions', async (t) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'run-import-no-filter-audit-'));
  t.after(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  await writeFile(path.join(tempRoot, 'prefs.txt'), 'brief and concise');

  let capturedBatch:
    | {
        analysisId: string;
        suggestions: Array<{ suggestionId: string; evidence?: Record<string, unknown> }>;
      }
    | undefined;

  await runImport(
    buildOptions({
      folder: tempRoot,
      apply: true,
      aiFilter: true,
      aiGoal: 'Only keep durable communication preferences',
      aiCommand: 'fake-ai-command',
    }),
    {
      analysisClient: {
        analyzeFile: async () =>
          ({
            analysisId: 'analysis-no-filter-audit',
            status: 'success',
            statusReason: null,
            documentSummary: 'Preference note',
            filteredCount: 0,
            suggestions: [
              {
                id: 'analysis-no-filter-audit:candidate:1',
                slug: 'system.response_tone',
                operation: 'CREATE',
                newValue: 'brief',
                confidence: 0.94,
                sourceSnippet: 'brief',
              },
              {
                id: 'analysis-no-filter-audit:candidate:2',
                slug: 'system.response_style',
                operation: 'CREATE',
                newValue: 'concise',
                confidence: 0.83,
                sourceSnippet: 'concise',
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
            appliedCount: batch.suggestions.length,
            matchedSuggestionIds: batch.suggestions.map(
              (suggestion) => suggestion.suggestionId,
            ),
            unmatchedSuggestionIds: [],
            ambiguousSuggestionIds: [],
            appliedPreferences: [],
          };
        },
      },
      fileFilter: new PassthroughFileFilter(),
      suggestionFilter: {
        name: 'mixed',
        decide: async (context) => [
          {
            suggestionId: context.suggestions[0].id,
            action: 'apply',
            reason: 'passthrough',
            score: 0.94,
            source: 'passthrough',
          },
          {
            suggestionId: context.suggestions[1].id,
            action: 'apply',
            reason: 'fallback',
            score: 0.83,
            source: 'fallback',
          },
        ],
      },
    },
  );

  assert.ok(capturedBatch);
  assert.equal(capturedBatch.suggestions.length, 2);
  assert.equal(capturedBatch.suggestions[0].evidence?.filterAudit, undefined);
  assert.equal(capturedBatch.suggestions[1].evidence?.filterAudit, undefined);
});

test('runImport handles both-stage AI filtering and keeps only AI-accepted suggestions', async (t) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'run-import-both-stage-'));
  t.after(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  await writeFile(path.join(tempRoot, 'prefs.txt'), 'brief and concise');

  let analysisCalls = 0;
  let applyCalls = 0;
  let capturedBatch:
    | {
        analysisId: string;
        suggestions: Array<{ suggestionId: string; evidence?: Record<string, unknown> }>;
      }
    | undefined;

  const manifest = await runImport(
    buildOptions({
      folder: tempRoot,
      apply: true,
      aiFilter: true,
      aiFilterStage: 'both',
      aiGoal: 'Only keep durable communication preferences',
      aiCommand: 'fake-ai-command',
    }),
    {
      analysisClient: {
        analyzeFile: async () => {
          analysisCalls += 1;
          return {
            analysisId: 'analysis-both-stage',
            status: 'success',
            statusReason: null,
            documentSummary: 'Preference note',
            filteredCount: 0,
            suggestions: [
              {
                id: 'analysis-both-stage:candidate:1',
                slug: 'system.response_tone',
                operation: 'CREATE',
                newValue: 'brief',
                confidence: 0.92,
                sourceSnippet: 'brief',
              },
              {
                id: 'analysis-both-stage:candidate:2',
                slug: 'system.response_style',
                operation: 'CREATE',
                newValue: 'concise',
                confidence: 0.81,
                sourceSnippet: 'concise',
              },
            ],
            filteredSuggestions: [],
          } satisfies DocumentAnalysisResult;
        },
      },
      applyClient: {
        applySuggestions: async (batch) => {
          applyCalls += 1;
          capturedBatch = batch;
          return {
            analysisId: batch.analysisId,
            requestedCount: batch.suggestions.length,
            appliedCount: batch.suggestions.length,
            matchedSuggestionIds: batch.suggestions.map(
              (suggestion) => suggestion.suggestionId,
            ),
            unmatchedSuggestionIds: [],
            ambiguousSuggestionIds: [],
            appliedPreferences: [],
          };
        },
      },
      fileFilter: {
        name: 'ai',
        decide: async () => ({
          action: 'analyze',
          reason: 'ai_relevant',
          score: 0.97,
          details: 'This file looks relevant to communication preferences.',
          source: 'ai',
          promptVersion: 'file-prompt-v1',
        }),
      },
      suggestionFilter: {
        name: 'ai',
        decide: async (context) => [
          {
            suggestionId: context.suggestions[0].id,
            action: 'apply',
            reason: 'Stable communication preference',
            score: 0.93,
            source: 'ai',
            promptVersion: 'suggestion-prompt-v1',
          },
          {
            suggestionId: context.suggestions[1].id,
            action: 'skip',
            reason: 'Temporary project detail',
            score: 0.14,
            source: 'ai',
            promptVersion: 'suggestion-prompt-v1',
          },
        ],
      },
    },
  );

  assert.equal(analysisCalls, 1);
  assert.equal(applyCalls, 1);
  assert.ok(capturedBatch);
  assert.deepEqual(
    capturedBatch.suggestions.map((suggestion) => suggestion.suggestionId),
    ['analysis-both-stage:candidate:1'],
  );
  assert.equal(manifest.summary.aiFilesEvaluated, 1);
  assert.equal(manifest.summary.aiSuggestionsAccepted, 1);
  assert.equal(manifest.summary.aiSuggestionsSkipped, 1);
  assert.equal(manifest.summary.applyRequested, 1);
  assert.equal(manifest.files[0].ai?.fileStage?.promptVersion, 'file-prompt-v1');
  assert.equal(
    manifest.files[0].ai?.suggestionStage?.promptVersion,
    'suggestion-prompt-v1',
  );
  assert.equal(manifest.config.aiFilter.promptVersion, 'multiple');
});

test('runImport skips analysis when file-stage AI rejects a file', async (t) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'run-import-file-skip-'));
  t.after(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  await writeFile(path.join(tempRoot, 'prefs.txt'), 'brief responses');

  let analysisCalls = 0;
  let suggestionCalls = 0;

  const manifest = await runImport(
    buildOptions({
      folder: tempRoot,
      aiFilter: true,
      aiFilterStage: 'file',
      aiGoal: 'Only keep durable communication preferences',
      aiCommand: 'fake-ai-command',
    }),
    {
      analysisClient: {
        analyzeFile: async () => {
          analysisCalls += 1;
          throw new Error('analysis should not run when file-stage AI skips the file');
        },
      },
      applyClient: {
        applySuggestions: async () => {
          throw new Error('should not be called in dry-run mode');
        },
      },
      fileFilter: {
        name: 'ai',
        decide: async () => ({
          action: 'skip',
          reason: 'ai_irrelevant',
          score: 0.03,
          details: 'Build log with no stable user preferences.',
          source: 'ai',
          promptVersion: 'file-skip-prompt-v1',
        }),
      },
      suggestionFilter: {
        name: 'counting',
        decide: async () => {
          suggestionCalls += 1;
          return [];
        },
      },
    },
  );

  assert.equal(analysisCalls, 0);
  assert.equal(suggestionCalls, 0);
  assert.equal(manifest.summary.skippedByFileFilter, 1);
  assert.equal(manifest.summary.aiFilesSkipped, 1);
  assert.equal(manifest.summary.analysisAttempted, 0);
  assert.equal(manifest.files[0].fileFilter?.action, 'skip');
  assert.equal(manifest.files[0].ai?.fileStage?.promptVersion, 'file-skip-prompt-v1');
  assert.equal(manifest.config.aiFilter.promptVersion, 'file-skip-prompt-v1');
});

test('runImport aggregates promptVersion as multiple when files use different AI prompts', async (t) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'run-import-prompt-versions-'));
  t.after(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  await writeFile(path.join(tempRoot, 'a.txt'), 'brief responses');
  await writeFile(path.join(tempRoot, 'b.txt'), 'concise responses');

  const manifest = await runImport(
    buildOptions({
      folder: tempRoot,
      aiFilter: true,
      aiGoal: 'Only keep durable communication preferences',
      aiCommand: 'fake-ai-command',
    }),
    {
      analysisClient: {
        analyzeFile: async (file) =>
          ({
            analysisId: `analysis-${file.relativePath}`,
            status: 'success',
            statusReason: null,
            documentSummary: 'Preference note',
            filteredCount: 0,
            suggestions: [
              {
                id: `analysis-${file.relativePath}:candidate:1`,
                slug: 'system.response_tone',
                operation: 'CREATE',
                newValue: 'brief',
                confidence: 0.9,
                sourceSnippet: file.relativePath,
              },
            ],
            filteredSuggestions: [],
          }) satisfies DocumentAnalysisResult,
      },
      applyClient: {
        applySuggestions: async () => {
          throw new Error('should not be called in dry-run mode');
        },
      },
      fileFilter: new PassthroughFileFilter(),
      suggestionFilter: {
        name: 'ai',
        decide: async (context) => [
          {
            suggestionId: context.suggestions[0].id,
            action: 'apply',
            reason: 'Stable communication preference',
            score: 0.9,
            source: 'ai',
            promptVersion:
              context.file.relativePath === 'a.txt' ? 'prompt-a' : 'prompt-b',
          },
        ],
      },
    },
  );

  assert.equal(manifest.config.aiFilter.promptVersion, 'multiple');
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

test('runImport falls back to passthrough decisions on AI suggestion adapter failure in dry-run mode', async (t) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'run-import-ai-fallback-'));
  t.after(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  await writeFile(path.join(tempRoot, 'prefs.txt'), 'brief responses');

  const manifest = await runImport(
    buildOptions({
      folder: tempRoot,
      aiFilter: true,
      aiGoal: 'Only keep durable communication preferences',
      aiCommand: 'fake-ai-command',
    }),
    {
      analysisClient: {
        analyzeFile: async () =>
          ({
            analysisId: 'analysis-ai-fallback',
            status: 'success',
            statusReason: null,
            documentSummary: 'Preference note',
            filteredCount: 0,
            suggestions: [
              {
                id: 'analysis-ai-fallback:candidate:1',
                slug: 'system.response_tone',
                operation: 'CREATE',
                newValue: 'brief',
                confidence: 0.88,
                sourceSnippet: 'brief responses',
              },
              {
                id: 'analysis-ai-fallback:candidate:2',
                slug: 'system.response_style',
                operation: 'CREATE',
                newValue: 'concise',
                confidence: 0.82,
                sourceSnippet: 'concise',
              },
            ],
            filteredSuggestions: [],
          }) satisfies DocumentAnalysisResult,
      },
      applyClient: {
        applySuggestions: async () => {
          throw new Error('should not be called in dry-run mode');
        },
      },
      fileFilter: new PassthroughFileFilter(),
      suggestionFilter: {
        name: 'ai',
        decide: async () => {
          throw new RequestError('AI adapter command failed to start: ENOENT', 'process');
        },
      },
    },
  );

  assert.equal(manifest.summary.aiAdapterFailures, 1);
  assert.equal(manifest.summary.fallbackSuggestionsAccepted, 2);
  assert.equal(manifest.summary.degradedByAiFallback, true);
  assert.equal(manifest.summary.hasFailures, true);
  assert.deepEqual(
    manifest.files[0].suggestionDecisions?.map((decision) => decision.source),
    ['fallback', 'fallback'],
  );
  assert.equal(manifest.files[0].ai?.suggestionStage?.adapterError?.kind, 'process');

  const summary = renderSummary(manifest);
  assert.match(summary, /degraded=yes/);
  assert.match(summary, /fallback_accepted=2/);
});

test('runImport skips apply for a file when AI suggestion filtering fails in apply mode', async (t) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'run-import-ai-apply-skip-'));
  t.after(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  await writeFile(path.join(tempRoot, 'prefs.txt'), 'brief responses');

  let applyCalls = 0;

  const manifest = await runImport(
    buildOptions({
      folder: tempRoot,
      apply: true,
      aiFilter: true,
      aiGoal: 'Only keep durable communication preferences',
      aiCommand: 'fake-ai-command',
    }),
    {
      analysisClient: {
        analyzeFile: async () =>
          ({
            analysisId: 'analysis-ai-apply-skip',
            status: 'success',
            statusReason: null,
            documentSummary: 'Preference note',
            filteredCount: 0,
            suggestions: [
              {
                id: 'analysis-ai-apply-skip:candidate:1',
                slug: 'system.response_tone',
                operation: 'CREATE',
                newValue: 'brief',
                confidence: 0.93,
                sourceSnippet: 'brief responses',
              },
            ],
            filteredSuggestions: [],
          }) satisfies DocumentAnalysisResult,
      },
      applyClient: {
        applySuggestions: async () => {
          applyCalls += 1;
          throw new Error('should not be called when AI apply is skipped');
        },
      },
      fileFilter: new PassthroughFileFilter(),
      suggestionFilter: {
        name: 'ai',
        decide: async () => {
          throw new RequestError('AI adapter command timed out after 30000ms', 'timeout');
        },
      },
    },
  );

  assert.equal(applyCalls, 0);
  assert.equal(manifest.summary.aiAdapterFailures, 1);
  assert.equal(manifest.summary.aiApplySkippedFiles, 1);
  assert.equal(manifest.summary.applyRequested, 0);
  assert.equal(manifest.files[0].ai?.suggestionStage?.applySkipped, true);
  assert.equal(manifest.summary.hasFailures, true);
});

test('runImport records AI file-stage fallback when the local adapter fails', async (t) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'run-import-file-fallback-'));
  t.after(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  await writeFile(path.join(tempRoot, 'prefs.txt'), 'brief responses');

  const manifest = await runImport(
    buildOptions({
      folder: tempRoot,
      aiFilter: true,
      aiFilterStage: 'file',
      aiGoal: 'Only keep durable communication preferences',
      aiCommand: 'fake-ai-command',
    }),
    {
      analysisClient: {
        analyzeFile: async () =>
          ({
            analysisId: 'analysis-file-fallback',
            status: 'success',
            statusReason: null,
            documentSummary: 'Preference note',
            filteredCount: 0,
            suggestions: [],
            filteredSuggestions: [],
          }) satisfies DocumentAnalysisResult,
      },
      applyClient: {
        applySuggestions: async () => {
          throw new Error('should not be called in dry-run mode');
        },
      },
      fileFilter: {
        name: 'ai',
        decide: async () => {
          throw new RequestError('AI adapter command failed to start: ENOENT', 'process');
        },
      },
      suggestionFilter: new PassthroughSuggestionFilter(),
    },
  );

  assert.equal(manifest.files[0].fileFilter?.source, 'fallback');
  assert.equal(manifest.files[0].fileFilter?.reason, 'ai_file_filter_failure_bypass');
  assert.equal(manifest.files[0].ai?.fileStage?.usedFallback, true);
  assert.equal(manifest.summary.aiAdapterFailures, 1);
  assert.equal(manifest.summary.degradedByAiFallback, true);
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
    version: 3,
    startedAt: stableManifest.startedAt,
    finishedAt: stableManifest.finishedAt,
    config: {
      folder: '<folder>',
      backendUrl: 'http://localhost:3000',
      apply: false,
      concurrency: 1,
      includeHidden: false,
      aiFilter: {
        enabled: false,
        stage: null,
        adapter: null,
        command: null,
        goal: null,
        timeoutMs: null,
        promptVersion: null,
        failurePolicy: null,
      },
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
          source: 'passthrough',
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
            source: 'passthrough',
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
      aiFilesEvaluated: 0,
      aiFilesSkipped: 0,
      aiFilesBypassed: 0,
      aiSuggestionsAccepted: 0,
      aiSuggestionsSkipped: 0,
      fallbackSuggestionsAccepted: 0,
      aiAdapterFailures: 0,
      aiApplySkippedFiles: 0,
      degradedByAiFallback: false,
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
  assert.match(content, /"version": 3/);
  assert.match(content, /"includeHidden": false/);
  assert.match(content, /"enabled": false/);
  assert.match(content, /"summary":/);
});
