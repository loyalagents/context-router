'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

const PROFILE_FIELDS = [
  { slug: 'profile.full_name', label: 'Full Name', required: true },
  { slug: 'profile.email', label: 'Contact Email', required: true },
  { slug: 'profile.first_name', label: 'First Name', required: false },
  { slug: 'profile.last_name', label: 'Last Name', required: false },
  { slug: 'profile.badge_name', label: 'Badge Name', required: false },
  { slug: 'profile.company', label: 'Company', required: false },
  { slug: 'profile.title', label: 'Title', required: false },
] as const;

type ProfileSlug = (typeof PROFILE_FIELDS)[number]['slug'];

interface ProfilePreference {
  id: string;
  slug: string;
  value: unknown;
}

interface ProfileFormProps {
  accessToken: string;
  accountEmail: string;
  initialPreferences: ProfilePreference[];
}

const SET_PREFERENCE_MUTATION = `
  mutation SetProfilePreference($input: SetPreferenceInput!) {
    setPreference(input: $input) {
      id
      slug
      value
    }
  }
`;

const DELETE_PREFERENCE_MUTATION = `
  mutation DeleteProfilePreference($id: ID!) {
    deletePreference(id: $id) {
      id
    }
  }
`;

function stringifyPreferenceValue(value: unknown) {
  if (typeof value === 'string') {
    return value;
  }

  if (value === null || value === undefined) {
    return '';
  }

  return String(value);
}

export default function ProfileForm({
  accessToken,
  accountEmail,
  initialPreferences,
}: ProfileFormProps) {
  const router = useRouter();
  const initialBySlug = useMemo(
    () =>
      new Map(
        initialPreferences.map((preference) => [preference.slug, preference]),
      ),
    [initialPreferences],
  );
  const [values, setValues] = useState<Record<ProfileSlug, string>>(() =>
    PROFILE_FIELDS.reduce(
      (acc, field) => {
        acc[field.slug] = stringifyPreferenceValue(
          initialBySlug.get(field.slug)?.value,
        );
        return acc;
      },
      {} as Record<ProfileSlug, string>,
    ),
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  const graphqlRequest = async (
    query: string,
    variables: Record<string, unknown>,
  ) => {
    const graphqlUrl =
      process.env.NEXT_PUBLIC_GRAPHQL_URL || 'http://localhost:3000/graphql';
    const response = await fetch(graphqlUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ query, variables }),
    });
    const data = await response.json();

    if (!response.ok || data.errors) {
      throw new Error(data.errors?.[0]?.message || 'Failed to save profile');
    }

    return data;
  };

  const handleChange = (slug: ProfileSlug, value: string) => {
    setValues((current) => ({ ...current, [slug]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSuccessMessage('');
    setError('');
    setLoading(true);

    try {
      for (const field of PROFILE_FIELDS) {
        const value = values[field.slug].trim();
        const existing = initialBySlug.get(field.slug);

        if (!value && field.required) {
          throw new Error(`${field.label} is required`);
        }

        if (!value && existing) {
          await graphqlRequest(DELETE_PREFERENCE_MUTATION, {
            id: existing.id,
          });
          continue;
        }

        if (value) {
          await graphqlRequest(SET_PREFERENCE_MUTATION, {
            input: {
              slug: field.slug,
              value,
            },
          });
        }
      }

      setSuccessMessage('Profile updated successfully.');
      router.refresh();
    } catch (err) {
      console.error('Failed to update profile:', err);
      setError(err instanceof Error ? err.message : 'Failed to update profile');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="p-6 border rounded-lg bg-white shadow-sm">
        <div className="mb-6 space-y-1">
          <h2 className="text-lg font-semibold">Profile Memory</h2>
          <p className="text-sm text-gray-600">
            Account email: {accountEmail || 'Not available'}
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {PROFILE_FIELDS.map((field) => (
            <div
              key={field.slug}
              className={field.slug === 'profile.full_name' ? 'sm:col-span-2' : ''}
            >
              <label
                htmlFor={field.slug}
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                {field.label}
              </label>
              <input
                type={field.slug === 'profile.email' ? 'email' : 'text'}
                id={field.slug}
                value={values[field.slug]}
                onChange={(event) =>
                  handleChange(field.slug, event.target.value)
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                required={field.required}
              />
            </div>
          ))}
        </div>

        {error && (
          <div className="mt-4 p-3 bg-red-100 text-red-700 rounded">
            Error updating profile: {error}
          </div>
        )}

        {successMessage && (
          <div className="mt-4 p-3 bg-green-100 text-green-700 rounded">
            {successMessage}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="mt-6 px-6 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition"
        >
          {loading ? 'Saving...' : 'Save Changes'}
        </button>
      </div>
    </form>
  );
}
