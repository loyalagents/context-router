import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const {
  SqliteDatabase,
} = require('../../dist/infrastructure/storage/sqlite/sqlite-database.js');
const {
  SqliteMcpCredentials,
} = require('../../dist/infrastructure/storage/sqlite/sqlite-mcp-credentials.js');

function fixture(t) {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'cr-ui-management-')),
  );
  fs.chmodSync(root, 0o700);
  const databaseRoot = path.join(root, 'data'),
    identityRoot = path.join(root, 'identity');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const initialized = spawnSync(
    process.execPath,
    [path.resolve('dist/local-identity.js'), 'initialize'],
    {
      env: {
        LOCAL_DATABASE_ROOT: databaseRoot,
        LOCAL_IDENTITY_STATE_ROOT: identityRoot,
      },
      encoding: 'utf8',
      timeout: 10000,
    },
  );
  assert.equal(initialized.status, 0);
  const principalId = JSON.parse(
    fs.readFileSync(path.join(identityRoot, 'identity.json')),
  ).principalId;
  const database = SqliteDatabase.open({ databaseRoot, identityRoot });
  const store = new SqliteMcpCredentials(database, principalId);
  store.upgrade();
  const a = store.provision('same-product', path.join(root, 'a.token'));
  const b = store.provision('same-product', path.join(root, 'b.token'));
  const token = fs.readFileSync(path.join(root, 'a.token'), 'utf8').trim();
  return { root, principalId, database, store, a, b, token };
}

test('bounded instance projections contain real IDs and complete grant revisions without credential secrets', (t) => {
  const f = fixture(t);
  const page = f.store.listForUi();
  assert.equal(page.items.length, 2);
  assert.equal(page.nextCursor, null);
  assert.notEqual(page.items[0].id, page.items[1].id);
  f.store.grant(f.a.id, '*', 'READ', 'DENY');
  f.store.grant(f.a.id, 'profile.first_name', 'READ', 'ALLOW');
  const before = f.store.inspectForUi(f.a.id, ['profile.first_name']);
  assert.equal(before.status, 'AVAILABLE');
  assert.equal(before.grants.length, 2);
  assert.match(before.revision, /^[a-f0-9]{64}$/);
  const text = JSON.stringify({ page, before });
  assert.equal(text.includes('secret_digest'), false);
  assert.equal(text.includes(f.token), false);
  f.store.grant(f.a.id, 'profile.first_name', 'READ', 'DENY', {
    generation: f.a.generation,
    revision: before.revision,
  });
  assert.throws(
    () =>
      f.store.grant(f.a.id, '*', 'READ', 'REMOVE', {
        generation: f.a.generation,
        revision: before.revision,
      }),
    /conflict/,
  );
  assert.equal(f.store.inspectForUi(f.b.id).grants.length, 0);
});

test('CLI maximum changes invalidate browser revisions, and generation prevents stale revoke after rotation', (t) => {
  const f = fixture(t);
  const before = f.store.inspectForUi(f.a.id);
  f.store.permissions(f.a.id, {
    capabilities: ['preferences:write'],
    targets: ['profile.*'],
    allowSensitive: false,
  });
  assert.throws(
    () =>
      f.store.grant(f.a.id, '*', 'WRITE', 'ALLOW', {
        generation: f.a.generation,
        revision: before.revision,
      }),
    /conflict/,
  );
  f.store.rotate(f.a.id, path.join(f.root, 'rotated.token'));
  assert.throws(() => f.store.revoke(f.a.id, f.a.generation), /conflict/);
  assert.equal(f.store.revoke(f.a.id, f.a.generation + 1).revoked, true);
});

test('overflow never omits a DENY, produces no effective claim/revision, blocks stale grant edits and still permits revoke', (t) => {
  const f = fixture(t);
  const before = f.store.inspectForUi(f.a.id);
  const c = f.database.connect();
  try {
    c.exec('BEGIN IMMEDIATE');
    for (let i = 0; i < 513; i++)
      c.run(
        'INSERT INTO permission_grants(id,user_id,client_key,target,action,effect,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',
        [
          'grant-' + i,
          f.principalId,
          `local:${f.a.id}`,
          `synthetic.value_${String(i).padStart(4, '0')}`,
          'READ',
          i === 512 ? 'DENY' : 'ALLOW',
          1,
          1,
        ],
      );
    c.exec('COMMIT');
  } finally {
    c.close();
  }
  const inspection = f.store.inspectForUi(f.a.id, ['synthetic.value_0512']);
  assert.equal(inspection.status, 'AUTHORITY_UNAVAILABLE');
  for (const key of ['revision', 'grants', 'effective'])
    assert.equal(key in inspection, false);
  assert.throws(() =>
    f.store.grant(f.a.id, '*', 'READ', 'ALLOW', {
      generation: f.a.generation,
      revision: before.revision,
    }),
  );
  assert.equal(f.store.revoke(f.a.id, f.a.generation).revoked, true);
});

test('inspection rejects unbounded stored columns and bounds exact target requests', (t) => {
  const f = fixture(t);
  assert.throws(() =>
    f.store.inspectForUi(f.a.id, Array(33).fill('profile.first_name')),
  );
  assert.throws(() => f.store.inspectForUi(f.a.id, ['*']));
  const c = f.database.connect();
  try {
    c.run(
      'INSERT INTO permission_grants(id,user_id,client_key,target,action,effect,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',
      [
        'huge',
        f.principalId,
        `local:${f.a.id}`,
        'x'.repeat(300000),
        'READ',
        'DENY',
        1,
        1,
      ],
    );
  } finally {
    c.close();
  }
  assert.equal(f.store.inspectForUi(f.a.id).status, 'AUTHORITY_UNAVAILABLE');
});

