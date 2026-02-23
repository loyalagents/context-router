"use client";

import { gql } from "@apollo/client";
import { useQuery } from "@apollo/client/react";
import { useRouter } from "next/navigation";
import { useWorkshopAuth } from "@/lib/workshop-auth";

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

function ValueTypeBadge({ type }: { type: string }) {
  const colors: Record<string, string> = {
    STRING: "bg-blue-100 text-blue-800",
    BOOLEAN: "bg-green-100 text-green-800",
    ENUM: "bg-purple-100 text-purple-800",
    ARRAY: "bg-orange-100 text-orange-800",
  };
  return (
    <span className={`inline-block px-2 py-0.5 text-xs font-medium rounded ${colors[type] || "bg-gray-100 text-gray-800"}`}>
      {type}
    </span>
  );
}

function ScopeBadge({ scope }: { scope: string }) {
  const isLocation = scope === "LOCATION";
  return (
    <span className={`inline-block px-2 py-0.5 text-xs font-medium rounded ${isLocation ? "bg-yellow-100 text-yellow-800" : "bg-gray-100 text-gray-700"}`}>
      {scope}
    </span>
  );
}

export default function SchemaPage() {
  const router = useRouter();
  const { isAuthenticated } = useWorkshopAuth();

  const { data, loading, error } = useQuery<PreferenceCatalogQuery>(
    PREFERENCE_CATALOG_QUERY,
    { skip: !isAuthenticated },
  );

  if (!isAuthenticated) {
    router.push("/");
    return null;
  }

  const catalog = data?.preferenceCatalog || [];

  // Group by category
  const grouped = catalog.reduce(
    (acc, def) => {
      const cat = def.category;
      if (!acc[cat]) acc[cat] = [];
      acc[cat].push(def);
      return acc;
    },
    {} as Record<string, PreferenceDefinition[]>,
  );

  const sortedCategories = Object.keys(grouped).sort();

  return (
    <div className="p-10">
      <div className="max-w-4xl">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">Preference Schema</h1>
          <a href="/dashboard" className="text-blue-600 hover:text-blue-800">
            Back to Dashboard
          </a>
        </div>

        <p className="text-gray-600 mb-6">
          All available preference slugs and their definitions. These define what preferences can be set for users.
        </p>

        {loading ? (
          <p className="text-gray-500">Loading...</p>
        ) : error ? (
          <div className="p-4 bg-red-100 text-red-700 rounded mb-6">
            <p>Failed to load preference schema.</p>
            <p className="text-sm mt-2">Ensure backend is running on port 3000. Error: {error.message}</p>
          </div>
        ) : (
          <div className="space-y-6">
            {sortedCategories.map((category) => (
              <div key={category} className="bg-white rounded-lg shadow p-6">
                <h2 className="text-lg font-semibold mb-4 capitalize">{category}</h2>
                <div className="space-y-4">
                  {grouped[category].map((def) => (
                    <div key={def.slug} className="border rounded-lg p-4">
                      <div className="flex items-start justify-between mb-2">
                        <code className="text-sm font-mono font-semibold text-gray-900">
                          {def.slug}
                        </code>
                        <div className="flex gap-2">
                          <ValueTypeBadge type={def.valueType} />
                          <ScopeBadge scope={def.scope} />
                        </div>
                      </div>
                      <p className="text-sm text-gray-600 mb-2">{def.description}</p>
                      {def.options && (
                        <div className="mt-2">
                          <span className="text-xs text-gray-500 font-medium">Options: </span>
                          <span className="text-xs text-gray-700">
                            {def.options.join(", ")}
                          </span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}

            <div className="text-sm text-gray-500 text-center pt-2">
              {catalog.length} preference definitions across {sortedCategories.length} categories
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
