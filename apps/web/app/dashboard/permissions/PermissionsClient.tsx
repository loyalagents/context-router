'use client';

import { useState } from 'react';

interface PermissionGrant {
  id: string;
  clientKey: string;
  target: string;
  action: 'READ' | 'WRITE';
  effect: 'ALLOW' | 'DENY';
  createdAt: string;
  updatedAt: string;
}

interface PermissionsClientProps {
  initialGrants: PermissionGrant[];
  accessToken: string;
}

type ClientKey = 'claude' | 'codex' | 'fallback';

const GRAPHQL_ENDPOINT =
  process.env.NEXT_PUBLIC_GRAPHQL_URL || 'http://localhost:3000/graphql';

const QUERY = `
  query MyPermissionGrants {
    myPermissionGrants {
      id
      clientKey
      target
      action
      effect
      createdAt
      updatedAt
    }
  }
`;

const SET_MUTATION = `
  mutation SetPermissionGrant($input: SetPermissionGrantInput!) {
    setPermissionGrant(input: $input) {
      id
      clientKey
      target
      action
      effect
      createdAt
      updatedAt
    }
  }
`;

const REMOVE_MUTATION = `
  mutation RemovePermissionGrant($clientKey: String!, $target: String!, $action: GrantAction!) {
    removePermissionGrant(clientKey: $clientKey, target: $target, action: $action)
  }
`;

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
  if (payload.errors?.length) {
    throw new Error(payload.errors[0].message || 'GraphQL request failed');
  }

  return payload.data as T;
}

export default function PermissionsClient({
  initialGrants,
  accessToken,
}: PermissionsClientProps) {
  const [grants, setGrants] = useState(initialGrants);
  const [clientKey, setClientKey] = useState<ClientKey>('claude');
  const [target, setTarget] = useState('');
  const [action, setAction] = useState<'READ' | 'WRITE'>('READ');
  const [effect, setEffect] = useState<'ALLOW' | 'DENY'>('DENY');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sortedGrants = [...grants].sort((a, b) =>
    `${a.clientKey}:${a.action}:${a.target}`.localeCompare(
      `${b.clientKey}:${b.action}:${b.target}`,
    ),
  );

  const refreshGrants = async () => {
    const data = await graphQlRequest<{ myPermissionGrants: PermissionGrant[] }>(
      accessToken,
      QUERY,
    );
    setGrants(data.myPermissionGrants);
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      await graphQlRequest(accessToken, SET_MUTATION, {
        input: {
          clientKey,
          target,
          action,
          effect,
        },
      });
      setTarget('');
      await refreshGrants();
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : 'Failed to save grant',
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (grant: PermissionGrant) => {
    setIsSubmitting(true);
    setError(null);

    try {
      await graphQlRequest(accessToken, REMOVE_MUTATION, {
        clientKey: grant.clientKey,
        target: grant.target,
        action: grant.action,
      });
      await refreshGrants();
    } catch (deleteError) {
      setError(
        deleteError instanceof Error ? deleteError.message : 'Failed to delete grant',
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Permission Grants</h1>
          <p className="text-sm text-gray-600 mt-1">
            Minimal testing UI for per-client slug permissions.
          </p>
        </div>
        <a href="/dashboard" className="text-blue-600 hover:text-blue-800">
          Back to Dashboard
        </a>
      </div>

      <form
        onSubmit={handleSubmit}
        className="border rounded-lg bg-white shadow-sm p-6 space-y-4"
      >
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <label className="text-sm">
            <span className="block font-medium text-gray-700 mb-1">Client</span>
            <select
              value={clientKey}
              onChange={(event) => setClientKey(event.target.value as ClientKey)}
              className="w-full border border-gray-300 rounded px-3 py-2"
            >
              <option value="claude">claude</option>
              <option value="codex">codex</option>
              <option value="fallback">fallback</option>
            </select>
          </label>

          <label className="text-sm md:col-span-1">
            <span className="block font-medium text-gray-700 mb-1">Action</span>
            <select
              value={action}
              onChange={(event) =>
                setAction(event.target.value as 'READ' | 'WRITE')
              }
              className="w-full border border-gray-300 rounded px-3 py-2"
            >
              <option value="READ">READ</option>
              <option value="WRITE">WRITE</option>
            </select>
          </label>

          <label className="text-sm md:col-span-1">
            <span className="block font-medium text-gray-700 mb-1">Effect</span>
            <select
              value={effect}
              onChange={(event) =>
                setEffect(event.target.value as 'ALLOW' | 'DENY')
              }
              className="w-full border border-gray-300 rounded px-3 py-2"
            >
              <option value="DENY">DENY</option>
              <option value="ALLOW">ALLOW</option>
            </select>
          </label>

          <label className="text-sm md:col-span-1">
            <span className="block font-medium text-gray-700 mb-1">Target</span>
            <input
              value={target}
              onChange={(event) => setTarget(event.target.value)}
              placeholder='*, food.*, food.french.*, food.dietary_restrictions'
              className="w-full border border-gray-300 rounded px-3 py-2"
            />
          </label>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={isSubmitting || target.trim().length === 0}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {isSubmitting ? 'Saving...' : 'Save Grant'}
          </button>
          <span className="text-sm text-gray-500">
            Use `deny *` plus specific allows if you want allowlist behavior.
          </span>
        </div>

        {error ? (
          <div className="p-3 rounded bg-red-50 text-red-700 text-sm">{error}</div>
        ) : null}
      </form>

      <div className="border rounded-lg bg-white shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b bg-gray-50">
          <h2 className="font-semibold">Current Grants</h2>
        </div>

        {sortedGrants.length === 0 ? (
          <div className="px-6 py-8 text-sm text-gray-500">
            No permission grants configured yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="text-left px-6 py-3 font-medium">Client</th>
                  <th className="text-left px-6 py-3 font-medium">Target</th>
                  <th className="text-left px-6 py-3 font-medium">Action</th>
                  <th className="text-left px-6 py-3 font-medium">Effect</th>
                  <th className="text-left px-6 py-3 font-medium">Created</th>
                  <th className="text-left px-6 py-3 font-medium">Delete</th>
                </tr>
              </thead>
              <tbody>
                {sortedGrants.map((grant) => (
                  <tr key={grant.id} className="border-t">
                    <td className="px-6 py-3">{grant.clientKey}</td>
                    <td className="px-6 py-3 font-mono text-xs">{grant.target}</td>
                    <td className="px-6 py-3">{grant.action}</td>
                    <td className="px-6 py-3">
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                          grant.effect === 'DENY'
                            ? 'bg-red-100 text-red-700'
                            : 'bg-green-100 text-green-700'
                        }`}
                      >
                        {grant.effect}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-gray-500">
                      {new Date(grant.createdAt).toLocaleString()}
                    </td>
                    <td className="px-6 py-3">
                      <button
                        type="button"
                        disabled={isSubmitting}
                        onClick={() => handleDelete(grant)}
                        className="text-red-600 hover:text-red-800 disabled:opacity-50"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
