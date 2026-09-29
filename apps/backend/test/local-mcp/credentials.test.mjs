import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const {
  SqliteDatabase,
} = require('../../dist/infrastructure/storage/sqlite/sqlite-database.js');
const {
  SqliteMcpCredentials,
} = require('../../dist/infrastructure/storage/sqlite/sqlite-mcp-credentials.js');
const {
  SqliteBackup,
} = require('../../dist/infrastructure/storage/sqlite/sqlite-backup.js');
const childFile = path.resolve('test/local-mcp/fixtures/credential-child.cjs');

function fixture(t) {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'local-mcp-credentials-')),
  );
  fs.chmodSync(root, 0o700);
  const databaseRoot = path.join(root, 'data'),
    identityRoot = path.join(root, 'identity');
  const result = spawnSync(
    process.execPath,
    [
      '--no-global-search-paths',
      path.resolve('dist/local-identity.js'),
      'initialize',
    ],
    {
      env: {
        LOCAL_DATABASE_ROOT: databaseRoot,
        LOCAL_IDENTITY_STATE_ROOT: identityRoot,
      },
      cwd: root,
      encoding: 'utf8',
      timeout: 10000,
    },
  );
  assert.equal(result.status, 0, result.stderr);
  const identity = fs.readFileSync(path.join(identityRoot, 'identity.json'));
  const principal = JSON.parse(identity).principalId;
  const db = SqliteDatabase.open({ databaseRoot, identityRoot });
  const store = new SqliteMcpCredentials(db, principal);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const query = (sql) => {
    const c = db.connect();
    try {
      return c.all(sql);
    } finally {
      c.close();
    }
  };
  return {
    root,
    db,
    store,
    principal,
    identity,
    query,
    token: (name) => fs.readFileSync(path.join(root, name), 'utf8').trim(),
  };
}
test('upgrade is explicit, exact, repeatable and preserves populated v1 state and identity', (t) => {
  const f = fixture(t),
    before = f.query('SELECT * FROM preference_definitions ORDER BY id');
  assert.equal(f.query('PRAGMA user_version')[0].user_version, 1);
  assert.throws(() => f.store.list());
  assert.equal(f.store.upgrade(), 'upgraded');
  assert.equal(f.store.upgrade(), 'already-upgraded');
  assert.equal(f.query('PRAGMA user_version')[0].user_version, 2);
  assert.deepEqual(
    f.query('SELECT * FROM preference_definitions ORDER BY id'),
    before,
  );
  assert.deepEqual(
    fs.readFileSync(path.join(f.db.paths.identityRoot, 'identity.json')),
    f.identity,
  );
});
test('separate same-product credentials default to READ with no targets and no sensitive authority', (t) => {
  const f = fixture(t);
  f.store.upgrade();
  const a = f.store.provision('codex', path.join(f.root, 'a.token'));
  const b = f.store.provision('codex', path.join(f.root, 'b.token'));
  assert.notEqual(a.id, b.id);
  assert.equal(fs.statSync(path.join(f.root, 'a.token')).mode & 0o777, 0o600);
  assert.match(
    f.token('a.token'),
    /^cr_mcp_[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/,
  );
  const auth = f.store.authenticate(f.token('a.token'));
  assert.equal(auth.principalId, f.principal);
  assert.equal(auth.id, a.id);
  assert.deepEqual(auth.policy, {
    capabilities: ['preferences:read'],
    targets: [],
    allowSensitive: false,
  });
  assert.equal(f.store.authenticate(JSON.parse(f.identity).credential), null);
  assert.equal(f.store.authenticate('cr_mcp_wrong.invalid'), null);
  assert.equal(
    JSON.stringify(f.store.list()).includes(f.token('a.token')),
    false,
  );
  assert.equal(
    JSON.stringify(f.query('SELECT * FROM local_mcp_clients')).includes(
      f.token('a.token').split('.')[1],
    ),
    false,
  );
});
test('rotate and revoke persist independently; rotation preserves policy, identity and grants', (t) => {
  const f = fixture(t);
  f.store.upgrade();
  const a = f.store.provision('claude', path.join(f.root, 'old.token'));
  const b = f.store.provision('claude', path.join(f.root, 'b.token'));
  const policy = {
    capabilities: ['preferences:write', 'preferences:define'],
    targets: ['synthetic.*'],
    allowSensitive: false,
  };
  f.store.permissions(a.id, policy);
  f.store.grant(a.id, 'synthetic.private', 'READ', 'DENY');
  const rotated = f.store.rotate(a.id, path.join(f.root, 'new.token'));
  assert.equal(rotated.generation, 2);
  assert.equal(f.store.authenticate(f.token('old.token')), null);
  assert.deepEqual(f.store.authenticate(f.token('new.token')).policy, policy);
  assert.equal(
    f.query('SELECT * FROM permission_grants')[0].client_key,
    `local:${a.id}`,
  );
  assert.equal(f.store.revoke(a.id).generation, 3);
  assert.equal(f.store.revoke(a.id).generation, 3);
  const reopened = new SqliteMcpCredentials(
    SqliteDatabase.open(f.db.paths),
    f.principal,
  );
  assert.equal(reopened.authenticate(f.token('new.token')), null);
  assert.equal(reopened.authenticate(f.token('b.token')).id, b.id);
  assert.throws(() =>
    reopened.rotate(a.id, path.join(f.root, 'revived.token')),
  );
  assert.throws(() => reopened.permissions(a.id, policy));
});
test('unsafe export, policy and foreign principal fail without changing authority', (t) => {
  const f = fixture(t);
  f.store.upgrade();
  const a = f.store.provision('codex', path.join(f.root, 'a.token'));
  const before = f.query('SELECT * FROM local_mcp_clients');
  assert.throws(() => f.store.rotate(a.id, path.join(f.root, 'a.token')));
  fs.symlinkSync(path.join(f.root, 'a.token'), path.join(f.root, 'link.token'));
  assert.throws(() => f.store.rotate(a.id, path.join(f.root, 'link.token')));
  for (const policy of [
    { capabilities: ['unknown'], targets: ['*'], allowSensitive: false },
    { capabilities: [], targets: [''], allowSensitive: false },
    { capabilities: [], targets: [], allowSensitive: 'false' },
    { capabilities: [], targets: [], allowSensitive: false, extra: true },
  ])
    assert.throws(() => f.store.permissions(a.id, policy));
  assert.deepEqual(f.query('SELECT * FROM local_mcp_clients'), before);
  assert.equal(
    new SqliteMcpCredentials(f.db, 'another-human').authenticate(
      f.token('a.token'),
    ),
    null,
  );
  assert.equal(f.store.authenticate(f.token('a.token')).generation, 1);
});
test('v2 matching-pair backup restores credential/revocation history and stable identity into new roots', async (t) => {
  const f = fixture(t);
  f.store.upgrade();
  const a = f.store.provision('codex', path.join(f.root, 'a.token'));
  const b = f.store.provision('claude', path.join(f.root, 'b.token'));
  f.store.revoke(b.id);
  const backup = new SqliteBackup();
  await backup.create(f.db, path.join(f.root, 'backup'));
  f.store.revoke(a.id);
  const restored = await backup.restore(
    path.join(f.root, 'backup'),
    path.join(f.root, 'restored'),
  );
  const store = new SqliteMcpCredentials(restored, f.principal);
  assert.equal(store.authenticate(f.token('a.token')).id, a.id);
  assert.equal(store.authenticate(f.token('b.token')), null);
  assert.deepEqual(
    fs.readFileSync(path.join(restored.paths.identityRoot, 'identity.json')),
    f.identity,
  );
});

test('upgrade interrupted before commit stays v1; after commit stays v2; busy upgrade never changes schema', (t) => {
  const f = fixture(t);
  for (const [mode, version] of [
    ['crash-before-commit', 1],
    ['crash-after-commit', 2],
  ]) {
    const child = spawnSync(process.execPath, [childFile, f.root, mode], {
      encoding: 'utf8',
      timeout: 10000,
    });
    assert.equal(child.status, 77, child.stderr);
    assert.equal(f.query('PRAGMA user_version')[0].user_version, version);
  }
  assert.equal(f.store.upgrade(), 'already-upgraded');
  const c = f.db.connect();
  c.exec('BEGIN IMMEDIATE');
  try {
    assert.throws(() => f.store.upgrade());
  } finally {
    c.exec('ROLLBACK');
    c.close();
  }
  assert.equal(f.query('PRAGMA user_version')[0].user_version, 2);
});

test('mixed and unknown schema is rejected without repair or identity changes', (t) => {
  const f = fixture(t);
  const c = f.db.connect();
  c.exec('CREATE TABLE unexpected(data TEXT)');
  c.close();
  assert.throws(() => SqliteDatabase.open(f.db.paths));
  assert.deepEqual(
    fs.readFileSync(path.join(f.db.paths.identityRoot, 'identity.json')),
    f.identity,
  );
});

async function race(f, modes) {
  const children = modes.map((mode, i) => {
    const marker = path.join(f.root, `ready-${i}`),
      release = path.join(f.root, `release-${i}`);
    const child = spawn(
      process.execPath,
      [
        childFile,
        f.root,
        mode,
        f.client.id,
        `race-${i}.token`,
        marker,
        release,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk;
    });
    child.stderr.on('data', (chunk) => {
      output += chunk;
    });
    return {
      child,
      marker,
      release,
      done: once(child, 'close'),
      output: () => output,
    };
  });
  try {
    const end = Date.now() + 8000;
    while (!children.every((c) => fs.existsSync(c.marker))) {
      assert.ok(
        Date.now() < end,
        'children must reach deterministic precommit barriers',
      );
      assert.ok(
        children.every((c) => c.child.exitCode === null),
        children.map((c) => c.output()).join(),
      );
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    fs.writeFileSync(children[0].release, 'go');
    const first = await children[0].done;
    fs.writeFileSync(children[1].release, 'go');
    return [first, await children[1].done];
  } finally {
    for (const c of children)
      if (c.child.exitCode === null && c.child.signalCode === null)
        c.child.kill('SIGKILL');
    await Promise.all(children.map((c) => c.done));
  }
}
for (const modes of [
  ['rotate', 'rotate'],
  ['revoke', 'rotate'],
  ['rotate', 'revoke'],
  ['revoke', 'policy'],
]) {
  test(`independent-process ${modes.join('/')} commits one expected-generation winner without retry`, async (t) => {
    const f = fixture(t);
    f.store.upgrade();
    f.client = f.store.provision('codex', path.join(f.root, 'original.token'));
    assert.deepEqual(await race(f, modes), [
      [0, null],
      [1, null],
    ]);
    assert.equal(f.store.list()[0].generation, 2);
    assert.equal(f.store.authenticate(f.token('original.token')), null);
    if (modes[0] === 'rotate')
      assert.equal(f.store.authenticate(f.token('race-0.token')).generation, 2);
    if (modes[1] === 'rotate')
      assert.equal(f.store.authenticate(f.token('race-1.token')), null);
    if (modes[0] === 'revoke') assert.equal(f.store.list()[0].revoked, true);
  });
}

for (const operation of ['provision', 'rotate'])
  for (const stage of ['export', 'before', 'after']) {
    test(`${operation} interrupted ${stage} preserves durable delivery and fresh-process authority`, (t) => {
      const f = fixture(t);
      f.store.upgrade();
      const original =
        operation === 'rotate'
          ? f.store.provision('synthetic', path.join(f.root, 'original.token'))
          : null;
      const crash = spawnSync(
        process.execPath,
        [
          childFile,
          f.root,
          `publish-${operation}-${stage}`,
          original?.id ?? '',
          'published.token',
        ],
        { encoding: 'utf8', timeout: 10000 },
      );
      assert.equal(crash.status, 77, crash.stderr);
      const verified = spawnSync(
        process.execPath,
        [childFile, f.root, 'verify', '', 'published.token'],
        { encoding: 'utf8', timeout: 10000 },
      );
      assert.equal(verified.status, 0, verified.stderr);
      const state = JSON.parse(verified.stdout),
        committed = stage === 'after';
      assert.equal(state.exported, committed);
      assert.equal(state.original, operation === 'rotate' && !committed);
      assert.equal(
        state.rows.length,
        operation === 'rotate' || committed ? 1 : 0,
      );
      if (state.rows.length)
        assert.equal(
          state.rows[0].generation,
          operation === 'rotate' && committed ? 2 : 1,
        );
      assert.deepEqual(
        fs.readFileSync(path.join(f.db.paths.identityRoot, 'identity.json')),
        f.identity,
      );
      assert.equal(
        fs.statSync(path.join(f.root, 'published.token')).mode & 0o777,
        0o600,
      );
    });
  }
for (const failureAt of [1, 2])
  test(`token export fsync failure ${failureAt} never changes authority`, (t) => {
    const f = fixture(t);
    f.store.upgrade();
    const a = f.store.provision(
      'synthetic',
      path.join(f.root, 'original.token'),
    );
    const original = fs.fsyncSync;
    let count = 0;
    fs.fsyncSync = (...args) => {
      if (++count === failureAt) throw new Error('synthetic fsync failure');
      return original(...args);
    };
    try {
      assert.throws(() =>
        f.store.rotate(a.id, path.join(f.root, 'failed.token')),
      );
    } finally {
      fs.fsyncSync = original;
    }
    assert.equal(f.store.authenticate(f.token('original.token')).generation, 1);
    assert.equal(f.store.authenticate(f.token('failed.token')), null);
    assert.deepEqual(
      fs.readFileSync(path.join(f.db.paths.identityRoot, 'identity.json')),
      f.identity,
    );
  });
