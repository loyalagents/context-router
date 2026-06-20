#!/usr/bin/env node

import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { deriveSeedPreferences, jsonText } from './shared.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../..');
const usersRoot = path.join(repoRoot, 'examples/eval/users');

async function main() {
  const userIds = (await readdir(usersRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  for (const userId of userIds.sort()) {
    const userRoot = path.join(usersRoot, userId);
    const profilePath = path.join(userRoot, 'profile.yaml');
    let profileSource;

    try {
      profileSource = await readFile(profilePath, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }

    const profile = parse(profileSource);
    if (!Array.isArray(profile.seedPreferences)) continue;

    const rows = deriveSeedPreferences(profile);
    const outputPath = path.join(userRoot, 'seed-preferences.generated.json');
    await writeFile(outputPath, jsonText(rows));
    console.log(`wrote ${path.relative(repoRoot, outputPath)} (${rows.length} rows)`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
