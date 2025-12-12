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

interface Preference {
  preferenceId: string;
  category: string;
  key: string;
  value: any;
  createdAt: string;
  updatedAt: string;
}

type FilterReason = 'MISSING_FIELDS' | 'DUPLICATE_KEY' | 'NO_CHANGE';

interface PreferenceSuggestion {
  id: string;
  category: string;
  key: string;
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
  initialPreferences: Preference[];
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
  initialPreferences,
  accessToken,
}: PreferencesClientProps) {
  const [preferences, setPreferences] = useState<Preference[]>(initialPreferences);
  const [analysisResult, setAnalysisResult] = useState<DocumentAnalysisResult | null>(
    null
  );

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
    setPreferences((prev) =>
      prev.map((p) => (p.preferenceId === updated.preferenceId ? updated : p))
    );
  };

  const handlePreferenceDelete = (preferenceId: string) => {
    setPreferences((prev) => prev.filter((p) => p.preferenceId !== preferenceId));
  };

  // Group preferences by category
  const groupedPreferences = preferences.reduce(
    (acc, pref) => {
      if (!acc[pref.category]) {
        acc[pref.category] = [];
      }
      acc[pref.category].push(pref);
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
          <h2 className="text-lg font-semibold mb-4">Current Preferences</h2>
          {preferences.length === 0 ? (
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
                        key={pref.preferenceId}
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
