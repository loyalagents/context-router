'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

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
  const links = [
    { href: '/dashboard', label: 'Context', icon: 'context' as const, active: pathname === '/dashboard' || pathname === '/dashboard/preferences' },
    { href: '/dashboard/permissions', label: 'Connections', icon: 'connections' as const, active: pathname === '/dashboard/permissions' },
    { href: '/dashboard/history', label: 'Activity', icon: 'activity' as const, active: pathname === '/dashboard/history' },
  ];
  return <div className="demo-app">
    <aside className="demo-sidebar" aria-label="Application sidebar">
      <a className="demo-brand" href="/dashboard"><span className="demo-logo">cr</span>Context Router</a>
      <nav aria-label="Main navigation">{links.map(link => <a key={link.href} href={link.href} aria-current={link.active ? 'page' : undefined}><DemoIcon name={link.icon}/>{link.label}</a>)}</nav>
      <details className="demo-more"><summary>More tools</summary><a href="/dashboard/profile">Profile</a><a href="/dashboard/schema">Preference Schema</a><a href="/dashboard/form-fill">Form Fill</a></details>
      <div className="demo-sidebar-bottom">
        <aside aria-label="Demo mode"><details><summary><span className="demo-badge">Synthetic demo</span></summary><div className="demo-mode-details"><strong>Historical 2024–2025 sample</strong><p>Edits persist. Installed local AI is used when available.</p><p>Use CR → Demo setup for clients, CR → Reset sample data for a fresh sample, or CR → Return to personal mode.</p><p>Clear memory and Clear history do not reset demo identity or client tokens.</p></div></details></aside>
        <details className="demo-runtime"><summary>On this Mac</summary><p>AI: {aiState} (last checked)</p></details>
        <button className="demo-lock" type="button" disabled={busy} onClick={onLock}><DemoIcon name="lock"/>Lock dashboard</button>
      </div>
    </aside>
    <div className="demo-content">{children}</div>
  </div>;
}
