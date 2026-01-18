'use client';

import { useState } from 'react';
import SuggestionItem from './SuggestionItem';

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
    }
  }
`;

type FilterReason = 'MISSING_FIELDS' | 'DUPLICATE_KEY' | 'NO_CHANGE' | 'UNKNOWN_SLUG';

interface PreferenceSuggestion {
  id: string;
  slug: string;
  operation: 'CREATE' | 'UPDATE';
  oldValue: any;
  newValue: any;
  confidence: number;
  sourceSnippet: string;
  sourceMeta?: {
    page?: number;
    line?: number;
  };
  wasCorrected?: boolean;
  category?: string;
  description?: string;
}

interface FilteredSuggestion extends PreferenceSuggestion {
  filterReason: FilterReason;
  filterDetails?: string;
}

interface DocumentAnalysisResult {
  analysisId: string;
  suggestions: PreferenceSuggestion[];
  filteredSuggestions: FilteredSuggestion[];
  documentSummary: string | null;
  status: 'success' | 'no_matches' | 'parse_error' | 'ai_error';
  statusReason: string | null;
  filteredCount?: number;
}

const FILTER_REASON_LABELS: Record<FilterReason, string> = {
  MISSING_FIELDS: 'Missing required fields',
  DUPLICATE_KEY: 'Duplicate',
  NO_CHANGE: 'Already set',
  UNKNOWN_SLUG: 'Unknown preference',
};

interface SuggestionsListProps {
  result: DocumentAnalysisResult;
  onClose: () => void;
  onApplied: () => void;
  accessToken: string;
}

export default function SuggestionsList({
  result,
  onClose,
  onApplied,
  accessToken,
}: SuggestionsListProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    new Set(result.suggestions.map((s) => s.id))
  );
  const [editedValues, setEditedValues] = useState<Record<string, any>>({});
  const [applying, setApplying] = useState(false);

  const handleToggle = (id: string) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedIds(newSelected);
  };

  const handleValueChange = (id: string, newValue: any) => {
    setEditedValues((prev) => ({ ...prev, [id]: newValue }));
  };

  const handleSelectAll = () => {
    setSelectedIds(new Set(result.suggestions.map((s) => s.id)));
  };

  const handleDeselectAll = () => {
    setSelectedIds(new Set());
  };

  const handleApply = async () => {
    const input = result.suggestions
      .filter((s) => selectedIds.has(s.id))
      .map((s) => ({
        suggestionId: s.id,
        slug: s.slug,
        operation: s.operation,
        newValue: editedValues[s.id] ?? s.newValue,
      }));

    if (input.length === 0) {
      return;
    }

    setApplying(true);

    try {
      const graphqlUrl = process.env.NEXT_PUBLIC_GRAPHQL_URL || 'http://localhost:3000/graphql';
      const response = await fetch(graphqlUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          query: APPLY_SUGGESTIONS_MUTATION,
          variables: {
            analysisId: result.analysisId,
            input,
          },
        }),
      });

      const data = await response.json();

      if (data.errors) {
        throw new Error(data.errors[0]?.message || 'GraphQL error');
      }

      onApplied();
    } catch (error) {
      console.error('Failed to apply suggestions:', error);
    } finally {
      setApplying(false);
    }
  };

  if (result.status !== 'success') {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <div className="text-center">
          <div className="text-4xl mb-3">
            {result.status === 'no_matches' ? '0' : '!'}
          </div>
          <h3 className="text-lg font-medium text-gray-900 mb-2">
            {result.status === 'no_matches'
              ? 'No Preferences Found'
              : 'Analysis Error'}
          </h3>
          <p className="text-gray-600 mb-4">
            {result.statusReason || 'An error occurred during analysis'}
          </p>
          {result.documentSummary && (
            <p className="text-sm text-gray-500 italic mb-4">
              Document: {result.documentSummary}
            </p>
          )}
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
          >
            Try Another Document
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow">
      <div className="p-4 border-b">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-medium text-gray-900">
              {result.suggestions.length} Suggestion
              {result.suggestions.length !== 1 ? 's' : ''} Found
              {result.filteredCount && result.filteredCount > 0 && (
                <span
                  className="ml-2 text-sm font-normal text-gray-500"
                  title="Some AI suggestions were filtered out due to invalid or duplicate data"
                >
                  ({result.filteredCount} filtered)
                </span>
              )}
            </h3>
            {result.documentSummary && (
              <p className="text-sm text-gray-500 mt-1">{result.documentSummary}</p>
            )}
          </div>
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
        </div>
      </div>

      <div className="p-4 space-y-3 max-h-96 overflow-y-auto">
        {result.suggestions.map((suggestion) => (
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

        {/* Filtered Suggestions Section */}
        {result.filteredSuggestions && result.filteredSuggestions.length > 0 && (
          <div className="mt-4 pt-4 border-t border-gray-200">
            <h4 className="text-sm font-medium text-gray-500 mb-3">
              Filtered Suggestions ({result.filteredSuggestions.length})
            </h4>
            <div className="space-y-2">
              {result.filteredSuggestions.map((suggestion) => (
                <div
                  key={suggestion.id}
                  className="border border-gray-200 rounded-lg p-3 bg-gray-50 opacity-60"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-600">
                          {suggestion.slug}
                        </span>
                        <span className="px-2 py-0.5 text-xs rounded-full bg-gray-200 text-gray-600">
                          {FILTER_REASON_LABELS[suggestion.filterReason]}
                        </span>
                      </div>
                      {suggestion.filterDetails && (
                        <p className="text-xs text-gray-500 mt-1">
                          {suggestion.filterDetails}
                        </p>
                      )}
                      <div className="mt-2 text-xs text-gray-500">
                        <span className="font-medium">Value:</span>{' '}
                        <code className="bg-gray-100 px-1 rounded">
                          {JSON.stringify(suggestion.newValue)}
                        </code>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="p-4 border-t bg-gray-50 flex items-center justify-between">
        <button
          onClick={onClose}
          className="px-4 py-2 text-gray-700 hover:text-gray-900"
        >
          Cancel
        </button>
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-500">
            {selectedIds.size} of {result.suggestions.length} selected
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
            {applying ? 'Applying...' : `Apply ${selectedIds.size} Preferences`}
          </button>
        </div>
      </div>
    </div>
  );
}
