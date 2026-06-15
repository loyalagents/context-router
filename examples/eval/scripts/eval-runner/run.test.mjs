import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseRunArgs } from './args.mjs';
import {
  EXPECTED_ELENA_I9_EVAL_FACT_KEYS,
  assertElenaTemplateSmokeEvalFacts,
  buildRunPlan,
  evalSlugForFactKey,
  renderFieldValue,
  renderFactValue,
  valueTypeFor,
} from './actions.mjs';
import { harnessError, runBackendHarness } from './backend.mjs';
import { loadScenarioFixture } from './fixtures.mjs';
import {
  buildFilledFormSnapshot,
  compareOrUpdateSnapshots,
} from './snapshots.mjs';
import { runEval } from '../run.mjs';
import { jsonText } from '../shared.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../../..');

test('run arg parser accepts scenario and explicit snapshot updates', () => {
  assert.deepEqual(
    parseRunArgs([
      '--update-snapshots',
      '--scenario',
      'elena-marquez-i9-template-smoke',
    ]),
    {
      kind: 'ok',
      options: {
        scenarioId: 'elena-marquez-i9-template-smoke',
        updateSnapshots: true,
        verbose: false,
      },
    },
  );
  assert.deepEqual(
    parseRunArgs([
      '--verbose',
      '--scenario',
      'elena-marquez-i9-template-smoke',
    ]),
    {
      kind: 'ok',
      options: {
        scenarioId: 'elena-marquez-i9-template-smoke',
        updateSnapshots: false,
        verbose: true,
      },
    },
  );
  assert.equal(parseRunArgs([]).kind, 'usage-error');
  assert.equal(parseRunArgs(['--scenario', 'Bad_ID']).kind, 'usage-error');
  assert.equal(parseRunArgs(['--unknown']).kind, 'usage-error');
  assert.equal(parseRunArgs(['--help']).kind, 'help');
});

test('run plan prefers seed slugs and creates only Elena eval-only facts', async () => {
  const fixture = await loadScenarioFixture({
    repoRoot,
    scenarioId: 'elena-marquez-i9-template-smoke',
  });
  const runPlan = buildRunPlan(fixture);

  assertElenaTemplateSmokeEvalFacts(runPlan.evalDefinitions);
  assert.deepEqual(
    runPlan.evalDefinitions.map((definition) => definition.factKey).sort(),
    [...EXPECTED_ELENA_I9_EVAL_FACT_KEYS].sort(),
  );
  assert.equal(
    runPlan.actionPlans.find((plan) => plan.factKey === 'identity.firstName')
      .sourceSlug,
    'profile.first_name',
  );
  assert.equal(
    runPlan.actionPlans.find((plan) => plan.factKey === 'address.current.city')
      .sourceSlug,
    'eval.address.current.city',
  );
  assert.equal(runPlan.fillActions.length, 48);
  assert.equal(
    runPlan.fillActions.filter((action) => action.action === 'SET_TEXT').length,
    11,
  );
  assert.equal(
    runPlan.fillActions.filter((action) => action.action === 'CHECK').length,
    1,
  );
  assert.equal(
    runPlan.fillActions.filter((action) => action.action === 'SELECT_OPTION')
      .length,
    1,
  );
  assert.equal(
    runPlan.fillActions.filter((action) => action.action === 'SKIP').length,
    35,
  );
});

test('runner value rendering and eval slug derivation are deterministic', () => {
  assert.equal(evalSlugForFactKey('address.current.postalCode'), 'eval.address.current.postal_code');
  assert.equal(valueTypeFor(['email']), 'ARRAY');
  assert.equal(valueTypeFor(true), 'BOOLEAN');
  assert.equal(valueTypeFor('Elena'), 'STRING');
  assert.equal(renderFactValue(['Ruiz']), 'Ruiz');
  assert.equal(renderFactValue('1994-07-18'), '07/18/1994');
  assert.equal(
    renderFieldValue('000-00-0194', { render: 'digits-only' }),
    '000000194',
  );
  assert.equal(
    renderFieldValue('1994-07-18', { render: 'mmddyyyy' }),
    '07181994',
  );
});

