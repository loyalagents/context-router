import fs from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { loadDemoPlan, hash } from './records.mjs';

export const seedManifest = Object.freeze(JSON.parse(await fs.readFile(new URL('./seed-manifest.json', import.meta.url), 'utf8')));
export const seedIdentity = Object.freeze({ version: seedManifest.seed, sha256: hash(JSON.stringify(seedManifest)) });
/** Installed callers supply only the inventory-verified bundle resource directory. */
export async function loadBundledSeed(directory) {
  const plan = await loadDemoPlan(directory, seedManifest.dataset);
  if (plan.total !== seedManifest.total || plan.entries.length !== seedManifest.active ||
      plan.skipped.length !== seedManifest.inactive || !isDeepStrictEqual(plan.sources, seedManifest.sources)) {
    throw new Error('Bundled demo seed mismatch.');
  }
  return { ...seedIdentity, plan };
}
