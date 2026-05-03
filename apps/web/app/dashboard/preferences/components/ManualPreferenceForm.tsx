'use client';

import { useState } from 'react';

interface Preference {
  id: string;
  slug: string;
  definitionId: string;
  value: any;
  status: string;
  sourceType: string;
  lastModifiedBy?: {
    actorType: string;
    actorClientKey: string | null;
    origin: string;
  } | null;
  confidence: number | null;
  locationId: string | null;
  category?: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
}

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

interface ManualPreferenceFormProps {
  accessToken: string;
  definitions: PreferenceDefinition[];
  onSaved: (preference: Preference, createdDefinition?: PreferenceDefinition) => void;
}

const SET_PREFERENCE_MUTATION = `
  mutation SetPreference($input: SetPreferenceInput!) {
    setPreference(input: $input) {
      id
      slug
      definitionId
      value
      status
      sourceType
      lastModifiedBy {
        actorType
        actorClientKey
        origin
      }
      confidence
      locationId
      category
      description
      createdAt
      updatedAt
    }
  }
`;

const CREATE_DEFINITION_MUTATION = `
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

const VALUE_TYPES = ['STRING', 'BOOLEAN', 'ENUM', 'ARRAY'] as const;

export default function ManualPreferenceForm({
  accessToken,
  definitions,
  onSaved,
}: ManualPreferenceFormProps) {
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [valueType, setValueType] = useState<(typeof VALUE_TYPES)[number]>('STRING');
  const [enumOptions, setEnumOptions] = useState('');
  const [textValue, setTextValue] = useState('');
  const [booleanValue, setBooleanValue] = useState<'true' | 'false'>('true');
  const [arrayValue, setArrayValue] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const graphqlUrl =
    process.env.NEXT_PUBLIC_GRAPHQL_URL || 'http://localhost:3000/graphql';

  const normalizedSlug = slug.trim();
  const existingDefinition = definitions.find(
    (definition) => definition.slug === normalizedSlug,
  );
  const isNewDefinition = normalizedSlug.length > 0 && !existingDefinition;
  const effectiveValueType = existingDefinition?.valueType || valueType;
  const enumOptionsList =
    existingDefinition?.options ||
    enumOptions
      .split(',')
      .map((option) => option.trim())
      .filter(Boolean);

  const resetForm = () => {
    setSlug('');
    setDescription('');
    setValueType('STRING');
    setEnumOptions('');
    setTextValue('');
    setBooleanValue('true');
    setArrayValue('');
    setError(null);
  };

  const buildValue = () => {
    switch (effectiveValueType) {
      case 'BOOLEAN':
        return booleanValue === 'true';
      case 'ARRAY':
        return arrayValue
          .split(',')
          .map((entry) => entry.trim())
          .filter(Boolean);
      case 'ENUM':
      case 'STRING':
      default:
        return textValue.trim();
    }
  };

  const handleSubmit = async () => {
    setError(null);

    if (!normalizedSlug) {
      setError('Slug is required');
      return;
    }

    if (existingDefinition?.scope === 'LOCATION') {
      setError(
        'Location-scoped definitions are not supported from this form yet. Use the schema page or add location support first.',
      );
      return;
    }

    if (isNewDefinition && !description.trim()) {
      setError('Description is required for new custom slugs');
      return;
    }

    if (effectiveValueType === 'ENUM' && enumOptionsList.length === 0) {
      setError('Enum definitions need at least one option');
      return;
    }

    if ((effectiveValueType === 'STRING' || effectiveValueType === 'ENUM') && !textValue.trim()) {
      setError('Value is required');
      return;
    }

    setIsSubmitting(true);

    try {
      let createdDefinition: PreferenceDefinition | undefined;

      if (isNewDefinition) {
        const createResponse = await fetch(graphqlUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            query: CREATE_DEFINITION_MUTATION,
            variables: {
              input: {
                slug: normalizedSlug,
                description: description.trim(),
                valueType,
                scope: 'GLOBAL',
                options: valueType === 'ENUM' ? enumOptionsList : undefined,
              },
            },
          }),
        });

        const createData = await createResponse.json();

        if (createData.errors) {
          throw new Error(
            createData.errors[0]?.message || 'Failed to create custom definition',
          );
        }

        createdDefinition = createData.data.createPreferenceDefinition;
      }

      const setResponse = await fetch(graphqlUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          query: SET_PREFERENCE_MUTATION,
          variables: {
            input: {
              slug: normalizedSlug,
              value: buildValue(),
            },
          },
        }),
      });

      const setData = await setResponse.json();

      if (setData.errors) {
        throw new Error(setData.errors[0]?.message || 'Failed to save preference');
      }

      onSaved(setData.data.setPreference, createdDefinition);
      resetForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save preference');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="bg-white rounded-lg shadow p-6 mb-6">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h2 className="text-lg font-semibold">Add Preference Manually</h2>
          <p className="text-sm text-gray-600 mt-1">
            Add a global preference directly. New slugs are created as personal definitions first.
          </p>
        </div>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Slug
          </label>
          <input
            list="preference-slug-options"
            value={slug}
            onChange={(event) => setSlug(event.target.value)}
            placeholder="food.oatmeal"
            className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
          <datalist id="preference-slug-options">
            {definitions.map((definition) => (
              <option key={definition.id} value={definition.slug} />
            ))}
          </datalist>
          {existingDefinition ? (
            <p className="text-xs text-gray-500 mt-1">
              Existing definition: {existingDefinition.valueType} / {existingDefinition.scope}
            </p>
          ) : normalizedSlug ? (
            <p className="text-xs text-amber-700 mt-1">
              New custom slug. This form will create a personal global definition first.
            </p>
          ) : null}
        </div>

        {isNewDefinition && (
          <>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Description
              </label>
              <input
                type="text"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="What this preference means"
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Value Type
              </label>
              <select
                value={valueType}
                onChange={(event) =>
                  setValueType(event.target.value as (typeof VALUE_TYPES)[number])
                }
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                {VALUE_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </div>

            {valueType === 'ENUM' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Enum Options
                </label>
                <input
                  type="text"
                  value={enumOptions}
                  onChange={(event) => setEnumOptions(event.target.value)}
                  placeholder="likes, dislikes, neutral"
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Comma-separated allowed values.
                </p>
              </div>
            )}
          </>
        )}

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Value
          </label>

          {effectiveValueType === 'BOOLEAN' ? (
            <select
              value={booleanValue}
              onChange={(event) =>
                setBooleanValue(event.target.value as 'true' | 'false')
              }
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="true">true</option>
              <option value="false">false</option>
            </select>
          ) : effectiveValueType === 'ARRAY' ? (
            <>
              <input
                type="text"
                value={arrayValue}
                onChange={(event) => setArrayValue(event.target.value)}
                placeholder="oatmeal, granola, fruit"
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
              <p className="text-xs text-gray-500 mt-1">
                Comma-separated values will be stored as an array.
              </p>
            </>
          ) : (
            <>
              <input
                type="text"
                value={textValue}
                onChange={(event) => setTextValue(event.target.value)}
                placeholder={
                  effectiveValueType === 'ENUM'
                    ? 'Enter one of the allowed enum values'
                    : 'Enter a value'
                }
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
              {effectiveValueType === 'ENUM' && enumOptionsList.length > 0 && (
                <p className="text-xs text-gray-500 mt-1">
                  Allowed values: {enumOptionsList.join(', ')}
                </p>
              )}
            </>
          )}
        </div>

        {error && (
          <div className="p-3 bg-red-100 text-red-700 rounded text-sm">
            {error}
          </div>
        )}

        <div className="flex gap-2">
          <button
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {isSubmitting ? 'Saving...' : 'Save Preference'}
          </button>
          <button
            onClick={resetForm}
            disabled={isSubmitting}
            className="px-4 py-2 text-sm bg-gray-200 text-gray-700 rounded hover:bg-gray-300 disabled:opacity-50"
          >
            Clear
          </button>
        </div>
      </div>
    </div>
  );
}
