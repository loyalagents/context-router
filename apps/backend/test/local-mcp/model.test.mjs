import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';
import { fixture } from './fixtures/http-fixture.mjs';
import { fixture as modelFixture } from '../local-model/fixtures/session-fixture.mjs';
const require = createRequire(import.meta.url);
const {
  AI_STRUCTURED_OUTPUT_PORT,
  AI_TEXT_GENERATOR_PORT,
} = require('../../dist/domains/shared/ports/ai.tokens.js');
const {
  SmartSearchTool,
} = require('../../dist/mcp/tools/smart-search.tool.js');
const {
  SchemaConsolidationTool,
} = require('../../dist/mcp/tools/schema-consolidation.tool.js');
const {
  PreferenceDefinitionRepository,
} = require('../../dist/modules/preferences/preference-definition/preference-definition.repository.js');
const read = {
  capabilities: ['preferences:read'],
  targets: ['synthetic.*'],
  allowSensitive: false,
};
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check) {
  const end = Date.now() + 8000;
  while (!check()) {
    assert.ok(Date.now() < end, 'bounded settlement');
    await pause(10);
  }
}
async function setup(t) {
  const cleanups = [];
  t.after(async () => {
    for (const cleanup of cleanups.reverse()) await cleanup();
  });
  const owner = { after: (fn) => cleanups.push(fn) };
  const peer = await modelFixture(owner),
    f = await fixture(owner, { model: peer.config });
  f.store.permissions(f.a.id, read);
  f.store.permissions(f.b.id, read);
  const definitions = f.runtime.application.get(PreferenceDefinitionRepository);
  for (const slug of [
    'synthetic.one',
    'synthetic.two',
    'synthetic.secret',
    'excluded.private',
  ])
    await definitions.create({
      slug,
      description:
        slug === 'synthetic.secret'
          ? 'sensitive-description-canary'
          : slug === 'excluded.private'
            ? 'target-description-canary'
            : 'Synthetic',
      valueType: 'STRING',
      scope: 'GLOBAL',
      isSensitive: slug === 'synthetic.secret',
      ownerUserId: f.identity.principalId,
    });
  const ai = f.runtime.application.get(AI_STRUCTURED_OUTPUT_PORT);
  assert.equal(ai, f.runtime.application.get(AI_TEXT_GENERATOR_PORT));
  return { ...f, peer, ai };
}
async function session(f, token = f.tokens[0]) {
  const response = await f.raw(
    {
      jsonrpc: '2.0',
      id: 'init',
      method: 'initialize',
      params: {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'synthetic', version: '1' },
      },
    },
    { token },
  );
  assert.equal(response.status, 200);
  const headers = {
    'mcp-session-id': response.headers.get('mcp-session-id'),
    'mcp-protocol-version': '2025-11-25',
  };
  assert.equal(
    (
      await f.raw(
        { jsonrpc: '2.0', method: 'notifications/initialized' },
        { token, headers },
      )
    ).status,
    202,
  );
  return { token, headers };
}
const call = (
  f,
  auth,
  id,
  name = 'smartSearchPreferences',
  args = { query: 'Synthetic query' },
) =>
  f.raw(
    {
      jsonrpc: '2.0',
      id,
      method: 'tools/call',
      params: { name, arguments: args },
    },
    auth,
  );
const cancel = (f, auth, requestId) =>
  f.raw(
    {
      jsonrpc: '2.0',
      method: 'notifications/cancelled',
      params: { requestId },
    },
    auth,
  );

