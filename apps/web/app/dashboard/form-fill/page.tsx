import { redirect } from 'next/navigation';
import { auth0 } from '@/lib/auth0';
import FormFillClient from './FormFillClient';

export const dynamic = 'force-dynamic';

export default async function FormFillPage() {
  const session = await auth0.getSession();
  if (!session?.user) redirect('/auth/login');

  let accessToken = '';
  try {
    const tokenResult = await auth0.getAccessToken();
    accessToken = tokenResult?.token || '';
  } catch (error) {
    console.error('Failed to get access token:', error);
    redirect('/auth/login');
  }

  return (
    <div className="p-10">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Form Fill</h1>
          <p className="text-sm text-gray-500 mt-1">
            Upload a fillable PDF and download a memory-filled copy.
          </p>
        </div>
        <a href="/dashboard" className="text-blue-600 hover:text-blue-800">
          Back to Dashboard
        </a>
      </div>

      <FormFillClient accessToken={accessToken} />
    </div>
  );
}
