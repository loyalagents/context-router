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
import ManualPreferenceForm from './components/ManualPreferenceForm';
import type {
  Preference,
  PreferenceDefinition,
  UploadBatchResult,
} from './types';

interface PreferencesClientProps {
  initialActivePreferences: Preference[];
  initialSuggestedPreferences: Preference[];
  initialPreferenceDefinitions: PreferenceDefinition[];
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
  initialPreferenceDefinitions,
  accessToken,
}: PreferencesClientProps) {
  const [activePreferences, setActivePreferences] = useState<Preference[]>(initialActivePreferences);
  const [suggestedPreferences, setSuggestedPreferences] = useState<Preference[]>(initialSuggestedPreferences);
  const [preferenceDefinitions, setPreferenceDefinitions] = useState<PreferenceDefinition[]>(
    initialPreferenceDefinitions,
  );
  const [uploadBatch, setUploadBatch] = useState<UploadBatchResult | null>(null);

  const handleAnalysisComplete = (result: UploadBatchResult) => {
    setUploadBatch(result);
  };

  const handleClose = () => {
    setUploadBatch(null);
  };

  const handleApplied = () => {
    setUploadBatch(null);
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

  const handleSuggestionAccept = (
    acceptedPref: Preference,
    originalSuggestionId: string
  ) => {
    // Add to active preferences and remove from suggestions
    setActivePreferences((prev) => {
      const existingIdx = prev.findIndex((p) => p.slug === acceptedPref.slug);
      if (existingIdx >= 0) {
        const updated = [...prev];
        updated[existingIdx] = acceptedPref;
        return updated;
      }
      return [...prev, acceptedPref];
    });
    setSuggestedPreferences((prev) =>
      prev.filter((p) => p.id !== originalSuggestionId)
    );
  };

  const handleSuggestionReject = (id: string) => {
    setSuggestedPreferences((prev) => prev.filter((p) => p.id !== id));
  };

  const handleManualPreferenceSaved = (
    savedPreference: Preference,
    createdDefinition?: PreferenceDefinition,
  ) => {
    setActivePreferences((prev) => {
      const existingIndex = prev.findIndex(
        (preference) => preference.slug === savedPreference.slug,
      );

      if (existingIndex >= 0) {
        const updated = [...prev];
        updated[existingIndex] = savedPreference;
        return updated;
      }

      return [...prev, savedPreference];
    });

    if (createdDefinition) {
      setPreferenceDefinitions((prev) => [...prev, createdDefinition]);
    }
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
          <h2 className="text-lg font-semibold mb-4">Import from Documents</h2>
          <p className="text-gray-600 text-sm mb-4">
            Upload documents (PDFs, images, or text files) and we&apos;ll extract preferences
            for you to review.
          </p>
          {uploadBatch ? (
            <SuggestionsList
              batch={uploadBatch}
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

        <ManualPreferenceForm
          accessToken={accessToken}
          definitions={preferenceDefinitions}
          onSaved={handleManualPreferenceSaved}
        />

        {/* Current Preferences Section */}
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
            <h2 className="text-lg font-semibold">Active Preferences</h2>
            <a
              href="/dashboard/history"
              className="text-sm text-blue-600 hover:text-blue-800"
            >
              View Audit History
            </a>
          </div>
          {activePreferences.length === 0 ? (
            <p className="text-gray-500 text-center py-8">
              No preferences yet. Upload documents to get started!
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
