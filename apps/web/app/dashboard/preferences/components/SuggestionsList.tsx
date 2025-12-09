'use client';

import { useState } from 'react';
import { gql } from '@apollo/client';
import { useMutation } from '@apollo/client/react';
import SuggestionItem from './SuggestionItem';

const APPLY_SUGGESTIONS_MUTATION = gql`
  mutation ApplyPreferenceSuggestions(
    $analysisId: ID!
    $input: [ApplyPreferenceSuggestionInput!]!
  ) {
    applyPreferenceSuggestions(analysisId: $analysisId, input: $input) {
      preferenceId
      category
      key
      value
    }
  }
`;

interface PreferenceSuggestion {
  id: string;
  category: string;
  key: string;
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
}

interface DocumentAnalysisResult {
  analysisId: string;
  suggestions: PreferenceSuggestion[];
  documentSummary: string | null;
  status: 'success' | 'no_matches' | 'parse_error' | 'ai_error';
  statusReason: string | null;
  filteredCount?: number;
}

interface SuggestionsListProps {
  result: DocumentAnalysisResult;
  onClose: () => void;
  onApplied: () => void;
}

export default function SuggestionsList({
  result,
  onClose,
  onApplied,
}: SuggestionsListProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    new Set(result.suggestions.map((s) => s.id))
  );
  const [editedValues, setEditedValues] = useState<Record<string, any>>({});

  const [applyMutation, { loading: applying }] = useMutation(
    APPLY_SUGGESTIONS_MUTATION
  );

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
        key: s.key,
        category: s.category,
        operation: s.operation,
        newValue: editedValues[s.id] ?? s.newValue,
      }));

    if (input.length === 0) {
      return;
    }

    try {
      await applyMutation({
        variables: {
          analysisId: result.analysisId,
          input,
        },
      });
      onApplied();
    } catch (error) {
      console.error('Failed to apply suggestions:', error);
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