test('actual HTTP tools and capability resource propagate strict controls; prompt excludes disallowed definitions', async (t) => {
  const f = await setup(t),
    { client } = await f.connect();
  let captured;
  const generate = f.ai.generateStructured.bind(f.ai);
  f.ai.generateStructured = async (...args) => {
    captured = args;
    return generate(...args);
  };
  f.peer.state.reply = JSON.stringify({
    relevantSlugs: ['synthetic.one', 'synthetic.secret', 'excluded.private'],
    queryInterpretation: 'Synthetic',
  });
  const result = await client.callTool({
    name: 'smartSearchPreferences',
    arguments: { query: 'Synthetic query' },
  });
  assert.equal(result.isError, undefined, JSON.stringify(result));
  assert.ok(captured[2].signal instanceof AbortSignal);
  assert.ok(
    captured[2].deadline > performance.now() &&
      captured[2].deadline <= performance.now() + 180000,
  );
  assert.equal(captured[0].includes('description-canary'), false);
  assert.deepEqual(
    result.structuredContent.matchedDefinitions.map((d) => d.slug),
    ['synthetic.one'],
  );
  f.peer.state.reply = JSON.stringify({
    consolidationGroups: [],
    summary: 'Synthetic',
  });
  const consolidated = await client.callTool({
    name: 'consolidateSchema',
    arguments: {},
  });
  assert.equal(consolidated.structuredContent.totalDefinitionsAnalyzed, 2);
  let statusControls;
  const status = f.ai.getStatus.bind(f.ai);
  f.ai.getStatus = (options) => {
    statusControls = options;
    return status(options);
  };
  assert.equal(
    JSON.parse(
      (await client.readResource({ uri: 'context-router://capabilities' }))
        .contents[0].text,
    ).status.state,
    'available',
  );
  assert.ok(statusControls.signal instanceof AbortSignal);
  assert.ok(statusControls.deadline <= performance.now() + 5000);
  assert.equal(f.peer.state.completionBodies.length, 2);
});

test(
  'shared model admits one operation across tools/clients; scoped cancellation settles HTTP then preserves H unavailability',
  { timeout: 15000 },
  async (t) => {
    const f = await setup(t),
      a = await session(f),
      b = await session(f, f.tokens[1]);
    let completion = 0,
      entered;
    const atCompletion = new Promise((r) => {
      entered = r;
    });
    f.peer.state.hook = (req, res) => {
      if (req.url === '/completion') {
        completion++;
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.write(
          `data: ${JSON.stringify({ index: 0, stop: false, content: '', tokens_predicted: 0, tokens_evaluated: 10, prompt_progress: { total: 10, cache: 0, processed: 0, time_ms: 0 } })}\n\n`,
        );
        entered();
        return true;
      }
      if (req.url === '/slots') {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify([{ id: 0, is_processing: completion > 0 }]));
        return true;
      }
      return false;
    };
    const running = call(f, a, 0);
    await atCompletion;
    const busy = await call(f, b, 0, 'consolidateSchema', {});
    assert.match(busy.text, /busy/i);
    assert.equal(completion, 1);
    assert.equal((await cancel(f, b, 0)).status, 202);
    assert.equal((await cancel(f, a, '0')).status, 202);
    await pause(20);
    assert.equal(
      f.runtime.http.diagnostics.active,
      1,
      'foreign and differently typed cancellation must not match',
    );
    const { client } = await f.connect(f.tokens[1]);
    assert.equal(
      (await client.callTool({ name: 'searchPreferences', arguments: {} }))
        .structuredContent.success,
      true,
    );
    assert.equal((await cancel(f, a, 0)).status, 202);
    const cancelled = await running;
    assert.equal(cancelled.status, 200);
    assert.match(cancelled.headers.get('content-type'), /text\/event-stream/);
    assert.equal(cancelled.text, '');
    await until(() => f.runtime.http.diagnostics.active === 0);
    assert.equal(
      (await f.ai.getStatus()).state,
      'busy',
      'HTTP handler completion is not native settlement',
    );
    await f.ai.settled();
    assert.equal((await f.ai.getStatus()).state, 'unavailable');
    assert.match((await call(f, b, 1)).text, /unavailable/i);
    assert.equal(
      (await client.callTool({ name: 'searchPreferences', arguments: {} }))
        .structuredContent.success,
      true,
    );
    assert.equal(
      (await cancel(f, a, 0)).status,
      202,
      'late cancellation is harmless',
    );
    assert.equal(completion, 1);
  },
);

