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
  AnalysisRecord,
  ApplyInputSuggestion,
  CliOptions,
  DiscoveredFile,
  DocumentAnalysisResult,
  FileRunRecord,
  PreferenceSuggestion,
  RunConfig,
  RunManifest,
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

  await mapWithConcurrency(
    files.filter((record) => record.discovery.action === 'analyze'),
    options.concurrency,
    async (record) => {
      if (!record.file) {
        return;
      }

      record.fileFilter = await dependencies.fileFilter.decide(record.file);
      if (record.fileFilter.action === 'skip') {
        return;
      }

      const analysis = await analyzeRecord(record.file, dependencies.analysisClient);
      record.analysis = analysis;

      if (analysis.status !== 'success') {
        return;
      }

      record.suggestionDecisions = await Promise.all(
        analysis.suggestions.map((suggestion) =>
          dependencies.suggestionFilter.decide({
            file: record.file as DiscoveredFile,
            analysis: toDocumentAnalysisResult(analysis),
            suggestion,
          }),
        ),
      );

      if (!options.apply) {
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
          toApplyInputSuggestion(suggestion, record.file as DiscoveredFile),
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
    fileFilter: options.fileFilter,
    suggestionFilter: options.suggestionFilter,
  };

  const partialManifest = {
    version: 1 as const,
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
): ApplyInputSuggestion {
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
    },
  };
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
