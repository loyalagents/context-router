import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';
import { fixture } from './fixtures/http-fixture.mjs';
const require = createRequire(import.meta.url);
const { McpService } = require('../../dist/mcp/mcp.service.js');
const {
  LocalMcpHttpServer,
} = require('../../dist/mcp/local/local-mcp-http.js');

test('each terminal request closes the SDK through its public onclose callback', async (t) => {
  const f = await fixture(t),
    service = f.runtime.application.get(McpService);
  const createServer = service.createServer.bind(service);
  let created = 0,
    closed = 0;
  service.createServer = (...args) => {
    const sdk = createServer(...args);
    created++;
    sdk.onclose = () => {
      closed++;
    };
    return sdk;
  };
  const { client } = await f.connect();
  await client.listTools();
  assert.ok(created >= 2);
  assert.equal(closed, created);
  assert.equal(f.runtime.http.diagnostics.active, 0);
});

test('invalid wire UTF-8 is rejected without silently modifying initialize metadata', async (t) => {
  const f = await fixture(t);
  const body = Buffer.concat([
    Buffer.from(
      '{"jsonrpc":"2.0","id":0,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"',
    ),
    Buffer.from([0xff]),
    Buffer.from('","version":"1"}}}'),
  ]);
  const status = await new Promise((resolve, reject) => {
    const request = http.request(
      f.url,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${f.tokens[0]}`,
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
      },
      (response) => {
        response.resume();
        response.on('end', () => resolve(response.statusCode));
      },
    );
    request.on('error', reject);
    request.end(body);
  });
  assert.equal(status, 400);
});

for (const failure of ['serialize', 'publish'])
  test(`terminal ${failure} failure retires witnessed work and gives a fixed failure`, async () => {
    let transport;
    const reply = {
      jsonrpc: '2.0',
      id: 1,
      result: failure === 'serialize' ? { invalid: 1n } : {},
    };
    const sdk = {
      close: async () => transport.close(),
      connect: async (value) => {
        transport = value;
        value.onmessage = () => {
          void value.send(reply).catch(() => {});
        };
      },
    };
    const edge = new LocalMcpHttpServer(
      { createServer: () => sdk },
      { context: () => ({}) },
      false,
    );
    const session = { id: 'test', active: new Map(), closing: false };
    let rejected = false;
    const res = {
      destroyed: false,
      writableEnded: false,
      headersSent: false,
      setHeader() {},
      writeHead(status) {
        if (failure === 'publish' && status === 200)
          throw new Error('publication-canary');
        rejected = status === 503;
        return this;
      },
      end() {
        this.writableEnded = true;
        return this;
      },
      destroy() {
        this.destroyed = true;
      },
    };
    const operation = edge.dispatch(
      { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      session,
      {},
      res,
    );
    try {
      await new Promise((resolve) => setTimeout(resolve, 20));
      assert.equal(
        session.active.size,
        0,
        'settled handler must not remain active after failed publication',
      );
      assert.equal(rejected, true);
    } finally {
      // Close the intentionally faulty baseline harness even when the assertion fails.
      res.destroyed = true;
      await transport.send({ jsonrpc: '2.0', id: 1, result: {} });
      await operation;
    }
  });
