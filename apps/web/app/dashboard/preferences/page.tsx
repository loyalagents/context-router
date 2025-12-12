import { redirect } from 'next/navigation';
import { auth0 } from '@/lib/auth0';
import { gql } from '@apollo/client';
import { getClient } from '@/lib/apollo-client';
import PreferencesClient from './PreferencesClient';
import { PreferencesQuery } from '@/lib/generated/graphql';

export const dynamic = 'force-dynamic';

const PREFERENCES_QUERY = gql`
  query Preferences {
    preferences {
      preferenceId
      category
      key
      value
      createdAt
      updatedAt
    }
  }
`;

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

  let preferences: PreferencesQuery['preferences'] = [];
  try {
    const { data } = await getClient().query<PreferencesQuery>({
      query: PREFERENCES_QUERY,
      context: {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    });
    preferences = data?.preferences || [];
  } catch (e) {
    console.error('Failed to fetch preferences:', e);
  }

  return (
    <PreferencesClient
      initialPreferences={preferences}
      accessToken={accessToken || ''}
    />
  );
}
