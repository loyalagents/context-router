FRONTEND_USER_ONBOARDING_PLAN.mdObjectiveImplement a minimal "Log In" flow where:A user authenticates via Auth0 Universal Login.The Next.js frontend calls the NestJS backend me query.The backend auto-creates the user in the database (as already implemented).ContextRepo structure: pnpm monorepoapps/backend  → NestJS GraphQL API (Auth0 + Prisma)
apps/web      → Next.js (App Router)
Auth: Auth0 Universal Login.Behavior: Backend already auto-creates a user record when me is called with a valid Auth0 JWT.AssumptionsBackend runs on: http://localhost:3000 (NestJS default)Frontend runs on: http://localhost:3002 (Explicitly set)Auth0 Configuration Required:Update your Auth0 Application settings to match these ports:Allowed Callback URLs: http://localhost:3002/api/auth/callbackAllowed Logout URLs: http://localhost:3002/Allowed Web Origins: http://localhost:3002Step 1: Install Frontend DependenciesRun inside apps/web:pnpm add @auth0/nextjs-auth0 client-only @apollo/client @apollo/experimental-nextjs-app-support graphql
Step 2: Configure Environment VariablesCreate apps/web/.env.local:# Auth0 Config
AUTH0_SECRET='use [openssl rand -hex 32] to generate'
AUTH0_BASE_URL='http://localhost:3002'
AUTH0_ISSUER_BASE_URL='https://[YOUR_TENANT].auth0.com'
AUTH0_CLIENT_ID='[YOUR_CLIENT_ID]'
AUTH0_CLIENT_SECRET='[YOUR_CLIENT_SECRET]'

# Backend GraphQL Endpoint
# Note: Points to port 3000 (Backend)
NEXT_PUBLIC_GRAPHQL_URL='http://localhost:3000/graphql'
Step 3: Auth0 API RouteCreate apps/web/app/api/auth/[auth0]/route.ts:import { handleAuth } from '@auth0/nextjs-auth0';

export const GET = handleAuth();
Step 4: Apollo Client SetupWe need two files to handle Next.js Server Components vs Client Components.4.1 Server Client (apps/web/lib/apollo-client.ts)Used by Server Components (like page.tsx) to fetch data.import { HttpLink } from "@apollo/client";
import {
  registerApolloClient,
  ApolloClient,
  InMemoryCache,
} from "@apollo/experimental-nextjs-app-support";

export const { getClient } = registerApolloClient(() => {
  return new ApolloClient({
    cache: new InMemoryCache(),
    link: new HttpLink({
      uri: process.env.NEXT_PUBLIC_GRAPHQL_URL || "http://localhost:3000/graphql",
    }),
  });
});
4.2 Client Wrapper (apps/web/lib/apollo-wrapper.tsx)Wraps the app to allow Client Components (buttons, forms) to access GraphQL."use client";

import { HttpLink } from "@apollo/client";
import {
  ApolloNextAppProvider,
  NextSSRApolloClient,
  NextSSRInMemoryCache,
  SSRMultipartLink,
} from "@apollo/experimental-nextjs-app-support/ssr";

function makeClient() {
  const httpLink = new HttpLink({
    uri: process.env.NEXT_PUBLIC_GRAPHQL_URL || "http://localhost:3000/graphql",
  });

  return new NextSSRApolloClient({
    cache: new NextSSRInMemoryCache(),
    link:
      typeof window === "undefined"
        ? new SSRMultipartLink({ stripDefer: true })
        : httpLink,
  });
}

export function ApolloWrapper({ children }: React.PropsWithChildren) {
  return (
    <ApolloNextAppProvider makeClient={makeClient}>
      {children}
    </ApolloNextAppProvider>
  );
}
Step 5: Root Layout ConfigurationUpdate apps/web/app/layout.tsx to include providers:import { UserProvider } from '@auth0/nextjs-auth0/client';
import { ApolloWrapper } from "@/lib/apollo-wrapper";
import "./globals.css";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <UserProvider>
          <ApolloWrapper>
            {children}
          </ApolloWrapper>
        </UserProvider>
      </body>
    </html>
  );
}
Step 6: Protected Dashboard (The Trigger)Create apps/web/app/dashboard/page.tsx. This page:Forces login.Calls Backend me query (which triggers user creation).<!-- end list -->import { getSession, getAccessToken } from '@auth0/nextjs-auth0';
import { redirect } from 'next/navigation';
import { gql } from '@apollo/client';
import { getClient } from '@/lib/apollo-client';

export const dynamic = 'force-dynamic';

const ME_QUERY = gql`
  query Me {
    me {
      userId
      email
      firstName
    }
  }
`;

export default async function Dashboard() {
  // 1. Check Auth0 Session
  const session = await getSession();
  if (!session?.user) redirect('/api/auth/login');

  // 2. Get Token for Backend
  const { accessToken } = await getAccessToken();

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
      <h1 className="text-2xl font-bold mb-4">Dashboard</h1>
      
      {error ? (
        <div className="p-4 bg-red-100 text-red-700 rounded">
          <p>⚠️ {error}</p>
          <p className="text-sm mt-2">Ensure backend is running on port 3000.</p>
        </div>
      ) : (
        <div className="p-4 border rounded bg-gray-50">
          <p><strong>Status:</strong> User Authenticated & Synced to DB</p>
          <p><strong>Name:</strong> {userData?.firstName || session.user.name}</p>
          <p><strong>DB ID:</strong> {userData?.userId}</p>
        </div>
      )}

      <a href="/api/auth/logout" className="mt-6 inline-block px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700">
        Logout
      </a>
    </div>
  );
}
Step 7: Simple Landing PageCreate apps/web/app/page.tsx to redirect users.import { getSession } from '@auth0/nextjs-auth0';
import { redirect } from 'next/navigation';

export default async function Home() {
  const session = await getSession();
  
  if (session?.user) {
    redirect('/dashboard');
  }

  return (
    <div className="flex h-screen items-center justify-center">
      <div className="text-center">
        <h1 className="text-4xl font-bold mb-6">Context Router</h1>
        <a href="/api/auth/login" className="px-6 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition">
          Log In / Sign Up
        </a>
      </div>
    </div>
  );
}
