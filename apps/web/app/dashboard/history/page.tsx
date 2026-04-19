import { redirect } from 'next/navigation';
import { gql } from '@apollo/client';
import { getClient } from '@/lib/apollo-client';
import { auth0 } from '@/lib/auth0';
import AuditHistoryTab from '../preferences/components/AuditHistoryTab';

export const dynamic = 'force-dynamic';

const PREFERENCE_CATALOG_QUERY = gql`
  query PreferenceCatalogForAuditHistoryPage {
    preferenceCatalog {
      slug
      isSensitive
    }
  }
`;

interface PreferenceDefinitionSensitivity {
  slug: string;
  isSensitive: boolean;
}

interface PreferenceCatalogQuery {
  preferenceCatalog: PreferenceDefinitionSensitivity[];
}

export default async function AuditHistoryPage() {
  const session = await auth0.getSession();
  if (!session?.user) redirect('/auth/login');

  let accessToken = '';
  try {
    const tokenResult = await auth0.getAccessToken();
    accessToken = tokenResult?.token || '';
  } catch (error) {
    console.error('Failed to get access token:', error);
  }

  let preferenceDefinitions: PreferenceDefinitionSensitivity[] = [];
  let error: string | null = null;

  try {
    const { data } = await getClient().query<PreferenceCatalogQuery>({
      query: PREFERENCE_CATALOG_QUERY,
      context: {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
      fetchPolicy: 'no-cache',
    });
    preferenceDefinitions = data?.preferenceCatalog || [];
  } catch (fetchError) {
    console.error('Failed to fetch preference catalog for audit history:', fetchError);
    error = 'Failed to load audit history metadata.';
  }

  return (
    <div className="p-10">
      <div className="max-w-6xl">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">Audit History</h1>
            <p className="text-sm text-gray-600 mt-1">
              Review the append-only history of preference and definition changes.
            </p>
          </div>
          <a href="/dashboard" className="text-blue-600 hover:text-blue-800">
            Back to Dashboard
          </a>
        </div>

        {error ? (
          <div className="p-4 bg-red-100 text-red-700 rounded mb-6">
            <p>{error}</p>
            <p className="text-sm mt-2">Ensure backend is running on port 3000.</p>
          </div>
        ) : (
          <AuditHistoryTab
            accessToken={accessToken}
            preferenceDefinitions={preferenceDefinitions}
            shouldLoad={true}
            showHeader={false}
          />
        )}
      </div>
    </div>
  );
}
