'use client';

import { PermissionActivityRow, type PermissionActivityPage, type PermissionRevealState } from '@/components/local/SessionPermissionActivity';
import { authenticatedFetch, localJson } from '@/lib/authenticated-fetch';
import { ClientName } from '@/components/local/ClientNames';
import { useLocalSession } from '@/components/local/LocalSession';

import { gql } from '@apollo/client';
import { print } from 'graphql';
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { McpAccessHistoryForTabQuery } from '@/lib/generated/graphql';
import { GRAPHQL_URL } from '@/lib/runtime-config';

const GRAPHQL_ENDPOINT = GRAPHQL_URL;

const PAGE_SIZE = 20;

const MCP_ACCESS_HISTORY_QUERY = gql`
  query McpAccessHistoryForTab($input: McpAccessHistoryInput!) {
    mcpAccessHistory(input: $input) {
      hasNextPage
      nextCursor
      items {
        id
        occurredAt
        clientKey
        surface
        operationName
        outcome
        correlationId
        latencyMs
        requestMetadata
        responseMetadata
        errorMetadata
      }
    }
  }
`;

const MCP_ACCESS_HISTORY_QUERY_TEXT = print(MCP_ACCESS_HISTORY_QUERY);

const SURFACE_LABELS: Record<string, string> = {
  TOOLS_CALL: 'Tool call',
  RESOURCES_READ: 'Resource read',
};

const OUTCOME_LABELS: Record<string, string> = {
  SUCCESS: 'Success',
  DENY: 'Denied',
  ERROR: 'Error',
};

const SURFACE_OPTIONS = [
  { value: 'TOOLS_CALL', label: 'Tool call' },
  { value: 'RESOURCES_READ', label: 'Resource read' },
] as const;

const OUTCOME_OPTIONS = [
  { value: 'SUCCESS', label: 'Success' },
  { value: 'DENY', label: 'Denied' },
  { value: 'ERROR', label: 'Error' },
] as const;

const DEFAULT_FILTERS = {
  clientKey: '',
  surface: '',
  operationName: '',
  outcome: '',
  correlationId: '',
  occurredFrom: '',
  occurredTo: '',
};

type McpAccessHistoryPage = McpAccessHistoryForTabQuery['mcpAccessHistory'];
type McpAccessHistoryItem = McpAccessHistoryPage['items'][number];

interface McpAccessFilters {
  clientKey: string;
  surface: string;
  operationName: string;
  outcome: string;
  correlationId: string;
  occurredFrom: string;
  occurredTo: string;
}

interface McpAccessHistoryTabProps {
  accessToken: string;
  shouldLoad: boolean;
  invalidationSignal?: AbortSignal;
  clientFilter?: string;
  onClientFilterChange?: (value: string) => void;
  highlightChangeId?: string | null;
  permissionReveal?: RefObject<PermissionRevealState>;
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

function hasAnyFilter(filters: McpAccessFilters): boolean {
  return Object.values(filters).some((value) => value.trim().length > 0);
}

function sanitizeFilters(filters: McpAccessFilters) {
  return {
    clientKey: filters.clientKey.trim(),
    surface: filters.surface,
    operationName: filters.operationName.trim(),
    outcome: filters.outcome,
    correlationId: filters.correlationId.trim(),
    occurredFrom: filters.occurredFrom,
    occurredTo: filters.occurredTo,
  };
}

async function fetchMcpAccessHistory(
  accessToken: string,
  input: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<McpAccessHistoryPage> {
  const response = await authenticatedFetch(GRAPHQL_ENDPOINT, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      query: MCP_ACCESS_HISTORY_QUERY_TEXT,
      variables: { input },
    }),
  });

  const payload = await response.json();

  if (payload.errors?.length) {
    throw new Error(payload.errors[0].message || 'Failed to load MCP access history');
  }

  return payload.data.mcpAccessHistory as McpAccessHistoryPage;
}

