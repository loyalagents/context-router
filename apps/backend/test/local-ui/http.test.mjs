import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fixture as modelFixture } from '../local-model/fixtures/session-fixture.mjs';
const require = createRequire(import.meta.url);
require('reflect-metadata');
const {
  createLocalUiApplication,
} = require('../../dist/bootstrap/local-ui.js');
const {
  SqliteDatabase,
} = require('../../dist/infrastructure/storage/sqlite/sqlite-database.js');
const {
  SqliteMcpCredentials,
} = require('../../dist/infrastructure/storage/sqlite/sqlite-mcp-credentials.js');

async function fixture(t, options = {}) {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'cr-ui-http-')),
  );
  fs.chmodSync(root, 0o700);
  const configuration = {
    kind: 'sqlite',
    databaseRoot: path.join(root, 'data'),
    stateRoot: path.join(root, 'identity'),
  };
  const initialized = spawnSync(
    process.execPath,
    [path.resolve('dist/local-identity.js'), 'initialize'],
    {
      env: {
        LOCAL_DATABASE_ROOT: configuration.databaseRoot,
        LOCAL_IDENTITY_STATE_ROOT: configuration.stateRoot,
      },
      encoding: 'utf8',
      timeout: 10000,
    },
  );
  assert.equal(initialized.status, 0, initialized.stderr);
  const identity = JSON.parse(
    fs.readFileSync(path.join(configuration.stateRoot, 'identity.json')),
  );
  const db = SqliteDatabase.open({
    databaseRoot: configuration.databaseRoot,
    identityRoot: configuration.stateRoot,
  });
  const credentials = new SqliteMcpCredentials(db, identity.principalId);
  credentials.upgrade();
  credentials.provision('synthetic-client', path.join(root, 'mcp.token'));
  const mcpToken = fs.readFileSync(path.join(root, 'mcp.token'), 'utf8').trim();
  const exports = path.join(root, 'exports');
  fs.mkdirSync(exports, { mode: 0o700 });
  let runtime;
  t.after(async () => {
    await runtime?.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  runtime = await createLocalUiApplication(configuration, {
    port: 0,
    mcpPort: 0,
    exportRoot: exports,
    webHandler: async (req, res) => {
      res.setHeader('content-type', 'text/html');
      res.end('<main>Inert synthetic shell</main>');
    },
    ...options,
  });
  const origin = `http://127.0.0.1:${runtime.port}`;
  async function request(
    route,
    {
      method = 'POST',
      token,
      body = {},
      headers = {},
      port = runtime.port,
    } = {},
  ) {
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port,
          path: route,
          method,
          headers: {
            origin,
            'content-type': 'application/json',
            'x-context-router-ui': '1',
            ...(token ? { authorization: `Bearer ${token}` } : {}),
            ...headers,
          },
        },
        (res) => {
          let text = '';
          res.on('data', (chunk) => {
            text += chunk;
          });
          res.on('end', () =>
            resolve({
              status: res.statusCode,
              headers: res.headers,
              text,
              json: () => JSON.parse(text),
            }),
          );
        },
      );
      req.on('error', reject);
      req.end(method === 'GET' ? undefined : JSON.stringify(body));
    });
  }
  async function unlock() {
    const delivery = runtime.issueUnlock();
    const bootstrap = fs.readFileSync(delivery.path, 'utf8').trim();
    const result = await request('/api/local/unlock', { body: { bootstrap } });
    assert.equal(result.status, 200, result.text);
    return { token: result.json().token, bootstrap };
  }
  return {
    root,
    configuration,
    runtime,
    origin,
    identity,
    mcpToken,
    request,
    unlock,
  };
}
const me = { query: '{ me { userId } }' };
async function configuredFixture(t) {
  const cleanups = [];
  t.after(async () => {
    for (const cleanup of cleanups.reverse()) await cleanup();
  });
  const owner = { after: (cleanup) => cleanups.push(cleanup) };
  const peer = await modelFixture(owner);
  return { ...(await fixture(owner, { model: peer.config })), peer };
}

