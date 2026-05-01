'use client';

import { useState } from 'react';

type ResetMemoryMode = 'MEMORY_ONLY' | 'DEMO_DATA' | 'FULL_USER_DATA';

interface MemoryResetPanelProps {
  accessToken: string;
  allowDemoReset: boolean;
}

interface ResetResult {
  mode: ResetMemoryMode;
  preferencesDeleted: number;
  preferenceDefinitionsDeleted: number;
  locationsDeleted: number;
  preferenceAuditEventsDeleted: number;
  mcpAccessEventsDeleted: number;
  permissionGrantsDeleted: number;
}

interface ResetOption {
  mode: ResetMemoryMode;
  label: string;
  tone: 'normal' | 'warning' | 'danger';
  confirmation: string;
}

const RESET_MY_MEMORY_MUTATION = `
  mutation ResetMyMemory($mode: ResetMemoryMode!) {
    resetMyMemory(mode: $mode) {
      mode
      preferencesDeleted
      preferenceDefinitionsDeleted
      locationsDeleted
      preferenceAuditEventsDeleted
      mcpAccessEventsDeleted
      permissionGrantsDeleted
    }
  }
`;

const RESET_OPTIONS: ResetOption[] = [
  {
    mode: 'MEMORY_ONLY',
    label: 'Reset Preferences',
    tone: 'normal',
    confirmation:
      'Reset your active preferences and pending/rejected suggestions? This cannot be undone.',
  },
  {
    mode: 'DEMO_DATA',
    label: 'Reset Demo Data',
    tone: 'warning',
    confirmation:
      'Reset your demo data, including preferences, locations, user-owned schema, audit history, and MCP logs? This cannot be undone.',
  },
  {
    mode: 'FULL_USER_DATA',
    label: 'Full User Data Reset',
    tone: 'danger',
    confirmation:
      'Reset all app-owned data for this user, including permission grants? Your login and profile will remain. This cannot be undone.',
  },
];

function buttonClass(tone: ResetOption['tone']): string {
  if (tone === 'danger') {
    return 'bg-red-700 text-white hover:bg-red-800 disabled:bg-red-300';
  }

  if (tone === 'warning') {
    return 'bg-amber-600 text-white hover:bg-amber-700 disabled:bg-amber-300';
  }

  return 'bg-red-600 text-white hover:bg-red-700 disabled:bg-red-300';
}

function formatResult(result: ResetResult): string {
  const counts = [
    ['preferences', result.preferencesDeleted],
    ['definitions', result.preferenceDefinitionsDeleted],
    ['locations', result.locationsDeleted],
    ['audit events', result.preferenceAuditEventsDeleted],
    ['MCP logs', result.mcpAccessEventsDeleted],
    ['permission grants', result.permissionGrantsDeleted],
  ]
    .filter(([, count]) => Number(count) > 0)
    .map(([label, count]) => `${count} ${label}`);

  return counts.length > 0 ? counts.join(', ') : 'No rows deleted';
}

export default function MemoryResetPanel({
  accessToken,
  allowDemoReset,
}: MemoryResetPanelProps) {
  const [processingMode, setProcessingMode] = useState<ResetMemoryMode | null>(
    null,
  );
  const [result, setResult] = useState<ResetResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const visibleOptions = allowDemoReset
    ? RESET_OPTIONS
    : RESET_OPTIONS.filter((option) => option.mode === 'MEMORY_ONLY');

  const handleReset = async (option: ResetOption) => {
    if (!confirm(option.confirmation)) {
      return;
    }

    setError(null);
    setResult(null);
    setProcessingMode(option.mode);

    try {
      const graphqlUrl =
        process.env.NEXT_PUBLIC_GRAPHQL_URL || 'http://localhost:3000/graphql';
      const response = await fetch(graphqlUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          query: RESET_MY_MEMORY_MUTATION,
          variables: { mode: option.mode },
        }),
      });

      const data = await response.json();

      if (data.errors) {
        throw new Error(data.errors[0]?.message || 'Failed to reset data');
      }

      const resetResult = data.data.resetMyMemory as ResetResult;
      setResult(resetResult);

      window.setTimeout(() => {
        window.location.reload();
      }, 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reset data');
      setProcessingMode(null);
    }
  };

  return (
    <div className="bg-white rounded-lg shadow p-6 mt-6 border border-red-100">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">
            Reset Preferences
          </h2>
          <p className="mt-1 text-sm text-gray-600">
            Clear the current account&apos;s saved preference data.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {visibleOptions.map((option) => (
            <button
              key={option.mode}
              type="button"
              onClick={() => handleReset(option)}
              disabled={processingMode !== null}
              className={`px-4 py-2 rounded text-sm font-medium transition disabled:cursor-not-allowed ${buttonClass(option.tone)}`}
            >
              {processingMode === option.mode ? 'Resetting...' : option.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <p className="mt-3 text-sm font-medium text-red-700">{error}</p>
      )}

      {result && (
        <p className="mt-3 text-sm font-medium text-green-700">
          Reset complete: {formatResult(result)}.
        </p>
      )}
    </div>
  );
}
