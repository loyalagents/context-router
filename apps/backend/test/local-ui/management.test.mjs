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

test('label projection is exact, bounded, principal scoped and independent of unavailable authority', (t) => {
  const f = fixture(t);
  f.store.revoke(f.b.id);
  const c = f.database.connect();
  try {
    for (let i=0;i<513;i++) c.run('INSERT INTO permission_grants(id,user_id,client_key,target,action,effect,created_at,updated_at) VALUES(?,?,?,?,?,?,1,1)',
      ['label-grant-'+i, f.principalId, `local:${f.a.id}`, 'synthetic.'+i, 'READ', 'DENY']);
  } finally { c.close(); }
  assert.equal(f.store.inspectForUi(f.a.id).status, 'AUTHORITY_UNAVAILABLE');
  assert.deepEqual(f.store.labelsForUi([f.a.id, f.b.id, 'Z'.repeat(22)]), {items: [{id:f.a.id,label:'same-product'}, {id:f.b.id,label:'same-product'}]});
  for (const ids of [[], Array(101).fill(f.a.id), [f.a.id, f.a.id], ['wrong'], null, 'id'])
    assert.throws(() => f.store.labelsForUi(ids));
  const hundred = Array.from({length:100}, (_,i)=>String(i).padStart(22,'A'));
  assert.deepEqual(f.store.labelsForUi(hundred), {items:[]});
  assert.throws(() => new SqliteMcpCredentials(f.database,'foreign').labelsForUi([f.a.id]));
});

test('label lookup never materializes corrupt large columns and returns a stable-ID fallback', (t) => {
  const f = fixture(t), connect = f.database.connect.bind(f.database);
  let maxMaterialized = 0;
  f.database.connect = () => {
    const c = connect(), all = c.all.bind(c);
    c.all = (...args) => {
      const rows = all(...args);
      for (const row of rows) for (const v of Object.values(row))
        if (typeof v === 'string' || Buffer.isBuffer(v)) maxMaterialized=Math.max(maxMaterialized,Buffer.byteLength(v));
      return rows;
    };
    return c;
  };
  for (const label of ['x'.repeat(300000), 'a\0'+ 'x'.repeat(300000), Buffer.alloc(300000), '', '  ', 'bad\nlabel']) {
    const c=connect();
    try { c.exec('PRAGMA ignore_check_constraints=ON'); c.run('UPDATE local_mcp_clients SET label=?,policy=? WHERE id=?', [label,JSON.stringify({oversized:'x'.repeat(300000)}),f.a.id]); }
    finally { c.close(); }
    assert.deepEqual(f.store.labelsForUi([f.a.id]), {items:[]});
  }
  assert.ok(maxMaterialized<=256, 'projection must bound values in SQLite');
});

