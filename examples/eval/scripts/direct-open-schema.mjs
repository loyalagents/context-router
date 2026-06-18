#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRunPlan } from './eval-runner/actions.mjs';
import { loadScenarioFixture } from './eval-runner/fixtures.mjs';
import { loadBackendPdfLib, readFilledPdfFields } from './eval-runner/pdf.mjs';
import { buildFilledFormSnapshot } from './eval-runner/snapshots.mjs';
import {
  buildPromptFieldMetadata,
  fillPdfFromActions,
  loadEvidenceDocuments,
  normalizeTextValueForPdfField,
} from './fill-form-from-docs.mjs';
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
import { isFixtureId, toPosixPath } from './shared.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultRepoRoot = path.resolve(__dirname, '../../..');

const DEFAULT_TEMPERATURE = 0.2;
const DEFAULT_CONFIDENCE_THRESHOLD = 0.75;
const PROVIDERS = new Set(['vertex']);
const VALUE_TYPES = new Set(['STRING', 'BOOLEAN', 'ENUM', 'ARRAY']);
const FILL_ACTIONS = new Set(['SET_TEXT', 'CHECK', 'UNCHECK', 'SELECT_OPTION', 'SKIP']);
const EXTRACTION_PROMPT_VERSION = 'direct-open-schema-extraction-v4';
const FILL_PROMPT_VERSION = 'direct-open-schema-fill-v1';
const DIRECT_OPEN_SCHEMA_PRODUCER = 'direct-open-schema-vertex';
const DIRECT_OPEN_SCHEMA_EVALUATION_MODE = 'direct-vertex-open-schema';
const SYNTHETIC_SNAPSHOT_QUERY_NAME = 'SyntheticDirectOpenSchemaSnapshot';
const SYNTHETIC_SCHEMA_RESET_MODE = 'synthetic-no-backend';

