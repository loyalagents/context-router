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

test('rename is durable metadata only, trims new names and invalidates stale authority revisions', (t) => {
  const f = fixture(t); f.store.upgrade();
  const a = f.store.provision('same', path.join(f.root, 'a.token'));
  const b = f.store.provision('same', path.join(f.root, 'b.token'));
  f.store.grant(a.id, 'profile.first_name', 'READ', 'DENY');
  const before = f.query('SELECT * FROM local_mcp_clients ORDER BY id');
  const grants = f.query('SELECT * FROM permission_grants');
  const authority = f.store.inspectForUi(a.id);
  assert.deepEqual(f.store.rename(a.id, '  Personal laptop  ', { label: a.label, generation: a.generation }),
    { id: a.id, label: 'Personal laptop', generation: 1 });
  const after = f.query('SELECT * FROM local_mcp_clients ORDER BY id');
  assert.deepEqual(after.map(({label, updated_at, ...row}) => row), before.map(({label, updated_at, ...row}) => row));
  assert.equal(after.find(row => row.id === b.id).label, 'same');
  assert.deepEqual(f.query('SELECT * FROM permission_grants'), grants);
  assert.equal(f.store.authenticate(f.token('a.token')).generation, 1);
  assert.equal(f.store.authenticate(f.token('b.token')).label, 'same');
  assert.throws(() => f.store.grant(a.id, '*', 'READ', 'DENY', { generation: 1, revision: authority.revision }), /conflict/);
  assert.deepEqual(fs.readFileSync(path.join(f.db.paths.identityRoot, 'identity.json')), f.identity);
  const reopened = new SqliteMcpCredentials(SqliteDatabase.open(f.db.paths), f.principal);
  assert.equal(reopened.authenticate(f.token('a.token')).label, 'Personal laptop');
  const unchanged = f.query('SELECT * FROM local_mcp_clients ORDER BY id');
  reopened.rename(a.id, 'Personal laptop', { label: 'Personal laptop', generation: 1 });
  assert.deepEqual(f.query('SELECT * FROM local_mcp_clients ORDER BY id'), unchanged);
});

test('rename validates raw names and expected state, preserves revoked clients and rejects unknown/foreign IDs', (t) => {
  const f = fixture(t); f.store.upgrade();
  const a = f.store.provision('legacy spaces ', path.join(f.root, 'a.token'));
  const before = f.query('SELECT * FROM local_mcp_clients');
  for (const label of ['', '  ', 'x'.repeat(65), ' '.repeat(64) + 'x', 'line\nname', 'x\0y', '\x7f', 5, null])
    assert.throws(() => f.store.rename(a.id, label));
  for (const expected of [{ label: 'legacy spaces', generation: 1 }, { label: a.label, generation: 2 }])
    assert.throws(() => f.store.rename(a.id, 'new', expected), /conflict/);
  for (const expected of [{label: 'x'.repeat(65), generation: 1}, {label: a.label, generation: 0}, {label: null, generation: 1}])
    assert.throws(() => f.store.rename(a.id, 'new', expected));
  assert.throws(() => f.store.rename('Z'.repeat(22), 'new'));
  assert.throws(() => new SqliteMcpCredentials(f.db, 'foreign').rename(a.id, 'new'));
  assert.deepEqual(f.query('SELECT * FROM local_mcp_clients'), before);
  f.store.rotate(a.id, path.join(f.root, 'rotated.token'));
  assert.throws(() => f.store.rename(a.id, 'new', {label: a.label, generation: 1}), /conflict/);
  f.store.revoke(a.id);
  assert.deepEqual(f.store.rename(a.id, '<script>revoked</script>', {label: a.label, generation: 3}),
    {id: a.id, label: '<script>revoked</script>', generation: 3});
  assert.equal(f.store.authenticate(f.token('rotated.token')), null);
  assert.equal(f.store.list()[0].revoked, true);
});

test('rename rollback and committed interruption retain the correct durable name', (t) => {
  const f = fixture(t); f.store.upgrade();
  const a = f.store.provision('original', path.join(f.root, 'original.token'));
  for (const stage of ['before', 'after']) {
    const child = spawnSync(process.execPath, [childFile, f.root, `publish-rename-${stage}`, a.id, 'unused'], {encoding:'utf8', timeout:10000});
    assert.equal(child.status, 77, child.stderr);
    const reopened = new SqliteMcpCredentials(SqliteDatabase.open(f.db.paths), f.principal);
    assert.equal(reopened.authenticate(f.token('original.token')).label, stage === 'before' ? 'original' : 'renamed');
    assert.equal(reopened.authenticate(f.token('original.token')).generation, 1);
  }
});

for (const [modes, codes] of [
  [['rename', 'rename'], [0, 1]],
  [['rotate', 'rename'], [0, 1]],
  [['revoke', 'rename'], [0, 1]],
  [['rename', 'rotate'], [0, 1]],
  [['rename', 'revoke'], [0, 1]],
  [['rename', 'policy'], [0, 1]],
  [['grant', 'rename'], [0, 0]],
]) test(`independent-process ${modes.join('/')} preserves rename and authority transitions`, async (t) => {
  const f = fixture(t); f.store.upgrade();
  f.client = f.store.provision('codex', path.join(f.root, 'original.token'));
  assert.deepEqual(await race(f, modes), codes.map(code => [code, null]));
  const row = f.store.list()[0];
  assert.equal(row.label, modes[0] === 'rename' || codes[1] === 0 && modes[1] === 'rename' ? 'renamed' : 'codex');
  assert.equal(row.generation, (modes[0] === 'rotate' || modes[0] === 'revoke' || codes[1] === 0 && (modes[1] === 'rotate' || modes[1] === 'revoke')) ? 2 : 1);
  if (modes.includes('policy')) assert.deepEqual(row.policy.targets, codes[1] === 0 ? ['*'] : []);
  if (modes.includes('grant')) assert.equal(f.query('SELECT * FROM permission_grants').length, 1);
});