const fullPolicy = {capabilities:['preferences:write','preferences:define'],targets:['*'],allowSensitive:true};
async function proposal(f, policy=fullPolicy, edits=[]) {
  const {LocalUiManagement}=require('../../dist/local-ui/local-ui-management.js');
  const service=new LocalUiManagement(f.store,f.principalId);
  const state=await service.handle('/api/local/mcp/inspect',{id:f.a.id});
  const body={id:f.a.id,generation:state.client.generation,revision:state.revision,catalogRevision:state.catalogRevision,policy,edits};
  const preview=await service.handle('/api/local/mcp/preview',body);
  return {service,body,preview};
}
test('one browser Save binds an exact preview and atomically preserves credentials and untouched exceptions', async t=>{
  const f=fixture(t); f.store.grant(f.a.id,'work.special','READ','ALLOW');
  const before=f.store.inspectForUi(f.a.id).grants[0];
  const p=await proposal(f,fullPolicy,[{target:'work.*',action:'READ',effect:'DENY'},{target:'work.*',action:'SUGGEST',effect:'DENY'},{target:'work.*',action:'WRITE',effect:'DENY'}]);
  assert.match(p.preview.previewKey,/^[a-f0-9]{64}$/);
  assert.ok(p.preview.widening.length);
  let admitted=0;
  const result=await p.service.handle('/api/local/mcp/save',{...p.body,previewKey:p.preview.previewKey},()=>{admitted++;});
  assert.equal(admitted,1);assert.equal(result.changed,true);assert.match(result.revision,/^[a-f0-9]{64}$/);
  assert.equal(result.client.generation,1);assert.equal(result.client.label,f.a.label);
  assert.deepEqual(f.store.authenticate(f.token).policy,fullPolicy);
  assert.deepEqual(f.store.inspectForUi(f.a.id).grants.find(g=>g.id===before.id),before);
  assert.deepEqual(f.store.list().find(c=>c.id===f.b.id),f.b);
  assert.equal((await p.service.handle('/api/local/mcp/inspect',{id:f.a.id,targets:['work.special']})).effective[0].write,false);
});
test('changed preview input, stale policy, catalog change, and admission failure never partially write',async t=>{
  for(const mode of ['input','policy','catalog','admission','late-write']){
    const f=fixture(t);const p=await proposal(f,fullPolicy,[{target:'*',action:'READ',effect:'DENY'}]);
    const c=f.database.connect();const before=c.all('SELECT * FROM local_mcp_clients ORDER BY id');c.close();
    if(mode==='input')p.body.policy={...fullPolicy,allowSensitive:false};
    if(mode==='policy')f.store.permissions(f.a.id,{...fullPolicy,targets:['work.*']});
    if(mode==='catalog'){const db=f.database.connect();db.run('UPDATE preference_definitions SET is_sensitive=1 WHERE slug=?',['profile.first_name']);db.close();}
    const connect=f.database.connect.bind(f.database);
    if(mode==='late-write')f.database.connect=()=>{const db=connect(),run=db.run.bind(db);db.run=(sql,...args)=>{if(sql.startsWith('INSERT INTO permission_grants'))throw new Error('injected');return run(sql,...args);};return db;};
    await assert.rejects(p.service.handle('/api/local/mcp/save',{...p.body,previewKey:p.preview.previewKey},()=>{if(mode==='admission')throw new Error('expired');}));
    f.database.connect=connect;
    assert.equal(f.store.inspectForUi(f.a.id).grants.length,0);
    if(mode!=='policy'){const db=connect();assert.deepEqual(db.all('SELECT * FROM local_mcp_clients ORDER BY id'),before);db.close();}
  }
});
test('new ALLOW uses final maximum, unchanged inert ALLOW survives reduction and reactivates with widening',async t=>{
  const f=fixture(t);
  let p=await proposal(f,fullPolicy,[{target:'profile.first_name',action:'WRITE',effect:'ALLOW'}]);
  await p.service.handle('/api/local/mcp/save',{...p.body,previewKey:p.preview.previewKey});
  const grant=f.store.inspectForUi(f.a.id).grants[0];
  p=await proposal(f,{capabilities:['preferences:read'],targets:['*'],allowSensitive:false});
  await p.service.handle('/api/local/mcp/save',{...p.body,previewKey:p.preview.previewKey});
  assert.deepEqual(f.store.inspectForUi(f.a.id).grants[0],grant);
  p=await proposal(f,fullPolicy);
  assert.ok(p.preview.widening.some(message=>/retained|reactivat/i.test(message)));
  const bad={...p.body,policy:{capabilities:[],targets:[],allowSensitive:false},edits:[{target:'*',action:'WRITE',effect:'ALLOW'}]};
  await assert.rejects(p.service.handle('/api/local/mcp/preview',bad));
});
test('complete catalog fingerprints archived sensitivity and preserves global/personal collisions with bounded search',async t=>{
  const f=fixture(t);const {LocalUiManagement}=require('../../dist/local-ui/local-ui-management.js');const service=new LocalUiManagement(f.store,f.principalId);
  f.store.permissions(f.a.id,fullPolicy);
  const first=await service.handle('/api/local/mcp/inspect',{id:f.a.id});
  assert.match(first.catalogRevision,/^[a-f0-9]{64}$/);assert.ok(first.summary.total>0);
  const c=f.database.connect();c.run("INSERT INTO preference_definitions(id,namespace,slug,display_name,description,value_type,scope,is_sensitive,owner_user_id,created_at,updated_at) VALUES('personal-collision',?, 'profile.first_name','Personal first name','','STRING','GLOBAL',1,?,1,1)",[`USER:${f.principalId}`,f.principalId]);c.close();
  const second=await service.handle('/api/local/mcp/inspect',{id:f.a.id});assert.notEqual(second.catalogRevision,first.catalogRevision);
  const search=await service.handle('/api/local/mcp/targets',{id:f.a.id,query:'first_name'});
  assert.equal(search.items.filter(x=>x.target==='profile.first_name'&&x.kind==='field').length,2);
  assert.ok(search.items.length<=32);assert.ok(Buffer.byteLength(JSON.stringify(search))<=256*1024);
  const db=f.database.connect();db.run("UPDATE preference_definitions SET archived_at=1 WHERE id='personal-collision'");db.close();
  const third=await service.handle('/api/local/mcp/inspect',{id:f.a.id});assert.notEqual(third.catalogRevision,second.catalogRevision);
});
test('corrupt or oversized catalog disables complete claims and Save while leaving CLI and terminal revoke available',async t=>{
  const f=fixture(t);const c=f.database.connect();c.run('UPDATE preference_definitions SET slug=? WHERE slug=?',['invalid slug','profile.first_name']);c.close();
  const {LocalUiManagement}=require('../../dist/local-ui/local-ui-management.js');const service=new LocalUiManagement(f.store,f.principalId);
  const state=await service.handle('/api/local/mcp/inspect',{id:f.a.id});
  assert.equal(state.catalogStatus,'CATALOG_UNAVAILABLE');assert.equal(state.summary,undefined);
  await assert.rejects(proposal(f));
  f.store.permissions(f.a.id,fullPolicy);assert.equal(f.store.revoke(f.a.id,1).revoked,true);
});

