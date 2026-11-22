'use client';

import { useState, type ReactNode } from 'react';
import type { Preference, PreferenceDefinition } from '@/app/dashboard/preferences/types';
import PreferenceItem from '@/app/dashboard/preferences/components/PreferenceItem';
import { DemoIcon } from './DemoShell';

export function contextText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value) && value.every(item => typeof item === 'string')) return value.join(' · ');
  return JSON.stringify(value, null, 2) ?? '';
}

export default function DemoContextLibrary({ preferences, definitions, accessToken, onUpdate, onDelete, tools, status }: {
  preferences: Preference[]; definitions: PreferenceDefinition[]; accessToken: string;
  onUpdate: (preference: Preference) => void; onDelete: (id: string) => void;
  tools: ReactNode; status: ReactNode;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [interacting, setInteracting] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const categories = [...new Set(preferences.map(item => item.category || 'Other'))].sort();
  const normalized = search.trim().toLowerCase();
  const filtered = preferences.filter(item => (!category || (item.category || 'Other') === category) && (!normalized || [contextText(item.value), item.category, item.description, item.slug].some(value => value?.toLowerCase().includes(normalized))));
  // Identity is always the complete preference ID. A filter never retargets a draft.
  const selected = preferences.find(item => item.id === selectedId) ?? filtered[0];
  const choose = (id: string) => { if (!interacting) setSelectedId(id); };
  return <main className="demo-page">
    <header className="demo-page-header"><div><h1>Your context</h1><p>A little context. A better starting point.</p></div><a className="demo-button demo-primary" href="/dashboard/permissions"><DemoIcon name="connections"/>Connect Claude Code</a></header>
    <div className="demo-toolbar">
      <label className="demo-search"><DemoIcon name="search"/><input aria-label="Search your context" placeholder="Search your context" value={search} disabled={interacting} onChange={event => { setSearch(event.target.value); setSelectedId(null); }}/></label>
      <select className="demo-category-select" aria-label="Context category" value={category} disabled={interacting} onChange={event => {setCategory(event.target.value);setSelectedId(null);}}><option value="">All categories</option>{categories.map(name => <option key={name} value={name}>{name}</option>)}</select>
      <button className="demo-button" aria-expanded={toolsOpen} onClick={() => setToolsOpen(!toolsOpen)}><DemoIcon name="plus"/>Add or import</button>
    </div>
    {status}
    {interacting && <p className="demo-edit-notice" role="status">Save or cancel your edit before choosing another memory or changing filters.</p>}
    <div className="demo-library">
      <section className="demo-context-list" aria-label="Saved context">
        <div className="demo-list-heading">{filtered.length} {filtered.length === 1 ? 'memory' : 'memories'}{normalized || category ? ' found' : ''}</div>
        {filtered.length ? filtered.map(item => <button type="button" key={item.id} className="demo-context-row" aria-pressed={selected?.id === item.id} disabled={interacting && item.id !== selected?.id} onClick={() => choose(item.id)}><span className="demo-context-category">{item.category || 'Other'}</span><span className="demo-context-value">{contextText(item.value)}</span></button>) : <div className="demo-empty"><h2>{preferences.length ? 'No matching context' : 'Your context starts here'}</h2><p>{preferences.length ? 'Try a different search or category.' : 'Add a memory or import a document to get started.'}</p></div>}
      </section>
      <aside className="demo-inspector" aria-label="Context details">{selected ? <PreferenceItem key={selected.id} preference={selected} accessToken={accessToken} onUpdate={onUpdate} onDelete={id => {setInteracting(false);setSelectedId(null);onDelete(id);}} demoDetail definition={definitions.find(definition => definition.id === selected.definitionId)} onInteractionChange={active => {if(active) setSelectedId(selected.id);setInteracting(active);}}/> : <div className="demo-empty">Select a memory to see its details.</div>}</aside>
    </div>
    <div className="demo-context-footer"><span>{preferences.length} saved memories · Stored on this Mac</span><a href="/dashboard/history">View activity <DemoIcon name="arrow"/></a></div>
    <section className="demo-context-tools" aria-label="Context tools" hidden={!toolsOpen}>{tools}</section>
  </main>;
}
