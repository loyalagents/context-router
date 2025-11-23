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
      lastName
    }
  }
`;

export default async function Dashboard() {
  // 1. Check Auth0 Session
  const session = await auth0.getSession();
  if (!session?.user) redirect('/auth/login');

  // 2. Get Token for Backend
  let accessToken;
  try {
    const tokenResult = await auth0.getAccessToken();
    accessToken = tokenResult?.token;
  } catch (e) {
    console.error('Failed to get access token:', e);
  }

  // 3. Call Backend
  let userData = null;
  let error = null;

  try {
    const { data } = await getClient().query({
      query: ME_QUERY,
      context: {
        headers: { Authorization: `Bearer ${accessToken}` }
      }
    });
    userData = data?.me;
  } catch (e) {
    console.error("Backend Error:", e);
    error = "Failed to connect to backend.";
  }

  return (
    <div className="p-10">
      <h1 className="text-2xl font-bold mb-6">Dashboard</h1>

      {error ? (
        <div className="p-4 bg-red-100 text-red-700 rounded mb-6">
          <p>⚠️ {error}</p>
          <p className="text-sm mt-2">Ensure backend is running on port 3000.</p>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="p-6 border rounded-lg bg-white shadow-sm">
            <h2 className="text-lg font-semibold mb-4">Account Information</h2>
            <div className="space-y-2">
              <p><strong>Email:</strong> {userData?.email || session.user.email}</p>
              <p><strong>First Name:</strong> {userData?.firstName || 'Not set'}</p>
              <p><strong>Last Name:</strong> {userData?.lastName || 'Not set'}</p>
              <p className="text-sm text-gray-500"><strong>User ID:</strong> {userData?.userId}</p>
            </div>
          </div>

          <a
            href="/dashboard/profile"
            className="inline-block px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition"
          >
            Edit Profile
          </a>
        </div>
      )}

      <a href="/auth/logout" className="mt-6 inline-block px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 transition">
        Logout
      </a>
    </div>
  );
}
