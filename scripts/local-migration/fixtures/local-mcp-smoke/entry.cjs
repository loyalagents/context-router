'use strict';
// Adapts the existing journaled launcher to the real compiled MCP CLI.
const fs = require('node:fs'),
  path = require('node:path');
const assert = require('node:assert/strict');
exports.runLocalIdentityEntrypoint = async ({ argv: [operation] }) => {
  const dist = process.env.LOCAL_DATABASE_RUNTIME_DIST,
    root = process.env.LOCAL_MCP_SMOKE_ROOT;
  await globalThis.__localMcpSmoke.controls();
  if (operation === 'serve-model') {
    process.once('beforeExit', () => {
      const c = globalThis.__localMcpSmoke.counters;
      process.stdout.write(
        JSON.stringify({
          type: 'local-mcp-smoke',
          policyFailed: globalThis.__localMcpSmoke.policyFailed,
          controls: c.controls,
          connections: c.connections,
          listeners: c.listeners,
          sqliteThreads: c.sqliteThreads,
        }) + '\n',
      );
    });
    return require(path.join(dist, 'local-mcp.js')).runLocalMcp([
      'serve-model',
      '--port',
      '0',
    ]);
  }
  if (operation === 'initialize') {
    return require(
      path.join(dist, 'local-identity.js'),
    ).runLocalIdentityEntrypoint({ argv: ['initialize'] });
  }
  const cli = require(path.join(dist, 'local-mcp.js')).runLocalMcp;
  if (operation === 'setup')
    assert.equal(
      await cli(['backup', '--out', path.join(root, 'before-upgrade')]),
      0,
    );
  const { SqliteDatabase } = require(
    path.join(dist, 'infrastructure/storage/sqlite/sqlite-database.js'),
  );
  const { SqliteMcpCredentials } = require(
    path.join(dist, 'infrastructure/storage/sqlite/sqlite-mcp-credentials.js'),
  );
  const identity = JSON.parse(
    fs.readFileSync(path.join(root, 'identity/identity.json')),
  );
  const db = SqliteDatabase.open({
    databaseRoot: path.join(root, 'data'),
    identityRoot: path.join(root, 'identity'),
  });
  const store = new SqliteMcpCredentials(db, identity.principalId);
  if (operation === 'setup') {
    store.upgrade();
    const a = store.provision('same-product', path.join(root, 'a.token')),
      b = store.provision('same-product', path.join(root, 'b.token'));
    store.permissions(a.id, {
      capabilities: ['preferences:write', 'preferences:define'],
      targets: ['synthetic.*'],
      allowSensitive: false,
    });
    store.permissions(b.id, {
      capabilities: ['preferences:read'],
      targets: ['synthetic.*'],
      allowSensitive: false,
    });
    store.grant(b.id, 'synthetic.*', 'READ', 'ALLOW');
    fs.writeFileSync(
      path.join(root, 'clients.json'),
      JSON.stringify([a.id, b.id]),
      { mode: 0o600, flag: 'wx' },
    );
  } else if (operation === 'revoke')
    store.revoke(
      JSON.parse(fs.readFileSync(path.join(root, 'clients.json')))[0],
    );
  else if (operation === 'recovery') {
    // The parent starts this child only after every original owner was reaped.
    assert.equal(
      await cli(['backup', '--out', path.join(root, 'v2-backup')]),
      0,
    );
    const query = (database, sql) => {
      const c = database.connect();
      try {
        return c.all(sql);
      } finally {
        c.close();
      }
    };
    for (const [version, bundle] of [
      [1, 'before-upgrade'],
      [2, 'v2-backup'],
    ]) {
      const destination = path.join(root, `restore-v${version}`);
      assert.equal(
        await cli([
          'restore',
          '--from',
          path.join(root, bundle),
          '--out',
          destination,
        ]),
        0,
      );
      const restored = SqliteDatabase.open({
        databaseRoot: path.join(destination, 'data'),
        identityRoot: path.join(destination, 'identity'),
      });
      assert.equal(
        query(restored, 'PRAGMA user_version')[0].user_version,
        version,
      );
      assert.deepEqual(
        fs.readFileSync(path.join(destination, 'identity/identity.json')),
        fs.readFileSync(path.join(root, 'identity/identity.json')),
      );
      if (version === 1) {
        assert.throws(() =>
          new SqliteMcpCredentials(restored, identity.principalId).list(),
        );
        assert.deepEqual(
          query(restored, 'SELECT * FROM users ORDER BY user_id'),
          query(db, 'SELECT * FROM users ORDER BY user_id'),
        );
      } else {
        const recovered = new SqliteMcpCredentials(
          restored,
          identity.principalId,
        );
        assert.deepEqual(recovered.list(), store.list());
        const token = (name) =>
          fs.readFileSync(path.join(root, `${name}.token`), 'utf8').trim();
        assert.equal(recovered.authenticate(token('a')), null);
        assert.equal(
          recovered.authenticate(token('b'))?.id,
          JSON.parse(fs.readFileSync(path.join(root, 'clients.json')))[1],
        );
        assert.deepEqual(
          recovered.authenticate(token('b')),
          store.authenticate(token('b')),
        );
        for (const table of [
          'permission_grants',
          'user_preferences',
          'preference_definitions',
          'preference_audit_events',
        ]) {
          const rows = query(db, `SELECT * FROM ${table} ORDER BY id`);
          assert.ok(rows.length > 0);
          assert.deepEqual(
            query(restored, `SELECT * FROM ${table} ORDER BY id`),
            rows,
          );
        }
        assert.equal(
          query(restored, 'SELECT value FROM user_preferences')[0].value,
          '"persisted"',
        );
      }
    }
    process.once('beforeExit', () =>
      process.stdout.write(
        JSON.stringify({
          type: 'local-mcp-recovery',
          v1Restored: true,
          v2Restored: true,
          identityPreserved: true,
          authorityPreserved: true,
          dataPreserved: true,
          controls: globalThis.__localMcpSmoke.counters.controls,
          sqliteThreads: globalThis.__localMcpSmoke.counters.sqliteThreads,
          policyFailed: globalThis.__localMcpSmoke.policyFailed,
        }) + '\n',
      ),
    );
  } else throw new Error('Unsupported fixture operation');
  return 0;
};
