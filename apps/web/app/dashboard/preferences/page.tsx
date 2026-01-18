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

const SUGGESTED_PREFERENCES_QUERY = gql`
  query SuggestedPreferences {
    suggestedPreferences {
      id
      slug
      value
      status
      sourceType
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

interface ActivePreferencesQuery {
  activePreferences: Preference[];
}

interface SuggestedPreferencesQuery {
  suggestedPreferences: Preference[];
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

  try {
    const [activeResult, suggestedResult] = await Promise.all([
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
    ]);
    activePreferences = activeResult.data?.activePreferences || [];
    suggestedPreferences = suggestedResult.data?.suggestedPreferences || [];
  } catch (e) {
    console.error('Failed to fetch preferences:', e);
  }

  return (
    <PreferencesClient
      initialActivePreferences={activePreferences}
      initialSuggestedPreferences={suggestedPreferences}
      accessToken={accessToken || ''}
    />
  );
}
