import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { RunManifest, RunSummary } from '../types';

export function buildSummary(manifest: Omit<RunManifest, 'summary'>): RunSummary {
  let unsupportedFilesSkipped = 0;
  let skippedByFileFilter = 0;
  let analysisAttempted = 0;
  let analysisSucceeded = 0;
  let analysisNoMatches = 0;
  let analysisParseErrors = 0;
  let analysisAiErrors = 0;
  let analysisRequestErrors = 0;
  let backendFilteredSuggestions = 0;
  let validSuggestionsFound = 0;
  let suggestionsAccepted = 0;
  let suggestionsSkippedByFilter = 0;
  let applyRequested = 0;
  let applyMatched = 0;
  let applyUnmatched = 0;
  let applyAmbiguous = 0;
  let aiFilesEvaluated = 0;
  let aiFilesSkipped = 0;
  let aiFilesBypassed = 0;
  let aiSuggestionsAccepted = 0;
  let aiSuggestionsSkipped = 0;
  let fallbackSuggestionsAccepted = 0;
  let aiAdapterFailures = 0;
  let aiApplySkippedFiles = 0;
  let degradedByAiFallback = false;

  for (const record of manifest.files) {
    if (record.ai?.fileStage || record.ai?.suggestionStage) {
      aiFilesEvaluated += 1;
    }

    if (record.ai?.fileStage?.adapterError) {
      aiAdapterFailures += 1;
      degradedByAiFallback = degradedByAiFallback || Boolean(record.ai.fileStage.usedFallback);
    }

    if (record.ai?.fileStage?.usedFallback) {
      degradedByAiFallback = true;
    }

    if (record.ai?.suggestionStage?.adapterError) {
      aiAdapterFailures += 1;
      degradedByAiFallback =
        degradedByAiFallback || Boolean(record.ai.suggestionStage.usedFallback);
    }

    if (record.ai?.suggestionStage?.applySkipped) {
      aiApplySkippedFiles += 1;
    }

    if (record.discovery.action === 'skip') {
      if (record.discovery.reason === 'unsupported_extension') {
        unsupportedFilesSkipped += 1;
      }
      continue;
    }

    if (record.fileFilter?.action === 'skip') {
      skippedByFileFilter += 1;
      if (record.fileFilter.source === 'ai') {
        aiFilesSkipped += 1;
      }
      continue;
    }

    if (record.fileFilter?.source === 'bypass') {
      aiFilesBypassed += 1;
    }

    if (record.analysis) {
      analysisAttempted += 1;
      backendFilteredSuggestions += record.analysis.filteredCount;
      validSuggestionsFound += record.analysis.suggestions.length;

      switch (record.analysis.status) {
        case 'success':
          analysisSucceeded += 1;
          break;
        case 'no_matches':
          analysisNoMatches += 1;
          break;
        case 'parse_error':
          analysisParseErrors += 1;
          break;
        case 'ai_error':
          analysisAiErrors += 1;
          break;
        case 'request_error':
          analysisRequestErrors += 1;
          break;
      }
    }

    if (record.suggestionDecisions) {
      for (const decision of record.suggestionDecisions) {
        if (decision.action === 'apply') {
          suggestionsAccepted += 1;
        } else {
          suggestionsSkippedByFilter += 1;
        }

        if (decision.source === 'ai') {
          if (decision.action === 'apply') {
            aiSuggestionsAccepted += 1;
          } else {
            aiSuggestionsSkipped += 1;
          }
        }

        if (decision.source === 'fallback' && decision.action === 'apply') {
          fallbackSuggestionsAccepted += 1;
        }
      }
    }

    if (record.apply) {
      applyRequested += record.apply.requestedCount;
      applyMatched += record.apply.matchedSuggestionIds.length;
      applyUnmatched += record.apply.unmatchedSuggestionIds.length;
      applyAmbiguous += record.apply.ambiguousSuggestionIds.length;
    }
  }

  const discoveredVisibleFiles = manifest.files.length;
  const hasFailures =
    analysisParseErrors > 0 ||
    analysisAiErrors > 0 ||
    analysisRequestErrors > 0 ||
    aiAdapterFailures > 0 ||
    applyUnmatched > 0 ||
    applyAmbiguous > 0 ||
    manifest.files.some((record) => Boolean(record.apply?.error));

  return {
    discoveredVisibleFiles,
    hiddenEntriesSkipped: manifest.hiddenEntriesSkipped,
    unsupportedFilesSkipped,
    skippedByFileFilter,
    analysisAttempted,
    analysisSucceeded,
    analysisNoMatches,
    analysisParseErrors,
    analysisAiErrors,
    analysisRequestErrors,
    backendFilteredSuggestions,
    validSuggestionsFound,
    suggestionsAccepted,
    suggestionsSkippedByFilter,
    applyRequested,
    applyMatched,
    applyUnmatched,
    applyAmbiguous,
    aiFilesEvaluated,
    aiFilesSkipped,
    aiFilesBypassed,
    aiSuggestionsAccepted,
    aiSuggestionsSkipped,
    fallbackSuggestionsAccepted,
    aiAdapterFailures,
    aiApplySkippedFiles,
    degradedByAiFallback,
    hasFailures,
  };
}

export async function writeManifest(
  manifest: RunManifest,
  outputPath: string,
): Promise<void> {
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}
