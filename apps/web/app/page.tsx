import LocalPage from '@/components/local/LocalPage';

export const dynamic = 'force-dynamic';
import { redirect } from 'next/navigation';
import { getAuth0 } from '@/lib/auth0';

export default async function Home() {
  if (process.env.CONTEXT_ROUTER_WEB_MODE === 'local') return <LocalPage page="dashboard" />;
  const session = await getAuth0().getSession();

  if (session?.user) {
    redirect('/dashboard');
  }

  return (
    <div className="flex h-screen items-center justify-center">
      <div className="text-center">
        <h1 className="text-4xl font-bold mb-6">Context Router</h1>
        <a href="/auth/login" className="px-6 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition">
          Log In / Sign Up
        </a>
      </div>
    </div>
  );
}
