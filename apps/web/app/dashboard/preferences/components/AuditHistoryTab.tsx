'use client';

import { gql } from '@apollo/client';
import { print } from 'graphql';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PreferenceAuditHistoryForTabQuery } from '@/lib/generated/graphql';

const GRAPHQL_ENDPOINT =
  process.env.NEXT_PUBLIC_GRAPHQL_URL || 'http://localhost:3000/graphql';

const PAGE_SIZE = 20;

const AUDIT_HISTORY_QUERY = gql`
  query PreferenceAuditHistoryForTab($input: PreferenceAuditHistoryInput!) {
    preferenceAuditHistory(input: $input) {
      hasNextPage
      nextCursor
      items {
        id
        occurredAt
        subjectSlug
        targetType
        targetId
        eventType
        actorType
        actorClientKey
        origin
        correlationId
        beforeState
        afterState
        metadata
      }
    }
  }
`;

const AUDIT_HISTORY_QUERY_TEXT = print(AUDIT_HISTORY_QUERY);

const EVENT_LABELS: Record<string, string> = {
  PREFERENCE_SET: 'Preference set',
  PREFERENCE_SUGGESTED_UPSERTED: 'Suggestion created',
  PREFERENCE_SUGGESTION_ACCEPTED: 'Suggestion accepted',
  PREFERENCE_SUGGESTION_REJECTED: 'Suggestion rejected',
  PREFERENCE_DELETED: 'Preference deleted',
  DEFINITION_CREATED: 'Definition created',
  DEFINITION_UPDATED: 'Definition updated',
  DEFINITION_ARCHIVED: 'Definition archived',
};

const TARGET_TYPE_LABELS: Record<string, string> = {
  PREFERENCE: 'Preference',
  PREFERENCE_DEFINITION: 'Definition',
};

const ORIGIN_LABELS: Record<string, string> = {
  GRAPHQL: 'GraphQL',
  MCP: 'MCP',
  DOCUMENT_ANALYSIS: 'Document analysis',
  WORKFLOW: 'Workflow',
  SYSTEM: 'System',
};

const ACTOR_TYPE_LABELS: Record<string, string> = {
  USER: 'User',
  MCP_CLIENT: 'MCP client',
  SYSTEM: 'System',
  WORKFLOW: 'Workflow',
  IMPORT: 'Import',
};

const EVENT_TYPE_OPTIONS = [
  { value: 'PREFERENCE_SET', label: 'Preference set' },
  { value: 'PREFERENCE_SUGGESTED_UPSERTED', label: 'Suggestion created' },
  { value: 'PREFERENCE_SUGGESTION_ACCEPTED', label: 'Suggestion accepted' },
  { value: 'PREFERENCE_SUGGESTION_REJECTED', label: 'Suggestion rejected' },
  { value: 'PREFERENCE_DELETED', label: 'Preference deleted' },
  { value: 'DEFINITION_CREATED', label: 'Definition created' },
  { value: 'DEFINITION_UPDATED', label: 'Definition updated' },
  { value: 'DEFINITION_ARCHIVED', label: 'Definition archived' },
] as const;

const TARGET_TYPE_OPTIONS = [
  { value: 'PREFERENCE', label: 'Preference' },
  { value: 'PREFERENCE_DEFINITION', label: 'Definition' },
] as const;

const ORIGIN_OPTIONS = [
  { value: 'GRAPHQL', label: 'GraphQL' },
  { value: 'MCP', label: 'MCP' },
  { value: 'DOCUMENT_ANALYSIS', label: 'Document analysis' },
  { value: 'WORKFLOW', label: 'Workflow' },
  { value: 'SYSTEM', label: 'System' },
] as const;

const DEFAULT_FILTERS = {
  subjectSlug: '',
  eventType: '',
  targetType: '',
  origin: '',
  actorClientKey: '',
  correlationId: '',
  occurredFrom: '',
  occurredTo: '',
};

type AuditHistoryPage = PreferenceAuditHistoryForTabQuery['preferenceAuditHistory'];
type AuditHistoryItem = AuditHistoryPage['items'][number];

interface HistoryFilters {
  subjectSlug: string;
  eventType: string;
  targetType: string;
  origin: string;
  actorClientKey: string;
  correlationId: string;
  occurredFrom: string;
  occurredTo: string;
}

interface AuditHistoryTabProps {
  accessToken: string;
  preferenceDefinitions: Array<{
    slug: string;
    isSensitive: boolean;
  }>;
  shouldLoad: boolean;
}

