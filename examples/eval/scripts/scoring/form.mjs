import path from 'node:path';
import { getFactValue } from '../shared.mjs';
import { loadScenarioFixture } from '../eval-runner/fixtures.mjs';
import { readJson, validateWithSchema, writeJson } from './io.mjs';
import { rate } from './normalize.mjs';
import { storageSpecForFact } from './slugs.mjs';

export async function scoreFormToFile({
  repoRoot,
  scenarioId,
  filledFormPath,
  outPath,
}) {
  const report = await scoreForm({ repoRoot, scenarioId, filledFormPath });
  await validateWithSchema(
    repoRoot,
    'form-fill-score-report.schema.json',
    report,
    'form fill score report',
  );
  await writeJson(outPath, report);
  return report;
}

export async function scoreForm({ repoRoot, scenarioId, filledFormPath }) {
  const fixture = await loadScenarioFixture({ repoRoot, scenarioId });
  const [filledForm, storageMap] = await Promise.all([
    readJson(filledFormPath),
    readJson(path.join(fixture.evalRoot, 'scoring/fact-storage-map.v1.json')),
  ]);
  await validateWithSchema(
    repoRoot,
    'filled-form-snapshot.schema.json',
    filledForm,
    'filled form snapshot',
  );
  if (filledForm.scenarioId !== scenarioId) {
    throw new Error(
      `filled-form scenarioId ${filledForm.scenarioId} does not match ${scenarioId}`,
    );
  }
  for (const key of ['userId', 'corpusId', 'formId']) {
    if (filledForm[key] !== fixture.scenario[key]) {
      throw new Error(
        `filled-form ${key} ${filledForm[key]} does not match scenario ${fixture.scenario[key]}`,
      );
    }
  }

  const fields = filledForm.fields.map((field) =>
    scoreField({ field, fixture, storageMap }),
  );

  return {
    schemaVersion: 1,
    scoreType: 'form-fill',
    scenarioId,
    userId: filledForm.userId,
    corpusId: filledForm.corpusId,
    formId: filledForm.formId,
    summary: buildFormSummary(fields),
    fields,
  };
}

function scoreField({ field, fixture, storageMap }) {
  const factKey = field.fieldMap?.factKey ?? null;
  const fieldClass = classifyFieldDenominator(field);
  const sourceSlugs = field.actual?.sourceSlugs ?? [];
  const expectedValue = field.expected?.value ?? null;
  const actualValue = field.actual?.value ?? null;
  const storage = factKey
    ? storageSpecForFact(factKey, { profile: fixture.profile, storageMap })
    : { acceptedSlugs: [] };
  const sourceSlugAgrees =
    factKey && sourceSlugs.length > 0
      ? sourceSlugs.some((slug) => storage.acceptedSlugs.includes(slug))
      : false;

  return {
    fieldIndex: field.fieldIndex,
    pdfFieldName: field.pdfFieldName,
    factKey,
    fieldClass,
    expectedAction: field.expected?.action ?? null,
    expectedValue,
    actualValue,
    sourceSlugs,
    sourceSlugAgrees,
    snapshotClassification: field.classification,
    classification: mapFormClassification(field, fieldClass),
  };
}

function classifyFieldDenominator(field) {
  if (field.classification === 'unsupported') return 'unsupported';
  if (field.fieldMap?.mode === 'skip') return 'structural-skip';
  if (field.fieldMap?.mode === 'fact' && field.expected?.action === 'SKIP') {
    return 'abstention-test';
  }
  if (field.fieldMap?.mode === 'fact') return 'should-fill';
  return 'structural-skip';
}

function mapFormClassification(field, fieldClass) {
  if (fieldClass === 'unsupported') return 'unsupported';
  if (fieldClass === 'structural-skip') return 'structural_skip';
  if (fieldClass === 'abstention-test') {
    if (field.classification === 'hallucinated') {
      return 'form_missing_hallucinated';
    }
    if (
      field.classification === 'skipped-correctly' ||
      field.classification === 'correct'
    ) {
      return 'form_missing_absent_correct';
    }
    return 'form_unexpected';
  }
  if (field.classification === 'correct') return 'form_known_correct';
  if (field.classification === 'missing') return 'form_known_missing';
  if (field.classification === 'incorrect') return 'form_known_wrong';
  if (field.classification === 'hallucinated') return 'form_known_wrong';
  return 'form_unexpected';
}

function buildFormSummary(fields) {
  const shouldFill = fields.filter((field) => field.fieldClass === 'should-fill');
  const abstention = fields.filter(
    (field) => field.fieldClass === 'abstention-test',
  );
  const structural = fields.filter(
    (field) => field.fieldClass === 'structural-skip',
  );
  const unsupported = fields.filter((field) => field.fieldClass === 'unsupported');
  const knownFieldCorrect = shouldFill.filter(
    (field) => field.classification === 'form_known_correct',
  );
  const sourceSlugAgreementCount = knownFieldCorrect.filter(
    (field) => field.sourceSlugAgrees,
  ).length;

  return {
    knownFieldTotal: shouldFill.length,
    knownFieldCorrect: knownFieldCorrect.length,
    knownFieldMissing: shouldFill.filter(
      (field) => field.classification === 'form_known_missing',
    ).length,
    knownFieldWrong: shouldFill.filter(
      (field) => field.classification === 'form_known_wrong',
    ).length,
    knownFieldAccuracy: rate(knownFieldCorrect.length, shouldFill.length),
    knownFieldMissingRate: rate(
      shouldFill.filter((field) => field.classification === 'form_known_missing')
        .length,
      shouldFill.length,
    ),
    knownFieldWrongRate: rate(
      shouldFill.filter((field) => field.classification === 'form_known_wrong')
        .length,
      shouldFill.length,
    ),
    abstentionFieldTotal: abstention.length,
    abstentionFieldAbsentCorrect: abstention.filter(
      (field) => field.classification === 'form_missing_absent_correct',
    ).length,
    abstentionFieldHallucinated: abstention.filter(
      (field) => field.classification === 'form_missing_hallucinated',
    ).length,
    missingFieldAbstentionRate: rate(
      abstention.filter(
        (field) => field.classification === 'form_missing_absent_correct',
      ).length,
      abstention.length,
    ),
    missingFieldHallucinationRate: rate(
      abstention.filter(
        (field) => field.classification === 'form_missing_hallucinated',
      ).length,
      abstention.length,
    ),
    structuralSkipCount: structural.length,
    unsupportedFieldCount: unsupported.length,
    sourceSlugAgreementRate: rate(
      sourceSlugAgreementCount,
      knownFieldCorrect.length,
    ),
  };
}

export function formFactsByFactKey(formReport) {
  const byFactKey = new Map();
  for (const field of formReport.fields ?? []) {
    if (!field.factKey) continue;
    const existing = byFactKey.get(field.factKey) ?? [];
    existing.push(field);
    byFactKey.set(field.factKey, existing);
  }
  return byFactKey;
}

export function expectedProfileValueForField(profile, field) {
  if (!field.factKey) return null;
  return getFactValue(profile.facts ?? {}, field.factKey) ?? null;
}