test('one local runtime unlocks browser APIs, exposes inert shells and rejects every other authority', async (t) => {
  const f = await fixture(t);
  const shell = await f.request('/dashboard', { method: 'GET' });
  assert.equal(shell.status, 200);
  assert.match(shell.text, /Inert synthetic shell/);
  assert.equal(shell.text.includes(f.identity.principalId), false);
  assert.equal(shell.headers['set-cookie'], undefined);
  const { token, bootstrap } = await f.unlock();
  assert.match(token, /^cr_ui_session_[A-Za-z0-9_-]{43}$/);
  assert.equal(
    (await f.request('/api/local/unlock', { body: { bootstrap } })).status,
    401,
  );
  const own = await f.request('/graphql', { token, body: me });
  assert.equal(own.status, 200, own.text);
  assert.equal(own.json().data.me.userId, f.identity.principalId);
  assert.equal(own.headers['set-cookie'], undefined);
  assert.match(own.headers['cache-control'], /no-store/);
  for (const wrong of [
    undefined,
    f.identity.credential,
    f.mcpToken,
    bootstrap,
  ]) {
    assert.equal(
      (await f.request('/graphql', { token: wrong, body: me })).status,
      401,
    );
  }
  const cookie = await f.request('/graphql', {
    headers: { cookie: `session=${token}` },
    body: me,
  });
  assert.equal(cookie.status, 401);
  const browserAtMcp = await f.request('/mcp', {
    port: f.runtime.mcpPort,
    token,
    body: { jsonrpc: '2.0', id: 1, method: 'initialize' },
  });
  assert.notEqual(browserAtMcp.status, 200);
  assert.equal((await f.request('/api/local/logout', { token })).status, 200);
  assert.equal((await f.request('/graphql', { token, body: me })).status, 401);
});

test('canonical route, Host, Origin and duplicate-header admission fail before body use', async (t) => {
  const f = await fixture(t);
  const { token } = await f.unlock();
  for (const headers of [
    { host: 'localhost:' + f.runtime.port },
    { host: 'attacker.invalid' },
    { origin: 'null' },
    { origin: 'http://127.0.0.1:1' },
    { origin: '' },
    { authorization: [`Bearer ${token}`, `Bearer ${token}`] },
    { origin: [f.origin, f.origin] },
    { cookie: 'ignored=true', authorization: '' },
  ])
    assert.notEqual(
      (await f.request('/graphql', { token, body: me, headers })).status,
      200,
    );
  for (const route of [
    '/graphql?x=1',
    '/%67raphql',
    '//graphql',
    '/graphql/',
    '/api/debug/token',
    '/api/chat',
    '/auth/login',
    '/oauth/register',
    '/health',
    '/mcp',
  ]) {
    assert.notEqual(
      (await f.request(route, { token, body: me })).status,
      200,
      route,
    );
  }
  assert.notEqual(
    (await f.request('/graphql', { method: 'GET', token })).status,
    200,
  );
  assert.notEqual(
    (await f.request('/graphql', { method: 'OPTIONS', token })).status,
    200,
  );
  const tooLarge = await f.request('/graphql', {
    token,
    body: { query: 'x'.repeat(256 * 1024) },
  });
  assert.equal(tooLarge.status, 413);
});

test('raw upgrade and CONNECT close even when the web handler has installed an upgrade listener', async (t) => {
  const f = await fixture(t);
  await f.request('/dashboard', { method: 'GET' });
  let forwarded = false;
  f.runtime.server.on('upgrade', () => {
    forwarded = true;
  });
  f.runtime.server.on('connect', () => {
    forwarded = true;
  });
  for (const firstLine of [
    'GET /dashboard HTTP/1.1',
    'CONNECT 127.0.0.1:1 HTTP/1.1',
  ]) {
    await new Promise((resolve, reject) => {
      const socket = net.connect(f.runtime.port, '127.0.0.1');
      socket.setTimeout(1000, () => {
        socket.destroy();
        reject(new Error('Unsupported socket stayed open'));
      });
      socket.on('error', reject);
      socket.on('close', resolve);
      socket.on('connect', () =>
        socket.write(
          `${firstLine}\r\nHost: 127.0.0.1:${f.runtime.port}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n`,
        ),
      );
    });
  }
  assert.equal(forwarded, false);
});

