import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildRunPlan } from '../eval-runner/actions.mjs';
import { loadScenarioFixture } from '../eval-runner/fixtures.mjs';
import { buildFilledFormSnapshot } from '../eval-runner/snapshots.mjs';
import { scoreForm } from './form.mjs';
import { validateWithSchema } from './io.mjs';
import { jsonText } from '../shared.mjs';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), '../../../..');

test('form scorer aggregates existing filled-form snapshot classifications', async () => {
  const sourcePath = path.join(
    repoRoot,
    'examples/eval/scenarios/elena-marquez-i9-template-smoke/expected/filled-form.json',
  );
  const report = await scoreForm({
    repoRoot,
    scenarioId: 'elena-marquez-i9-template-smoke',
    filledFormPath: sourcePath,
  });

  assert.equal(report.summary.knownFieldTotal, 13);
  assert.equal(report.summary.knownFieldCorrect, 13);
  assert.equal(report.summary.abstentionFieldTotal, 1);
  assert.equal(report.summary.abstentionFieldAbsentCorrect, 1);
  assert.equal(report.summary.structuralSkipCount, 34);
  assert.equal(report.summary.structuralOverfillCount, 0);
  assert.equal(report.summary.unsupportedFieldCount, 0);
  assert.equal(report.summary.sourceSlugAgreementRate, 1);

  const citizenshipCheckbox = report.fields.find(
    (field) => field.pdfFieldName === 'CB_1',
  );
  assert.equal(citizenshipCheckbox.expectedAction, 'CHECK');
  assert.equal(citizenshipCheckbox.expectedValue, true);
  assert.equal(citizenshipCheckbox.actualValue, true);

  await validateWithSchema(
    repoRoot,
    'form-fill-score-report.schema.json',
    report,
    'form fill score report',
  );
});

test('form scorer treats inactive conditional fields as structural skips', async () => {
  const snapshot = JSON.parse(
    await readFile(
      path.join(
        repoRoot,
        'examples/eval/scenarios/elena-marquez-i9-template-smoke/expected/filled-form.json',
      ),
      'utf8',
    ),
  );
  const inactive = snapshot.fields.find(
    (field) =>
      field.pdfFieldName === '3 A lawful permanent resident Enter USCIS or ANumber',
  );
  inactive.expected.action = 'SKIP';
  inactive.expected.skipKind = 'conditional-inactive';
  inactive.classification = 'skipped-correctly';

  const tmp = await mkdtemp(path.join(os.tmpdir(), 'score-form-conditional-'));
  const filledFormPath = path.join(tmp, 'filled-form.json');
  await writeFile(filledFormPath, jsonText(snapshot));

  const report = await scoreForm({
    repoRoot,
    scenarioId: 'elena-marquez-i9-template-smoke',
    filledFormPath,
  });
  const row = report.fields.find(
    (field) =>
      field.pdfFieldName === '3 A lawful permanent resident Enter USCIS or ANumber',
  );
  assert.equal(row.fieldClass, 'structural-skip');
  assert.equal(row.classification, 'structural_skip');
});

test('form scorer accepts live citizenship source slug aliases', async () => {
  const snapshot = JSON.parse(
    await readFile(
      path.join(
        repoRoot,
        'examples/eval/scenarios/elena-marquez-i9-template-smoke/expected/filled-form.json',
      ),
      'utf8',
    ),
  );
  const citizenshipCheckbox = snapshot.fields.find(
    (field) => field.pdfFieldName === 'CB_1',
  );
  citizenshipCheckbox.actual.sourceSlugs = ['profile.citizenship_status'];

  const tmp = await mkdtemp(path.join(os.tmpdir(), 'score-form-citizenship-'));
  const filledFormPath = path.join(tmp, 'filled-form.json');
  await writeFile(filledFormPath, jsonText(snapshot));

  const report = await scoreForm({
    repoRoot,
    scenarioId: 'elena-marquez-i9-template-smoke',
    filledFormPath,
  });
  const row = report.fields.find((field) => field.pdfFieldName === 'CB_1');
  assert.equal(row.sourceSlugAgrees, true);
});

