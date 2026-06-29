#!/usr/bin/env node

import { access, mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson, relativePath } from './scoring/io.mjs';
import { jsonText } from './shared.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultRepoRoot = path.resolve(__dirname, '../../..');

const FORM_ISSUE_CLASSES = new Set([
  'form_known_missing',
  'form_known_wrong',
  'form_missing_hallucinated',
  'form_unexpected',
]);

const CLEAN_OWNERSHIP_CLASSES = new Set(['clean', 'allowed_scoped']);

const OPEN_MEMORY_RECOVERED_PREFIX = 'open_known_present_recovered';

export async function runComparePacketRuns({
  repoRoot = defaultRepoRoot,
  args = [],
} = {}) {
  const parsed = parseArgs(args);
  if (parsed.kind === 'help') {
    return { exitCode: 0, lines: [usage()] };
  }
  if (parsed.kind === 'usage-error') {
    return { exitCode: 2, lines: [parsed.message, '', usage()] };
  }

  try {
    const runs = [];
    for (const [index, root] of parsed.options.artifactRoots.entries()) {
      runs.push(
        await loadPacketRun({
          repoRoot,
          root,
          label: `run ${index + 1}`,
          index,
        }),
      );
    }

    const report = buildReport({
      repoRoot,
      runs,
      showPassed: parsed.options.showPassed,
    });
    const outputText =
      parsed.options.format === 'json'
        ? jsonText(report)
        : formatMarkdownReport(report);

    if (parsed.options.output) {
      const outputPath = path.resolve(repoRoot, parsed.options.output);
      await mkdir(path.dirname(outputPath), { recursive: true });
      await writeFile(outputPath, outputText);
      return {
        exitCode: 0,
        lines: [
          'eval compare-packet-runs passed',
          `runs=${runs.length}`,
          `output=${displayPath(repoRoot, outputPath)}`,
        ],
        report,
        outputText,
      };
    }

    return {
      exitCode: 0,
      lines: [outputText.trimEnd()],
      report,
      outputText,
    };
  } catch (error) {
    return {
      exitCode: 1,
      lines: [
        'eval compare-packet-runs failed',
        '',
        error?.stack ?? error?.message ?? String(error),
      ],
      error,
    };
  }
}

export function parseArgs(args) {
  if (args.includes('--help') || args.includes('-h')) {
    return { kind: 'help' };
  }

  const options = {
    artifactRoots: [],
    format: 'markdown',
    output: null,
    showPassed: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--format') {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) {
        return { kind: 'usage-error', message: 'Missing value for --format' };
      }
      if (!['markdown', 'json'].includes(value)) {
        return {
          kind: 'usage-error',
          message: '--format must be markdown or json',
        };
      }
      options.format = value;
      index += 1;
      continue;
    }
    if (arg === '--output') {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) {
        return { kind: 'usage-error', message: 'Missing value for --output' };
      }
      options.output = value;
      index += 1;
      continue;
    }
    if (arg === '--show-passed') {
      options.showPassed = true;
      continue;
    }
    if (arg.startsWith('--')) {
      return { kind: 'usage-error', message: `Unsupported argument: ${arg}` };
    }
    options.artifactRoots.push(arg);
  }

  if (options.artifactRoots.length === 0) {
    return {
      kind: 'usage-error',
      message: 'Missing at least one artifact root',
    };
  }
  return { kind: 'ok', options };
}

export function usage() {
  return [
    'Usage:',
    '  pnpm eval:compare-packet-runs <artifact-root...> [--format markdown|json] [--output <path>] [--show-passed]',
    '',
    'Notes:',
    '  Compares open-schema packet eval artifact roots.',
    '  Direct packet roots require synthetic-memory-snapshot.json.',
    '  MCP packet roots require memory-snapshot.json.',
    '  Required files: packet-evaluation-run.json and open-schema-database-score-report.json.',
    '  Per-scenario form-score-report.json and open-schema-combined-score-report.json are read when present.',
  ].join('\n');
}

export function formatComparePacketRunsResult(result) {
  return result.lines.join('\n');
}

async function loadPacketRun({ repoRoot, root, label, index }) {
  const artifactRoot = path.resolve(repoRoot, root);
  const packetRunPath = path.join(artifactRoot, 'packet-evaluation-run.json');
  const databaseReportPath = path.join(
    artifactRoot,
    'open-schema-database-score-report.json',
  );
  const packetRun = await readRequiredJson(packetRunPath, label);
  const databaseReport = await readRequiredJson(databaseReportPath, label);
  const directMemoryPath = path.join(artifactRoot, 'synthetic-memory-snapshot.json');
  const mcpMemoryPath = path.join(artifactRoot, 'memory-snapshot.json');
  const hasDirectMemory = await pathExists(directMemoryPath);
  const hasMcpMemory = await pathExists(mcpMemoryPath);

  if (!hasDirectMemory && !hasMcpMemory) {
    throw new Error(
      `${label} is missing required memory snapshot: expected synthetic-memory-snapshot.json or memory-snapshot.json in ${artifactRoot}`,
    );
  }

  const runType = hasDirectMemory ? 'direct' : 'mcp';
  const memorySnapshotPath = hasDirectMemory ? directMemoryPath : mcpMemoryPath;
  const memorySnapshot = await readJson(memorySnapshotPath);
  const extractionPath = path.join(artifactRoot, 'open-schema-extraction.json');
  const validationReportPath = path.join(artifactRoot, 'validation-report.json');
  const extraction = await readOptionalJson(extractionPath);
  const validationReport = await readOptionalJson(validationReportPath);
  const scenarios = await loadScenarios({ artifactRoot, runType, label });

  const run = {
    index,
    label,
    artifactRoot,
    displayRoot: displayPath(repoRoot, artifactRoot),
    runType,
    runId: packetRun.runId ?? '<unknown-run>',
    status: packetRun.status ?? '<unknown-status>',
    userId: packetRun.userId ?? databaseReport.userId ?? '<unknown-user>',
    corpusId: packetRun.corpusId ?? databaseReport.corpusId ?? '<unknown-corpus>',
    modelOrAgent: modelOrAgent(packetRun),
    packetRun,
    databaseReport,
    memorySnapshot,
    extraction,
    validationReport,
    scenarios,
    paths: {
      packetRun: packetRunPath,
      databaseReport: databaseReportPath,
      memorySnapshot: memorySnapshotPath,
      extraction: (await pathExists(extractionPath)) ? extractionPath : null,
      validationReport: (await pathExists(validationReportPath))
        ? validationReportPath
        : null,
    },
  };

  run.summary = summarizeRun(run);
  run.memoryPassed = collectPassedMemoryFacts(run);
  run.memoryIssues = collectMemoryIssues(run);
  run.ownershipIssues = collectOwnershipIssues(run);
  run.formPassed = collectPassedFormFields(run);
  run.formIssues = collectFormIssues(run);
  run.documentWarnings = collectDocumentWarnings(run);
  return run;
}

