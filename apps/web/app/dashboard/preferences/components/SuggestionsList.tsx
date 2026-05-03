'use client';

import { useState } from 'react';
import SuggestionItem from './SuggestionItem';
import type {
  FilterReason,
  FilteredSuggestion,
  PreferenceSuggestion,
  UploadBatchFileResult,
  UploadBatchResult,
  UploadFileStatus,
} from '../types';

const APPLY_SUGGESTIONS_MUTATION = `
  mutation ApplyPreferenceSuggestions(
    $analysisId: ID!
    $input: [ApplyPreferenceSuggestionInput!]!
  ) {
    applyPreferenceSuggestions(analysisId: $analysisId, input: $input) {
      id
      slug
      value
      status
      sourceType
      lastModifiedBy {
        actorType
        actorClientKey
        origin
      }
    }
  }
`;

const FILTER_REASON_LABELS: Record<FilterReason, string> = {
  MISSING_FIELDS: 'Missing required fields',
  DUPLICATE_KEY: 'Duplicate',
  NO_CHANGE: 'Already set',
  UNKNOWN_SLUG: 'Unknown preference',
};

const STATUS_LABELS: Record<UploadFileStatus, string> = {
  queued: 'Queued',
  analyzing: 'Analyzing',
  success: 'Ready',
  no_matches: 'No preferences found',
  parse_error: 'Analysis error',
  ai_error: 'AI error',
  validation_error: 'Invalid file',
  upload_error: 'Upload failed',
};

interface SuggestionRow {
  file: UploadBatchFileResult;
  suggestion: PreferenceSuggestion;
}

interface ApplySuggestionInput {
  suggestionId: string;
  slug: string;
  operation: 'CREATE' | 'UPDATE';
  newValue: any;
  confidence: number;
  evidence: {
    source: 'dashboard-upload';
    fileName: string;
    snippet: string;
    sourceMeta: PreferenceSuggestion['sourceMeta'] | null;
  };
}

interface SuggestionsListProps {
  batch: UploadBatchResult;
  onClose: () => void;
  onApplied: () => void;
  accessToken: string;
}

function getSuggestionRows(batch: UploadBatchResult): SuggestionRow[] {
  return batch.files.flatMap((file) => {
    if (file.status !== 'success' || !file.result) {
      return [];
    }

    return file.result.suggestions.map((suggestion) => ({
      file,
      suggestion,
    }));
  });
}

function formatCount(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function getFileMessage(file: UploadBatchFileResult): string {
  if (file.error) {
    return file.error;
  }

  if (file.result?.statusReason) {
    return file.result.statusReason;
  }

  if (file.result?.documentSummary) {
    return file.result.documentSummary;
  }

  return STATUS_LABELS[file.status];
}

function getStatusClass(status: UploadFileStatus): string {
  if (status === 'success') {
    return 'bg-green-50 text-green-700';
  }

  if (status === 'no_matches') {
    return 'bg-gray-100 text-gray-700';
  }

  if (
    status === 'validation_error' ||
    status === 'upload_error' ||
    status === 'parse_error' ||
    status === 'ai_error'
  ) {
    return 'bg-red-50 text-red-700';
  }

  return 'bg-gray-100 text-gray-700';
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const parsed = (await response.json()) as {
      message?: string;
      errors?: Array<{ message?: string }>;
    };

    if (parsed.errors && parsed.errors.length > 0) {
      return parsed.errors
        .map((error) => error.message ?? 'Unknown GraphQL error')
        .join('; ');
    }

    if (parsed.message) {
      return parsed.message;
    }
  } catch {
    // Fall through to the generic status message below.
  }

  return `Apply failed: ${response.statusText || response.status}`;
}

function buildApplyInput(
  row: SuggestionRow,
  editedValues: Record<string, any>,
): ApplySuggestionInput {
  return {
    suggestionId: row.suggestion.id,
    slug: row.suggestion.slug,
    operation: row.suggestion.operation,
    newValue: editedValues[row.suggestion.id] ?? row.suggestion.newValue,
    confidence: row.suggestion.confidence,
    evidence: {
      source: 'dashboard-upload',
      fileName: row.file.fileName,
      snippet: row.suggestion.sourceSnippet,
      sourceMeta: row.suggestion.sourceMeta ?? null,
    },
  };
}