test('malformed non-STRICT numeric and digest columns are bounded by SQL before reaching JavaScript', (t) => {
  const f = fixture(t);
  const connect = f.database.connect.bind(f.database);
  let maxMaterialized = 0;
  f.database.connect = () => {
    const c = connect();
    for (const method of ['get', 'all']) {
      const original = c[method].bind(c);
      c[method] = (...args) => {
        const result = original(...args);
        for (const row of method === 'get' ? [result] : result)
          for (const value of Object.values(row ?? {})) {
            if (typeof value === 'string' || Buffer.isBuffer(value))
              maxMaterialized = Math.max(
                maxMaterialized,
                Buffer.byteLength(value),
              );
          }
        return result;
      };
    }
    return c;
  };
  const giant = 'x'.repeat(300000);
  for (const column of ['generation', 'secret_digest']) {
    const c = connect();
    let before;
    try {
      before = c.get(
        `SELECT ${column} value FROM local_mcp_clients WHERE id=?`,
        [f.a.id],
      ).value;
      c.run(`UPDATE local_mcp_clients SET ${column}=? WHERE id=?`, [
        column === 'secret_digest' ? 'a'.repeat(64) + '\0' + giant : giant,
        f.a.id,
      ]);
    } finally {
      c.close();
    }
    assert.throws(() => f.store.inspectForUi(f.a.id));
    const restore = connect();
    try {
      restore.run(`UPDATE local_mcp_clients SET ${column}=? WHERE id=?`, [
        before,
        f.a.id,
      ]);
    } finally {
      restore.close();
    }
  }
  f.store.grant(f.a.id, '*', 'READ', 'DENY');
  for (const column of ['created_at', 'updated_at']) {
    const c = connect();
    try {
      c.run(`UPDATE permission_grants SET ${column}=? WHERE client_key=?`, [
        giant,
        `local:${f.a.id}`,
      ]);
    } finally {
      c.close();
    }
    assert.equal(f.store.inspectForUi(f.a.id).status, 'AUTHORITY_UNAVAILABLE');
  }
  const c = connect();
  try {
    c.run('UPDATE local_mcp_clients SET created_at=? WHERE id=?', [
      giant,
      f.a.id,
    ]);
  } finally {
    c.close();
  }
  assert.equal(f.store.revoke(f.a.id, f.a.generation).revoked, true);
  assert.ok(
    maxMaterialized < 20000,
    `unbounded SQLite value materialized: ${maxMaterialized}`,
  );
});

test('the final inspection including exact-target effective decisions obeys the 256 KiB bound', async (t) => {
  const f = fixture(t);
  const {
    LocalUiManagement,
  } = require('../../dist/local-ui/local-ui-management.js');
  const c = f.database.connect();
  try {
    c.exec('BEGIN IMMEDIATE');
    for (let i = 0; i < 512; i++)
      c.run(
        'INSERT INTO permission_grants(id,user_id,client_key,target,action,effect,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',
        [
          String(i).padStart(3, '0') + '\\'.repeat(112) + '\0'.repeat(13),
          f.principalId,
          `local:${f.a.id}`,
          'synthetic.' + String(i).padStart(3, '0') + 'a'.repeat(100),
          'READ',
          'DENY',
          1,
          1,
        ],
      );
    c.exec('COMMIT');
  } finally {
    c.close();
  }
  assert.equal(f.store.inspectForUi(f.a.id).status, 'AVAILABLE');
  const result = await new LocalUiManagement(f.store, f.principalId).handle(
    '/api/local/mcp/inspect',
    {
      id: f.a.id,
      targets: Array.from(
        { length: 32 },
        (_, i) => 'synthetic.' + String(i).padStart(3, '0') + 'a'.repeat(115),
      ),
    },
  );
  assert.ok(Buffer.byteLength(JSON.stringify(result)) <= 256 * 1024);
  if (result.status === 'AUTHORITY_UNAVAILABLE')
    for (const key of ['grants', 'revision', 'effective'])
      assert.equal(key in result, false);
});

test('browser ALLOW with no maximum authority is rejected atomically and explicitly', async (t) => {
  const f = fixture(t);
  const {
    LocalUiManagement,
  } = require('../../dist/local-ui/local-ui-management.js');
  const service = new LocalUiManagement(f.store, f.principalId);
  f.store.permissions(f.a.id, {
    capabilities: ['preferences:read'],
    targets: ['profile.*'],
    allowSensitive: false,
  });
  for (const [target, action] of [
    ['profile.first_name', 'WRITE'],
    ['other.*', 'READ'],
  ]) {
    const snapshot = f.store.inspectForUi(f.a.id);
    assert.deepEqual(
      await service.handle('/api/local/mcp/grant', {
        id: f.a.id,
        target,
        action,
        effect: 'ALLOW',
        generation: snapshot.client.generation,
        revision: snapshot.revision,
      }),
      { changed: false, reason: 'OUTSIDE_MAXIMUM' },
    );
    assert.equal(f.store.inspectForUi(f.a.id).grants.length, 0);
  }
  const snapshot = f.store.inspectForUi(f.a.id);
  assert.deepEqual(
    await service.handle('/api/local/mcp/grant', {
      id: f.a.id,
      target: '*',
      action: 'READ',
      effect: 'ALLOW',
      generation: snapshot.client.generation,
      revision: snapshot.revision,
    }),
    { changed: true },
  );
});
