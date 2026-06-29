#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRunPlan } from './eval-runner/actions.mjs';
import { loadScenarioFixture } from './eval-runner/fixtures.mjs';
import { loadBackendPdfLib, readFilledPdfFields } from './eval-runner/pdf.mjs';
import { buildFilledFormSnapshot } from './eval-runner/snapshots.mjs';
import {
  buildDirectOpenSchemaFieldMetadata,
  buildExtractionPrompt,
  buildFactOnlyFillPrompt,
  buildSyntheticMemorySnapshot,
  parseJsonObjectResponse,
  validateExtractionPayload,
  validateFactFillActions,
} from './direct-open-schema.mjs';
import {
  DEFAULT_MAX_EVIDENCE_CHARS,
  buildPromptFieldMetadata,
  fillPdfFromActions,
  loadEvidenceDocuments,
} from './fill-form-from-docs.mjs';
import {
  DEFAULT_DOCUMENT_ORDER,
  DEFAULT_DOCUMENT_ORDER_SEED,
  buildPacketDocumentMetadata,
  evidenceCharCount,
  loadPacketDocumentStats,
  orderPacketDocuments,
  validateDocumentOrder,
} from './packet-documents.mjs';
import { generateWithVertex } from './generate.mjs';
import { scoreFormToFile } from './scoring/form.mjs';
import { scoreOpenSchemaCombinedToFile } from './scoring/open-schema-combined.mjs';
import { scoreOpenSchemaDatabaseToFile } from './scoring/open-schema-database.mjs';
import {
  relativePath,
  validateWithSchema,
  writeJson,
} from './scoring/io.mjs';
import { formatResult as formatValidationResult, runValidation } from './validate.mjs';
import { isFixtureId } from './shared.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultRepoRoot = path.resolve(__dirname, '../../..');
const DEFAULT_TEMPERATURE = 0.2;
const PROVIDERS = new Set(['vertex']);
const DEFAULT_CONFIDENCE_THRESHOLD = 0.75;
const EXTRACTION_PROMPT_VERSION = 'direct-open-schema-extraction-v4';
const FILL_PROMPT_VERSION = 'direct-open-schema-fill-v4';

