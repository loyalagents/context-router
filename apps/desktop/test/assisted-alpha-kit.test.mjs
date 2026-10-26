import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, readFile, mkdir, rm, symlink, chmod, realpath, lstat, link, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { validateReceipt, copyVerified, releaseMetadata, assembleKit, repositoryGit } from '../../../scripts/local-migration/installation/assisted-alpha-kit.mjs';
import { MODEL } from '../runtime/model-assets.mjs';
import { downloadAsset } from '../runtime/download-engine.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const source = 'a'.repeat(40);
const receipt = () => ({
  version: 1, status: 'packaged', distribution: 'local-candidate', callerIntegrity: true,
  source: { headSha: source, dirty: false, copiedInputsSha256: 'b'.repeat(64) },
  archive: { path: '/private/build/Context Router.local-candidate.zip', bytes: 100, sha256: 'c'.repeat(64) },
  bundle: { path: '/private/build/Context Router.app', bytes: 200, manifestSha256: 'd'.repeat(64),
    sealedPayload: { path: '/private/build/sealed-payload.json', sha256: 'e'.repeat(64) } },
  buildWorkspace: '/private/operator/workspace', privateCanary: 'never-share-this',
});

test('kit refuses dirty, mismatched, failed or incomplete package evidence', () => {
  assert.doesNotThrow(() => validateReceipt(receipt(), source));
  for (const alter of [
    r => { r.source.headSha = 'f'.repeat(40); },
    r => { r.source.dirty = true; },
    r => { r.status = 'failed'; },
    r => { r.callerIntegrity = false; },
    r => { delete r.bundle.sealedPayload; },
    r => { r.archive.sha256 = 'wrong'; },
    r => { r.source.copiedInputsSha256 = null; },
    r => { r.archive.bytes = -1; },
  ]) {
    const value = receipt(); alter(value);
    assert.throws(() => validateReceipt(value, source));
  }
});

test('shareable release metadata uses an allowlist and makes no qualification claim', () => {
  const result = releaseMetadata(receipt(), '1'.repeat(64));
  const text = JSON.stringify(result);
  assert.equal(text.includes('/private/'), false);
  assert.equal(text.includes('never-share-this'), false);
  assert.equal(result.source.headSha, source);
  assert.equal(result.buildReceiptSha256, '1'.repeat(64));
  assert.equal(result.acceptance.status, 'human acceptance pending');
  assert.equal(result.acceptance.checklist, 'OPERATOR.md#acceptance-record');
  assert.ok(result.acceptance.remaining.some(item => item.includes('quarantined standalone Node')));
  assert.equal(result.model.downloadMinimumFreeBytes, 5680522464 + 1024 ** 3);
  assert.equal(result.resetRelease, false);
  assert.equal(result.node.version, '24.21.0');
});

