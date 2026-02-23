"use client";

import { useState, useEffect } from "react";
import { gql } from "@apollo/client";
import { useLazyQuery } from "@apollo/client/react";
import { useRouter } from "next/navigation";
import { useWorkshopAuth } from "@/lib/workshop-auth";

const GROUP_USERS_QUERY = gql`
  query GroupUsers($apiKey: String!) {
    groupUsers(apiKey: $apiKey) {
      userId
      email
      firstName
      lastName
    }
  }
`;

interface GroupUser {
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
}

interface GroupBrowserProps {
  initialApiKey?: string | null;
}

export default function GroupBrowser({ initialApiKey }: GroupBrowserProps) {
  const router = useRouter();
  const { login } = useWorkshopAuth();
  const [apiKey, setApiKey] = useState(initialApiKey || "");
  const [error, setError] = useState("");

  const [fetchUsers, { data, loading, error: queryError }] = useLazyQuery<{
    groupUsers: GroupUser[];
  }>(GROUP_USERS_QUERY, {
    fetchPolicy: "network-only",
  });

  useEffect(() => {
    if (initialApiKey) {
      fetchUsers({ variables: { apiKey: initialApiKey } });
    }
  }, [initialApiKey, fetchUsers]);

  const handleLookup = (e: React.FormEvent) => {
    e.preventDefault();
    if (!apiKey.trim()) {
      setError("API key is required.");
      return;
    }
    setError("");
    fetchUsers({ variables: { apiKey: apiKey.trim() } });
  };

  const handleSelectUser = (user: GroupUser) => {
    login(apiKey.trim(), user.userId);
    router.push("/dashboard");
  };

  const users = data?.groupUsers;

  return (
    <div>
      {!users && (
        <form onSubmit={handleLookup} className="space-y-4">
          <div>
            <label
              htmlFor="browseApiKey"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              API Key
            </label>
            <input
              id="browseApiKey"
              type="text"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="grp-a-..."
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {(error || queryError) && (
            <p className="text-red-600 text-sm">
              {error || queryError?.message}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2 px-4 bg-blue-600 text-white rounded-md font-medium hover:bg-blue-700 transition disabled:opacity-50"
          >
            {loading ? "Loading..." : "Browse Group"}
          </button>
        </form>
      )}

      {users && (
        <div className="space-y-3">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-medium text-gray-700">
              Select a user ({users.length})
            </h3>
          </div>

          {users.length === 0 ? (
            <p className="text-gray-500 text-sm">
              No users found for this API key.
            </p>
          ) : (
            <ul className="space-y-2">
              {users.map((user) => (
                <li key={user.userId}>
                  <button
                    onClick={() => handleSelectUser(user)}
                    className="w-full text-left p-3 border rounded-md hover:bg-blue-50 hover:border-blue-300 transition"
                  >
                    <p className="font-medium">
                      {user.firstName} {user.lastName}
                    </p>
                    <p className="text-sm text-gray-500">{user.email}</p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