export async function runDirectOpenSchemaPacket({
  repoRoot = defaultRepoRoot,
  args = [],
  env = process.env,
  generateExtractionResponse = null,
  generateFillResponse = null,
  pdfLib,
  now = () => new Date(),
} = {}) {
  const parsed = parseArgs(args, env, now);
  if (parsed.kind === 'help') return { exitCode: 0, lines: [usage()] };
  if (parsed.kind === 'usage-error') {
    return { exitCode: 2, lines: [parsed.message, '', usage()] };
  }

  const options = parsed.options;
  const artifacts = buildPacketArtifacts({ repoRoot, options });
  const startedAt = isoTimestamp(now);
  const report = initialPacketReport({ repoRoot, options, artifacts, startedAt });
  const writeReport = async () => writeJson(artifacts.packetRun, report);

  try {
    await mkdir(artifacts.artifactsRoot, { recursive: true });
    await writeReport();

    const corpusValidation = await runValidation({
      repoRoot,
      args: [
        '--user',
        options.userId,
        '--corpus',
        options.corpusId,
        '--documents-root',
        options.documentsRoot,
        '--report-out',
        artifacts.validationReport,
      ],
    });
    if (corpusValidation.exitCode !== 0) {
      throw new Error(formatValidationResult(corpusValidation));
    }

    const fixtures = [];
    for (const scenarioId of options.scenarioIds) {
      const scenarioValidation = await runValidation({
        repoRoot,
        args: ['--scenario', scenarioId],
      });
      if (scenarioValidation.exitCode !== 0) {
        throw new Error(formatValidationResult(scenarioValidation));
      }
      const fixture = await loadScenarioFixture({ repoRoot, scenarioId });
      assertPacketFixtureMatchesOptions({ fixture, options });
      fixtures.push(fixture);
    }

    const extractionFixture = fixtures[0];
    const orderedDocuments = orderPacketDocuments(
      extractionFixture.manifest.documents ?? [],
      options,
    );
    const documentStats = await loadPacketDocumentStats({
      documentsRoot: path.resolve(repoRoot, options.documentsRoot),
      documents: orderedDocuments,
    });
    report.documents = buildPacketDocumentMetadata({
      documents: orderedDocuments,
      documentOrder: options.documentOrder,
      documentOrderSeed: options.documentOrderSeed,
      sourceCharCount: documentStats.sourceCharCount,
      evidenceCharCount: null,
      maxEvidenceChars: options.maxEvidenceChars,
    });
    await writeReport();

    const evidenceDocuments = await loadEvidenceDocuments({
      manifest: {
        ...extractionFixture.manifest,
        documents: orderedDocuments,
      },
      documentsRoot: path.resolve(repoRoot, options.documentsRoot),
      maxEvidenceChars: options.maxEvidenceChars,
    });
    const totalEvidenceChars = evidenceCharCount(evidenceDocuments);
    report.documents = buildPacketDocumentMetadata({
      documents: orderedDocuments,
      documentOrder: options.documentOrder,
      documentOrderSeed: options.documentOrderSeed,
      sourceCharCount: documentStats.sourceCharCount,
      evidenceCharCount: totalEvidenceChars,
      maxEvidenceChars: options.maxEvidenceChars,
    });
    await writeReport();
    const model = options.model;
    const extractionPrompt = buildExtractionPrompt({ evidenceDocuments });
    await writeFile(artifacts.extractionPrompt, extractionPrompt);
    const extractionProvider =
      generateExtractionResponse ??
      ((prompt) =>
        generateWithVertex(prompt, {
          env,
          model,
          temperature: options.temperature,
          responseMimeType: 'application/json',
        }));
    const rawExtractionText = await extractionProvider(extractionPrompt, {
      fixture: extractionFixture,
      evidenceDocuments,
      model,
      temperature: options.temperature,
      stage: 'extract',
    });
    const extractionParse = parseJsonObjectResponse(rawExtractionText);
    const extractionValidation = extractionParse.parsed
      ? validateExtractionPayload({
          parsed: extractionParse.parsed,
          fixture: extractionFixture,
          evidenceDocuments,
          runId: options.runId,
          model,
          provider: options.provider,
        })
      : invalidExtractionValidation();

    await writeJson(
      artifacts.extractionResponse,
      buildExtractionResponseArtifact({
        fixture: extractionFixture,
        options,
        model,
        rawText: rawExtractionText,
        parse: extractionParse,
        validation: extractionValidation,
        now,
      }),
    );
    if (!extractionValidation.ok) {
      return failedResult({
        lines: [
          'stage=extract-open-schema-facts',
          `response=${relativePath(repoRoot, artifacts.extractionResponse)}`,
          ...extractionValidation.validationDiagnostics,
          ...extractionParse.parseDiagnostics,
        ],
      });
    }

    const extraction = extractionValidation.extraction;
    await validateWithSchema(
      repoRoot,
      'open-schema-extraction.schema.json',
      extraction,
      'open-schema extraction',
    );
    await writeJson(artifacts.extraction, extraction);
    report.summaries.extraction = extraction.diagnostics;
    await writeReport();

    const memorySnapshot = buildSyntheticMemorySnapshot({
      fixture: extractionFixture,
      extraction,
      runId: options.runId,
      exportedAt: isoTimestamp(now),
    });
    await validateWithSchema(
      repoRoot,
      'memory-snapshot.schema.json',
      memorySnapshot,
      'synthetic memory snapshot',
    );
    await writeJson(artifacts.syntheticMemorySnapshot, memorySnapshot);
    const databaseScore = await scoreOpenSchemaDatabaseToFile({
      repoRoot,
      userId: options.userId,
      corpusId: options.corpusId,
      memorySnapshotPath: artifacts.syntheticMemorySnapshot,
      validationReportPath: artifacts.validationReport,
      outPath: artifacts.openSchemaDatabaseScoreReport,
    });
    report.summaries.databaseScore = databaseScore.summary;
    report.qualitySummary = buildPacketQualitySummary(report);
    await writeReport();

    for (const fixture of fixtures) {
      const scenarioId = fixture.scenario.scenarioId;
      const scenarioArtifacts = artifacts.scenarios[scenarioId];
      await mkdir(scenarioArtifacts.root, { recursive: true });
      const fieldMetadata = buildDirectOpenSchemaFieldMetadata(
        buildPromptFieldMetadata(fixture),
      );
      const fillPrompt = buildFactOnlyFillPrompt({ fieldMetadata, extraction });
      await writeFile(scenarioArtifacts.fillPrompt, fillPrompt);
      const fillProvider =
        generateFillResponse ??
        ((prompt) =>
          generateWithVertex(prompt, {
            env,
            model,
            temperature: options.temperature,
            responseMimeType: 'application/json',
          }));
      const rawFillText = await fillProvider(fillPrompt, {
        fixture,
        fieldMetadata,
        extraction,
        model,
        temperature: options.temperature,
        stage: 'fill',
      });
      const fillParse = parseJsonObjectResponse(rawFillText);
      const fillValidation = fillParse.parsed
        ? validateFactFillActions({
            actions: fillParse.parsed.fillActions,
            fields: fieldMetadata,
            facts: extraction.facts,
            confidenceThreshold: DEFAULT_CONFIDENCE_THRESHOLD,
          })
        : invalidFillValidation();
      if (!fillValidation.ok) {
        await writeJson(
          scenarioArtifacts.fillResponse,
          buildFillResponseArtifact({
            fixture,
            options,
            model,
            rawText: rawFillText,
            parse: fillParse,
            validation: fillValidation,
            response: null,
            now,
          }),
        );
        return failedResult({
          lines: [
            `stage=fill-form-from-extracted-facts:${scenarioId}`,
            `response=${relativePath(repoRoot, scenarioArtifacts.fillResponse)}`,
            ...fillValidation.validationDiagnostics,
            ...fillParse.parseDiagnostics,
          ],
        });
      }

      const formPdfBytes = await readFile(fixture.formPdfPath);
      const filledPdfBytes = await fillPdfFromActions({
        repoRoot,
        pdfBytes: formPdfBytes,
        actions: fillValidation.validActions,
        pdfLib,
      });
      const filledPdfFields = await readFilledPdfFields({
        repoRoot,
        pdfBytes: filledPdfBytes,
        pdfLib: pdfLib ?? loadBackendPdfLib(repoRoot),
      });
      const response = buildFormFillResponse({
        fixture,
        filledPdfBytes,
        validationResult: fillValidation,
      });
      const snapshot = buildFilledFormSnapshot({
        fixture,
        runPlan: buildRunPlan(fixture),
        harnessResult: {
          response,
          filledPdfFields,
        },
      });
      await validateWithSchema(
        repoRoot,
        'filled-form-snapshot.schema.json',
        snapshot,
        'filled form snapshot',
      );
      await writeJson(scenarioArtifacts.filledForm, snapshot);
      await writeFile(scenarioArtifacts.filledPdf, filledPdfBytes);
      await writeJson(
        scenarioArtifacts.fillResponse,
        buildFillResponseArtifact({
          fixture,
          options,
          model,
          rawText: rawFillText,
          parse: fillParse,
          validation: fillValidation,
          response,
          now,
        }),
      );

      const formScore = await scoreFormToFile({
        repoRoot,
        scenarioId,
        filledFormPath: scenarioArtifacts.filledForm,
        outPath: scenarioArtifacts.formScoreReport,
      });
      const combinedScore = await scoreOpenSchemaCombinedToFile({
        repoRoot,
        openSchemaDatabaseReportPath: artifacts.openSchemaDatabaseScoreReport,
        formReportPath: scenarioArtifacts.formScoreReport,
        outPath: scenarioArtifacts.openSchemaCombinedScoreReport,
      });
      report.scenarios[scenarioId] = {
        artifacts: relativeScenarioArtifacts({ repoRoot, scenarioArtifacts }),
        summaries: {
          fill: response.summary,
          formScore: formScore.summary,
          combinedScore: combinedScore.summary,
        },
      };
      report.qualitySummary = buildPacketQualitySummary(report);
      await writeReport();
    }

    report.status = 'pass';
    report.endedAt = isoTimestamp(now);
    report.qualitySummary = buildPacketQualitySummary(report);
    await writeReport();

    return {
      exitCode: 0,
      lines: successLines({ repoRoot, options, artifacts, report, extraction }),
      report,
      extraction,
    };
  } catch (error) {
    report.status = 'fail';
    report.endedAt = isoTimestamp(now);
    report.error = error?.stack ?? error?.message ?? String(error);
    await writeReport().catch(() => {});
    return {
      exitCode: 1,
      lines: [
        'eval direct-open-schema-packet failed',
        `runId=${options.runId}`,
        `artifacts=${relativePath(repoRoot, artifacts.artifactsRoot)}`,
        '',
        error?.stack ?? error?.message ?? String(error),
      ],
      error,
    };
  }
}

