import { redirect } from 'next/navigation';
import { gql } from '@apollo/client';
import { auth0 } from '@/lib/auth0';
import { getClient } from '@/lib/apollo-client';
import SearchLabClient from './SearchLabClient';
import { Preference, PreferenceDefinition } from './types';

export const dynamic = 'force-dynamic';

const SEARCH_LAB_DATA_QUERY = gql`
  query SearchLabData {
    activePreferences {
      id
      userId
      slug
      definitionId
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
    suggestedPreferences {
      id
      userId
      slug
      definitionId
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

interface SearchLabDataQuery {
  activePreferences: Preference[];
  suggestedPreferences: Preference[];
  preferenceCatalog: PreferenceDefinition[];
}

export default async function SearchLabPage() {
  const session = await auth0.getSession();
  if (!session?.user) redirect('/auth/login');

  let accessToken = '';
  try {
    const tokenResult = await auth0.getAccessToken();
    accessToken = tokenResult?.token || '';
  } catch (e) {
    console.error('Failed to get access token:', e);
    redirect('/auth/login');
  }

  let activePreferences: Preference[] = [];
  let suggestedPreferences: Preference[] = [];
  let preferenceDefinitions: PreferenceDefinition[] = [];
  let error: string | null = null;

  try {
    const { data } = await getClient().query<SearchLabDataQuery>({
      query: SEARCH_LAB_DATA_QUERY,
      context: {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    });
    activePreferences = data?.activePreferences || [];
    suggestedPreferences = data?.suggestedPreferences || [];
    preferenceDefinitions = data?.preferenceCatalog || [];
  } catch (e) {
    console.error('Failed to fetch search lab data:', e);
    error = 'Failed to load Search Lab data.';
  }

  return (
    <SearchLabClient
      initialActivePreferences={activePreferences}
      initialSuggestedPreferences={suggestedPreferences}
      initialPreferenceDefinitions={preferenceDefinitions}
      accessToken={accessToken}
      loadError={error}
    />
  );
}
