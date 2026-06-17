import { EXPORT_MEMORY_SNAPSHOT_QUERY } from './query.mjs';

export async function fetchMemorySnapshotGraphql({
  graphqlUrl,
  authToken,
  locationId,
  includeSuggestions,
  fetchImpl = globalThis.fetch,
}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('No fetch implementation is available.');
  }

  const response = await fetchImpl(graphqlUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${authToken}`,
    },
    body: JSON.stringify({
      query: EXPORT_MEMORY_SNAPSHOT_QUERY,
      variables: {
        locationId: locationId ?? null,
        includeSuggestions,
      },
    }),
  });

  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch (error) {
    throw new Error(
      `GraphQL memory snapshot response was not valid JSON: ${error.message}`,
    );
  }

  if (!response.ok) {
    throw new Error(
      `GraphQL memory snapshot request failed with HTTP ${response.status}: ${formatGraphqlPayload(payload)}`,
    );
  }

  if (Array.isArray(payload.errors) && payload.errors.length > 0) {
    throw new Error(`GraphQL memory snapshot returned errors: ${formatGraphqlErrors(payload.errors)}`);
  }

  if (!payload.data || typeof payload.data !== 'object') {
    throw new Error('GraphQL memory snapshot response did not include a data object.');
  }

  return payload.data;
}

function formatGraphqlPayload(payload) {
  if (Array.isArray(payload?.errors) && payload.errors.length > 0) {
    return formatGraphqlErrors(payload.errors);
  }
  return JSON.stringify(payload).slice(0, 500);
}

function formatGraphqlErrors(errors) {
  return errors
    .map((error) => error?.message ?? JSON.stringify(error))
    .join('; ');
}
