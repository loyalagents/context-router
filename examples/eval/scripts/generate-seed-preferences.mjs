#!/usr/bin/env node

import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../..');
const usersRoot = path.join(repoRoot, 'examples/eval/users');

async function main() {
  const userIds = await readdir(usersRoot);

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
    const rows = deriveSeedPreferences(profile);
    const outputPath = path.join(userRoot, 'seed-preferences.generated.json');
    await writeFile(outputPath, `${JSON.stringify(rows, null, 2)}\n`);
    console.log(`wrote ${path.relative(repoRoot, outputPath)} (${rows.length} rows)`);
  }
}

function deriveSeedPreferences(profile) {
  const rows = [];

  for (const entry of profile.seedPreferences ?? []) {
    const value = getFactValue(profile.facts, entry.factKey);
    if (value == null) continue;
    rows.push({ slug: entry.slug, value });
  }

  return rows.sort((left, right) =>
    left.slug < right.slug ? -1 : left.slug > right.slug ? 1 : 0,
  );
}

function getFactValue(facts, factKey) {
  return factKey.split('.').reduce((value, segment) => {
    if (value == null || typeof value !== 'object') return undefined;
    return value[segment];
  }, facts);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
