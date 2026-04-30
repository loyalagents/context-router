import { discoverFiles } from './discover';
import { buildSummary } from './reporting/manifest';
import { AnalysisClient } from './server/analysis-client';
import {
  ApplyClient,
  ApplySuggestionBatch,
} from './server/apply-client';
import { toRequestErrorRecord } from './server/request-error';
import { FileFilter } from './filters/file-filter';
import { SuggestionFilter } from './filters/suggestion-filter';
import {
  AIFilterFailurePolicy,
  AnalysisRecord,
  ApplyInputSuggestion,
  CliOptions,
  DiscoveredFile,
  DocumentAnalysisResult,
  FileRunRecord,
  FilterAuditRecord,
  PreferenceSuggestion,
  RunConfig,
  RunManifest,
  SuggestionDecision,
} from './types';

export interface RunImportDependencies {
  analysisClient: Pick<AnalysisClient, 'analyzeFile'>;
  applyClient: Pick<ApplyClient, 'applySuggestions'>;
  fileFilter: FileFilter;
  suggestionFilter: SuggestionFilter;
}

export async function runImport(
  options: CliOptions,
  dependencies: RunImportDependencies,
): Promise<RunManifest> {
  const startedAt = new Date().toISOString();
  const discovery = await discoverFiles(options.folder);
  const files = discovery.files;
  const useAIFileStage =
    options.aiFilter &&
    (options.aiFilterStage === 'file' || options.aiFilterStage === 'both');
  const useAISuggestionStage =
    options.aiFilter &&
    (options.aiFilterStage === 'suggestion' || options.aiFilterStage === 'both');

  await mapWithConcurrency(
    files.filter((record) => record.discovery.action === 'analyze'),
    options.concurrency,
    async (record) => {
      if (!record.file) {
        return;
      }

      try {
        record.fileFilter = await dependencies.fileFilter.decide(record.file);
      } catch (error) {
        if (!useAIFileStage) {
          throw error;
        }

        const requestError = toRequestErrorRecord(error);
        record.ai = {
          ...(record.ai ?? {}),
          fileStage: {
            adapterError: requestError,
            usedFallback: true,
          },
        };
        record.fileFilter = {
          action: 'analyze',
          reason: 'ai_file_filter_failure_bypass',
          details: requestError.message,
          source: 'fallback',
        };
      }

      applyFileStageMetadata(record);
      if (record.fileFilter.action === 'skip') {
        return;
      }

      const analysis = await analyzeRecord(record.file, dependencies.analysisClient);
      record.analysis = analysis;

      if (analysis.status !== 'success') {
        return;
      }

      try {
        record.suggestionDecisions = await dependencies.suggestionFilter.decide({
          file: record.file as DiscoveredFile,
          analysis: toDocumentAnalysisResult(analysis),
          suggestions: analysis.suggestions,
        });
      } catch (error) {
        if (!useAISuggestionStage) {
          throw error;
        }

        const requestError = toRequestErrorRecord(error);
        record.ai = {
          ...(record.ai ?? {}),
          suggestionStage: {
            adapterError: requestError,
            usedFallback: !options.apply,
            applySkipped: options.apply,
          },
        };
        record.suggestionDecisions = analysis.suggestions.map((suggestion) =>
          toFallbackSuggestionDecision(suggestion, requestError.message),
        );
      }

      applySuggestionStageMetadata(record);

      if (!options.apply) {
        return;
      }

      if (record.ai?.suggestionStage?.applySkipped) {
        return;
      }

      const acceptedSuggestions = analysis.suggestions.filter((suggestion) =>
        record.suggestionDecisions?.some(
          (decision) =>
            decision.suggestionId === suggestion.id && decision.action === 'apply',
        ),
      );

      if (acceptedSuggestions.length === 0 || !analysis.analysisId) {
        return;
      }

      const applyBatch: ApplySuggestionBatch = {
        analysisId: analysis.analysisId,
        suggestions: acceptedSuggestions.map((suggestion) =>
          toApplyInputSuggestion(
            suggestion,
            record.file as DiscoveredFile,
            findSuggestionDecision(record.suggestionDecisions ?? [], suggestion.id),
            options,
          ),
        ),
      };

      try {
        record.apply = await dependencies.applyClient.applySuggestions(applyBatch);
      } catch (error) {
        const requestError = toRequestErrorRecord(error);
        record.apply = {
          analysisId: applyBatch.analysisId,
          requestedCount: applyBatch.suggestions.length,
          appliedCount: 0,
          matchedSuggestionIds: [],
          unmatchedSuggestionIds: applyBatch.suggestions.map(
            (suggestion) => suggestion.suggestionId,
          ),
          ambiguousSuggestionIds: [],
          appliedPreferences: [],
          error: requestError.message,
        };
      }
    },
  );

  const config: RunConfig = {
    folder: options.folder,
    backendUrl: options.backendUrl,
    apply: options.apply,
    concurrency: options.concurrency,
    aiFilter: {
      enabled: options.aiFilter,
      stage: options.aiFilter ? options.aiFilterStage : null,
      adapter: options.aiFilter ? options.aiAdapter : null,
      command: options.aiFilter ? options.aiCommand ?? null : null,
      commandArgs: options.aiFilter ? options.aiCommandArgs : null,
      goal: options.aiFilter ? options.aiGoal ?? null : null,
      timeoutMs: options.aiFilter ? options.aiTimeoutMs : null,
      promptVersion: derivePromptVersion(files),
      failurePolicy: options.aiFilter ? AI_FAILURE_POLICY : null,
    },
  };

  const partialManifest = {
    version: 2 as const,
    startedAt,
    finishedAt: new Date().toISOString(),
    config,
    hiddenEntriesSkipped: discovery.hiddenEntriesSkipped,
    files,
  };

  return {
    ...partialManifest,
    summary: buildSummary(partialManifest),
  };
}