test(
  'real SDK cancellation is silent and retires the original request without reconnecting',
  { timeout: 10000 },
  async (t) => {
    const f = await setup(t),
      { client, transport } = await f.connect();
    const errors = [];
    client.onerror = (e) => errors.push(e);
    transport.onerror = (e) => errors.push(e);
    let entered;
    const preparation = new Promise((r) => {
      entered = r;
    });
    f.peer.state.hook = (req) => {
      if (req.url === '/apply-template') {
        entered();
        return true;
      }
      return false;
    };
    const controller = new AbortController(),
      oldSession = transport.sessionId;
    let finished = 0;
    f.runtime.http.server.on('request', (_req, res) =>
      res.once('finish', () => finished++),
    );
    const operation = client.callTool(
      { name: 'smartSearchPreferences', arguments: { query: 'Synthetic' } },
      undefined,
      { signal: controller.signal },
    );
    const rejected = assert.rejects(operation);
    await preparation;
    controller.abort();
    await rejected;
    await until(() => f.runtime.http.diagnostics.active === 0 && finished >= 2);
    await f.ai.settled();
    assert.equal(errors.length, 0);
    assert.equal(transport.sessionId, oldSession);
    assert.equal(f.peer.state.calls.includes('/completion'), false);
    assert.equal(
      (await client.callTool({ name: 'searchPreferences', arguments: {} }))
        .structuredContent.success,
      true,
    );
  },
);

test(
  'disconnect keeps work and deadline; shutdown cancels owned work while the model peer remains running',
  { timeout: 12000 },
  async (t) => {
    const f = await setup(t),
      a = await session(f),
      b = await session(f, f.tokens[1]);
    let entered;
    const preparation = new Promise((r) => {
      entered = r;
    });
    f.peer.state.hook = (req) => {
      if (req.url === '/apply-template') {
        entered();
        return true;
      }
      return false;
    };
    let observed;
    const tool = f.runtime.application.get(SmartSearchTool),
      execute = tool.execute.bind(tool);
    tool.execute = (args, context) => {
      observed ??= context.execution;
      return execute(args, context);
    };
    const request = http.request(f.url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${a.token}`,
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
        ...a.headers,
      },
    });
    request.on('error', () => {});
    request.end(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 0,
        method: 'tools/call',
        params: {
          name: 'smartSearchPreferences',
          arguments: { query: 'Synthetic' },
        },
      }),
    );
    await preparation;
    const deadline = observed.deadline;
    request.destroy();
    await pause(20);
    assert.equal(observed.signal.aborted, false);
    assert.equal(observed.deadline, deadline);
    assert.equal(f.runtime.http.diagnostics.active, 1);
    assert.match((await call(f, b, 0)).text, /busy/i);
    await f.runtime.close();
    assert.equal(observed.signal.aborted, true);
    assert.equal(f.runtime.http.diagnostics.active, 0);
    assert.equal(f.runtime.http.diagnostics.listening, false);
    // The adapter owns no inference process/listener: the independently owned fixture still answers.
    const { request: tlsRequest } = await import('node:https');
    const status = await new Promise((resolve, reject) => {
      const probe = tlsRequest(
        {
          host: '127.0.0.1',
          port: f.peer.config.port,
          path: '/props',
          ca: f.peer.credentials.cert,
        },
        (res) => {
          res.resume();
          res.once('end', () => resolve(res.statusCode));
        },
      );
      probe.on('error', reject);
      probe.end();
    });
    assert.equal(status, 401);
  },
);

test('deadline reaches both workflows before inference and capability cancellation reaches readiness', async (t) => {
  const f = await setup(t),
    a = await session(f);
  for (const Tool of [SmartSearchTool, SchemaConsolidationTool]) {
    const tool = f.runtime.application.get(Tool),
      execute = tool.execute.bind(tool);
    tool.execute = (args, context) =>
      execute(args, {
        ...context,
        execution: { ...context.execution, deadline: performance.now() - 1 },
      });
  }
  assert.match((await call(f, a, 1)).text, /deadline/i);
  assert.match(
    (await call(f, a, 2, 'consolidateSchema', {})).text,
    /deadline/i,
  );
  assert.equal(f.peer.state.calls.length, 0);
  let entered;
  const atReadiness = new Promise((r) => {
    entered = r;
  });
  f.peer.state.hook = (req) => {
    if (req.url === '/props') {
      entered();
      return true;
    }
    return false;
  };
  const resource = f.raw(
    {
      jsonrpc: '2.0',
      id: '',
      method: 'resources/read',
      params: { uri: 'context-router://capabilities' },
    },
    a,
  );
  await atReadiness;
  await cancel(f, a, '');
  assert.equal((await resource).text, '');
  await until(() => f.runtime.http.diagnostics.active === 0);
  await f.ai.settled();
  assert.equal(f.peer.state.calls.includes('/completion'), false);
});
