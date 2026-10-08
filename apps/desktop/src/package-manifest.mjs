import { createHash } from 'node:crypto';
import { lstat, open, readdir, readlink, realpath } from 'node:fs/promises';
import path from 'node:path';
import {MODEL} from '../runtime/model-assets.mjs';

export const MANIFEST_PATH = 'Contents/Resources/package-manifest.json';
const reject = () => { throw new Error('Package verification failed'); };
const exact = (v, keys) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const modelMetadata={name:MODEL.name,bytes:MODEL.bytes,sha256:MODEL.sha256,url:MODEL.url,runtime:'b11146',runtimeArchiveSha256:'1ad3f9eff80edb9dbef4259ad564d1720612ef7eea48fa4afed0e54f5f3d5711',contextTokens:16384,slots:1};
const relative = value => typeof value === 'string' && value.length <= 4096 && value.startsWith('Contents/') && !value.includes('\\') && !/[\x00-\x1f\x7f]/u.test(value) &&
  value.split('/').every(part => part && part !== '.' && part !== '..') && value !== MANIFEST_PATH;
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const same = (a, b) => a.dev === b.dev && a.ino === b.ino && a.mode === b.mode && a.nlink === b.nlink && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;

/** Build-time completeness inventory; this does not authenticate a publisher. */
export async function inventoryPayload(root) {
  root = await realpath(root);
  const files = [];
  let total = 0;
  async function visit(name) {
    const file = path.join(root, name), before = await lstat(file);
    if (name === MANIFEST_PATH) return;
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
      const fd = await open(file, 'r');
      const hash = createHash('sha256');
      try {
        if (!same(before, await fd.stat())) reject();
        const block = Buffer.alloc(256 * 1024);
        let position = 0;
        while (position < before.size) {
          const { bytesRead } = await fd.read(block, 0, Math.min(block.length, before.size - position), position);
          if (!bytesRead) reject();
          hash.update(block.subarray(0, bytesRead)); position += bytesRead;
        }
        if (!same(before, await fd.stat()) || !same(before, await lstat(file))) reject();
      } finally { await fd.close(); }
      files.push({ path: name, kind: 'file', size: before.size, sha256: hash.digest('hex'), executable: !!(before.mode & 0o111) });
    } else reject();
    if (files.length > 100_000) reject();
  }
  await visit('');
  return files.sort((a, b) => compare(a.path, b.path));
}
export function createPackageManifest({ source, files }) {
  const manifest = { version: 1, distribution: 'local-candidate', platform: 'darwin', arch: 'arm64', securityEpoch: 1,
    node: '24.21.0', sqliteVersions: [1, 2], identityVersion: 1, model:{...modelMetadata},source, files };
  validatePackageManifest(manifest);
  return manifest;
}
export function validatePackageManifest(m) {
  if (!exact(m, ['version', 'distribution', 'platform', 'arch', 'securityEpoch', 'node', 'sqliteVersions', 'identityVersion','model', 'source', 'files']) ||
    m.version !== 1 || m.distribution !== 'local-candidate' || m.platform !== 'darwin' || m.arch !== 'arm64' || m.securityEpoch !== 1 ||
    m.node !== '24.21.0' || JSON.stringify(m.sqliteVersions) !== '[1,2]' || m.identityVersion !== 1 || !hex(m.source) ||
    !Array.isArray(m.files) || !m.files.length || m.files.length > 100_000 || !exact(m.model,Object.keys(modelMetadata)) || Object.entries(modelMetadata).some(([key,value])=>m.model[key]!==value)) reject();
  let previous = '', total = 0;
  for (const file of m.files) {
    if (!relative(file?.path) || compare(previous, file.path) >= 0) reject();
    previous = file.path;
    if (file.kind === 'file') {
      if (!exact(file, ['path', 'kind', 'size', 'sha256', 'executable']) || !Number.isSafeInteger(file.size) || file.size < 0 ||
        !hex(file.sha256) || typeof file.executable !== 'boolean') reject();
      total += file.size;
    } else if (file.kind === 'symlink') {
      if (!exact(file, ['path', 'kind', 'target']) || typeof file.target !== 'string' || !file.target || file.target.length > 4096 ||
        path.isAbsolute(file.target) || file.target.includes('\0') || file.target.includes('\\')) reject();
    } else reject();
  }
  if (total > 2 * 1024 ** 3) reject();
  return m;
}
export async function verifyPackage(root, manifest) {
  validatePackageManifest(manifest);
  if (JSON.stringify(await inventoryPayload(root)) !== JSON.stringify(manifest.files)) reject();
}
