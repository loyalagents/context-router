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

interface PreferenceItemProps {
  preference: Preference;
  accessToken: string;
  onUpdate: (updated: Preference) => void;
  onDelete: (id: string) => void;
}

const SET_PREFERENCE_MUTATION = `
  mutation SetPreference($input: SetPreferenceInput!) {
    setPreference(input: $input) {
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

const DELETE_PREFERENCE_MUTATION = `
  mutation DeletePreference($id: ID!) {
    deletePreference(id: $id) {
      id
    }
  }
`;

export default function PreferenceItem({
  preference,
  accessToken,
  onUpdate,
  onDelete,
}: PreferenceItemProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(JSON.stringify(preference.value, null, 2));
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    setError(null);
    setIsSaving(true);

    try {
      // Parse the edited value
      let parsedValue: any;
      try {
        parsedValue = JSON.parse(editValue);
      } catch {
        setError('Invalid JSON format');
        setIsSaving(false);
        return;
      }

      const graphqlUrl = process.env.NEXT_PUBLIC_GRAPHQL_URL || 'http://localhost:3000/graphql';
      const response = await fetch(graphqlUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          query: SET_PREFERENCE_MUTATION,
          variables: {
            input: {
              slug: preference.slug,
              value: parsedValue,
              locationId: preference.locationId,
            },
          },
        }),
      });

      const data = await response.json();

      if (data.errors) {
        throw new Error(data.errors[0]?.message || 'Failed to update preference');
      }

      onUpdate(data.data.setPreference);
      setIsEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update preference');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Are you sure you want to delete "${preference.slug}"?`)) {
      return;
    }

    setError(null);
    setIsDeleting(true);

    try {
      const graphqlUrl = process.env.NEXT_PUBLIC_GRAPHQL_URL || 'http://localhost:3000/graphql';
      const response = await fetch(graphqlUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          query: DELETE_PREFERENCE_MUTATION,
          variables: {
            id: preference.id,
          },
        }),
      });

      const data = await response.json();

      if (data.errors) {
        throw new Error(data.errors[0]?.message || 'Failed to delete preference');
      }

      onDelete(preference.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete preference');
      setIsDeleting(false);
    }
  };

  const handleCancel = () => {
    setEditValue(JSON.stringify(preference.value, null, 2));
    setError(null);
    setIsEditing(false);
  };

  // Extract the key part from slug (e.g., "food.dietary_restrictions" -> "dietary_restrictions")
  const displayName = preference.slug.split('.').pop() || preference.slug;

  return (
    <div className="border rounded-lg p-3">
      <div className="flex justify-between items-start">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium text-gray-900">{displayName}</span>
            {!isEditing && (
              <span className="text-xs text-gray-400">
                {new Date(preference.updatedAt).toLocaleDateString()}
              </span>
            )}
            {preference.sourceType === 'INFERRED' && (
              <span className="px-1.5 py-0.5 text-xs rounded bg-purple-100 text-purple-700">
                AI
              </span>
            )}
          </div>
          {preference.description && (
            <p className="text-xs text-gray-500 mt-0.5">{preference.description}</p>
          )}

          {isEditing ? (
            <div className="mt-2">
              <textarea
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                className="w-full font-mono text-sm border rounded p-2 bg-gray-50 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                rows={Math.min(10, editValue.split('\n').length + 1)}
              />
              {error && (
                <p className="text-red-600 text-sm mt-1">{error}</p>
              )}
              <div className="flex gap-2 mt-2">
                <button
                  onClick={handleSave}
                  disabled={isSaving}
                  className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                >
                  {isSaving ? 'Saving...' : 'Save'}
                </button>
                <button
                  onClick={handleCancel}
                  disabled={isSaving}
                  className="px-3 py-1 text-sm bg-gray-200 text-gray-700 rounded hover:bg-gray-300 disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <pre className="text-sm text-gray-600 mt-1 bg-gray-50 px-2 py-1 rounded">
              {JSON.stringify(preference.value, null, 2)}
            </pre>
          )}
        </div>

        {!isEditing && (
          <div className="flex gap-1 ml-2">
            <button
              onClick={() => setIsEditing(true)}
              className="p-1 text-gray-400 hover:text-blue-600"
              title="Edit"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </button>
            <button
              onClick={handleDelete}
              disabled={isDeleting}
              className="p-1 text-gray-400 hover:text-red-600 disabled:opacity-50"
              title="Delete"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
