import LocalPage from '@/components/local/LocalPage';
import DashboardView from '@/components/local/DashboardView';
import { redirect } from 'next/navigation';
import { gql } from '@apollo/client';
import { getClient } from '@/lib/apollo-client';
import { getAuth0 } from '@/lib/auth0';

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

export default async function Dashboard() {
  if (process.env.CONTEXT_ROUTER_WEB_MODE === 'local') return <LocalPage page="dashboard" />;
  // 1. Check Auth0 Session
  const session = await getAuth0().getSession();
  if (!session?.user) redirect('/auth/login');

  // 2. Get Token for Backend
  let accessToken;
  try {
    const tokenResult = await getAuth0().getAccessToken();
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

  return <DashboardView activePreferences={activePreferences} userData={userData} error={error} accountEmail={session.user.email} />;
}
