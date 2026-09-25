'use strict';
// Test-only instrumentation. Never loaded by a product entrypoint without --require.
const Module = require('node:module');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const tls = require('node:tls');
const dns = require('node:dns');
const dnsPromises = require('node:dns/promises');
const dgram = require('node:dgram');
const http = require('node:http');
const http2 = require('node:http2');
const cp = require('node:child_process');
const threads = require('node:worker_threads');
const { threadResult } = require('./thread-evidence.cjs');
const parserOnly = process.env.LOCAL_MODEL_SMOKE_PARSER === '1';
const threadOnly = !threads.isMainThread;
const acknowledgement = threadOnly ? threads.workerData.__modelSmokeAcknowledgement : undefined;
if (threadOnly) delete threads.workerData.__modelSmokeAcknowledgement;
const port = parserOnly || threadOnly ? 0 : Number(process.env.LOCAL_MODEL_PORT);
const dist = fs.realpathSync(process.env.LOCAL_DATABASE_RUNTIME_DIST);
const dependencyRoot = fs.realpathSync(process.env.LOCAL_MODEL_SMOKE_DEPENDENCIES);
const ownedRoot = fs.realpathSync(process.env.LOCAL_MODEL_SMOKE_ROOT);
const inside = (file, root) => file === root || file.startsWith(root + path.sep);
const { fileURLToPath } = require('node:url');
const worker = dist && path.join(dist, 'infrastructure/local-model/engine/pdf-worker.mjs');
const missingWorker = parserOnly ? undefined : path.join(process.env.LOCAL_MODEL_SMOKE_ROOT, 'missing-engine/pdf-worker.mjs');
const sqliteWorker = path.join(dist, 'infrastructure/storage/sqlite/sqlite-coordination.worker.js');
const counters = { denied: 0, allowedConnections: 0, parserChildren: [], sqliteThreads: [] };
let threadFailure = false;
const deny = () => { counters.denied++; const error = new Error('LOCAL_MODEL_SMOKE_DENIED'); error.code = 'LOCAL_MODEL_SMOKE_DENIED'; throw error; };
const forbidden = /(?:^|[\/\\])(?:pg(?:[\/\\]|$)|@prisma[\/\\]|@google-cloud[\/\\])|(?:infrastructure[\/\\](?:prisma|postgres|vertex-ai))(?:[\/\\]|$)/u;
Module.registerHooks({ resolve(specifier, context, next) {
  if (forbidden.test(specifier)) deny();
  const resolved = next(specifier, context);
  if (forbidden.test(resolved.url)) deny();
  if (!resolved.url.startsWith('node:')) {
    if (!resolved.url.startsWith('file:')) deny();
    const file = fs.realpathSync(fileURLToPath(resolved.url));
    if (forbidden.test(file) || !(inside(file, dist) || inside(file, dependencyRoot) ||
        inside(file, path.join(ownedRoot, 'missing-engine')) || [__filename, path.join(__dirname, 'probe.cjs'), path.join(__dirname, 'thread-evidence.cjs')].includes(file))) deny();
  }
  return resolved;
} });
net.Server.prototype.listen = deny;
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const value = Array.isArray(args[0]) ? args[0][0] : args[0];
  if (parserOnly || threadOnly || !(this instanceof tls.TLSSocket) || !value || typeof value !== 'object' ||
      value.path != null || value.host !== '127.0.0.1' || Number(value.port) !== port || !Number.isInteger(port) || port < 1) deny();
  counters.allowedConnections++;
  return connect.apply(this, args);
};
for (const api of [dns, dnsPromises]) for (const name of Object.keys(api)) {
  if (/^(?:lookup|resolve|reverse)/u.test(name) && typeof api[name] === 'function') api[name] = deny;
}
for (const api of [dns.Resolver?.prototype, dnsPromises.Resolver?.prototype]) if (api) {
  for (const name of Object.getOwnPropertyNames(api)) if (/^(?:resolve|reverse)/u.test(name)) api[name] = deny;
}
dgram.createSocket = deny; http.request = deny; http.get = deny; http2.connect = deny;
globalThis.fetch = deny; globalThis.WebSocket = class { constructor() { deny(); } };
const spawn = cp.spawn;
cp.spawn = function (command, args, options) {
  if (parserOnly || threadOnly || command !== process.execPath || !Array.isArray(args) || args.length !== 4 ||
      args[0] !== '--no-global-search-paths' || args[1] !== '--max-old-space-size=256' || args[2] !== '--unhandled-rejections=strict' ||
      ![worker, missingWorker].includes(args[3]) || JSON.stringify(Object.keys(options ?? {}).sort()) !== '["cwd","env","stdio"]' || JSON.stringify(options?.stdio) !== '["pipe","pipe","pipe"]' ||
      JSON.stringify(Object.keys(options.env).sort()) !== '["LC_ALL","PATH","TMPDIR"]' || options.env.PATH !== '/usr/bin:/bin' ||
      options.env.LC_ALL !== 'C' || options.cwd !== options.env.TMPDIR) deny();
  const child = spawn(command, ['--require', __filename, ...args], { ...options, env: { ...options.env, LOCAL_MODEL_SMOKE_PARSER: '1', LOCAL_DATABASE_RUNTIME_DIST: dist,
    LOCAL_MODEL_SMOKE_DEPENDENCIES: dependencyRoot, LOCAL_MODEL_SMOKE_ROOT: ownedRoot,
    LOCAL_MODEL_SMOKE_PROVIDER_MODULE: process.env.LOCAL_MODEL_SMOKE_PROVIDER_MODULE } });
  const record = { pid: null, code: null, signal: null, closed: false };
  counters.parserChildren.push(record);
  child.once('spawn', () => { record.pid = child.pid; });
  child.once('close', (code, signal) => { record.code = code; record.signal = signal; record.closed = true; });
  return child;
};
for (const name of ['exec', 'execFile', 'execSync', 'execFileSync', 'fork', 'spawnSync']) cp[name] = deny;
const Worker = threads.Worker;
threads.Worker = class extends Worker {
  constructor(file, options) {
    const keys = (v) => v && typeof v === 'object' ? Object.keys(v).sort().join() : '';
    const paths = options?.workerData?.paths;
    if (parserOnly || threadOnly || file !== sqliteWorker || fs.realpathSync(file) !== file || counters.sqliteThreads.length >= 8 ||
        keys(options) !== 'env,execArgv,workerData' || keys(options.env) !== '' ||
        JSON.stringify(options.execArgv) !== '["--no-global-search-paths"]' || keys(options.workerData) !== 'paths' ||
        keys(paths) !== 'databaseRoot,expectedTarget,identityRoot' ||
        paths.databaseRoot !== path.join(ownedRoot, 'data') || paths.identityRoot !== path.join(ownedRoot, 'identity') ||
        typeof paths.expectedTarget !== 'string' || !paths.expectedTarget.length || paths.expectedTarget.length > 1024) deny();
    const cell = new Int32Array(new SharedArrayBuffer(4));
    super(file, { workerData: { paths: { ...paths }, __modelSmokeAcknowledgement: cell.buffer },
      execArgv: ['--no-global-search-paths', '--require', __filename], env: {
        LOCAL_DATABASE_RUNTIME_DIST: dist, LOCAL_MODEL_SMOKE_DEPENDENCIES: dependencyRoot,
        LOCAL_MODEL_SMOKE_ROOT: ownedRoot, LOCAL_MODEL_SMOKE_PROVIDER_MODULE: process.env.LOCAL_MODEL_SMOKE_PROVIDER_MODULE,
      } });
    const record = { threadId: this.threadId, controls: 0, code: null, exited: false };
    counters.sqliteThreads.push(record);
    this.once('error', () => { threadFailure = true; });
    this.once('exit', (code) => {
      try { Object.assign(record, threadResult(record.threadId, code, cell)); }
      catch { threadFailure = true; }
    });
  }
};
Module.syncBuiltinESMExports();
const threadsValid = () => !threadFailure && counters.sqliteThreads.every((v) => v.exited && v.code === 0 && v.controls === 42);
const exit = process.exit;
process.exit = (code) => exit(threadsValid() ? code : 1);
process.once('beforeExit', () => { if (!threadsValid()) process.exitCode = 1; });
Object.defineProperty(globalThis, '__localModelSmoke', { value: { counters, async controls() {
  let count = 0;
  for (const surface of [require, (name) => import(name)]) {
    const n = await surface('node:net'), t = await surface('node:tls'), d = await surface('node:dns'), u = await surface('node:dgram');
    const thread = await surface('node:worker_threads');
    const child = await surface('node:child_process'), web = await surface('node:http'), h2 = await surface('node:http2');
    const parserArgs = ['--no-global-search-paths', '--max-old-space-size=256', '--unhandled-rejections=strict', worker];
    const parserOptions = { cwd: ownedRoot, env: { PATH: '/usr/bin:/bin', TMPDIR: ownedRoot, LC_ALL: 'C' }, stdio: ['pipe', 'pipe', 'pipe'] };
    for (const operation of [
      () => n.connect({ host: '127.0.0.1', port }), () => t.connect({ host: 'localhost', port }),
      () => t.connect({ host: '127.0.0.1', port: port === 65535 ? 65534 : port + 1 }),
      () => t.connect({ host: '192.0.2.1', port }), () => n.connect({ path: '/tmp/forbidden.sock' }),
      () => n.createServer().listen(0), () => d.lookup('example.invalid', () => {}), () => u.createSocket('udp4'),
      () => surface('@google-cloud/vertexai'), () => surface('pg'),
      () => surface(process.env.LOCAL_MODEL_SMOKE_PROVIDER_MODULE), () => surface(path.join(ownedRoot, 'outside.cjs')),
      () => child.spawn(process.execPath, parserArgs, { ...parserOptions, detached: true }),
      () => child.spawn(process.execPath, parserArgs, { ...parserOptions, shell: true }),
      () => new thread.Worker('process.exit(0)', { eval: true }),
      () => new thread.Worker(path.join(ownedRoot, 'outside.cjs')),
      () => new thread.Worker(sqliteWorker, { env: {}, execArgv: ['--no-global-search-paths'], workerData: { paths: {} } }),
      () => new thread.Worker(sqliteWorker, { env: {}, execArgv: ['--no-global-search-paths'], workerData: { paths: {} }, eval: true }),
      () => web.request('http://127.0.0.1/'), () => h2.connect('http://127.0.0.1/'),
    ]) {
      try { await operation(); throw new Error('Control unexpectedly allowed'); }
      catch (error) { if (error.code !== 'LOCAL_MODEL_SMOKE_DENIED') throw error; count++; }
    }
  }
  for (const operation of [() => globalThis.fetch('https://example.invalid'), () => new globalThis.WebSocket('wss://example.invalid')]) {
    try { await operation(); throw new Error('Control unexpectedly allowed'); }
    catch (error) { if (error.code !== 'LOCAL_MODEL_SMOKE_DENIED') throw error; count++; }
  }
  if (count !== 42) throw new Error('Missing denial control');
  return count;
} } });
// The child must finish its own CJS and ESM denial controls before successful exit.
if (parserOnly || threadOnly) {
  let verified = false;
  globalThis.__localModelSmoke.controls().then((count) => { if (threadOnly) { if (!(acknowledgement instanceof SharedArrayBuffer) || acknowledgement.byteLength !== 4) throw new Error(); Atomics.store(new Int32Array(acknowledgement), 0, count); } verified = true; }, () => { process.exitCode = 1; process.stdin.destroy(); });
  process.once('beforeExit', () => { if (!verified) process.exitCode = 1; });
}