export function parseArgs(args, env = process.env, now = () => new Date()) {
  if (args.includes('--help') || args.includes('-h')) return { kind: 'help' };

  const options = {
    provider: 'vertex',
    model: env.EVAL_DIRECT_OPEN_SCHEMA_MODEL,
    temperature: DEFAULT_TEMPERATURE,
    maxEvidenceChars: DEFAULT_MAX_EVIDENCE_CHARS,
    documentOrder: DEFAULT_DOCUMENT_ORDER,
    documentOrderSeed: DEFAULT_DOCUMENT_ORDER_SEED,
  };
  const valueArgs = new Set([
    '--user',
    '--corpus',
    '--scenarios',
    '--artifacts-root',
    '--documents-root',
    '--provider',
    '--model',
    '--temperature',
    '--max-evidence-chars',
    '--document-order',
    '--document-order-seed',
    '--run-id',
  ]);

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!valueArgs.has(arg)) {
      return { kind: 'usage-error', message: `Unsupported argument: ${arg}` };
    }
    const value = args[index + 1];
    if (!value || value.startsWith('--')) {
      return { kind: 'usage-error', message: `Missing value for ${arg}` };
    }
    index += 1;

    if (arg === '--user') options.userId = value;
    if (arg === '--corpus') options.corpusId = value;
    if (arg === '--scenarios') {
      options.scenarioIds = value.split(',').map((entry) => entry.trim()).filter(Boolean);
    }
    if (arg === '--artifacts-root') options.artifactsRoot = value;
    if (arg === '--documents-root') options.documentsRoot = value;
    if (arg === '--provider') options.provider = value;
    if (arg === '--model') options.model = value;
    if (arg === '--temperature') options.temperature = Number(value);
    if (arg === '--max-evidence-chars') options.maxEvidenceChars = Number(value);
    if (arg === '--document-order') options.documentOrder = value;
    if (arg === '--document-order-seed') options.documentOrderSeed = value;
    if (arg === '--run-id') options.runId = value;
  }

  for (const [key, flag] of [
    ['userId', '--user'],
    ['corpusId', '--corpus'],
    ['scenarioIds', '--scenarios'],
    ['artifactsRoot', '--artifacts-root'],
  ]) {
    if (!options[key] || (Array.isArray(options[key]) && options[key].length === 0)) {
      return { kind: 'usage-error', message: `Missing required ${flag}` };
    }
  }
  if (!isFixtureId(options.userId)) {
    return { kind: 'usage-error', message: '--user must be a fixture id.' };
  }
  if (!isFixtureId(options.corpusId)) {
    return { kind: 'usage-error', message: '--corpus must be a fixture id.' };
  }
  for (const scenarioId of options.scenarioIds) {
    if (!isFixtureId(scenarioId)) {
      return { kind: 'usage-error', message: '--scenarios must contain fixture ids.' };
    }
  }
  if (!PROVIDERS.has(options.provider)) {
    return { kind: 'usage-error', message: '--provider currently supports only vertex.' };
  }
  if (
    typeof options.temperature !== 'number' ||
    Number.isNaN(options.temperature) ||
    options.temperature < 0 ||
    options.temperature > 2
  ) {
    return { kind: 'usage-error', message: '--temperature must be a number from 0 to 2.' };
  }
  if (!isPositiveInteger(options.maxEvidenceChars)) {
    return { kind: 'usage-error', message: '--max-evidence-chars must be a positive integer.' };
  }
  const documentOrderError = validateDocumentOrder(options);
  if (documentOrderError) {
    return { kind: 'usage-error', message: documentOrderError };
  }
  if (!options.documentOrderSeed) {
    return { kind: 'usage-error', message: '--document-order-seed must be a non-empty string.' };
  }
  if (!options.model) {
    return {
      kind: 'usage-error',
      message: 'Set EVAL_DIRECT_OPEN_SCHEMA_MODEL or pass --model.',
    };
  }

  options.documentsRoot =
    options.documentsRoot ??
    path.join('examples/eval/users', options.userId, 'corpora', options.corpusId);
  options.runId = options.runId ?? generatedRunId(options, now);
  return { kind: 'ok', options };
}

