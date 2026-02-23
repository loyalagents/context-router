"use client";

import { gql } from "@apollo/client";
import { useQuery } from "@apollo/client/react";
import { useRouter } from "next/navigation";
import { useWorkshopAuth } from "@/lib/workshop-auth";

interface MeData {
  me: { userId: string; email: string; firstName: string; lastName: string };
}

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

export default function Dashboard() {
  const router = useRouter();
  const { isAuthenticated, logout, switchUser } = useWorkshopAuth();

  const { data, loading, error } = useQuery<MeData>(ME_QUERY, {
    skip: !isAuthenticated,
  });

  if (!isAuthenticated) {
    router.push("/");
    return null;
  }

  const userData = data?.me;

  return (
    <div className="p-10">
      <h1 className="text-2xl font-bold mb-6">Dashboard</h1>

      {loading ? (
        <p className="text-gray-500">Loading...</p>
      ) : error ? (
        <div className="p-4 bg-red-100 text-red-700 rounded mb-6">
          <p>Failed to connect to backend.</p>
          <p className="text-sm mt-2">Ensure backend is running on port 3000. Error: {error.message}</p>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="p-6 border rounded-lg bg-white shadow-sm">
            <h2 className="text-lg font-semibold mb-4">Account Information</h2>
            <div className="space-y-2">
              <p><strong>Email:</strong> {userData?.email}</p>
              <p><strong>First Name:</strong> {userData?.firstName || "Not set"}</p>
              <p><strong>Last Name:</strong> {userData?.lastName || "Not set"}</p>
              <p className="text-sm text-gray-500"><strong>User ID:</strong> {userData?.userId}</p>
            </div>
          </div>

          <div className="flex gap-4">
            <a href="/dashboard/profile" className="inline-block px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition">
              Edit Profile
            </a>
            <a href="/dashboard/preferences" className="inline-block px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700 transition">
              Preferences
            </a>
            <a href="/dashboard/chat" className="inline-block px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 transition">
              Test AI Chat
            </a>
          </div>
        </div>
      )}

      <div className="mt-6 flex gap-3">
        <button
          onClick={() => { switchUser(); router.push("/"); }}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition"
        >
          Switch User
        </button>
        <button
          onClick={() => { logout(); router.push("/"); }}
          className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 transition"
        >
          Disconnect
        </button>
      </div>
    </div>
  );
}