async function fixture(t) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'alpha-kit-test-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const input = path.join(root, 'input');
  await writeFile(input, 'synthetic-public-artifact', { mode: 0o600 });
  return { root, input, output: path.join(root, 'copy'), expected: sha('synthetic-public-artifact') };
}
test('advertised model size and free-space floor match the actual downloader boundary', async t => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'alpha-download-floor-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const model = releaseMetadata(receipt(), '1'.repeat(64)).model;
  assert.equal(model.bytes, MODEL.bytes);
  const floor = BigInt(model.downloadMinimumFreeBytes), reachedTransport = new Error('injected transport boundary');
  let requests = 0;
  const run = available => downloadAsset({ root, generation: 'a'.repeat(32), asset: MODEL,
    availableBytes: async () => available,
    openResponse: async () => { requests++; throw reachedTransport; },
  });
  await assert.rejects(run(floor - 1n), /Model download unavailable/);
  assert.equal(requests, 0);
  assert.deepEqual(await readdir(root), []);
  await assert.rejects(run(floor), error => error === reachedTransport);
  assert.equal(requests, 1);
  assert.deepEqual(await readdir(root), []);
});
test('repository Git ignores inherited routing, index and config overrides', async t => {
  const f = await fixture(t), intended = path.join(f.root, 'intended'), foreign = path.join(f.root, 'foreign');
  for (const directory of [intended, foreign]) {
    await mkdir(directory); repositoryGit(directory)(['init', '--quiet']);
  }
  await writeFile(path.join(intended, 'intended-only'), 'synthetic');
  await writeFile(path.join(foreign, 'foreign-only'), 'synthetic');
  const invalidIndex = path.join(f.root, 'invalid-index'); await writeFile(invalidIndex, 'not a Git index');
  for (const overrides of [
    { GIT_DIR: path.join(foreign, '.git') },
    { GIT_DIR: path.join(foreign, '.git'), GIT_WORK_TREE: foreign },
    { GIT_INDEX_FILE: invalidIndex },
    { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.bare', GIT_CONFIG_VALUE_0: 'true' },
  ]) {
    const environment = { ...process.env, ...overrides };
    const git = repositoryGit(intended, environment);
    assert.equal(git(['rev-parse', '--show-toplevel']).toString().trim(), intended);
    assert.equal(git(['rev-parse', '--absolute-git-dir']).toString().trim(), path.join(intended, '.git'));
    assert.equal(git(['status', '--porcelain=v1']).toString(), '?? intended-only\n');
    for (const [name, value] of Object.entries(overrides)) assert.equal(environment[name], value);
  }
});
test('verified copies retain exact bytes, become read-only, and never replace destinations', async t => {
  const f = await fixture(t);
  await copyVerified(f.input, f.output, f.expected);
  assert.equal(await readFile(f.output, 'utf8'), 'synthetic-public-artifact');
  assert.equal((await lstat(f.output)).mode & 0o777, 0o400);
  await assert.rejects(copyVerified(f.input, f.output, f.expected));
  assert.equal(await readFile(f.output, 'utf8'), 'synthetic-public-artifact');
});
test('tampered input never becomes a verified output', async t => {
  const f = await fixture(t);
  await writeFile(f.input, 'tampered');
  await assert.rejects(copyVerified(f.input, f.output, f.expected));
  await assert.rejects(readFile(f.output), { code: 'ENOENT' });
});
test('input aliases, writable files and non-files are refused', async t => {
  const f = await fixture(t);
  await symlink(f.input, path.join(f.root, 'alias'));
  await assert.rejects(copyVerified(path.join(f.root, 'alias'), f.output, f.expected));
  await chmod(f.input, 0o666);
  await assert.rejects(copyVerified(f.input, f.output, f.expected));
  await mkdir(path.join(f.root, 'directory'));
  await assert.rejects(copyVerified(path.join(f.root, 'directory'), f.output, f.expected));
});
test('multiply linked inputs are refused', async t => {
  const f = await fixture(t);
  await link(f.input, path.join(f.root, 'hardlink'));
  await assert.rejects(copyVerified(f.input, f.output, f.expected));
});

const modules = ['bridge.mjs', 'cli.mjs', 'credential.mjs'];
const operator = 'scripts/local-migration/installation/ASSISTED_ALPHA_OPERATOR.md';
const publicFiles = ['Context Router.local-candidate.zip', 'OPERATOR.md', 'SHA256SUMS',
  ...modules.map(name => `bridge/${name}`), 'node-v24.21.0-darwin-arm64.tar.xz', 'release.json', 'sealed-payload.json'].sort();
async function filesUnder(root, prefix = '') {
  const files = [];
  for (const entry of await readdir(path.join(root, prefix), { withFileTypes: true })) {
    const name = path.join(prefix, entry.name);
    if (entry.isDirectory()) files.push(...await filesUnder(root, name)); else files.push(name);
  }
  return files.sort();
}
async function assemblyFixture(t) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'alpha-assembly-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repository = path.join(root, 'repository'), packageRoot = path.join(root, 'package');
  await mkdir(repository); await mkdir(packageRoot);
  await mkdir(path.join(packageRoot, 'Context Router.app'));
  const committed = new Map();
  for (const name of [...modules.map(name => `apps/backend/scripts/mcp-bridge/${name}`), operator]) {
    const bytes = Buffer.from(`committed public ${name}\n`); committed.set(name, bytes);
    await mkdir(path.dirname(path.join(repository, name)), { recursive: true });
    await writeFile(path.join(repository, name), bytes, { mode: 0o600 });
  }
  const r = receipt(); r.archive.sha256 = sha('synthetic app archive'); r.archive.bytes = 21;
  r.bundle.sealedPayload.sha256 = sha('synthetic byte receipt');
  await writeFile(path.join(packageRoot, 'Context Router.local-candidate.zip'), 'synthetic app archive', { mode: 0o600 });
  await writeFile(path.join(packageRoot, 'sealed-payload.json'), 'synthetic byte receipt', { mode: 0o600 });
  await writeFile(path.join(packageRoot, 'private-build.log'), 'never-share-log', { mode: 0o600 });
  const node = path.join(root, 'node.tar.xz'); await writeFile(node, 'synthetic node', { mode: 0o600 });
  const options = { 'package-dir': packageRoot, 'node-archive': node, out: path.join(root, 'output') };
  const rewriteReceipt = async () => {
    const bytes = JSON.stringify(r); await writeFile(path.join(packageRoot, 'build-receipt.json'), bytes, { mode: 0o600 });
    options['build-receipt-sha256'] = sha(bytes);
  };
  await rewriteReceipt();
  const state = { dirty: false, head: source, top: repository, artifacts: [], commands: [], committed };
  const dependencies = {
    repository, nodeArchiveSha256: sha('synthetic node'),
    git: args => {
      if (args[0] === 'status') return state.dirty ? ' M changed\n' : '';
      if (args[0] === 'rev-parse') return (args[1] === '--show-toplevel' ? state.top : state.head) + '\n';
      assert.equal(args[0], 'show'); assert.ok(args[1].startsWith(source + ':'));
      const bytes = committed.get(args[1].slice(source.length + 1)); assert.ok(bytes); return bytes;
    },
    verifyArtifact: async (bundle, pins) => { state.artifacts.push({ bundle, pins }); return { source: r.source.copiedInputsSha256 }; },
    command: async (exe, args) => {
      state.commands.push({ exe, args }); assert.equal(exe, '/usr/bin/ditto');
      if (args[0] === '-x') await mkdir(path.join(args.at(-1), 'Context Router.app'));
      else { assert.equal(args[0], '-c'); await writeFile(args.at(-1), 'synthetic kit zip', { mode: 0o600 }); }
    },
  };
  return { root, repository, packageRoot, r, options, dependencies, state, rewriteReceipt };
}

