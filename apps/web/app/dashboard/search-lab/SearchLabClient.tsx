'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { useMemo, useState } from 'react';
import {
  MatchedPreferenceDefinition,
  Preference,
  PreferenceDefinition,
  SmartSearchResult,
} from './types';

const GRAPHQL_ENDPOINT =
  process.env.NEXT_PUBLIC_GRAPHQL_URL || 'http://localhost:3000/graphql';

const SMART_SEARCH_QUERY = `
  query SmartSearchPreferences($input: SmartPreferenceSearchInput!) {
    smartSearchPreferences(input: $input) {
      queryInterpretation
      matchedDefinitions {
        slug
        description
        category
      }
      matchedActivePreferences {
        id
        userId
        slug
        definitionId
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
      matchedSuggestedPreferences {
        id
        userId
        slug
        definitionId
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
  }
`;

const EXAMPLE_SCENARIOS = [
  {
    label: 'Food',
    exact: 'food',
    smart: 'What does this person like to eat?',
  },
  {
    label: 'Conference',
    exact: 'food',
    smart: "I'm registering this person for a conference.",
  },
  {
    label: 'Flight',
    exact: 'travel',
    smart: "I'm booking a flight for this person.",
  },
  {
    label: 'Contact',
    exact: 'communication',
    smart: 'How should I contact this person?',
  },
];

interface SearchLabClientProps {
  initialActivePreferences: Preference[];
  initialSuggestedPreferences: Preference[];
  initialPreferenceDefinitions: PreferenceDefinition[];
  accessToken: string;
  loadError: string | null;
}

interface ExactResultRow {
  definition: MatchedPreferenceDefinition;
  activePreferences: Preference[];
  suggestedPreferences: Preference[];
}

async function graphQlRequest<T>(
  accessToken: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(GRAPHQL_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ query, variables }),
  });

  const payload = await response.json();
  if (!response.ok || payload.errors?.length) {
    throw new Error(payload.errors?.[0]?.message || 'GraphQL request failed');
  }

  return payload.data as T;
}

function normalize(value: string) {
  return value.trim().toLowerCase();
}

function categoryForSlug(slug: string) {
  return slug.split('.')[0] || 'unknown';
}

