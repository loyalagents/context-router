'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { HttpLink } from '@apollo/client';
import {
  ApolloNextAppProvider,
  ApolloClient,
  InMemoryCache,
} from '@apollo/experimental-nextjs-app-support';
import { authenticatedFetch, localGraphql } from '@/lib/authenticated-fetch';
import { useLocalSession } from '@/components/local/LocalSession';
import { GRAPHQL_URL } from '@/lib/runtime-config';
import PreferenceSearch from '@/components/local/PreferenceSearch';
import DemoContextLibrary from '@/components/local/DemoContextLibrary';
import DocumentUpload from './components/DocumentUpload';
import SuggestionsList from './components/SuggestionsList';
import PreferenceItem from './components/PreferenceItem';
import SuggestionInbox from './components/SuggestionInbox';
import ManualPreferenceForm from './components/ManualPreferenceForm';
import MemoryResetPanel from './components/MemoryResetPanel';
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
  allowDemoReset: boolean;
}

const SAVED_PREFERENCES_QUERY = /* GraphQL */ `
  query LocalSavedPreferences($includeCatalog: Boolean!) {
    preferenceCatalog @include(if: $includeCatalog) { id slug namespace displayName ownerUserId description valueType scope options isSensitive isCore category }
    activePreferences {
      id
      slug
      definitionId
      value
      status
      sourceType
      lastModifiedBy { actorType actorClientKey origin }
      confidence
      locationId
      category
      description
      createdAt
      updatedAt
    }
  }
`;

