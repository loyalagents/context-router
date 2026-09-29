import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fixture } from './fixtures/http-fixture.mjs';
const require = createRequire(import.meta.url);
const {
  SqliteDatabase,
} = require('../../dist/infrastructure/storage/sqlite/sqlite-database.js');
const {
  PreferenceMutateTool,
} = require('../../dist/mcp/tools/preference-mutate.tool.js');
const {
  PreferenceDefinitionRepository,
} = require('../../dist/modules/preferences/preference-definition/preference-definition.repository.js');
const policy = (
  capabilities,
  allowSensitive = false,
  targets = ['synthetic.*'],
) => ({ capabilities, targets, allowSensitive });
const writer = ['preferences:write', 'preferences:define'];
const read = ['preferences:read'];
async function mutate(client, operation, payload, denied = false) {
  const result = await client.callTool({
    name: 'mutatePreferences',
    arguments: { operation, ...payload },
  });
  assert.equal(result.isError === true, denied, JSON.stringify(result));
  return JSON.parse(result.content[0].text);
}
const create = (client, slug, isSensitive = false) =>
  mutate(client, 'CREATE_DEFINITION', {
    definition: {
      slug,
      description: 'Synthetic definition',
      valueType: 'STRING',
      scope: 'GLOBAL',
      isSensitive,
    },
  });
const set = (client, slug, value, denied = false) =>
  mutate(
    client,
    'SET_PREFERENCE',
    { preference: { slug, value: JSON.stringify(value) } },
    denied,
  );
const search = async (client, args = {}) =>
  (await client.callTool({ name: 'searchPreferences', arguments: args }))
    .structuredContent;
function rows(f, table) {
  const c = f.db.connect();
  try {
    return c.all(`SELECT * FROM ${table}`);
  } finally {
    c.close();
  }
}

test('all six mutations use shared SQLite services and distinct actors; both clients see persisted values', async (t) => {
  const f = await fixture(t);
  f.store.permissions(f.a.id, policy(writer));
  f.store.permissions(f.b.id, policy(read));
  const a = (await f.connect()).client,
    b = (await f.connect(f.tokens[1])).client;
  assert.equal((await a.listTools()).tools.length, 6);
  const first = await create(a, 'synthetic.color');
  await mutate(a, 'UPDATE_DEFINITION', {
    definition: {
      id: first.definition.id,
      description: 'Updated synthetic definition',
    },
  });
  const value = await set(a, 'synthetic.color', 'blue');
  assert.equal((await search(b)).active.preferences[0].value, 'blue');
  assert.equal(value.audit.actorClientKey, `local:${f.a.id}`);
  assert.equal(value.audit.origin, 'MCP');
  await create(a, 'synthetic.suggestion');
  const suggestion = await mutate(a, 'SUGGEST_PREFERENCE', {
    preference: {
      slug: 'synthetic.suggestion',
      value: '"green"',
      confidence: 0.9,
    },
  });
  assert.equal(suggestion.changed, true);
  assert.equal(
    (await search(b, { includeSuggestions: true })).suggested.preferences[0]
      .value,
    'green',
  );
  await mutate(a, 'DELETE_PREFERENCE', {
    preference: { id: value.preference.id },
  });
  await mutate(a, 'ARCHIVE_DEFINITION', {
    definition: { id: first.definition.id },
  });
  assert.equal((await search(b)).active.count, 0);
  const audits = rows(f, 'preference_audit_events');
  assert.equal(audits.length, 7);
  assert.ok(
    audits.every(
      (row) =>
        row.actor_client_key === `local:${f.a.id}` && row.origin === 'MCP',
    ),
  );
  assert.equal(new Set(audits.map((r) => r.correlation_id)).size, 7);
  const accesses = rows(f, 'mcp_access_events');
  assert.ok(
    accesses.some(
      (r) =>
        r.client_key === `local:${f.b.id}` &&
        r.operation_name === 'searchPreferences',
    ),
  );
});

test('capabilities, targets and database grants narrow independently and grant listing is instance-scoped', async (t) => {
  const f = await fixture(t);
  f.store.permissions(f.a.id, policy(writer));
  const a = (await f.connect()).client,
    b = (await f.connect(f.tokens[1])).client;
  await create(a, 'synthetic.one');
  await set(a, 'synthetic.one', 'safe');
  f.store.grant(f.b.id, '*', 'READ', 'ALLOW');
  assert.equal(
    (await search(b)).active.count,
    0,
    'DB ALLOW must not override empty static targets',
  );
  await mutate(
    b,
    'CREATE_DEFINITION',
    {
      definition: {
        slug: 'synthetic.denied',
        description: 'Denied',
        scope: 'GLOBAL',
        valueType: 'STRING',
      },
    },
    true,
  );
  f.store.permissions(f.b.id, policy(read));
  assert.equal((await search(b)).active.count, 1);
  f.store.grant(f.a.id, 'synthetic.one', 'READ', 'DENY');
  await set(a, 'synthetic.one', 'denied', true);
  assert.equal((await search(a)).active.count, 0);
  const list = (
    await a.callTool({ name: 'listPermissionGrants', arguments: {} })
  ).structuredContent.grants;
  assert.equal(list.length, 1);
  assert.equal(list[0].clientKey, `local:${f.a.id}`);
  assert.equal((await search(b)).active.preferences[0].value, 'safe');
});

