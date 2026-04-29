import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { AnalysisClient } from '../src/server/analysis-client';

const hasSmokeEnv =
  Boolean(process.env.CONTEXT_ROUTER_BEARER_TOKEN) &&
  Boolean(process.env.LOCAL_ORCHESTRATOR_SMOKE_BACKEND_URL);

test(
  'AnalysisClient can hit a real backend when smoke env is configured',
  {
    skip: hasSmokeEnv
      ? false
      : 'Set CONTEXT_ROUTER_BEARER_TOKEN and LOCAL_ORCHESTRATOR_SMOKE_BACKEND_URL to run live contract coverage.',
  },
  async (t) => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'local-orchestrator-live-'));
    t.after(async () => {
      await rm(tempRoot, { recursive: true, force: true });
    });

    const filePath = path.join(tempRoot, 'neutral.txt');
    await writeFile(
      filePath,
      'Temporary smoke-test note. This may or may not contain useful preferences.',
    );

    const client = new AnalysisClient({
      backendUrl: process.env.LOCAL_ORCHESTRATOR_SMOKE_BACKEND_URL ?? '',
      token: process.env.CONTEXT_ROUTER_BEARER_TOKEN ?? '',
    });

    const result = await client.analyzeFile({
      path: filePath,
      relativePath: 'neutral.txt',
      sizeBytes: 72,
      extension: '.txt',
      originalMimeType: 'text/plain',
      uploadMimeType: 'text/plain',
      uploadFileName: 'neutral.txt',
      coercedToPlainText: false,
    });

    assert.equal(typeof result.analysisId, 'string');
    assert.ok(result.analysisId.length > 0);
    assert.ok(Array.isArray(result.suggestions));
    assert.ok(Array.isArray(result.filteredSuggestions));
    assert.ok(
      ['success', 'no_matches', 'parse_error', 'ai_error'].includes(result.status),
    );
  },
);