function formatValue(value: any) {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

function groupPreferencesBySlug(preferences: Preference[]) {
  return preferences.reduce((map, preference) => {
    const existing = map.get(preference.slug) || [];
    existing.push(preference);
    map.set(preference.slug, existing);
    return map;
  }, new Map<string, Preference[]>());
}

function toMatchedDefinition(
  definition: PreferenceDefinition | undefined,
  preference?: Preference,
): MatchedPreferenceDefinition {
  const slug = definition?.slug || preference?.slug || 'unknown';
  return {
    slug,
    description:
      definition?.description ||
      preference?.description ||
      'Stored preference value',
    category: definition?.category || preference?.category || categoryForSlug(slug),
  };
}

function Badge({
  children,
  tone = 'gray',
}: {
  children: ReactNode;
  tone?: 'gray' | 'blue' | 'green' | 'amber' | 'purple';
}) {
  const tones = {
    gray: 'bg-gray-100 text-gray-700',
    blue: 'bg-blue-100 text-blue-800',
    green: 'bg-green-100 text-green-800',
    amber: 'bg-amber-100 text-amber-800',
    purple: 'bg-purple-100 text-purple-800',
  };
  return (
    <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
}

function PreferenceValueRow({ preference }: { preference: Preference }) {
  const statusTone = preference.status === 'ACTIVE' ? 'green' : 'amber';
  return (
    <div className="rounded border border-gray-200 bg-white px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={statusTone}>{preference.status}</Badge>
        <Badge>{preference.sourceType}</Badge>
        {preference.confidence !== null && preference.confidence !== undefined && (
          <span className="text-xs text-gray-500">
            confidence {preference.confidence.toFixed(2)}
          </span>
        )}
      </div>
      <pre className="mt-2 whitespace-pre-wrap break-words text-sm text-gray-900">
        {formatValue(preference.value)}
      </pre>
    </div>
  );
}

function ResultRows({
  rows,
  emptyMessage,
}: {
  rows: ExactResultRow[];
  emptyMessage: string;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded border border-dashed border-gray-300 px-4 py-8 text-center text-sm text-gray-500">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="divide-y divide-gray-200 rounded border border-gray-200 bg-white">
      {rows.map((row) => {
        const hasValues =
          row.activePreferences.length > 0 ||
          row.suggestedPreferences.length > 0;

        return (
          <div key={row.definition.slug} className="p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="font-mono text-sm font-semibold text-gray-900">
                  {row.definition.slug}
                </div>
                <p className="mt-1 text-sm text-gray-600">
                  {row.definition.description}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge tone="blue">{row.definition.category}</Badge>
                {!hasValues && <Badge tone="purple">definition only</Badge>}
              </div>
            </div>

            {hasValues && (
              <div className="mt-3 space-y-2">
                {row.activePreferences.map((preference) => (
                  <PreferenceValueRow
                    key={preference.id}
                    preference={preference}
                  />
                ))}
                {row.suggestedPreferences.map((preference) => (
                  <PreferenceValueRow
                    key={preference.id}
                    preference={preference}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function StatLine({
  definitions,
  active,
  suggested,
}: {
  definitions: number;
  active: number;
  suggested: number;
}) {
  return (
    <div className="flex flex-wrap gap-2 text-sm">
      <Badge tone="blue">{definitions} definitions</Badge>
      <Badge tone="green">{active} active</Badge>
      <Badge tone="amber">{suggested} suggested</Badge>
    </div>
  );
}

export default function SearchLabClient({
  initialActivePreferences,
  initialSuggestedPreferences,
  initialPreferenceDefinitions,
  accessToken,
  loadError,
}: SearchLabClientProps) {
  const [exactQuery, setExactQuery] = useState('food');
  const [submittedExactQuery, setSubmittedExactQuery] = useState('food');
  const [smartQuery, setSmartQuery] = useState(
    "I'm registering this person for a conference.",
  );
  const [includeSuggestions, setIncludeSuggestions] = useState(true);
  const [locationId, setLocationId] = useState('');
  const [smartResult, setSmartResult] = useState<SmartSearchResult | null>(null);
  const [smartLoading, setSmartLoading] = useState(false);
  const [smartError, setSmartError] = useState<string | null>(null);

  const definitionBySlug = useMemo(
    () =>
      new Map(
        initialPreferenceDefinitions.map((definition) => [
          definition.slug,
          definition,
        ]),
      ),
    [initialPreferenceDefinitions],
  );

  const exactRows = useMemo(() => {
    const normalizedQuery = normalize(submittedExactQuery);
    const activeBySlug = groupPreferencesBySlug(initialActivePreferences);
    const suggestedBySlug = groupPreferencesBySlug(
      includeSuggestions ? initialSuggestedPreferences : [],
    );

    if (!normalizedQuery) {
      const slugs = new Set<string>();
      for (const preference of initialActivePreferences) {
        slugs.add(preference.slug);
      }
      if (includeSuggestions) {
        for (const preference of initialSuggestedPreferences) {
          slugs.add(preference.slug);
        }
      }

      return Array.from(slugs).map((slug) => ({
        definition: toMatchedDefinition(
          definitionBySlug.get(slug),
          activeBySlug.get(slug)?.[0] || suggestedBySlug.get(slug)?.[0],
        ),
        activePreferences: activeBySlug.get(slug) || [],
        suggestedPreferences: suggestedBySlug.get(slug) || [],
      }));
    }

    const matchedDefinitions = initialPreferenceDefinitions.filter(
      (definition) =>
        definition.slug.toLowerCase().startsWith(normalizedQuery) ||
        definition.category.toLowerCase().includes(normalizedQuery) ||
        definition.description.toLowerCase().includes(normalizedQuery),
    );

    return matchedDefinitions.map((definition) => ({
      definition: toMatchedDefinition(definition),
      activePreferences: activeBySlug.get(definition.slug) || [],
      suggestedPreferences: suggestedBySlug.get(definition.slug) || [],
    }));
  }, [
    definitionBySlug,
    includeSuggestions,
    initialActivePreferences,
    initialPreferenceDefinitions,
    initialSuggestedPreferences,
    submittedExactQuery,
  ]);

  const exactActiveCount = exactRows.reduce(
    (sum, row) => sum + row.activePreferences.length,
    0,
  );
  const exactSuggestedCount = exactRows.reduce(
    (sum, row) => sum + row.suggestedPreferences.length,
    0,
  );

  const smartRows = useMemo(() => {
    if (!smartResult) return [];
    const activeBySlug = groupPreferencesBySlug(
      smartResult.matchedActivePreferences,
    );
    const suggestedBySlug = groupPreferencesBySlug(
      smartResult.matchedSuggestedPreferences,
    );

    return smartResult.matchedDefinitions.map((definition) => ({
      definition,
      activePreferences: activeBySlug.get(definition.slug) || [],
      suggestedPreferences: suggestedBySlug.get(definition.slug) || [],
    }));
  }, [smartResult]);

  const runExact = () => {
    setSubmittedExactQuery(exactQuery);
  };

  const runSmart = async () => {
    const trimmedQuery = smartQuery.trim();
    if (!trimmedQuery) {
      setSmartError('Smart search query is required.');
      setSmartResult(null);
      return;
    }

    setSmartLoading(true);
    setSmartError(null);

    try {
      const data = await graphQlRequest<{
        smartSearchPreferences: SmartSearchResult;
      }>(accessToken, SMART_SEARCH_QUERY, {
        input: {
          query: trimmedQuery,
          includeSuggestions,
          ...(locationId.trim() ? { locationId: locationId.trim() } : {}),
        },
      });
      setSmartResult(data.smartSearchPreferences);
    } catch (error) {
      setSmartResult(null);
      setSmartError(
        error instanceof Error ? error.message : 'Smart search failed',
      );
    } finally {
      setSmartLoading(false);
    }
  };

  const runBoth = async () => {
    runExact();
    await runSmart();
  };

  const applyScenario = (scenario: (typeof EXAMPLE_SCENARIOS)[number]) => {
    setExactQuery(scenario.exact);
    setSubmittedExactQuery(scenario.exact);
    setSmartQuery(scenario.smart);
  };

  return (
    <div className="p-6 lg:p-10">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Search Lab</h1>
          <p className="mt-1 max-w-3xl text-sm text-gray-600">
            Compare literal slug/category matching against smart search over the
            same preference schema.
          </p>
        </div>
        <Link href="/dashboard" className="text-sm text-blue-600 hover:text-blue-800">
          Back to Dashboard
        </Link>
      </div>

      {loadError && (
        <div className="mb-6 rounded border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {loadError}
        </div>
      )}

      <div className="mb-6 rounded border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium text-gray-700">Examples</span>
          {EXAMPLE_SCENARIOS.map((scenario) => (
            <button
              key={scenario.label}
              type="button"
              onClick={() => applyScenario(scenario)}
              className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
            >
              {scenario.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-[1fr_auto] lg:items-end">
        <label className="text-sm">
          <span className="mb-1 block font-medium text-gray-700">
            Location ID for smart search
          </span>
          <input
            type="text"
            value={locationId}
            onChange={(event) => setLocationId(event.target.value)}
            placeholder="Optional location ID"
            className="w-full rounded border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </label>

        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={includeSuggestions}
              onChange={(event) => setIncludeSuggestions(event.target.checked)}
              className="h-4 w-4 rounded border-gray-300"
            />
            Include suggestions
          </label>
          <button
            type="button"
            onClick={runBoth}
            disabled={smartLoading}
            className="rounded bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:bg-gray-400"
          >
            {smartLoading ? 'Running...' : 'Run Both'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <section className="rounded border border-gray-200 bg-white p-5 shadow-sm">
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-gray-900">Exact Search</h2>
            <p className="mt-1 text-sm text-gray-600">
              Filters the loaded catalog by slug prefix, category, or
              description.
            </p>
          </div>

          <div className="mb-4 flex gap-2">
            <input
              type="text"
              value={exactQuery}
              onChange={(event) => setExactQuery(event.target.value)}
              placeholder="food, travel, communication, food.dietary_restrictions"
              className="min-w-0 flex-1 rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              type="button"
              onClick={runExact}
              className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              Run
            </button>
          </div>

          <div className="mb-4">
            <StatLine
              definitions={exactRows.length}
              active={exactActiveCount}
              suggested={exactSuggestedCount}
            />
          </div>

          <ResultRows
            rows={exactRows}
            emptyMessage="No exact matches in the loaded preference catalog."
          />
        </section>

        <section className="rounded border border-gray-200 bg-white p-5 shadow-sm">
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-gray-900">Smart Search</h2>
            <p className="mt-1 text-sm text-gray-600">
              Uses the backend workflow to map natural language to relevant
              preference slugs.
            </p>
          </div>

          <div className="mb-4 flex gap-2">
            <textarea
              value={smartQuery}
              onChange={(event) => setSmartQuery(event.target.value)}
              rows={3}
              placeholder="I'm registering this person for a conference."
              className="min-w-0 flex-1 rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              type="button"
              onClick={runSmart}
              disabled={smartLoading}
              className="self-start rounded bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:bg-gray-400"
            >
              {smartLoading ? 'Running...' : 'Run'}
            </button>
          </div>

          {smartError && (
            <div className="mb-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {smartError}
            </div>
          )}

          {smartResult ? (
            <>
              <div className="mb-4 rounded border border-green-200 bg-green-50 p-3">
                <div className="text-xs font-semibold uppercase text-green-800">
                  Query interpretation
                </div>
                <p className="mt-1 text-sm text-green-950">
                  {smartResult.queryInterpretation}
                </p>
              </div>

              <div className="mb-4">
                <StatLine
                  definitions={smartResult.matchedDefinitions.length}
                  active={smartResult.matchedActivePreferences.length}
                  suggested={smartResult.matchedSuggestedPreferences.length}
                />
              </div>

              <ResultRows
                rows={smartRows}
                emptyMessage="Smart search did not match any preference definitions."
              />
            </>
          ) : (
            <div className="rounded border border-dashed border-gray-300 px-4 py-8 text-center text-sm text-gray-500">
              Run smart search to see matched definitions and stored values.
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
