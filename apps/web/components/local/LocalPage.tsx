'use client';

import { useEffect, useState } from 'react';
import { localGraphql } from '@/lib/authenticated-fetch';
import { useLocalSession } from './LocalSession';
import DashboardView from './DashboardView';
import McpClients from './McpClients';
import ProfileForm from '@/app/dashboard/profile/ProfileForm';
import PreferencesClient from '@/app/dashboard/preferences/PreferencesClient';
import SchemaClient from '@/app/dashboard/schema/SchemaClient';
import HistoryTabs from '@/app/dashboard/history/HistoryTabs';
import FormFillClient from '@/app/dashboard/form-fill/FormFillClient';
import type {
  Preference,
  PreferenceDefinition,
} from '@/app/dashboard/preferences/types';

const queries = {
  dashboard: /* GraphQL */ `
    query LocalDashboard {
      me {
        userId
        email
      }
      activePreferences {
        id
        slug
        value
      }
    }
  `,
  profile: /* GraphQL */ `
    query LocalProfile {
      me {
        userId
        email
      }
      activePreferences {
        id
        slug
        value
      }
    }
  `,
  preferences: /* GraphQL */ `
    query LocalPreferences {
      activePreferences {
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
      suggestedPreferences {
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
        evidence
      }
      preferenceCatalog {
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
  `,
  schema: /* GraphQL */ `
    query LocalSchema {
      preferenceCatalog {
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
  `,
  history: /* GraphQL */ `
    query LocalHistoryCatalog {
      preferenceCatalog {
        slug
        isSensitive
      }
    }
  `,
  'form-fill': '',
  permissions: '',
};
type Page = keyof typeof queries;
interface PageData {
  me: { userId: string; email: string };
  activePreferences: Preference[];
  suggestedPreferences: Preference[];
  preferenceCatalog: PreferenceDefinition[];
}

export default function LocalPage({ page }: { page: Page }) {
  const session = useLocalSession();
  const sessionToken = session?.token;
  const [data, setData] = useState<PageData | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!sessionToken) return;
    const controller = new AbortController();
    setError('');
    setData(null);
    if (!queries[page]) return;
    void localGraphql<PageData>(queries[page], undefined, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setData(result);
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setError(
            'Unable to load this page. Your saved data has not been replaced.',
          );
      });
    return () => controller.abort();
  }, [page, sessionToken, attempt]);
  if (!session) return null;
  if (error)
    return (
      <main className="p-10">
        <p role="alert">{error}</p>
        <button
          className="mt-4 text-blue-700 underline"
          onClick={() => setAttempt((n) => n + 1)}
        >
          Retry loading
        </button>
      </main>
    );
  if (queries[page] && !data)
    return (
      <main role="status" className="p-10">
        Loading {page}…
      </main>
    );
  const accessToken = session.token;
  if (page === 'dashboard')
    return (
      <DashboardView
        activePreferences={data!.activePreferences}
        userData={data!.me}
        error={null}
        local
      />
    );
  if (page === 'preferences')
    return (
      <PreferencesClient
        initialActivePreferences={data!.activePreferences}
        initialSuggestedPreferences={data!.suggestedPreferences}
        initialPreferenceDefinitions={data!.preferenceCatalog}
        accessToken={accessToken}
        allowDemoReset={false}
      />
    );
  if (page === 'schema')
    return (
      <div className="p-10 max-w-4xl">
        <SchemaClient
          initialCatalog={data!.preferenceCatalog}
          accessToken={accessToken}
        />
      </div>
    );
  const title = {
    profile: 'Edit Profile',
    history: 'Audit History',
    'form-fill': 'Form Fill',
    permissions: 'MCP Clients',
  }[page];
  return (
    <main className="p-10">
      <div className="max-w-6xl">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-bold">{title}</h1>
          <a href="/dashboard" className="text-blue-600">
            Back to Dashboard
          </a>
        </div>
        {page === 'profile' && (
          <ProfileForm
            accessToken={accessToken}
            accountEmail={data!.me.email}
            initialPreferences={data!.activePreferences.filter((p) =>
              p.slug.startsWith('profile.'),
            )}
          />
        )}
        {page === 'history' && (
          <HistoryTabs
            accessToken={accessToken}
            preferenceDefinitions={data!.preferenceCatalog}
          />
        )}
        {page === 'form-fill' && <FormFillClient accessToken={accessToken} />}
        {page === 'permissions' && <McpClients />}
      </div>
    </main>
  );
}