async function loadScenarios({ artifactRoot, runType, label }) {
  const scenariosRoot = path.join(artifactRoot, 'scenarios');
  if (!(await pathExists(scenariosRoot))) return [];

  const entries = await readdir(scenariosRoot);
  const scenarios = [];
  for (const entry of entries.sort()) {
    const scenarioDir = path.join(scenariosRoot, entry);
    const scenarioStat = await stat(scenarioDir);
    if (!scenarioStat.isDirectory()) continue;

    const formScorePath = path.join(scenarioDir, 'form-score-report.json');
    const combinedScorePath = path.join(
      scenarioDir,
      'open-schema-combined-score-report.json',
    );
    const directFillPath = path.join(
      scenarioDir,
      'direct-open-schema-fill-response.json',
    );
    const mcpFillPath = path.join(scenarioDir, 'form-fill-response.json');
    const filledFormPath = path.join(scenarioDir, 'filled-form.json');

    const formScoreReport = await readOptionalJson(formScorePath);
    const combinedScoreReport = await readOptionalJson(combinedScorePath);
    const fillResponse = await readOptionalJson(
      runType === 'direct' ? directFillPath : mcpFillPath,
    );
    const filledForm = await readOptionalJson(filledFormPath);

    if (!formScoreReport && !combinedScoreReport && !fillResponse && !filledForm) {
      continue;
    }

    scenarios.push({
      scenarioId:
        formScoreReport?.scenarioId ??
        combinedScoreReport?.scenarioId ??
        fillResponse?.scenarioId ??
        filledForm?.scenarioId ??
        entry,
      scenarioDir,
      displayDir: scenarioDir,
      formScoreReport,
      combinedScoreReport,
      fillResponse,
      filledForm,
      fillActions: extractFillActions(fillResponse),
      paths: {
        formScoreReport: formScoreReport ? formScorePath : null,
        combinedScoreReport: combinedScoreReport ? combinedScorePath : null,
        fillResponse: fillResponse
          ? runType === 'direct'
            ? directFillPath
            : mcpFillPath
          : null,
        filledForm: filledForm ? filledFormPath : null,
      },
    });
  }

  if (scenarios.length === 0) {
    throw new Error(`${label} has a scenarios directory but no readable scenarios`);
  }
  return scenarios;
}

function buildReport({ repoRoot, runs, showPassed }) {
  const comparisons =
    runs.length > 1
      ? runs.slice(1).map((run) => compareRuns({ baseline: runs[0], run }))
      : [];

  const warnings = [
    ...runs.flatMap((run) => run.documentWarnings),
    ...comparisons.flatMap((comparison) => comparison.documentChanges),
  ];

  return {
    schemaVersion: 1,
    artifactType: 'packet-run-comparison',
    generatedAt: new Date().toISOString(),
    baselineIndex: 0,
    repoRoot,
    showPassed,
    runs: runs.map((run) => serializeRun(run, { showPassed, repoRoot })),
    comparisons,
    warnings,
  };
}

function serializeRun(run, { showPassed, repoRoot }) {
  return {
    index: run.index,
    label: run.label,
    artifactRoot: run.artifactRoot,
    displayRoot: run.displayRoot,
    runType: run.runType,
    runId: run.runId,
    status: run.status,
    userId: run.userId,
    corpusId: run.corpusId,
    modelOrAgent: run.modelOrAgent,
    summary: run.summary,
    scenarios: run.scenarios.map((scenario) => ({
      scenarioId: scenario.scenarioId,
      formScore: scenarioScoreString(scenario),
      summary: scenario.formScoreReport?.summary ?? null,
      artifactDir: displayPath(repoRoot, scenario.scenarioDir),
    })),
    documentWarnings: run.documentWarnings,
    memoryIssues: run.memoryIssues,
    ownershipIssues: run.ownershipIssues,
    formIssues: run.formIssues,
    ...(showPassed
      ? {
          memoryPassed: run.memoryPassed,
          formPassed: run.formPassed,
        }
      : {}),
  };
}