export function usage() {
  return [
    'Usage:',
    '  pnpm eval:direct-open-schema-packet --user <userId> --corpus <corpusId> --scenarios <scenarioIds> --artifacts-root <dir> [options]',
    '',
    'Notes:',
    '  This is a no-storage direct Vertex packet baseline.',
    '  It extracts open-schema facts once from the corpus, then fills every listed form from that same extraction.',
    '  It does not call backend memory, MCP, GraphQL, or the DB.',
    '',
    'Options:',
    '  --documents-root <dir>           Defaults to examples/eval/users/<user>/corpora/<corpus>',
    '  --provider vertex                Only vertex is supported',
    '  --model <model>                  Defaults to EVAL_DIRECT_OPEN_SCHEMA_MODEL',
    '  --temperature <number>           Defaults to 0.2',
    `  --max-evidence-chars <int>       Defaults to ${DEFAULT_MAX_EVIDENCE_CHARS}`,
    '  --document-order <mode>          canonical|reverse|seeded-random|relevant-first|relevant-last',
    `  --document-order-seed <seed>     Defaults to ${DEFAULT_DOCUMENT_ORDER_SEED}`,
    '  --run-id <id>                    Defaults to direct-open-schema-packet-<user>-<corpus>-<timestamp>',
  ].join('\n');
}

