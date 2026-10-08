import { mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('Native build requires Darwin arm64');
const root = path.resolve(import.meta.dirname, '..');
mkdirSync(path.join(root, 'build'), { recursive: true });
const result = spawnSync('/usr/bin/clang', ['-Wall', '-Wextra', '-Werror', '-fobjc-arc', '-O2', '-framework', 'Foundation', '-framework', 'AppKit',
  ...['guardian', 'package', 'envelope', 'process', 'supervisor', 'maintenance', 'menu', 'diagnostics'].map(name => path.join(root, `native/${name}.m`)), '-o', path.join(root, 'build/context-router')], { stdio: 'inherit', timeout: 30_000 });
if (result.error || result.status !== 0) throw new Error('Native build failed');
