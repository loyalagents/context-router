import { RunManifest } from '../types';

export function renderSummary(manifest: RunManifest): string {
  const { summary } = manifest;
  const lines = [
    'Local orchestrator summary',
    `- Visible files discovered: ${summary.discoveredVisibleFiles}`,
    `- Hidden entries skipped: ${summary.hiddenEntriesSkipped}`,
    `- Unsupported visible files skipped: ${summary.unsupportedFilesSkipped}`,
    `- Skipped by file filter: ${summary.skippedByFileFilter}`,
    `- Analysis attempted: ${summary.analysisAttempted}`,
    `- Analysis status counts: success=${summary.analysisSucceeded}, no_matches=${summary.analysisNoMatches}, parse_error=${summary.analysisParseErrors}, ai_error=${summary.analysisAiErrors}, request_error=${summary.analysisRequestErrors}`,
    `- Valid suggestions found: ${summary.validSuggestionsFound}`,
    `- Backend filtered suggestions: ${summary.backendFilteredSuggestions}`,
    `- Suggestion decisions: accepted=${summary.suggestionsAccepted}, skipped=${summary.suggestionsSkippedByFilter}`,
  ];

  if (manifest.config.apply) {
    lines.push(
      `- Apply results: requested=${summary.applyRequested}, matched=${summary.applyMatched}, unmatched=${summary.applyUnmatched}, ambiguous=${summary.applyAmbiguous}`,
    );
  } else {
    lines.push('- Apply results: dry-run (no writes attempted)');
  }

  lines.push(
    `- Exit status: ${summary.hasFailures ? 'failure' : 'success'}`,
  );

  return lines.join('\n');
}
