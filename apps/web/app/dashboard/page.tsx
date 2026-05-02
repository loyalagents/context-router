import { redirect } from 'next/navigation';
import { gql } from '@apollo/client';
import { getClient } from '@/lib/apollo-client';
import { auth0 } from '@/lib/auth0';

export const dynamic = 'force-dynamic';

const DASHBOARD_QUERY = gql`
  query DashboardPageData {
    me {
      userId
      email
    }
    activePreferences {
      slug
      value
    }
  }
`;

interface DashboardPreference {
  slug: string;
  value: unknown;
}

interface DashboardPageDataQuery {
  me: {
    userId: string;
    email: string;
  };
  activePreferences: DashboardPreference[];
}

function getPreferenceValue(
  preferences: DashboardPreference[],
  slug: string,
): string | null {
  const value = preferences.find((preference) => preference.slug === slug)?.value;
  return typeof value === 'string' && value.trim() ? value : null;
}

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
  let activePreferences: DashboardPreference[] = [];
  let error = null;

  try {
    const { data } = await getClient().query<DashboardPageDataQuery>({
      query: DASHBOARD_QUERY,
      context: {
        headers: { Authorization: `Bearer ${accessToken}` }
      }
    });
    userData = data?.me;
    activePreferences = data?.activePreferences || [];
  } catch (e) {
    console.error("Backend Error:", e);
    error = "Failed to connect to backend.";
  }

  const fullName = getPreferenceValue(activePreferences, 'profile.full_name');
  const contactEmail = getPreferenceValue(activePreferences, 'profile.email');
  const company = getPreferenceValue(activePreferences, 'profile.company');
  const title = getPreferenceValue(activePreferences, 'profile.title');

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
              <p><strong>Account Email:</strong> {userData?.email || session.user.email}</p>
              <p className="text-sm text-gray-500"><strong>User ID:</strong> {userData?.userId}</p>
            </div>
          </div>

          <div className="p-6 border rounded-lg bg-white shadow-sm">
            <h2 className="text-lg font-semibold mb-4">Profile Memory</h2>
            <div className="space-y-2">
              <p><strong>Full Name:</strong> {fullName || 'Not set'}</p>
              <p><strong>Contact Email:</strong> {contactEmail || 'Not set'}</p>
              <p><strong>Company:</strong> {company || 'Not set'}</p>
              <p><strong>Title:</strong> {title || 'Not set'}</p>
            </div>
          </div>

          <div className="flex flex-wrap gap-4">
            <a
              href="/dashboard/profile"
              className="inline-block px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition"
            >
              Edit Profile
            </a>
            <a
              href="/dashboard/preferences"
              className="inline-block px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700 transition"
            >
              Preferences
            </a>
            <a
              href="/dashboard/search-lab"
              className="inline-block px-4 py-2 bg-teal-600 text-white rounded hover:bg-teal-700 transition"
            >
              Search Lab
            </a>
            <a
              href="/dashboard/history"
              className="inline-block px-4 py-2 bg-sky-600 text-white rounded hover:bg-sky-700 transition"
            >
              Audit History
            </a>
            <a
              href="/dashboard/chat"
              className="inline-block px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 transition"
            >
              Test AI Chat
            </a>
            <a
              href="/dashboard/schema"
              className="inline-block px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700 transition"
            >
              Preference Schema
            </a>
            <a
              href="/dashboard/permissions"
              className="inline-block px-4 py-2 bg-amber-600 text-white rounded hover:bg-amber-700 transition"
            >
              Permission Grants
            </a>
          </div>
        </div>
      )}

      <a href="/auth/logout" className="mt-6 inline-block px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 transition">
        Logout
      </a>
    </div>
  );
}
