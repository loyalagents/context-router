'use client';

import { useState } from 'react';

interface Preference {
  id: string;
  slug: string;
  value: any;
  status: string;
  sourceType: string;
  confidence: number | null;
  locationId: string | null;
  category?: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
}

interface SuggestionInboxProps {
  suggestions: Preference[];
  accessToken: string;
  onAccept: (acceptedPref: Preference) => void;
  onReject: (id: string) => void;
}

const ACCEPT_SUGGESTION_MUTATION = `
  mutation AcceptSuggestedPreference($id: ID!) {
    acceptSuggestedPreference(id: $id) {
      id
      slug
      value
      status
      sourceType
      confidence
      locationId
      category
      description
      createdAt
      updatedAt
    }
  }
`;

const REJECT_SUGGESTION_MUTATION = `
  mutation RejectSuggestedPreference($id: ID!) {
    rejectSuggestedPreference(id: $id)
  }
`;

export default function SuggestionInbox({
  suggestions,
  accessToken,
  onAccept,
  onReject,
}: SuggestionInboxProps) {
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleAccept = async (suggestion: Preference) => {
    setError(null);
    setProcessingId(suggestion.id);

    try {
      const graphqlUrl = process.env.NEXT_PUBLIC_GRAPHQL_URL || 'http://localhost:3000/graphql';
      const response = await fetch(graphqlUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          query: ACCEPT_SUGGESTION_MUTATION,
          variables: { id: suggestion.id },
        }),
      });

      const data = await response.json();

      if (data.errors) {
        throw new Error(data.errors[0]?.message || 'Failed to accept suggestion');
      }

      onAccept(data.data.acceptSuggestedPreference);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to accept suggestion');
    } finally {
      setProcessingId(null);
    }
  };

  const handleReject = async (suggestion: Preference) => {
    setError(null);
    setProcessingId(suggestion.id);

    try {
      const graphqlUrl = process.env.NEXT_PUBLIC_GRAPHQL_URL || 'http://localhost:3000/graphql';
      const response = await fetch(graphqlUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          query: REJECT_SUGGESTION_MUTATION,
          variables: { id: suggestion.id },
        }),
      });

      const data = await response.json();

      if (data.errors) {
        throw new Error(data.errors[0]?.message || 'Failed to reject suggestion');
      }

      onReject(suggestion.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reject suggestion');
    } finally {
      setProcessingId(null);
    }
  };

  const confidenceColor = (confidence: number | null) => {
    if (confidence === null) return 'bg-gray-100 text-gray-800';
    if (confidence >= 0.8) return 'bg-green-100 text-green-800';
    if (confidence >= 0.5) return 'bg-yellow-100 text-yellow-800';
    return 'bg-red-100 text-red-800';
  };

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-lg shadow p-6 mb-6">
      <div className="flex items-center gap-2 mb-4">
        <svg className="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
        </svg>
        <h2 className="text-lg font-semibold text-amber-800">
          Suggestion Inbox ({suggestions.length})
        </h2>
      </div>
      <p className="text-amber-700 text-sm mb-4">
        AI agents have suggested these preferences for you. Review and accept or reject each one.
      </p>

      {error && (
        <div className="bg-red-100 border border-red-300 text-red-700 px-4 py-2 rounded mb-4">
          {error}
        </div>
      )}

      <div className="space-y-3">
        {suggestions.map((suggestion) => (
          <div
            key={suggestion.id}
            className="bg-white border border-amber-200 rounded-lg p-4"
          >
            <div className="flex items-start justify-between">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-gray-900">{suggestion.slug}</span>
                  {suggestion.confidence !== null && (
                    <span
                      className={`px-2 py-0.5 text-xs font-medium rounded ${confidenceColor(suggestion.confidence)}`}
                    >
                      {Math.round(suggestion.confidence * 100)}% confidence
                    </span>
                  )}
                  {suggestion.sourceType === 'INFERRED' && (
                    <span className="px-2 py-0.5 text-xs font-medium rounded bg-purple-100 text-purple-800">
                      AI Suggested
                    </span>
                  )}
                </div>
                {suggestion.description && (
                  <p className="text-sm text-gray-500 mt-1">{suggestion.description}</p>
                )}
                <pre className="text-sm text-gray-600 mt-2 bg-gray-50 px-2 py-1 rounded overflow-x-auto">
                  {JSON.stringify(suggestion.value, null, 2)}
                </pre>
              </div>

              <div className="flex gap-2 ml-4">
                <button
                  onClick={() => handleAccept(suggestion)}
                  disabled={processingId === suggestion.id}
                  className="px-3 py-1.5 text-sm bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
                  title="Accept this suggestion"
                >
                  {processingId === suggestion.id ? '...' : 'Accept'}
                </button>
                <button
                  onClick={() => handleReject(suggestion)}
                  disabled={processingId === suggestion.id}
                  className="px-3 py-1.5 text-sm bg-red-100 text-red-700 rounded hover:bg-red-200 disabled:opacity-50"
                  title="Reject this suggestion"
                >
                  {processingId === suggestion.id ? '...' : 'Reject'}
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
