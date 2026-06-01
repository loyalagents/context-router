import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
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

  assert.equal(report.summary.knownFieldTotal, 12);
  assert.equal(report.summary.knownFieldCorrect, 12);
  assert.equal(report.summary.abstentionFieldTotal, 6);
  assert.equal(report.summary.abstentionFieldAbsentCorrect, 6);
  assert.equal(report.summary.structuralSkipCount, 30);
  assert.equal(report.summary.unsupportedFieldCount, 0);
  assert.equal(report.summary.sourceSlugAgreementRate, 1);
  await validateWithSchema(
    repoRoot,
    'form-fill-score-report.schema.json',
    report,
    'form fill score report',
  );
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
  assert.equal(report.summary.unsupportedFieldCount, 1);
  assert.ok(report.summary.sourceSlugAgreementRate < 1);
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
