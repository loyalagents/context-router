'use client';

import { useState } from 'react';
import { authenticatedFetch } from '@/lib/authenticated-fetch';
import { operationFailure } from '@/lib/local-upload';
import type {
  Preference,
  PreferenceDefinition,
} from '@/app/dashboard/preferences/types';
import { AiControls, useAiOperation } from './AiControls';

interface SearchResult {
  queryInterpretation: string;
  matchedDefinitions: { slug: string; description: string }[];
  matchedActivePreferences: Pick<Preference, 'id' | 'slug' | 'value'>[];
}
const query = /* GraphQL */ `
  query LocalSmartSearch($input: SmartPreferenceSearchInput!) {
    smartSearchPreferences(input: $input) {
      queryInterpretation
      matchedDefinitions {
        slug
        description
      }
      matchedActivePreferences {
        id
        slug
        value
      }
    }
  }
`;

export default function PreferenceSearch({
  preferences,
  definitions,
}: {
  preferences: Preference[];
  definitions: PreferenceDefinition[];
}) {
  const operation = useAiOperation('search');
  const [text, setText] = useState('');
  const [smart, setSmart] = useState<SearchResult | null>(null);
  const [error, setError] = useState('');
  const normalized = text.trim().toLowerCase();
  const literal = normalized
    ? preferences.filter((item) =>
        [
          item.slug,
          item.category,
          item.description,
          JSON.stringify(item.value),
        ].some((part) => part?.toLowerCase().includes(normalized)),
      )
    : [];
  const catalog = normalized
    ? definitions.filter((item) =>
        [item.slug, item.category, item.description].some((part) =>
          part.toLowerCase().includes(normalized),
        ),
      )
    : [];
  const search = async () => {
    if (!text.trim() || operation.pending || !operation.available) return;
    const request = operation.begin();
    setSmart(null);
    setError('');
    try {
      const response = await authenticatedFetch('/graphql', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...request.headers },
        signal: request.signal,
        body: JSON.stringify({
          query,
          variables: {
            input: { query: text.trim(), includeSuggestions: false },
          },
        }),
      });
      const payload = await response.json();
      if (!response.ok || payload.errors?.length) {
        const message = payload.errors?.[0]?.message ?? '';
        throw new Error(
          /local model busy/i.test(message)
            ? 'The local model is busy. Wait for the current operation to finish.'
            : /deadline/i.test(message)
              ? 'Smart search reached its deadline.'
              : 'Smart search is unavailable. Check model status.',
        );
      }
      request.signal.throwIfAborted();
      if (operation.isCurrent(request.controller))
        setSmart(payload.data.smartSearchPreferences);
    } catch (cause) {
      if (operation.isCurrent(request.controller))
        setError(operationFailure(cause, request.signal));
    } finally {
      operation.finish(request.controller);
    }
  };
  if (!operation.session) return null;
  return (
    <section
      className="bg-white rounded-lg shadow p-6 mb-6 space-y-3"
      aria-label="Preference search"
    >
      <h2 className="text-lg font-semibold">Search preferences</h2>
      <label className="block">
        Search query{' '}
        <input
          aria-label="Search query"
          value={text}
          maxLength={4000}
          onChange={(e) => {
            operation.cancel();
            setText(e.target.value);
            setSmart(null);
            setError('');
          }}
          className="block w-full border rounded p-2"
        />
      </label>
      <p className="text-sm">
        Literal search checks your loaded preferences and schema without AI.
        Smart search uses the local model to match a task to stored preferences.
      </p>
      <button
        type="button"
        disabled={!operation.available || operation.pending || !text.trim()}
        onClick={search}
        className="bg-blue-600 text-white rounded px-4 py-2 disabled:bg-gray-400"
      >
        Smart search
      </button>
      <AiControls
        operation={operation}
        onCancel={() => {
          setSmart(null);
          setError('Smart search cancelled.');
        }}
      />
      {normalized && (
        <div aria-label="Literal search results">
          <h3 className="font-medium">
            Literal results: {literal.length} preferences, {catalog.length}{' '}
            definitions
          </h3>
          <ul>
            {literal.map((item) => (
              <li key={item.id}>
                <code>{item.slug}</code>: {JSON.stringify(item.value)}
              </li>
            ))}
          </ul>
          <details>
            <summary>Matching definitions</summary>
            <ul>
              {catalog.map((item) => (
                <li key={item.id}>
                  <code>{item.slug}</code>: {item.description}
                </li>
              ))}
            </ul>
          </details>
        </div>
      )}
      {smart && (
        <div aria-label="Smart search results">
          <h3 className="font-medium">Smart results</h3>
          <p>{smart.queryInterpretation}</p>
          <ul>
            {smart.matchedActivePreferences.map((item) => (
              <li key={item.id}>
                <code>{item.slug}</code>: {JSON.stringify(item.value)}
              </li>
            ))}
          </ul>
          {smart.matchedActivePreferences.length === 0 && (
            <p>No stored preference matched.</p>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
    </section>
  );
}
