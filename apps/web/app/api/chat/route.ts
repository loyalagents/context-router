import { NextRequest, NextResponse } from 'next/server';
import { auth0 } from '@/lib/auth0';
import { getClient } from '@/lib/apollo-client';
import { gql } from '@apollo/client';

const ASK_VERTEX_AI = gql`
  query AskVertexAI($message: String!) {
    askVertexAI(message: $message)
  }
`;

export async function POST(request: NextRequest) {
  try {
    // Check authentication
    const session = await auth0.getSession();
    if (!session?.user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Get access token
    let accessToken;
    try {
      const tokenResult = await auth0.getAccessToken();
      accessToken = tokenResult?.token;
    } catch (e) {
      console.error('Failed to get access token:', e);
      return NextResponse.json(
        { error: 'Failed to authenticate with backend' },
        { status: 401 }
      );
    }

    const { message } = await request.json();

    if (!message || typeof message !== 'string') {
      return NextResponse.json(
        { error: 'Message is required' },
        { status: 400 }
      );
    }

    // Call GraphQL API with authorization
    const client = await getClient();
    const { data } = await client.query({
      query: ASK_VERTEX_AI,
      variables: { message },
      context: {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    });

    return NextResponse.json({ response: data.askVertexAI });
  } catch (error) {
    console.error('Chat API error:', error);
    return NextResponse.json(
      { error: 'Failed to get response from AI' },
      { status: 500 }
    );
  }
}