test('complete assembly publishes only the public allowlist, bound checksums and successful handoff', async t => {
  const f = await assemblyFixture(t), handoff = await assembleKit(f.options, f.dependencies);
  const kit = path.join(f.options.out, handoff.kitId), metadata = JSON.parse(await readFile(path.join(kit, 'release.json')));
  assert.deepEqual(await filesUnder(kit), publicFiles);
  const sums = (await readFile(path.join(kit, 'SHA256SUMS'), 'utf8')).trim().split('\n');
  assert.deepEqual(sums.map(line => line.slice(66)).sort(), publicFiles.filter(name => name !== 'SHA256SUMS'));
  for (const name of publicFiles) {
    const bytes = await readFile(path.join(kit, name));
    assert.equal((await lstat(path.join(kit, name))).mode & 0o777, 0o400);
    assert.equal(bytes.includes('never-share-'), false);
    if (name !== 'SHA256SUMS') assert.ok(sums.includes(`${sha(bytes)}  ${name}`));
  }
  assert.equal(metadata.node.sha256, f.dependencies.nodeArchiveSha256);
  assert.equal(metadata.bridge.source, source);
  assert.equal(handoff.releaseMetadataSha256, sha(await readFile(path.join(kit, 'release.json'))));
  assert.equal(handoff.sha256, sha(await readFile(handoff.archive)));
  assert.deepEqual(JSON.parse(await readFile(path.join(f.options.out, 'handoff.json'))), handoff);
  assert.equal(f.state.artifacts.length, 2);
  assert.equal(f.state.artifacts[0].bundle, path.join(f.packageRoot, 'Context Router.app'));
  assert.equal(f.state.artifacts[1].bundle, path.join(f.options.out, 'verification/Context Router.app'));
  assert.equal(f.state.artifacts[0].pins.sealedPayload, path.join(f.packageRoot, 'sealed-payload.json'));
  assert.equal(f.state.artifacts[1].pins.sealedPayload, path.join(kit, 'sealed-payload.json'));
  for (const { pins } of f.state.artifacts) assert.equal(pins.sealedPayloadSha256, f.r.bundle.sealedPayload.sha256);
  assert.deepEqual(f.state.commands.map(c => c.args[0]), ['-x', '-c']);
});