export async function runDirectOpenSchema({
  repoRoot = defaultRepoRoot,
  args = [],
  env = process.env,
  generateExtractionResponse = null,
  generateFillResponse = null,
  pdfLib,
  now = () => new Date(),
} = {}) {
  const parsed = parseArgs(args, env, now);
  if (parsed.kind === 'help') {
    return { exitCode: 0, lines: [usage()] };
  }
  if (parsed.kind === 'usage-error') {
    return { exitCode: 2, lines: [parsed.message, '', usage()] };
  }

  const options = parsed.options;
  const artifacts = buildArtifacts({ repoRoot, artifactsRoot: options.artifactsRoot });
  let fixture = null;

  try {
    const validation = await runValidation({
      repoRoot,
      args: ['--scenario', options.scenarioId],
      writeReport: false,
      skipExpectedSnapshots: true,
    });
    if (validation.exitCode !== 0) {
      return {
        exitCode: 1,
        lines: [formatValidationResult(validation)],
      };
    }

    fixture = await loadScenarioFixture({ repoRoot, scenarioId: options.scenarioId });
    const documentsRoot = path.resolve(
      repoRoot,
      options.documentsRoot ??
        path.join('examples/eval/users', fixture.scenario.userId, 'corpora', fixture.scenario.corpusId),
    );
    const evidenceDocuments = await loadEvidenceDocuments({
      manifest: fixture.manifest,
      documentsRoot,
    });
    const fieldMetadata = buildDirectOpenSchemaFieldMetadata(
      buildPromptFieldMetadata(fixture),
    );
    const model = options.model;

    const extractionPrompt = buildExtractionPrompt({
      evidenceDocuments,
    });
    const extractionProvider =
      generateExtractionResponse ??
      ((prompt) =>
        generateWithVertex(prompt, {
          env,
          model,
          temperature: options.temperature,
        }));
    const rawExtractionText = await extractionProvider(extractionPrompt, {
      fixture,
      fieldMetadata,
      evidenceDocuments,
      model,
      temperature: options.temperature,
      stage: 'extract',
    });
    const extractionParse = parseJsonObjectResponse(rawExtractionText);
    const extractionValidation = extractionParse.parsed
      ? validateExtractionPayload({
          parsed: extractionParse.parsed,
          fixture,
          evidenceDocuments,
          runId: options.runId,
          model,
          provider: options.provider,
        })
      : invalidExtractionValidation();
    await writeJson(
      artifacts.extractionResponse,
      buildExtractionResponseArtifact({
        fixture,
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
        label: 'eval direct-open-schema failed',
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

    const fillPrompt = buildFactOnlyFillPrompt({ fieldMetadata, extraction });
    const fillProvider =
      generateFillResponse ??
      ((prompt) =>
        generateWithVertex(prompt, {
          env,
          model,
          temperature: options.temperature,
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

    const fillResponseArtifactBase = {
      fixture,
      options,
      model,
      rawText: rawFillText,
      parse: fillParse,
      validation: fillValidation,
      response: null,
      now,
    };

    if (!fillValidation.ok) {
      await writeJson(
        artifacts.fillResponse,
        buildFillResponseArtifact(fillResponseArtifactBase),
      );
      return failedResult({
        label: 'eval direct-open-schema failed',
        lines: [
          'stage=fill-form-from-extracted-facts',
          `response=${relativePath(repoRoot, artifacts.fillResponse)}`,
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
    const runPlan = buildRunPlan(fixture);
    const snapshot = buildFilledFormSnapshot({
      fixture,
      runPlan,
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
    await writeJson(artifacts.filledForm, snapshot);
    await mkdir(path.dirname(artifacts.filledPdf), { recursive: true });
    await writeFile(artifacts.filledPdf, filledPdfBytes);
    await writeJson(
      artifacts.fillResponse,
      buildFillResponseArtifact({
        ...fillResponseArtifactBase,
        response,
      }),
    );

    const formScore = await scoreFormToFile({
      repoRoot,
      scenarioId: options.scenarioId,
      filledFormPath: artifacts.filledForm,
      outPath: artifacts.formScoreReport,
    });

    let openSchemaDatabaseScore = null;
    let openSchemaCombinedScore = null;
    if (!options.skipExtractionScoring) {
      const memorySnapshot = buildSyntheticMemorySnapshot({
        fixture,
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
      openSchemaDatabaseScore = await scoreOpenSchemaDatabaseToFile({
        repoRoot,
        userId: fixture.scenario.userId,
        corpusId: fixture.scenario.corpusId,
        memorySnapshotPath: artifacts.syntheticMemorySnapshot,
        outPath: artifacts.openSchemaDatabaseScoreReport,
      });
      openSchemaCombinedScore = await scoreOpenSchemaCombinedToFile({
        repoRoot,
        openSchemaDatabaseReportPath: artifacts.openSchemaDatabaseScoreReport,
        formReportPath: artifacts.formScoreReport,
        outPath: artifacts.openSchemaCombinedScoreReport,
      });
    }

    return {
      exitCode: 0,
      lines: successLines({
        repoRoot,
        artifacts,
        extraction,
        response,
        formScore,
        openSchemaDatabaseScore,
        openSchemaCombinedScore,
        options,
        model,
      }),
      extraction,
      snapshot,
      response,
      fillValidation,
      prompt: {
        extraction: extractionPrompt,
        fill: fillPrompt,
      },
    };
  } catch (error) {
    return {
      exitCode: 1,
      lines: [
        'eval direct-open-schema failed',
        fixture ? `scenario=${fixture.scenario.scenarioId}` : 'scenario=<setup>',
        '',
        error?.stack ?? error?.message ?? String(error),
      ],
      error,
    };
  }
}

export function parseArgs(args, env = process.env, now = () => new Date()) {
  if (args.includes('--help') || args.includes('-h')) {
    return { kind: 'help' };
  }

  const options = {
    provider: 'vertex',
    model: env.EVAL_DIRECT_OPEN_SCHEMA_MODEL,
    temperature: DEFAULT_TEMPERATURE,
    skipExtractionScoring: false,
  };
  const valueArgs = new Set([
    '--scenario',
    '--artifacts-root',
    '--documents-root',
    '--provider',
    '--model',
    '--temperature',
    '--run-id',
  ]);

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--skip-extraction-scoring') {
      options.skipExtractionScoring = true;
      continue;
    }
    if (!valueArgs.has(arg)) {
      return { kind: 'usage-error', message: `Unsupported argument: ${arg}` };
    }
    const value = args[index + 1];
    if (!value || value.startsWith('--')) {
      return { kind: 'usage-error', message: `Missing value for ${arg}` };
    }
    index += 1;

    if (arg === '--scenario') options.scenarioId = value;
    if (arg === '--artifacts-root') options.artifactsRoot = value;
    if (arg === '--documents-root') options.documentsRoot = value;
    if (arg === '--provider') options.provider = value;
    if (arg === '--model') options.model = value;
    if (arg === '--temperature') options.temperature = Number(value);
    if (arg === '--run-id') options.runId = value;
  }

  for (const [key, flag] of [
    ['scenarioId', '--scenario'],
    ['artifactsRoot', '--artifacts-root'],
  ]) {
    if (!options[key]) {
      return { kind: 'usage-error', message: `Missing required ${flag}` };
    }
  }
  if (!isFixtureId(options.scenarioId)) {
    return { kind: 'usage-error', message: '--scenario must be a fixture id.' };
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
  if (!options.model) {
    return {
      kind: 'usage-error',
      message: 'Set EVAL_DIRECT_OPEN_SCHEMA_MODEL or pass --model.',
    };
  }

  options.runId = options.runId ?? generatedRunId(options, now);
  return { kind: 'ok', options };
}

export function usage() {
  return [
    'Usage:',
    '  pnpm eval:direct-open-schema --scenario <scenarioId> --artifacts-root <dir> [options]',
    '',
    'Notes:',
    '  This is a no-storage direct Vertex baseline. It does not call backend memory, MCP, GraphQL, or the DB.',
    '  Stage 1 extracts general open-schema user facts from declared corpus documents.',
    '  Stage 2 fills the form from extracted facts only; raw documents are not passed again.',
    '  Relative artifact paths are resolved from the repo root.',
    '',
    'Options:',
    '  --documents-root <dir>           Defaults to examples/eval/users/<scenario user>/corpora/<scenario corpus>',
    '  --provider vertex                Only vertex is supported',
    '  --model <model>                  Defaults to EVAL_DIRECT_OPEN_SCHEMA_MODEL',
    '  --temperature <number>           Defaults to 0.2',
    '  --run-id <id>                    Defaults to direct-open-schema-<scenario>-<timestamp>',
    '  --skip-extraction-scoring        Skip synthetic memory snapshot and PR2 diagnostic reports',
  ].join('\n');
}

export function buildExtractionPrompt({ evidenceDocuments }) {
  return [
    'You are extracting durable, document-supported user facts and preferences from a user evidence corpus.',
    'You are not filling a form in this stage. You do not know the future scenario or target form.',
    '',
    'Return JSON only. Do not include markdown fences or explanatory wrapper text.',
    'Return no more than 40 facts. Keep the output compact but broad enough to support future forms, applications, support workflows, or user-profile tasks.',
    'Do not return backend definitions, backend preference rows, memory snapshots, synthetic IDs, run metadata, or schema diagnostics.',
    'Extract only values supported by the supplied evidence documents.',
    'Do not infer or invent missing values.',
    'Extract broadly useful current facts such as names, contact details, addresses, dates, identifiers, status or eligibility details, document numbers, employer/school/household facts, and explicit user preferences when supported.',
    'Prefer current authoritative sources. Skip stale, noise, third-party, contradicted, or transient operational details unless needed to represent a current conflict or durable user preference.',
    'Do not exhaustively extract every account setting, message id, ticket id, notification flag, internal workflow status, or historical artifact.',
    'Preserve values as stated in evidence; do not render values for an unknown form.',
    'Use valueType STRING, BOOLEAN, ENUM, or ARRAY.',
    'For each fact, include at most two evidence entries.',
    'Each evidence.quote must be a short JSON-safe substring from the document, 160 characters or fewer, with no line breaks. Avoid snippets containing double quote characters; choose a nearby shorter supporting substring when possible.',
    'Evidence quotes must support the value, not only the surrounding topic.',
    'Use unresolved[] sparingly for user-relevant facts that the documents explicitly indicate are missing, unknown, or ambiguous. Do not add unresolved items just because a possible future form might ask for them.',
    '',
    'Allowed response shape:',
    JSON.stringify(
      {
        facts: [
          {
            slug: 'category.fact_name',
            label: 'Human readable fact label',
            valueType: 'STRING',
            value: 'document-supported value',
            confidence: 0.9,
            evidence: [
              {
                documentId: 'document-id-from-list',
                quote: 'short exact supporting substring',
              },
            ],
          },
        ],
        unresolved: [
          {
            label: 'Human readable missing or ambiguous fact',
            reason: 'Why the documents do not establish it.',
          },
        ],
      },
      null,
      2,
    ),
    '',
    'Evidence documents:',
    evidenceDocuments.map(formatEvidenceDocument).join('\n\n'),
  ].join('\n');
}

export function buildFactOnlyFillPrompt({ fieldMetadata, extraction }) {
  const safeFieldMetadata = buildDirectOpenSchemaFieldMetadata(fieldMetadata);
  return [
    'You are filling a fillable PDF form using only the extracted facts below.',
    '',
    'Return JSON only. Do not include markdown fences or explanatory wrapper text.',
    'Return exactly one fill action for every PDF field in the metadata list.',
    'Use exact case-sensitive fieldName values from the field metadata.',
    'For dropdown, radio, and option-list fields, use exact option value strings from the metadata.',
    'For text fields with maxLength metadata, return a value whose final text length is at or below maxLength.',
    'Field policy is authoritative.',
    'When fieldPolicy.action is "skip", return SKIP for that field even if extracted facts contain plausible values.',
    'Never fill fields with skip reasons manual_attestation, out_of_scope, or unmapped.',
    'Use SKIP when extracted facts are missing, contradicted, stale, ambiguous, or the field requires a signature/manual attestation.',
    'Do not infer or invent values that are not present in extracted facts.',
    'Every non-SKIP action must include at least one sourceFactIds entry using factId values from the extracted facts.',
    'Use sourceFactIds: [] for SKIP actions.',
    '',
    'Allowed response shape:',
    JSON.stringify(
      {
        fillActions: [
          {
            fieldName: 'exact PDF field name',
            action: 'SET_TEXT | CHECK | UNCHECK | SELECT_OPTION | SKIP',
            value: 'required only for SET_TEXT and SELECT_OPTION',
            sourceFactIds: ['fact-0001'],
            confidence: 0.0,
            skipReason: 'required when action is SKIP',
          },
        ],
      },
      null,
      2,
    ),
    '',
    'PDF field metadata:',
    JSON.stringify(safeFieldMetadata, null, 2),
    '',
    'Extracted facts:',
    JSON.stringify(
      extraction.facts.map((fact) => ({
        factId: fact.factId,
        slug: fact.slug,
        label: fact.label,
        valueType: fact.valueType,
        value: fact.value,
        confidence: fact.confidence,
      })),
      null,
      2,
    ),
    '',
    'Unresolved facts:',
    JSON.stringify(extraction.unresolved, null, 2),
  ].join('\n');
}

export function buildDirectOpenSchemaFieldMetadata(fieldMetadata) {
  return fieldMetadata.map((field) => ({
    fieldName: field.fieldName,
    fieldType: field.fieldType,
    ...(typeof field.maxLength === 'number' ? { maxLength: field.maxLength } : {}),
    inferredLabel: field.inferredLabel ?? null,
    fillPolicy: field.fillPolicy ?? null,
    fieldPolicy: directOpenSchemaFieldPolicy(field.fieldPolicy),
    options: Array.isArray(field.options) ? [...field.options] : [],
  }));
}

function directOpenSchemaFieldPolicy(fieldPolicy) {
  if (!fieldPolicy || typeof fieldPolicy !== 'object' || Array.isArray(fieldPolicy)) {
    return { action: 'fillable' };
  }
  const policy = {
    action: fieldPolicy.action === 'skip' ? 'skip' : 'fillable',
  };
  if (typeof fieldPolicy.reason === 'string' && fieldPolicy.reason.trim()) {
    policy.reason = fieldPolicy.reason;
  }
  if (typeof fieldPolicy.render === 'string' && fieldPolicy.render.trim()) {
    policy.render = fieldPolicy.render;
  }
  if (Array.isArray(fieldPolicy.branchValues)) {
    policy.branchValues = fieldPolicy.branchValues;
  }
  return policy;
}

export function parseJsonObjectResponse(text) {
  const trimmed = String(text ?? '').trim();
  const fence = trimmed.match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i);
  const body = fence ? fence[1].trim() : trimmed;
  const parseDiagnostics = [];
  let parsed = null;
  try {
    parsed = JSON.parse(body);
  } catch (error) {
    parseDiagnostics.push(`Model response was not valid JSON: ${error.message}`);
    return { parsed: null, parseDiagnostics };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    parseDiagnostics.push('Model response must be a JSON object.');
    return { parsed: null, parseDiagnostics };
  }
  return { parsed, parseDiagnostics };
}

export function validateExtractionPayload({
  parsed,
  fixture,
  evidenceDocuments,
  runId,
  model,
  provider,
}) {
  const validationDiagnostics = [];
  const hardDiagnostics = [];
  if (!Array.isArray(parsed.facts)) {
    const diagnostic = 'facts must be an array.';
    validationDiagnostics.push(diagnostic);
    hardDiagnostics.push(diagnostic);
  }
  const docIds = new Set(evidenceDocuments.map((doc) => doc.id));
  const facts = [];
  let droppedFactCount = 0;
  if (Array.isArray(parsed.facts)) {
    parsed.facts.forEach((fact, index) => {
      const factDiagnostics = [];
      const normalized = normalizeExtractedFact({
        fact,
        index,
        docIds,
        diagnostics: factDiagnostics,
      });
      if (normalized) {
        facts.push(normalized);
      } else {
        droppedFactCount += 1;
      }
      validationDiagnostics.push(...factDiagnostics);
    });
  }

  const unresolvedResult = normalizeUnresolved(parsed.unresolved);
  validationDiagnostics.push(...unresolvedResult.validationDiagnostics);
  if (hardDiagnostics.length > 0) {
    return {
      ok: false,
      validationDiagnostics,
      droppedFactCount,
      extraction: null,
    };
  }

  return {
    ok: true,
    validationDiagnostics,
    droppedFactCount,
    extraction: {
      schemaVersion: 1,
      artifactType: 'direct-open-schema-extraction',
      runId,
      evaluationMode: DIRECT_OPEN_SCHEMA_EVALUATION_MODE,
      scenarioId: fixture.scenario.scenarioId,
      userId: fixture.scenario.userId,
      corpusId: fixture.scenario.corpusId,
      formId: fixture.scenario.formId,
      provider,
      model,
      promptVersion: EXTRACTION_PROMPT_VERSION,
      facts,
      unresolved: unresolvedResult.unresolved,
      diagnostics: buildExtractionDiagnostics(facts, unresolvedResult.unresolved, {
        droppedFactCount,
      }),
    },
  };
}

export function validateFactFillActions({
  actions,
  fields,
  facts,
  confidenceThreshold = DEFAULT_CONFIDENCE_THRESHOLD,
}) {
  const warnings = [];
  const validationDiagnostics = [];
  const provenanceDiagnostics = {
    missingSourceFactIdCount: 0,
    unknownSourceFactIdCount: 0,
    duplicateSourceSlugCount: 0,
  };
  const diagnostics = {
    missingConfidenceCount: 0,
    lowConfidenceCount: 0,
    invalidActionReasonCounts: {},
  };
  if (!Array.isArray(actions)) {
    validationDiagnostics.push('fillActions must be an array.');
    return invalidFillValidation(validationDiagnostics);
  }

  const factById = new Map(facts.map((fact) => [fact.factId, fact]));
  const fieldByName = new Map(fields.map((field) => [field.fieldName, field]));
  const actionByField = new Map();
  for (const action of actions) {
    if (!action || typeof action !== 'object') {
      warnings.push('AI returned a non-object fill action; ignoring action');
      continue;
    }
    if (!fieldByName.has(action.fieldName)) {
      warnings.push(`AI returned unknown field "${String(action.fieldName)}"; ignoring action`);
      continue;
    }
    if (actionByField.has(action.fieldName)) {
      warnings.push(`AI returned duplicate action for "${action.fieldName}"; ignoring duplicate`);
      continue;
    }
    actionByField.set(action.fieldName, action);
  }

  const validActions = [];
  const filledFields = [];
  const skippedFields = [];

  for (const field of fields) {
    const action = actionByField.get(field.fieldName);
    if (!action) {
      skippedFields.push(skipField(field, 'not returned by AI'));
      continue;
    }
    const invalidReason = invalidFactFillActionReason({
      action,
      field,
      factById,
      provenanceDiagnostics,
    });
    if (invalidReason) {
      countInvalidActionReason(diagnostics, invalidReason);
      skippedFields.push(skipField(field, invalidReason, action.confidence, []));
      continue;
    }
    if (action.action === 'SKIP') {
      skippedFields.push(
        skipField(
          field,
          typeof action.skipReason === 'string' && action.skipReason.trim()
            ? action.skipReason.trim()
            : 'AI skipped field',
          action.confidence,
          sourceSlugsForAction(action, factById),
        ),
      );
      continue;
    }

    const confidence = confidenceForFilledAction({
      action,
      diagnostics,
      confidenceThreshold,
    });
    const sourceSlugs = sourceSlugsForAction(action, factById);
    const validAction = {
      fieldName: action.fieldName,
      fieldType: field.fieldType,
      action: action.action,
      value: action.value,
      sourceSlugs,
      confidence,
    };
    validActions.push(validAction);
    filledFields.push({
      pdfFieldName: field.fieldName,
      fieldType: field.fieldType,
      sourceSlugs,
      confidence,
    });
  }

  appendConfidenceWarnings(warnings, diagnostics, confidenceThreshold);
  provenanceDiagnostics.duplicateSourceSlugCount = countDuplicateSourceSlugs(
    validActions,
  );
  return {
    ok: true,
    validActions,
    filledFields,
    skippedFields,
    warnings,
    diagnostics,
    provenanceDiagnostics,
    validationDiagnostics,
  };
}

export function buildSyntheticMemorySnapshot({
  fixture,
  extraction,
  runId,
  exportedAt,
}) {
  const definitions = extraction.facts.map((fact) => syntheticDefinitionForFact(fact));
  const preferences = extraction.facts.map((fact) =>
    syntheticPreferenceForFact({ fact, userId: fixture.scenario.userId, exportedAt }),
  );
  return {
    schemaVersion: 1,
    artifactType: 'memory-snapshot',
    runId,
    evaluationMode: DIRECT_OPEN_SCHEMA_EVALUATION_MODE,
    userId: fixture.scenario.userId,
    corpusId: fixture.scenario.corpusId,
    scenarioId: fixture.scenario.scenarioId,
    storageInput: {
      schemaMode: 'open',
      producer: DIRECT_OPEN_SCHEMA_PRODUCER,
      statusesScored: ['ACTIVE'],
      suggestionsWereAutoApplied: false,
    },
    preferences,
    suggestions: [],
    definitions,
    definitionBaseline: {
      capturedBeforeRun: false,
      capturedAt: null,
      strategy: SYNTHETIC_SCHEMA_RESET_MODE,
      preexistingDefinitionIds: [],
      preexistingSlugs: [],
      newDefinitionIds: definitions.map((definition) => definition.id).sort(),
      newSlugs: [...new Set(definitions.map((definition) => definition.slug))].sort(),
      removedDefinitionIds: [],
      removedSlugs: [],
    },
    diagnostics: {
      exportedAt,
      graphqlUrl: 'synthetic://direct-open-schema',
      queryName: SYNTHETIC_SNAPSHOT_QUERY_NAME,
      locationMode: 'global-only',
      locationId: null,
      preferencesMergedWithLocation: false,
      includeSuggestions: false,
      activePreferenceCount: preferences.length,
      suggestedPreferenceCount: 0,
      definitionCount: definitions.length,
      backendUserId: null,
      schemaMode: 'open',
      schemaResetMode: SYNTHETIC_SCHEMA_RESET_MODE,
    },
  };
}

function buildArtifacts({ repoRoot, artifactsRoot }) {
  const root = path.resolve(repoRoot, artifactsRoot);
  return {
    artifactsRoot: root,
    extractionResponse: path.join(root, 'open-schema-extraction-response.json'),
    extraction: path.join(root, 'open-schema-extraction.json'),
    fillResponse: path.join(root, 'direct-open-schema-fill-response.json'),
    filledForm: path.join(root, 'filled-form.json'),
    filledPdf: path.join(root, 'filled-form.pdf'),
    formScoreReport: path.join(root, 'form-score-report.json'),
    syntheticMemorySnapshot: path.join(root, 'synthetic-memory-snapshot.json'),
    openSchemaDatabaseScoreReport: path.join(root, 'open-schema-database-score-report.json'),
    openSchemaCombinedScoreReport: path.join(root, 'open-schema-combined-score-report.json'),
  };
}

function formatEvidenceDocument(doc) {
  return [
    `--- doc:${doc.id} ---`,
    `documentId: ${doc.id}`,
    `title: ${doc.title}`,
    `path: ${doc.path}`,
    doc.category ? `category: ${doc.category}` : null,
    'content:',
    doc.content,
  ].filter((line) => line != null).join('\n');
}

function normalizeExtractedFact({ fact, index, docIds, diagnostics }) {
  const pathLabel = `facts[${index}]`;
  if (!fact || typeof fact !== 'object' || Array.isArray(fact)) {
    diagnostics.push(`${pathLabel} must be an object.`);
    return null;
  }
  const slug = modelString(fact.slug);
  const label = modelString(fact.label);
  const valueType = modelString(fact.valueType);
  if (!slug) diagnostics.push(`${pathLabel}.slug must be a non-empty string.`);
  if (!label) diagnostics.push(`${pathLabel}.label must be a non-empty string.`);
  if (!VALUE_TYPES.has(valueType)) {
    diagnostics.push(`${pathLabel}.valueType must be STRING, BOOLEAN, ENUM, or ARRAY.`);
  }
  if (!Object.hasOwn(fact, 'value')) {
    diagnostics.push(`${pathLabel}.value is missing.`);
  } else if (!valueMatchesType(fact.value, valueType)) {
    diagnostics.push(`${pathLabel}.value does not match valueType ${valueType}.`);
  }
  const confidence =
    typeof fact.confidence === 'number' && fact.confidence >= 0 && fact.confidence <= 1
      ? fact.confidence
      : null;
  if (fact.confidence !== undefined && confidence === null) {
    diagnostics.push(`${pathLabel}.confidence must be a number from 0 to 1 when present.`);
  }
  const evidence = normalizeEvidence({
    evidence: fact.evidence,
    docIds,
    pathLabel,
    diagnostics,
  });
  if (!slug || !label || !VALUE_TYPES.has(valueType) || !Object.hasOwn(fact, 'value')) {
    return null;
  }
  if (!valueMatchesType(fact.value, valueType) || evidence === null) return null;

  return {
    factId: `fact-${String(index + 1).padStart(4, '0')}`,
    slug,
    label,
    valueType,
    value: fact.value,
    confidence,
    evidence,
  };
}

function normalizeEvidence({ evidence, docIds, pathLabel, diagnostics }) {
  if (!Array.isArray(evidence) || evidence.length === 0) {
    diagnostics.push(`${pathLabel}.evidence must be a non-empty array.`);
    return null;
  }
  const rows = [];
  evidence.forEach((entry, index) => {
    const entryPath = `${pathLabel}.evidence[${index}]`;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      diagnostics.push(`${entryPath} must be an object.`);
      return;
    }
    const documentId = modelString(entry.documentId);
    const quote = modelString(entry.quote);
    if (!documentId) diagnostics.push(`${entryPath}.documentId must be a non-empty string.`);
    if (documentId && !docIds.has(documentId)) {
      diagnostics.push(`${entryPath}.documentId ${documentId} is not in the declared corpus.`);
    }
    if (!quote) diagnostics.push(`${entryPath}.quote must be a non-empty string.`);
    if (documentId && docIds.has(documentId) && quote) {
      rows.push({ documentId, quote });
    }
  });
  return rows.length === evidence.length ? rows : null;
}

function normalizeUnresolved(unresolved) {
  const validationDiagnostics = [];
  if (unresolved == null) {
    return { unresolved: [], validationDiagnostics };
  }
  if (!Array.isArray(unresolved)) {
    validationDiagnostics.push('unresolved must be an array when present.');
    return { unresolved: [], validationDiagnostics };
  }
  const rows = [];
  unresolved.forEach((entry, index) => {
    const pathLabel = `unresolved[${index}]`;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      validationDiagnostics.push(`${pathLabel} must be an object.`);
      return;
    }
    const label = modelString(entry.label);
    const reason = modelString(entry.reason);
    if (!label) validationDiagnostics.push(`${pathLabel}.label must be a non-empty string.`);
    if (!reason) validationDiagnostics.push(`${pathLabel}.reason must be a non-empty string.`);
    if (label && reason) rows.push({ label, reason });
  });
  return { unresolved: rows, validationDiagnostics };
}

function buildExtractionDiagnostics(facts, unresolved, { droppedFactCount = 0 } = {}) {
  const slugGroups = new Map();
  for (const fact of facts) {
    const rows = slugGroups.get(fact.slug) ?? [];
    rows.push(fact.factId);
    slugGroups.set(fact.slug, rows);
  }
  return {
    factCount: facts.length,
    unresolvedCount: unresolved.length,
    droppedFactCount,
    duplicateSlugGroups: [...slugGroups.entries()]
      .filter(([, factIds]) => factIds.length > 1)
      .map(([slug, factIds]) => ({ slug, factIds }))
      .sort((left, right) => left.slug.localeCompare(right.slug)),
  };
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

function invalidFactFillActionReason({ action, field, factById, provenanceDiagnostics }) {
  if (!FILL_ACTIONS.has(action.action)) {
    return `unsupported action ${String(action.action)}`;
  }
  if (action.action !== 'SKIP' && !isCompatible(action.action, field.fieldType)) {
    return `action ${action.action} is not compatible with ${field.fieldType} fields`;
  }
  if (
    (action.action === 'SET_TEXT' || action.action === 'SELECT_OPTION') &&
    (typeof action.value !== 'string' || !action.value.trim())
  ) {
    return 'missing value';
  }
  if (action.action === 'SELECT_OPTION') {
    const optionValues = new Set(field.options ?? []);
    if (!optionValues.has(action.value)) {
      return `selected option "${action.value}" is not available`;
    }
  }
  if (action.action === 'SET_TEXT' && typeof field.maxLength === 'number') {
    const valueLength = normalizeTextValueForPdfField(action).length;
    if (valueLength > field.maxLength) {
      return `text length ${valueLength} exceeds PDF field maxLength ${field.maxLength}`;
    }
  }
  if (action.action === 'SKIP') return null;
  if (!Array.isArray(action.sourceFactIds) || action.sourceFactIds.length === 0) {
    provenanceDiagnostics.missingSourceFactIdCount += 1;
    return 'missing source fact id';
  }
  for (const factId of action.sourceFactIds) {
    if (!factById.has(factId)) {
      provenanceDiagnostics.unknownSourceFactIdCount += 1;
      return `unknown source fact id "${String(factId)}"`;
    }
  }
  return null;
}

function sourceSlugsForAction(action, factById) {
  if (!Array.isArray(action.sourceFactIds)) return [];
  const slugs = [];
  for (const factId of action.sourceFactIds) {
    const fact = factById.get(factId);
    if (fact) slugs.push(fact.slug);
  }
  return [...new Set(slugs)];
}

function confidenceForFilledAction({ action, diagnostics, confidenceThreshold }) {
  if (typeof action.confidence !== 'number') {
    diagnostics.missingConfidenceCount += 1;
    return null;
  }
  if (action.confidence < confidenceThreshold) {
    diagnostics.lowConfidenceCount += 1;
  }
  return action.confidence;
}

function appendConfidenceWarnings(warnings, diagnostics, confidenceThreshold) {
  if (diagnostics.missingConfidenceCount > 0) {
    warnings.push(
      `${diagnostics.missingConfidenceCount} non-SKIP action(s) omitted confidence; accepted with unknown confidence.`,
    );
  }
  if (diagnostics.lowConfidenceCount > 0) {
    warnings.push(
      `${diagnostics.lowConfidenceCount} non-SKIP action(s) reported confidence below ${confidenceThreshold}; accepted because confidence is diagnostic only.`,
    );
  }
}

function countInvalidActionReason(diagnostics, reason) {
  diagnostics.invalidActionReasonCounts[reason] =
    (diagnostics.invalidActionReasonCounts[reason] ?? 0) + 1;
}

function countDuplicateSourceSlugs(actions) {
  return actions.filter((action) => {
    const slugs = action.sourceSlugs ?? [];
    return new Set(slugs).size !== slugs.length;
  }).length;
}

function isCompatible(action, fieldType) {
  if (fieldType === 'text') return action === 'SET_TEXT';
  if (fieldType === 'checkbox') return action === 'CHECK' || action === 'UNCHECK';
  if (fieldType === 'radio' || fieldType === 'dropdown' || fieldType === 'option_list') {
    return action === 'SELECT_OPTION';
  }
  return false;
}

function skipField(field, reason, confidence, sourceSlugs = []) {
  return {
    pdfFieldName: field.fieldName,
    fieldType: field.fieldType,
    reason,
    confidence: typeof confidence === 'number' ? confidence : null,
    sourceSlugs,
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

function syntheticDefinitionForFact(fact) {
  return {
    id: syntheticId('definition', fact.factId),
    namespace: 'direct-open-schema',
    slug: fact.slug,
    displayName: fact.label,
    ownerUserId: null,
    archivedAt: null,
    description: '',
    valueType: fact.valueType,
    scope: 'USER',
    options: null,
    isSensitive: false,
    isCore: false,
    category: 'direct-open-schema',
  };
}

function syntheticPreferenceForFact({ fact, userId, exportedAt }) {
  return {
    id: syntheticId('preference', `${fact.factId}:${JSON.stringify(fact.value)}`),
    userId,
    locationId: null,
    slug: fact.slug,
    definitionId: syntheticId('definition', fact.factId),
    value: fact.value,
    status: 'ACTIVE',
    sourceType: 'DIRECT_OPEN_SCHEMA_EXTRACTION',
    confidence: fact.confidence,
    evidence: {
      factId: fact.factId,
      evidence: fact.evidence,
    },
    createdAt: exportedAt,
    updatedAt: exportedAt,
  };
}

function syntheticId(kind, input) {
  return `synthetic-${kind}:${createHash('sha256').update(input).digest('hex').slice(0, 16)}`;
}

function modelString(value) {
  return typeof value === 'string' && value.trim() ? value : null;
}

function valueMatchesType(value, valueType) {
  if (valueType === 'STRING' || valueType === 'ENUM') {
    return typeof value === 'string' && value.length > 0;
  }
  if (valueType === 'BOOLEAN') return typeof value === 'boolean';
  if (valueType === 'ARRAY') return Array.isArray(value);
  return false;
}

function failedResult({ label, lines }) {
  return {
    exitCode: 1,
    lines: [label, ...lines],
  };
}

function successLines({
  repoRoot,
  artifacts,
  extraction,
  response,
  formScore,
  openSchemaDatabaseScore,
  openSchemaCombinedScore,
  options,
  model,
}) {
  const lines = [
    'eval direct-open-schema passed',
    `runId=${options.runId}`,
    `facts=${extraction.facts.length} unresolved=${extraction.unresolved.length}`,
    `status=${response.status} filled=${response.summary.filledCount} skipped=${response.summary.skippedCount}`,
    `form-score known=${formScore.summary.knownFieldTotal} abstention=${formScore.summary.abstentionFieldTotal}`,
    `model=${model}`,
    `artifacts=${relativePath(repoRoot, artifacts.artifactsRoot)}`,
    `extraction=${relativePath(repoRoot, artifacts.extraction)}`,
    `filled-form=${relativePath(repoRoot, artifacts.filledForm)}`,
    `filled-pdf=${relativePath(repoRoot, artifacts.filledPdf)}`,
    `form-score-report=${relativePath(repoRoot, artifacts.formScoreReport)}`,
  ];
  if (openSchemaDatabaseScore && openSchemaCombinedScore) {
    lines.push(
      `open-schema-db known=${openSchemaDatabaseScore.summary.knownPresentTotal} missing=${openSchemaDatabaseScore.summary.intentionallyMissingTotal}`,
    );
    lines.push(
      `open-schema-combined facts=${openSchemaCombinedScore.summary.factTotal}`,
    );
    lines.push(
      `synthetic-memory-snapshot=${relativePath(repoRoot, artifacts.syntheticMemorySnapshot)}`,
    );
  }
  return lines;
}

function generatedRunId(options, now) {
  const value = now();
  const date = value instanceof Date ? value : new Date(value);
  const timestamp = date.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  return `direct-open-schema-${options.scenarioId}-${timestamp}`;
}

function isoTimestamp(now) {
  const value = now();
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  return new Date(value).toISOString();
}

export function formatDirectOpenSchemaResult(result) {
  return result.lines.join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await runDirectOpenSchema({ args: process.argv.slice(2) });
  console.log(formatDirectOpenSchemaResult(result));
  process.exitCode = result.exitCode;
}
