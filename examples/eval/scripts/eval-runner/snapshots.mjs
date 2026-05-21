import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { jsonText } from '../shared.mjs';

export const SNAPSHOT_FILENAMES = {
  'filled-form': 'filled-form.json',
};

const ACTIONS = ['SET_TEXT', 'CHECK', 'UNCHECK', 'SELECT_OPTION', 'SKIP'];

export function buildFilledFormSnapshot({ fixture, runPlan, harnessResult }) {
  const response = harnessResult.response;
  const filledByName = new Map(
    (response.summary?.filledFields ?? []).map((field) => [
      field.pdfFieldName,
      field,
    ]),
  );
  const skippedByName = new Map(
    (response.summary?.skippedFields ?? []).map((field) => [
      field.pdfFieldName,
      field,
    ]),
  );
  const actualByName = new Map(
    Object.entries(harnessResult.filledPdfFields ?? {}),
  );
  const planByName = new Map(
    runPlan.actionPlans.map((plan) => [plan.pdfFieldName, plan]),
  );

  return {
    schemaVersion: 1,
    snapshotType: 'filled-form',
    scenarioId: fixture.scenario.scenarioId,
    userId: fixture.scenario.userId,
    corpusId: fixture.scenario.corpusId,
    formId: fixture.scenario.formId,
    response: {
      status: response.status,
      originalFilename: response.originalFilename,
      outputFilename: response.outputFilename,
      outputMimeType: response.outputMimeType,
    },
    summary: {
      totalFields: response.summary.totalFields,
      filledCount: response.summary.filledCount,
      skippedCount: response.summary.skippedCount,
      actionCounts: countActions(runPlan.fillActions),
      warnings: response.summary.warnings ?? [],
    },
    fields: fixture.joinedFields.map(({ fieldMap, generated }) => {
      const plan = planByName.get(fieldMap.pdfFieldName);
      const actual = actualByName.get(fieldMap.pdfFieldName) ?? {};
      const filledSummary = filledByName.get(fieldMap.pdfFieldName) ?? null;
      const skippedSummary = skippedByName.get(fieldMap.pdfFieldName) ?? null;
      return buildFieldSnapshot({
        fieldMap,
        generated,
        plan,
        actual,
        filledSummary,
        skippedSummary,
      });
    }),
  };
}

export async function compareOrUpdateSnapshots({
  fixture,
  snapshots,
  updateSnapshots,
}) {
  const declared = new Set(fixture.scenario.expectedSnapshots ?? []);
  const supported = Object.keys(snapshots).filter((snapshot) =>
    declared.has(snapshot),
  );

  if (supported.length === 0) {
    return {
      ok: false,
      lines: [
        `Scenario ${fixture.scenario.scenarioId} declares no supported expected snapshots.`,
      ],
      updated: [],
    };
  }

  const lines = [];
  const updated = [];
  let ok = true;

  for (const snapshotType of supported) {
    const filename = SNAPSHOT_FILENAMES[snapshotType];
    const snapshotPath = path.join(fixture.scenarioRoot, 'expected', filename);
    const actualText = jsonText(snapshots[snapshotType]);

    if (updateSnapshots) {
      await mkdir(path.dirname(snapshotPath), { recursive: true });
      await writeFile(snapshotPath, actualText);
      updated.push(snapshotPath);
      lines.push(`updated ${path.relative(fixture.repoRoot, snapshotPath)}`);
      continue;
    }

    let expectedText;
    try {
      expectedText = await readFile(snapshotPath, 'utf8');
    } catch (error) {
      ok = false;
      lines.push(
        `missing expected snapshot ${path.relative(fixture.repoRoot, snapshotPath)}; run with --update-snapshots`,
      );
      continue;
    }

    if (expectedText !== actualText) {
      ok = false;
      lines.push(
        `snapshot mismatch ${path.relative(fixture.repoRoot, snapshotPath)}`,
      );
      lines.push(...compactDiff(expectedText, actualText));
    } else {
      lines.push(`matched ${path.relative(fixture.repoRoot, snapshotPath)}`);
    }
  }

  return { ok, lines, updated };
}

function buildFieldSnapshot({
  fieldMap,
  generated,
  plan,
  actual,
  filledSummary,
  skippedSummary,
}) {
  const expected = expectedFromPlan(plan);
  return {
    fieldIndex: fieldMap.fieldIndex,
    pdfFieldName: fieldMap.pdfFieldName,
    fieldType: generated.type,
    generated: {
      inferredLabel: generated.inferredLabel,
      inferredDataKey: generated.inferredDataKey,
      optionSetId: generated.optionSetId,
      optionCount: generated.optionCount,
    },
    fieldMap: fieldMap.mode === 'fact'
      ? {
          mode: fieldMap.mode,
          factKey: fieldMap.factKey,
          note: fieldMap.note,
        }
      : {
          mode: fieldMap.mode,
          reason: fieldMap.reason,
          note: fieldMap.note,
        },
    expected,
    actual: {
      value: actual.value ?? null,
      selected: actual.selected ?? [],
      checked: actual.checked ?? null,
      filled: Boolean(filledSummary),
      skippedReason: skippedSummary?.reason ?? null,
      sourceSlugs:
        filledSummary?.sourceSlugs ?? skippedSummary?.sourceSlugs ?? [],
      confidence: filledSummary?.confidence ?? skippedSummary?.confidence ?? null,
    },
    classification: classifyField({ expected, actual, filledSummary }),
  };
}

function expectedFromPlan(plan) {
  const action = plan.fillAction;
  return {
    action: action.action,
    value: action.value ?? null,
    sourceSlugs: action.sourceSlugs ?? [],
    confidence: action.confidence ?? null,
    skipReason: action.skipReason ?? null,
  };
}

function classifyField({ expected, actual, filledSummary }) {
  if (expected.action === 'SKIP') {
    return filledSummary ? 'hallucinated' : 'skipped-correctly';
  }
  if (!filledSummary) return 'missing';

  if (expected.action === 'SET_TEXT') {
    return actual.value === expected.value ? 'correct' : 'incorrect';
  }
  if (expected.action === 'SELECT_OPTION') {
    return actual.selected.length === 1 && actual.selected[0] === expected.value
      ? 'correct'
      : 'incorrect';
  }
  if (expected.action === 'CHECK') {
    return actual.checked === true ? 'correct' : 'incorrect';
  }
  if (expected.action === 'UNCHECK') {
    return actual.checked === false ? 'correct' : 'incorrect';
  }
  return 'unsupported';
}

function countActions(actions) {
  const counts = Object.fromEntries(ACTIONS.map((action) => [action, 0]));
  for (const action of actions) {
    counts[action.action] += 1;
  }
  return counts;
}

function compactDiff(expectedText, actualText) {
  const expectedLines = expectedText.split('\n');
  const actualLines = actualText.split('\n');
  const max = Math.max(expectedLines.length, actualLines.length);
  let first = 0;
  while (first < max && expectedLines[first] === actualLines[first]) first += 1;
  const start = Math.max(0, first - 2);
  const end = Math.min(max, first + 6);
  const lines = [`first difference at line ${first + 1}:`];
  for (let index = start; index < end; index += 1) {
    if (expectedLines[index] !== actualLines[index]) {
      lines.push(`- ${expectedLines[index] ?? ''}`);
      lines.push(`+ ${actualLines[index] ?? ''}`);
    } else {
      lines.push(`  ${expectedLines[index] ?? ''}`);
    }
  }
  return lines;
}