test('a failure after COMMIT remains an error even though one complete Save is durable',async t=>{
  const f=fixture(t),p=await proposal(f,fullPolicy,[{target:'*',action:'WRITE',effect:'DENY'}]);
  const connect=f.database.connect.bind(f.database);
  f.database.connect=()=>{const c=connect(),exec=c.exec.bind(c);let writing=false;c.exec=sql=>{if(sql==='BEGIN IMMEDIATE')writing=true;const result=exec(sql);if(writing&&sql==='COMMIT')throw new Error('lost commit acknowledgement');return result;};return c;};
  await assert.rejects(p.service.handle('/api/local/mcp/save',{...p.body,previewKey:p.preview.previewKey}),/lost commit acknowledgement/);
  f.database.connect=connect;
  assert.deepEqual(f.store.authenticate(f.token).policy,fullPolicy);
  assert.equal(f.store.inspectForUi(f.a.id).grants.length,1);
});

test('future and archived targets disclose rule-removal or ALLOW widening even without current matching fields',async t=>{
  const f=fixture(t);f.store.permissions(f.a.id,fullPolicy);f.store.grant(f.a.id,'future_only.*','READ','DENY');
  for(const edit of [{target:'future_only.*',action:'READ',effect:'REMOVE'},{target:'future_only.exact',action:'READ',effect:'ALLOW'}]){
    const p=await proposal(f,fullPolicy,[edit]);assert.ok(p.preview.widening.some(message=>/future|archived/i.test(message)));
  }
});
test('each client card pairs policy, grants and catalog from the detached page snapshot', async (t) => {
  const f = fixture(t),
    original = f.store.cardSnapshots.bind(f.store);
  for (const id of [f.a.id, f.b.id])
    f.store.permissions(id, {
      capabilities: ['preferences:read'],
      targets: ['profile.*'],
      allowSensitive: false,
    });
  const {
    LocalUiManagement,
  } = require('../../dist/local-ui/local-ui-management.js');
  const service = new LocalUiManagement(f.store, f.principalId),
    before = await service.handle('/api/local/mcp/list', {});
  assert.ok(before.items.some((card) => card.summary.counts.read > 0));
  f.store.cardSnapshots = (...args) => {
    const result = original(...args);
    f.store.permissions(f.a.id, fullPolicy);
    f.store.grant(f.a.id, '*', 'READ', 'DENY');
    const c = f.database.connect();
    c.run('UPDATE preference_definitions SET is_sensitive=1');
    c.close();
    return result;
  };
  const result = await service.handle('/api/local/mcp/list', {});
  assert.deepEqual(
    result,
    before,
    'all card policies, grants and summaries retain the captured catalog',
  );
  assert.deepEqual(
    f.store.list().find((item) => item.id === f.a.id).policy,
    fullPolicy,
  );
  assert.equal(f.store.inspectForUi(f.a.id).grants.length, 1);
});

