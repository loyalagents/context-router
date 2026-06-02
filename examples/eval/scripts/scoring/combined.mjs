import { readJson, validateWithSchema, writeJson } from './io.mjs';
import { collectReportFactKeys } from './database.mjs';
import { formFactsByFactKey } from './form.mjs';
import { unique } from './slugs.mjs';

export async function scoreCombinedToFile({
  repoRoot,
  databaseReportPath,
  formReportPath,
  outPath,
}) {
  const report = await scoreCombined({
    repoRoot,
    databaseReportPath,
    formReportPath,
  });
  await validateWithSchema(
    repoRoot,
    'combined-score-report.schema.json',
    report,
    'combined score report',
  );
  await writeJson(outPath, report);
  return report;
}

export async function scoreCombined({
  repoRoot,
  databaseReportPath,
  formReportPath,
}) {
  const [databaseReport, formReport] = await Promise.all([
    readJson(databaseReportPath),
    readJson(formReportPath),
  ]);
  await validateWithSchema(
    repoRoot,
    'database-score-report.schema.json',
    databaseReport,
    'database score report',
  );
  await validateWithSchema(
    repoRoot,
    'form-fill-score-report.schema.json',
    formReport,
    'form fill score report',
  );

  if (databaseReport.userId !== formReport.userId) {
    throw new Error('database and form reports use different userId values');
  }
  if (databaseReport.corpusId !== formReport.corpusId) {
    throw new Error('database and form reports use different corpusId values');
  }

  const formByFactKey = formFactsByFactKey(formReport);
  const databaseByFactKey = new Map([
    ...(databaseReport.knownPresent ?? []).map((row) => [row.factKey, row]),
    ...(databaseReport.intentionallyMissing ?? []).map((row) => [
      row.factKey,
      row,
    ]),
  ]);
  const factKeys = unique([
    ...collectReportFactKeys(databaseReport),
    ...formByFactKey.keys(),
  ]).sort();

  const facts = factKeys.map((factKey) => {
    const storage = databaseByFactKey.get(factKey) ?? null;
    const formFields = formByFactKey.get(factKey) ?? [];
    const storageClass = storage?.classification ?? 'storage_not_scored';
    const formStatus = summarizeFormStatus(formFields);
    return {
      factKey,
      expectedValue: storage?.expectedValue ?? storage?.withheldValue ?? null,
      storage: storage
        ? {
            classification: storage.classification,
            matchingSlug: firstMatchingSlug(storage),
          }
        : null,
      form: {
        fields: formFields.map((field) => ({
          fieldIndex: field.fieldIndex,
          pdfFieldName: field.pdfFieldName,
          classification: field.classification,
          renderedValue: field.actualValue,
        })),
      },
      storageClass,
      formStatus,
      stageAttribution: stageAttribution({ storageClass, formStatus }),
    };
  });

  return {
    schemaVersion: 1,
    scoreType: 'combined',
    userId: databaseReport.userId,
    corpusId: databaseReport.corpusId,
    scenarioId: formReport.scenarioId,
    formId: formReport.formId,
    summary: buildCombinedSummary(facts),
    facts,
  };
}

function firstMatchingSlug(storage) {
  return (
    storage.matchingRows?.[0]?.slug ??
    storage.acceptedSlugRows?.[0]?.slug ??
    storage.valueRows?.[0]?.slug ??
    null
  );
}

function stageAttribution({ storageClass, formStatus }) {
  if (storageClass === 'known_present_correct') {
    if (formStatus === 'correct') return 'stored_correct_form_correct';
    if (formStatus === 'wrong') return 'stored_correct_form_wrong';
    if (formStatus === 'missing') return 'stored_correct_form_missing';
    return 'stored_correct_form_not_scored';
  }
  if (storageClass === 'known_present_conflict') {
    if (formStatus === 'correct') return 'stored_conflict_form_correct';
    if (formStatus === 'wrong') return 'stored_conflict_form_wrong';
    if (formStatus === 'missing') return 'stored_conflict_form_missing';
    return 'stored_conflict_form_not_scored';
  }
  if (storageClass === 'known_present_wrong_slug') {
    if (formStatus === 'missing') return 'stored_wrong_slug_form_missing';
    if (formStatus === 'correct') return 'stored_wrong_slug_form_correct';
    return 'stored_wrong_slug_form_other';
  }
  if (storageClass === 'known_present_wrong_value') {
    if (formStatus === 'correct') return 'stored_wrong_value_form_correct';
    if (formStatus === 'wrong') return 'stored_wrong_value_form_wrong';
    if (formStatus === 'missing') return 'stored_wrong_value_form_missing';
    return 'stored_wrong_value_form_other';
  }
  if (storageClass === 'known_present_missing') {
    if (formStatus === 'hallucinated') return 'stored_missing_form_hallucinated';
    if (formStatus === 'missing') return 'stored_missing_form_missing';
    if (formStatus === 'correct') return 'stored_missing_form_correct';
    return 'stored_missing_form_other';
  }
  if (storageClass.startsWith('missing_')) {
    const storageAbsent = storageClass === 'missing_absent_correct';
    if (storageAbsent && formStatus === 'absent') return 'missing_absent_form_absent';
    if (!storageAbsent && formStatus === 'hallucinated') {
      return 'missing_hallucinated_form_hallucinated';
    }
    if (!storageAbsent) return 'missing_hallucinated_form_other';
    return 'missing_absent_form_other';
  }
  return 'other';
}

function summarizeFormStatus(fields) {
  if (fields.length === 0) return 'none';
  if (fields.some((field) => field.classification === 'form_known_wrong')) {
    return 'wrong';
  }
  if (fields.some((field) => field.classification === 'form_known_missing')) {
    return 'missing';
  }
  if (fields.some((field) => field.classification === 'form_known_correct')) {
    return 'correct';
  }
  if (fields.some((field) => field.classification === 'form_missing_hallucinated')) {
    return 'hallucinated';
  }
  if (fields.every((field) => field.classification === 'form_missing_absent_correct')) {
    return 'absent';
  }
  return 'other';
}

function buildCombinedSummary(facts) {
  const counts = {};
  for (const fact of facts) {
    counts[fact.stageAttribution] = (counts[fact.stageAttribution] ?? 0) + 1;
  }
  return {
    factTotal: facts.length,
    stageAttributionCounts: counts,
  };
}
