import { NextRequest, NextResponse } from 'next/server';
import { gql } from '@apollo/client';
import { getClient } from '@/lib/apollo-client';
import { auth0 } from '@/lib/auth0';
import { UpdateUserMutation } from '@/lib/generated/graphql';

const UPDATE_USER_MUTATION = gql`
  mutation UpdateUser($updateUserInput: UpdateUserInput!) {
    updateUser(updateUserInput: $updateUserInput) {
      userId
      firstName
      lastName
    }
  }
`;

export async function POST(request: NextRequest) {
  try {
    // Check authentication
    const session = await auth0.getSession();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get access token
    let accessToken;
    try {
      const tokenResult = await auth0.getAccessToken();
      accessToken = tokenResult?.token;
    } catch (e) {
      console.error('Failed to get access token:', e);
      return NextResponse.json({ error: 'Failed to get access token' }, { status: 500 });
    }

    // Parse request body
    const body = await request.json();
    const { userId, firstName, lastName } = body;

    if (!userId || !firstName || !lastName) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Call GraphQL mutation
    const { data } = await getClient().mutate<UpdateUserMutation>({
      mutation: UPDATE_USER_MUTATION,
      variables: {
        updateUserInput: {
          userId,
          firstName,
          lastName,
        },
      },
      context: {
        headers: { Authorization: `Bearer ${accessToken}` }
      }
    });

    if (!data) {
      return NextResponse.json({ error: 'No data returned from mutation' }, { status: 500 });
    }

    return NextResponse.json({ user: data.updateUser });
  } catch (error) {
    console.error('Profile update error:', error);
    return NextResponse.json(
      { error: 'Failed to update profile' },
      { status: 500 }
    );
  }
}