test('catalog row overflow and malformed edit envelopes fail closed without blocking terminal recovery',async t=>{
  const f=fixture(t);const p=await proposal(f);
  for(const edits of [[{target:'*',action:'READ',effect:'DENY',extra:true}],Array(513).fill({target:'*',action:'READ',effect:'DENY'}),[{target:'*',action:'READ',effect:'DENY'},{target:'*',action:'READ',effect:'ALLOW'}]])
    await assert.rejects(p.service.handle('/api/local/mcp/preview',{...p.body,edits}));
  const c=f.database.connect();c.exec('BEGIN IMMEDIATE');
  for(let i=0;i<2049;i++)c.run('INSERT INTO preference_definitions(id,namespace,slug,description,value_type,scope,created_at,updated_at) VALUES(?,\'GLOBAL\',?,\'\',\'STRING\',\'GLOBAL\',1,1)',['overflow-'+i,'overflow.'+i]);
  c.exec('COMMIT');c.close();
  const state=await p.service.handle('/api/local/mcp/inspect',{id:f.a.id});assert.equal(state.catalogStatus,'CATALOG_UNAVAILABLE');assert.equal(state.summary,undefined);
  await assert.rejects(p.service.handle('/api/local/mcp/save',{...p.body,previewKey:p.preview.previewKey}));assert.equal(f.store.revoke(f.a.id,1).revoked,true);
});

test('enriched client list retains all 32 maximal policies within its 512 KiB response bound', async t => {
  const f = fixture(t);
  const ids = [f.a.id, f.b.id];
  for (let index = 2; index < 32; index++) ids.push(f.store.provision('large valid policy', path.join(f.root, `client-${index}.token`)).id);
  const targets = Array.from({length:64}, (_, index) => `target_${index}_`.padEnd(128, 'x'));
  const policy = {capabilities:['preferences:write','preferences:define'], targets, allowSensitive:true};
  for (const id of ids) f.store.permissions(id, policy);
  const {LocalUiManagement} = require('../../dist/local-ui/local-ui-management.js');
  const result = await new LocalUiManagement(f.store, f.principalId).handle('/api/local/mcp/list', {});
  assert.equal(result.items.length, 32);
  assert.equal(result.nextCursor, null);
  assert.ok(Buffer.byteLength(JSON.stringify(result)) <= 512 * 1024, 'enriched response must retain its advertised bound');
  for (const item of result.items) {
    assert.deepEqual(item.policy, policy);
    assert.equal(item.summary.level, 'No current fields');
    assert.equal(item.summary.total, 0);
  }
});

test('valid long catalog labels and exact slugs remain available; cosmetic labels do not bind authority', (t) => {
  const f = fixture(t),
    c = f.database.connect();
  const slug = 'synthetic.' + 'x'.repeat(120);
  c.run(
    `INSERT INTO preference_definitions(id,namespace,slug,display_name,description,value_type,scope,is_sensitive,owner_user_id,archived_at,created_at,updated_at)
    VALUES('long-definition',?,?,?,'','STRING','GLOBAL',0,?,NULL,1,1)`,
    [`USER:${f.principalId}`, slug, 'N'.repeat(513), f.principalId],
  );
  const first = f.store.editorSnapshot(f.a.id);
  assert.equal(first.catalogStatus, 'AVAILABLE');
  const row = first.catalog.find((row) => row.id === 'long-definition');
  assert.equal(row.slug, slug);
  assert.equal(row.displayNameTruncated, true);
  assert.ok(Buffer.byteLength(row.displayName) <= 512);
  c.run(
    "UPDATE preference_definitions SET display_name=? WHERE id='long-definition'",
    ['Other'.repeat(1000)],
  );
  assert.equal(
    f.store.editorSnapshot(f.a.id).catalogRevision,
    first.catalogRevision,
  );
  for (const update of [
    'is_sensitive=1',
    'archived_at=2',
    "slug='synthetic.changed'",
  ]) {
    const before = f.store.editorSnapshot(f.a.id);
    c.exec(
      `UPDATE preference_definitions SET ${update} WHERE id='long-definition'`,
    );
    const after = f.store.editorSnapshot(f.a.id);
    assert.equal(after.catalogStatus, 'AVAILABLE');
    assert.notEqual(after.catalogRevision, before.catalogRevision);
  }
  c.close();
});

