'use client';

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import {
  enableLocalBrowser,
  localJson,
  localTransport,
} from '@/lib/authenticated-fetch';

export interface LocalCapabilities {
  remainingMilliseconds: number;
  operations: {
    analysis: { mimeTypes: string[]; maxFileSizeBytes: number };
    formFill: { mimeTypes: string[]; maxFileSizeBytes: number };
    search: boolean;
    strictExecutionControls: boolean;
  };
  capabilities: {
    text: boolean;
    structured: boolean;
    strictExecutionControls: boolean;
    fileMimeTypes: string[];
  };
  status: {
    state: 'available' | 'unavailable' | 'busy' | 'unsupported';
    configured: boolean;
  };
}
const SessionContext = createContext<{
  token: string;
  capabilities: LocalCapabilities;
  refresh: () => Promise<void>;
} | null>(null);
const storageKey = 'context-router.browser-session.v1';
export const useLocalSession = () => useContext(SessionContext);

export default function LocalSession({ children }: { children: ReactNode }) {
  const [token, setToken] = useState('');
  const [capabilities, setCapabilities] = useState<LocalCapabilities | null>(
    null,
  );
  const [ready, setReady] = useState(false);
  const [bootstrap, setBootstrap] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  const epoch = useRef(0);
  const expiryTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const deadline = useRef({ monotonic: 0, wall: 0 });
  const forget = () => {
    epoch.current++;
    clearTimeout(expiryTimer.current);
    localTransport.clear();
    try {
      sessionStorage.removeItem(storageKey);
    } catch {
      /* No fallback storage. */
    }
    setToken('');
    setCapabilities(null);
    setBootstrap('');
    setVersion((v) => v + 1);
  };
  const updateCapabilities = async (current: number) => {
    const started = performance.now(),
      wall = Date.now();
    const next = await localJson<LocalCapabilities>('/api/local/capabilities');
    if (current !== epoch.current) return false;
    if (
      !Number.isFinite(next.remainingMilliseconds) ||
      next.remainingMilliseconds <= 0 ||
      next.remainingMilliseconds > 8 * 60 * 60 * 1000
    )
      throw new Error('Invalid browser lifetime');
    deadline.current = {
      monotonic: started + next.remainingMilliseconds,
      wall: wall + next.remainingMilliseconds,
    };
    const checkExpiry = () => {
      if (current !== epoch.current) return;
      const remaining = Math.min(
        deadline.current.monotonic - performance.now(),
        deadline.current.wall - Date.now(),
      );
      if (remaining <= 0) {
        forget();
        setError('Your browser session expired. Unlock again.');
      } else
        expiryTimer.current = setTimeout(checkExpiry, Math.ceil(remaining));
    };
    clearTimeout(expiryTimer.current);
    checkExpiry();
    if (current !== epoch.current) return false;
    setCapabilities(next);
    return true;
  };
  const accept = async (value: string) => {
    const current = ++epoch.current;
    // Storage must work before exposing any authenticated UI state.
    sessionStorage.setItem(storageKey, value);
    localTransport.setSession(value, () => {
      forget();
      setError('Your browser session expired. Unlock again.');
    });
    if (await updateCapabilities(current)) {
      setToken(value);
      setVersion((v) => v + 1);
    }
  };
  useEffect(() => {
    enableLocalBrowser();
    let active = true;
    const sessionEpoch = epoch;
    void (async () => {
      try {
        const saved = sessionStorage.getItem(storageKey);
        if (saved) await accept(saved);
        else {
          sessionStorage.setItem(storageKey, '');
          sessionStorage.removeItem(storageKey);
        }
      } catch {
        if (active) {
          forget();
          setError('Unlock again. This browser must allow session storage.');
        }
      } finally {
        if (active) setReady(true);
      }
    })();
    return () => {
      active = false;
      sessionEpoch.current++;
      clearTimeout(expiryTimer.current);
      localTransport.clear();
    };
    // The session owns this one mount; child pages remount on a session change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!token) return;
    let checking = false;
    const revalidate = async () => {
      if (document.visibilityState === 'hidden' || checking) return;
      if (
        performance.now() >= deadline.current.monotonic ||
        Date.now() >= deadline.current.wall
      ) {
        forget();
        setError('Your browser session expired. Unlock again.');
        return;
      }
      checking = true;
      const current = epoch.current;
      try {
        await updateCapabilities(current);
      } catch {
        if (current !== epoch.current) return;
        forget();
        setError('Session could not be verified. Unlock again.');
      } finally {
        checking = false;
      }
    };
    window.addEventListener('focus', revalidate);
    window.addEventListener('pageshow', revalidate);
    document.addEventListener('visibilitychange', revalidate);
    return () => {
      window.removeEventListener('focus', revalidate);
      window.removeEventListener('pageshow', revalidate);
      document.removeEventListener('visibilitychange', revalidate);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);
  const unlock = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    const supplied = bootstrap.trim();
    setBootstrap('');
    try {
      sessionStorage.setItem(storageKey, '');
      sessionStorage.removeItem(storageKey);
      const result = await localJson<{ token: string }>('/api/local/unlock', {
        bootstrap: supplied,
      });
      await accept(result.token);
    } catch {
      forget();
      setError(
        'Unlock failed. Use a fresh unlock file and enable session storage.',
      );
    } finally {
      setBusy(false);
    }
  };
  const logout = async () => {
    setBusy(true);
    setError('');
    const pending = localTransport.lock();
    forget();
    try {
      await pending;
    } catch {
      setError(
        'Browser data cleared. Server logout could not be confirmed; stop the local process to invalidate all sessions.',
      );
    } finally {
      setBusy(false);
    }
  };
  if (!ready)
    return (
      <main className="p-10" role="status">
        Opening local dashboard…
      </main>
    );
  if (!token || !capabilities)
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <form onSubmit={unlock} className="w-full max-w-lg space-y-5">
          <h1 className="text-3xl font-bold">Context Router</h1>
          <p>
            Open the private unlock file printed by your local launcher, then
            paste its contents here. It expires after five minutes and works
            once.
          </p>
          <label htmlFor="local-unlock" className="block font-medium">
            Unlock token
          </label>
          <input
            id="local-unlock"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={bootstrap}
            onChange={(event) => setBootstrap(event.target.value)}
            className="w-full border rounded p-3"
            required
          />
          {error && (
            <p role="alert" className="text-red-700">
              {error}
            </p>
          )}
          <button
            disabled={busy}
            className="px-5 py-3 rounded bg-blue-600 text-white disabled:bg-gray-400"
          >
            {busy ? 'Unlocking…' : 'Unlock local dashboard'}
          </button>
          <p className="text-sm text-gray-600">
            For a new file, enter <code>unlock</code> in the running launcher.
            Restarting the launcher expires all browser sessions.
          </p>
        </form>
      </main>
    );
  return (
    <SessionContext.Provider
      key={version}
      value={{
        token,
        capabilities,
        refresh: async () => {
          await updateCapabilities(epoch.current);
        },
      }}
    >
      <div className="px-10 pt-5 flex justify-between gap-3 text-sm">
        <span>Local dashboard · AI: {capabilities.status.state}</span>
        <button
          type="button"
          disabled={busy}
          onClick={logout}
          className="text-red-700 underline"
        >
          Lock dashboard
        </button>
      </div>
      {children}
    </SessionContext.Provider>
  );
}