test('rename exception before commit rolls back without changing any client column', (t) => {
  const f=fixture(t);f.store.upgrade();const a=f.store.provision('old',path.join(f.root,'a.token'));
  const before=f.query('SELECT * FROM local_mcp_clients'),connect=f.db.connect.bind(f.db);
  f.db.connect=()=>{const c=connect(),exec=c.exec.bind(c);c.exec=sql=>{if(sql==='COMMIT')throw new Error('injected before commit');return exec(sql);};return c;};
  assert.throws(()=>f.store.rename(a.id,'new',{label:a.label,generation:1}),/injected/);
  f.db.connect=connect;
  assert.deepEqual(f.query('SELECT * FROM local_mcp_clients'),before);
});

for (const modes of [
  ['policy','policy'], ['policy','grant'], ['grant','policy'],
  ['grant','rotate'], ['policy','rotate'], ['policy','revoke'],
]) test(`complete content CAS: independent-process ${modes.join('/')} has one winner`, async (t) => {
  const f=fixture(t); f.store.upgrade();
  f.client=f.store.provision('synthetic',path.join(f.root,'original.token'));
  assert.deepEqual(await race(f,modes), [[0,null],[1,null]]);
});

test('complete administration revision survives oversized/corrupt projection and changes with every grant byte', (t) => {
  const f=fixture(t); f.store.upgrade(); const a=f.store.provision('synthetic',path.join(f.root,'a.token'));
  const c=f.db.connect();
  try {
    c.exec('BEGIN IMMEDIATE');
    for(let i=0;i<520;i++) c.run('INSERT INTO permission_grants(id,user_id,client_key,target,action,effect,created_at,updated_at) VALUES(?,?,?,?,?,?,1,1)',
      ['rule-'+i,f.principal,`local:${a.id}`,'synthetic.'+i,'READ','DENY']);
    c.run('UPDATE permission_grants SET target=? WHERE id=?',['x'.repeat(300000),'rule-519']);
    c.exec('COMMIT');
  } finally {c.close();}
  const before=f.store.inspectForUi(a.id);
  assert.equal(before.status,'AUTHORITY_UNAVAILABLE');
  assert.match(before.adminRevision,/^[a-f0-9]{64}$/);
  const change=f.db.connect();
  change.run('UPDATE permission_grants SET target=? WHERE id=?',['x'.repeat(299999)+'y','rule-519']); change.close();
  assert.notEqual(f.store.inspectForUi(a.id).adminRevision,before.adminRevision);
  assert.throws(()=>f.store.revoke(a.id,1,before.adminRevision),/conflict/);
  // Browser projection limits must never become command/recovery limits.
  f.store.permissions(a.id,{capabilities:['preferences:write'],targets:['*'],allowSensitive:false});
  f.store.grant(a.id,'*','READ','DENY');
  assert.equal(f.store.revoke(a.id,1).revoked,true);
});

test('policy content ABA is accepted, different same-generation policy and grant content conflict', (t) => {
  const f=fixture(t); f.store.upgrade();const a=f.store.provision('synthetic',path.join(f.root,'a.token'));
  const before=f.store.inspectForUi(a.id);
  const expanded={capabilities:['preferences:write'],targets:['*'],allowSensitive:false};
  f.store.permissions(a.id,expanded);
  assert.throws(()=>f.store.permissions(a.id,a.policy,before.revision),/conflict/);
  f.store.permissions(a.id,a.policy);
  assert.equal(f.store.inspectForUi(a.id).revision,before.revision);
  f.store.permissions(a.id,expanded,before.revision);
  const next=f.store.inspectForUi(a.id);
  f.store.grant(a.id,'*','READ','DENY');
  assert.throws(()=>f.store.permissions(a.id,a.policy,next.revision),/conflict/);
});

for (const stage of ['before','after']) test(`atomic permissions Save crash ${stage} commit has whole durable outcome`,t=>{
  const f=fixture(t);f.store.upgrade();const a=f.store.provision('save-crash',path.join(f.root,'original.token'));
  const child=spawnSync(process.execPath,[childFile,f.root,'publish-save-'+stage,a.id,'unused'],{encoding:'utf8',timeout:10000});assert.equal(child.status,77,child.stderr);
  const reopened=new SqliteMcpCredentials(SqliteDatabase.open(f.db.paths),f.principal),client=reopened.authenticate(f.token('original.token'));
  assert.equal(client.generation,1);assert.equal(client.label,'save-crash');
  assert.deepEqual(client.policy.targets,stage==='after'?['synthetic.*']:[]);
  assert.equal(reopened.inspectForUi(a.id).grants.length,stage==='after'?1:0);
  assert.deepEqual(fs.readFileSync(path.join(f.db.paths.identityRoot,'identity.json')),f.identity);
});
