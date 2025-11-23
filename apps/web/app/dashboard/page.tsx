import { redirect } from 'next/navigation';
import { gql } from '@apollo/client';
import { getClient } from '@/lib/apollo-client';
import { auth0 } from '@/lib/auth0';

export const dynamic = 'force-dynamic';

const ME_QUERY = gql`
  query Me {
    me {
      userId
      email
      firstName
    }
  }
`;

export default async function Dashboard() {
  // 1. Check Auth0 Session
  const session = await auth0.getSession();
  if (!session?.user) redirect('/auth/login');

  // 2. Get Token for Backend
  console.log('[DASHBOARD] Session user:', session.user);
  console.log('[DASHBOARD] Session keys:', Object.keys(session));

  let accessToken;
  try {
    const tokenResult = await auth0.getAccessToken();
    console.log('[DASHBOARD] getAccessToken() returned:', typeof tokenResult, tokenResult ? 'PRESENT' : 'MISSING');
    console.log('[DASHBOARD] Token result structure:', JSON.stringify(tokenResult, null, 2));

    // In Auth0 v4, getAccessToken() returns an object with a 'token' property
    accessToken = tokenResult?.token;
    console.log('[DASHBOARD] Extracted access token:', typeof accessToken, accessToken ? 'PRESENT' : 'MISSING');
    if (accessToken && typeof accessToken === 'string') {
      console.log('[DASHBOARD] Token length:', accessToken.length);
      console.log('[DASHBOARD] Token prefix:', accessToken.substring(0, 20) + '...');
    }
  } catch (e) {
    console.error('[DASHBOARD] getAccessToken() error:', e);
  }

  // 3. Call Backend
  let userData = null;
  let error = null;

  try {
    console.log('[DASHBOARD] Making GraphQL request to backend...');
    const { data } = await getClient().query({
      query: ME_QUERY,
      context: {
        headers: { Authorization: `Bearer ${accessToken}` }
      }
    });
    console.log('[DASHBOARD] GraphQL response received:', data);
    userData = data?.me;
  } catch (e) {
    console.error("[DASHBOARD] Backend Error:", e);
    console.error("[DASHBOARD] Error details:", JSON.stringify(e, null, 2));
    error = "Failed to connect to backend.";
  }

  return (
    <div className="p-10">
      <h1 className="text-2xl font-bold mb-4">Dashboard</h1>

      {error ? (
        <div className="p-4 bg-red-100 text-red-700 rounded">
          <p>⚠️ {error}</p>
          <p className="text-sm mt-2">Ensure backend is running on port 3000.</p>
        </div>
      ) : (
        <div className="p-4 border rounded bg-gray-50">
          <p><strong>Status:</strong> User Authenticated & Synced to DB</p>
          <p><strong>Name:</strong> {userData?.firstName || session.user.name}</p>
          <p><strong>DB ID:</strong> {userData?.userId}</p>
        </div>
      )}

      <a href="/auth/logout" className="mt-6 inline-block px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700">
        Logout
      </a>
    </div>
  );
}