function summarizeRun(run) {
  const quality = run.packetRun.qualitySummary ?? {};
  const databaseSummary = run.databaseReport.summary ?? {};
  const documentSummary = run.packetRun.documents ?? {};
  const settings = run.packetRun.settings ?? {};
  const orderedDocumentIds = documentSummary.order?.orderedDocumentIds ?? [];
  const formSummary = aggregateFormSummary(run.scenarios);

  const memoryTotal = numberOrNull(databaseSummary.knownPresentTotal);
  const memoryRecovered = numberOrNull(
    databaseSummary.knownPresentRecoveredActive ??
      databaseSummary.knownPresentCorrect,
  );
  const formTotal =
    numberOrNull(formSummary.knownFieldTotal) ?? ratioTotal(quality.knownFieldCorrect);
  const formCorrect =
    numberOrNull(formSummary.knownFieldCorrect) ??
    ratioNumerator(quality.knownFieldCorrect);
  const ownershipForbiddenLeaks =
    numberOrNull(quality.memoryOwnershipForbiddenLeaks) ??
    sumNumbers(
      databaseSummary.ownershipDecoyForbiddenActiveLeak,
      databaseSummary.ownershipDecoyForbiddenSuggestionLeak,
    );

  return {
    documentCount:
      numberOrNull(documentSummary.documentCount) ??
      orderedDocumentIds.length ??
      null,
    sourceCharCount: nullableNumber(documentSummary.sourceCharCount),
    evidenceCharCount: nullableNumber(documentSummary.evidenceCharCount),
    maxEvidenceChars:
      nullableNumber(documentSummary.maxEvidenceChars) ??
      nullableNumber(settings.maxEvidenceChars),
    documentOrderMode:
      documentSummary.order?.mode ?? settings.documentOrder ?? '<unknown>',
    documentOrderSeed:
      documentSummary.order?.seed ?? settings.documentOrderSeed ?? null,
    orderedDocumentIds,
    firstDocumentIds: orderedDocumentIds.slice(0, 3),
    lastDocumentIds: orderedDocumentIds.slice(-3),
    memoryScore:
      quality.memoryKnownRecovered ??
      ratioString(memoryRecovered, memoryTotal) ??
      '<unknown>',
    memoryRecovered,
    memoryTotal,
    memoryMissing: numberOrNull(databaseSummary.knownPresentMissing),
    memoryWrong: numberOrNull(databaseSummary.knownPresentWrongValue),
    memoryConflicts: numberOrNull(databaseSummary.knownPresentConflict),
    memorySuggestions: numberOrNull(databaseSummary.knownPresentSuggestionOnly),
    memoryOwnership:
      quality.memoryOwnershipClean ??
      ratioString(
        databaseSummary.ownershipDecoyClean,
        databaseSummary.ownershipDecoyTotal,
      ) ??
      '<unknown>',
    ownershipForbiddenLeaks,
    formScore:
      quality.knownFieldCorrect ??
      ratioString(formCorrect, formTotal) ??
      '<unknown>',
    formCorrect,
    formTotal,
    formWrong:
      numberOrNull(quality.knownFieldWrong) ??
      numberOrNull(formSummary.knownFieldWrong),
    formMissing:
      numberOrNull(quality.knownFieldMissing) ??
      numberOrNull(formSummary.knownFieldMissing),
    formOverfills:
      numberOrNull(quality.overfillCount) ??
      sumNumbers(
        formSummary.structuralOverfillCount,
        formSummary.manualAttestationOverfillCount,
        formSummary.outOfScopeOverfillCount,
        formSummary.unmappedOverfillCount,
      ),
    perScenario: quality.perScenario ?? {},
  };
}

function collectPassedMemoryFacts(run) {
  return (run.databaseReport.knownPresent ?? [])
    .filter((row) => !isMemoryIssueRow(row))
    .map((row) => ({
      factKey: row.factKey,
      expectedValue: row.expectedValue,
      classification: row.classification,
      matchingValues: compactRows([
        ...(row.matchingActiveRows ?? []),
        ...(row.matchingAcceptedRows ?? []),
        ...(row.matchingNovelRows ?? []),
      ]),
    }));
}

function collectMemoryIssues(run) {
  return (run.databaseReport.knownPresent ?? [])
    .filter(isMemoryIssueRow)
    .map((row) => {
      const classification = classifyMemoryIssue({ run, row });
      return {
        id: `memory:${row.factKey}`,
        kind: 'memory',
        factKey: row.factKey,
        expectedValue: row.expectedValue,
        reportClassification: row.classification ?? '<unknown>',
        likelyClass: classification.likelyClass,
        confidence: classification.confidence,
        reason: classification.reason,
        relatedValues: classification.relatedValues,
        artifact: path.basename(run.paths.databaseReport),
      };
    });
}

function collectOwnershipIssues(run) {
  return (run.databaseReport.ownershipDecoyAudit ?? [])
    .filter((row) => !CLEAN_OWNERSHIP_CLASSES.has(row.classification))
    .map((row) => ({
      id: `ownership:${row.ownerKey}:${row.valueLabel}:${row.value}`,
      kind: 'ownership',
      ownerKey: row.ownerKey,
      ownerName: row.ownerName,
      valueLabel: row.valueLabel,
      value: row.value,
      forbiddenFactKeys: row.forbiddenFactKeys ?? [],
      reportClassification: row.classification ?? '<unknown>',
      likelyClass: 'unknown_needs_inspection',
      confidence: 'medium',
      reason: 'Ownership audit found a forbidden active or suggestion leak.',
      relatedValues: compactRows([
        ...(row.forbiddenActiveRows ?? []),
        ...(row.forbiddenSuggestionRows ?? []),
      ]),
      artifact: path.basename(run.paths.databaseReport),
    }));
}

function collectPassedFormFields(run) {
  return run.scenarios.flatMap((scenario) =>
    (scenario.formScoreReport?.fields ?? [])
      .filter((field) => !isFormIssueField(field))
      .map((field) => ({
        scenarioId: scenario.scenarioId,
        pdfFieldName: field.pdfFieldName,
        factKey: field.factKey,
        classification: field.classification,
        expectedValue: field.expectedValue,
        actualValue: field.actualValue,
      })),
  );
}