function formatAbsoluteTimestamp(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(value));
}

function formatRelativeTimestamp(value: string): string {
  const deltaMs = new Date(value).getTime() - Date.now();
  const absMs = Math.abs(deltaMs);

  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['day', 24 * 60 * 60 * 1000],
    ['hour', 60 * 60 * 1000],
    ['minute', 60 * 1000],
    ['second', 1000],
  ];

  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

  for (const [unit, size] of units) {
    if (absMs >= size || unit === 'second') {
      return formatter.format(Math.round(deltaMs / size), unit);
    }
  }

  return formatter.format(0, 'second');
}

function formatJson(value: unknown): string {
  if (value == null) {
    return 'None';
  }

  return JSON.stringify(value, null, 2);
}

function hasAnyFilter(filters: HistoryFilters): boolean {
  return Object.values(filters).some((value) => value.trim().length > 0);
}

function sanitizeFilters(filters: HistoryFilters) {
  return {
    subjectSlug: filters.subjectSlug.trim(),
    eventType: filters.eventType,
    targetType: filters.targetType,
    origin: filters.origin,
    actorClientKey: filters.actorClientKey.trim(),
    correlationId: filters.correlationId.trim(),
    occurredFrom: filters.occurredFrom,
    occurredTo: filters.occurredTo,
  };
}

async function fetchAuditHistory(
  accessToken: string,
  input: Record<string, unknown>,
): Promise<AuditHistoryPage> {
  // Keep this request fetch-based to match the existing preferences-area convention,
  // even though this component lives inside ApolloNextAppProvider.
  const response = await fetch(GRAPHQL_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      query: AUDIT_HISTORY_QUERY_TEXT,
      variables: { input },
    }),
  });

  const payload = await response.json();

  if (payload.errors?.length) {
    throw new Error(payload.errors[0].message || 'Failed to load audit history');
  }

  return payload.data.preferenceAuditHistory as AuditHistoryPage;
}