function FilteredSuggestionsList({
  suggestions,
}: {
  suggestions: FilteredSuggestion[];
}) {
  if (suggestions.length === 0) {
    return null;
  }

  return (
    <div className="mt-4 pt-4 border-t border-gray-200">
      <h4 className="text-sm font-medium text-gray-500 mb-3">
        Filtered Suggestions ({suggestions.length})
      </h4>
      <div className="space-y-2">
        {suggestions.map((suggestion) => (
          <div
            key={suggestion.id}
            className="border border-gray-200 rounded-lg p-3 bg-gray-50 opacity-70"
          >
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium text-gray-600">
                {suggestion.slug}
              </span>
              <span className="px-2 py-0.5 text-xs rounded-full bg-gray-200 text-gray-600">
                {FILTER_REASON_LABELS[suggestion.filterReason]}
              </span>
            </div>
            {suggestion.filterDetails && (
              <p className="text-xs text-gray-500 mt-1">{suggestion.filterDetails}</p>
            )}
            <div className="mt-2 text-xs text-gray-500">
              <span className="font-medium">Source:</span>{' '}
              <span className="italic">&quot;{suggestion.sourceSnippet}&quot;</span>
              {(suggestion.sourceMeta?.page || suggestion.sourceMeta?.line) && (
                <span className="ml-1">
                  (
                  {suggestion.sourceMeta?.page
                    ? `page ${suggestion.sourceMeta.page}`
                    : null}
                  {suggestion.sourceMeta?.page && suggestion.sourceMeta?.line
                    ? ', '
                    : null}
                  {suggestion.sourceMeta?.line
                    ? `line ${suggestion.sourceMeta.line}`
                    : null}
                  )
                </span>
              )}
            </div>
            <div className="mt-2 text-xs text-gray-500">
              <span className="font-medium">Value:</span>{' '}
              <code className="bg-gray-100 px-1 rounded">
                {JSON.stringify(suggestion.newValue)}
              </code>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function SuggestionsList({
  batch,
  onClose,
  onApplied,
  accessToken,
}: SuggestionsListProps) {
  const suggestionRows = getSuggestionRows(batch);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(suggestionRows.map((row) => row.suggestion.id)),
  );
  const [editedValues, setEditedValues] = useState<Record<string, any>>({});
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);

  const totalFiltered = batch.files.reduce(
    (total, file) => total + (file.result?.filteredSuggestions.length ?? 0),
    0,
  );
  const noMatchCount = batch.files.filter((file) => file.status === 'no_matches').length;
  const failedCount = batch.files.filter((file) =>
    ['validation_error', 'upload_error', 'parse_error', 'ai_error'].includes(file.status),
  ).length;

  const handleToggle = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleValueChange = (id: string, newValue: any) => {
    setEditedValues((prev) => ({ ...prev, [id]: newValue }));
  };

  const handleSelectAll = () => {
    setSelectedIds(new Set(suggestionRows.map((row) => row.suggestion.id)));
  };

  const handleDeselectAll = () => {
    setSelectedIds(new Set());
  };

  const handleApply = async () => {
    const selectedRows = suggestionRows.filter((row) =>
      selectedIds.has(row.suggestion.id),
    );

    if (selectedRows.length === 0) {
      return;
    }

    setApplyError(null);
    setApplying(true);

    try {
      const batchesByAnalysisId = new Map<string, ApplySuggestionInput[]>();

      for (const row of selectedRows) {
        const analysisId = row.file.result?.analysisId;
        if (!analysisId) {
          continue;
        }

        const existing = batchesByAnalysisId.get(analysisId) ?? [];
        existing.push(buildApplyInput(row, editedValues));
        batchesByAnalysisId.set(analysisId, existing);
      }

      const graphqlUrl =
        process.env.NEXT_PUBLIC_GRAPHQL_URL || 'http://localhost:3000/graphql';

      for (const [analysisId, input] of batchesByAnalysisId.entries()) {
        const response = await fetch(graphqlUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            query: APPLY_SUGGESTIONS_MUTATION,
            variables: {
              analysisId,
              input,
            },
          }),
        });

        if (!response.ok) {
          throw new Error(await readErrorMessage(response));
        }

        const data = await response.json();

        if (data.errors) {
          throw new Error(data.errors[0]?.message || 'GraphQL error');
        }
      }

      onApplied();
    } catch (error) {
      setApplyError(
        error instanceof Error ? error.message : 'Failed to apply suggestions',
      );
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="rounded-lg border border-gray-200">
      <div className="p-4 border-b">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className="text-lg font-medium text-gray-900">
              {formatCount(suggestionRows.length, 'Suggestion')} Found
              {totalFiltered > 0 && (
                <span
                  className="ml-2 text-sm font-normal text-gray-500"
                  title="Some AI suggestions were filtered out due to invalid or duplicate data"
                >
                  ({totalFiltered} filtered)
                </span>
              )}
            </h3>
            <p className="text-sm text-gray-500 mt-1">
              {formatCount(batch.files.length, 'file')} processed
              {noMatchCount > 0 ? `, ${formatCount(noMatchCount, 'no-match file')}` : ''}
              {failedCount > 0 ? `, ${formatCount(failedCount, 'failed file')}` : ''}
            </p>
          </div>

          {suggestionRows.length > 0 && (
            <div className="flex gap-2 text-sm">
              <button
                onClick={handleSelectAll}
                className="text-blue-600 hover:text-blue-800"
              >
                Select all
              </button>
              <span className="text-gray-300">|</span>
              <button
                onClick={handleDeselectAll}
                className="text-blue-600 hover:text-blue-800"
              >
                Deselect all
              </button>
            </div>
          )}
        </div>

        {applyError && (
          <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {applyError}
          </div>
        )}
      </div>

      <div className="p-4 space-y-4 max-h-[32rem] overflow-y-auto">
        {batch.files.map((file) => {
          if (file.status !== 'success' || !file.result) {
            return (
              <div
                key={file.id}
                className="flex flex-col gap-2 rounded-lg border border-gray-200 bg-gray-50 p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-gray-800">
                    {file.fileName}
                  </p>
                  <p className="text-xs text-gray-500">{getFileMessage(file)}</p>
                </div>
                <span
                  className={`shrink-0 rounded px-2 py-0.5 text-xs font-medium ${getStatusClass(
                    file.status,
                  )}`}
                >
                  {STATUS_LABELS[file.status]}
                </span>
              </div>
            );
          }

          return (
            <section
              key={file.id}
              className="rounded-lg border border-gray-200 p-4"
            >
              <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <h4 className="truncate text-sm font-semibold text-gray-900">
                    {file.fileName}
                  </h4>
                  {file.result.documentSummary && (
                    <p className="mt-1 text-sm text-gray-500">
                      {file.result.documentSummary}
                    </p>
                  )}
                </div>
                <span className="shrink-0 rounded bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">
                  {formatCount(file.result.suggestions.length, 'suggestion')}
                </span>
              </div>

              <div className="space-y-3">
                {file.result.suggestions.map((suggestion) => (
                  <SuggestionItem
                    key={suggestion.id}
                    suggestion={{
                      ...suggestion,
                      newValue: editedValues[suggestion.id] ?? suggestion.newValue,
                    }}
                    isSelected={selectedIds.has(suggestion.id)}
                    onToggle={() => handleToggle(suggestion.id)}
                    onValueChange={(value) => handleValueChange(suggestion.id, value)}
                  />
                ))}
              </div>

              <FilteredSuggestionsList
                suggestions={file.result.filteredSuggestions}
              />
            </section>
          );
        })}
      </div>

      <div className="border-t bg-gray-50 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <button
            onClick={onClose}
            className="px-4 py-2 text-left text-gray-700 hover:text-gray-900 sm:text-center"
          >
            Try Another Upload
          </button>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
            <span className="text-sm text-gray-500">
              {selectedIds.size} of {suggestionRows.length} selected
            </span>
            <button
              onClick={handleApply}
              disabled={selectedIds.size === 0 || applying}
              className={`px-4 py-2 rounded-lg font-medium ${
                selectedIds.size === 0 || applying
                  ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                  : 'bg-blue-600 text-white hover:bg-blue-700'
              }`}
            >
              {applying
                ? 'Applying...'
                : `Apply ${formatCount(selectedIds.size, 'Preference')}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
