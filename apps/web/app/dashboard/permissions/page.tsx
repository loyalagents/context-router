import { redirect } from 'next/navigation';
import { gql } from '@apollo/client';
import { getClient } from '@/lib/apollo-client';
import { auth0 } from '@/lib/auth0';
import PermissionsClient from './PermissionsClient';

export const dynamic = 'force-dynamic';

const MY_PERMISSION_GRANTS_QUERY = gql`
  query MyPermissionGrants {
    myPermissionGrants {
      id
      clientKey
      target
      action
      effect
      createdAt
      updatedAt
    }
  }
`;

interface PermissionGrant {
  id: string;
  clientKey: string;
  target: string;
  action: 'READ' | 'WRITE';
  effect: 'ALLOW' | 'DENY';
  createdAt: string;
  updatedAt: string;
}

interface MyPermissionGrantsQuery {
  myPermissionGrants: PermissionGrant[];
}

export default async function PermissionsPage() {
  const session = await auth0.getSession();
  if (!session?.user) redirect('/auth/login');

  let accessToken = '';
  try {
    const tokenResult = await auth0.getAccessToken();
    accessToken = tokenResult?.token || '';
  } catch (error) {
    console.error('Failed to get access token:', error);
  }

  let initialGrants: PermissionGrant[] = [];
  let error: string | null = null;

  try {
    const { data } = await getClient().query<MyPermissionGrantsQuery>({
      query: MY_PERMISSION_GRANTS_QUERY,
      context: {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
      fetchPolicy: 'no-cache',
    });
    initialGrants = data?.myPermissionGrants || [];
  } catch (fetchError) {
    console.error('Failed to fetch permission grants:', fetchError);
    error = 'Failed to load permission grants.';
  }

  return (
    <div className="p-10">
      <div className="max-w-5xl">
        {error ? (
          <>
            <div className="flex items-center justify-between mb-6">
              <h1 className="text-2xl font-bold">Permission Grants</h1>
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
          <PermissionsClient
            initialGrants={initialGrants}
            accessToken={accessToken}
          />
        )}
      </div>
    </div>
  );
}