test('catalog row and exact slug byte bounds fail closed, while long dotted selectors remain bounded', async (t) => {
  const f = fixture(t),
    c = f.database.connect();
  const slug = 'synthetic.' + 'x.'.repeat(50000) + 'end';
  c.run(
    `INSERT INTO preference_definitions(id,namespace,slug,display_name,description,value_type,scope,is_sensitive,owner_user_id,archived_at,created_at,updated_at)
    VALUES('dotted-definition',?,?,?,'','STRING','GLOBAL',0,?,NULL,1,1)`,
    [`USER:${f.principalId}`, slug, 'Long dotted field', f.principalId],
  );
  f.store.permissions(f.a.id, {
    capabilities: ['preferences:write'],
    targets: ['synthetic.*'],
    allowSensitive: false,
  });
  const {
    LocalUiManagement,
  } = require('../../dist/local-ui/local-ui-management.js');
  const service = new LocalUiManagement(f.store, f.principalId);
  const snapshot = f.store.editorSnapshot(f.a.id);
  assert.equal(snapshot.catalogStatus, 'AVAILABLE');
  const targets = await service.handle('/api/local/mcp/targets', {
    id: f.a.id,
    query: 'Long dotted',
  });
  assert.equal(targets.items.length, 1);
  assert.equal(targets.items[0].selectable, false);
  assert.equal(targets.items[0].target, undefined);
  assert.equal(targets.items[0].displaySlugTruncated, true);
  assert.ok(Buffer.byteLength(JSON.stringify(targets)) <= 256 * 1024);
  const categories = await service.handle('/api/local/mcp/targets', {
    id: f.a.id,
    query: 'prefix',
  });
  assert.ok(categories.items.every((item) => item.target.length <= 128));
  const suffix = await service.handle('/api/local/mcp/targets', {
    id: f.a.id,
    query: 'x.end',
  });
  assert.equal(
    suffix.items.length,
    1,
    'search matches the full slug before clipping display',
  );
  const inspected = await service.handle('/api/local/mcp/inspect', {
    id: f.a.id,
  });
  assert.equal(inspected.summary.counts.write, 1);
  const proposed = await service.handle('/api/local/mcp/preview', {
    id: f.a.id,
    generation: 1,
    revision: inspected.revision,
    catalogRevision: inspected.catalogRevision,
    policy: { ...inspected.client.policy, capabilities: ['preferences:read'] },
    edits: [],
  });
  assert.equal(proposed.examples[0].targetTruncated, true);
  assert.equal(proposed.examples[0].before.write, true);
  assert.equal(proposed.examples[0].after.write, false);
  assert.ok(Buffer.byteLength(JSON.stringify(proposed)) <= 256 * 1024);
  c.run(
    "UPDATE preference_definitions SET slug=? WHERE id='dotted-definition'",
    ['synthetic.' + 'x'.repeat(2 * 1024 * 1024)],
  );
  const connect = f.database.connect.bind(f.database);
  let oversizedMaterialized = false;
  f.database.connect = () => {
    const db = connect(),
      get = db.get.bind(db);
    db.get = (sql, args) => {
      if (
        sql === 'SELECT slug FROM preference_definitions WHERE id=?' &&
        args[0] === 'dotted-definition'
      )
        oversizedMaterialized = true;
      return get(sql, args);
    };
    return db;
  };
  assert.equal(
    f.store.editorSnapshot(f.a.id).catalogStatus,
    'CATALOG_UNAVAILABLE',
  );
  assert.equal(
    oversizedMaterialized,
    false,
    'size preflight rejects before materializing oversized authoritative text',
  );
  f.database.connect = connect;
  c.run(
    "UPDATE preference_definitions SET slug='synthetic.small' WHERE id='dotted-definition'",
  );
  const count = c.get('SELECT count(*) n FROM preference_definitions').n;
  c.exec('BEGIN IMMEDIATE');
  for (let i = count; i < 2049; i++)
    c.run(
      `INSERT INTO preference_definitions(id,namespace,slug,display_name,description,value_type,scope,is_sensitive,owner_user_id,archived_at,created_at,updated_at)
    VALUES(?, 'GLOBAL', ?,NULL,'','STRING','GLOBAL',0,NULL,NULL,1,1)`,
      ['boundary-' + i, 'boundary.field_' + i],
    );
  c.exec('COMMIT');
  assert.equal(
    f.store.editorSnapshot(f.a.id).catalogStatus,
    'CATALOG_UNAVAILABLE',
  );
  c.run('DELETE FROM preference_definitions WHERE id=?', ['boundary-2048']);
  assert.equal(f.store.editorSnapshot(f.a.id).catalogStatus, 'AVAILABLE');
  c.close();
  assert.equal(f.store.revoke(f.a.id, 1).revoked, true);
});

