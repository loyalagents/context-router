import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { backend, configuration } from '../../../../examples/demo-10-2026/runtime.mjs';
import { loadBundledSeed } from '../../../backend/scripts/demo/seed.mjs';

export const seed = () => loadBundledSeed(path.resolve(import.meta.dirname, '../../../../examples/demo-10-2026/001_user_001'));
export async function preparePair(root) {
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  const b = backend(), config = configuration(root), identity = b.createSqliteIdentityRuntime(config, true);
  await identity.service.initialize();
  const ready = await identity.service.verifyReadyState();
  new b.SqliteMcpCredentials(identity.database, ready.state.principalId).upgrade();
  await b.waitForNativeOwners();
  return config;
}
export async function prepareEvidence(root) {
  const directory = path.join(root, 'evidence');
  await fs.mkdir(path.join(directory, 'exports'), { recursive: true, mode: 0o700 });
  return directory;
}
// Only call after the exact SQLite/native owners have settled.
export async function treeBytes(root) {
  const result = {};
  async function visit(dir, prefix = '') {
    for (const entry of (await fs.readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const name = path.join(prefix, entry.name), file = path.join(dir, entry.name);
      if (entry.isDirectory()) await visit(file, name);
      else result[name] = createHash('sha256').update(await fs.readFile(file)).digest('hex');
    }
  }
  await visit(root); return result;
}
