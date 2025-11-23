import { redirect } from 'next/navigation';
import { auth0 } from '@/lib/auth0';
import ProfileForm from './ProfileForm';
import { gql } from '@apollo/client';
import { getClient } from '@/lib/apollo-client';
import { MeQueryResponse } from '@/lib/types/graphql';

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
  try {
    const { data } = await getClient().query<MeQueryResponse>({
      query: ME_QUERY,
      context: {
        headers: { Authorization: `Bearer ${accessToken}` }
      }
    });
    userData = data?.me;
  } catch (e) {
    console.error("Failed to fetch user data:", e);
  }

  return (
    <div className="p-10">
      <div className="max-w-2xl">
        <h1 className="text-2xl font-bold mb-6">Edit Profile</h1>

        <ProfileForm
          userId={userData?.userId}
          initialFirstName={userData?.firstName || ''}
          initialLastName={userData?.lastName || ''}
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
