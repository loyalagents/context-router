import { copyFile, mkdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { loadBundledSeed } from '../../backend/scripts/demo/seed.mjs';

export async function copyDemoSeed(source, destination) {
  const seed = await loadBundledSeed(source);
  await mkdir(destination, { mode: 0o755 });
  for (const { file } of seed.plan.sources) await copyFile(path.join(source, file), path.join(destination, file), constants.COPYFILE_EXCL);
  const copied = await loadBundledSeed(destination);
  return { version: copied.version, sha256: copied.sha256 };
}