test('form scorer reports missing, wrong, hallucinated, unsupported, and source-slug disagreement', async () => {
  const snapshot = JSON.parse(
    await readFile(
      path.join(
        repoRoot,
        'examples/eval/scenarios/elena-marquez-i9-template-smoke/expected/filled-form.json',
      ),
      'utf8',
    ),
  );
  snapshot.fields.find((field) => field.fieldMap.factKey === 'identity.firstName').classification = 'missing';
  snapshot.fields.find(
    (field) => field.fieldMap.factKey === 'identity.middleInitial',
  ).actual.sourceSlugs = ['identity.unexpected_middle_initial'];
  const lastName = snapshot.fields.find(
    (field) => field.fieldMap.factKey === 'identity.lastName',
  );
  lastName.classification = 'incorrect';
  lastName.actual.sourceSlugs = ['identity.last_name'];
  const phone = snapshot.fields.find(
    (field) => field.fieldMap.factKey === 'contact.phone',
  );
  phone.classification = 'hallucinated';
  phone.actual.filled = true;
  const signature = snapshot.fields.find(
    (field) => field.fieldMap.reason === 'manual_attestation',
  );
  signature.classification = 'unsupported';
  const outOfScope = snapshot.fields.find(
    (field) => field.fieldMap.reason === 'out_of_scope',
  );
  outOfScope.classification = 'hallucinated';
  outOfScope.actual.filled = true;
  outOfScope.actual.value = 'Employer-filled value';
  outOfScope.actual.sourceSlugs = ['doc:test'];

  const tmp = await mkdtemp(path.join(os.tmpdir(), 'score-form-'));
  const filledFormPath = path.join(tmp, 'filled-form.json');
  await writeFile(filledFormPath, jsonText(snapshot));

  const report = await scoreForm({
    repoRoot,
    scenarioId: 'elena-marquez-i9-template-smoke',
    filledFormPath,
  });

  assert.equal(report.summary.knownFieldMissing, 1);
  assert.equal(report.summary.knownFieldWrong, 1);
  assert.equal(report.summary.abstentionFieldHallucinated, 1);
  assert.equal(report.summary.structuralOverfillCount, 1);
  assert.equal(report.summary.outOfScopeOverfillCount, 1);
  assert.equal(report.summary.manualAttestationOverfillCount, 0);
  assert.equal(report.summary.unmappedOverfillCount, 0);
  assert.equal(report.summary.unsupportedFieldCount, 1);
  assert.ok(report.summary.sourceSlugAgreementRate < 1);

  const overfilled = report.fields.find(
    (field) => field.pdfFieldName === outOfScope.pdfFieldName,
  );
  assert.equal(overfilled.classification, 'structural_overfilled');
  assert.equal(overfilled.overfill, true);
  assert.equal(overfilled.overfillSeverity, 'high');
  assert.equal(overfilled.overfillReason, 'out_of_scope');

  const skippedSignature = report.fields.find(
    (field) => field.pdfFieldName === signature.pdfFieldName,
  );
  assert.equal(skippedSignature.overfill, false);
  assert.equal(skippedSignature.overfillSeverity, null);

  await validateWithSchema(
    repoRoot,
    'form-fill-score-report.schema.json',
    report,
    'form fill score report',
  );
});

test('form scorer counts safe case-only render variants as correct diagnostics', async () => {
  const snapshot = JSON.parse(
    await readFile(
      path.join(
        repoRoot,
        'examples/eval/scenarios/elena-marquez-i9-template-smoke/expected/filled-form.json',
      ),
      'utf8',
    ),
  );
  const unit = snapshot.fields.find(
    (field) => field.fieldMap.factKey === 'address.current.unit',
  );
  unit.classification = 'incorrect';
  unit.actual.value = 'APT 12B';
  const city = snapshot.fields.find(
    (field) => field.fieldMap.factKey === 'address.current.city',
  );
  city.classification = 'incorrect';
  city.actual.value = 'SACRAMENTO';
  const email = snapshot.fields.find((field) => field.fieldMap.factKey === 'contact.email');
  email.classification = 'incorrect';
  email.actual.value = 'ELENA.MARQUEZ@EXAMPLE.TEST';

  const tmp = await mkdtemp(path.join(os.tmpdir(), 'score-form-case-variant-'));
  const filledFormPath = path.join(tmp, 'filled-form.json');
  await writeFile(filledFormPath, jsonText(snapshot));

  const report = await scoreForm({
    repoRoot,
    scenarioId: 'elena-marquez-i9-template-smoke',
    filledFormPath,
  });

  assert.equal(report.summary.knownFieldCorrect, 12);
  assert.equal(report.summary.knownFieldWrong, 1);
  for (const factKey of ['address.current.unit', 'address.current.city']) {
    const row = report.fields.find((field) => field.factKey === factKey);
    assert.equal(row.classification, 'form_known_correct');
    assert.equal(row.exactTextMatch, false);
    assert.equal(row.renderVariant, 'case_only');
  }
  const emailRow = report.fields.find((field) => field.factKey === 'contact.email');
  assert.equal(emailRow.classification, 'form_known_wrong');
  assert.equal(emailRow.exactTextMatch, false);
  assert.equal(emailRow.renderVariant, null);

  await validateWithSchema(
    repoRoot,
    'form-fill-score-report.schema.json',
    report,
    'form fill score report',
  );
});

