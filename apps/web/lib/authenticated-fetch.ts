import { GRAPHQL_URL, BACKEND_URL } from './runtime-config';
import { createLocalTransport } from './local-transport';

export const localTransport = createLocalTransport();
let localMode = false;
export function enableLocalBrowser() {
  localMode = true;
}

/** Adapt retained hosted clients to fixed local paths without forwarding their token. */
export const authenticatedFetch: typeof fetch = (input, options = {}) => {
  const authorization = new Headers(options.headers).get('authorization') ?? '';
  if (!localMode && !authorization.startsWith('Bearer cr_ui_session_'))
    return fetch(input, options);
  if (!localMode || typeof input !== 'string')
    return Promise.reject(new Error('Local browser session unavailable'));
  const aliases: Record<string, string> = {
    [GRAPHQL_URL]: '/graphql',
    [`${BACKEND_URL}/api/preferences/analysis`]: '/api/preferences/analysis',
    [`${BACKEND_URL}/api/form-fill/pdf`]: '/api/form-fill/pdf',
  };
  return localTransport.request(aliases[input] ?? input, options);
};

export async function localJson<T>(
  route: string,
  body: unknown = {},
  signal?: AbortSignal,
): Promise<T> {
  const response = await localTransport.request(route, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok)
    throw new Error(
      response.status === 429
        ? 'Local runtime is busy. Try again when the current work finishes.'
        : 'Local request failed. Reload before retrying a change.',
    );
  return response.json();
}

export async function localGraphql<T>(
  query: string,
  variables?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const result = await localJson<{ data?: T; errors?: { message: string }[] }>(
    '/graphql',
    { query, variables },
    signal,
  );
  if (result.errors?.length || !result.data)
    throw new Error('Unable to load local data. Reload and try again.');
  return result.data;
}