test('run plan applies conditional I-9 citizenship branches', async () => {
  const elena = await loadScenarioFixture({
    repoRoot,
    scenarioId: 'elena-marquez-i9-template-smoke',
  });
  const elenaPlan = buildRunPlan(elena);
  assert.equal(actionFor(elenaPlan, 'CB_1').fillAction.action, 'CHECK');
  for (const name of ['CB_2', 'CB_3', 'CB_4']) {
    assert.equal(actionFor(elenaPlan, name).fillAction.action, 'SKIP');
    assert.equal(actionFor(elenaPlan, name).expectedSkipKind, 'conditional-inactive');
  }

  const samir = await loadScenarioFixture({
    repoRoot,
    scenarioId: 'samir-desai-i9-template-smoke',
  });
  const samirPlan = buildRunPlan(samir);
  assert.equal(actionFor(samirPlan, 'CB_3').fillAction.action, 'CHECK');
  assert.equal(
    actionFor(samirPlan, '3 A lawful permanent resident Enter USCIS or ANumber')
      .fillAction.action,
    'SET_TEXT',
  );
  assert.equal(actionFor(samirPlan, 'USCIS ANumber').fillAction.action, 'SKIP');
  assert.equal(
    actionFor(samirPlan, 'USCIS ANumber').expectedSkipKind,
    'conditional-inactive',
  );

  const alex = await loadScenarioFixture({
    repoRoot,
    scenarioId: 'alex-i9-realistic',
  });
  const alexPlan = buildRunPlan(alex);
  assert.equal(actionFor(alexPlan, 'CB_4').fillAction.action, 'CHECK');
  assert.equal(
    actionFor(alexPlan, '3 A lawful permanent resident Enter USCIS or ANumber')
      .expectedSkipKind,
    'conditional-inactive',
  );
  assert.equal(
    actionFor(alexPlan, 'Exp Date mmddyyyy').fillAction.value,
    '09302028',
  );
  assert.equal(actionFor(alexPlan, 'USCIS ANumber').fillAction.action, 'SET_TEXT');
  assert.equal(
    actionFor(alexPlan, 'Form I94 Admission Number').fillAction.action,
    'SET_TEXT',
  );

  const noncitizenNational = structuredClone(elena);
  noncitizenNational.profile.facts.workAuthorization.citizenshipStatus =
    'noncitizen national';
  const noncitizenNationalPlan = buildRunPlan(noncitizenNational);
  assert.equal(actionFor(noncitizenNationalPlan, 'CB_2').fillAction.action, 'CHECK');
});

test('dropdown option mismatch emits explicit SKIP', async () => {
  const fixture = await loadScenarioFixture({
    repoRoot,
    scenarioId: 'elena-marquez-i9-template-smoke',
  });
  const optionSet = fixture.fieldsGenerated.optionSets.find(
    (candidate) => candidate.id === 'optionSet1',
  );
  optionSet.options = optionSet.options.filter((option) => option !== 'CA');

  const runPlan = buildRunPlan(fixture);
  const state = runPlan.actionPlans.find(
    (plan) => plan.pdfFieldName === 'State',
  );
  assert.equal(state.fillAction.action, 'SKIP');
  assert.match(state.fillAction.skipReason, /not an available option/);
});

test('filled-form snapshot normalization records expected counts and classifications', async () => {
  const fixture = await loadScenarioFixture({
    repoRoot,
    scenarioId: 'elena-marquez-i9-template-smoke',
  });
  fixture.scenario.expectedSnapshots = ['filled-form'];
  const runPlan = buildRunPlan(fixture);
  const snapshot = buildFilledFormSnapshot({
    fixture,
    runPlan,
    harnessResult: fakeHarnessResult(runPlan),
  });

  assert.equal(snapshot.response.status, 'partial');
  assert.equal(snapshot.summary.totalFields, 48);
  assert.equal(snapshot.summary.filledCount, 13);
  assert.equal(snapshot.summary.skippedCount, 35);
  assert.deepEqual(snapshot.summary.plannedActionCounts, {
    SET_TEXT: 11,
    CHECK: 1,
    UNCHECK: 0,
    SELECT_OPTION: 1,
    SKIP: 35,
  });
  assert.equal(
    snapshot.fields.find((field) => field.pdfFieldName === 'State').actual
      .selected[0],
    'CA',
  );
  assert.equal(
    snapshot.fields.find((field) => field.pdfFieldName === 'State')
      .classification,
    'correct',
  );
});