test('sensitivity denies actual archived definition values/suggestions and declassification/deletion despite a nonsensitive replacement', async (t) => {
  const f = await fixture(t);
  f.store.permissions(f.a.id, policy(writer, true));
  f.store.permissions(f.b.id, policy(writer));
  const a = (await f.connect()).client,
    b = (await f.connect(f.tokens[1])).client;
  const secret = await create(a, 'synthetic.secret', true);
  const value = await set(a, 'synthetic.secret', 'sensitive-value-canary');
  await mutate(a, 'SUGGEST_PREFERENCE', {
    preference: {
      slug: 'synthetic.secret',
      value: '"sensitive-suggestion-canary"',
      confidence: 0.9,
    },
  });
  assert.equal(
    JSON.stringify(await search(b, { includeSuggestions: true })).includes(
      'canary',
    ),
    false,
  );
  await mutate(
    b,
    'UPDATE_DEFINITION',
    { definition: { id: secret.definition.id, isSensitive: false } },
    true,
  );
  await mutate(a, 'ARCHIVE_DEFINITION', {
    definition: { id: secret.definition.id },
  });
  await create(a, 'synthetic.secret', false);
  assert.equal(
    JSON.stringify(await search(b, { includeSuggestions: true })).includes(
      'canary',
    ),
    false,
  );
  await mutate(
    b,
    'DELETE_PREFERENCE',
    { preference: { id: value.preference.id } },
    true,
  );
  await mutate(
    b,
    'CREATE_DEFINITION',
    {
      definition: {
        slug: 'synthetic.new-secret',
        description: 'Synthetic',
        scope: 'GLOBAL',
        valueType: 'STRING',
        isSensitive: true,
      },
    },
    true,
  );
});

test('global/personal duplicate slugs cannot substitute a nonsensitive definition for a sensitive stored value', async (t) => {
  const f = await fixture(t);
  f.store.permissions(f.a.id, policy(writer, true));
  f.store.permissions(f.b.id, policy(read));
  const definitions = f.runtime.application.get(PreferenceDefinitionRepository);
  await definitions.create({
    slug: 'synthetic.collision',
    description: 'Sensitive global description canary',
    valueType: 'STRING',
    scope: 'GLOBAL',
    isSensitive: true,
  });
  const a = (await f.connect()).client,
    b = (await f.connect(f.tokens[1])).client;
  await set(a, 'synthetic.collision', 'collision-value-canary');
  // A later catalog seed can collide with an already persisted personal slug.
  await definitions.create({
    slug: 'synthetic.collision',
    description: 'Nonsensitive personal replacement',
    valueType: 'STRING',
    scope: 'GLOBAL',
    ownerUserId: f.identity.principalId,
  });
  assert.equal(JSON.stringify(await search(b)).includes('canary'), false);
  assert.equal(
    JSON.stringify(
      await b.callTool({ name: 'listPreferenceSlugs', arguments: {} }),
    ).includes('canary'),
    false,
  );
});

test('mutation/audit is atomic and access append remains best effort through actual HTTP', async (t) => {
  const f = await fixture(t);
  f.store.permissions(f.a.id, policy(writer));
  const a = (await f.connect()).client;
  await create(a, 'synthetic.atomic');
  const db = f.runtime.application.get(SqliteDatabase),
    connect = db.connect.bind(db);
  db.connect = () => {
    const c = connect();
    c.exec(
      "CREATE TEMP TRIGGER fail_audit BEFORE INSERT ON preference_audit_events BEGIN SELECT RAISE(ABORT,'audit-secret-canary'); END",
    );
    return c;
  };
  await set(a, 'synthetic.atomic', 'rolled-back', true);
  assert.equal(rows(f, 'user_preferences').length, 0);
  assert.equal(rows(f, 'preference_audit_events').length, 1);
  db.connect = () => {
    const c = connect();
    c.exec(
      "CREATE TEMP TRIGGER fail_access BEFORE INSERT ON mcp_access_events BEGIN SELECT RAISE(ABORT,'access-secret-canary'); END",
    );
    return c;
  };
  const changed = await set(a, 'synthetic.atomic', 'committed');
  assert.equal(changed.changed, true);
  assert.equal(rows(f, 'user_preferences').length, 1);
  assert.equal(rows(f, 'preference_audit_events').length, 2);
  db.connect = connect;
});

test('local access metadata excludes queries, values, evidence, raw exceptions and attacker-chosen operation names', async (t) => {
  const f = await fixture(t);
  f.store.permissions(f.a.id, policy(writer));
  const a = (await f.connect()).client;
  await create(a, 'synthetic.redaction');
  await mutate(a, 'SET_PREFERENCE', {
    preference: {
      slug: 'synthetic.redaction',
      value: '"value-canary"',
      evidence: { source: 'evidence-canary' },
    },
  });
  await search(a, { query: 'query-canary' });
  await a.callTool({ name: 'untrusted-operation-canary', arguments: {} });
  await assert.rejects(a.readResource({ uri: 'untrusted-resource-canary' }));
  const access = JSON.stringify(rows(f, 'mcp_access_events'));
  assert.equal(access.includes('canary'), false);
  assert.equal(access.includes(f.tokens[0]), false);
});

test('revoke blocks future admission but already admitted mutation may commit with its actor/audit', async (t) => {
  const f = await fixture(t);
  f.store.permissions(f.a.id, policy(writer));
  const a = (await f.connect()).client;
  await create(a, 'synthetic.admission');
  const tool = f.runtime.application.get(PreferenceMutateTool),
    execute = tool.execute.bind(tool);
  let entered, release;
  const atHandler = new Promise((r) => {
      entered = r;
    }),
    held = new Promise((r) => {
      release = r;
    });
  tool.execute = async (...args) => {
    entered();
    await held;
    return execute(...args);
  };
  const running = set(a, 'synthetic.admission', 'admitted');
  await atHandler;
  f.store.revoke(f.a.id);
  release();
  assert.equal((await running).changed, true);
  assert.equal(rows(f, 'user_preferences').length, 1);
  assert.equal(
    (
      await f.raw({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'codex', version: '1' },
        },
      })
    ).status,
    401,
  );
});
