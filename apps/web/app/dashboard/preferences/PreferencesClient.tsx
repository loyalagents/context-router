'use client';

import { useState } from 'react';
import { HttpLink } from '@apollo/client';
import {
  ApolloNextAppProvider,
  ApolloClient,
  InMemoryCache,
} from '@apollo/experimental-nextjs-app-support';
import DocumentUpload from './components/DocumentUpload';
import SuggestionsList from './components/SuggestionsList';
import PreferenceItem from './components/PreferenceItem';
import SuggestionInbox from './components/SuggestionInbox';

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
  createdAt: string;
  updatedAt: string;
}

type FilterReason = 'MISSING_FIELDS' | 'DUPLICATE_KEY' | 'NO_CHANGE' | 'UNKNOWN_SLUG';

interface PreferenceSuggestion {
  id: string;
  slug: string;
  operation: 'CREATE' | 'UPDATE';
  oldValue: any;
  newValue: any;
  confidence: number;
  sourceSnippet: string;
  sourceMeta?: {
    page?: number;
    line?: number;
  };
  wasCorrected?: boolean;
  category?: string;
  description?: string;
}

interface FilteredSuggestion extends PreferenceSuggestion {
  filterReason: FilterReason;
  filterDetails?: string;
}

interface DocumentAnalysisResult {
  analysisId: string;
  suggestions: PreferenceSuggestion[];
  filteredSuggestions: FilteredSuggestion[];
  documentSummary: string | null;
  status: 'success' | 'no_matches' | 'parse_error' | 'ai_error';
  statusReason: string | null;
  filteredCount?: number;
}

interface PreferencesClientProps {
  initialActivePreferences: Preference[];
  initialSuggestedPreferences: Preference[];
  accessToken: string;
}

function createApolloClient(accessToken: string) {
  return new ApolloClient({
    link: new HttpLink({
      uri: process.env.NEXT_PUBLIC_GRAPHQL_URL || 'http://localhost:3000/graphql',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }),
    cache: new InMemoryCache(),
  });
}

function PreferencesContent({
  initialActivePreferences,
  initialSuggestedPreferences,
  accessToken,
}: PreferencesClientProps) {
  const [activePreferences, setActivePreferences] = useState<Preference[]>(initialActivePreferences);
  const [suggestedPreferences, setSuggestedPreferences] = useState<Preference[]>(initialSuggestedPreferences);
  const [analysisResult, setAnalysisResult] = useState<DocumentAnalysisResult | null>(null);

  const handleAnalysisComplete = (result: DocumentAnalysisResult) => {
    setAnalysisResult(result);
  };

  const handleClose = () => {
    setAnalysisResult(null);
  };

  const handleApplied = () => {
    setAnalysisResult(null);
    // Refresh the page to get updated preferences
    window.location.reload();
  };

  const handlePreferenceUpdate = (updated: Preference) => {
    setActivePreferences((prev) =>
      prev.map((p) => (p.id === updated.id ? updated : p))
    );
  };

  const handlePreferenceDelete = (id: string) => {
    setActivePreferences((prev) => prev.filter((p) => p.id !== id));
  };

  const handleSuggestionAccept = (acceptedPref: Preference) => {
    // Add to active preferences and remove from suggestions
    setActivePreferences((prev) => {
      const existingIdx = prev.findIndex((p) => p.slug === acceptedPref.slug);
      if (existingIdx >= 0) {
        // Update existing
        const updated = [...prev];
        updated[existingIdx] = acceptedPref;
        return updated;
      }
      return [...prev, acceptedPref];
    });
    setSuggestedPreferences((prev) => prev.filter((p) => p.id !== acceptedPref.id));
  };

  const handleSuggestionReject = (id: string) => {
    setSuggestedPreferences((prev) => prev.filter((p) => p.id !== id));
  };

  // Group preferences by category
  const groupedPreferences = activePreferences.reduce(
    (acc, pref) => {
      const category = pref.category || 'Other';
      if (!acc[category]) {
        acc[category] = [];
      }
      acc[category].push(pref);
      return acc;
    },
    {} as Record<string, Preference[]>
  );

  return (
    <div className="p-10">
      <div className="max-w-4xl">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">Preferences</h1>
          <a
            href="/dashboard"
            className="text-blue-600 hover:text-blue-800"
          >
            Back to Dashboard
          </a>
        </div>

        {/* Suggestion Inbox - Show if there are pending suggestions */}
        {suggestedPreferences.length > 0 && (
          <SuggestionInbox
            suggestions={suggestedPreferences}
            accessToken={accessToken}
            onAccept={handleSuggestionAccept}
            onReject={handleSuggestionReject}
          />
        )}

        {/* Document Upload Section */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4">Import from Document</h2>
          <p className="text-gray-600 text-sm mb-4">
            Upload a document (PDF, image, or text file) and we&apos;ll extract preferences
            for you to review.
          </p>
          {analysisResult ? (
            <SuggestionsList
              result={analysisResult}
              onClose={handleClose}
              onApplied={handleApplied}
              accessToken={accessToken}
            />
          ) : (
            <DocumentUpload
              onAnalysisComplete={handleAnalysisComplete}
              accessToken={accessToken}
            />
          )}
        </div>

        {/* Current Preferences Section */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold mb-4">Active Preferences</h2>
          {activePreferences.length === 0 ? (
            <p className="text-gray-500 text-center py-8">
              No preferences yet. Upload a document to get started!
            </p>
          ) : (
            <div className="space-y-6">
              {Object.entries(groupedPreferences).map(([category, prefs]) => (
                <div key={category}>
                  <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-2">
                    {category}
                  </h3>
                  <div className="space-y-2">
                    {prefs.map((pref) => (
                      <PreferenceItem
                        key={pref.id}
                        preference={pref}
                        accessToken={accessToken}
                        onUpdate={handlePreferenceUpdate}
                        onDelete={handlePreferenceDelete}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function PreferencesClient(props: PreferencesClientProps) {
  const makeClient = () => createApolloClient(props.accessToken);

  return (
    <ApolloNextAppProvider makeClient={makeClient}>
      <PreferencesContent {...props} />
    </ApolloNextAppProvider>
  );
}
