'use strict';
// Test-only process policy. Product code never installs these hooks.
const Module = require('node:module'),
  fs = require('node:fs'),
  path = require('node:path');
const net = require('node:net'),
  tls = require('node:tls'),
  dns = require('node:dns'),
  promises = require('node:dns/promises');
const udp = require('node:dgram'),
  http = require('node:http'),
  http2 = require('node:http2');
const cp = require('node:child_process'),
  threads = require('node:worker_threads');
const { fileURLToPath } = require('node:url');
const dist = fs.realpathSync(process.env.LOCAL_DATABASE_RUNTIME_DIST);
const root = fs.realpathSync(process.env.LOCAL_MCP_SMOKE_ROOT);
const dependencies = fs.realpathSync(process.env.LOCAL_MCP_SMOKE_DEPENDENCIES);
const webRoot = process.env.LOCAL_UI_SMOKE_WEB_ROOT ? fs.realpathSync(process.env.LOCAL_UI_SMOKE_WEB_ROOT) : undefined;
const worker = path.join(
  dist,
  'infrastructure/storage/sqlite/sqlite-coordination.worker.js',
);
const isThread = !threads.isMainThread,
  port = isThread ? 0 : Number(process.env.LOCAL_MODEL_PORT);
const ack = isThread ? threads.workerData.__mcpAcknowledgement : undefined;
if (isThread) delete threads.workerData.__mcpAcknowledgement;
const counters = {
  controls: 0,
  connections: 0,
  listeners: [],
  sqliteThreads: [],
};
let failed = false;
const deny = () => {
  const error = new Error('LOCAL_MCP_SMOKE_DENIED');
  error.code = 'LOCAL_MCP_SMOKE_DENIED';
  throw error;
};
const inside = (file, parent) =>
  file === parent || file.startsWith(parent + path.sep);
const forbidden =
  /(?:^|[\/\\])(?:pg(?:[\/\\]|$)|@prisma[\/\\]|@google-cloud[\/\\]|auth0(?:[\/\\]|$)|jwks-rsa(?:[\/\\]|$))|infrastructure[\/\\](?:prisma|postgres|vertex-ai)(?:[\/\\]|$)/u;
Module.registerHooks({
  resolve(specifier, context, next) {
    if (forbidden.test(specifier)) deny();
    const resolved = next(specifier, context);
    if (forbidden.test(resolved.url)) deny();
    if (!resolved.url.startsWith('node:')) {
      if (!resolved.url.startsWith('file:')) deny();
      const file = fs.realpathSync(fileURLToPath(resolved.url));
      if (
        forbidden.test(file) ||
        !(
          inside(file, dist) ||
          inside(file, dependencies) ||
          (webRoot && ([path.join(webRoot, 'local-ui.mjs'), path.join(webRoot, 'next.config.mjs')].includes(file) || inside(file, path.join(webRoot, '.next')))) ||
          [__filename, path.join(__dirname, 'entry.cjs')].includes(file)
        )
      )
        deny();
    }
    return resolved;
  },
});
const listen = net.Server.prototype.listen;
let bindingLiteralListener = false;
net.Server.prototype.listen = function (...args) {
  if (
    isThread ||
    process.env.LOCAL_MCP_SMOKE_OPERATION !== 'serve-model' ||
    counters.listeners.length >= (webRoot ? 2 : 1) ||
    !(args.length === 2 || (webRoot && args.length === 3 && typeof args[2] === 'function')) ||
    args[0] !== 0 ||
    args[1] !== '127.0.0.1'
  )
    deny();
  const record = { port: 0, closed: false };
  counters.listeners.push(record);
  this.once('listening', () => {
    const address = this.address();
    if (address.address !== '127.0.0.1') failed = true;
    record.port = address.port;
  });
  this.once('close', () => {
    record.closed = true;
  });
  bindingLiteralListener = true;
  try {
    return listen.apply(this, args);
  } finally {
    bindingLiteralListener = false;
  }
};
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const value = Array.isArray(args[0]) ? args[0][0] : args[0];
  if (
    isThread ||
    process.env.LOCAL_MCP_SMOKE_OPERATION !== 'serve-model' ||
    !(this instanceof tls.TLSSocket) ||
    !value ||
    typeof value !== 'object' ||
    value.path != null ||
    value.host !== '127.0.0.1' ||
    Number(value.port) !== port ||
    !Number.isInteger(port) ||
    port < 1
  )
    deny();
  counters.connections++;
  return connect.apply(this, args);
};
for (const api of [dns, promises])
  for (const name of Object.keys(api))
    if (
      /^(?:lookup|resolve|reverse)/u.test(name) &&
      typeof api[name] === 'function'
    )
      api[name] = deny;