test('complete assembly refuses mismatches and hidden working-tree substitutions without a handoff', async t => {
  const cases = [
    ['receipt digest', async f => { f.options['build-receipt-sha256'] = '0'.repeat(64); }],
    ['source HEAD', async f => { f.state.head = 'f'.repeat(40); }],
    ['source worktree', async f => { f.state.top = f.root; }],
    ['dirty source', async f => { f.state.dirty = true; }],
    ['dirty build', async f => { f.r.source.dirty = true; await f.rewriteReceipt(); }],
    ['copied inputs', async f => { f.dependencies.verifyArtifact = async () => ({ source: 'f'.repeat(64) }); }],
    ['Node archive', async f => { await writeFile(f.options['node-archive'], 'changed node'); }],
    ['app archive', async f => { await writeFile(path.join(f.packageRoot, 'Context Router.local-candidate.zip'), 'changed archive'); }],
    ...[operator, 'apps/backend/scripts/mcp-bridge/cli.mjs'].map(name =>
      [`clean status with modified ${name}`, async f => { await writeFile(path.join(f.repository, name), 'hidden local edit'); }]),
  ];
  for (const [name, corrupt] of cases) await t.test(name, async t => {
    const f = await assemblyFixture(t); await corrupt(f);
    await assert.rejects(assembleKit(f.options, f.dependencies));
    await assert.rejects(readFile(path.join(f.options.out, 'handoff.json')), { code: 'ENOENT' });
  });
});

test('complete assembly refuses existing destinations and retains their contents', async t => {
  const f = await assemblyFixture(t); await mkdir(f.options.out);
  await writeFile(path.join(f.options.out, 'keep'), 'existing');
  await assert.rejects(assembleKit(f.options, f.dependencies), { code: 'EEXIST' });
  assert.deepEqual(await readdir(f.options.out), ['keep']);
  assert.equal(await readFile(path.join(f.options.out, 'keep'), 'utf8'), 'existing');
});

test('extraction, final-source and archive failures never issue a successful handoff', async t => {
  for (const kind of ['extra extracted file', 'extracted verification', 'final HEAD', 'final worktree', 'final dirty', 'final blob', 'archive']) await t.test(kind, async t => {
    const f = await assemblyFixture(t), command = f.dependencies.command, verify = f.dependencies.verifyArtifact;
    f.dependencies.command = async (exe, args) => {
      if (kind === 'archive' && args[0] === '-c') throw Error('archive failed');
      await command(exe, args);
      if (kind === 'extra extracted file' && args[0] === '-x') await writeFile(path.join(args.at(-1), 'unexpected'), 'extra');
    };
    f.dependencies.verifyArtifact = async (...args) => {
      const result = await verify(...args);
      if (f.state.artifacts.length === 2) {
        if (kind === 'extracted verification') throw Error('extracted bytes differ');
        if (kind === 'final HEAD') f.state.head = 'f'.repeat(40);
        if (kind === 'final worktree') f.state.top = f.root;
        if (kind === 'final dirty') f.state.dirty = true;
        if (kind === 'final blob') await writeFile(path.join(f.repository, operator), 'hidden edit during assembly');
      }
      return result;
    };
    await assert.rejects(assembleKit(f.options, f.dependencies));
    await assert.rejects(readFile(path.join(f.options.out, 'handoff.json')), { code: 'ENOENT' });
  });
});