test('form scorer counts street-line comma before unit as a safe render variant', async () => {
  const snapshot = JSON.parse(
    await readFile(
      path.join(
        repoRoot,
        'examples/eval/scenarios/elena-marquez-i9-template-smoke/expected/filled-form.json',
      ),
      'utf8',
    ),
  );
  const street = snapshot.fields.find(
    (field) => field.fieldMap.factKey === 'address.current.street',
  );
  street.fieldMap.factKey = 'address.current.streetLine';
  street.expected.value = '2846 Ashbury Street Apt 3D';
  street.actual.value = '2846 Ashbury Street, Apt 3D';
  street.classification = 'incorrect';

  const tmp = await mkdtemp(path.join(os.tmpdir(), 'score-form-street-line-variant-'));
  const filledFormPath = path.join(tmp, 'filled-form.json');
  await writeFile(filledFormPath, jsonText(snapshot));

  const report = await scoreForm({
    repoRoot,
    scenarioId: 'elena-marquez-i9-template-smoke',
    filledFormPath,
  });

  const row = report.fields.find((field) => field.factKey === 'address.current.streetLine');
  assert.equal(row.classification, 'form_known_correct');
  assert.equal(row.exactTextMatch, false);
  assert.equal(row.renderVariant, 'street_line_unit_comma');

  await validateWithSchema(
    repoRoot,
    'form-fill-score-report.schema.json',
    report,
    'form fill score report',
  );
});

test('form scorer rejects filled-form snapshots with mismatched fixture identity', async () => {
  const snapshot = JSON.parse(
    await readFile(
      path.join(
        repoRoot,
        'examples/eval/scenarios/elena-marquez-i9-template-smoke/expected/filled-form.json',
      ),
      'utf8',
    ),
  );
  snapshot.corpusId = 'different-corpus';

  const tmp = await mkdtemp(path.join(os.tmpdir(), 'score-form-mismatch-'));
  const filledFormPath = path.join(tmp, 'filled-form.json');
  await writeFile(filledFormPath, jsonText(snapshot));

  await assert.rejects(
    scoreForm({
      repoRoot,
      scenarioId: 'elena-marquez-i9-template-smoke',
      filledFormPath,
    }),
    /filled-form corpusId different-corpus does not match scenario template-smoke/,
  );
});

test('form scorer maps unexpected should-fill snapshot classifications in band', async () => {
  const snapshot = JSON.parse(
    await readFile(
      path.join(
        repoRoot,
        'examples/eval/scenarios/elena-marquez-i9-template-smoke/expected/filled-form.json',
      ),
      'utf8',
    ),
  );
  const firstName = snapshot.fields.find(
    (field) => field.fieldMap.factKey === 'identity.firstName',
  );
  firstName.classification = 'skipped-correctly';

  const tmp = await mkdtemp(path.join(os.tmpdir(), 'score-form-unexpected-'));
  const filledFormPath = path.join(tmp, 'filled-form.json');
  await writeFile(filledFormPath, jsonText(snapshot));

  const report = await scoreForm({
    repoRoot,
    scenarioId: 'elena-marquez-i9-template-smoke',
    filledFormPath,
  });

  assert.equal(
    report.fields.find((field) => field.factKey === 'identity.firstName')
      .classification,
    'form_unexpected',
  );
  await validateWithSchema(
    repoRoot,
    'form-fill-score-report.schema.json',
    report,
    'form fill score report',
  );
});

test('form scorer scores direct-deposit routing and account digit boxes', async () => {
  const fixture = await loadScenarioFixture({
    repoRoot,
    scenarioId: 'maya-chen-newhire-direct-deposit-packet-hard-required-v4',
  });
  const runPlan = buildRunPlan(fixture);
  const harnessResult = fakeHarnessResult(runPlan);
  const missingRoutingField = 'topmostSubform[0].Page1[0].rout1[0]';
  const wrongAccountField = 'topmostSubform[0].Page1[0].acct12[0]';
  delete harnessResult.filledPdfFields[missingRoutingField];
  harnessResult.response.summary.filledFields =
    harnessResult.response.summary.filledFields.filter(
      (field) => field.pdfFieldName !== missingRoutingField,
    );
  harnessResult.response.summary.filledCount -= 1;
  harnessResult.response.summary.skippedCount += 1;
  harnessResult.filledPdfFields[wrongAccountField].value = '0';

  const snapshot = buildFilledFormSnapshot({
    fixture,
    runPlan,
    harnessResult,
  });

  const tmp = await mkdtemp(path.join(os.tmpdir(), 'score-form-direct-deposit-'));
  const filledFormPath = path.join(tmp, 'filled-form.json');
  await writeFile(filledFormPath, jsonText(snapshot));

  const report = await scoreForm({
    repoRoot,
    scenarioId: 'maya-chen-newhire-direct-deposit-packet-hard-required-v4',
    filledFormPath,
  });

  assert.equal(
    report.fields.find(
      (field) => field.pdfFieldName === 'topmostSubform[0].Page1[0].ckdigit[0]',
    ).classification,
    'form_known_correct',
  );
  assert.equal(
    report.fields.find((field) => field.pdfFieldName === missingRoutingField)
      .classification,
    'form_known_missing',
  );
  assert.equal(
    report.fields.find((field) => field.pdfFieldName === wrongAccountField)
      .classification,
    'form_known_wrong',
  );
  assert.equal(
    report.fields.find(
      (field) => field.pdfFieldName === 'topmostSubform[0].Page1[0].acct13[0]',
    ).classification,
    'structural_skip',
  );

  await validateWithSchema(
    repoRoot,
    'form-fill-score-report.schema.json',
    report,
    'form fill score report',
  );
});

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
