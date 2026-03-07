'use client';

import { useState } from 'react';

interface PreferenceDefinition {
  id: string;
  slug: string;
  namespace: string;
  displayName?: string | null;
  ownerUserId?: string | null;
  description: string;
  valueType: 'STRING' | 'BOOLEAN' | 'ENUM' | 'ARRAY';
  scope: 'GLOBAL' | 'LOCATION';
  options: string[] | null;
  isSensitive: boolean;
  isCore: boolean;
  category: string;
}

interface SchemaClientProps {
  initialCatalog: PreferenceDefinition[];
  accessToken: string;
  userId: string;
}

type DownloadScope = 'GLOBAL' | 'PERSONAL' | 'ALL';

const EXPORT_SCHEMA_QUERY = `
  query ExportPreferenceSchema($scope: ExportSchemaScope!) {
    exportPreferenceSchema(scope: $scope) {
      id
      slug
      namespace
      displayName
      ownerUserId
      description
      valueType
      scope
      options
      isSensitive
      isCore
      category
    }
  }
`;

const CREATE_MUTATION = `
  mutation CreatePreferenceDefinition($input: CreatePreferenceDefinitionInput!) {
    createPreferenceDefinition(input: $input) {
      id
      slug
      namespace
      displayName
      ownerUserId
      description
      valueType
      scope
      options
      isSensitive
      isCore
      category
    }
  }
`;

const UPDATE_MUTATION = `
  mutation UpdatePreferenceDefinition($id: ID!, $input: UpdatePreferenceDefinitionInput!) {
    updatePreferenceDefinition(id: $id, input: $input) {
      id
      slug
      namespace
      displayName
      ownerUserId
      description
      valueType
      scope
      options
      isSensitive
      isCore
      category
    }
  }
`;

const ARCHIVE_MUTATION = `
  mutation ArchivePreferenceDefinition($id: ID!) {
    archivePreferenceDefinition(id: $id) {
      id
      slug
      archivedAt
    }
  }
`;

const VALUE_TYPES = ['STRING', 'BOOLEAN', 'ENUM', 'ARRAY'] as const;
const SCOPES = ['GLOBAL', 'LOCATION'] as const;

function ValueTypeBadge({ type }: { type: string }) {
  const colors: Record<string, string> = {
    STRING: 'bg-blue-100 text-blue-800',
    BOOLEAN: 'bg-green-100 text-green-800',
    ENUM: 'bg-purple-100 text-purple-800',
    ARRAY: 'bg-orange-100 text-orange-800',
  };
  return (
    <span className={`inline-block px-2 py-0.5 text-xs font-medium rounded ${colors[type] || 'bg-gray-100 text-gray-800'}`}>
      {type}
    </span>
  );
}

function ScopeBadge({ scope }: { scope: string }) {
  const isLocation = scope === 'LOCATION';
  return (
    <span className={`inline-block px-2 py-0.5 text-xs font-medium rounded ${isLocation ? 'bg-yellow-100 text-yellow-800' : 'bg-gray-100 text-gray-700'}`}>
      {scope}
    </span>
  );
}

function OriginBadge({ ownerUserId }: { ownerUserId?: string | null }) {
  const isUser = ownerUserId != null;
  return (
    <span className={`inline-block px-2 py-0.5 text-xs font-medium rounded ${isUser ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100 text-gray-500'}`}>
      {isUser ? 'My def' : 'System'}
    </span>
  );
}

interface FormData {
  slug: string;
  displayName: string;
  description: string;
  valueType: 'STRING' | 'BOOLEAN' | 'ENUM' | 'ARRAY';
  scope: 'GLOBAL' | 'LOCATION';
  options: string;
  isSensitive: boolean;
  isCore: boolean;
}

const emptyForm: FormData = {
  slug: '',
  displayName: '',
  description: '',
  valueType: 'STRING',
  scope: 'GLOBAL',
  options: '',
  isSensitive: false,
  isCore: false,
};

