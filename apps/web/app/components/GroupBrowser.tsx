"use client";

import { useState, useEffect } from "react";
import { gql } from "@apollo/client";
import { useLazyQuery, useMutation } from "@apollo/client/react";
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

const CREATE_GROUP_USER_MUTATION = gql`
  mutation CreateGroupUser($input: CreateGroupUserInput!) {
    createGroupUser(input: $input) {
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
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newFirstName, setNewFirstName] = useState("");
  const [newLastName, setNewLastName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [createError, setCreateError] = useState("");

  const [fetchUsers, { data, loading, error: queryError }] = useLazyQuery<{
    groupUsers: GroupUser[];
  }>(GROUP_USERS_QUERY, {
    fetchPolicy: "network-only",
  });

  const [createGroupUser, { loading: creating }] = useMutation<{
    createGroupUser: GroupUser;
  }>(CREATE_GROUP_USER_MUTATION);

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

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError("");
    try {
      const result = await createGroupUser({
        variables: {
          input: {
            apiKey: apiKey.trim(),
            firstName: newFirstName.trim(),
            lastName: newLastName.trim(),
            email: newEmail.trim(),
          },
        },
      });
      const newUser = result.data?.createGroupUser;
      if (newUser) {
        // Call login() only — page.tsx's useEffect watches isAuthenticated
        // and navigates to /dashboard, avoiding a race with React state commits
        // in async context.
        login(apiKey.trim(), newUser.userId);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to create user";
      setCreateError(message);
    }
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

          {!showCreateForm && (
            <button
              onClick={() => setShowCreateForm(true)}
              className="w-full py-2 px-4 border border-dashed border-gray-300 text-gray-600 rounded-md text-sm hover:border-blue-400 hover:text-blue-600 transition"
            >
              + New User
            </button>
          )}

          {showCreateForm && (
            <form onSubmit={handleCreateUser} className="space-y-3 pt-2 border-t border-gray-200">
              <h4 className="text-sm font-medium text-gray-700">Create New User</h4>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  placeholder="First name"
                  value={newFirstName}
                  onChange={(e) => setNewFirstName(e.target.value)}
                  required
                  className="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <input
                  type="text"
                  placeholder="Last name"
                  value={newLastName}
                  onChange={(e) => setNewLastName(e.target.value)}
                  required
                  className="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <input
                type="email"
                placeholder="Email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {createError && (
                <p className="text-red-600 text-sm">{createError}</p>
              )}
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={creating}
                  className="flex-1 py-2 px-4 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 transition disabled:opacity-50"
                >
                  {creating ? "Creating..." : "Create & Login"}
                </button>
                <button
                  type="button"
                  onClick={() => { setShowCreateForm(false); setCreateError(""); }}
                  className="py-2 px-4 border border-gray-300 text-gray-600 rounded-md text-sm hover:bg-gray-50 transition"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
