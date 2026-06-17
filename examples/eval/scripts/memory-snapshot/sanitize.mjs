const SENSITIVE_QUERY_KEYS = new Set([
  'access_token',
  'api_key',
  'apikey',
  'auth',
  'authorization',
  'client_secret',
  'key',
  'password',
  'secret',
  'token',
]);

export function sanitizeGraphqlUrl(value) {
  try {
    const url = new URL(value);
    url.username = '';
    url.password = '';
    for (const key of [...url.searchParams.keys()]) {
      if (isSensitiveQueryKey(key)) {
        url.searchParams.set(key, 'redacted');
      }
    }
    return url.toString();
  } catch {
    return value;
  }
}

export function redactMemorySnapshotSecrets(text, { authToken, graphqlUrl } = {}) {
  let output = String(text);
  if (authToken) {
    output = output.split(authToken).join('[redacted-auth-token]');
  }
  if (!graphqlUrl) {
    return output;
  }

  const sanitizedUrl = sanitizeGraphqlUrl(graphqlUrl);
  if (sanitizedUrl !== graphqlUrl) {
    output = output.split(graphqlUrl).join(sanitizedUrl);
  }

  try {
    const url = new URL(graphqlUrl);
    for (const [key, value] of url.searchParams.entries()) {
      if (isSensitiveQueryKey(key) && value.length > 0) {
        output = output.split(value).join(`[redacted-url-query-${key}]`);
      }
    }
  } catch {
    // Invalid URLs are displayed as provided elsewhere; token redaction still applies.
  }

  return output;
}

function isSensitiveQueryKey(key) {
  return SENSITIVE_QUERY_KEYS.has(key.toLowerCase());
}
