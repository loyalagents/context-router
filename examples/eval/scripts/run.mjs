#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseRunArgs, usage } from './eval-runner/args.mjs';
import { loadScenarioFixture } from './eval-runner/fixtures.mjs';
import {
  assertElenaTemplateSmokeEvalFacts,
  buildRunPlan,
} from './eval-runner/actions.mjs';
import { runBackendHarness } from './eval-runner/backend.mjs';
import {
  buildFilledFormSnapshot,
  compareOrUpdateSnapshots,
} from './eval-runner/snapshots.mjs';
import { formatResult as formatValidationResult, runValidation } from './validate.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultRepoRoot = path.resolve(__dirname, '../../..');

export async function runEval({
  repoRoot = defaultRepoRoot,
  args = [],
  backendHarness = runBackendHarness,
} = {}) {
  const parsed = parseRunArgs(args);
  if (parsed.kind === 'usage-error') {
    return {
      exitCode: 2,
      repoRoot,
      usageError: parsed.message,
      usage: usage(),
      lines: [],
    };
  }

  const { scenarioId, updateSnapshots } = parsed.options;
  try {
    const validation = await runValidation({
      repoRoot,
      args: ['--scenario', scenarioId],
      writeReport: false,
      skipExpectedSnapshots: updateSnapshots,
    });
    if (validation.exitCode !== 0) {
      return {
        exitCode: 1,
        repoRoot,
        lines: [formatValidationResult(validation)],
      };
    }

    const fixture = await loadScenarioFixture({ repoRoot, scenarioId });
    const runPlan = buildRunPlan(fixture);
    if (scenarioId === 'elena-marquez-i9-template-smoke') {
      assertElenaTemplateSmokeEvalFacts(runPlan.evalDefinitions);
    }

    const harnessResult = await backendHarness({ repoRoot, runPlan, fixture });
    const snapshots = {
      'filled-form': buildFilledFormSnapshot({
        fixture,
        runPlan,
        harnessResult,
      }),
    };
    const snapshotResult = await compareOrUpdateSnapshots({
      fixture,
      snapshots,
      updateSnapshots,
    });

    return {
      exitCode: snapshotResult.ok ? 0 : 1,
      repoRoot,
      lines: [
        `eval run ${snapshotResult.ok ? 'passed' : 'failed'}`,
        ...snapshotResult.lines,
      ],
      snapshots,
    };
  } catch (error) {
    return {
      exitCode: 1,
      repoRoot,
      lines: ['eval run failed', '', error.message],
      error,
    };
  }
}

export function formatRunResult(result) {
  if (result.usageError) return `${result.usageError}\n\n${result.usage}`;
  return result.lines.join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await runEval({ args: process.argv.slice(2) });
  console.log(formatRunResult(result));
  process.exitCode = result.exitCode;
}
