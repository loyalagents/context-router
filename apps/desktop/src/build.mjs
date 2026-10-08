import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
for (const directory of [import.meta.dirname, path.resolve(import.meta.dirname, '../runtime')])
for (const name of readdirSync(directory).filter(name => name.endsWith('.mjs'))) {
  const result = spawnSync(process.execPath, ['--check', path.join(directory, name)], { stdio: 'inherit', timeout: 5000 });
  if (result.error || result.status !== 0) throw new Error('Desktop source validation failed');
}
console.log('Desktop JavaScript validated; native artifact requires build:native on Darwin arm64.');
