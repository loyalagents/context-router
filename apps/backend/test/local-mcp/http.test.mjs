import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
require('reflect-metadata');
const {
  createLocalMcpApplication,
} = require('../../dist/bootstrap/local-mcp.js');
const {
  SqliteDatabase,
} = require('../../dist/infrastructure/storage/sqlite/sqlite-database.js');
const {
  SqliteMcpCredentials,
} = require('../../dist/infrastructure/storage/sqlite/sqlite-mcp-credentials.js');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const {
  StreamableHTTPClientTransport,
} = require('@modelcontextprotocol/sdk/client/streamableHttp.js');

import { fixture } from './fixtures/http-fixture.mjs';
const initialize = (version = '2025-11-25', id = 0) => ({
  jsonrpc: '2.0',
  id,
  method: 'initialize',
  params: {
    protocolVersion: version,
    capabilities: {},
    clientInfo: { name: 'codex', version: '1' },
  },
});

test('actual SDK HTTP handshake, separate sessions and constrained read-only discovery', async (t) => {
  const f = await fixture(t),
    a = await f.connect(),
    b = await f.connect(f.tokens[1]);
  assert.notEqual(a.transport.sessionId, b.transport.sessionId);
  const tools = await a.client.listTools();
  assert.deepEqual(
    tools.tools.map((tool) => tool.name),
    [
      'listPreferenceSlugs',
      'searchPreferences',
      'smartSearchPreferences',
      'consolidateSchema',
      'listPermissionGrants',
    ],
  );
  const result = await a.client.callTool({
    name: 'searchPreferences',
    arguments: {},
  });
  assert.equal(result.structuredContent.active.count, 0);
  const denied = await a.client.callTool({
    name: 'mutatePreferences',
    arguments: {
      operation: 'SET_PREFERENCE',
      preference: { slug: 'profile.first_name', value: '"forbidden"' },
    },
  });
  assert.equal(denied.isError, true);
  const resource = await a.client.readResource({ uri: 'schema://graphql' });
  assert.equal(
    resource.contents[0].text,
    fs.readFileSync('src/schema.gql', 'utf8'),
  );
  const capabilities = await a.client.readResource({
    uri: 'context-router://capabilities',
  });
  assert.deepEqual(JSON.parse(capabilities.contents[0].text).status, {
    state: 'unavailable',
    configured: false,
  });
  await a.client.close();
  assert.equal((await b.client.listTools()).tools.length, 5);
});
test('production guard rejects missing, malformed, human, revoked and cross-instance credentials', async (t) => {
  const f = await fixture(t);
  for (const token of [
    '',
    'wrong',
    f.identity.credential,
    `${f.tokens[0]} trailing`,
  ])
    assert.equal((await f.raw(initialize(), { token })).status, 401);
  const a = await f.connect();
  assert.equal(
    (
      await f.raw(
        { jsonrpc: '2.0', id: 9, method: 'tools/list' },
        {
          token: f.tokens[1],
          headers: {
            'mcp-session-id': a.transport.sessionId,
            'mcp-protocol-version': '2025-11-25',
          },
        },
      )
    ).status,
    404,
  );
  f.store.revoke(f.a.id);
  assert.equal((await f.raw(initialize())).status, 401);
  assert.equal((await f.raw(initialize(), { token: f.tokens[1] })).status, 200);
});
test('literal-loopback route boundary rejects browser/rebinding/alternate API surfaces before dispatch', async (t) => {
  const f = await fixture(t);
  for (const headers of [
    { origin: 'https://evil.test' },
    { origin: 'null' },
    { host: 'evil.test' },
    { host: `localhost:${f.runtime.port}` },
  ]) {
    assert.equal((await f.raw(initialize(), { headers })).status, 403);
  }
  for (const route of [
    '/graphql',
    '/health',
    '/api/preferences/analyze',
    '/oauth/register',
    '/.well-known/oauth-protected-resource',
    '/%6dcp',
    '/mcp/',
    '/mcp?x=1',
  ]) {
    assert.equal((await f.raw(initialize(), { route })).status, 404);
  }
  assert.equal((await f.raw(undefined, { method: 'GET' })).status, 405);
  assert.equal((await f.raw(undefined, { method: 'OPTIONS' })).status, 405);
  const duplicate = await new Promise((resolve, reject) => {
    const request = http.request(
      f.url,
      {
        method: 'POST',
        headers: [
          'Host',
          `127.0.0.1:${f.runtime.port}`,
          'Authorization',
          `Bearer ${f.tokens[0]}`,
          'Authorization',
          `Bearer ${f.tokens[1]}`,
        ],
      },
      (response) => {
        response.resume();
        response.on('end', () => resolve(response.statusCode));
      },
    );
    request.on('error', reject);
    request.end('{}');
  });
  assert.equal(duplicate, 400);
});
test('negotiation excludes batch-era protocol and bounds exact typed request IDs', async (t) => {
  const f = await fixture(t);
  const init = await f.raw(initialize('2025-03-26', ''));
  assert.equal(JSON.parse(init.text).result.protocolVersion, '2025-11-25');
  const headers = {
    'mcp-session-id': init.headers.get('mcp-session-id'),
    'mcp-protocol-version': '2025-11-25',
  };
  assert.equal(
    (
      await f.raw(
        { jsonrpc: '2.0', method: 'notifications/initialized' },
        { headers },
      )
    ).status,
    202,
  );
  for (const id of [0, '0', 'x'.repeat(128)])
    assert.equal(
      (await f.raw({ jsonrpc: '2.0', id, method: 'tools/list' }, { headers }))
        .status,
      200,
    );
  for (const id of [
    '',
    0,
    0.5,
    Number.MAX_SAFE_INTEGER + 1,
    'x'.repeat(129),
    'é'.repeat(65),
  ])
    assert.equal(
      (await f.raw({ jsonrpc: '2.0', id, method: 'tools/list' }, { headers }))
        .status,
      400,
    );
  assert.equal((await f.raw([initialize()], { headers })).status, 400);
  assert.equal(
    (
      await f.raw(
        { jsonrpc: '2.0', id: 10, method: 'tools/list' },
        { headers: { ...headers, 'mcp-protocol-version': '2025-03-26' } },
      )
    ).status,
    400,
  );
});