function collectFormIssues(run) {
  return run.scenarios.flatMap((scenario) =>
    (scenario.formScoreReport?.fields ?? [])
      .filter(isFormIssueField)
      .map((field) => {
        const classification = classifyFormIssue({ run, scenario, field });
        return {
          id: `form:${scenario.scenarioId}:${field.pdfFieldName}:${field.factKey ?? ''}`,
          kind: 'form',
          scenarioId: scenario.scenarioId,
          pdfFieldName: field.pdfFieldName,
          factKey: field.factKey ?? null,
          expectedAction: field.expectedAction ?? null,
          expectedValue: field.expectedValue ?? null,
          actualValue: field.actualValue ?? null,
          reportClassification: field.classification ?? '<unknown>',
          snapshotClassification: field.snapshotClassification ?? null,
          sourceSlugs: field.sourceSlugs ?? [],
          likelyClass: classification.likelyClass,
          confidence: classification.confidence,
          reason: classification.reason,
          relatedValues: classification.relatedValues,
          artifact: scenario.paths.formScoreReport
            ? path.basename(scenario.paths.formScoreReport)
            : 'form-score-report.json',
        };
      }),
  );
}

function collectDocumentWarnings(run) {
  const warnings = [];
  const {
    sourceCharCount,
    evidenceCharCount,
    maxEvidenceChars,
    documentOrderMode,
    documentOrderSeed,
  } = run.summary;

  if (
    typeof sourceCharCount === 'number' &&
    typeof evidenceCharCount === 'number' &&
    evidenceCharCount < sourceCharCount
  ) {
    warnings.push({
      runIndex: run.index,
      runLabel: run.label,
      likelyClass: 'document_coverage_or_truncation',
      confidence: 'high',
      message: `Evidence chars ${evidenceCharCount} are lower than source chars ${sourceCharCount}; packet evidence was truncated or filtered.`,
    });
  }

  if (
    typeof maxEvidenceChars === 'number' &&
    typeof evidenceCharCount === 'number' &&
    evidenceCharCount >= maxEvidenceChars
  ) {
    warnings.push({
      runIndex: run.index,
      runLabel: run.label,
      likelyClass: 'document_coverage_or_truncation',
      confidence: 'medium',
      message: `Evidence chars reached maxEvidenceChars ${maxEvidenceChars}; packet may be capped.`,
    });
  }

  if (
    documentOrderMode &&
    documentOrderMode !== 'canonical' &&
    run.summary.orderedDocumentIds.length > 0
  ) {
    warnings.push({
      runIndex: run.index,
      runLabel: run.label,
      likelyClass: 'document_coverage_or_truncation',
      confidence: 'low',
      message: `Document order is ${documentOrderMode} seed=${documentOrderSeed ?? '<none>'}; first=${run.summary.firstDocumentIds.join(', ')} last=${run.summary.lastDocumentIds.join(', ')}.`,
    });
  }

  return warnings;
}

function compareRuns({ baseline, run }) {
  const baselineMemoryIds = new Set(baseline.memoryIssues.map((issue) => issue.id));
  const runMemoryIds = new Set(run.memoryIssues.map((issue) => issue.id));
  const baselineFormIds = new Set(baseline.formIssues.map((issue) => issue.id));
  const runFormIds = new Set(run.formIssues.map((issue) => issue.id));
  const baselineOwnershipIds = new Set(
    baseline.ownershipIssues.map((issue) => issue.id),
  );
  const runOwnershipIds = new Set(run.ownershipIssues.map((issue) => issue.id));

  return {
    baselineIndex: baseline.index,
    runIndex: run.index,
    runLabel: run.label,
    corpusDelta: valueChange(baseline.corpusId, run.corpusId),
    memoryScoreDelta: deltaScore(
      baseline.summary.memoryRecovered,
      baseline.summary.memoryTotal,
      run.summary.memoryRecovered,
      run.summary.memoryTotal,
    ),
    formScoreDelta: deltaScore(
      baseline.summary.formCorrect,
      baseline.summary.formTotal,
      run.summary.formCorrect,
      run.summary.formTotal,
    ),
    ownershipLeakDelta: deltaNumber(
      baseline.summary.ownershipForbiddenLeaks,
      run.summary.ownershipForbiddenLeaks,
    ),
    memoryIssuesIntroduced: diffIds(runMemoryIds, baselineMemoryIds),
    memoryIssuesResolved: diffIds(baselineMemoryIds, runMemoryIds),
    formIssuesIntroduced: diffIds(runFormIds, baselineFormIds),
    formIssuesResolved: diffIds(baselineFormIds, runFormIds),
    ownershipIssuesIntroduced: diffIds(runOwnershipIds, baselineOwnershipIds),
    ownershipIssuesResolved: diffIds(baselineOwnershipIds, runOwnershipIds),
    documentChanges: documentChanges({ baseline, run }),
  };
}

function documentChanges({ baseline, run }) {
  const checks = [
    ['documentCount', baseline.summary.documentCount, run.summary.documentCount],
    [
      'documentOrderMode',
      baseline.summary.documentOrderMode,
      run.summary.documentOrderMode,
    ],
    [
      'documentOrderSeed',
      baseline.summary.documentOrderSeed,
      run.summary.documentOrderSeed,
    ],
    ['maxEvidenceChars', baseline.summary.maxEvidenceChars, run.summary.maxEvidenceChars],
  ];

  return checks
    .filter(([, before, after]) => !sameValue(before, after))
    .map(([name, before, after]) => ({
      runIndex: run.index,
      runLabel: run.label,
      field: name,
      before,
      after,
      likelyClass: 'document_coverage_or_truncation',
      confidence: name === 'documentCount' || name === 'maxEvidenceChars' ? 'medium' : 'low',
      message: `${name} changed from ${formatValue(before)} to ${formatValue(after)} compared with baseline.`,
    }));
}

