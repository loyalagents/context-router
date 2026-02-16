"use client";

import { gql } from "@apollo/client";
import { useQuery } from "@apollo/client/react";
import { useRouter } from "next/navigation";
import { useWorkshopAuth } from "@/lib/workshop-auth";
import PreferencesClient from "./PreferencesClient";

interface Preference {
  id: string;
  slug: string;
  value: any;
  status: string;
  sourceType: string;
  confidence: number | null;
  locationId: string | null;
  category?: string;
  description?: string;
  evidence?: string;
  createdAt: string;
  updatedAt: string;
}

const ACTIVE_PREFERENCES_QUERY = gql`
  query ActivePreferences {
    activePreferences {
      id
      slug
      value
      status
      sourceType
      confidence
      locationId
      category
      description
      createdAt
      updatedAt
    }
  }
`;

const SUGGESTED_PREFERENCES_QUERY = gql`
  query SuggestedPreferences {
    suggestedPreferences {
      id
      slug
      value
      status
      sourceType
      confidence
      evidence
      locationId
      category
      description
      createdAt
      updatedAt
    }
  }
`;

export default function PreferencesPage() {
  const router = useRouter();
  const { isAuthenticated } = useWorkshopAuth();

  const { data: activeData, loading: activeLoading } = useQuery<{ activePreferences: Preference[] }>(ACTIVE_PREFERENCES_QUERY, {
    skip: !isAuthenticated,
  });

  const { data: suggestedData, loading: suggestedLoading } = useQuery<{ suggestedPreferences: Preference[] }>(SUGGESTED_PREFERENCES_QUERY, {
    skip: !isAuthenticated,
  });

  if (!isAuthenticated) {
    router.push("/");
    return null;
  }

  if (activeLoading || suggestedLoading) {
    return <div className="p-10"><p className="text-gray-500">Loading preferences...</p></div>;
  }

  return (
    <PreferencesClient
      initialActivePreferences={activeData?.activePreferences || []}
      initialSuggestedPreferences={suggestedData?.suggestedPreferences || []}
      accessToken=""
    />
  );
}
