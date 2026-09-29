// Isolated fault/race harness. Never loaded by the application.
const fs = require('node:fs');
const path = require('node:path');
const dist = path.resolve(__dirname, '../../../dist');
const { SqliteDatabase, SqliteConnection } = require(
  path.join(dist, 'infrastructure/storage/sqlite/sqlite-database.js'),
);
const { SqliteMcpCredentials } = require(
  path.join(dist, 'infrastructure/storage/sqlite/sqlite-mcp-credentials.js'),
);
const [root, mode, id, exportName, marker, release] = process.argv.slice(2);
const db = SqliteDatabase.open({
  databaseRoot: path.join(root, 'data'),
  identityRoot: path.join(root, 'identity'),
});
const principal = JSON.parse(
  fs.readFileSync(path.join(root, 'identity/identity.json')),
).principalId;
const store = new SqliteMcpCredentials(db, principal);
function barrier() {
  fs.writeFileSync(marker, 'ready', { flag: 'wx', mode: 0o600 });
  const end = Date.now() + 8000;
  while (!fs.existsSync(release)) {
    if (Date.now() >= end) process.exit(90);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
  }
}
if (mode.startsWith('publish-')) {
  const stage = mode.split('-')[2];
  if (stage === 'export') {
    const change = store.change.bind(store);
    store.change = () => process.exit(77);
  } else {
    const exec = SqliteConnection.prototype.exec;
    SqliteConnection.prototype.exec = function (sql) {
      if (sql === 'COMMIT' && stage === 'before') process.exit(77);
      const result = exec.call(this, sql);
      if (sql === 'COMMIT' && stage === 'after') process.exit(77);
      return result;
    };
  }
} else if (mode.startsWith('crash-')) {
  const exec = SqliteConnection.prototype.exec;
  SqliteConnection.prototype.exec = function (sql) {
    exec.call(this, sql);
    if (
      (mode === 'crash-before-commit' &&
        sql.includes('CREATE TABLE local_mcp_clients')) ||
      (mode === 'crash-after-commit' && sql === 'COMMIT')
    )
      process.exit(77);
  };
} else if (marker) {
  const change = store.change.bind(store);
  store.change = (operation) => {
    barrier();
    return change(operation);
  };
}
try {
  if (mode === 'verify') {
    const exported = fs
      .readFileSync(path.join(root, exportName), 'utf8')
      .trim();
    const original = fs.existsSync(path.join(root, 'original.token'))
      ? fs.readFileSync(path.join(root, 'original.token'), 'utf8').trim()
      : '';
    process.stdout.write(
      JSON.stringify({
        rows: store.list(),
        original: !!store.authenticate(original),
        exported: !!store.authenticate(exported),
      }) + '\n',
    );
    process.exit(0);
  }
  if (mode.startsWith('publish-provision-'))
    store.provision('synthetic', path.join(root, exportName));
  else if (mode.startsWith('publish-rotate-'))
    store.rotate(id, path.join(root, exportName));
  else if (mode.startsWith('crash-')) store.upgrade();
  else if (mode === 'rotate') store.rotate(id, path.join(root, exportName));
  else if (mode === 'revoke') store.revoke(id);
  else if (mode === 'policy')
    store.permissions(id, {
      capabilities: ['preferences:write'],
      targets: ['*'],
      allowSensitive: true,
    });
  else throw new Error();
  process.stdout.write('ok\n');
} catch {
  process.stderr.write('conflict\n');
  process.exitCode = 1;
}