test('snapshot classification treats field render variants as equivalent', async () => {
  const fixture = await loadScenarioFixture({
    repoRoot,
    scenarioId: 'elena-marquez-i9-template-smoke',
  });
  const runPlan = buildRunPlan(fixture);
  const harnessResult = fakeHarnessResult(runPlan);
  harnessResult.filledPdfFields['Date of Birth mmddyyyy'] = {
    value: '07/18/1994',
  };

  const snapshot = buildFilledFormSnapshot({
    fixture,
    runPlan,
    harnessResult,
  });
  assert.equal(
    snapshot.fields.find((field) => field.pdfFieldName === 'Date of Birth mmddyyyy')
      .expected.value,
    '07181994',
  );
  assert.equal(
    snapshot.fields.find((field) => field.pdfFieldName === 'Date of Birth mmddyyyy')
      .classification,
    'correct',
  );

  harnessResult.filledPdfFields['Date of Birth mmddyyyy'] = {
    value: '01/01/1990',
  };
  const mismatch = buildFilledFormSnapshot({
    fixture,
    runPlan,
    harnessResult,
  });
  assert.equal(
    mismatch.fields.find((field) => field.pdfFieldName === 'Date of Birth mmddyyyy')
      .classification,
    'incorrect',
  );
});

test('unsupported generated field types are classified as unsupported', async () => {
  const fixture = await loadScenarioFixture({
    repoRoot,
    scenarioId: 'elena-marquez-i9-template-smoke',
  });
  const joined = fixture.joinedFields.find(
    ({ fieldMap }) => fieldMap.pdfFieldName === 'First Name Given Name',
  );
  joined.generated.type = 'not_supported_by_runner';

  const runPlan = buildRunPlan(fixture);
  const snapshot = buildFilledFormSnapshot({
    fixture,
    runPlan,
    harnessResult: fakeHarnessResult(runPlan),
  });
  const field = snapshot.fields.find(
    (candidate) => candidate.pdfFieldName === 'First Name Given Name',
  );

  assert.equal(field.expected.action, 'SKIP');
  assert.equal(field.classification, 'unsupported');
});

test('runEval updates then compares declared filled-form snapshot', async (t) => {
  const root = await copyRepo(t);
  await declareFilledFormSnapshot(root);
  const backendHarness = async ({ runPlan }) => fakeHarnessResult(runPlan);

  const updated = await runEval({
    repoRoot: root,
    args: ['--scenario', 'elena-marquez-i9-template-smoke', '--update-snapshots'],
    backendHarness,
  });
  assert.equal(updated.exitCode, 0, updated.lines.join('\n'));

  const expectedPath = path.join(
    root,
    'examples/eval/scenarios/elena-marquez-i9-template-smoke/expected/filled-form.json',
  );
  assert.match(await readFile(expectedPath, 'utf8'), /"snapshotType": "filled-form"/);

  const compared = await runEval({
    repoRoot: root,
    args: ['--scenario', 'elena-marquez-i9-template-smoke'],
    backendHarness,
  });
  assert.equal(compared.exitCode, 0, compared.lines.join('\n'));

  const staleSnapshot = JSON.parse(await readFile(expectedPath, 'utf8'));
  staleSnapshot.response.status = 'success';
  await writeFile(expectedPath, `${JSON.stringify(staleSnapshot, null, 2)}\n`);
  const stale = await runEval({
    repoRoot: root,
    args: ['--scenario', 'elena-marquez-i9-template-smoke'],
    backendHarness,
  });
  assert.equal(stale.exitCode, 1);
  assert.match(stale.lines.join('\n'), /snapshot mismatch/);

  const help = await runEval({ repoRoot: root, args: ['--help'], backendHarness });
  assert.equal(help.exitCode, 0);
  assert.match(help.lines.join('\n'), /pnpm eval:run --scenario <scenarioId>/);

  const usage = await runEval({ repoRoot: root, args: ['--unknown'], backendHarness });
  assert.equal(usage.exitCode, 2);
  assert.match(usage.lines.join('\n'), /Unsupported argument: --unknown/);
});

