import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, chmod, cp, readFile, writeFile, realpath, lstat, readdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { once } from 'node:events';
import { prepareDisposableWorkspace } from '../migration-gate.mjs';
import { runCommand, captureCallerIntegrity, assertCallerIntegrity } from '../gate-runner.mjs';
import { strictToolEnvironment, copyLocalUiDeployment } from '../packaging-smoke.mjs';
import { requestMcpSmoke } from '../local-mcp-smoke.mjs';
import { localUiBrowserPrerequisite } from '../local-ui-browser.mjs';
import { createGatedNodeChild, activateJournaledNodeChild, terminateAndReapJournaledNodeChild } from '../local-identity-smoke.mjs';
import { greekPdfFixture, standardFontPdfFixture } from '../../../apps/backend/test/local-model/fixtures/pdf-fixtures.mjs';

// P1 only. Fixed existing source/assets, private temporary roots, no downloads or live model.
assert.equal(process.platform, 'darwin');
assert.equal(process.version, 'v24.21.0');
const repository = path.resolve(import.meta.dirname, '../../..');
const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'context-router-install-bundle-')));
await chmod(root, 0o700);
console.log(`P1 bundle evidence root: ${root}`);
const signal = AbortSignal.timeout(600_000), started = Date.now();
const summary = { status: 'running', source: null, phases: [], limitations: [
  'P1 production-closure feasibility, not installed product or signing qualification.',
  'No live model; cached Node archive compared with official HTTPS checksum, PGP verification pending.',
] };
const sha = value => createHash('sha256').update(value).digest('hex');
const within = (parent, child) => child === parent || child.startsWith(parent + path.sep);
let workspace, ui, uiEnded, browser, browserContext, browserHandle, caller;
const canaries = [];
const milestone = label => { summary.phases.push({ label, elapsedMs: Date.now() - started }); console.log(`P1 bundle: ${label}`); };
const command = async (label, argv, env, cwd = root, timeoutMs = 20_000) => runCommand(argv,
  { cwd, env, signal, timeoutMs, logPath: path.join(root, label + '.log'), canaries });