function buildPacketArtifacts({ repoRoot, options }) {
  const root = path.resolve(repoRoot, options.artifactsRoot);
  const scenarios = {};
  for (const scenarioId of options.scenarioIds) {
    const scenarioRoot = path.join(root, 'scenarios', scenarioId);
    scenarios[scenarioId] = {
      root: scenarioRoot,
      fillPrompt: path.join(scenarioRoot, 'direct-open-schema-fill-prompt.md'),
      fillResponse: path.join(scenarioRoot, 'direct-open-schema-fill-response.json'),
      filledForm: path.join(scenarioRoot, 'filled-form.json'),
      filledPdf: path.join(scenarioRoot, 'filled-form.pdf'),
      formScoreReport: path.join(scenarioRoot, 'form-score-report.json'),
      openSchemaCombinedScoreReport: path.join(
        scenarioRoot,
        'open-schema-combined-score-report.json',
      ),
    };
  }
  return {
    artifactsRoot: root,
    packetRun: path.join(root, 'packet-evaluation-run.json'),
    validationReport: path.join(root, 'validation-report.json'),
    extractionPrompt: path.join(root, 'open-schema-extraction-prompt.md'),
    extractionResponse: path.join(root, 'open-schema-extraction-response.json'),
    extraction: path.join(root, 'open-schema-extraction.json'),
    syntheticMemorySnapshot: path.join(root, 'synthetic-memory-snapshot.json'),
    openSchemaDatabaseScoreReport: path.join(root, 'open-schema-database-score-report.json'),
    scenarios,
  };
}

