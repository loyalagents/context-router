import { Auth0Client } from '@auth0/nextjs-auth0/server';

let client: Auth0Client | undefined;
export function getAuth0(): Auth0Client {
  if (process.env.CONTEXT_ROUTER_WEB_MODE === 'local') throw new Error('Hosted authentication unavailable in local mode');
  return client ??= new Auth0Client({
  domain: process.env.AUTH0_DOMAIN!,
  clientId: process.env.AUTH0_CLIENT_ID!,
  clientSecret: process.env.AUTH0_CLIENT_SECRET!,
  secret: process.env.AUTH0_SECRET!,
  appBaseUrl: process.env.APP_BASE_URL!,
  authorizationParameters: {
    audience: process.env.AUTH0_AUDIENCE,
  },
  });
}