test(
  'maximum metadata page reads one catalog, skips unused digests and yields to other requests',
  { timeout: 90000 },
  async (t) => {
    const f = fixture(t),
      ids = [f.a.id, f.b.id];
    for (let i = 2; i < 32; i++)
      ids.push(
        f.store.provision('bounded load', path.join(f.root, `load-${i}.token`))
          .id,
      );
    for (const id of ids)
      f.store.permissions(id, {
        capabilities: ['preferences:write', 'preferences:define'],
        targets: ['*'],
        allowSensitive: false,
      });
    const c = f.database.connect();
    c.exec('BEGIN IMMEDIATE');
    const existing = c.get('SELECT count(*) n FROM preference_definitions').n;
    for (let i = existing; i < 2048; i++)
      c.run(
        `INSERT INTO preference_definitions(id,namespace,slug,display_name,description,value_type,scope,is_sensitive,created_at,updated_at)
    VALUES(?,'GLOBAL',?,?,'','STRING','GLOBAL',?,1,1)`,
        ['load-' + i, 'load.field_' + i, 'Field ' + i, i % 7 === 0 ? 1 : 0],
      );
    for (const id of ids)
      for (let i = 0; i < 512; i++)
        c.run(
          `INSERT INTO permission_grants(id,user_id,client_key,target,action,effect,created_at,updated_at) VALUES(?,?,?,?,?,?,1,1)`,
          [
            id + '-rule-' + i,
            f.principalId,
            'local:' + id,
            'load.field_' + i,
            ['READ', 'SUGGEST', 'WRITE', 'DEFINE'][i % 4],
            i % 2 ? 'ALLOW' : 'DENY',
          ],
        );
    c.exec('COMMIT');
    c.close();
    const connect = f.database.connect.bind(f.database);
    let catalogQueries = 0,
      digestQueries = 0,
      transactions = 0;
    f.database.connect = () => {
      const db = connect();
      for (const method of ['get', 'all']) {
        const original = db[method].bind(db);
        db[method] = (sql, ...args) => {
          if (sql.includes('slugBytes')) catalogQueries++;
          if (sql.includes('rowid cursor')) digestQueries++;
          return original(sql, ...args);
        };
      }
      const exec = db.exec.bind(db);
      db.exec = (sql) => {
        const result = exec(sql);
        if (sql === 'BEGIN') transactions++;
        if (sql === 'COMMIT' || sql === 'ROLLBACK') transactions--;
        return result;
      };
      return db;
    };
    const {
      LocalUiManagement,
    } = require('../../dist/local-ui/local-ui-management.js');
    const service = new LocalUiManagement(f.store, f.principalId);
    let finished = false,
      timerBeforeFinish = false;
    const heartbeat = new Promise((resolve) =>
      setTimeout(() => {
        timerBeforeFinish = !finished;
        assert.equal(
          transactions,
          0,
          'yield must be outside read transactions',
        );
        resolve();
      }, 0),
    );
    const started = performance.now();
    const list = await service.handle('/api/local/mcp/list', {});
    finished = true;
    const listMs = performance.now() - started;
    await heartbeat;
    assert.equal(
      timerBeforeFinish,
      true,
      'list evaluation must service the event loop before completion',
    );
    assert.ok(
      catalogQueries <= 2049,
      `one catalog only, saw ${catalogQueries} preflights`,
    );
    assert.equal(
      digestQueries,
      0,
      'cards must not compute unused complete administration digests',
    );
    assert.equal(list.items.length, 32);
    assert.equal(list.items[0].summary.total, 2048);
    const inspectStart = performance.now(),
      inspect = await service.handle('/api/local/mcp/inspect', { id: ids[0] }),
      inspectMs = performance.now() - inspectStart;
    assert.ok(digestQueries > 0, 'inspect retains complete content CAS');
    const previewStart = performance.now(),
      preview = await service.handle('/api/local/mcp/preview', {
        id: ids[0],
        generation: inspect.client.generation,
        revision: inspect.revision,
        catalogRevision: inspect.catalogRevision,
        policy: {
          ...inspect.client.policy,
          capabilities: ['preferences:read'],
        },
        edits: [],
      }),
      previewMs = performance.now() - previewStart;
    assert.deepEqual(preview.before.counts, inspect.summary.counts);
    assert.ok(Buffer.byteLength(JSON.stringify(list)) <= 512 * 1024);
    assert.ok(Buffer.byteLength(JSON.stringify(preview)) <= 256 * 1024);
    t.diagnostic(
      JSON.stringify({
        listMs,
        inspectMs,
        previewMs,
        catalogQueries,
        digestQueries,
      }),
    );
  },
);

