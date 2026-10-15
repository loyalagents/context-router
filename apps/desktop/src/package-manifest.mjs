import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, readdir, readlink, realpath } from 'node:fs/promises';
import path from 'node:path';
import {MODEL} from '../runtime/model-assets.mjs';

export const MANIFEST_PATH = 'Contents/Resources/package-manifest.json';
const signaturePaths = new Map([['Contents/MacOS/context-router', true], ['Contents/_CodeSignature/CodeResources', false]]);
const reject = () => { throw new Error('Package verification failed'); };
const exact = (v, keys) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const modelMetadata={name:MODEL.name,bytes:MODEL.bytes,sha256:MODEL.sha256,url:MODEL.url,runtime:'b11146',runtimeArchiveSha256:'1ad3f9eff80edb9dbef4259ad564d1720612ef7eea48fa4afed0e54f5f3d5711',contextTokens:16384,slots:1};
const relative = value => typeof value === 'string' && value.length <= 4096 && value.startsWith('Contents/') && !value.includes('\\') && !/[\x00-\x1f\x7f]/u.test(value) &&
  value.split('/').every(part => part && part !== '.' && part !== '..') && value !== MANIFEST_PATH;
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const same = (a, b) => a.uid === b.uid && a.dev === b.dev && a.ino === b.ino && a.mode === b.mode && a.nlink === b.nlink && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;

const readFlags = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;
async function readStable(file, before, consume) {
  const fd = await open(file, readFlags);
  try {
    if (!same(before, await fd.stat())) reject();
    const block = Buffer.alloc(256 * 1024);
    let position = 0;
    while (position < before.size) {
      const { bytesRead } = await fd.read(block, 0, Math.min(block.length, before.size - position), position);
      if (!bytesRead) reject();
      consume(block.subarray(0, bytesRead), position); position += bytesRead;
    }
    if (!same(before, await fd.stat()) || !same(before, await lstat(file))) reject();
  } finally { await fd.close(); }
}
async function hashStable(file, before) {
  const hash = createHash('sha256');
  await readStable(file, before, bytes => hash.update(bytes));
  return hash.digest('hex');
}

