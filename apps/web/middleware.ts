import { NextResponse, type NextRequest } from 'next/server';
import { getAuth0 } from './lib/auth0';

export async function middleware(request: NextRequest) {
  if (process.env.CONTEXT_ROUTER_WEB_MODE === 'local') return NextResponse.next();
  return await getAuth0().middleware(request);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico, sitemap.xml, robots.txt (metadata files)
     */
    '/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)',
  ],
};
