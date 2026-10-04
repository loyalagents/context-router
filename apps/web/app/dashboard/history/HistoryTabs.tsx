'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { authenticatedFetch } from '@/lib/authenticated-fetch';
import { GRAPHQL_URL } from '@/lib/runtime-config';
import AuditHistoryTab from '../preferences/components/AuditHistoryTab';
import McpAccessHistoryTab from './McpAccessHistoryTab';

interface HistoryTabsProps {
  accessToken: string;
  preferenceDefinitions: Array<{
    slug: string;
    isSensitive: boolean;
  }>;
}

export default function HistoryTabs({
  accessToken,
  preferenceDefinitions,
}: HistoryTabsProps) {
  const [activeTab, setActiveTab] = useState<'audit' | 'mcp'>('audit');
  const [generation, setGeneration] = useState(0);
  const [clearing, setClearing] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [message, setMessage] = useState('');
  const [confirming, setConfirming] = useState(false);
  const pending = useRef(new AbortController());
  const mounted = useRef(false);
  const channel = useRef<BroadcastChannel | null>(null);
  const dialog = useRef<HTMLDialogElement | null>(null);
  const invalidate = useCallback(() => {
    pending.current.abort(); pending.current = new AbortController();
    setGeneration((value) => value + 1);
  }, []);
  useEffect(() => {
    mounted.current = true;
    if (typeof BroadcastChannel !== 'undefined') {
      channel.current = new BroadcastChannel('context-router.history.v1');
      channel.current.onmessage = (event) => { if (event.data === 'invalidate') invalidate(); };
    }
    const refresh = () => invalidate();
    window.addEventListener('focus', refresh); window.addEventListener('pageshow', refresh);
    return () => { mounted.current = false; pending.current.abort(); channel.current?.close(); channel.current = null; window.removeEventListener('focus', refresh); window.removeEventListener('pageshow', refresh); };
  }, [invalidate]);
  useEffect(() => { if (confirming) dialog.current?.showModal(); else dialog.current?.close(); }, [confirming]);
  const clear = async () => {
    if (confirmation !== 'CLEAR HISTORY' || clearing) return;
    setConfirming(false); setConfirmation(''); setClearing(true); setMessage(''); invalidate();
    try {
      const response = await authenticatedFetch(GRAPHQL_URL, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` }, body: JSON.stringify({ query: /* GraphQL */ `mutation ClearHistory($confirmation: String!) { clearMyHistory(confirmation: $confirmation) { status preferenceAuditEventsDeleted mcpAccessEventsDeleted } }`, variables: { confirmation: 'CLEAR HISTORY' } }) });
      const result = await response.json();
      if (!mounted.current) return;
      const status = result.data?.clearMyHistory?.status;
      if (!response.ok || result.errors || !status) throw new Error();
      setMessage(status === 'CLEARED' ? 'Both history streams cleared. Concurrent activity may add new events.' : status === 'ROLLED_BACK' ? 'History clear rolled back because of concurrent activity. Refresh and review before trying again.' : 'Clear outcome is uncertain. Refresh and review before deciding to clear again. No automatic retry was made.');
    } catch { if (mounted.current) setMessage('Clear outcome is uncertain. Refresh and review before deciding to clear again. No automatic retry was made.'); }
    finally { if (mounted.current) { invalidate(); channel.current?.postMessage('invalidate'); setClearing(false); } }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-lg border bg-white p-5 space-y-3">
        <p>Mutation and MCP access history stay until explicitly cleared. Clearing history preserves current memory, live provenance, schema, identity and client access.</p>
        <p className="text-sm text-gray-600">Old values may remain in history after Clear memory. History clearing does not erase backups, disk remnants or other clients’ transcripts.</p>
        <button type="button" disabled={clearing} onClick={() => { setConfirmation(''); setConfirming(true); }} className="text-red-700 underline disabled:opacity-50">{clearing ? 'Clearing history…' : 'Clear both history streams'}</button>
        {message && <p role="status">{message}</p>}
      </div>
      <dialog ref={dialog} onCancel={() => setConfirming(false)} className="rounded-lg p-6 max-w-xl backdrop:bg-black/40">
        <form onSubmit={(event) => { event.preventDefault(); void clear(); }} className="space-y-4">
          <h2 className="text-xl font-semibold">Clear both history streams?</h2>
          <p>This permanently deletes recorded changes and MCP access events. Current memory and client access remain. There is no undo.</p>
          <label htmlFor="history-confirmation" className="block">Type CLEAR HISTORY to confirm</label>
          <input id="history-confirmation" autoFocus value={confirmation} onChange={(event) => setConfirmation(event.target.value)} className="border rounded p-2 w-full" autoComplete="off" />
          <div className="flex gap-4"><button disabled={confirmation !== 'CLEAR HISTORY'} className="bg-red-700 text-white rounded px-4 py-2 disabled:bg-gray-400">Clear history permanently</button><button type="button" onClick={() => setConfirming(false)}>Cancel</button></div>
        </form>
      </dialog>
      <div role="tablist" aria-label="History streams" className="inline-flex rounded-lg border border-gray-200 bg-white p-1 shadow-sm">
        <button
          type="button"
          role="tab" id="audit-tab" aria-controls="audit-panel" aria-selected={activeTab === 'audit'} tabIndex={activeTab === 'audit' ? 0 : -1}
          onKeyDown={(event) => { if (['ArrowLeft', 'ArrowRight', 'End'].includes(event.key)) { event.preventDefault(); setActiveTab('mcp'); document.getElementById('mcp-tab')?.focus(); } }}
          onClick={() => setActiveTab('audit')}
          className={`rounded-md px-4 py-2 text-sm font-medium ${
            activeTab === 'audit'
              ? 'bg-gray-900 text-white'
              : 'text-gray-600 hover:bg-gray-100'
          }`}
        >
          Audit
        </button>
        <button
          type="button"
          role="tab" id="mcp-tab" aria-controls="mcp-panel" aria-selected={activeTab === 'mcp'} tabIndex={activeTab === 'mcp' ? 0 : -1}
          onKeyDown={(event) => { if (['ArrowLeft', 'ArrowRight', 'Home'].includes(event.key)) { event.preventDefault(); setActiveTab('audit'); document.getElementById('audit-tab')?.focus(); } }}
          onClick={() => setActiveTab('mcp')}
          className={`rounded-md px-4 py-2 text-sm font-medium ${
            activeTab === 'mcp'
              ? 'bg-gray-900 text-white'
              : 'text-gray-600 hover:bg-gray-100'
          }`}
        >
          MCP Access
        </button>
      </div>

      <div id="audit-panel" role="tabpanel" aria-labelledby="audit-tab" hidden={activeTab !== 'audit'}>
        <AuditHistoryTab
          key={`audit-${generation}`}
          invalidationSignal={pending.current.signal}
          accessToken={accessToken}
          preferenceDefinitions={preferenceDefinitions}
          shouldLoad={!clearing && activeTab === 'audit'}
          showHeader={false}
        />
      </div>

      <div id="mcp-panel" role="tabpanel" aria-labelledby="mcp-tab" hidden={activeTab !== 'mcp'}>
        <McpAccessHistoryTab
          key={`mcp-${generation}`}
          invalidationSignal={pending.current.signal}
          accessToken={accessToken}
          shouldLoad={!clearing && activeTab === 'mcp'}
        />
      </div>
    </div>
  );
}