function initialPacketReport({ repoRoot, options, artifacts, startedAt }) {
  return {
    schemaVersion: 1,
    artifactType: 'direct-open-schema-packet-evaluation-run',
    evaluationMode: 'direct-vertex-open-schema-packet',
    status: 'running',
    runId: options.runId,
    userId: options.userId,
    corpusId: options.corpusId,
    scenarioIds: options.scenarioIds,
    documentsRoot: options.documentsRoot,
    artifactsRoot: relativePath(repoRoot, artifacts.artifactsRoot),
    model: {
      label: options.model,
      source: 'manual',
    },
    settings: {
      provider: options.provider,
      temperature: options.temperature,
      promptVersion: EXTRACTION_PROMPT_VERSION,
      maxEvidenceChars: options.maxEvidenceChars,
      documentOrder: options.documentOrder,
      documentOrderSeed: options.documentOrderSeed,
    },
    documents: buildPacketDocumentMetadata({
      documents: [],
      documentOrder: options.documentOrder,
      documentOrderSeed: options.documentOrderSeed,
      maxEvidenceChars: options.maxEvidenceChars,
    }),
    artifacts: {
      validationReport: relativePath(repoRoot, artifacts.validationReport),
      extractionPrompt: relativePath(repoRoot, artifacts.extractionPrompt),
      extractionResponse: relativePath(repoRoot, artifacts.extractionResponse),
      extraction: relativePath(repoRoot, artifacts.extraction),
      syntheticMemorySnapshot: relativePath(repoRoot, artifacts.syntheticMemorySnapshot),
      openSchemaDatabaseScoreReport: relativePath(
        repoRoot,
        artifacts.openSchemaDatabaseScoreReport,
      ),
    },
    summaries: {},
    qualitySummary: null,
    scenarios: {},
    startedAt,
    endedAt: null,
    error: null,
  };
}

function assertPacketFixtureMatchesOptions({ fixture, options }) {
  if (fixture.scenario.userId !== options.userId) {
    throw new Error(
      `scenario ${fixture.scenario.scenarioId} userId ${fixture.scenario.userId} does not match ${options.userId}`,
    );
  }
  if (fixture.scenario.corpusId !== options.corpusId) {
    throw new Error(
      `scenario ${fixture.scenario.scenarioId} corpusId ${fixture.scenario.corpusId} does not match ${options.corpusId}`,
    );
  }
}

function buildExtractionResponseArtifact({
  fixture,
  options,
  model,
  rawText,
  parse,
  validation,
  now,
}) {
  return {
    schemaVersion: 1,
    artifactType: 'direct-open-schema-extraction-response',
    generatedAt: isoTimestamp(now),
    runId: options.runId,
    scenarioId: fixture.scenario.scenarioId,
    userId: fixture.scenario.userId,
    corpusId: fixture.scenario.corpusId,
    formId: fixture.scenario.formId,
    provider: options.provider,
    model,
    temperature: options.temperature,
    promptVersion: EXTRACTION_PROMPT_VERSION,
    rawText: String(rawText ?? ''),
    parsed: parse.parsed,
    parseDiagnostics: parse.parseDiagnostics,
    validationDiagnostics: validation.validationDiagnostics,
    factCount: validation.extraction?.facts?.length ?? 0,
    unresolvedCount: validation.extraction?.unresolved?.length ?? 0,
    droppedFactCount: validation.droppedFactCount ?? 0,
  };
}

