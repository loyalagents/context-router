import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { jsonText } from '../shared.mjs';

export async function runBackendHarness({
  repoRoot,
  runPlan,
  spawnProcess = spawn,
}) {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'eval-runner-'));
  const inputPath = path.join(tempRoot, 'input.json');
  const outputPath = path.join(tempRoot, 'output.json');

  try {
    await writeFile(inputPath, jsonText(toHarnessInput(runPlan)));

    const backendRoot = path.join(repoRoot, 'apps/backend');
    const child = spawnProcess(
      process.execPath,
      [
        '-r',
        'tsconfig-paths/register',
        '-r',
        'ts-node/register',
        'test/eval-runner/harness.ts',
        '--input',
        inputPath,
        '--output',
        outputPath,
      ],
      {
        cwd: backendRoot,
        env: { ...process.env },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );

    const { exitCode, stdout, stderr } = await waitForChild(child);
    if (exitCode !== 0) {
      throw harnessError({ exitCode, stdout, stderr });
    }

    let resultText;
    try {
      resultText = await readFile(outputPath, 'utf8');
    } catch (error) {
      throw harnessError({
        exitCode,
        stdout,
        stderr: [
          stderr,
          `Backend eval harness completed but did not write output JSON: ${error.message}`,
        ]
          .filter(Boolean)
          .join('\n'),
      });
    }

    let result;
    try {
      result = JSON.parse(resultText);
    } catch (error) {
      throw harnessError({
        exitCode,
        stdout,
        stderr: [
          stderr,
          `Backend eval harness wrote invalid output JSON: ${error.message}`,
        ]
          .filter(Boolean)
          .join('\n'),
      });
    }
    if (result.response?.status === 'failed') {
      throw harnessError({
        exitCode: 0,
        stdout,
        stderr: [
          stderr,
          'Form-fill response status was failed. The backend returned a failed form-fill artifact instead of exercising the expected pipeline.',
        ]
          .filter(Boolean)
          .join('\n'),
      });
    }
    return result;
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

function toHarnessInput(runPlan) {
  return {
    scenario: runPlan.scenario,
    formPdfPath: runPlan.formPdfPath,
    seedPreferences: runPlan.seedPreferences,
    evalDefinitions: runPlan.evalDefinitions,
    fillActions: runPlan.fillActions,
  };
}

function waitForChild(child) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (exitCode) => {
      resolve({ exitCode, stdout, stderr });
    });
  });
}

export function formatHarnessFailure({ exitCode, stdout, stderr }) {
  const lines = [`backend eval harness failed with exit code ${exitCode}`];
  if (/ECONNREFUSED|P1001/i.test(stderr)) {
    lines.push(
      'The backend test database may be down or unmigrated. Run pnpm --filter backend test:db:up and pnpm --filter backend test:db:migrate.',
    );
  }
  if (stdout.trim()) {
    lines.push('', 'stdout:', trimLog(stdout));
  }
  if (stderr.trim()) {
    lines.push('', 'stderr:', trimLog(stderr));
  }
  return lines.join('\n');
}

export function harnessError(parts) {
  const error = new Error(formatHarnessFailure(parts));
  error.isHarnessFailure = true;
  return error;
}

function trimLog(value) {
  const lines = value.trim().split('\n');
  const tail = lines.slice(-80);
  return tail.join('\n');
}
