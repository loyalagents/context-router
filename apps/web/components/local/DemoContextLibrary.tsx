'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Preference, PreferenceDefinition } from '@/app/dashboard/preferences/types';
import PreferenceItem from '@/app/dashboard/preferences/components/PreferenceItem';
import { DemoIcon } from './DemoShell';
import Link from 'next/link';

export function contextText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value) && value.every(item => typeof item === 'string')) return value.join(' · ');
  return JSON.stringify(value, null, 2) ?? '';
}

export default function DemoContextLibrary({ preferences, definitions, accessToken, onUpdate, onDelete, onInteractionChange, tools, status }: {
  preferences: Preference[]; definitions: PreferenceDefinition[]; accessToken: string;
  onUpdate: (preference: Preference) => void; onDelete: (id: string) => void;
  onInteractionChange: (active: boolean) => void;
  tools: ReactNode; status: ReactNode;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [interacting, setInteracting] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const toolsPanel = useRef<HTMLElement>(null);
  useEffect(() => { if (toolsOpen) { toolsPanel.current?.focus(); toolsPanel.current?.scrollIntoView({block:'nearest'}); } }, [toolsOpen]);
  const categories = [...new Set(preferences.map(item => item.category || 'Other'))].sort();
  const normalized = search.trim().toLowerCase();
  const filtered = preferences.filter(item => (!category || (item.category || 'Other') === category) && (!normalized || [contextText(item.value), item.category, item.description, item.slug].some(value => value?.toLowerCase().includes(normalized))));
  const ordered = categories.flatMap(name => filtered.filter(item => (item.category || 'Other') === name));
  // Identity is always the complete preference ID. A filter never retargets a draft.
  const selected = (interacting ? preferences : ordered).find(item => item.id === selectedId) ?? ordered[0];
  const choose = (id: string) => { if (!interacting) setSelectedId(id); };
  return <main className={`demo-page demo-context-page${toolsOpen ? ' demo-tools-open' : ''}`}>
    <header className="demo-page-header"><div><h1>Your context</h1><p>Memories your connected assistants can read, within the access you allow.</p></div><Link prefetch={false} className="demo-button demo-primary" href="/dashboard/permissions"><DemoIcon name="connections"/>Connect Claude Code</Link></header>
    <div className="demo-toolbar">
      <label className="demo-search"><DemoIcon name="search"/><input aria-label="Search your context" placeholder="Search your context" value={search} disabled={interacting} onChange={event => { setSearch(event.target.value); setSelectedId(null); }}/></label>
      <select className="demo-category-select" aria-label="Context category" value={category} disabled={interacting} onChange={event => {setCategory(event.target.value);setSelectedId(null);}}><option value="">All categories</option>{categories.map(name => <option key={name} value={name}>{name}</option>)}</select>
      <button className="demo-button" aria-expanded={toolsOpen} onClick={() => setToolsOpen(!toolsOpen)}><DemoIcon name="plus"/>Add or import</button>
    </div>
    {status}
    <section ref={toolsPanel} tabIndex={-1} className="demo-context-tools" aria-label="Context tools" hidden={!toolsOpen}>{tools}</section>
    <div className="demo-library">
      <section className="demo-context-list" aria-label="Saved context">
        <div className="demo-list-heading">{filtered.length} {filtered.length === 1 ? 'memory' : 'memories'}{normalized || category ? ' found' : ''}</div>
        {ordered.length ? categories.map(name => {
          const members = ordered.filter(item => (item.category || 'Other') === name);
          if (!members.length) return null;
          return <div key={name} className="demo-category-group"><h2 className="demo-category-heading">{name} <span>{members.length}</span></h2>{members.map(item => <button type="button" key={item.id} className="demo-context-row" tabIndex={selected?.id === item.id ? 0 : -1} aria-pressed={selected?.id === item.id} disabled={interacting && item.id !== selected?.id} onClick={() => choose(item.id)} onKeyDown={event => {
            if (interacting || !['ArrowDown','ArrowUp','Home','End'].includes(event.key)) return;
            event.preventDefault();
            const index = ordered.findIndex(row => row.id === item.id);
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? ordered.length - 1 : Math.max(0, Math.min(ordered.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)));
            choose(ordered[next].id);
            const buttons = event.currentTarget.closest('section')?.querySelectorAll<HTMLButtonElement>('.demo-context-row');
            buttons?.[next]?.focus();
          }}><span className="demo-context-value">{contextText(item.value)}</span></button>)}</div>;
        }) : <div className="demo-empty"><h2>{preferences.length ? 'No matching context' : 'Your context starts here'}</h2><p>{preferences.length ? 'Try a different search or category.' : 'Add a memory or import a document to get started.'}</p></div>}
      </section>
      <aside className="demo-inspector" aria-label="Context details">{selected ? <PreferenceItem key={selected.id} preference={selected} accessToken={accessToken} onUpdate={onUpdate} onDelete={id => {setInteracting(false);onInteractionChange(false);setSelectedId(null);onDelete(id);}} demoDetail definition={definitions.find(definition => definition.id === selected.definitionId)} onInteractionChange={active => {if(active) setSelectedId(selected.id);setInteracting(active);onInteractionChange(active);}}/> : <div className="demo-empty">Select a memory to see its details.</div>}</aside>
    </div>
    <div className="demo-context-footer"><span>Stored on this Mac</span><Link prefetch={false} href="/dashboard/history">View activity <DemoIcon name="arrow"/></Link></div>
  </main>;
}