test('runEval verbose output shows plain stacks but not harness stacks', async (t) => {
  const root = await copyRepo(t);
  const plainError = new Error('plain runner failure');
  plainError.stack = [
    'Error: plain runner failure',
    '    at plainRunnerFrame (eval-runner.test.mjs:1:1)',
  ].join('\n');

  const concise = await runEval({
    repoRoot: root,
    args: ['--scenario', 'elena-marquez-i9-template-smoke'],
    backendHarness: async () => {
      throw plainError;
    },
  });
  assert.equal(concise.exitCode, 1);
  assert.match(concise.lines.join('\n'), /plain runner failure/);
  assert.doesNotMatch(concise.lines.join('\n'), /plainRunnerFrame/);

  const verbose = await runEval({
    repoRoot: root,
    args: ['--scenario', 'elena-marquez-i9-template-smoke', '--verbose'],
    backendHarness: async () => {
      throw plainError;
    },
  });
  assert.equal(verbose.exitCode, 1);
  assert.match(verbose.lines.join('\n'), /plainRunnerFrame/);

  const taggedHarnessError = harnessError({
    exitCode: 1,
    stdout: 'harness stdout tail',
    stderr: 'harness stderr tail',
  });
  const harnessVerbose = await runEval({
    repoRoot: root,
    args: ['--scenario', 'elena-marquez-i9-template-smoke', '--verbose'],
    backendHarness: async () => {
      throw taggedHarnessError;
    },
  });
  const harnessOutput = harnessVerbose.lines.join('\n');
  assert.equal(harnessVerbose.exitCode, 1);
  assert.match(harnessOutput, /harness stdout tail/);
  assert.match(harnessOutput, /harness stderr tail/);
  assert.doesNotMatch(harnessOutput, /at harnessError/);
});

test('snapshot update writes only declared snapshots and preserves unrelated files', async (t) => {
  const root = await copyRepo(t);
  await declareFilledFormSnapshot(root);
  const fixture = await loadScenarioFixture({
    repoRoot: root,
    scenarioId: 'elena-marquez-i9-template-smoke',
  });
  const runPlan = buildRunPlan(fixture);
  const snapshot = buildFilledFormSnapshot({
    fixture,
    runPlan,
    harnessResult: fakeHarnessResult(runPlan),
  });
  const expectedRoot = path.join(fixture.scenarioRoot, 'expected');
  const unrelatedPath = path.join(expectedRoot, 'written-preferences.json');
  await mkdir(expectedRoot, { recursive: true });
  await writeFile(unrelatedPath, 'keep me\n');

  const result = await compareOrUpdateSnapshots({
    fixture,
    snapshots: {
      'filled-form': snapshot,
      'written-preferences': { snapshotType: 'written-preferences' },
    },
    updateSnapshots: true,
  });

  assert.equal(result.ok, true, result.lines.join('\n'));
  assert.deepEqual(
    result.updated.map((filePath) => path.basename(filePath)),
    ['filled-form.json'],
  );
  assert.equal(await readFile(unrelatedPath, 'utf8'), 'keep me\n');
});

test('backend harness command construction and temp-result handling are deterministic', async () => {
  const fixture = await loadScenarioFixture({
    repoRoot,
    scenarioId: 'elena-marquez-i9-template-smoke',
  });
  const runPlan = buildRunPlan(fixture);
  let spawnCall;
  const result = await runBackendHarness({
    repoRoot,
    runPlan,
    spawnProcess(command, args, options) {
      spawnCall = { command, args, options };
      const outputPath = args[args.indexOf('--output') + 1];
      return fakeChild({
        writeOutput: () =>
          writeFile(outputPath, jsonText(fakeHarnessResult(runPlan))),
      });
    },
  });

  assert.equal(spawnCall.command, process.execPath);
  assert.equal(spawnCall.options.cwd, path.join(repoRoot, 'apps/backend'));
  assert.deepEqual(spawnCall.args.slice(0, 5), [
    '-r',
    'tsconfig-paths/register',
    '-r',
    'ts-node/register',
    'test/eval-runner/harness.ts',
  ]);
  assert.equal(result.response.status, 'partial');
});