test('unsafe unlock roots fail before application readiness', async (t) => {
  await assert.rejects(
    fixture(t, { exportRoot: '/' }),
    /Local UI startup failed/,
  );
});

test('incomplete unauthenticated unlock traffic cannot consume authenticated logout capacity', async (t) => {
  const f = await fixture(t);
  const { token } = await f.unlock();
  const held = [];
  t.after(() => held.forEach((req) => req.destroy()));
  for (let i = 0; i < 8; i++) {
    const req = http.request(f.origin + '/api/local/unlock', {
      method: 'POST',
      headers: {
        origin: f.origin,
        'x-context-router-ui': '1',
        'content-type': 'application/json',
        'content-length': '100',
      },
    });
    req.on('error', () => {});
    req.write('{');
    held.push(req);
  }
  // Ordered through the boundary after all held headers have reached its counter.
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal((await f.request('/api/local/logout', { token })).status, 200);
  assert.equal((await f.request('/graphql', { token, body: me })).status, 401);
});

test('multipart bytes survive asynchronous authentication and logout during parsing blocks use-case entry', async (t) => {
  const f = await configuredFixture(t);
  const { token } = await f.unlock();
  const { UserService } = require('../../dist/modules/user/user.service.js');
  const {
    DocumentAnalysisService,
  } = require('../../dist/modules/preferences/document-analysis/document-analysis.service.js');
  const users = f.runtime.application.get(UserService),
    original = users.findOne.bind(users);
  let guarded;
  users.findOne = async (...args) => {
    guarded?.();
    await new Promise((resolve) => setTimeout(resolve, 25));
    return original(...args);
  };
  const service = f.runtime.application.get(DocumentAnalysisService);
  const calls = [];
  service.analyzeDocument = async (...args) => {
    calls.push(args);
    return { status: 'success' };
  };
  const boundary = 'synthetic-boundary';
  const first = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="synthetic.txt"\r\nContent-Type: text/plain\r\n\r\n`;
  const last = `\r\n--${boundary}--\r\n`;
  const content = first + 'same-packet-canary' + last;
  function upload() {
    let request;
    const response = new Promise((resolve, reject) => {
      request = http.request(
        f.origin + '/api/preferences/analysis',
        {
          method: 'POST',
          headers: {
            origin: f.origin,
            'x-context-router-ui': '1',
            authorization: `Bearer ${token}`,
            'content-type': `multipart/form-data; boundary=${boundary}`,
            'content-length': Buffer.byteLength(content),
          },
        },
        (res) => {
          res.resume();
          res.on('end', () => resolve(res.statusCode));
        },
      );
      request.on('error', reject);
    });
    return { request, response };
  }
  const full = upload();
  full.request.end(content);
  assert.equal(await full.response, 201);
  assert.equal(calls[0][1].toString(), 'same-packet-canary');
  const didGuard = new Promise((resolve) => {
    guarded = resolve;
  });
  const partial = upload();
  partial.request.write(first);
  await didGuard;
  // Wait until the async guard has completed and Multer is awaiting the remainder.
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal((await f.request('/api/local/logout', { token })).status, 200);
  partial.request.end('same-packet-canary' + last);
  assert.equal(await partial.response, 401);
  assert.equal(calls.length, 1);
});

test('browser MCP administration uses exact instances, complete authority and generation-bound mutations', async (t) => {
  const f = await fixture(t);
  const { token } = await f.unlock();
  const clients = await f.request('/api/local/mcp/list', { token });
  assert.equal(clients.status, 200, clients.text);
  const client = clients.json().items[0];
  const second = f.runtime.credentials.provision(
    client.label,
    path.join(f.root, 'second.token'),
  );
  f.runtime.credentials.permissions(client.id, {
    capabilities: ['preferences:write', 'preferences:define'],
    targets: ['profile.*'],
    allowSensitive: false,
  });
  const inspect = async (id = client.id) =>
    f.request('/api/local/mcp/inspect', {
      token,
      body: {
        id,
        targets: ['profile.first_name', 'profile.email', 'other.value'],
      },
    });
  let response = await inspect();
  assert.equal(response.status, 200, response.text);
  let snapshot = response.json();
  assert.equal(
    snapshot.effective.find((x) => x.target === 'profile.first_name').write,
    true,
  );
  assert.equal(
    snapshot.effective.find((x) => x.target === 'other.value').read,
    false,
  );
  assert.equal(
    snapshot.effective.find((x) => x.target === 'profile.email').read,
    false,
  );
  const edit = (body) =>
    f.request('/api/local/mcp/grant', {
      token,
      body: {
        id: client.id,
        generation: snapshot.client.generation,
        revision: snapshot.revision,
        ...body,
      },
    });
  assert.equal(
    (await edit({ target: 'profile.*', action: 'READ', effect: 'DENY' }))
      .status,
    200,
  );
  assert.equal(
    (
      await edit({
        target: 'profile.first_name',
        action: 'READ',
        effect: 'ALLOW',
      })
    ).status,
    409,
  );
  snapshot = (await inspect()).json();
  assert.equal(
    snapshot.effective.find((x) => x.target === 'profile.first_name').write,
    false,
  );
  assert.equal(
    (
      await edit({
        target: 'profile.first_name',
        action: 'READ',
        effect: 'ALLOW',
      })
    ).status,
    200,
  );
  snapshot = (await inspect()).json();
  assert.equal(
    snapshot.effective.find((x) => x.target === 'profile.first_name').write,
    true,
  );
  assert.equal((await inspect(second.id)).json().grants.length, 0);
  assert.equal(
    (
      await f.request('/api/local/mcp/grant', {
        token,
        body: { id: client.id, policy: {} },
      })
    ).status,
    400,
  );
  assert.equal(
    (await f.request('/api/local/mcp/issue', { token })).status,
    404,
  );
  const revoked = await f.request('/api/local/mcp/revoke', {
    token,
    body: { id: client.id, generation: snapshot.client.generation },
  });
  assert.equal(revoked.status, 200, revoked.text);
  assert.equal(f.runtime.credentials.authenticate(f.mcpToken), null);
  snapshot = (await inspect()).json();
  assert.equal(
    snapshot.effective.every(
      (x) => !x.read && !x.suggest && !x.write && !x.define,
    ),
    true,
  );
});

test('reviewed apply GraphQL reports conflicts per item while the legacy apply remains an upsert', async (t) => {
  const f = await fixture(t);
  const { token } = await f.unlock();
  const query = async (query, variables) =>
    (await f.request('/graphql', { token, body: { query, variables } })).json();
  const catalog = await query('{ preferenceCatalog { id slug } }');
  const definitionId = catalog.data.preferenceCatalog.find(
    (d) => d.slug === 'profile.first_name',
  ).id;
  const input = {
    suggestionId: 'item-1',
    definitionId,
    slug: 'profile.first_name',
    operation: 'CREATE',
    newValue: 'Reviewed',
    confidence: 0.9,
  };
  const mutation =
    'mutation($input:[ApplyPreferenceSuggestionV2Input!]!){applyPreferenceSuggestionsV2(analysisId:"synthetic",input:$input){schemaVersion results {suggestionId status preference {id value}}}}';
  const first = await query(mutation, { input: [input] });
  assert.equal(first.errors, undefined, JSON.stringify(first.errors));
  assert.equal(
    first.data.applyPreferenceSuggestionsV2.results[0].status,
    'APPLIED',
  );
  const repeat = await query(mutation, { input: [input] });
  assert.equal(
    repeat.data.applyPreferenceSuggestionsV2.results[0].status,
    'CONFLICT',
  );
  const legacy = await query(
    'mutation { applyPreferenceSuggestions(analysisId:"legacy",input:[{suggestionId:"legacy",slug:"profile.first_name",operation:CREATE,newValue:"Legacy replacement",confidence:0.9}]) { value } }',
  );
  assert.equal(
    legacy.data.applyPreferenceSuggestions[0].value,
    'Legacy replacement',
  );
});

test('capabilities report selected upload intersections and client deadlines only shorten the bound', async (t) => {
  const f = await fixture(t);
  const { token } = await f.unlock();
  const response = await f.request('/api/local/capabilities', { token });
  assert.deepEqual(response.json().operations.analysis.mimeTypes, []);
  assert.deepEqual(response.json().operations.formFill.mimeTypes, []);
  assert.equal(response.json().operations.search, false);
  for (const timeout of ['0', '180001', '-1', 'NaN', '1.5', ['100', '100']])
    assert.equal(
      (
        await f.request('/graphql', {
          token,
          body: me,
          headers: { 'x-context-router-timeout-ms': timeout },
        })
      ).status,
      400,
    );
  const {
    AI_TEXT_GENERATOR_PORT,
  } = require('../../dist/domains/shared/ports/ai.tokens.js');
  const ai = f.runtime.application.get(AI_TEXT_GENERATOR_PORT);
  let release;
  ai.getStatus = () =>
    new Promise((resolve) => {
      release = () => resolve({ state: 'unavailable', configured: false });
    });
  const delayed = await f.request('/api/local/capabilities', {
    token,
    headers: { 'x-context-router-timeout-ms': '20' },
  });
  assert.equal(delayed.status, 504);
  release();
});

for (const operation of ['smart-search', 'legacy-logout', 'legacy-deadline'])
  test(
    `UI and MCP share controls/admission for ${operation}`,
    { timeout: 20000 },
    async (t) => {
      const f = await configuredFixture(t);
      const { token } = await f.unlock();
      const {
        AI_TEXT_GENERATOR_PORT,
        AI_STRUCTURED_OUTPUT_PORT,
      } = require('../../dist/domains/shared/ports/ai.tokens.js');
      const ai = f.runtime.application.get(AI_STRUCTURED_OUTPUT_PORT);
      assert.equal(ai, f.runtime.application.get(AI_TEXT_GENERATOR_PORT));
      const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
      const {
        StreamableHTTPClientTransport,
      } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
      const client = new Client({ name: 'synthetic-peer', version: '1' });
      t.after(() => client.close());
      const instance = f.runtime.credentials.list()[0];
      f.runtime.credentials.permissions(instance.id, {
        capabilities: ['preferences:read'],
        targets: ['profile.*'],
        allowSensitive: false,
      });
      await client.connect(
        new StreamableHTTPClientTransport(
          new URL(`http://127.0.0.1:${f.runtime.mcpPort}/mcp`),
          {
            requestInit: { headers: { authorization: `Bearer ${f.mcpToken}` } },
          },
        ),
      );
      let observed;
      const method =
        operation === 'smart-search' ? 'generateStructured' : 'generateText';
      const generate = ai[method].bind(ai);
      ai[method] = (...args) => {
        observed = args[operation === 'smart-search' ? 2 : 1];
        return generate(...args);
      };
      const search = {
        query:
          operation === 'smart-search'
            ? '{ smartSearchPreferences(input:{query:"Synthetic"}) { queryInterpretation } }'
            : '{ askVertexAI(message:"Synthetic") }',
      };
      f.peer.state.reply = JSON.stringify({
        relevantSlugs: ['profile.first_name'],
        queryInterpretation: 'Synthetic',
      });
      const complete = await f.request('/graphql', {
        token,
        body: search,
        headers: { 'x-context-router-timeout-ms': '10000' },
      });
      assert.equal(complete.json().errors, undefined, complete.text);
      assert.equal(
        operation === 'smart-search'
          ? complete.json().data.smartSearchPreferences.queryInterpretation
          : JSON.parse(complete.json().data.askVertexAI).queryInterpretation,
        'Synthetic',
      );
      assert.ok(observed.signal instanceof AbortSignal);
      assert.equal(
        observed.signal.aborted,
        false,
        'normal body/response completion does not cancel the model',
      );
      assert.ok(observed.deadline <= performance.now() + 10000);
      let entered;
      const atCompletion = new Promise((resolve) => {
        entered = resolve;
      });
      let held = false;
      f.peer.state.hook = (req, res) => {
        if (req.url === '/completion') {
          held = true;
          res.writeHead(200, { 'content-type': 'text/event-stream' });
          res.write(
            'data: ' +
              JSON.stringify({
                index: 0,
                stop: false,
                content: '',
                tokens_predicted: 0,
                tokens_evaluated: 10,
                prompt_progress: {
                  total: 10,
                  cache: 0,
                  processed: 0,
                  time_ms: 0,
                },
              }) +
              '\n\n',
          );
          entered();
          return true;
        }
        if (req.url === '/slots') {
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify([{ id: 0, is_processing: held }]));
          return true;
        }
        return false;
      };
      const running = f.request('/graphql', {
        token,
        body: search,
        headers: {
          'x-context-router-timeout-ms':
            operation === 'legacy-deadline' ? '1500' : '10000',
        },
      });
      await atCompletion;
      const runningOptions = observed;
      const busy = await client.callTool({
        name: 'smartSearchPreferences',
        arguments: { query: 'Concurrent' },
      });
      assert.match(JSON.stringify(busy), /busy/i);
      const manual = await client.callTool({
        name: 'searchPreferences',
        arguments: {},
      });
      assert.equal(manual.isError, undefined);
      if (operation !== 'legacy-deadline')
        assert.equal(
          (await f.request('/api/local/logout', { token })).status,
          200,
        );
      const stopped = await running;
      if (operation === 'legacy-deadline') {
        assert.ok(
          stopped.status === 504 || stopped.json().errors?.length,
          'deadline never publishes generated text',
        );
        assert.ok(
          runningOptions.deadline <= performance.now(),
          'same shortened budget reaches the model',
        );
      } else {
        assert.ok(stopped.json().errors?.length);
        assert.equal(runningOptions.signal.aborted, true);
      }
      await ai.settled();
      assert.equal((await ai.getStatus()).state, 'unavailable');
      assert.match(
        JSON.stringify(
          await client.callTool({
            name: 'smartSearchPreferences',
            arguments: { query: 'After cancellation' },
          }),
        ),
        /unavailable/i,
      );
      assert.equal(
        f.peer.state.completionBodies.length,
        1,
        'only the initial completed inference plus the separately held completion reached the fixture',
      );
    },
  );

test('me is retained and user(id) is deprecated while its self-only compatibility behavior remains', async (t) => {
  const f = await fixture(t);
  const { token } = await f.unlock();
  const own = await f.request('/graphql', {
    token,
    body: {
      query: 'query($id:ID!){ me { userId } user(id:$id){ userId } }',
      variables: { id: f.identity.principalId },
    },
  });
  assert.equal(own.json().errors, undefined, own.text);
  assert.equal(own.json().data.me.userId, own.json().data.user.userId);
  const other = await f.request('/graphql', {
    token,
    body: { query: '{ user(id:"foreign"){ userId } }' },
  });
  assert.ok(other.json().errors?.length);
  const { GraphQLSchemaHost } = require('@nestjs/graphql');
  const fields = f.runtime.application
    .get(GraphQLSchemaHost)
    .schema.getQueryType()
    .getFields();
  assert.equal(
    fields.user.deprecationReason,
    'Use me for the authenticated account. Retained during the LM-008 compatibility window.',
  );
  assert.equal(fields.me.deprecationReason, undefined);
});