export default function McpAccessHistoryTab({
  accessToken,
  shouldLoad,
  invalidationSignal,
  clientFilter,
  onClientFilterChange,
  highlightChangeId,
  permissionReveal,
}: McpAccessHistoryTabProps) {
  const demo = useLocalSession()?.capabilities.runtime?.mode === 'demo';
  const FilterContainer = demo ? 'details' : 'div';
  const [draftFilters, setDraftFilters] = useState<McpAccessFilters>({...DEFAULT_FILTERS, clientKey: clientFilter ?? ''});
  const [appliedFilters, setAppliedFilters] = useState<McpAccessFilters>({...DEFAULT_FILTERS, clientKey: clientFilter ?? ''});
  const [items, setItems] = useState<McpAccessHistoryItem[]>([]);
  const [permissionPage,setPermissionPage] = useState<PermissionActivityPage|null>(null);
  const [permissionError,setPermissionError] = useState(false);
  const [revealReady,setRevealReady] = useState(false);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoadingInitial, setIsLoadingInitial] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [browsingOlder,setBrowsingOlder]=useState(false);
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});
  const lastRequestRef = useRef<{ reset: boolean; cursor: string | null }>({
    reset: true,
    cursor: null,
  });
  const requestVersionRef = useRef(0);
  const pendingRef = useRef<AbortController | null>(null);
  const quietRequestRef = useRef<AbortController | null>(null);
  const priorClientFilter = useRef(clientFilter);
  const loadedFilters = useRef<string | null>(null);
  useEffect(() => () => { requestVersionRef.current++; pendingRef.current?.abort(); }, []);

  useEffect(() => {
    if (clientFilter === undefined || clientFilter === priorClientFilter.current) return;
    priorClientFilter.current = clientFilter;
    loadedFilters.current = null;
    requestVersionRef.current++; pendingRef.current?.abort();
    setItems([]); setPermissionPage(null); setPermissionError(false); setNextCursor(null); setHasNextPage(false); setExpandedIds({});
    setDraftFilters(previous => ({...previous, clientKey: clientFilter}));
    setAppliedFilters(previous => ({...previous, clientKey: clientFilter}));
  }, [clientFilter]);

  const sanitizedAppliedFilters = useMemo(
    () => sanitizeFilters(appliedFilters),
    [appliedFilters],
  );

  const activeFilterChips = useMemo(() => {
    const chips: Array<{ key: keyof McpAccessFilters; label: string; value: string }> = [];

    if (sanitizedAppliedFilters.clientKey) {
      chips.push({ key: 'clientKey', label: 'Client', value: sanitizedAppliedFilters.clientKey });
    }
    if (sanitizedAppliedFilters.surface) {
      chips.push({
        key: 'surface',
        label: 'Surface',
        value: SURFACE_LABELS[sanitizedAppliedFilters.surface] || sanitizedAppliedFilters.surface,
      });
    }
    if (sanitizedAppliedFilters.operationName) {
      chips.push({
        key: 'operationName',
        label: 'Operation',
        value: sanitizedAppliedFilters.operationName,
      });
    }
    if (sanitizedAppliedFilters.outcome) {
      chips.push({
        key: 'outcome',
        label: 'Outcome',
        value: OUTCOME_LABELS[sanitizedAppliedFilters.outcome] || sanitizedAppliedFilters.outcome,
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

  const loadHistory = useCallback(async (reset: boolean, cursor: string | null = null, quiet = false) => {
    if (!shouldLoad || (quiet && pendingRef.current)) return;
    if (!quiet) setBrowsingOlder(!reset);
    pendingRef.current?.abort();
    const controller = new AbortController(); pendingRef.current = controller;
    if(quiet)quietRequestRef.current=controller;
    const signal = invalidationSignal ? AbortSignal.any([invalidationSignal, controller.signal]) : controller.signal;
    const requestVersion = requestVersionRef.current + 1;
    requestVersionRef.current = requestVersion;
    lastRequestRef.current = { reset, cursor };

    if (!quiet) { if (reset) setIsLoadingInitial(true); else setIsLoadingMore(true); }

    const filterKey = JSON.stringify(sanitizedAppliedFilters);
    if (reset && loadedFilters.current !== filterKey) {
      setItems([]); setHasNextPage(false); setNextCursor(null); setExpandedIds({});
    }
    setError(null);
    setRevealReady(false);

    try {
      const input: Record<string, unknown> = {
        first: PAGE_SIZE,
      };

      if (cursor) {
        input.after = cursor;
      }
      if (sanitizedAppliedFilters.clientKey) {
        input.clientKey = sanitizedAppliedFilters.clientKey;
      }
      if (sanitizedAppliedFilters.surface) {
        input.surface = sanitizedAppliedFilters.surface;
      }
      if (sanitizedAppliedFilters.operationName) {
        input.operationName = sanitizedAppliedFilters.operationName;
      }
      if (sanitizedAppliedFilters.outcome) {
        input.outcome = sanitizedAppliedFilters.outcome;
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

      const [requests, permissions] = await Promise.allSettled([
        fetchMcpAccessHistory(accessToken, input, signal),
        demo ? localJson<PermissionActivityPage>('/api/local/mcp/changes', {}, signal) : Promise.resolve(null),
      ]);
      if (signal.aborted || requestVersion !== requestVersionRef.current) return;

      // Publish both streams in one render so pagination and linked-row reveal
      // use the settled request page, while either stream can fail independently.
      setPermissionPage(permissions.status === 'fulfilled' ? permissions.value : null);
      setPermissionError(permissions.status === 'rejected');
      if (requests.status === 'fulfilled') {
        const page = requests.value;
        loadedFilters.current = filterKey;
        setItems(previous => reset ? page.items : [...previous, ...page.items]);
        setHasNextPage(page.hasNextPage);
        setNextCursor(page.nextCursor ?? null);
      } else {
        setError(requests.reason instanceof Error ? requests.reason.message : 'Failed to load MCP access history.');
      }

      if (reset && !quiet && requests.status === 'fulfilled') {
        setExpandedIds(previous => Object.fromEntries(Object.entries(previous).filter(([key]) => key.startsWith('permission:'))));
      }
    } catch (loadError) {
      if (!signal.aborted && requestVersion === requestVersionRef.current) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : 'Failed to load MCP access history.',
        );
      }
    } finally {
      if(pendingRef.current===controller)pendingRef.current=null;
      if(quietRequestRef.current===controller)quietRequestRef.current=null;
      if (!signal.aborted && requestVersion === requestVersionRef.current) {
        setIsLoadingInitial(false);
        setIsLoadingMore(false);
        setRevealReady(true);
      }
    }
  }, [accessToken, sanitizedAppliedFilters, invalidationSignal, demo, shouldLoad]);

  useEffect(() => {
    if (!shouldLoad) {
      requestVersionRef.current++; pendingRef.current?.abort(); setRevealReady(false);
      return;
    }

    void loadHistory(true);
  }, [loadHistory, shouldLoad]);

  useEffect(()=>{
    if(!demo||!shouldLoad||browsingOlder||Object.values(expandedIds).some(Boolean)||JSON.stringify(draftFilters)!==JSON.stringify(appliedFilters))return;
    let stopped=false,timer:ReturnType<typeof setTimeout>;
    const poll=async()=>{if(document.visibilityState==='visible')await loadHistory(true,null,true);if(!stopped)timer=setTimeout(poll,3000);};
    timer=setTimeout(poll,3000);return()=>{stopped=true;clearTimeout(timer);quietRequestRef.current?.abort();};
  },[demo,shouldLoad,browsingOlder,expandedIds,draftFilters,appliedFilters,loadHistory]);

  const handleApplyFilters = () => {
    setAppliedFilters({ ...draftFilters });
    onClientFilterChange?.(draftFilters.clientKey.trim());
  };

  const handleResetFilters = () => {
    onClientFilterChange?.('');
    setDraftFilters(DEFAULT_FILTERS);
    setAppliedFilters(DEFAULT_FILTERS);
  };

  const handleRetry = () => {
    void loadHistory(lastRequestRef.current.reset, lastRequestRef.current.cursor);
  };

  const requestOnlyFilters = !!(sanitizedAppliedFilters.surface || sanitizedAppliedFilters.operationName || sanitizedAppliedFilters.outcome || sanitizedAppliedFilters.correlationId);
  const visibleChanges = demo && !requestOnlyFilters ? (permissionPage?.items ?? []).filter(event => {
    const time=Date.parse(event.occurredAt), oldest=items.at(-1)?.occurredAt;
    return (!sanitizedAppliedFilters.clientKey || event.clientKey===sanitizedAppliedFilters.clientKey)
      && (!sanitizedAppliedFilters.occurredFrom || time>=Date.parse(sanitizedAppliedFilters.occurredFrom))
      && (!sanitizedAppliedFilters.occurredTo || time<=Date.parse(sanitizedAppliedFilters.occurredTo))
      && (!hasNextPage || !oldest || time>=Date.parse(oldest) || event.id===highlightChangeId);
  }) : [];
  const rows = [
    ...items.map(item=>({kind:'request' as const,item})),
    ...visibleChanges.map(item=>({kind:'permission' as const,item})),
  ].sort((a,b)=>Date.parse(b.item.occurredAt)-Date.parse(a.item.occurredAt) || b.item.id.localeCompare(a.item.id));

  const permissionExpanded = useCallback((id:string,open:boolean)=>{
    const key='permission:'+id;
    setExpandedIds(previous=>previous[key]===open?previous:{...previous,[key]:open});
  },[]);
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
        <div>
          <h2 className="text-lg font-semibold">{demo ? 'Assistant access' : 'MCP Access'}</h2>
          <p className="text-sm text-gray-600 mt-1">
            {demo ? 'See dashboard permission changes and requests made by your assistants.' : 'Review request-level MCP tool and resource access by connected clients.'}
          </p>
        </div>

        {demo && <div className="mt-3 text-sm text-gray-600">
          <details><summary className="cursor-pointer">About this list</summary>
          <p>Up to 50 recent dashboard permission changes from this app session. They disappear when Context Router restarts; CLI changes are not recorded here.</p>
          <p>Ordered by recorded time. Requests already running may finish under earlier access.</p>
          </details>
          <button type="button" className="mt-2 underline" disabled={!shouldLoad || isLoadingInitial || isLoadingMore} onClick={() => void loadHistory(true)}>Refresh activity</button>
          {permissionPage?.truncated && <p>Older permission changes have been dropped from this session log.</p>}
          {requestOnlyFilters && <p>Permission changes are hidden while request-specific filters are active.</p>}
          {permissionError && <p role="status">Session permission changes could not load. Request history is shown separately; use Refresh to retry.</p>}
          {highlightChangeId && permissionPage && !permissionError && !permissionPage.items.some(event=>event.id===highlightChangeId && (!sanitizedAppliedFilters.clientKey || event.clientKey===sanitizedAppliedFilters.clientKey)) && <p role="status">This permission change is no longer available in this app session.</p>}
        </div>}
        <FilterContainer className={demo ? 'demo-activity-filters mt-3' : ''}>
        {demo && <summary>Filter activity</summary>}
        <div className="grid grid-cols-1 gap-4 mt-6 md:grid-cols-2 lg:grid-cols-4">
          <label className="text-sm">
            <span className="block font-medium text-gray-700 mb-1">Client key</span>
            <input
              value={draftFilters.clientKey}
              onChange={(event) =>
                setDraftFilters((previous) => ({
                  ...previous,
                  clientKey: event.target.value,
                }))
              }
              placeholder="codex"
              className="w-full border border-gray-300 rounded px-3 py-2"
            />
          </label>

          <label className="text-sm">
            <span className="block font-medium text-gray-700 mb-1">Operation</span>
            <input
              value={draftFilters.operationName}
              onChange={(event) =>
                setDraftFilters((previous) => ({
                  ...previous,
                  operationName: event.target.value,
                }))
              }
              placeholder="searchPreferences"
              className="w-full border border-gray-300 rounded px-3 py-2"
            />
          </label>

          <label className="text-sm">
            <span className="block font-medium text-gray-700 mb-1">Outcome</span>
            <select
              value={draftFilters.outcome}
              onChange={(event) =>
                setDraftFilters((previous) => ({
                  ...previous,
                  outcome: event.target.value,
                }))
              }
              className="w-full border border-gray-300 rounded px-3 py-2"
            >
              <option value="">All outcomes</option>
              {OUTCOME_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm">
            <span className="block font-medium text-gray-700 mb-1">Surface</span>
            <select
              value={draftFilters.surface}
              onChange={(event) =>
                setDraftFilters((previous) => ({
                  ...previous,
                  surface: event.target.value,
                }))
              }
              className="w-full border border-gray-300 rounded px-3 py-2"
            >
              <option value="">All surfaces</option>
              {SURFACE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm md:col-span-2">
            <span className="block font-medium text-gray-700 mb-1">
              Correlation ID
            </span>
            <input
              value={draftFilters.correlationId}
              onChange={(event) =>
                setDraftFilters((previous) => ({
                  ...previous,
                  correlationId: event.target.value,
                }))
              }
              placeholder="request correlation id"
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

        </FilterContainer>
        {activeFilterChips.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-4">
            {activeFilterChips.map((chip) => (
              <span
                key={`${chip.key}-${chip.value}`}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-gray-100 text-xs text-gray-700"
              >
                <span className="font-medium">{chip.label}:</span>
                {chip.key === 'clientKey' ? <ClientName clientKey={chip.value} fullId={!demo} showId={!demo} /> : <span>{chip.value}</span>}
                {chip.key === 'clientKey' && onClientFilterChange && <button type="button" aria-label="Remove client filter" className="underline ml-1" onClick={() => onClientFilterChange('')}>Remove</button>}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="bg-white rounded-lg shadow">
        {error && (
          <div className="border-b border-red-200 bg-red-50 px-6 py-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium text-red-700">
                Failed to load MCP access history.
              </p>
              <p className="text-sm text-red-600 mt-1">{error}</p>
              {items.length > 0 && <p className="mt-1 text-sm text-red-600">Previously loaded requests are shown.</p>}
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

        {isLoadingInitial && rows.length === 0 ? (
          <div className="p-6 space-y-3">
            {[0, 1, 2].map((index) => (
              <div
                key={index}
                className="h-20 rounded-lg border border-gray-200 bg-gray-50 animate-pulse"
              />
            ))}
          </div>
        ) : rows.length === 0 && (error || permissionError) ? null : rows.length === 0 ? (
          <div className="p-10 text-center text-gray-500">
            {demo ? (isFiltered ? 'No assistant activity matches these filters.' : 'No assistant activity yet. Change permissions or use your connected assistant, then return here.') : (isFiltered ? 'No MCP access events match the current filters.' : 'No MCP access history yet.')}
          </div>
        ) : (
          <div className="divide-y divide-gray-200">
            {rows.map((row) => {
              if (row.kind === 'permission') return <PermissionActivityRow key={'permission:'+row.item.id} event={row.item} onExpandedChange={permissionExpanded} highlight={row.item.id===highlightChangeId} active={shouldLoad && revealReady && !isLoadingInitial && !isLoadingMore} revealState={permissionReveal} olderThanLoaded={hasNextPage && !!items.at(-1) && Date.parse(row.item.occurredAt)<Date.parse(items.at(-1)!.occurredAt)} relativeTime={formatRelativeTimestamp(row.item.occurredAt)} absoluteTime={formatAbsoluteTimestamp(row.item.occurredAt)}/>;
              const item=row.item;
              const isExpanded = Boolean(expandedIds[item.id]);

              return (
                <div key={item.id} className="p-4 sm:p-6">
                  <button
                    type="button"
                    onClick={() => toggleExpanded(item.id)}
                    aria-expanded={isExpanded}
                    className="w-full text-left"
                  >
                    {demo ? <div className="demo-history-row">
                      <div><p><strong><ClientName clientKey={item.clientKey} showId={false}/></strong>{' '}
                        {item.outcome !== 'SUCCESS' && 'attempted to '}
                        {item.operationName === 'searchPreferences' || item.operationName === 'smartSearchPreferences' ? (item.outcome === 'SUCCESS' ? 'searched context' : 'search context') : item.operationName === 'listPreferenceSlugs' ? (item.outcome === 'SUCCESS' ? 'listed available context fields' : 'list available context fields') : item.operationName === 'mutatePreferences' ? (item.outcome === 'SUCCESS' ? 'requested a memory change' : 'request a memory change') : item.operationName}
                      </p><p className="demo-history-meta">
                        {(() => {
                          const metadata = item.responseMetadata;
                          if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata) || item.outcome !== 'SUCCESS') return null;
                          const key = item.operationName === 'searchPreferences' ? 'activeCount' : item.operationName === 'smartSearchPreferences' ? 'matchedActiveCount' : null;
                          const count = key ? (metadata as Record<string, unknown>)[key] : undefined;
                          return typeof count === 'number' && Number.isInteger(count) && count >= 0 ? <span>{count} {count === 1 ? 'memory' : 'memories'} returned · </span> : null;
                        })()}
                        <span title={formatAbsoluteTimestamp(item.occurredAt)}>{formatRelativeTimestamp(item.occurredAt)}</span>
                        {item.outcome !== 'SUCCESS' && <span className={item.outcome === 'DENY' ? 'text-amber-800' : 'text-red-700'}> · {OUTCOME_LABELS[item.outcome] || item.outcome}</span>}
                      </p></div><span className="demo-history-details">Details {isExpanded ? '▴' : '▾'}</span>
                    </div> : <>
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold text-gray-900">
                            {demo && item.operationName === 'searchPreferences' ? 'Searched context' : item.operationName}
                          </span>
                          <span className="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
                            {SURFACE_LABELS[item.surface] || item.surface}
                          </span>
                          <span
                            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                              item.outcome === 'SUCCESS'
                                ? 'bg-green-50 text-green-700'
                                : item.outcome === 'DENY'
                                  ? 'bg-amber-50 text-amber-700'
                                  : 'bg-red-50 text-red-700'
                            }`}
                          >
                            {OUTCOME_LABELS[item.outcome] || item.outcome}
                          </span>
                          <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
                            <ClientName clientKey={item.clientKey} />
                          </span>
                          <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                            {item.latencyMs}ms
                          </span>
                        </div>

                        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
                          <span title={new Date(item.occurredAt).toISOString()}>
                            {formatAbsoluteTimestamp(item.occurredAt)}
                          </span>
                          <span>{formatRelativeTimestamp(item.occurredAt)}</span>
                          {!demo && item.correlationId && (
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
                    </div>                    </>}
                  </button>

                  {isExpanded && (
                    <div className="mt-5 space-y-4">
                      <p className="text-xs break-all">Client key: <code>{item.clientKey || 'None'}</code></p>
                      {demo && <p className="text-xs break-all">Operation: {item.operationName} · {SURFACE_LABELS[item.surface] || item.surface} · {item.latencyMs}ms · {formatAbsoluteTimestamp(item.occurredAt)}{item.correlationId ? ` · Correlation ID: ${item.correlationId}` : ''}</p>}
                      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
                        <div className="rounded-lg border border-gray-200">
                          <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
                            <h3 className="text-sm font-semibold text-gray-800">
                              Request metadata
                            </h3>
                          </div>
                          <pre className="p-4 overflow-x-auto text-xs leading-5 font-mono text-gray-700 whitespace-pre-wrap break-words">
                            {formatJson(item.requestMetadata)}
                          </pre>
                        </div>

                        <div className="rounded-lg border border-gray-200">
                          <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
                            <h3 className="text-sm font-semibold text-gray-800">
                              Response metadata
                            </h3>
                          </div>
                          <pre className="p-4 overflow-x-auto text-xs leading-5 font-mono text-gray-700 whitespace-pre-wrap break-words">
                            {formatJson(item.responseMetadata)}
                          </pre>
                        </div>

                        <div className="rounded-lg border border-gray-200">
                          <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
                            <h3 className="text-sm font-semibold text-gray-800">
                              Error metadata
                            </h3>
                          </div>
                          <pre className="p-4 overflow-x-auto text-xs leading-5 font-mono text-gray-700 whitespace-pre-wrap break-words">
                            {formatJson(item.errorMetadata)}
                          </pre>
                        </div>
                      </div>
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