function buildFillResponseArtifact({
  fixture,
  options,
  model,
  rawText,
  parse,
  validation,
  response,
  now,
}) {
  return {
    schemaVersion: 1,
    artifactType: 'direct-open-schema-fill-response',
    generatedAt: isoTimestamp(now),
    runId: options.runId,
    scenarioId: fixture.scenario.scenarioId,
    userId: fixture.scenario.userId,
    corpusId: fixture.scenario.corpusId,
    formId: fixture.scenario.formId,
    provider: options.provider,
    model,
    temperature: options.temperature,
    promptVersion: FILL_PROMPT_VERSION,
    rawText: String(rawText ?? ''),
    parsed: parse.parsed,
    parseDiagnostics: parse.parseDiagnostics,
    validationDiagnostics: validation.validationDiagnostics,
    actionValidationDiagnostics: validation.diagnostics,
    provenanceDiagnostics: validation.provenanceDiagnostics,
    warnings: validation.warnings,
    validActionCount: validation.validActions?.length ?? 0,
    skippedFieldCount: validation.skippedFields?.length ?? 0,
    responseSummary: response?.summary ?? null,
  };
}

function buildFormFillResponse({ fixture, filledPdfBytes, validationResult }) {
  const outputFilename = `direct-open-schema-filled-${path.basename(fixture.formPdfPath)}`;
  const summary = {
    totalFields: fixture.joinedFields.length,
    filledCount: validationResult.filledFields.length,
    skippedCount: validationResult.skippedFields.length,
    filledFields: validationResult.filledFields,
    skippedFields: validationResult.skippedFields,
    warnings: validationResult.warnings,
  };
  return {
    fillId: `direct-open-schema-${fixture.scenario.scenarioId}`,
    status: summary.skippedCount === 0 && summary.filledCount > 0 ? 'success' : 'partial',
    originalFilename: path.basename(fixture.formPdfPath),
    outputFilename,
    outputMimeType: 'application/pdf',
    filledPdfBase64: filledPdfBytes.toString('base64'),
    summary,
  };
}

function invalidExtractionValidation(validationDiagnostics = []) {
  return {
    ok: false,
    validationDiagnostics,
    droppedFactCount: 0,
    extraction: null,
  };
}

function invalidFillValidation(validationDiagnostics = []) {
  return {
    ok: false,
    validActions: [],
    filledFields: [],
    skippedFields: [],
    warnings: [],
    diagnostics: {
      missingConfidenceCount: 0,
      lowConfidenceCount: 0,
      invalidActionReasonCounts: {},
    },
    provenanceDiagnostics: {
      missingSourceFactIdCount: 0,
      unknownSourceFactIdCount: 0,
      duplicateSourceSlugCount: 0,
    },
    validationDiagnostics,
  };
}

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function relativeScenarioArtifacts({ repoRoot, scenarioArtifacts }) {
  return {
    fillPrompt: relativePath(repoRoot, scenarioArtifacts.fillPrompt),
    fillResponse: relativePath(repoRoot, scenarioArtifacts.fillResponse),
    filledForm: relativePath(repoRoot, scenarioArtifacts.filledForm),
    filledPdf: relativePath(repoRoot, scenarioArtifacts.filledPdf),
    formScoreReport: relativePath(repoRoot, scenarioArtifacts.formScoreReport),
    openSchemaCombinedScoreReport: relativePath(
      repoRoot,
      scenarioArtifacts.openSchemaCombinedScoreReport,
    ),
  };
}

