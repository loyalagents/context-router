'use client';

import { useState } from 'react';

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

interface SuggestionItemProps {
  suggestion: PreferenceSuggestion;
  isSelected: boolean;
  onToggle: () => void;
  onValueChange: (newValue: any) => void;
}

export default function SuggestionItem({
  suggestion,
  isSelected,
  onToggle,
  onValueChange,
}: SuggestionItemProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(
    JSON.stringify(suggestion.newValue, null, 2)
  );

  const confidenceColor =
    suggestion.confidence >= 0.8
      ? 'bg-green-100 text-green-800'
      : suggestion.confidence >= 0.5
        ? 'bg-yellow-100 text-yellow-800'
        : 'bg-red-100 text-red-800';

  const handleSaveEdit = () => {
    try {
      const parsed = JSON.parse(editValue);
      onValueChange(parsed);
      setIsEditing(false);
    } catch {
      // Invalid JSON, don't save
    }
  };

  const formatValue = (value: any): string => {
    if (value === null || value === undefined) return 'null';
    if (typeof value === 'object') return JSON.stringify(value, null, 2);
    return String(value);
  };

  return (
    <div
      className={`border rounded-lg p-4 transition-colors ${
        isSelected ? 'border-blue-500 bg-blue-50' : 'border-gray-200'
      }`}
    >
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={isSelected}
          onChange={onToggle}
          className="mt-1 h-4 w-4 text-blue-600 rounded"
        />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-gray-900">
              {suggestion.slug}
            </span>
            <span
              className={`px-2 py-0.5 text-xs font-medium rounded ${
                suggestion.operation === 'CREATE'
                  ? 'bg-green-100 text-green-800'
                  : 'bg-blue-100 text-blue-800'
              }`}
            >
              {suggestion.operation}
            </span>
            <span
              className={`px-2 py-0.5 text-xs font-medium rounded ${confidenceColor}`}
            >
              {Math.round(suggestion.confidence * 100)}% confidence
            </span>
            {suggestion.wasCorrected && (
              <span
                className="px-2 py-0.5 text-xs font-medium rounded bg-orange-100 text-orange-800"
                title="This suggestion was corrected by the server to match your current preferences"
              >
                Corrected
              </span>
            )}
          </div>

          {suggestion.description && (
            <p className="text-xs text-gray-500 mt-1">{suggestion.description}</p>
          )}

          {/* Value diff */}
          <div className="mt-2 space-y-1">
            {suggestion.operation === 'UPDATE' && suggestion.oldValue && (
              <div className="flex items-start gap-2 text-sm">
                <span className="text-gray-500 shrink-0">Old:</span>
                <pre className="bg-red-50 text-red-700 px-2 py-1 rounded text-xs overflow-x-auto max-w-full">
                  {formatValue(suggestion.oldValue)}
                </pre>
              </div>
            )}
            <div className="flex items-start gap-2 text-sm">
              <span className="text-gray-500 shrink-0">New:</span>
              {isEditing ? (
                <div className="flex-1">
                  <textarea
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    className="w-full px-2 py-1 border rounded text-xs font-mono h-20"
                  />
                  <div className="flex gap-2 mt-1">
                    <button
                      onClick={handleSaveEdit}
                      className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700"
                    >
                      Save
                    </button>
                    <button
                      onClick={() => {
                        setEditValue(JSON.stringify(suggestion.newValue, null, 2));
                        setIsEditing(false);
                      }}
                      className="px-2 py-1 text-xs bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-2">
                  <pre className="bg-green-50 text-green-700 px-2 py-1 rounded text-xs overflow-x-auto max-w-full">
                    {formatValue(suggestion.newValue)}
                  </pre>
                  <button
                    onClick={() => setIsEditing(true)}
                    className="text-xs text-blue-600 hover:text-blue-800"
                  >
                    Edit
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Source snippet */}
          <div className="mt-3 text-sm">
            <span className="text-gray-500">Source: </span>
            <span className="text-gray-600 italic">&quot;{suggestion.sourceSnippet}&quot;</span>
            {suggestion.sourceMeta?.page && (
              <span className="text-gray-400 ml-1">(page {suggestion.sourceMeta.page})</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
