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

  if (manifest.config.aiFilter.enabled) {
    lines.push(
      `- AI filtering: enabled stage=${manifest.config.aiFilter.stage ?? 'n/a'}, adapter=${manifest.config.aiFilter.adapter ?? 'n/a'}, degraded=${summary.degradedByAiFallback ? 'yes' : 'no'}, adapter_failures=${summary.aiAdapterFailures}`,
    );
    lines.push(
      `- AI decision counts: file_skips=${summary.aiFilesSkipped}, file_bypasses=${summary.aiFilesBypassed}, ai_applied=${summary.aiSuggestionsAccepted}, ai_skipped=${summary.aiSuggestionsSkipped}, fallback_accepted=${summary.fallbackSuggestionsAccepted}, apply_skipped_files=${summary.aiApplySkippedFiles}`,
    );
  } else {
    lines.push('- AI filtering: disabled');
  }

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
