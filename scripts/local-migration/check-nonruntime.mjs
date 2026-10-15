#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { validateMergeBase } from './gate-runner.mjs';
import { runGit } from './ci-validation-policy.mjs';

async function checkNonruntime() {
  if (process.argv.length !== 2) throw new Error('Unexpected nonruntime checker arguments');
  const repositoryRoot = path.resolve(import.meta.dirname, '../..');
  const baseSha = await validateMergeBase(process.env.MIGRATION_GATE_BASE_SHA, async args => {
    try { return { exitCode: 0, stdout: await runGit(repositoryRoot, args) }; }
    catch { return { exitCode: 1, stdout: '' }; }
  });
  await runGit(repositoryRoot, ['diff', '--check', baseSha, 'HEAD', '--']);
  const scratch = await mkdtemp(path.join(process.env.RUNNER_TEMP || os.tmpdir(), 'nonruntime-contracts-'));
  try {
    // Reuse the existing verified bundle format; importing this module does not
    // invoke the gate, acquire databases, copy dependencies or build anything.
    const { exportBaseContracts } = await import('./migration-gate.mjs');
    const base = await exportBaseContracts(baseSha, scratch);
    const exec = promisify(execFile);
    const result = await exec(process.execPath, ['scripts/local-migration/check-contract-baseline.mjs'], {
      cwd: repositoryRoot, timeout: 120000, maxBuffer: 1024 * 1024, encoding: 'utf8',
      env: { ...process.env, MIGRATION_GATE_REQUIRE_BASE_COMPARISON: '1',
        MIGRATION_GATE_BASE_SHA: baseSha, MIGRATION_GATE_BASELINE_DIR: base.baseDirectory,
        MIGRATION_GATE_BASELINE_MANIFEST_SHA256: base.manifestSha256 },
    });
    if (!/\bbaseComparison=performed\b/.test(result.stdout)) throw new Error('Required base comparison was not performed');
    process.stdout.write(result.stdout);
    console.log('Nonruntime contract and whitespace checks passed; no source/package qualification receipt issued.');
  } finally { await rm(scratch, { recursive: true, force: true }); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await checkNonruntime(); }
  catch (error) {
    // Preserve the contract checker's actionable diagnostics, never treat its
    // partial stdout or a missing base as successful validation.
    console.error(error.stderr || error.message);
    process.exitCode = 1;
  }
}
