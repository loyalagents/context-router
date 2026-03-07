import { redirect } from 'next/navigation';
import { gql } from '@apollo/client';
import { getClient } from '@/lib/apollo-client';
import { auth0 } from '@/lib/auth0';
import SchemaClient from './SchemaClient';

export const dynamic = 'force-dynamic';

const PREFERENCE_CATALOG_QUERY = gql`
  query PreferenceCatalog {
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


export default async function SchemaPage() {
  const session = await auth0.getSession();
  if (!session?.user) redirect('/auth/login');

  let accessToken = '';
  try {
    const tokenResult = await auth0.getAccessToken();
    accessToken = tokenResult?.token || '';
  } catch (e) {
    console.error('Failed to get access token:', e);
  }

  let catalog: PreferenceDefinition[] = [];
  let error = null;

  try {
    const { data } = await getClient().query<PreferenceCatalogQuery>({
      query: PREFERENCE_CATALOG_QUERY,
      context: {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    });
    catalog = data?.preferenceCatalog || [];
  } catch (e) {
    console.error('Failed to fetch preference catalog:', e);
    error = 'Failed to load preference schema.';
  }

  return (
    <div className="p-10">
      <div className="max-w-4xl">
        {error ? (
          <>
            <div className="flex items-center justify-between mb-6">
              <h1 className="text-2xl font-bold">Preference Schema</h1>
              <a href="/dashboard" className="text-blue-600 hover:text-blue-800">
                Back to Dashboard
              </a>
            </div>
            <div className="p-4 bg-red-100 text-red-700 rounded mb-6">
              <p>{error}</p>
              <p className="text-sm mt-2">Ensure backend is running on port 3000.</p>
            </div>
          </>
        ) : (
          <SchemaClient initialCatalog={catalog} accessToken={accessToken} />
        )}
      </div>
    </div>
  );
}