function DefinitionForm({
  formData,
  onChange,
  onSubmit,
  onCancel,
  isSubmitting,
  error,
  isCreate,
}: {
  formData: FormData;
  onChange: (data: FormData) => void;
  onSubmit: () => void;
  onCancel: () => void;
  isSubmitting: boolean;
  error: string | null;
  isCreate: boolean;
}) {
  return (
    <div className="bg-white border-2 border-blue-200 rounded-lg p-6 mb-6">
      <h3 className="text-lg font-semibold mb-4">
        {isCreate ? 'Create New Definition' : `Edit: ${formData.slug}`}
      </h3>

      <div className="space-y-4">
        {isCreate && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Slug
            </label>
            <input
              type="text"
              value={formData.slug}
              onChange={(e) => onChange({ ...formData, slug: e.target.value })}
              placeholder="category.preference_name"
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
            <p className="text-xs text-gray-500 mt-1">
              Lowercase with dots, e.g. &quot;food.dietary_restrictions&quot;
            </p>
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Display Name <span className="text-gray-400 font-normal">(optional)</span>
          </label>
          <input
            type="text"
            value={formData.displayName}
            onChange={(e) => onChange({ ...formData, displayName: e.target.value })}
            placeholder="e.g. Dietary Restrictions"
            className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Description
          </label>
          <input
            type="text"
            value={formData.description}
            onChange={(e) => onChange({ ...formData, description: e.target.value })}
            placeholder="Human-readable description"
            className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Value Type
            </label>
            <select
              value={formData.valueType}
              onChange={(e) =>
                onChange({ ...formData, valueType: e.target.value as FormData['valueType'] })
              }
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              {VALUE_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Scope
            </label>
            <select
              value={formData.scope}
              onChange={(e) =>
                onChange({ ...formData, scope: e.target.value as FormData['scope'] })
              }
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              {SCOPES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
        </div>

        {formData.valueType === 'ENUM' && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Options (comma-separated)
            </label>
            <input
              type="text"
              value={formData.options}
              onChange={(e) => onChange({ ...formData, options: e.target.value })}
              placeholder="option1, option2, option3"
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
        )}

        <div className="flex gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={formData.isSensitive}
              onChange={(e) => onChange({ ...formData, isSensitive: e.target.checked })}
              className="rounded border-gray-300"
            />
            Sensitive
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={formData.isCore}
              onChange={(e) => onChange({ ...formData, isCore: e.target.checked })}
              className="rounded border-gray-300"
            />
            Core
          </label>
        </div>

        {error && (
          <div className="p-3 bg-red-100 text-red-700 rounded text-sm">
            {error}
          </div>
        )}

        <div className="flex gap-2">
          <button
            onClick={onSubmit}
            disabled={isSubmitting}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {isSubmitting ? 'Saving...' : isCreate ? 'Create' : 'Save Changes'}
          </button>
          <button
            onClick={onCancel}
            disabled={isSubmitting}
            className="px-4 py-2 text-sm bg-gray-200 text-gray-700 rounded hover:bg-gray-300 disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

type ViewFilter = 'all' | 'system' | 'personal';

export default function SchemaClient({ initialCatalog, accessToken, userId }: SchemaClientProps) {
  const [catalog, setCatalog] = useState(initialCatalog);
  const [view, setView] = useState<ViewFilter>('all');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<FormData>(emptyForm);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);

  const graphqlUrl = process.env.NEXT_PUBLIC_GRAPHQL_URL || 'http://localhost:3000/graphql';

  const handleDownload = async (scope: DownloadScope) => {
    setIsDownloading(true);
    try {
      const response = await fetch(graphqlUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
          'x-user-id': userId,
        },
        body: JSON.stringify({
          query: EXPORT_SCHEMA_QUERY,
          variables: { scope },
        }),
      });
      const data = await response.json();
      if (data.errors) throw new Error(data.errors[0]?.message || 'Export failed');
      const defs = data.data.exportPreferenceSchema;
      const blob = new Blob([JSON.stringify(defs, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `preference-schema-${scope.toLowerCase()}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to export schema');
    } finally {
      setIsDownloading(false);
    }
  };

  const handleCreate = () => {
    setEditingId(null);
    setFormData(emptyForm);
    setError(null);
    setShowCreateForm(true);
  };

  const handleEdit = (def: PreferenceDefinition) => {
    setShowCreateForm(false);
    setEditingId(def.id);
    setFormData({
      slug: def.slug,
      displayName: def.displayName || '',
      description: def.description,
      valueType: def.valueType,
      scope: def.scope,
      options: def.options ? def.options.join(', ') : '',
      isSensitive: def.isSensitive,
      isCore: def.isCore,
    });
    setError(null);
  };

  const handleCancel = () => {
    setShowCreateForm(false);
    setEditingId(null);
    setError(null);
  };

  const handleSubmitCreate = async () => {
    setError(null);
    setIsSubmitting(true);

    try {
      const input: Record<string, unknown> = {
        slug: formData.slug,
        description: formData.description,
        valueType: formData.valueType,
        scope: formData.scope,
        isSensitive: formData.isSensitive,
        isCore: formData.isCore,
      };

      if (formData.displayName.trim()) {
        input.displayName = formData.displayName.trim();
      }

      if (formData.valueType === 'ENUM' && formData.options.trim()) {
        input.options = formData.options.split(',').map((o) => o.trim()).filter(Boolean);
      }

      const response = await fetch(graphqlUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
          'x-user-id': userId,
        },
        body: JSON.stringify({
          query: CREATE_MUTATION,
          variables: { input },
        }),
      });

      const data = await response.json();

      if (data.errors) {
        throw new Error(data.errors[0]?.message || 'Failed to create definition');
      }

      const created = data.data.createPreferenceDefinition;
      setCatalog((prev) => [...prev, created]);
      setShowCreateForm(false);
      setFormData(emptyForm);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create definition');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmitUpdate = async () => {
    if (!editingId) return;
    setError(null);
    setIsSubmitting(true);

    try {
      const input: Record<string, unknown> = {
        description: formData.description,
        valueType: formData.valueType,
        scope: formData.scope,
        isSensitive: formData.isSensitive,
        isCore: formData.isCore,
      };

      if (formData.displayName.trim()) {
        input.displayName = formData.displayName.trim();
      }

      if (formData.valueType === 'ENUM' && formData.options.trim()) {
        input.options = formData.options.split(',').map((o) => o.trim()).filter(Boolean);
      } else if (formData.valueType !== 'ENUM') {
        input.options = null;
      }

      const response = await fetch(graphqlUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
          'x-user-id': userId,
        },
        body: JSON.stringify({
          query: UPDATE_MUTATION,
          variables: { id: editingId, input },
        }),
      });

      const data = await response.json();

      if (data.errors) {
        throw new Error(data.errors[0]?.message || 'Failed to update definition');
      }

      const updated = data.data.updatePreferenceDefinition;
      setCatalog((prev) => prev.map((def) => (def.id === editingId ? updated : def)));
      setEditingId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update definition');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleArchive = async (def: PreferenceDefinition) => {
    if (!confirm(`Archive "${def.slug}"? It will no longer appear in the catalog.`)) return;

    try {
      const response = await fetch(graphqlUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
          'x-user-id': userId,
        },
        body: JSON.stringify({
          query: ARCHIVE_MUTATION,
          variables: { id: def.id },
        }),
      });

      const data = await response.json();

      if (data.errors) {
        throw new Error(data.errors[0]?.message || 'Failed to archive definition');
      }

      setCatalog((prev) => prev.filter((d) => d.id !== def.id));
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to archive definition');
    }
  };

  // Filter by view then group by category
  const visibleCatalog = catalog.filter((def) => {
    if (view === 'system') return def.ownerUserId == null;
    if (view === 'personal') return def.ownerUserId != null;
    return true;
  });

  const grouped = visibleCatalog.reduce(
    (acc, def) => {
      const cat = def.category;
      if (!acc[cat]) acc[cat] = [];
      acc[cat].push(def);
      return acc;
    },
    {} as Record<string, PreferenceDefinition[]>,
  );

  const sortedCategories = Object.keys(grouped).sort();

  const systemCount = catalog.filter((d) => d.ownerUserId == null).length;
  const personalCount = catalog.filter((d) => d.ownerUserId != null).length;

  return (
    <>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Preference Schema</h1>
        <div className="flex gap-3 items-center">
          <div className="flex items-center gap-1 border border-gray-300 rounded overflow-hidden">
            <span className="px-2 py-2 text-xs text-gray-500 bg-gray-50 border-r border-gray-300">
              Download
            </span>
            {(['GLOBAL', 'PERSONAL', 'ALL'] as DownloadScope[]).map((scope) => (
              <button
                key={scope}
                onClick={() => handleDownload(scope)}
                disabled={isDownloading}
                className="px-2 py-2 text-xs text-gray-700 hover:bg-gray-100 disabled:opacity-50"
                title={`Download ${scope} definitions as JSON`}
              >
                {scope}
              </button>
            ))}
          </div>
          <button
            onClick={handleCreate}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            + Add Definition
          </button>
          <a href="/dashboard" className="px-4 py-2 text-sm text-blue-600 hover:text-blue-800">
            Back to Dashboard
          </a>
        </div>
      </div>

      {/* View tabs */}
      <div className="flex gap-1 mb-6 border-b border-gray-200">
        {(
          [
            { key: 'all', label: 'All', count: catalog.length },
            { key: 'system', label: 'System', count: systemCount },
            { key: 'personal', label: 'Personal', count: personalCount },
          ] as { key: ViewFilter; label: string; count: number }[]
        ).map(({ key, label, count }) => (
          <button
            key={key}
            onClick={() => setView(key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              view === key
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {label}
            <span className="ml-1.5 text-xs bg-gray-100 text-gray-600 rounded-full px-1.5 py-0.5">
              {count}
            </span>
          </button>
        ))}
      </div>

      {view === 'personal' && personalCount === 0 && !showCreateForm && (
        <div className="text-center py-10 text-gray-500 bg-white rounded-lg shadow mb-6">
          <p className="mb-3">You haven&apos;t created any personal definitions yet.</p>
          <button
            onClick={handleCreate}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            + Add your first definition
          </button>
        </div>
      )}

      {showCreateForm && (
        <DefinitionForm
          formData={formData}
          onChange={setFormData}
          onSubmit={handleSubmitCreate}
          onCancel={handleCancel}
          isSubmitting={isSubmitting}
          error={error}
          isCreate={true}
        />
      )}

      <div className="space-y-6">
        {sortedCategories.map((category) => (
          <div key={category} className="bg-white rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold mb-4 capitalize">{category}</h2>
            <div className="space-y-4">
              {grouped[category].map((def) =>
                editingId === def.id ? (
                  <DefinitionForm
                    key={def.id}
                    formData={formData}
                    onChange={setFormData}
                    onSubmit={handleSubmitUpdate}
                    onCancel={handleCancel}
                    isSubmitting={isSubmitting}
                    error={error}
                    isCreate={false}
                  />
                ) : (
                  <div key={def.id} className="border rounded-lg p-4">
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <code className="text-sm font-mono font-semibold text-gray-900">
                          {def.slug}
                        </code>
                        {def.displayName && (
                          <span className="ml-2 text-sm text-gray-500">{def.displayName}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <OriginBadge ownerUserId={def.ownerUserId} />
                        <ValueTypeBadge type={def.valueType} />
                        <ScopeBadge scope={def.scope} />
                        {def.ownerUserId != null && (
                          <>
                            <button
                              onClick={() => handleEdit(def)}
                              className="p-1 text-gray-400 hover:text-blue-600"
                              title="Edit"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                              </svg>
                            </button>
                            <button
                              onClick={() => handleArchive(def)}
                              className="p-1 text-gray-400 hover:text-red-600"
                              title="Archive"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8" />
                              </svg>
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                    <p className="text-sm text-gray-600 mb-2">{def.description}</p>
                    {def.options && (
                      <div className="mt-2">
                        <span className="text-xs text-gray-500 font-medium">Options: </span>
                        <span className="text-xs text-gray-700">
                          {def.options.join(', ')}
                        </span>
                      </div>
                    )}
                    {(def.isSensitive || def.isCore) && (
                      <div className="mt-2 flex gap-2">
                        {def.isSensitive && (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-red-100 text-red-700">Sensitive</span>
                        )}
                        {def.isCore && (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">Core</span>
                        )}
                      </div>
                    )}
                  </div>
                ),
              )}
            </div>
          </div>
        ))}

        <div className="text-sm text-gray-500 text-center pt-2">
          {catalog.length} preference definitions across {sortedCategories.length} categories
        </div>
      </div>
    </>
  );
}