function classifyMemoryIssue({ run, row }) {
  const candidates = relatedCandidates({ run, row });
  const exactExtraction = candidates.find(
    (candidate) =>
      candidate.source === 'extraction' &&
      valueMatchesExpected(candidate.value, row.expectedValue),
  );
  const exactMemory = candidates.find(
    (candidate) =>
      candidate.source === 'memory' &&
      valueMatchesExpected(candidate.value, row.expectedValue),
  );
  const booleanCandidate = candidates.find((candidate) =>
    isBooleanEnumMismatch({ candidate, row }),
  );
  const codeCandidate = candidates.find((candidate) =>
    isCodeLabelMismatch({ candidate, row }),
  );

  if (booleanCandidate) {
    return classificationResult({
      likelyClass: 'normalization_boolean_enum',
      confidence: 'high',
      reason: `Related ${booleanCandidate.source} value ${formatValue(booleanCandidate.value)} is boolean/code-like while expected label is ${formatValue(row.expectedValue)}.`,
      relatedValues: compactRows(candidates),
    });
  }

  if (codeCandidate) {
    return classificationResult({
      likelyClass: 'normalization_code_label',
      confidence: 'high',
      reason: `Related ${codeCandidate.source} value ${formatValue(codeCandidate.value)} looks like a code while expected label is ${formatValue(row.expectedValue)}.`,
      relatedValues: compactRows(candidates),
    });
  }

  if (exactExtraction && !exactMemory) {
    return classificationResult({
      likelyClass: 'extracted_not_stored',
      confidence: 'high',
      reason: 'Expected value appears in open-schema extraction but not in active memory.',
      relatedValues: compactRows(candidates),
    });
  }

  if (exactMemory && !row.valueRecoveredInActiveMemory) {
    return classificationResult({
      likelyClass: 'stored_unaccepted_slug',
      confidence: 'high',
      reason: 'Expected value appears in memory, but the score report did not count it as recovered.',
      relatedValues: compactRows(candidates),
    });
  }

  if (candidates.length === 0) {
    return classificationResult({
      likelyClass: 'extraction_missing',
      confidence: 'medium',
      reason: 'No related extracted or stored value was found for this fact key.',
      relatedValues: [],
    });
  }

  return classificationResult({
    likelyClass: 'unknown_needs_inspection',
    confidence: 'low',
    reason: 'Related values exist, but the reporter could not confidently classify the failure.',
    relatedValues: compactRows(candidates),
  });
}

function classifyFormIssue({ run, scenario, field }) {
  const matchingAction = findFillAction({
    actions: scenario.fillActions,
    pdfFieldName: field.pdfFieldName,
  });
  const combinedFact = (scenario.combinedScoreReport?.facts ?? []).find(
    (fact) => fact.factKey === field.factKey,
  );
  const memoryIssue = run.memoryIssues.find(
    (issue) => issue.factKey && issue.factKey === field.factKey,
  );

  if (matchingAction && matchingAction.action && matchingAction.action !== 'SKIP') {
    return classificationResult({
      likelyClass: 'form_condition_or_application',
      confidence: 'high',
      reason: `Fill response attempted ${matchingAction.action}, but filled snapshot/scorer shows ${field.snapshotClassification ?? field.classification}.`,
      relatedValues: compactRows([
        {
          source: 'fill_response',
          slug: matchingAction.fieldName,
          value: matchingAction.value ?? matchingAction.action,
        },
      ]),
    });
  }

  if (combinedFact?.memoryStatus === 'missing' || memoryIssue) {
    return classificationResult({
      likelyClass: 'form_missing_due_memory',
      confidence: memoryIssue ? 'high' : 'medium',
      reason: memoryIssue
        ? `Underlying memory issue for ${field.factKey}: ${memoryIssue.likelyClass}.`
        : 'Combined report says the required memory fact was missing.',
      relatedValues: memoryIssue?.relatedValues ?? [],
    });
  }

  return classificationResult({
    likelyClass: 'unknown_needs_inspection',
    confidence: 'low',
    reason: 'The reporter did not find enough memory or fill-response context.',
    relatedValues: [],
  });
}

function relatedCandidates({ run, row }) {
  const factTokens = tokensForFactKey(row.factKey);
  const candidates = [];

  for (const candidate of [
    ...(row.matchingActiveRows ?? []),
    ...(row.matchingAcceptedRows ?? []),
    ...(row.matchingNovelRows ?? []),
    ...(row.acceptedWrongRows ?? []),
    ...(row.matchingSuggestionRows ?? []),
  ]) {
    candidates.push({
      source: 'score_report',
      slug: candidate.slug,
      label: candidate.label,
      value: candidate.value,
      valueType: candidate.valueType,
    });
  }

  for (const preference of run.memorySnapshot.preferences ?? []) {
    if (
      isRelatedCandidate({ factTokens, row, candidate: preference }) ||
      valueMatchesExpected(preference.value, row.expectedValue)
    ) {
      candidates.push({
        source: 'memory',
        slug: preference.slug,
        label: preference.label,
        value: preference.value,
        valueType: preference.valueType,
      });
    }
  }

  for (const suggestion of run.memorySnapshot.suggestions ?? []) {
    if (
      isRelatedCandidate({ factTokens, row, candidate: suggestion }) ||
      valueMatchesExpected(suggestion.value, row.expectedValue)
    ) {
      candidates.push({
        source: 'memory_suggestion',
        slug: suggestion.slug,
        label: suggestion.label,
        value: suggestion.value,
        valueType: suggestion.valueType,
      });
    }
  }

  for (const fact of run.extraction?.facts ?? []) {
    if (
      isRelatedCandidate({ factTokens, row, candidate: fact }) ||
      valueMatchesExpected(fact.value, row.expectedValue)
    ) {
      candidates.push({
        source: 'extraction',
        slug: fact.slug,
        label: fact.label,
        value: fact.value,
        valueType: fact.valueType,
      });
    }
  }

  return dedupeCandidates(candidates);
}