test('indexed authorization readers preserve fallback specificity without constructing giant prefix chains', async () => {
  const {
    PermissionGrantService,
    matchesGrantTarget,
  } = require('../../dist/modules/permission-grant/permission-grant.service.js');
  const {
    McpAuthorizationService,
  } = require('../../dist/mcp/auth/mcp-authorization.service.js');
  assert.equal(typeof matchesGrantTarget, 'function');
  const rows = [
    { target: '*', effect: 'DENY' },
    { target: 'synthetic.*', effect: 'ALLOW' },
    { target: 'synthetic.private.*', effect: 'DENY' },
    { target: 'synthetic.private.one', effect: 'ALLOW' },
    { target: 'synthetic.tie.*', effect: 'ALLOW' },
    { target: 'synthetic.tie.*', effect: 'DENY' },
  ];
  const fallback = new PermissionGrantService({
    findMatchingGrants: async (_u, _c, _a, prefixes) =>
      rows.filter((row) => prefixes.includes(row.target)),
    findByUserClientAction: async () => rows,
  });
  let indexedCalls = 0;
  const indexed = new PermissionGrantService({
    findMatchingGrants: async () => {
      throw new Error('unexpected prefix query');
    },
    findByUserClientAction: async () => rows,
    findMatchingGrantsForSlug: async (_u, _c, _a, slug) => {
      indexedCalls++;
      return rows.filter((row) => matchesGrantTarget(row.target, slug));
    },
  });
  for (const slug of [
    'synthetic.one',
    'synthetic.private.one',
    'synthetic.private.two',
    'synthetic.private',
    'synthetic.tie.one',
    'synthetic.tie',
    'syntheticish.one',
    'other.value',
  ]) {
    assert.equal(
      await indexed.evaluateAccess('u', 'c', 'read', slug),
      await fallback.evaluateAccess('u', 'c', 'read', slug),
    );
    assert.deepEqual(
      await indexed.filterSlugsByAccess('u', 'c', 'read', [slug]),
      await fallback.filterSlugsByAccess('u', 'c', 'read', [slug]),
    );
  }
  const giant = 'synthetic.' + 'x.'.repeat(50000) + 'end';
  assert.equal(await indexed.evaluateAccess('u', 'c', 'read', giant), 'allow');
  let sensitivityCalls = 0;
  const auth = new McpAuthorizationService(indexed, {
    getAll: async () => {
      throw new Error('unexpected catalog scan');
    },
    getDefinitionById: async () => null,
    isSensitiveSlug: async (_user, slug) => {
      sensitivityCalls++;
      return slug === 'synthetic.private.one';
    },
  });
  const client = {
    key: 'c',
    externalId: 'c',
    policy: {
      key: 'c',
      label: 'c',
      capabilities: ['preferences:write'],
      targetRules: [],
      allowSensitive: false,
    },
  };
  assert.equal(
    await auth.canAccessTarget(
      client,
      { resource: 'preferences', action: 'write' },
      undefined,
      'u',
      { slug: giant },
    ),
    true,
  );
  assert.equal(
    await auth.canAccessTarget(
      client,
      { resource: 'preferences', action: 'read' },
      undefined,
      'u',
      { slug: 'synthetic.private.one' },
    ),
    false,
  );
  assert.equal(sensitivityCalls, 2);
  assert.ok(indexedCalls > 0);
  const chained = new McpAuthorizationService(
    new PermissionGrantService({
      findMatchingGrants: async (_u, _c, action) => [
        {
          target: 'synthetic.*',
          effect: action === 'SUGGEST' ? 'DENY' : 'ALLOW',
        },
      ],
      findByUserClientAction: async () => [],
    }),
  );
  const unrestricted = {
    ...client,
    policy: {
      ...client.policy,
      allowSensitive: true,
      capabilities: ['preferences:write', 'preferences:define'],
    },
  };
  for (const [action, expected] of [
    ['read', true],
    ['suggest', false],
    ['write', false],
    ['define', true],
  ])
    assert.equal(
      await chained.canAccessTarget(
        unrestricted,
        { resource: 'preferences', action },
        undefined,
        'u',
        { slug: 'synthetic.value' },
      ),
      expected,
    );
});

