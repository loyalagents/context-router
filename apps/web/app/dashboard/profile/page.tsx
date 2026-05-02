import { redirect } from 'next/navigation';
import { auth0 } from '@/lib/auth0';
import ProfileForm from './ProfileForm';
import { gql } from '@apollo/client';
import { getClient } from '@/lib/apollo-client';

export const dynamic = 'force-dynamic';

const PROFILE_QUERY = gql`
  query ProfilePageData {
    me {
      userId
      email
    }
    activePreferences {
      id
      slug
      value
    }
  }
`;

interface ProfilePreference {
  id: string;
  slug: string;
  value: unknown;
}

interface ProfilePageDataQuery {
  me: {
    userId: string;
    email: string;
  };
  activePreferences: ProfilePreference[];
}

export default async function ProfilePage() {
  const session = await auth0.getSession();
  if (!session?.user) redirect('/auth/login');

  let accessToken;
  try {
    const tokenResult = await auth0.getAccessToken();
    accessToken = tokenResult?.token;
  } catch (e) {
    console.error('Failed to get access token:', e);
  }

  let userData = null;
  let profilePreferences: ProfilePreference[] = [];
  try {
    const { data } = await getClient().query<ProfilePageDataQuery>({
      query: PROFILE_QUERY,
      context: {
        headers: { Authorization: `Bearer ${accessToken}` }
      }
    });
    userData = data?.me;
    profilePreferences = (data?.activePreferences || []).filter((preference) =>
      preference.slug.startsWith('profile.'),
    );
  } catch (e) {
    console.error('Failed to fetch profile data:', e);
  }

  return (
    <div className="p-10">
      <div className="max-w-2xl">
        <h1 className="text-2xl font-bold mb-6">Edit Profile</h1>

        <ProfileForm
          accessToken={accessToken || ''}
          accountEmail={userData?.email || session.user.email || ''}
          initialPreferences={profilePreferences}
        />

        <a
          href="/dashboard"
          className="inline-block mt-6 text-blue-600 hover:text-blue-800"
        >
          ← Back to Dashboard
        </a>
      </div>
    </div>
  );
}
