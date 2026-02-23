"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useWorkshopAuth } from "@/lib/workshop-auth";
import GroupBrowser from "./components/GroupBrowser";

type LoginMode = "browse" | "direct";

export default function Home() {
  const router = useRouter();
  const { isAuthenticated, login, apiKey: storedApiKey } = useWorkshopAuth();
  const [mode, setMode] = useState<LoginMode>("browse");
  const [apiKey, setApiKey] = useState("");
  const [userId, setUserId] = useState("");
  const [error, setError] = useState("");

  if (isAuthenticated) {
    router.push("/dashboard");
    return null;
  }

  const handleConnect = (e: React.FormEvent) => {
    e.preventDefault();
    if (!apiKey.trim() || !userId.trim()) {
      setError("Both API key and User ID are required.");
      return;
    }
    login(apiKey.trim(), userId.trim());
    router.push("/dashboard");
  };

  return (
    <div className="flex h-screen items-center justify-center bg-gray-50">
      <div className="w-full max-w-md p-8 bg-white rounded-lg shadow-md">
        <h1 className="text-3xl font-bold mb-2 text-center">Context Router</h1>
        <p className="text-gray-500 text-center mb-6">Workshop Connect</p>

        <div className="flex mb-6 border rounded-md overflow-hidden">
          <button
            onClick={() => setMode("browse")}
            className={`flex-1 py-2 text-sm font-medium ${
              mode === "browse"
                ? "bg-blue-600 text-white"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
          >
            Browse Group
          </button>
          <button
            onClick={() => setMode("direct")}
            className={`flex-1 py-2 text-sm font-medium ${
              mode === "direct"
                ? "bg-blue-600 text-white"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
          >
            Direct Login
          </button>
        </div>

        {mode === "browse" ? (
          <GroupBrowser initialApiKey={storedApiKey} />
        ) : (
          <form onSubmit={handleConnect} className="space-y-4">
            <div>
              <label htmlFor="apiKey" className="block text-sm font-medium text-gray-700 mb-1">
                API Key
              </label>
              <input
                id="apiKey"
                type="text"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="grp-a-..."
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label htmlFor="userId" className="block text-sm font-medium text-gray-700 mb-1">
                User ID
              </label>
              <input
                id="userId"
                type="text"
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                placeholder="UUID from your group"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {error && (
              <p className="text-red-600 text-sm">{error}</p>
            )}

            <button
              type="submit"
              className="w-full py-2 px-4 bg-blue-600 text-white rounded-md font-medium hover:bg-blue-700 transition"
            >
              Connect
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