test('catalog keyset uses the ID index range instead of sorting namespace matches per row', (t) => {
  const f = fixture(t),
    connect = f.database.connect.bind(f.database),
    plans = [];
  f.database.connect = () => {
    const c = connect(),
      get = c.get.bind(c);
    c.get = (sql, ...args) => {
      if (
        sql.includes('slugBytes') &&
        sql.includes('AND id COLLATE BINARY > ?')
      )
        plans.push(
          c
            .all('EXPLAIN QUERY PLAN ' + sql, ...args)
            .map((row) => row.detail)
            .join('; '),
        );
      return get(sql, ...args);
    };
    return c;
  };
  assert.equal(f.store.editorSnapshot(f.a.id).catalogStatus, 'AVAILABLE');
  assert.ok(plans.length > 0);
  assert.ok(
    plans.every(
      (plan) => plan.includes('(id>?)') && !plan.includes('TEMP B-TREE'),
    ),
    plans.join('\n'),
  );
});

test('preview discloses narrowing of future scope, sensitivity, DEFINE, value level and archived rule ranges', async (t) => {
  const f = fixture(t);
  f.store.permissions(f.a.id, {
    capabilities: ['preferences:write', 'preferences:define'],
    targets: ['profile.*', 'future.*'],
    allowSensitive: true,
  });
  f.store.grant(f.a.id, 'future.legacy', 'READ', 'ALLOW');
  const p = await proposal(
    f,
    {
      capabilities: ['preferences:read'],
      targets: ['profile.*'],
      allowSensitive: false,
    },
    [
      { target: 'future.legacy', action: 'READ', effect: 'REMOVE' },
      { target: 'profile.*', action: 'WRITE', effect: 'DENY' },
    ],
  );
  assert.ok(
    p.preview.narrowing.some((text) =>
      /scope.*future|future.*scope/i.test(text),
    ),
  );
  for (const term of [
    'Sensitive',
    'Definition management',
    'maximum value',
    'archived',
  ])
    assert.ok(
      p.preview.narrowing.some((text) => text.includes(term)),
      term,
    );
});
