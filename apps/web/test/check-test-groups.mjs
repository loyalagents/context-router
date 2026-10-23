import { readdir, readFile, realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// Package scripts are the only group inventory. Pretest checks finish before
// the direct Node test process starts, preserving the umbrella's process tree.
const prefix = 'node --unhandled-rejections=strict --test --test-concurrency=1 ';
export function validateWebTestGroups(scripts, discovered) {
  const groups = {};
  for (const group of ['helpers', 'browser']) {
    const command = scripts['test:' + group];
    if (typeof command !== 'string' || !command.startsWith(prefix)) throw new Error('Unexpected focused web test command');
    const files = command.slice(prefix.length).split(' ');
    if (!files.length || files.some(file => !/^test\/[a-z0-9-]+\.test\.mjs$/.test(file))) throw new Error('Unexpected focused web test command');
    groups[group] = files.map(file => file.slice(5));
  }
  const declared = Object.values(groups).flat();
  if (new Set(declared).size !== declared.length || new Set(discovered).size !== discovered.length ||
      JSON.stringify([...declared].sort()) !== JSON.stringify([...discovered].sort())) {
    throw new Error('Web test census changed; classify every test/*.test.mjs in package.json');
  }
  return groups;
}

if (process.argv[1] && await realpath(process.argv[1]).catch(() => null) === fileURLToPath(import.meta.url)) {
  try {
    const files = (await readdir(import.meta.dirname)).filter(name => name.endsWith('.test.mjs'));
    const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
    validateWebTestGroups(manifest.scripts, files);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
