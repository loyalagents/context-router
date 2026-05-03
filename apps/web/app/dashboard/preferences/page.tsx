import { redirect } from 'next/navigation';
import { auth0 } from '@/lib/auth0';
import { gql } from '@apollo/client';
import { getClient } from '@/lib/apollo-client';
import PreferencesClient from './PreferencesClient';

export const dynamic = 'force-dynamic';

const ACTIVE_PREFERENCES_QUERY = gql`
  query ActivePreferences {
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
  }
`;

const SUGGESTED_PREFERENCES_QUERY = gql`
  query SuggestedPreferences {
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
      evidence
      locationId
      category
      description
      createdAt
      updatedAt
    }
  }
`;

const PREFERENCE_CATALOG_QUERY = gql`
  query PreferenceCatalogForPreferencesPage {
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
`;

interface PreferenceAttribution {
  actorType: string;
  actorClientKey: string | null;
  origin: string;
}

interface Preference {
  id: string;
  slug: string;
  definitionId: string;
  value: any;
  status: string;
  sourceType: string;
  lastModifiedBy?: PreferenceAttribution | null;
  confidence: number | null;
  locationId: string | null;
  category?: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
}

interface ActivePreferencesQuery {
  activePreferences: Preference[];
}

interface SuggestedPreferencesQuery {
  suggestedPreferences: Preference[];
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

interface PreferenceCatalogQuery {
  preferenceCatalog: PreferenceDefinition[];
}

export default async function PreferencesPage() {
  const session = await auth0.getSession();
  if (!session?.user) redirect('/auth/login');

  let accessToken;
  try {
    const tokenResult = await auth0.getAccessToken();
    accessToken = tokenResult?.token;
  } catch (e) {
    console.error('Failed to get access token:', e);
    redirect('/auth/login');
  }

  let activePreferences: Preference[] = [];
  let suggestedPreferences: Preference[] = [];
  let preferenceDefinitions: PreferenceDefinition[] = [];

  try {
    const [activeResult, suggestedResult, catalogResult] = await Promise.all([
      getClient().query<ActivePreferencesQuery>({
        query: ACTIVE_PREFERENCES_QUERY,
        context: {
          headers: { Authorization: `Bearer ${accessToken}` },
        },
      }),
      getClient().query<SuggestedPreferencesQuery>({
        query: SUGGESTED_PREFERENCES_QUERY,
        context: {
          headers: { Authorization: `Bearer ${accessToken}` },
        },
      }),
      getClient().query<PreferenceCatalogQuery>({
        query: PREFERENCE_CATALOG_QUERY,
        context: {
          headers: { Authorization: `Bearer ${accessToken}` },
        },
      }),
    ]);
    activePreferences = activeResult.data?.activePreferences || [];
    suggestedPreferences = suggestedResult.data?.suggestedPreferences || [];
    preferenceDefinitions = catalogResult.data?.preferenceCatalog || [];
  } catch (e) {
    console.error('Failed to fetch preferences:', e);
  }

  return (
    <PreferencesClient
      initialActivePreferences={activePreferences}
      initialSuggestedPreferences={suggestedPreferences}
      initialPreferenceDefinitions={preferenceDefinitions}
      accessToken={accessToken || ''}
      allowDemoReset={process.env.ENABLE_DEMO_RESET === 'true'}
    />
  );
}