async function analyzeRecord(
  file: DiscoveredFile,
  analysisClient: Pick<AnalysisClient, 'analyzeFile'>,
): Promise<AnalysisRecord> {
  try {
    const result = await analysisClient.analyzeFile(file);
    return {
      attempted: true,
      status: result.status,
      statusReason: result.statusReason ?? null,
      analysisId: result.analysisId,
      documentSummary: result.documentSummary ?? null,
      suggestions: result.suggestions,
      filteredSuggestions: result.filteredSuggestions,
      filteredCount: result.filteredCount,
    };
  } catch (error) {
    return {
      attempted: true,
      status: 'request_error',
      statusReason: null,
      suggestions: [],
      filteredSuggestions: [],
      filteredCount: 0,
      error: toRequestErrorRecord(error),
    };
  }
}

function toDocumentAnalysisResult(
  analysis: AnalysisRecord,
): DocumentAnalysisResult {
  return {
    analysisId: analysis.analysisId ?? 'missing-analysis-id',
    suggestions: analysis.suggestions,
    filteredSuggestions: analysis.filteredSuggestions,
    documentSummary: analysis.documentSummary ?? null,
    status: analysis.status === 'request_error' ? 'ai_error' : analysis.status,
    statusReason: analysis.statusReason ?? null,
    filteredCount: analysis.filteredCount,
  };
}

function toApplyInputSuggestion(
  suggestion: PreferenceSuggestion,
  file: DiscoveredFile,
  decision: SuggestionDecision | undefined,
  options: Pick<CliOptions, 'aiFilter' | 'aiAdapter' | 'aiGoal'>,
): ApplyInputSuggestion {
  const filterAudit: FilterAuditRecord | undefined =
    decision?.source === 'ai' && options.aiFilter && options.aiGoal
      ? {
          stage: 'suggestion',
          adapter: options.aiAdapter,
          goal: options.aiGoal,
          decision: decision.action,
          score: decision.score,
          reason: decision.reason,
        }
      : undefined;

  return {
    suggestionId: suggestion.id,
    slug: suggestion.slug,
    operation: suggestion.operation,
    newValue: suggestion.newValue,
    confidence: suggestion.confidence,
    evidence: {
      source: 'local-orchestrator',
      snippet: suggestion.sourceSnippet,
      sourceMeta: suggestion.sourceMeta ?? null,
      filePath: file.path,
      relativePath: file.relativePath,
      ...(filterAudit ? { filterAudit } : {}),
    },
  };
}

const AI_FAILURE_POLICY: AIFilterFailurePolicy =
  'dry-run-passthrough_apply-skip';

function toFallbackSuggestionDecision(
  suggestion: PreferenceSuggestion,
  details: string,
): SuggestionDecision {
  return {
    suggestionId: suggestion.id,
    action: 'apply',
    reason: 'adapter_failure_passthrough_fallback',
    score: suggestion.confidence,
    details,
    source: 'fallback',
    promptVersion: null,
  };
}

function findSuggestionDecision(
  decisions: SuggestionDecision[],
  suggestionId: string,
): SuggestionDecision | undefined {
  return decisions.find((decision) => decision.suggestionId === suggestionId);
}

function applyFileStageMetadata(record: FileRunRecord): void {
  const decision = record.fileFilter;
  if (!decision) {
    return;
  }

  if (decision.source === 'ai') {
    record.ai = {
      ...(record.ai ?? {}),
      fileStage: {
        ...(record.ai?.fileStage ?? {}),
        promptVersion: decision.promptVersion ?? null,
      },
    };
    return;
  }

  if (decision.source === 'bypass') {
    record.ai = {
      ...(record.ai ?? {}),
      fileStage: {
        ...(record.ai?.fileStage ?? {}),
        bypassReason: decision.reason,
      },
    };
  }
}

function applySuggestionStageMetadata(record: FileRunRecord): void {
  const decisions = record.suggestionDecisions;
  if (!decisions || decisions.length === 0) {
    return;
  }

  const promptVersion =
    decisions.find((decision) => decision.promptVersion)?.promptVersion ?? null;
  const usesFallback = decisions.some((decision) => decision.source === 'fallback');
  const usesAI = decisions.some((decision) => decision.source === 'ai');

  if (!usesFallback && !usesAI) {
    return;
  }

  record.ai = {
    ...(record.ai ?? {}),
    suggestionStage: {
      ...(record.ai?.suggestionStage ?? {}),
      promptVersion,
      usedFallback: record.ai?.suggestionStage?.usedFallback ?? usesFallback,
    },
  };
}

function derivePromptVersion(files: FileRunRecord[]): string | null {
  const versions = new Set<string>();
  for (const record of files) {
    const fileStageVersion = record.ai?.fileStage?.promptVersion;
    if (fileStageVersion) {
      versions.add(fileStageVersion);
    }

    const suggestionStageVersion = record.ai?.suggestionStage?.promptVersion;
    if (suggestionStageVersion) {
      versions.add(suggestionStageVersion);
    }
  }

  if (versions.size === 0) {
    return null;
  }

  if (versions.size === 1) {
    return Array.from(versions)[0];
  }

  return 'multiple';
}

async function mapWithConcurrency<T>(
  items: T[],
  concurrency: number,
  handler: (item: T) => Promise<void>,
): Promise<void> {
  if (items.length === 0) {
    return;
  }

  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(concurrency, items.length));

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        await handler(items[currentIndex]);
      }
    }),
  );
}
