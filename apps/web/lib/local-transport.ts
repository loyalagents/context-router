const routes = new Set([
  '/graphql',
  '/api/preferences/analysis',
  '/api/form-fill/pdf',
  '/api/local/unlock',
  '/api/local/logout',
  '/api/local/capabilities',
  '/api/local/mcp/list',
  '/api/local/mcp/inspect',
  '/api/local/mcp/grant',
  '/api/local/mcp/revoke',
]);

/** No ambient browser authority, redirects, external destinations or write retries. */
export function createLocalTransport(
  fetcher: typeof fetch = (...args) => fetch(...args),
) {
  let token = '',
    generation = 0,
    expired: (() => void) | undefined;
  const pending = new Set<AbortController>();
  const clear = () => {
    token = '';
    generation++;
    for (const controller of pending) controller.abort();
    pending.clear();
  };
  return {
    clear,
    async lock(): Promise<void> {
      const captured = token;
      clear();
      if (!captured) return;
      const revocation = createLocalTransport(fetcher);
      revocation.setSession(captured);
      try {
        const response = await revocation.request('/api/local/logout', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
          signal: AbortSignal.timeout(5000),
        });
        if (!response.ok) throw new Error('Server logout unconfirmed');
      } finally {
        revocation.clear();
      }
    },
    setSession(value: string, onExpired?: () => void) {
      if (!/^cr_ui_session_[A-Za-z0-9_-]{43}$/.test(value))
        throw new Error('Invalid browser session');
      clear();
      token = value;
      expired = onExpired;
    },
    async request(route: string, options: RequestInit = {}): Promise<Response> {
      if (
        !routes.has(route) ||
        options.method !== 'POST' ||
        (!token && route !== '/api/local/unlock')
      )
        throw new Error('Local UI destination rejected');
      const version = generation,
        controller = new AbortController();
      const headers = new Headers(options.headers);
      headers.delete('authorization');
      if (token && route !== '/api/local/unlock')
        headers.set('authorization', `Bearer ${token}`);
      headers.set('x-context-router-ui', '1');
      pending.add(controller);
      try {
        const response = await fetcher(route, {
          ...options,
          headers,
          credentials: 'omit',
          mode: 'same-origin',
          redirect: 'error',
          cache: 'no-store',
          signal: options.signal
            ? AbortSignal.any([options.signal, controller.signal])
            : controller.signal,
        });
        // Read the complete body before publishing a response from this generation.
        const body = await response.arrayBuffer();
        if (version !== generation) throw new Error('Browser session changed');
        if (response.status === 401 && route !== '/api/local/unlock') {
          const notify = expired;
          clear();
          notify?.();
          throw new Error('Browser session expired');
        }
        return new Response(body, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        });
      } finally {
        pending.delete(controller);
      }
    },
  };
}
