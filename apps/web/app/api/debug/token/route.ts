import { NextResponse } from 'next/server';
import { auth0 } from '@/lib/auth0';

export async function GET() {
  try {
    const session = await auth0.getSession();
    if (!session?.user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const tokenResult = await auth0.getAccessToken();
    const accessToken = tokenResult?.token;

    return NextResponse.json({
      token: accessToken,
      user: session.user,
      // Include token info for debugging
      tokenLength: accessToken?.length,
      tokenPrefix: accessToken?.substring(0, 50) + '...',
    });
  } catch (error) {
    console.error('Error getting token:', error);
    return NextResponse.json({ error: 'Failed to get token' }, { status: 500 });
  }
}