async function bounded(promise, ms, label) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(label)), ms); })]); }
  finally { clearTimeout(timer); }
}
async function stopUi() {
  if (!ui) return;
  if (ui.exitCode === null && ui.signalCode === null) ui.kill('SIGTERM');
  try { await bounded(uiEnded, 5000, 'UI graceful cleanup deadline'); }
  catch { ui.kill('SIGKILL'); await bounded(uiEnded, 5000, 'UI exact exit unobserved'); }
}
try {
  caller = await captureCallerIntegrity([
    path.join(repository, 'node_modules'), path.join(repository, 'apps/backend/node_modules'),
    path.join(repository, 'apps/web/node_modules'), path.join(repository, 'apps/backend/dist'),
    path.join(repository, 'apps/web/.next'),
  ], { signal });
  workspace = await prepareDisposableWorkspace(root, signal, { onSourceCaptured(value) { summary.source = value; } });
  const home = path.join(root, 'home'), temporary = path.join(root, 'tmp');
  for (const p of [home, temporary]) await mkdir(p, { mode: 0o700 });
  const { default: yaml } = await import('yaml');
  const storeRoot = yaml.parse(await readFile(path.join(repository, 'node_modules/.modules.yaml'), 'utf8')).storeDir;
  assert.ok(path.isAbsolute(storeRoot));
  const tools = strictToolEnvironment(process.env, { home, corepackHome: workspace.corepackHome,
    storeRoot, proxyOrigin: 'http://127.0.0.1:1' });
  milestone('isolated-source-and-dependencies');
  for (const [label, args] of [
    ['prisma', ['--filter', 'backend', 'prisma:generate']],
    ['backend-build', ['--filter', 'backend', 'build']],
    ['web-build', ['--filter', 'web', 'build']],
  ]) await command(label, ['pnpm', ...args], tools, workspace.workspace, 120_000);
  const bundle = path.join(root, 'candidate'), payload = path.join(bundle, 'app');
  await mkdir(bundle, { mode: 0o700 });
  const deployment = path.join(root, 'deployment');
  await command('deploy', ['pnpm', '--offline', '--filter', 'web', 'deploy', '--prod', deployment], tools, workspace.workspace, 120_000);
  await copyLocalUiDeployment(deployment, payload);
  const nextRoot = path.join(workspace.workspace, 'apps/web/.next');
  await cp(nextRoot, path.join(payload, '.next'), { recursive: true, verbatimSymlinks: true,
    filter: p => !['cache', 'standalone'].includes(path.relative(nextRoot, p).split(path.sep)[0]) });
  const archive = path.join(os.homedir(), '.nvm/.cache/bin/node-v24.21.0-darwin-arm64/node-v24.21.0-darwin-arm64.tar.xz');
  const archiveBytes = await readFile(archive);
  assert.equal(sha(archiveBytes), '6239d4cf92d864487ec8cd3615038f7b67e7f58b77b21cd2f09ea9fbd68065fe');
  await command('extract-node', ['/usr/bin/tar', '-xJf', archive, '--strip-components', '1', '-C', bundle,
    'node-v24.21.0-darwin-arm64/bin/node', 'node-v24.21.0-darwin-arm64/LICENSE'], tools);
  const node = await realpath(path.join(bundle, 'bin/node'));
  assert.equal(sha(await readFile(node)), sha(await readFile(process.execPath)));
  summary.node = { archiveSha256: sha(archiveBytes), archiveBytes: archiveBytes.length,
    binarySha256: sha(await readFile(node)), binaryBytes: (await lstat(node)).size, licenseBytes: (await lstat(path.join(bundle, 'LICENSE'))).size };
  const requirePayload = createRequire(path.join(payload, 'local-ui.mjs'));
  const dist = await realpath(path.dirname(requirePayload.resolve('backend/dist/local-mcp.js')));
  for (const name of ['next', 'backend/dist/bootstrap/local-ui.js']) assert.ok(within(payload, await realpath(requirePayload.resolve(name))));
  let bytes = 0, files = 0;
  async function inventory(p) {
    for (const name of await readdir(p)) {
      const candidate = path.join(p, name), info = await lstat(candidate);
      if (info.isSymbolicLink()) assert.ok(within(bundle, await realpath(candidate)), 'payload symlink escaped');
      else if (info.isDirectory()) await inventory(candidate);
      else { assert.ok(info.isFile()); bytes += info.size; files++; }
    }
  }
  await inventory(bundle);
  summary.payload = { bytes, files };
  milestone('custom-server-and-node-staged');
  const runtime = path.join(root, 'runtime');
  for (const p of [runtime, ...['data', 'identity', 'exports', 'tmp', 'empty-path'].map(p => path.join(runtime, p))]) await mkdir(p, { mode: 0o700 });
  const env = { PATH: path.join(runtime, 'empty-path'), HOME: home, TMPDIR: path.join(runtime, 'tmp'), LC_ALL: 'C',
    NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1', DO_NOT_TRACK: '1',
    LOCAL_DATABASE_ROOT: path.join(runtime, 'data'), LOCAL_IDENTITY_STATE_ROOT: path.join(runtime, 'identity') };
  const profile = path.join(root, 'runtime.sb');
  // Actual OS denial, inherited by descendants. No source reads and only bundled Node may execute.
  const quote = JSON.stringify;
  await writeFile(profile, `(version 1)\n(allow default)\n` +
    [repository, await realpath(workspace.workspace), storeRoot].map(p => `(deny file-read* (subpath ${quote(p)}))\n`).join('') +
    `(deny process-exec)\n(allow process-exec (literal ${quote(node)}))\n` +
    `(deny network-outbound)\n(allow network-outbound (remote ip "localhost:*"))\n`, { mode: 0o600 });
  const launch = args => ['/usr/bin/sandbox-exec', '-f', profile, node, '--no-global-search-paths', ...args];
  const proof = path.join(bundle, 'isolation-proof.cjs');
  await writeFile(proof, `const a=require('node:assert/strict'),f=require('node:fs'),c=require('node:child_process');\n` +
    `a.throws(()=>f.readFileSync(${JSON.stringify(path.join(repository, 'README.md'))}));\n` +
    `a.throws(()=>f.readFileSync(${JSON.stringify(path.join(await realpath(workspace.workspace), 'README.md'))}));\n` +
    `a.ok(c.spawnSync('/usr/bin/true').error); a.equal(process.execPath,${JSON.stringify(node)});\n` +
    `console.log('source read and external executable denied; bundled Node confirmed');\n`, { mode: 0o600 });
  await command('isolation-control', launch([proof]), env, payload);
  await command('initialize', launch([path.join(dist, 'local-identity.js'), 'initialize']), env, payload);
  await command('upgrade', launch([path.join(dist, 'local-mcp.js'), 'upgrade']), env, payload);
  const tokenFile = path.join(runtime, 'exports', 'fixture.token');
  await command('provision', launch([path.join(dist, 'local-mcp.js'), 'provision', '--label', 'P1-fixture', '--out', tokenFile]), env, payload);
  const token = (await readFile(tokenFile, 'utf8')).trim(); canaries.push(token);
  await command('list', launch([path.join(dist, 'local-mcp.js'), 'list']), env, payload);
  const pdfFile = path.join(bundle, 'fixture.pdf'), unsupportedPdf = path.join(bundle, 'unembedded.pdf');
  const greek = await greekPdfFixture();
  await writeFile(pdfFile, greek.bytes, { mode: 0o600 });
  await writeFile(unsupportedPdf, await standardFontPdfFixture(), { mode: 0o600 });
  const pdfProof = path.join(bundle, 'pdf-proof.mjs');
  await writeFile(pdfProof, `import assert from 'node:assert/strict'; import {readFile} from 'node:fs/promises';\n` +
    `import {PdfProcess} from ${JSON.stringify(path.join(dist, 'infrastructure/local-model/engine/pdf-process.mjs'))};\n` +
    `const parser=new PdfProcess({workerPath:${JSON.stringify(path.join(dist, 'infrastructure/local-model/engine/pdf-worker.mjs'))}});\n` +
    `await assert.rejects(parser.parse(await readFile(${JSON.stringify(unsupportedPdf)})),{message:'PDF_AUXILIARY'});\n` +
    `const result=await parser.parse(await readFile(${JSON.stringify(pdfFile)})); assert.equal(result.text,${JSON.stringify(greek.expectedText)});\n` +
    `assert.equal(parser.state,'ready');console.log('bundled PDF child parsed and reaped');\n`, { mode: 0o600 });
  await command('pdf', launch([pdfProof]), env, payload);
  milestone('isolated-cli-sqlite-worker-pdf');
  const prerequisite = localUiBrowserPrerequisite(repository, process.env);
  const { chromium } = createRequire(path.join(repository, 'apps/web/package.json'))('playwright');
  const profileRoot = await realpath(await mkdtemp('/private/tmp/cr-p1-browser-'));
  await chmod(profileRoot, 0o700);
  browserHandle = createGatedNodeChild({
    entrypoint: path.join(repository, 'scripts/local-migration/fixtures/local-ui-smoke/browser.cjs'),
    operation: 'browser', cwd: root,
    env: { PATH: '/usr/bin:/bin', HOME: home, TMPDIR: temporary,
      LOCAL_UI_BROWSER_PROFILE: profileRoot, LOCAL_UI_BROWSER_EXECUTABLE: prerequisite.executable },
    signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
  });
  await activateJournaledNodeChild({ handle: browserHandle, resourceId: 'browser', identity: { profileRoot },
    journal: { acquired: async (id, record) => {
      summary.browserOwner = { id, ...record, profileRoot };
      await writeFile(path.join(root, 'browser-owner.json'), JSON.stringify(summary.browserOwner), { mode: 0o600 });
    } } });
  const browserDeadline = Date.now() + 10_000;
  while (!browserHandle.output().stdout.endsWith('\n')) {
    assert.ok(Date.now() < browserDeadline && !browserHandle.output().stderr && !browserHandle.output().overflow, 'browser startup failed');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  const browserReady = JSON.parse(browserHandle.output().stdout);
  assert.equal(browserReady.type, 'local-ui-browser-ready');
  browser = await chromium.connectOverCDP(browserReady.endpoint, { timeout: 5_000 });
  browserContext = await browser.newContext({ serviceWorkers: 'block' });
  ui = spawn('/usr/bin/sandbox-exec', launch([path.join(payload, 'local-ui.mjs'), 'serve', '--unlock-dir', path.join(runtime, 'exports'), '--port', '0', '--mcp-port', '0']).slice(1),
    { cwd: payload, env, stdio: ['pipe', 'pipe', 'pipe'] });
  uiEnded = once(ui, 'close');
  let output = '', errors = '';
  ui.stdout.on('data', data => { output += data; if (output.length > 64 * 1024) ui.kill('SIGTERM'); });
  ui.stderr.on('data', data => { errors += data; if (errors.length > 64 * 1024) ui.kill('SIGTERM'); });
  const lifetime = setTimeout(() => ui.kill('SIGTERM'), 20_000);
  try {
    const deadline = Date.now() + 10_000;
    while (!output.includes('\n')) { assert.ok(Date.now() < deadline && ui.exitCode === null && ui.signalCode === null, 'UI startup failed'); await new Promise(r => setTimeout(r, 20)); }
    const ready = output.split('\n').map(line => { try { return JSON.parse(line); } catch { return null; } }).find(r => r?.type === 'context-router.local-ui.ready');
    assert.ok(ready);
    const bootstrap = (await readFile(ready.unlockFile, 'utf8')).trim(); canaries.push(bootstrap);
    const outbound = [];
    await browserContext.route('**/*', route => {
      if (new URL(route.request().url()).origin !== ready.origin) { outbound.push(route.request().url()); return route.abort(); }
      return route.continue();
    });
    const page = await browserContext.newPage();
    page.setDefaultTimeout(5_000);
    assert.equal((await page.goto(ready.origin + '/dashboard/preferences')).status(), 200);
    await page.getByLabel('Unlock token').fill(bootstrap);
    await page.getByRole('button', { name: 'Unlock local dashboard' }).click();
    await page.getByRole('button', { name: 'Lock dashboard' }).waitFor();
    assert.deepEqual(outbound, []);
    await page.close();
    const mcp = await requestMcpSmoke(Number(new URL(ready.mcpOrigin).port), token,
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'P1', version: '1' } } });
    assert.equal(mcp.status, 200);
    assert.equal((await fetch(ready.origin + '/dashboard/preferences')).status, 200);
    summary.browserClose = 'page closed; same application and MCP remained reachable';
    for (const secret of canaries) { assert.equal(output.includes(secret), false); assert.equal(errors.includes(secret), false); }
    milestone('actual-browser-unlock-and-mcp-after-page-close');
  } finally {
    clearTimeout(lifetime);
    await stopUi();
    assert.ok(ui.exitCode !== null || ui.signalCode !== null, 'exact UI exit required');
  }
  await bounded(browserContext.close(), 5000, 'browser context close deadline'); browserContext = null;
  await bounded(browser.close(), 5000, 'browser disconnect deadline'); browser = null;
  const browserCleanup = await terminateAndReapJournaledNodeChild(browserHandle, 'P1 browser');
  assert.deepEqual(browserCleanup, []);
  browserHandle = null;
  summary.browserCleanup = 'exact owned wrapper/group reaped';
  await assertCallerIntegrity(caller, { signal });
  summary.callerIntegrity = true;
  summary.status = 'passed';
  milestone('owned-processes-stopped-and-caller-unchanged');
} catch (error) {
  summary.status = 'failed';
  summary.failure = { message: error.message, tail: error.outputTail };
  process.exitCode = 1;
} finally {
  const cleanup = [];
  for (const operation of [
    () => stopUi(),
    () => browserContext ? bounded(browserContext.close(), 5000, 'browser context cleanup deadline') : undefined,
    () => browser ? bounded(browser.close(), 5000, 'browser disconnect cleanup deadline') : undefined,
  ]) { try { await operation(); } catch (error) { cleanup.push(error.message); } }
  if (browserHandle) cleanup.push(...(await terminateAndReapJournaledNodeChild(browserHandle, 'P1 browser cleanup')).map(e => e.message));
  if (caller) {
    try { await assertCallerIntegrity(caller); summary.callerIntegrity = true; }
    catch (error) { cleanup.push(error.message); summary.callerIntegrity = false; }
  }
  summary.cleanupErrors = cleanup;
  if (cleanup.length) { summary.status = 'failed'; process.exitCode = 1; }
  summary.elapsedMs = Date.now() - started;
  summary.retained = { root, workspace: workspace?.workspace };
  let text = JSON.stringify(summary, null, 2);
  for (const secret of canaries) text = text.split(secret).join('[redacted]');
  await writeFile(path.join(root, 'summary.json'), text + '\n', { mode: 0o600 });
  console.log(`P1 bundle: ${summary.status}; summary retained privately`);
}