test('backend harness failures include useful diagnostics', async () => {
  const fixture = await loadScenarioFixture({
    repoRoot,
    scenarioId: 'elena-marquez-i9-template-smoke',
  });
  const runPlan = buildRunPlan(fixture);

  await assert.rejects(
    runBackendHarness({
      repoRoot,
      runPlan,
      spawnProcess: () =>
        fakeChild({
          exitCode: 1,
          stderr: 'connect ECONNREFUSED 127.0.0.1:5433',
        }),
    }),
    /test database may be down or unmigrated/,
  );

  await assert.rejects(
    runBackendHarness({
      repoRoot,
      runPlan,
      spawnProcess: () => fakeChild(),
    }),
    /did not write output JSON/,
  );

  await assert.rejects(
    runBackendHarness({
      repoRoot,
      runPlan,
      spawnProcess(_command, args) {
        const outputPath = args[args.indexOf('--output') + 1];
        return fakeChild({
          writeOutput: () =>
            writeFile(
              outputPath,
              jsonText({
                response: { status: 'failed' },
                filledPdfFields: {},
              }),
            ),
        });
      },
    }),
    /Form-fill response status was failed/,
  );
});

async function copyRepo(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'eval-runner-'));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  await mkdir(path.join(root, 'apps/backend/src/config'), { recursive: true });
  await cp(
    path.join(repoRoot, 'examples/eval'),
    path.join(root, 'examples/eval'),
    { recursive: true },
  );
  await cp(
    path.join(repoRoot, 'apps/backend/src/config/preferences.catalog.json'),
    path.join(root, 'apps/backend/src/config/preferences.catalog.json'),
  );
  return root;
}

async function declareFilledFormSnapshot(root) {
  const scenarioPath = path.join(
    root,
    'examples/eval/scenarios/elena-marquez-i9-template-smoke/scenario.json',
  );
  const scenario = JSON.parse(await readFile(scenarioPath, 'utf8'));
  scenario.expectedSnapshots = ['filled-form'];
  await writeFile(scenarioPath, `${JSON.stringify(scenario, null, 2)}\n`);
}

function actionFor(runPlan, pdfFieldName) {
  const action = runPlan.actionPlans.find(
    (candidate) => candidate.pdfFieldName === pdfFieldName,
  );
  assert.ok(action, `Missing action plan for ${pdfFieldName}`);
  return action;
}

function fakeHarnessResult(runPlan) {
  const filledActions = runPlan.actionPlans.filter(
    (plan) => plan.fillAction.action !== 'SKIP',
  );
  const skippedActions = runPlan.actionPlans.filter(
    (plan) => plan.fillAction.action === 'SKIP',
  );
  const filledPdfFields = {};
  for (const plan of filledActions) {
    if (plan.fillAction.action === 'SET_TEXT') {
      filledPdfFields[plan.pdfFieldName] = { value: plan.fillAction.value };
    } else if (plan.fillAction.action === 'SELECT_OPTION') {
      filledPdfFields[plan.pdfFieldName] = {
        selected: [plan.fillAction.value],
      };
    } else if (plan.fillAction.action === 'CHECK') {
      filledPdfFields[plan.pdfFieldName] = { checked: true };
    } else if (plan.fillAction.action === 'UNCHECK') {
      filledPdfFields[plan.pdfFieldName] = { checked: false };
    }
  }

  return {
    response: {
      status: 'partial',
      originalFilename: 'form.pdf',
      outputFilename: 'filled-form.pdf',
      outputMimeType: 'application/pdf',
      filledPdfBase64: 'omitted-in-tests',
      summary: {
        totalFields: runPlan.actionPlans.length,
        filledCount: filledActions.length,
        skippedCount: skippedActions.length,
        filledFields: filledActions.map((plan) => ({
          pdfFieldName: plan.pdfFieldName,
          fieldType: plan.fieldType,
          sourceSlugs: plan.fillAction.sourceSlugs,
          confidence: plan.fillAction.confidence,
        })),
        skippedFields: skippedActions.map((plan) => ({
          pdfFieldName: plan.pdfFieldName,
          fieldType: plan.fieldType,
          reason: plan.fillAction.skipReason,
          sourceSlugs: plan.fillAction.sourceSlugs,
          confidence: plan.fillAction.confidence,
        })),
        warnings: [],
      },
    },
    filledPdfFields,
  };
}

function fakeChild({
  exitCode = 0,
  stdout = '',
  stderr = '',
  writeOutput = null,
} = {}) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();

  process.nextTick(async () => {
    if (stdout) child.stdout.emit('data', Buffer.from(stdout));
    if (stderr) child.stderr.emit('data', Buffer.from(stderr));
    if (writeOutput) await writeOutput();
    child.emit('close', exitCode);
  });

  return child;
}