for (const api of [dns.Resolver?.prototype, promises.Resolver?.prototype])
  if (api)
    for (const name of Object.getOwnPropertyNames(api))
      if (/^(?:resolve|reverse)/u.test(name)) api[name] = deny;
// Node calls dns.lookup even for a literal bind. Satisfy that exact internal call without DNS I/O.
dns.lookup = (hostname, options, callback) => {
  if (
    !bindingLiteralListener ||
    hostname !== '127.0.0.1' ||
    typeof callback !== 'function'
  )
    deny();
  if (options?.all === true)
    process.nextTick(callback, null, [{ address: '127.0.0.1', family: 4 }]);
  else process.nextTick(callback, null, '127.0.0.1', 4);
};
udp.createSocket = deny;
http.request = deny;
http.get = deny;
http2.connect = deny;
globalThis.fetch = deny;
globalThis.WebSocket = class {
  constructor() {
    deny();
  }
};
for (const name of [
  'spawn',
  'spawnSync',
  'exec',
  'execFile',
  'execSync',
  'execFileSync',
  'fork',
])
  cp[name] = deny;
const Worker = threads.Worker;
threads.Worker = class extends Worker {
  constructor(file, options) {
    const keys = (v) =>
      v && typeof v === 'object' ? Object.keys(v).sort().join() : '';
    const paths = options?.workerData?.paths;
    const allowedRoots = [root];
    if (process.env.LOCAL_MCP_SMOKE_OPERATION === 'recovery')
      allowedRoots.push(
        path.join(root, 'restore-v1'),
        path.join(root, 'restore-v2'),
      );
    if (
      isThread ||
      file !== worker ||
      fs.realpathSync(file) !== file ||
      counters.sqliteThreads.length >= 8 ||
      keys(options) !== 'env,execArgv,workerData' ||
      !options.env ||
      Object.getPrototypeOf(options.env) !== Object.prototype ||
      keys(options.env) !== '' ||
      JSON.stringify(options.execArgv) !== '["--no-global-search-paths"]' ||
      keys(options.workerData) !== 'paths' ||
      keys(paths) !== 'databaseRoot,expectedTarget,identityRoot' ||
      !allowedRoots.some(
        (allowed) =>
          paths.databaseRoot === path.join(allowed, 'data') &&
          paths.identityRoot === path.join(allowed, 'identity'),
      ) ||
      typeof paths.expectedTarget !== 'string' ||
      !paths.expectedTarget.length
    )
      deny();
    const cell = new Int32Array(new SharedArrayBuffer(4));
    super(file, {
      workerData: { paths: { ...paths }, __mcpAcknowledgement: cell.buffer },
      execArgv: ['--no-global-search-paths', '--require', __filename],
      env: {
        ...(webRoot ? { LOCAL_UI_SMOKE_WEB_ROOT: webRoot } : {}),
        LOCAL_DATABASE_RUNTIME_DIST: dist,
        LOCAL_MCP_SMOKE_ROOT: root,
        LOCAL_MCP_SMOKE_DEPENDENCIES: dependencies,
        LOCAL_MCP_SMOKE_PROVIDER: process.env.LOCAL_MCP_SMOKE_PROVIDER,
      },
    });
    const record = {
      threadId: this.threadId,
      controls: 0,
      code: null,
      exited: false,
    };
    counters.sqliteThreads.push(record);
    this.once('error', () => {
      failed = true;
    });
    this.once('exit', (code) => {
      Object.assign(record, {
        controls: Atomics.load(cell, 0),
        code,
        exited: true,
      });
    });
  }
};
Module.syncBuiltinESMExports();
async function controls() {
  let count = 0;
  for (const surface of [require, (name) => import(name)]) {
    const n = await surface('node:net'),
      t = await surface('node:tls'),
      d = await surface('node:dns'),
      u = await surface('node:dgram');
    const child = await surface('node:child_process'),
      thread = await surface('node:worker_threads'),
      web = await surface('node:http'),
      h2 = await surface('node:http2');
    for (const operation of [
      () => n.connect({ host: '127.0.0.1', port }),
      () =>
        t.connect({
          host:
            process.env.LOCAL_MCP_SMOKE_OPERATION === 'serve-model'
              ? 'localhost'
              : '127.0.0.1',
          port,
        }),
      () =>
        t.connect({
          host: '127.0.0.1',
          port: port === 65535 ? 65534 : port + 1,
        }),
      () => t.connect({ host: '192.0.2.1', port }),
      () => n.connect({ path: '/tmp/forbidden.sock' }),
      () => n.createServer().listen(0),
      () => n.createServer().listen(1, '127.0.0.1'),
      () => d.lookup('example.invalid', () => {}),
      () => u.createSocket('udp4'),
      () => surface('@google-cloud/vertexai'),
      () => surface('pg'),
      () => surface(process.env.LOCAL_MCP_SMOKE_PROVIDER),
      () => surface('auth0'),
      () => surface('jwks-rsa'),
      () => child.spawn(process.execPath, []),
      () => new thread.Worker('process.exit(0)', { eval: true }),
      () =>
        new thread.Worker(worker, {
          env: {},
          execArgv: ['--no-global-search-paths'],
          workerData: { paths: {} },
        }),
      () => web.request('http://127.0.0.1/'),
      () => h2.connect('http://127.0.0.1/'),
      () => surface(path.join(root, 'outside.cjs')),
    ]) {
      try {
        await operation();
        throw new Error('Missing denial');
      } catch (error) {
        if (error.code !== 'LOCAL_MCP_SMOKE_DENIED') throw error;
        count++;
      }
    }
  }
  for (const operation of [
    () => fetch('https://example.invalid'),
    () => new WebSocket('wss://example.invalid'),
  ]) {
    try {
      await operation();
      throw new Error('Missing denial');
    } catch (error) {
      if (error.code !== 'LOCAL_MCP_SMOKE_DENIED') throw error;
      count++;
    }
  }
  if (count !== 42) throw new Error('Missing controls');
  counters.controls = count;
  return count;
}
const valid = () =>
  !failed &&
  counters.controls === 42 &&
  counters.sqliteThreads.every(
    (r) => r.exited && r.code === 0 && r.controls === 42,
  ) &&
  counters.listeners.every((r) => r.closed);
const exit = process.exit;
process.exit = (code) => exit(valid() ? code : 1);
process.once('beforeExit', () => {
  if (!valid()) process.exitCode = 1;
});
Object.defineProperty(globalThis, '__localMcpSmoke', {
  value: {
    controls,
    counters,
    get policyFailed() {
      return failed;
    },
  },
});
if (isThread)
  controls().then(
    (count) => {
      if (!(ack instanceof SharedArrayBuffer) || ack.byteLength !== 4)
        throw new Error();
      Atomics.store(new Int32Array(ack), 0, count);
    },
    () => {
      failed = true;
    },
  );