function buildPacketQualitySummary(report) {
  const database = report.summaries.databaseScore;
  const scenarioSummaries = Object.entries(report.scenarios).map(
    ([scenarioId, scenario]) => [scenarioId, scenario.summaries.formScore],
  );
  const knownTotal = sum(scenarioSummaries.map(([, summary]) => summary.knownFieldTotal));
  const knownCorrect = sum(scenarioSummaries.map(([, summary]) => summary.knownFieldCorrect));
  const knownWrong = sum(scenarioSummaries.map(([, summary]) => summary.knownFieldWrong));
  const knownMissing = sum(scenarioSummaries.map(([, summary]) => summary.knownFieldMissing));
  const abstentionTotal = sum(
    scenarioSummaries.map(([, summary]) => summary.abstentionFieldTotal),
  );
  const abstentionCorrect = sum(
    scenarioSummaries.map(([, summary]) => summary.abstentionFieldAbsentCorrect),
  );
  const overfillCount = sum(
    scenarioSummaries.map(
      ([, summary]) =>
        (summary.structuralOverfillCount ?? 0) +
        (summary.manualAttestationOverfillCount ?? 0) +
        (summary.outOfScopeOverfillCount ?? 0) +
        (summary.unmappedOverfillCount ?? 0),
    ),
  );
  return {
    extractionFacts: report.summaries.extraction?.factCount ?? null,
    extractionUnresolved: report.summaries.extraction?.unresolvedCount ?? null,
    memoryKnownRecovered: database
      ? `${database.knownPresentRecoveredActive}/${database.knownPresentTotal}`
      : null,
    memoryMissingAbsent: database
      ? `${database.missingAbsentCorrect}/${database.intentionallyMissingTotal}`
      : null,
    memoryActiveValueRecoveryRate: database?.activeValueRecoveryRate ?? null,
    memoryOwnershipClean: database
      ? `${database.ownershipDecoyClean ?? 0}/${database.ownershipDecoyTotal ?? 0}`
      : null,
    memoryOwnershipForbiddenLeaks: database
      ? (database.ownershipDecoyForbiddenActiveLeak ?? 0)
        + (database.ownershipDecoyForbiddenSuggestionLeak ?? 0)
      : null,
    knownFieldCorrect: `${knownCorrect}/${knownTotal}`,
    knownFieldWrong: knownWrong,
    knownFieldMissing: knownMissing,
    knownFieldAccuracy: rate(knownCorrect, knownTotal),
    abstentionAbsentCorrect:
      abstentionTotal > 0 ? `${abstentionCorrect}/${abstentionTotal}` : null,
    overfillCount,
    perScenario: Object.fromEntries(
      scenarioSummaries.map(([scenarioId, summary]) => [
        scenarioId,
        {
          knownFieldCorrect: `${summary.knownFieldCorrect}/${summary.knownFieldTotal}`,
          knownFieldWrong: summary.knownFieldWrong,
          knownFieldMissing: summary.knownFieldMissing,
          knownFieldAccuracy: summary.knownFieldAccuracy,
          abstentionAbsentCorrect:
            summary.abstentionFieldTotal > 0
              ? `${summary.abstentionFieldAbsentCorrect}/${summary.abstentionFieldTotal}`
              : null,
          overfillCount:
            (summary.structuralOverfillCount ?? 0) +
            (summary.manualAttestationOverfillCount ?? 0) +
            (summary.outOfScopeOverfillCount ?? 0) +
            (summary.unmappedOverfillCount ?? 0),
        },
      ]),
    ),
  };
}

function successLines({ repoRoot, options, artifacts, report, extraction }) {
  return [
    'eval direct-open-schema-packet passed',
    `runId=${options.runId}`,
    `scenarios=${options.scenarioIds.length}`,
    `facts=${extraction.facts.length} unresolved=${extraction.unresolved.length}`,
    `memory-score=${relativePath(repoRoot, artifacts.openSchemaDatabaseScoreReport)}`,
    `packet-run=${relativePath(repoRoot, artifacts.packetRun)}`,
    `known-fields=${report.qualitySummary.knownFieldCorrect}`,
  ];
}

function failedResult({ lines }) {
  return {
    exitCode: 1,
    lines: ['eval direct-open-schema-packet failed', ...lines],
  };
}

function generatedRunId(options, now) {
  const value = now();
  const date = value instanceof Date ? value : new Date(value);
  return `direct-open-schema-packet-${options.userId}-${options.corpusId}-${date
    .toISOString()
    .replace(/[-:.TZ]/g, '')
    .slice(0, 14)}`;
}

function isoTimestamp(now) {
  const value = now();
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  return new Date(value).toISOString();
}

function sum(values) {
  return values.reduce((total, value) => total + (value ?? 0), 0);
}

function rate(numerator, denominator) {
  if (denominator === 0) return null;
  return Number((numerator / denominator).toFixed(3));
}

export function formatDirectOpenSchemaPacketResult(result) {
  return result.lines.join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await runDirectOpenSchemaPacket({ args: process.argv.slice(2) });
  console.log(formatDirectOpenSchemaPacketResult(result));
  process.exitCode = result.exitCode;
}