function isRelatedCandidate({ factTokens, row, candidate }) {
  const text = `${candidate.slug ?? ''} ${candidate.label ?? ''}`.toLowerCase();
  const matched = factTokens.filter((token) => text.includes(token));
  if (matched.length >= 2) return true;
  if (matched.some((token) => token.length >= 8)) return true;

  const factKey = row.factKey ?? '';
  if (factKey === 'banking.accountType') {
    return text.includes('account') && text.includes('type');
  }
  if (factKey === 'banking.institutionName') {
    return (
      text.includes('bank') ||
      text.includes('institution') ||
      text.includes('rdfi')
    );
  }
  if (factKey === 'tax.filingStatus') {
    return text.includes('filing') || text.includes('w4') || text.includes('choice');
  }
  if (factKey === 'workAuthorization.citizenshipStatus') {
    return text.includes('citizen') || text.includes('work_authorization');
  }
  return false;
}

function isBooleanEnumMismatch({ candidate, row }) {
  const expected = row.expectedValue;
  if (typeof expected !== 'string') return false;
  const text = String(candidate.slug ?? '').toLowerCase();
  return (
    typeof candidate.value === 'boolean' ||
    candidate.valueType === 'BOOLEAN' ||
    (text.includes('is_') && ['true', 'false'].includes(String(candidate.value)))
  );
}

function isCodeLabelMismatch({ candidate, row }) {
  if (valueMatchesExpected(candidate.value, row.expectedValue)) return false;
  if (typeof row.expectedValue !== 'string') return false;
  const value = String(candidate.value ?? '').trim();
  if (!value) return false;
  const slug = String(candidate.slug ?? '').toLowerCase();
  const expected = row.expectedValue.toLowerCase();
  const codeLike =
    /^[A-Z0-9_-]{2,12}$/.test(value) ||
    slug.includes('code') ||
    slug.includes('class') ||
    slug.includes('choice') ||
    slug.includes('key');
  const expectedLooksLikeLabel = /[a-z]/.test(expected) && expected.includes(' ');
  const knownShortCodeForLabel = /^[A-Z0-9_-]{2,12}$/.test(value) && /[a-z]/.test(expected);
  return codeLike && (expectedLooksLikeLabel || knownShortCodeForLabel);
}

function isMemoryIssueRow(row) {
  const classification = row.classification ?? '';
  if (classification.startsWith(OPEN_MEMORY_RECOVERED_PREFIX)) return false;
  return (
    row.valueRecoveredInActiveMemory === false ||
    row.acceptedSlugHasWrongValue === true ||
    row.conflict === true ||
    row.suggestionOnly === true ||
    classification.includes('missing') ||
    classification.includes('wrong') ||
    classification.includes('conflict') ||
    classification.includes('suggestion')
  );
}

function isFormIssueField(field) {
  return (
    FORM_ISSUE_CLASSES.has(field.classification) ||
    field.overfill === true ||
    String(field.classification ?? '').includes('hallucinated')
  );
}

function extractFillActions(fillResponse) {
  if (!fillResponse) return [];
  const actions = [];
  if (Array.isArray(fillResponse.parsed?.fillActions)) {
    actions.push(...fillResponse.parsed.fillActions);
  }
  if (Array.isArray(fillResponse.response?.fillActions)) {
    actions.push(...fillResponse.response.fillActions);
  }
  if (Array.isArray(fillResponse.response?.summary?.filledFields)) {
    actions.push(
      ...fillResponse.response.summary.filledFields.map((field) => ({
        fieldName: field.pdfFieldName,
        action: 'FILLED',
        value: field.value ?? null,
        sourceSlugs: field.sourceSlugs ?? [],
      })),
    );
  }
  if (Array.isArray(fillResponse.response?.summary?.skippedFields)) {
    actions.push(
      ...fillResponse.response.summary.skippedFields.map((field) => ({
        fieldName: field.pdfFieldName,
        action: 'SKIP',
        skipReason: field.reason,
        sourceSlugs: field.sourceSlugs ?? [],
      })),
    );
  }
  if (actions.length > 0) return actions;

  if (typeof fillResponse.rawText === 'string') {
    try {
      const parsed = JSON.parse(fillResponse.rawText);
      if (Array.isArray(parsed.fillActions)) return parsed.fillActions;
    } catch {
      return [];
    }
  }
  return [];
}

function findFillAction({ actions, pdfFieldName }) {
  return actions.find((action) => sameFieldName(action.fieldName, pdfFieldName));
}

function sameFieldName(left, right) {
  return normalizeFieldName(left) === normalizeFieldName(right);
}

function normalizeFieldName(value) {
  return String(value ?? '').trim().toLowerCase();
}

function aggregateFormSummary(scenarios) {
  const summary = {};
  for (const scenario of scenarios) {
    for (const [key, value] of Object.entries(scenario.formScoreReport?.summary ?? {})) {
      if (typeof value === 'number' && Number.isFinite(value)) {
        summary[key] = (summary[key] ?? 0) + value;
      }
    }
  }
  return summary;
}

function scenarioScoreString(scenario) {
  const summary = scenario.formScoreReport?.summary;
  if (!summary) return '<missing-form-score>';
  return ratioString(summary.knownFieldCorrect, summary.knownFieldTotal) ?? '<unknown>';
}

function modelOrAgent(packetRun) {
  const model = packetRun.model?.label ?? packetRun.model ?? null;
  const modelSource = packetRun.model?.source ? ` (${packetRun.model.source})` : '';
  const agent = packetRun.agent ?? packetRun.settings?.agent ?? null;
  if (model && typeof model === 'string') return `${model}${modelSource}`;
  if (agent) return `${agent} agent`;
  return '<unspecified>';
}

