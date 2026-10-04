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
} = require('../../../dist/bootstrap/local-mcp.js');
const {
  SqliteDatabase,
} = require('../../../dist/infrastructure/storage/sqlite/sqlite-database.js');
const {
  SqliteMcpCredentials,
} = require('../../../dist/infrastructure/storage/sqlite/sqlite-mcp-credentials.js');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const {
  StreamableHTTPClientTransport,
} = require('@modelcontextprotocol/sdk/client/streamableHttp.js');

export async function fixture(t, options = {}) {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'local-mcp-http-')),
  );
  fs.chmodSync(root, 0o700);
  const config = {
    kind: 'sqlite',
    databaseRoot: path.join(root, 'data'),
    stateRoot: path.join(root, 'identity'),
  };
  const initialized = spawnSync(
    process.execPath,
    [path.resolve('dist/local-identity.js'), 'initialize'],
    {
      env: {
        LOCAL_DATABASE_ROOT: config.databaseRoot,
        LOCAL_IDENTITY_STATE_ROOT: config.stateRoot,
      },
      encoding: 'utf8',
      timeout: 10000,
    },
  );
  assert.equal(initialized.status, 0, initialized.stderr);
  const identity = JSON.parse(
    fs.readFileSync(path.join(config.stateRoot, 'identity.json')),
  );
  const db = SqliteDatabase.open({
    databaseRoot: config.databaseRoot,
    identityRoot: config.stateRoot,
  });
  const store = new SqliteMcpCredentials(db, identity.principalId);
  store.upgrade();
  const a = store.provision('same-product', path.join(root, 'a.token'));
  const b = store.provision('same-product', path.join(root, 'b.token'));
  const tokens = ['a', 'b'].map((name) =>
    fs.readFileSync(path.join(root, `${name}.token`), 'utf8').trim(),
  );
  const clients = [],
    cleanups = [];
  let runtime;
  t.after(async () => {
    try {
      for (const cleanup of cleanups) await cleanup();
      for (const c of clients) await c.close();
      await runtime?.close();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
  runtime = await createLocalMcpApplication(config, { port: 0, ...options });
  const url = `http://127.0.0.1:${runtime.port}/mcp`;
  async function connect(token = tokens[0]) {
    const c = new Client(
      { name: 'same-product', version: '1' },
      { capabilities: {} },
    );
    const transport = new StreamableHTTPClientTransport(new URL(url), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    });
    clients.push(c);
    await c.connect(transport);
    return { client: c, transport };
  }
  async function raw(
    body,
    { token = tokens[0], route = '/mcp', method = 'POST', headers = {} } = {},
  ) {
    // node:http preserves deliberate Host/duplicate-header attacks that fetch can normalize.
    return new Promise((resolve, reject) => {
      const request = http.request(
        {
          hostname: '127.0.0.1',
          port: runtime.port,
          path: route,
          method,
          headers: {
            ...(token ? { authorization: `Bearer ${token}` } : {}),
            accept: 'application/json, text/event-stream',
            'content-type': 'application/json',
            ...headers,
          },
        },
        (response) => {
          let text = '';
          response.on('data', (chunk) => {
            text += chunk;
          });
          response.on('end', () =>
            resolve({
              status: response.statusCode,
              headers: new Headers(response.headers),
              text,
            }),
          );
        },
      );
      request.on('error', reject);
      request.end(body === undefined ? undefined : JSON.stringify(body));
    });
  }
  return {
    cleanups,
    root,
    config,
    db,
    store,
    identity,
    a,
    b,
    tokens,
    runtime,
    url,
    connect,
    raw,
  };
}
