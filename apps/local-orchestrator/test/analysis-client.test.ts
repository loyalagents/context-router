import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { AnalysisClient } from '../src/server/analysis-client';
import { RequestError } from '../src/server/request-error';
import { DiscoveredFile } from '../src/types';

test('AnalysisClient sends multipart file upload with auth header', async (t) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'analysis-client-'));
  t.after(async () => {
    await rm(tempRoot, { recursive: true, force: true });
    globalThis.fetch = originalFetch;
  });

  const filePath = path.join(tempRoot, 'notes.md');
  await writeFile(filePath, '# dietary notes\n');

  const file: DiscoveredFile = {
    path: filePath,
    relativePath: 'notes.md',
    sizeBytes: '# dietary notes\n'.length,
    extension: '.md',
    originalMimeType: 'text/markdown',
    uploadMimeType: 'text/markdown',
    uploadFileName: 'notes.md',
    coercedToPlainText: false,
  };

  let seenRequest: RequestInit | undefined;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input, init) => {
    assert.equal(String(input), 'http://localhost:3000/api/preferences/analysis');
    seenRequest = init;
    return new Response(
      JSON.stringify({
        analysisId: 'analysis-1',
        suggestions: [],
        filteredSuggestions: [],
        documentSummary: 'Summary',
        status: 'no_matches',
        statusReason: 'No preferences',
        filteredCount: 0,
      }),
      {
        status: 201,
        headers: { 'content-type': 'application/json' },
      },
    );
  }) as typeof fetch;

  const client = new AnalysisClient({
    backendUrl: 'http://localhost:3000',
    token: 'secret-token',
  });

  const result = await client.analyzeFile(file);
  assert.equal(result.analysisId, 'analysis-1');
  assert.equal(result.status, 'no_matches');
  assert.ok(seenRequest);
  assert.equal(seenRequest?.method, 'POST');
  assert.equal(
    (seenRequest?.headers as Record<string, string>).Authorization,
    'Bearer secret-token',
  );

  const formData = seenRequest?.body as FormData;
  const uploaded = formData.get('file');
  assert.ok(uploaded instanceof Blob);
  assert.equal(uploaded.type, 'text/markdown');
  assert.equal((uploaded as unknown as { name?: string }).name, 'notes.md');
  assert.equal(await uploaded.text(), '# dietary notes\n');
});

test('AnalysisClient raises auth request errors for non-OK responses', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ message: 'Forbidden' }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;

  const client = new AnalysisClient({
    backendUrl: 'http://localhost:3000',
    token: 'secret-token',
  });

  await assert.rejects(
    () =>
      client.analyzeFile({
        path: __filename,
        relativePath: 'analysis-client.test.ts',
        sizeBytes: 0,
        extension: '.txt',
        originalMimeType: 'text/plain',
        uploadMimeType: 'text/plain',
        uploadFileName: 'analysis-client.test.ts',
        coercedToPlainText: false,
      }),
    (error: unknown) =>
      error instanceof RequestError &&
      error.kind === 'auth' &&
      error.statusCode === 403,
  );
});

test('AnalysisClient raises invalid response errors for malformed JSON', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = (async () =>
    new Response('{"analysisId"', {
      status: 201,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;

  const client = new AnalysisClient({
    backendUrl: 'http://localhost:3000',
    token: 'secret-token',
  });

  await assert.rejects(
    () =>
      client.analyzeFile({
        path: __filename,
        relativePath: 'analysis-client.test.ts',
        sizeBytes: 0,
        extension: '.txt',
        originalMimeType: 'text/plain',
        uploadMimeType: 'text/plain',
        uploadFileName: 'analysis-client.test.ts',
        coercedToPlainText: false,
      }),
    (error: unknown) =>
      error instanceof RequestError && error.kind === 'invalid_response',
  );
});

test('AnalysisClient preserves JSON error messages for non-OK responses like size failures', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ message: 'File too large' }), {
      status: 413,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;

  const client = new AnalysisClient({
    backendUrl: 'http://localhost:3000',
    token: 'secret-token',
  });

  await assert.rejects(
    () =>
      client.analyzeFile({
        path: __filename,
        relativePath: 'analysis-client.test.ts',
        sizeBytes: 0,
        extension: '.txt',
        originalMimeType: 'text/plain',
        uploadMimeType: 'text/plain',
        uploadFileName: 'analysis-client.test.ts',
        coercedToPlainText: false,
      }),
    (error: unknown) =>
      error instanceof RequestError &&
      error.kind === 'http' &&
      error.statusCode === 413 &&
      error.message === 'File too large',
  );
});