function formatMarkdownReport(report) {
  const lines = ['# Packet Run Comparison', ''];
  lines.push('## Runs', '');
  lines.push(
    table([
      [
        'Run',
        'Type',
        'Corpus',
        'Model/Agent',
        'Docs',
        'Order',
        'Evidence',
        'Memory',
        'Forms',
        'Ownership',
      ],
      ...report.runs.map((run) => [
        `${run.label}: ${run.displayRoot}`,
        run.runType,
        run.corpusId,
        run.modelOrAgent,
        run.summary.documentCount,
        `${run.summary.documentOrderMode}${run.summary.documentOrderSeed ? `/${run.summary.documentOrderSeed}` : ''}`,
        `${formatNumber(run.summary.evidenceCharCount)}/${formatNumber(run.summary.sourceCharCount)} max=${formatNumber(run.summary.maxEvidenceChars)}`,
        run.summary.memoryScore,
        run.summary.formScore,
        `${run.summary.memoryOwnership}; leaks=${run.summary.ownershipForbiddenLeaks ?? 0}`,
      ]),
    ]),
    '',
  );

  lines.push('## Per-Scenario Form Scores', '');
  lines.push(
    table([
      ['Run', 'Scenario', 'Known Fields', 'Wrong', 'Missing', 'Overfills'],
      ...report.runs.flatMap((run) =>
        run.scenarios.map((scenario) => [
          run.label,
          scenario.scenarioId,
          scenario.formScore,
          scenario.summary?.knownFieldWrong ?? 0,
          scenario.summary?.knownFieldMissing ?? 0,
          sumNumbers(
            scenario.summary?.structuralOverfillCount,
            scenario.summary?.manualAttestationOverfillCount,
            scenario.summary?.outOfScopeOverfillCount,
            scenario.summary?.unmappedOverfillCount,
          ),
        ]),
      ),
    ]),
    '',
  );

  lines.push('## Document Coverage', '');
  if (report.warnings.length === 0) {
    lines.push('No document coverage/order warnings.', '');
  } else {
    for (const warning of report.warnings) {
      lines.push(
        `- ${warning.runLabel}: ${warning.message} (${warning.likelyClass}, ${warning.confidence})`,
      );
    }
    lines.push('');
  }
  for (const run of report.runs) {
    if (run.summary.firstDocumentIds.length === 0) continue;
    lines.push(
      `- ${run.label} order sample: first=${run.summary.firstDocumentIds.join(', ')}; last=${run.summary.lastDocumentIds.join(', ')}`,
    );
  }
  if (report.runs.some((run) => run.summary.firstDocumentIds.length > 0)) lines.push('');

  lines.push('## Memory Issues', '');
  const memoryRows = report.runs.flatMap((run) => [
    ...run.memoryIssues.map((issue) => memoryIssueRow(run, issue)),
    ...run.ownershipIssues.map((issue) => ownershipIssueRow(run, issue)),
  ]);
  if (memoryRows.length === 0) {
    lines.push('No memory or ownership issues found.', '');
  } else {
    lines.push(
      table([
        [
          'Run',
          'Fact/Owner',
          'Expected/Value',
          'Report Class',
          'Likely Class',
          'Confidence',
          'Related Values',
        ],
        ...memoryRows,
      ]),
      '',
    );
  }

  lines.push('## Form Issues', '');
  const formRows = report.runs.flatMap((run) =>
    run.formIssues.map((issue) => formIssueRow(run, issue)),
  );
  if (formRows.length === 0) {
    lines.push('No form issues found.', '');
  } else {
    lines.push(
      table([
        [
          'Run',
          'Scenario',
          'Field',
          'Fact',
          'Expected',
          'Actual',
          'Report Class',
          'Likely Class',
          'Confidence',
        ],
        ...formRows,
      ]),
      '',
    );
  }

  if (report.showPassed) {
    lines.push('## Passed Checks', '');
    lines.push(
      table([
        ['Run', 'Memory Passed', 'Form Passed'],
        ...report.runs.map((run) => [
          run.label,
          run.memoryPassed.length,
          run.formPassed.length,
        ]),
      ]),
      '',
    );
  }

  if (report.comparisons.length > 0) {
    lines.push('## Deltas vs Baseline', '');
    lines.push(
      table([
        [
          'Run',
          'Corpus',
          'Memory Delta',
          'Form Delta',
          'Ownership Leak Delta',
          'New Memory',
          'Resolved Memory',
          'New Form',
          'Resolved Form',
        ],
        ...report.comparisons.map((comparison) => [
          comparison.runLabel,
          comparison.corpusDelta ?? '-',
          comparison.memoryScoreDelta.display,
          comparison.formScoreDelta.display,
          comparison.ownershipLeakDelta.display,
          comparison.memoryIssuesIntroduced.join(', ') || '-',
          comparison.memoryIssuesResolved.join(', ') || '-',
          comparison.formIssuesIntroduced.join(', ') || '-',
          comparison.formIssuesResolved.join(', ') || '-',
        ]),
      ]),
      '',
    );
  }

  return `${lines.join('\n')}\n`;
}

function memoryIssueRow(run, issue) {
  return [
    run.label,
    issue.factKey,
    issue.expectedValue,
    issue.reportClassification,
    issue.likelyClass,
    issue.confidence,
    formatRelatedValues(issue.relatedValues),
  ];
}

function ownershipIssueRow(run, issue) {
  return [
    run.label,
    `${issue.ownerName ?? issue.ownerKey}:${issue.valueLabel}`,
    issue.value,
    issue.reportClassification,
    issue.likelyClass,
    issue.confidence,
    formatRelatedValues(issue.relatedValues),
  ];
}

function formIssueRow(run, issue) {
  return [
    run.label,
    issue.scenarioId,
    issue.pdfFieldName,
    issue.factKey,
    issue.expectedValue,
    issue.actualValue,
    issue.reportClassification,
    issue.likelyClass,
    issue.confidence,
  ];
}

