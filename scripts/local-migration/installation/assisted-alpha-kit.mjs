// Operator-only assembly of existing package outputs. Never installs or configures a client.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { constants, createReadStream } from 'node:fs';
import { chmod, copyFile, lstat, mkdir, readFile, realpath, readdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { verifyPinnedArtifact } from './artifact-preflight.mjs';

const NODE_ARCHIVE = 'node-v24.21.0-darwin-arm64.tar.xz';
const NODE_SHA = '6239d4cf92d864487ec8cd3615038f7b67e7f58b77b21cd2f09ea9fbd68065fe';
const NODE_BINARY_SHA = 'e4b5a3af0e05c75de2eae013904145f40fe7fc2a6e6f17510128bf45cca4e79b';
const APP_ARCHIVE = 'Context Router.local-candidate.zip';
const MODULES = ['bridge.mjs', 'cli.mjs', 'credential.mjs'];
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

export function validateReceipt(r, head) {
  assert.ok(/^[a-f0-9]{40}$/.test(head));
  assert.equal(r.version, 1);
  assert.equal(r.status, 'packaged');
  assert.equal(r.distribution, 'local-candidate');
  assert.equal(r.callerIntegrity, true);
  assert.equal(r.source?.headSha, head, 'Build source differs; do not relabel an older artifact');
  assert.equal(r.source.dirty, false, 'Kit requires a clean source build');
  for (const value of [r.source.copiedInputsSha256, r.archive?.sha256,
    r.bundle?.manifestSha256, r.bundle?.sealedPayload?.sha256]) assert.ok(digest(value));
  for (const value of [r.archive.bytes, r.bundle.bytes]) assert.ok(Number.isSafeInteger(value) && value > 0);
}

export function releaseMetadata(r, receiptSha256) {
  // Never spread the private build receipt: it contains local paths and may gain fields.
  return {
    version: 1, kitId: `Context-Router-alpha-${r.source.headSha.slice(0, 12)}`,
    source: { headSha: r.source.headSha, dirty: false, copiedInputsSha256: r.source.copiedInputsSha256 },
    buildReceiptSha256: receiptSha256,
    app: { archive: APP_ARCHIVE, bytes: r.archive.bytes, sha256: r.archive.sha256,
      payloadBytes: r.bundle.bytes, manifestSha256: r.bundle.manifestSha256,
      sealedPayloadSha256: r.bundle.sealedPayload.sha256 },
    node: { version: '24.21.0', archive: NODE_ARCHIVE, sha256: NODE_SHA, binarySha256: NODE_BINARY_SHA },
    platform: 'darwin-arm64; minimum declared macOS 15.1.1; other Macs require compatibility acceptance',
    model: { bundled: false, bytes: 5680522464, downloadMinimumFreeBytes: 5680522464 + 1024 ** 3,
      downloadRecommendedFreeBytes: 6800000000 },
    resetRelease: false,
    acceptance: {
      status: 'human acceptance pending', checklist: 'OPERATOR.md#acceptance-record',
      verifiedByAssembly: ['clean-source build-receipt binding', 'app and extracted ZIP byte verification',
        'pinned Node archive and committed bridge/operator bytes'],
      remaining: ['Record exact-candidate CI and installed/replacement/demo/support evidence separately.',
        'Downloaded Finder/Gatekeeper launch, translocation observations, AppKit Ready and approved CLI execution.',
        'Approved model acquisition/use, live document review/save and real-weight replacement retention.',
        'Personal Claude setup including quarantined standalone Node, permitted/denied reads and idle/restart behavior.',
        'Native demo setup human acceptance, fresh-Mac compatibility and owner approval to distribute.'],
    },
    distribution: 'private ad-hoc sealed candidate; no Developer ID, notarization or publisher authentication',
  };
}

async function fileHash(file) {
  assert.equal(await realpath(file), file, 'Use canonical paths without aliases');
  const before = await lstat(file);
  assert.ok(before.isFile() && before.nlink === 1 && !(before.mode & 0o022), 'Unsafe input file');
  assert.ok(before.uid === process.getuid() || before.uid === 0, 'Untrusted input owner');
  const value = createHash('sha256');
  for await (const chunk of createReadStream(file, { flags: constants.O_RDONLY | constants.O_NOFOLLOW })) value.update(chunk);
  const after = await lstat(file);
  for (const key of ['dev', 'ino', 'size', 'mode', 'uid', 'nlink', 'mtimeMs', 'ctimeMs']) assert.equal(after[key], before[key]);
  return value.digest('hex');
}

export async function copyVerified(from, to, expected) {
  assert.ok(digest(expected));
  assert.equal(await fileHash(from), expected, 'Input checksum differs');
  await copyFile(from, to, constants.COPYFILE_EXCL);
  await chmod(to, 0o400);
  assert.equal(await fileHash(to), expected, 'Copied checksum differs');
}

async function cleanHead(git) {
  assert.equal((await git(['status', '--porcelain=v1', '--untracked-files=all'])).toString(), '', 'Commit the candidate before assembly');
  return (await git(['rev-parse', 'HEAD'])).toString().trim();
}

// Only tests inject external effects/pins; the executable below uses these fixed defaults.
export async function assembleKit(values, {
  repository = path.resolve(import.meta.dirname, '../../..'),
  git = args => execFileSync('git', args, { cwd: repository, timeout: 30000 }),
  verifyArtifact = verifyPinnedArtifact,
  command = (executable, args) => execFileSync(executable, args, {
    cwd: values.out, env: { PATH: '/usr/bin:/bin', LC_ALL: 'C' }, timeout: 120000, stdio: 'pipe',
  }),
  nodeArchiveSha256 = NODE_SHA,
} = {}) {
  assert.ok(digest(nodeArchiveSha256));
  assert.ok(digest(values['build-receipt-sha256']), 'Supply the independently retained build receipt digest');
  for (const key of ['package-dir', 'node-archive', 'out']) {
    const value = values[key];
    assert.ok(typeof value === 'string' && path.isAbsolute(value) && path.resolve(value) === value && !/[\x00-\x1f\x7f]/u.test(value));
    assert.equal(await realpath(path.dirname(value)), path.dirname(value));
  }
  const head = await cleanHead(git), packageRoot = values['package-dir'];
  const receiptPath = path.join(packageRoot, 'build-receipt.json');
  assert.equal(await fileHash(receiptPath), values['build-receipt-sha256']);
  const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
  validateReceipt(receipt, head);
  const pins = { manifestSha256: receipt.bundle.manifestSha256,
    sealedPayload: path.join(packageRoot, 'sealed-payload.json'),
    sealedPayloadSha256: receipt.bundle.sealedPayload.sha256 };
  const manifest = await verifyArtifact(path.join(packageRoot, 'Context Router.app'), pins);
  assert.equal(manifest.source, receipt.source.copiedInputsSha256);
  assert.equal(await fileHash(path.join(packageRoot, APP_ARCHIVE)), receipt.archive.sha256);
  assert.equal(await fileHash(values['node-archive']), nodeArchiveSha256);
  const sourceFiles = [...MODULES.map(name => `apps/backend/scripts/mcp-bridge/${name}`),
    'scripts/local-migration/installation/ASSISTED_ALPHA_OPERATOR.md'];
  const committed = new Map(await Promise.all(sourceFiles.map(async name =>
    [name, hash(await git(['show', `${head}:${name}`]))])));

  // Exclusive output, fixed file allowlist, and no cleanup/reuse after an interrupted run.
  const root = values.out;
  await mkdir(root, { mode: 0o700 });
  const metadata = releaseMetadata(receipt, values['build-receipt-sha256']);
  metadata.node.sha256 = nodeArchiveSha256;
  const kit = path.join(root, metadata.kitId), verify = path.join(root, 'verification');
  await mkdir(kit, { mode: 0o700 });
  await mkdir(verify, { mode: 0o700 });
  await mkdir(path.join(kit, 'bridge'), { mode: 0o700 });
  await copyVerified(path.join(packageRoot, APP_ARCHIVE), path.join(kit, APP_ARCHIVE), receipt.archive.sha256);
  await copyVerified(pins.sealedPayload, path.join(kit, 'sealed-payload.json'), pins.sealedPayloadSha256);
  await copyVerified(values['node-archive'], path.join(kit, NODE_ARCHIVE), nodeArchiveSha256);
  const files = [APP_ARCHIVE, 'sealed-payload.json', NODE_ARCHIVE];
  for (const name of MODULES) {
    const source = path.join(repository, 'apps/backend/scripts/mcp-bridge', name);
    await copyVerified(source, path.join(kit, 'bridge', name), committed.get(`apps/backend/scripts/mcp-bridge/${name}`));
    files.push(`bridge/${name}`);
  }
  const instructions = path.join(repository, sourceFiles.at(-1));
  await copyVerified(instructions, path.join(kit, 'OPERATOR.md'), committed.get(sourceFiles.at(-1)));
  files.push('OPERATOR.md');

  await command('/usr/bin/ditto', ['-x', '-k', path.join(kit, APP_ARCHIVE), verify]);
  assert.deepEqual(await readdir(verify), ['Context Router.app']);
  await verifyArtifact(path.join(verify, 'Context Router.app'), {
    ...pins, sealedPayload: path.join(kit, 'sealed-payload.json'),
  });
  metadata.bridge = { source: head, files: Object.fromEntries(await Promise.all(MODULES.map(async name =>
    [name, await fileHash(path.join(kit, 'bridge', name))]))) };
  await writeFile(path.join(kit, 'release.json'), JSON.stringify(metadata, null, 2) + '\n', { flag: 'wx', mode: 0o400 });
  files.push('release.json');
  const sums = await Promise.all(files.sort().map(async name => `${await fileHash(path.join(kit, name))}  ${name}\n`));
  await writeFile(path.join(kit, 'SHA256SUMS'), sums.join(''), { flag: 'wx', mode: 0o400 });
  assert.equal(await cleanHead(git), head, 'Source changed during assembly');
  for (const [name, expected] of committed) assert.equal(await fileHash(path.join(repository, name)), expected,
    'Committed support source changed during assembly');
  const archive = path.join(root, `${metadata.kitId}.zip`);
  await command('/usr/bin/ditto', ['-c', '-k', '--keepParent', kit, archive]);
  const handoff = { version: 1, kitId: metadata.kitId, source: metadata.source,
    archive, bytes: (await lstat(archive)).size, sha256: await fileHash(archive),
    releaseMetadataSha256: await fileHash(path.join(kit, 'release.json')),
    acceptance: metadata.acceptance };
  await writeFile(path.join(root, 'handoff.json'), JSON.stringify(handoff, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return handoff;
}

async function main() {
  const { values } = parseArgs({ strict: true, options: {
    'package-dir': { type: 'string' }, 'build-receipt-sha256': { type: 'string' },
    'node-archive': { type: 'string' }, out: { type: 'string' },
  } });
  assert.equal(process.platform, 'darwin');
  assert.equal(process.arch, 'arm64');
  assert.equal(process.version, 'v24.21.0');
  assert.ok(!['NODE_OPTIONS', 'NODE_DEBUG', 'NODE_DEBUG_NATIVE'].some(name => process.env[name]));
  console.log(JSON.stringify(await assembleKit(values), null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(`Alpha kit failed; retain output for diagnosis: ${error.message}`); process.exitCode = 1; });
}
