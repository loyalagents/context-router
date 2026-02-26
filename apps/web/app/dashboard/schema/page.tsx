"use client";

import { gql } from "@apollo/client";
import { useQuery } from "@apollo/client/react";
import { useRouter } from "next/navigation";
import { useWorkshopAuth } from "@/lib/workshop-auth";
import SchemaClient from "./SchemaClient";

const PREFERENCE_CATALOG_QUERY = gql`
  query PreferenceCatalog {
    preferenceCatalog {
      slug
      description
      valueType
      scope
      options
      isSensitive
      isCore
      category
    }
  }
`;

interface PreferenceDefinition {
  slug: string;
  description: string;
  valueType: "STRING" | "BOOLEAN" | "ENUM" | "ARRAY";
  scope: "GLOBAL" | "LOCATION";
  options: string[] | null;
  isSensitive: boolean;
  isCore: boolean;
  category: string;
}

interface PreferenceCatalogQuery {
  preferenceCatalog: PreferenceDefinition[];
}

export default function SchemaPage() {
  const router = useRouter();
  const { isAuthenticated, apiKey, userId } = useWorkshopAuth();

  const { data, loading, error } = useQuery<PreferenceCatalogQuery>(
    PREFERENCE_CATALOG_QUERY,
    { skip: !isAuthenticated },
  );

  if (!isAuthenticated) {
    router.push("/");
    return null;
  }

  const catalog = data?.preferenceCatalog || [];

  return (
    <div className="p-10">
      <div className="max-w-4xl">
        {loading ? (
          <p className="text-gray-500">Loading...</p>
        ) : error ? (
          <>
            <div className="flex items-center justify-between mb-6">
              <h1 className="text-2xl font-bold">Preference Schema</h1>
              <a href="/dashboard" className="text-blue-600 hover:text-blue-800">
                Back to Dashboard
              </a>
            </div>
            <div className="p-4 bg-red-100 text-red-700 rounded mb-6">
              <p>Failed to load preference schema.</p>
              <p className="text-sm mt-2">Ensure backend is running on port 3000. Error: {error.message}</p>
            </div>
          </>
        ) : (
          <SchemaClient initialCatalog={catalog} accessToken={apiKey || ""} userId={userId || ""} />
        )}
      </div>
    </div>
  );
}
