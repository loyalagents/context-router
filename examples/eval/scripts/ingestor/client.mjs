import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  APPLY_SUGGESTIONS_MUTATION,
  CREATE_DEFINITION_MUTATION,
  EXPORT_SCHEMA_QUERY,
  ME_QUERY,
  RESET_MEMORY_MUTATION,
  SET_PREFERENCE_MUTATION,
} from './query.mjs';

export async function graphqlRequest({
  graphqlUrl,
  authToken,
  query,
  variables = {},
  fetchImpl = globalThis.fetch,
  label = 'GraphQL request',
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
    body: JSON.stringify({ query, variables }),
  });

  const payload = await parseJsonResponse(response, label);
  if (!response.ok) {
    throw new Error(
      `${label} failed with HTTP ${response.status}: ${formatPayload(payload)}`,
    );
  }
  if (Array.isArray(payload.errors) && payload.errors.length > 0) {
    throw new Error(`${label} returned errors: ${formatGraphqlErrors(payload.errors)}`);
  }
  if (!payload.data || typeof payload.data !== 'object') {
    throw new Error(`${label} response did not include a data object.`);
  }
  return payload.data;
}

export async function fetchBackendUser({ graphqlUrl, authToken, fetchImpl }) {
  const data = await graphqlRequest({
    graphqlUrl,
    authToken,
    query: ME_QUERY,
    fetchImpl,
    label: 'GraphQL me',
  });
  const userId = data.me?.userId;
  if (typeof userId !== 'string' || userId.length === 0) {
    throw new Error('GraphQL me response did not include me.userId.');
  }
  return { userId };
}

export async function resetMemory({ graphqlUrl, authToken, fetchImpl }) {
  const data = await graphqlRequest({
    graphqlUrl,
    authToken,
    query: RESET_MEMORY_MUTATION,
    variables: { mode: 'MEMORY_ONLY' },
    fetchImpl,
    label: 'GraphQL resetMyMemory',
  });
  return data.resetMyMemory;
}

export async function fetchPreferenceSchema({ graphqlUrl, authToken, fetchImpl }) {
  const data = await graphqlRequest({
    graphqlUrl,
    authToken,
    query: EXPORT_SCHEMA_QUERY,
    variables: { scope: 'ALL' },
    fetchImpl,
    label: 'GraphQL exportPreferenceSchema',
  });
  if (!Array.isArray(data.exportPreferenceSchema)) {
    throw new Error('GraphQL exportPreferenceSchema response must be an array.');
  }
  return data.exportPreferenceSchema;
}

export async function createPreferenceDefinition({
  graphqlUrl,
  authToken,
  input,
  fetchImpl,
}) {
  const data = await graphqlRequest({
    graphqlUrl,
    authToken,
    query: CREATE_DEFINITION_MUTATION,
    variables: { input },
    fetchImpl,
    label: `GraphQL createPreferenceDefinition ${input.slug}`,
  });
  return data.createPreferenceDefinition;
}

export async function setPreference({ graphqlUrl, authToken, input, fetchImpl }) {
  const data = await graphqlRequest({
    graphqlUrl,
    authToken,
    query: SET_PREFERENCE_MUTATION,
    variables: { input },
    fetchImpl,
    label: `GraphQL setPreference ${input.slug}`,
  });
  return data.setPreference;
}

export async function applyPreferenceSuggestions({
  graphqlUrl,
  authToken,
  analysisId,
  input,
  fetchImpl,
}) {
  const data = await graphqlRequest({
    graphqlUrl,
    authToken,
    query: APPLY_SUGGESTIONS_MUTATION,
    variables: { analysisId, input },
    fetchImpl,
    label: `GraphQL applyPreferenceSuggestions ${analysisId}`,
  });
  if (!Array.isArray(data.applyPreferenceSuggestions)) {
    throw new Error('GraphQL applyPreferenceSuggestions response must be an array.');
  }
  return data.applyPreferenceSuggestions;
}

export async function uploadDocumentForAnalysis({
  backendUrl,
  authToken,
  filePath,
  relativePath,
  mimeType,
  fetchImpl = globalThis.fetch,
}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('No fetch implementation is available.');
  }
  const buffer = await readFile(filePath);
  const formData = new FormData();
  const blob = new Blob([buffer], { type: mimeType });
  formData.append('file', blob, path.basename(relativePath));

  const response = await fetchImpl(`${trimTrailingSlash(backendUrl)}/api/preferences/analysis`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${authToken}`,
    },
    body: formData,
  });

  const payload = await parseJsonResponse(response, `Document upload ${relativePath}`);
  if (!response.ok) {
    throw new Error(
      `Document upload ${relativePath} failed with HTTP ${response.status}: ${formatPayload(payload)}`,
    );
  }
  return payload;
}

export function inferMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.txt') return 'text/plain';
  if (ext === '.md' || ext === '.markdown') return 'text/markdown';
  if (ext === '.json') return 'application/json';
  if (ext === '.yaml' || ext === '.yml') return 'application/yaml';
  if (ext === '.pdf') return 'application/pdf';
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  throw new Error(`Unsupported document extension for ${filePath}`);
}

async function parseJsonResponse(response, label) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch (error) {
    throw new Error(`${label} response was not valid JSON: ${error.message}`);
  }
}

function formatPayload(payload) {
  if (Array.isArray(payload?.errors) && payload.errors.length > 0) {
    return formatGraphqlErrors(payload.errors);
  }
  if (payload?.message) return payload.message;
  return JSON.stringify(payload).slice(0, 500);
}

function formatGraphqlErrors(errors) {
  return errors
    .map((error) => error?.message ?? JSON.stringify(error))
    .join('; ');
}

function trimTrailingSlash(value) {
  return value.replace(/\/+$/, '');
}