export default function AuditHistoryTab({
  accessToken,
  preferenceDefinitions,
  shouldLoad,
}: AuditHistoryTabProps) {
  const [draftFilters, setDraftFilters] = useState<HistoryFilters>(DEFAULT_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState<HistoryFilters>(DEFAULT_FILTERS);
  const [items, setItems] = useState<AuditHistoryItem[]>([]);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoadingInitial, setIsLoadingInitial] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});
  const [showMoreFilters, setShowMoreFilters] = useState(false);
  const [showSensitiveValues, setShowSensitiveValues] = useState(false);
  const lastRequestRef = useRef<{ reset: boolean; cursor: string | null }>({
    reset: true,
    cursor: null,
  });
  const requestVersionRef = useRef(0);

  const sanitizedAppliedFilters = useMemo(
    () => sanitizeFilters(appliedFilters),
    [appliedFilters],
  );

  const sensitiveSlugs = useMemo(() => {
    return new Set(
      preferenceDefinitions
        .filter((definition) => definition.isSensitive)
        .map((definition) => definition.slug),
    );
  }, [preferenceDefinitions]);

  const activeFilterChips = useMemo(() => {
    const chips: Array<{ key: keyof HistoryFilters; label: string; value: string }> = [];

    if (sanitizedAppliedFilters.subjectSlug) {
      chips.push({
        key: 'subjectSlug',
        label: 'Slug',
        value: sanitizedAppliedFilters.subjectSlug,
      });
    }
    if (sanitizedAppliedFilters.eventType) {
      chips.push({
        key: 'eventType',
        label: 'Event',
        value:
          EVENT_LABELS[sanitizedAppliedFilters.eventType] || sanitizedAppliedFilters.eventType,
      });
    }
    if (sanitizedAppliedFilters.targetType) {
      chips.push({
        key: 'targetType',
        label: 'Target',
        value:
          TARGET_TYPE_LABELS[sanitizedAppliedFilters.targetType] ||
          sanitizedAppliedFilters.targetType,
      });
    }
    if (sanitizedAppliedFilters.origin) {
      chips.push({
        key: 'origin',
        label: 'Origin',
        value: ORIGIN_LABELS[sanitizedAppliedFilters.origin] || sanitizedAppliedFilters.origin,
      });
    }
    if (sanitizedAppliedFilters.actorClientKey) {
      chips.push({
        key: 'actorClientKey',
        label: 'Actor client',
        value: sanitizedAppliedFilters.actorClientKey,
      });
    }
    if (sanitizedAppliedFilters.correlationId) {
      chips.push({
        key: 'correlationId',
        label: 'Correlation ID',
        value: sanitizedAppliedFilters.correlationId,
      });
    }
    if (sanitizedAppliedFilters.occurredFrom) {
      chips.push({
        key: 'occurredFrom',
        label: 'From',
        value: sanitizedAppliedFilters.occurredFrom.replace('T', ' '),
      });
    }
    if (sanitizedAppliedFilters.occurredTo) {
      chips.push({
        key: 'occurredTo',
        label: 'To',
        value: sanitizedAppliedFilters.occurredTo.replace('T', ' '),
      });
    }

    return chips;
  }, [sanitizedAppliedFilters]);

  const loadHistory = useCallback(async (reset: boolean, cursor: string | null = null) => {
    const requestVersion = requestVersionRef.current + 1;
    requestVersionRef.current = requestVersion;
    lastRequestRef.current = { reset, cursor };

    if (reset) {
      setIsLoadingInitial(true);
    } else {
      setIsLoadingMore(true);
    }

    setError(null);

    try {
      const input: Record<string, unknown> = {
        first: PAGE_SIZE,
      };

      if (cursor) {
        input.after = cursor;
      }
      if (sanitizedAppliedFilters.subjectSlug) {
        input.subjectSlug = sanitizedAppliedFilters.subjectSlug;
      }
      if (sanitizedAppliedFilters.eventType) {
        input.eventType = sanitizedAppliedFilters.eventType;
      }
      if (sanitizedAppliedFilters.targetType) {
        input.targetType = sanitizedAppliedFilters.targetType;
      }
      if (sanitizedAppliedFilters.origin) {
        input.origin = sanitizedAppliedFilters.origin;
      }
      if (sanitizedAppliedFilters.actorClientKey) {
        input.actorClientKey = sanitizedAppliedFilters.actorClientKey;
      }
      if (sanitizedAppliedFilters.correlationId) {
        input.correlationId = sanitizedAppliedFilters.correlationId;
      }
      if (sanitizedAppliedFilters.occurredFrom) {
        input.occurredFrom = new Date(sanitizedAppliedFilters.occurredFrom).toISOString();
      }
      if (sanitizedAppliedFilters.occurredTo) {
        input.occurredTo = new Date(sanitizedAppliedFilters.occurredTo).toISOString();
      }

      const page = await fetchAuditHistory(accessToken, input);

      if (requestVersion !== requestVersionRef.current) {
        return;
      }

      setItems((previous) =>
        reset ? page.items : [...previous, ...page.items],
      );
      setHasNextPage(page.hasNextPage);
      setNextCursor(page.nextCursor ?? null);

      if (reset) {
        setExpandedIds({});
      }
    } catch (loadError) {
      if (requestVersion === requestVersionRef.current) {
        setError(
          loadError instanceof Error ? loadError.message : 'Failed to load audit history.',
        );
      }
    } finally {
      if (requestVersion === requestVersionRef.current) {
        setIsLoadingInitial(false);
        setIsLoadingMore(false);
      }
    }
  }, [accessToken, sanitizedAppliedFilters]);

  useEffect(() => {
    if (!shouldLoad) {
      return;
    }

    void loadHistory(true);
  }, [loadHistory, shouldLoad]);

  const handleApplyFilters = () => {
    setAppliedFilters({ ...draftFilters });
  };

  const handleResetFilters = () => {
    setDraftFilters(DEFAULT_FILTERS);
    setAppliedFilters(DEFAULT_FILTERS);
    setShowMoreFilters(false);
  };

  const handleRetry = () => {
    void loadHistory(lastRequestRef.current.reset, lastRequestRef.current.cursor);
  };

  const toggleExpanded = (id: string) => {
    setExpandedIds((previous) => ({
      ...previous,
      [id]: !previous[id],
    }));
  };

  const isFiltered = hasAnyFilter(sanitizedAppliedFilters);

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-lg font-semibold">Audit History</h2>
            <p className="text-sm text-gray-600 mt-1">
              Review the append-only history of preference and definition changes.
            </p>
          </div>

          <label className="inline-flex items-center gap-3 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={showSensitiveValues}
              onChange={(event) => setShowSensitiveValues(event.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            Show sensitive values
          </label>
        </div>

        <div className="grid grid-cols-1 gap-4 mt-6 md:grid-cols-3">
          <label className="text-sm">
            <span className="block font-medium text-gray-700 mb-1">Slug</span>
            <input
              value={draftFilters.subjectSlug}
              onChange={(event) =>
                setDraftFilters((previous) => ({
                  ...previous,
                  subjectSlug: event.target.value,
                }))
              }
              placeholder="food.dietary_restrictions"
              className="w-full border border-gray-300 rounded px-3 py-2"
            />
          </label>

          <label className="text-sm">
            <span className="block font-medium text-gray-700 mb-1">Event type</span>
            <select
              value={draftFilters.eventType}
              onChange={(event) =>
                setDraftFilters((previous) => ({
                  ...previous,
                  eventType: event.target.value,
                }))
              }
              className="w-full border border-gray-300 rounded px-3 py-2"
            >
              <option value="">All event types</option>
              {EVENT_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm">
            <span className="block font-medium text-gray-700 mb-1">Target type</span>
            <select
              value={draftFilters.targetType}
              onChange={(event) =>
                setDraftFilters((previous) => ({
                  ...previous,
                  targetType: event.target.value,
                }))
              }
              className="w-full border border-gray-300 rounded px-3 py-2"
            >
              <option value="">All target types</option>
              {TARGET_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-4">
          <button
            type="button"
            onClick={() => setShowMoreFilters((previous) => !previous)}
            className="text-sm font-medium text-blue-600 hover:text-blue-700"
          >
            {showMoreFilters ? 'Hide more filters' : 'More filters'}
          </button>
        </div>

        {showMoreFilters && (
          <div className="grid grid-cols-1 gap-4 mt-4 md:grid-cols-2 lg:grid-cols-3">
            <label className="text-sm">
              <span className="block font-medium text-gray-700 mb-1">Origin</span>
              <select
                value={draftFilters.origin}
                onChange={(event) =>
                  setDraftFilters((previous) => ({
                    ...previous,
                    origin: event.target.value,
                  }))
                }
                className="w-full border border-gray-300 rounded px-3 py-2"
              >
                <option value="">All origins</option>
                {ORIGIN_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-sm">
              <span className="block font-medium text-gray-700 mb-1">Actor client key</span>
              <input
                value={draftFilters.actorClientKey}
                onChange={(event) =>
                  setDraftFilters((previous) => ({
                    ...previous,
                    actorClientKey: event.target.value,
                  }))
                }
                placeholder="codex"
                className="w-full border border-gray-300 rounded px-3 py-2"
              />
            </label>

            <label className="text-sm">
              <span className="block font-medium text-gray-700 mb-1">
                Correlation ID (groups events from one operation)
              </span>
              <input
                value={draftFilters.correlationId}
                onChange={(event) =>
                  setDraftFilters((previous) => ({
                    ...previous,
                    correlationId: event.target.value,
                  }))
                }
                placeholder="analysis-2"
                className="w-full border border-gray-300 rounded px-3 py-2"
              />
            </label>

            <label className="text-sm">
              <span className="block font-medium text-gray-700 mb-1">Occurred from</span>
              <input
                type="datetime-local"
                value={draftFilters.occurredFrom}
                onChange={(event) =>
                  setDraftFilters((previous) => ({
                    ...previous,
                    occurredFrom: event.target.value,
                  }))
                }
                className="w-full border border-gray-300 rounded px-3 py-2"
              />
            </label>

            <label className="text-sm">
              <span className="block font-medium text-gray-700 mb-1">Occurred to</span>
              <input
                type="datetime-local"
                value={draftFilters.occurredTo}
                onChange={(event) =>
                  setDraftFilters((previous) => ({
                    ...previous,
                    occurredTo: event.target.value,
                  }))
                }
                className="w-full border border-gray-300 rounded px-3 py-2"
              />
            </label>
          </div>
        )}

        <div className="flex flex-wrap gap-3 mt-6">
          <button
            type="button"
            onClick={handleApplyFilters}
            disabled={!shouldLoad || isLoadingInitial || isLoadingMore}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            Apply
          </button>
          <button
            type="button"
            onClick={handleResetFilters}
            disabled={!shouldLoad || isLoadingInitial || isLoadingMore}
            className="px-4 py-2 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200 disabled:opacity-50"
          >
            Reset
          </button>
        </div>

        {activeFilterChips.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-4">
            {activeFilterChips.map((chip) => (
              <span
                key={`${chip.key}-${chip.value}`}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-gray-100 text-xs text-gray-700"
              >
                <span className="font-medium">{chip.label}:</span>
                <span>{chip.value}</span>
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="bg-white rounded-lg shadow">
        {error && (
          <div className="border-b border-red-200 bg-red-50 px-6 py-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium text-red-700">Failed to load audit history.</p>
              <p className="text-sm text-red-600 mt-1">{error}</p>
            </div>
            <button
              type="button"
              onClick={handleRetry}
              className="px-4 py-2 text-sm bg-white text-red-700 border border-red-200 rounded hover:bg-red-100"
            >
              Retry
            </button>
          </div>
        )}

        {isLoadingInitial && items.length === 0 ? (
          <div className="p-6 space-y-3">
            {[0, 1, 2].map((index) => (
              <div
                key={index}
                className="h-20 rounded-lg border border-gray-200 bg-gray-50 animate-pulse"
              />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="p-10 text-center text-gray-500">
            {isFiltered ? 'No events match the current filters.' : 'No audit history yet.'}
          </div>
        ) : (
          <div className="divide-y divide-gray-200">
            {items.map((item) => {
              const isExpanded = Boolean(expandedIds[item.id]);
              const isSensitive = sensitiveSlugs.has(item.subjectSlug);

              return (
                <div key={item.id} className="p-4 sm:p-6">
                  <button
                    type="button"
                    onClick={() => toggleExpanded(item.id)}
                    className="w-full text-left"
                  >
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold text-gray-900">
                            {EVENT_LABELS[item.eventType] || item.eventType}
                          </span>
                          <span className="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
                            {TARGET_TYPE_LABELS[item.targetType] || item.targetType}
                          </span>
                          <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
                            {ORIGIN_LABELS[item.origin] || item.origin}
                          </span>
                          <span className="inline-flex items-center rounded-full bg-purple-50 px-2 py-0.5 text-xs font-medium text-purple-700">
                            {item.actorClientKey ||
                              ACTOR_TYPE_LABELS[item.actorType] ||
                              item.actorType}
                          </span>
                          {isSensitive && !showSensitiveValues && (
                            <span className="inline-flex items-center rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">
                              Sensitive
                            </span>
                          )}
                        </div>

                        <div className="mt-2 text-sm text-gray-800 break-all">
                          <code className="font-mono">{item.subjectSlug}</code>
                        </div>

                        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
                          <span title={new Date(item.occurredAt).toISOString()}>
                            {formatAbsoluteTimestamp(item.occurredAt)}
                          </span>
                          <span>{formatRelativeTimestamp(item.occurredAt)}</span>
                          {item.correlationId && (
                            <span className="break-all">
                              Correlation ID: {item.correlationId}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="text-gray-400 self-start">
                        <svg
                          className={`w-5 h-5 transition-transform ${
                            isExpanded ? 'rotate-180' : ''
                          }`}
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M19 9l-7 7-7-7"
                          />
                        </svg>
                      </div>
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="mt-5 space-y-4">
                      {isSensitive && !showSensitiveValues ? (
                        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                          This event references a live sensitive definition. Turn on “Show
                          sensitive values” to view stored payload details.
                        </div>
                      ) : (
                        <>
                          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                            <div className="rounded-lg border border-gray-200">
                              <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
                                <h3 className="text-sm font-semibold text-gray-800">
                                  Before state
                                </h3>
                              </div>
                              <pre className="p-4 overflow-x-auto text-xs leading-5 font-mono text-gray-700 whitespace-pre-wrap break-words">
                                {formatJson(item.beforeState)}
                              </pre>
                            </div>

                            <div className="rounded-lg border border-gray-200">
                              <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
                                <h3 className="text-sm font-semibold text-gray-800">
                                  After state
                                </h3>
                              </div>
                              <pre className="p-4 overflow-x-auto text-xs leading-5 font-mono text-gray-700 whitespace-pre-wrap break-words">
                                {formatJson(item.afterState)}
                              </pre>
                            </div>
                          </div>

                          <div className="rounded-lg border border-gray-200">
                            <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
                              <h3 className="text-sm font-semibold text-gray-800">Metadata</h3>
                            </div>
                            <pre className="p-4 overflow-x-auto text-xs leading-5 font-mono text-gray-700 whitespace-pre-wrap break-words">
                              {formatJson(item.metadata)}
                            </pre>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {items.length > 0 && hasNextPage && (
          <div className="px-6 py-4 border-t border-gray-200">
            <button
              type="button"
              onClick={() => void loadHistory(false, nextCursor)}
              disabled={isLoadingInitial || isLoadingMore}
              className="px-4 py-2 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200 disabled:opacity-50"
            >
              {isLoadingMore ? 'Loading...' : 'Load more'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