function table(rows) {
  const escapedRows = rows.map((row) => row.map(markdownCell));
  const [header, ...body] = escapedRows;
  const separator = header.map(() => '---');
  return [header, separator, ...body]
    .map((row) => `| ${row.join(' | ')} |`)
    .join('\n');
}

function markdownCell(value) {
  const text = formatValue(value).replace(/\s+/g, ' ').trim();
  return text.replaceAll('|', '\\|') || '-';
}

function formatRelatedValues(values) {
  if (!values || values.length === 0) return '-';
  return values
    .slice(0, 4)
    .map((row) => `${row.source}:${row.slug ?? '<unknown>'}=${formatValue(row.value)}`)
    .join('; ');
}

function classificationResult({ likelyClass, confidence, reason, relatedValues }) {
  return {
    likelyClass,
    confidence,
    reason,
    relatedValues: relatedValues ?? [],
  };
}

function compactRows(rows) {
  return dedupeCandidates(
    rows
      .filter(Boolean)
      .map((row) => ({
        source: row.source ?? row.sourceType ?? 'report',
        slug: row.slug ?? row.fieldName ?? row.pdfFieldName ?? row.label ?? null,
        label: row.label ?? null,
        value: row.value ?? row.actualValue ?? row.expectedValue ?? null,
        valueType: row.valueType ?? null,
      })),
  ).slice(0, 8);
}

function dedupeCandidates(candidates) {
  const seen = new Set();
  const deduped = [];
  for (const candidate of candidates) {
    const key = `${candidate.source}:${candidate.slug}:${JSON.stringify(candidate.value)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(candidate);
  }
  return deduped;
}

function tokensForFactKey(factKey) {
  const broadDomainTokens = new Set([
    'address',
    'authorization',
    'banking',
    'contact',
    'current',
    'employment',
    'identity',
    'profile',
    'work',
  ]);
  return [
    ...new Set(
      String(factKey ?? '')
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(
          (token) => token.length >= 3 && !broadDomainTokens.has(token),
        ),
    ),
  ];
}

function valueMatchesExpected(value, expected) {
  if (value == null || expected == null) return value === expected;
  return normalizeValue(value) === normalizeValue(expected);
}

function normalizeValue(value) {
  return String(value).trim().toLowerCase().replace(/\s+/g, ' ');
}

function ratioString(numerator, denominator) {
  if (typeof numerator !== 'number' || typeof denominator !== 'number') return null;
  return `${numerator}/${denominator}`;
}

function ratioNumerator(value) {
  const parsed = parseRatio(value);
  return parsed?.numerator ?? null;
}

function ratioTotal(value) {
  const parsed = parseRatio(value);
  return parsed?.denominator ?? null;
}

function parseRatio(value) {
  const match = /^(\d+)\/(\d+)$/.exec(String(value ?? ''));
  if (!match) return null;
  return {
    numerator: Number(match[1]),
    denominator: Number(match[2]),
  };
}

function deltaScore(beforeNumerator, beforeDenominator, afterNumerator, afterDenominator) {
  const before =
    typeof beforeNumerator === 'number' && typeof beforeDenominator === 'number'
      ? beforeNumerator / beforeDenominator
      : null;
  const after =
    typeof afterNumerator === 'number' && typeof afterDenominator === 'number'
      ? afterNumerator / afterDenominator
      : null;
  const rawDelta = before == null || after == null ? null : after - before;
  return {
    before: ratioString(beforeNumerator, beforeDenominator),
    after: ratioString(afterNumerator, afterDenominator),
    rawDelta,
    display:
      rawDelta == null
        ? `${formatValue(ratioString(beforeNumerator, beforeDenominator))} -> ${formatValue(ratioString(afterNumerator, afterDenominator))}`
        : `${signedNumber(rawDelta)} (${formatValue(ratioString(beforeNumerator, beforeDenominator))} -> ${formatValue(ratioString(afterNumerator, afterDenominator))})`,
  };
}

function deltaNumber(before, after) {
  const rawDelta =
    typeof before === 'number' && typeof after === 'number' ? after - before : null;
  return {
    before,
    after,
    rawDelta,
    display:
      rawDelta == null
        ? `${formatValue(before)} -> ${formatValue(after)}`
        : `${signedNumber(rawDelta)} (${formatValue(before)} -> ${formatValue(after)})`,
  };
}

function signedNumber(value) {
  if (value > 0) return `+${round(value)}`;
  return String(round(value));
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

function diffIds(left, right) {
  return [...left].filter((id) => !right.has(id)).sort();
}

function valueChange(before, after) {
  if (sameValue(before, after)) return null;
  return `${formatValue(before)} -> ${formatValue(after)}`;
}

function sameValue(left, right) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function sumNumbers(...values) {
  let total = 0;
  let hasNumber = false;
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      total += value;
      hasNumber = true;
    }
  }
  return hasNumber ? total : null;
}

function nullableNumber(value) {
  if (value === null || value === undefined) return null;
  return numberOrNull(value);
}

function numberOrNull(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function formatNumber(value) {
  return typeof value === 'number' ? String(value) : '<none>';
}

function formatValue(value) {
  if (value === null || value === undefined || value === '') return '-';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function displayPath(repoRoot, filePath) {
  const rel = relativePath(repoRoot, filePath);
  return rel.startsWith('..') ? filePath : rel;
}

async function readRequiredJson(filePath, label) {
  try {
    return await readJson(filePath);
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(`${label} is missing required artifact ${filePath}`);
    }
    throw error;
  }
}

async function readOptionalJson(filePath) {
  try {
    return await readJson(filePath);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function pathExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await runComparePacketRuns({
    repoRoot: defaultRepoRoot,
    args: process.argv.slice(2),
  });
  process.stdout.write(`${formatComparePacketRunsResult(result)}\n`);
  process.exitCode = result.exitCode;
}
