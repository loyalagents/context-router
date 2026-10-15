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
      <>
      <DashboardView
        activePreferences={data!.activePreferences}
        userData={data!.me}
        error={null}
        local
      />
      {session.capabilities.runtime?.mode === 'demo' && <DemoGuide />}
      </>
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

function DemoGuide() {
  const prompts = [
    'Search preferences using the literal prefixes travel.demo001. and home.demo001. These are historical 2024–2025 memories; do not assume dates or bookings are current.',
    'Search with the prefix travel.demo001. and propose one change to a returned preference. Wait for my explicit approval before writing it, then confirm the stored value.',
    'In a fresh Agent B or C conversation, read the exact changed slug again and report the current stored value.',
    'Search using the literal prefixes health.demo001. and finance.demo001. Report what the tools permit; do not guess or infer restricted values.',
    'Review the changed memory’s Modified by field and its Audit History. Compare the original importer event with the later agent change and MCP Access event.',
  ];
  return <details className="mx-10 mb-10 max-w-5xl rounded border p-5">
    <summary className="cursor-pointer font-semibold">Demo walkthrough (optional)</summary>
    <div className="mt-4 space-y-6">
    <p>The sample contains historical memories. Read by category prefix because one response is limited to 100 results. The current permissions and history views show real stored state, including your changes.</p>
    <p>Use CR → Demo setup for the current generation’s client commands. Agent A starts with write and definition access; B and C start as readers with health and finance restrictions. Inspect Permission Grants for their actual current grants. Start fresh conversations after every mode switch or reset.</p>
    <ol className="list-decimal pl-6 space-y-5">{prompts.map((prompt, index) => <li key={prompt}>
      <p>{prompt}</p><button type="button" className="mt-1 text-blue-700 underline" onClick={() => void navigator.clipboard.writeText(prompt)}>Copy step {index + 1} prompt</button>
    </li>)}</ol>
    <p className="text-sm text-gray-600">Use sensitive-value reveal deliberately in history. A denied read is evidence of the active grants, while an empty allowed read can mean no matching memories.</p>
    </div>
  </details>;
}
