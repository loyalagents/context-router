'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { DemoDraftContext, type DraftState } from './DemoDrafts';

export function DemoIcon({ name }: { name: 'context' | 'connections' | 'activity' | 'search' | 'plus' | 'arrow' | 'lock' }) {
  const paths = {
    context: <><path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5M3 16l9 5 9-5"/></>,
    connections: <><path d="M8 3v5m8-5v5M6 8h12v4a6 6 0 0 1-12 0V8Zm6 10v3"/></>,
    activity: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    search: <><circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/></>,
    plus: <path d="M12 5v14M5 12h14"/>,
    arrow: <path d="M5 12h14m-5-5 5 5-5 5"/>,
    lock: <><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></>,
  };
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

export default function DemoShell({ children, onLock, busy, aiState }: { children: ReactNode; onLock: () => void; busy: boolean; aiState: string }) {
  const pathname = usePathname();
  const drafts = useRef(new Map<symbol, DraftState>());
  const register = useCallback((id: symbol, state: DraftState) => {
    if (state.active || state.pending) drafts.current.set(id, state);
    else drafts.current.delete(id);
  }, []);
  useEffect(() => {
    const leave = (event: BeforeUnloadEvent) => {
      if (drafts.current.size) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', leave);
    return () => window.removeEventListener('beforeunload', leave);
  }, []);
  const more = [{ href: '/dashboard/profile', label: 'Profile' }, { href: '/dashboard/schema', label: 'Memory fields' }, { href: '/dashboard/form-fill', label: 'Form Fill' }];
  const links = [
    { href: '/dashboard', label: 'Context', icon: 'context' as const, active: pathname === '/dashboard' || pathname === '/dashboard/preferences' },
    { href: '/dashboard/permissions', label: 'Connections', icon: 'connections' as const, active: pathname === '/dashboard/permissions' },
    { href: '/dashboard/history', label: 'Activity', icon: 'activity' as const, active: pathname === '/dashboard/history' },
  ];
  return <DemoDraftContext.Provider value={register}><div className="demo-app" onClickCapture={event => {
    const link = (event.target as HTMLElement).closest('a[href]');
    if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || link.getAttribute('target') === '_blank' || link.hasAttribute('download') || !drafts.current.size) return;
    if ([...drafts.current.values()].some(draft => draft.pending)) {
      event.preventDefault(); event.stopPropagation(); window.alert('Please wait for the current save to finish before leaving.');
    } else if (!window.confirm('Leave this page and discard your unsaved edits?')) {
      event.preventDefault(); event.stopPropagation();
    }
  }}>
    <aside className="demo-sidebar" aria-label="Application sidebar">
      <Link prefetch={false} className="demo-brand" href="/dashboard"><span className="demo-logo" aria-hidden="true">cr</span>Context Router</Link>
      <nav aria-label="Main navigation">{links.map(link => <Link prefetch={false} key={link.href} href={link.href} onNavigate={() => { if (link.href === '/dashboard/history') window.dispatchEvent(new Event('context-router.activity-all')); }} aria-current={link.active ? 'page' : undefined}><DemoIcon name={link.icon}/>{link.label}</Link>)}</nav>
      <details key={pathname} className="demo-more" open={more.some(link => link.href === pathname)}><summary>More tools</summary>{more.map(link => <Link prefetch={false} key={link.href} href={link.href} aria-current={pathname === link.href ? 'page' : undefined}>{link.label}</Link>)}</details>
      <div className="demo-sidebar-bottom">
        <aside aria-label="Demo mode"><details><summary><span className="demo-badge">Synthetic demo</span></summary><div className="demo-mode-details"><strong>On this Mac · Historical 2024–2025 sample</strong><p>Edits persist. Installed local AI is used when available.</p><p>AI: {aiState} (last checked)</p><p>Use CR → Demo setup for connections, CR → Reset sample data for a fresh sample, or CR → Return to personal mode.</p><p>Clear memory and Clear history do not reset demo identity or connection credentials.</p></div></details></aside>
        <button className="demo-lock" type="button" disabled={busy} onClick={onLock}><DemoIcon name="lock"/>Lock dashboard</button>
      </div>
    </aside>
    <div className="demo-content">{children}</div>
  </div></DemoDraftContext.Provider>;
}
