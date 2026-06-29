import { readJson, validateWithSchema, writeJson } from './io.mjs';
import { formFactsByFactKey } from './form.mjs';
import { unique } from './slugs.mjs';
import { collectOpenSchemaReportFactKeys } from './open-schema-database.mjs';

export async function scoreOpenSchemaCombinedToFile({
  repoRoot,
  openSchemaDatabaseReportPath,
  formReportPath,
  outPath,
}) {
  const report = await scoreOpenSchemaCombined({
    repoRoot,
    openSchemaDatabaseReportPath,
    formReportPath,
  });
  await validateWithSchema(
    repoRoot,
    'open-schema-combined-score-report.schema.json',
    report,
    'open-schema combined score report',
  );
  await writeJson(outPath, report);
  return report;
}

export async function scoreOpenSchemaCombined({
  repoRoot,
  openSchemaDatabaseReportPath,
  formReportPath,
}) {
  const [databaseReport, formReport] = await Promise.all([
    readJson(openSchemaDatabaseReportPath),
    readJson(formReportPath),
  ]);
  await validateWithSchema(
    repoRoot,
    'open-schema-database-score-report.schema.json',
    databaseReport,
    'open-schema database score report',
  );
  await validateWithSchema(
    repoRoot,
    'form-fill-score-report.schema.json',
    formReport,
    'form fill score report',
  );

  if (databaseReport.userId !== formReport.userId) {
    throw new Error('open-schema database and form reports use different userId values');
  }
  if (databaseReport.corpusId !== formReport.corpusId) {
    throw new Error('open-schema database and form reports use different corpusId values');
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
    ...collectOpenSchemaReportFactKeys(databaseReport),
    ...formByFactKey.keys(),
  ]).sort();

  const facts = factKeys.map((factKey) => {
    const memory = databaseByFactKey.get(factKey) ?? null;
    const formFields = formByFactKey.get(factKey) ?? [];
    const memoryClass = memory?.classification ?? 'open_storage_not_scored';
    const memoryStatus = summarizeMemoryStatus(memory);
    const formStatus = summarizeFormStatus(formFields);
    return {
      factKey,
      expectedValue: memory?.expectedValue ?? memory?.withheldValue ?? null,
      memory: memory
        ? {
            classification: memory.classification,
            valuePresenceClassification:
              memory.valuePresenceClassification ?? null,
            matchingSlug: firstMatchingSlug(memory),
            valueRecoveredInActiveMemory: Boolean(memory.valueRecoveredInActiveMemory),
            valuePresentInActiveMemory: Boolean(memory.valuePresentInActiveMemory),
            presentAsCompositeOrAlias: Boolean(memory.presentAsCompositeOrAlias),
            suggestionOnly: Boolean(memory.suggestionOnly),
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
      memoryClass,
      memoryStatus,
      formStatus,
      stageAttribution: stageAttribution({ memoryStatus, formStatus }),
    };
  });

  return {
    schemaVersion: 1,
    scoreType: 'open-schema-combined',
    userId: databaseReport.userId,
    corpusId: databaseReport.corpusId,
    scenarioId: formReport.scenarioId,
    formId: formReport.formId,
    summary: buildOpenCombinedSummary(facts),
    facts,
  };
}

function summarizeMemoryStatus(memory) {
  const memoryClass = memory?.classification ?? 'open_storage_not_scored';
  if (
    memoryClass === 'open_known_present_recovered_accepted_slug' ||
    memoryClass === 'open_known_present_recovered_novel_slug'
  ) {
    return 'recovered';
  }
  if (memory?.valuePresenceClassification === 'present_as_composite_or_alias') {
    return 'present_as_composite_or_alias';
  }
  if (memoryClass === 'open_known_present_suggestion_only') return 'suggestion_only';
  if (memoryClass === 'open_known_present_wrong_value') return 'wrong_value';
  if (memoryClass === 'open_known_present_missing') return 'missing';
  if (memoryClass === 'open_missing_absent_correct') return 'missing_absent';
  if (memoryClass.startsWith('open_missing_active_')) return 'missing_hallucinated';
  return 'not_scored';
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

function stageAttribution({ memoryStatus, formStatus }) {
  if (memoryStatus === 'missing_absent') {
    return `open_missing_absent_form_${formStatus}`;
  }
  if (memoryStatus === 'missing_hallucinated') {
    return `open_missing_hallucinated_form_${formStatus}`;
  }
  return `open_memory_${memoryStatus}_form_${formStatus}`;
}

function firstMatchingSlug(memory) {
  return (
    memory.matchingAcceptedRows?.[0]?.slug ??
    memory.matchingNovelRows?.[0]?.slug ??
    memory.matchingActiveRows?.[0]?.slug ??
    memory.compositeOrAliasActiveRows?.[0]?.slug ??
    memory.activeValueRows?.[0]?.slug ??
    memory.activeAcceptedSlugRows?.[0]?.slug ??
    memory.matchingSuggestionRows?.[0]?.slug ??
    memory.suggestionValueRows?.[0]?.slug ??
    memory.acceptedWrongRows?.[0]?.slug ??
    null
  );
}

function buildOpenCombinedSummary(facts) {
  const stageAttributionCounts = {};
  const memoryStatusCounts = {};
  const formStatusCounts = {};
  for (const fact of facts) {
    stageAttributionCounts[fact.stageAttribution] =
      (stageAttributionCounts[fact.stageAttribution] ?? 0) + 1;
    memoryStatusCounts[fact.memoryStatus] =
      (memoryStatusCounts[fact.memoryStatus] ?? 0) + 1;
    formStatusCounts[fact.formStatus] =
      (formStatusCounts[fact.formStatus] ?? 0) + 1;
  }
  return {
    factTotal: facts.length,
    stageAttributionCounts,
    memoryStatusCounts,
    formStatusCounts,
    formCorrectWithRecoveredMemory: facts.filter(
      (fact) => fact.memoryStatus === 'recovered' && fact.formStatus === 'correct',
    ).length,
    formCorrectWithoutRecoveredMemory: facts.filter(
      (fact) => fact.memoryStatus !== 'recovered' && fact.formStatus === 'correct',
    ).length,
  };
}