/** Build-time completeness inventory; this does not authenticate a publisher. */
async function collectPayload(root, { forSigning = false } = {}) {
  root = await realpath(root);
  const files = [], snapshots = new Map();
  let total = 0;
  async function visit(name) {
    const file = path.join(root, name), before = await lstat(file);
    if (name === MANIFEST_PATH) return;
    snapshots.set(file, before);
    if (name.startsWith('Contents/_CodeSignature/') && name !== 'Contents/_CodeSignature/CodeResources') reject();
    if (signaturePaths.has(name) && (!before.isFile() || before.size < 1 || (name.endsWith('/CodeResources') && before.size > 32 * 1024 ** 2) || !!(before.mode & 0o111) !== signaturePaths.get(name))) reject();
    if (before.isSymbolicLink()) {
      const target = await readlink(file), resolved = await realpath(file);
      if (!relative(name) || !target || target.length > 4096 || path.isAbsolute(target) || !resolved.startsWith(root + path.sep) || !same(before, await lstat(file))) reject();
      files.push({ path: name, kind: 'symlink', target });
    } else if (before.isDirectory()) {
      if (before.mode & 0o022) reject();
      for (const child of (await readdir(file)).sort(compare)) await visit(name ? `${name}/${child}` : child);
      if (!same(before, await lstat(file))) reject();
    } else if (before.isFile()) {
      if (!relative(name) || before.nlink !== 1 || (before.mode & 0o022) || !Number.isSafeInteger(before.size) || before.size < 0) reject();
      total += before.size;
      if (total > 2 * 1024 ** 3) reject();
      if (signaturePaths.has(name)) {
        files.push({ path: name, kind: 'signature', executable: signaturePaths.get(name) });
        return;
      }
      files.push({ path: name, kind: 'file', size: before.size, sha256: await hashStable(file, before), executable: !!(before.mode & 0o111) });
    } else reject();
    if (files.length > 100_000) reject();
  }
  await visit('');
  for (const [name, executable] of signaturePaths) {
    if (!files.some(entry => entry.path === name)) {
      if (!forSigning || executable) reject();
      files.push({ path: name, kind: 'signature', executable });
    }
  }
  return { files: files.sort((a, b) => compare(a.path, b.path)), snapshots };
}
export async function inventoryPayload(root, options) {
  return (await collectPayload(root, options)).files;
}
export function createPackageManifest({ source, files }) {
  const manifest = { version: 2, distribution: 'local-candidate', platform: 'darwin', arch: 'arm64', securityEpoch: 2,
    node: '24.21.0', sqliteVersions: [1, 2], identityVersion: 1, model:{...modelMetadata},source, files };
  validatePackageManifest(manifest);
  return manifest;
}
export function validatePackageManifest(m) { return validateForEpoch(m,2); }
function validateForEpoch(m,epoch) {
  if (!exact(m, ['version', 'distribution', 'platform', 'arch', 'securityEpoch', 'node', 'sqliteVersions', 'identityVersion','model', 'source', 'files']) ||
    m.version !== 2 || m.distribution !== 'local-candidate' || m.platform !== 'darwin' || m.arch !== 'arm64' || m.securityEpoch !== epoch ||
    m.node !== '24.21.0' || JSON.stringify(m.sqliteVersions) !== '[1,2]' || m.identityVersion !== 1 || !hex(m.source) ||
    !Array.isArray(m.files) || !m.files.length || m.files.length > 100_000 || !exact(m.model,Object.keys(modelMetadata)) || Object.entries(modelMetadata).some(([key,value])=>m.model[key]!==value)) reject();
  let previous = '', total = 0;
  for (const file of m.files) {
    if (!relative(file?.path) || compare(previous, file.path) >= 0) reject();
    previous = file.path;
    if (signaturePaths.has(file.path)) {
      if (!exact(file, ['path', 'kind', 'executable']) || file.kind !== 'signature' || file.executable !== signaturePaths.get(file.path)) reject();
    } else if (file.path.startsWith('Contents/_CodeSignature/')) reject();
    else if (file.kind === 'file') {
      if (!exact(file, ['path', 'kind', 'size', 'sha256', 'executable']) || !Number.isSafeInteger(file.size) || file.size < 0 ||
        !hex(file.sha256) || typeof file.executable !== 'boolean') reject();
      total += file.size;
    } else if (file.kind === 'symlink') {
      if (!exact(file, ['path', 'kind', 'target']) || typeof file.target !== 'string' || !file.target || file.target.length > 4096 ||
        path.isAbsolute(file.target) || file.target.includes('\0') || file.target.includes('\\')) reject();
    } else reject();
  }
  if (total > 2 * 1024 ** 3 || [...signaturePaths.keys()].some(name => !m.files.some(entry => entry.path === name))) reject();
  return m;
}
/** Complete verification uses the OS seal as well as the ordinary byte inventory. */
export async function verifyPackage(root, manifest) { return verifyForEpoch(root,manifest,2); }
// Test tooling for a separately pinned previous artifact only. Current native
// admission and ordinary package verification never accept this older epoch.
export async function verifyPreviousEpoch1Package(root,manifest) { return verifyForEpoch(root,manifest,1); }
async function verifyForEpoch(root,manifest,epoch) {
  validateForEpoch(manifest,epoch);
  for (const name of ['Contents/Resources/bin/node', 'Contents/Resources/model/llama-server', 'Contents/Resources/app/local-ui.mjs',
    ...(epoch===2?['Contents/Resources/demo-seed.json']:[]),
    ...['prepare', 'application', 'maintenance', 'prepare-store', 'download',...(epoch===2?['demo','demo-prepare']:[])].map(name => `Contents/Resources/desktop/runtime/${name}.mjs`)]) {
    if (!manifest.files.some(entry => entry.path === name && entry.kind === 'file')) reject();
  }
  root = await realpath(root);
  const file = path.join(root, MANIFEST_PATH), before = await lstat(file);
  if (!before.isFile() || before.nlink !== 1 || (before.mode & 0o022) || before.size < 1 || before.size > 32 * 1024 ** 2) reject();
  const bytes = Buffer.alloc(before.size);
  await readStable(file, before, (block, position) => block.copy(bytes, position));
  if (JSON.stringify(JSON.parse(bytes)) !== JSON.stringify(manifest)) reject();
  const { files, snapshots } = await collectPayload(root);
  if (JSON.stringify(files) !== JSON.stringify(manifest.files) || process.platform !== 'darwin') reject();
  const requirement = '=identifier "local.context-router.pilot" and info[CFBundleIdentifier] = "local.context-router.pilot" and info[CFBundleExecutable] = "context-router" and info[CFBundlePackageType] = "APPL"';
  const result = spawnSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--all-architectures', '-R', requirement, root],
    { env: { PATH: '', LC_ALL: 'C' }, encoding: 'utf8', timeout: 20000, maxBuffer: 1024 * 1024 });
  if (result.error || result.status !== 0) reject();
  snapshots.set(file, before);
  for (const [name, pinned] of snapshots) if (!same(pinned, await lstat(name))) reject();
}

/** External final-byte receipt. Never place this back inside the sealed bundle. */
export async function sealedByteReceipt(root) {
  root = await realpath(root);
  const { files, snapshots } = await collectPayload(root);
  const manifestFile = path.join(root, MANIFEST_PATH), manifestStat = await lstat(manifestFile);
  if (!manifestStat.isFile() || manifestStat.nlink !== 1 || (manifestStat.mode & 0o022) || manifestStat.size < 1 || manifestStat.size > 32 * 1024 ** 2) reject();
  snapshots.set(manifestFile, manifestStat);
  files.push({ path: MANIFEST_PATH, kind: 'signature', executable: !!(manifestStat.mode & 0o111) });
  const result = [];
  for (const entry of files) {
    if (entry.kind !== 'signature') { result.push(entry); continue; }
    const file = path.join(root, entry.path), before = snapshots.get(file);
    result.push({ path: entry.path, kind: 'file', size: before.size, sha256: await hashStable(file, before), executable: entry.executable });
  }
  for (const [file, before] of snapshots) if (!same(before, await lstat(file))) reject();
  return result.sort((a, b) => compare(a.path, b.path));
}