function createApolloClient(accessToken: string) {
  return new ApolloClient({
    link: new HttpLink({
      uri: GRAPHQL_URL,
      fetch: authenticatedFetch,
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
  allowDemoReset,
}: PreferencesClientProps) {
  const session = useLocalSession();
  const local = !!session;
  const demo = session?.capabilities.runtime?.mode === 'demo';
  const [activePreferences, setActivePreferences] = useState<Preference[]>(initialActivePreferences);
  const [suggestedPreferences, setSuggestedPreferences] = useState<Preference[]>(initialSuggestedPreferences);
  const [preferenceDefinitions, setPreferenceDefinitions] = useState<PreferenceDefinition[]>(
    initialPreferenceDefinitions,
  );
  const [uploadBatch, setUploadBatch] = useState<UploadBatchResult | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<'passive' | 'explicit' | null>(null);
  const refreshRequest = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const interacting = useRef(false);
  const passiveRequest = useRef<AbortController | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      refreshRequest.current?.abort();
      refreshRequest.current = null;
    };
  }, [accessToken]);

  // This callback returns no mutation result and never propagates read failures.
  const refreshSavedPreferences = useCallback((passive = false) => {
    if (!local || !mounted.current || (passive && interacting.current)) return;
    refreshRequest.current?.abort();
    const controller = new AbortController();
    refreshRequest.current = controller;
    passiveRequest.current = passive ? controller : null;
    setRefreshing(!passive);
    setRefreshError(null);
    const current = () => mounted.current && !controller.signal.aborted && refreshRequest.current === controller && (!passive || !interacting.current);
    void localGraphql<{ activePreferences: Preference[]; preferenceCatalog?: PreferenceDefinition[] }>(SAVED_PREFERENCES_QUERY, { includeCatalog: demo }, controller.signal)
      .then((data) => {
        if (current()) { setActivePreferences(data.activePreferences);if (data.preferenceCatalog) setPreferenceDefinitions(data.preferenceCatalog); }
      })
      .catch(() => {
        if (current()) setRefreshError(passive ? 'passive' : 'explicit');
      })
      .finally(() => {
        if (current()) {
          refreshRequest.current = null;
          setRefreshing(false);
        }
      });
  }, [local, demo]);

  const onContextInteraction = (active: boolean) => {
    interacting.current = active;
    if (active && passiveRequest.current && refreshRequest.current === passiveRequest.current) {
      passiveRequest.current.abort();refreshRequest.current = null;passiveRequest.current = null;setRefreshing(false);
    }
  };
  useEffect(() => {
    if (!demo) return;
    const refresh = () => { if (document.visibilityState === 'visible') refreshSavedPreferences(true); };
    window.addEventListener('focus', refresh);window.addEventListener('pageshow', refresh);document.addEventListener('visibilitychange', refresh);
    return () => { window.removeEventListener('focus', refresh);window.removeEventListener('pageshow', refresh);document.removeEventListener('visibilitychange', refresh); };
  }, [demo, refreshSavedPreferences]);

  // A read begun before a manual write completed may contain an older snapshot.
  // Replace only an in-flight read; the confirmed manual result updates immediately.
  const reconcileManualChange = () => {
    if (refreshRequest.current) refreshSavedPreferences();
  };

  const handleAnalysisComplete = (result: UploadBatchResult) => {
    setUploadBatch(result);
  };

  const handleClose = () => {
    setUploadBatch(null);
  };

  const handleApplied = () => {
    if (local) {
      refreshSavedPreferences();
      return;
    }
    setUploadBatch(null);
    // Refresh the page to get updated preferences
    window.location.reload();
  };

  const handlePreferenceUpdate = (updated: Preference) => {
    reconcileManualChange();
    setActivePreferences((prev) =>
      prev.map((p) => (p.id === updated.id ? updated : p))
    );
  };

  const handlePreferenceDelete = (id: string) => {
    reconcileManualChange();
    setActivePreferences((prev) => prev.filter((p) => p.id !== id));
  };

  const handleSuggestionAccept = (
    acceptedPref: Preference,
    originalSuggestionId: string
  ) => {
    reconcileManualChange();
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
    reconcileManualChange();
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

  if (demo) return <DemoContextLibrary preferences={activePreferences} definitions={preferenceDefinitions} accessToken={accessToken} onUpdate={handlePreferenceUpdate} onDelete={handlePreferenceDelete} onInteractionChange={onContextInteraction}
    status={<>{refreshing && <p role="status" className="demo-edit-notice">Refreshing saved preferences…</p>}{refreshError && <div role={refreshError === 'passive' ? 'status' : 'alert'} className={refreshError === 'passive' ? 'mb-4 text-sm text-gray-500' : 'mb-4 text-red-700'}><p>{refreshError === 'passive' ? 'Context may be out of date. Could not refresh in the background.' : 'Saved preferences could not refresh. Apply outcomes are unchanged; the list may be out of date.'}</p><button onClick={() => refreshSavedPreferences()} className="underline">Retry saved preferences refresh</button></div>}</>}
    tools={<>
      <details open><summary>Add a memory</summary><div><ManualPreferenceForm accessToken={accessToken} definitions={preferenceDefinitions} onSaved={handleManualPreferenceSaved}/></div></details>
      <details><summary>Import from Documents</summary><div>{uploadBatch ? <SuggestionsList batch={uploadBatch} onClose={handleClose} onApplied={handleApplied} accessToken={accessToken}/> : <DocumentUpload onAnalysisComplete={handleAnalysisComplete} accessToken={accessToken}/>}</div></details>
      {suggestedPreferences.length > 0 && <details><summary>Review suggestions ({suggestedPreferences.length})</summary><div><SuggestionInbox suggestions={suggestedPreferences} accessToken={accessToken} onAccept={handleSuggestionAccept} onReject={handleSuggestionReject}/></div></details>}
      <details><summary>AI-assisted search</summary><div><PreferenceSearch preferences={activePreferences} definitions={preferenceDefinitions}/></div></details>
      <details><summary>Memory maintenance</summary><div><MemoryResetPanel accessToken={accessToken} allowDemoReset={allowDemoReset}/></div></details>
    </>}/>;

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
            Import supported documents to extract preference proposals for you to review.
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

        <PreferenceSearch preferences={activePreferences} definitions={preferenceDefinitions} />

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
          {refreshing && <p role="status" className="mb-4 text-sm text-gray-600">Refreshing saved preferences…</p>}
          {refreshError && (
            <div role="alert" className="mb-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              <p>Saved preferences could not refresh. Apply outcomes are unchanged; the list may be out of date.</p>
              <button onClick={() => refreshSavedPreferences()} className="mt-2 underline">Retry saved preferences refresh</button>
            </div>
          )}
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

        <MemoryResetPanel
          accessToken={accessToken}
          allowDemoReset={allowDemoReset}
        />
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
