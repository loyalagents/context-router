#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson, readYaml, relativePath, validateWithSchema, writeJson } from './scoring/io.mjs';
import { scoreDatabaseToFile } from './scoring/database.mjs';
import { runExportStoredPreferences } from './export-stored-preferences.mjs';
import {
  applyPreferenceSuggestions,
  createPreferenceDefinition,
  fetchBackendUser,
  fetchPreferenceSchema,
  inferMimeType,
  resetMemory,
  setPreference,
  uploadDocumentForAnalysis,
} from './ingestor/client.mjs';
import {
  buildDefinitionInput,
  collectDefinitionTargets,
  existingDefinitionMap,
  summarizeDefinitionTarget,
} from './ingestor/definitions.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultRepoRoot = path.resolve(__dirname, '../../..');
const DEFAULT_BACKEND_URL = 'http://localhost:3000';
const DEFAULT_GRAPHQL_URL = 'http://localhost:3000/graphql';
const INGESTION_MODE = 'known-schema-document-ingestion';

export async function runIngestDocuments({
  repoRoot = defaultRepoRoot,
  args = [],
  env = process.env,
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
  exportStoredPreferencesImpl = runExportStoredPreferences,
  scoreDatabaseToFileImpl = scoreDatabaseToFile,
} = {}) {
  const parsed = parseArgs(args, env);
  if (parsed.kind === 'help') {
    return { exitCode: 0, lines: [usage()] };
  }
  if (parsed.kind === 'usage-error') {
    return { exitCode: 2, lines: [parsed.message, '', usage()] };
  }

  const options = parsed.options;
  const outPath = path.resolve(repoRoot, options.out);
  const startedAt = isoTimestamp(now);
  const report = initialReport({ options, startedAt });

  try {
    const fixture = await loadFixture({ repoRoot, options });
    report.summary.documentCount = fixture.manifest.documents.length;

    const backendUser = await fetchBackendUser({
      graphqlUrl: options.graphqlUrl,
      authToken: options.authToken,
      fetchImpl,
    });
    report.backendUserId = backendUser.userId;

    if (options.resetMemory) {
      report.reset = await resetMemory({
        graphqlUrl: options.graphqlUrl,
        authToken: options.authToken,
        fetchImpl,
      });
    }

    const definitionTargets = collectDefinitionTargets(fixture);
    report.definitionSetup = await ensureDefinitions({
      options,
      targets: definitionTargets,
      fetchImpl,
    });
    report.summary.createdDefinitionCount = report.definitionSetup.created.length;

    if (options.seedPreferencesPath) {
      report.seedPreferences = await seedPreferences({
        options,
        repoRoot,
        fetchImpl,
      });
      report.summary.seedPreferenceCount = report.seedPreferences.length;
    }

    for (const doc of fixture.manifest.documents) {
      try {
        const docReport = await ingestDocument({
          options,
          repoRoot,
          documentsRoot: fixture.documentsRoot,
          doc,
          fetchImpl,
        });
        report.documents.push(docReport);
        updateDocumentCounts(report);
      } catch (error) {
        if (error instanceof HardDocumentFailure) {
          report.documents.push(error.docReport);
          updateDocumentCounts(report);
          throw new Error(`Document ${doc.path} failed: ${error.docReport.error}`);
        }
        throw error;
      }
    }

    if (options.exportStoredPreferencesPath) {
      const exportResult = await exportStoredPreferencesImpl({
        repoRoot,
        args: exportArgs(options),
        env: {},
        fetchImpl,
        now,
      });
      if (exportResult.exitCode !== 0) {
        throw new Error(exportResult.lines.join('\n'));
      }
      report.export = {
        path: relativePath(repoRoot, path.resolve(repoRoot, options.exportStoredPreferencesPath)),
      };
    }

    if (options.databaseScoreReportPath) {
      await scoreDatabaseToFileImpl({
        repoRoot,
        userId: options.evalUserId,
        corpusId: options.corpusId,
        storedPreferencesPath: path.resolve(repoRoot, options.exportStoredPreferencesPath),
        outPath: path.resolve(repoRoot, options.databaseScoreReportPath),
      });
      report.databaseScore = {
        path: relativePath(repoRoot, path.resolve(repoRoot, options.databaseScoreReportPath)),
      };
    }

    const hasDocumentFailures = report.summary.failedDocumentCount > 0;
    report.status = hasDocumentFailures ? 'fail' : 'pass';
    if (hasDocumentFailures) {
      report.error = `${report.summary.failedDocumentCount} document(s) failed during ingestion; requested post-ingestion steps completed for the partial run.`;
    }
    report.endedAt = isoTimestamp(now);
    await writeValidatedReport({ repoRoot, outPath, report });
    if (hasDocumentFailures) {
      return {
        exitCode: 1,
        lines: [
          'eval ingest-documents failed',
          `documents=${report.summary.documentCount} uploaded=${report.summary.uploadedCount} failed=${report.summary.failedDocumentCount} applied=${report.summary.appliedSuggestionCount}`,
          `backendUser=${report.backendUserId}`,
          `wrote ${relativePath(repoRoot, outPath)}`,
          '',
          report.error,
        ],
      };
    }
    return {
      exitCode: 0,
      lines: [
        'eval ingest-documents passed',
        `documents=${report.summary.documentCount} uploaded=${report.summary.uploadedCount} applied=${report.summary.appliedSuggestionCount}`,
        `backendUser=${report.backendUserId}`,
        `wrote ${relativePath(repoRoot, outPath)}`,
      ],
    };
  } catch (error) {
    report.status = 'fail';
    report.error = redactSecret(
      error?.stack ?? error?.message ?? String(error),
      options.authToken,
    );
    report.endedAt = isoTimestamp(now);
    updateDocumentCounts(report);
    try {
      await writeValidatedReport({ repoRoot, outPath, report });
    } catch {
      // Preserve the primary failure in CLI output if partial report writing fails.
    }
    return {
      exitCode: 1,
      lines: ['eval ingest-documents failed', '', report.error],
      error,
    };
  }
}

export function parseArgs(args, env = process.env) {
  if (args.includes('--help') || args.includes('-h')) {
    return { kind: 'help' };
  }

  const options = {
    backendUrl: env.EVAL_BACKEND_URL || DEFAULT_BACKEND_URL,
    graphqlUrl: env.EVAL_GRAPHQL_URL || DEFAULT_GRAPHQL_URL,
    authToken: env.EVAL_AUTH_TOKEN,
    resetMemory: false,
    ensureDefinitions: true,
    autoApply: true,
  };

  const valueArgs = new Set([
    '--user',
    '--corpus',
    '--documents-root',
    '--out',
    '--backend-url',
    '--graphql-url',
    '--auth-token',
    '--seed-preferences',
    '--export-stored-preferences',
    '--database-score-report',
    '--location-id',
    '--run-id',
  ]);

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--reset-memory') {
      options.resetMemory = true;
      continue;
    }
    if (arg === '--skip-ensure-definitions') {
      options.ensureDefinitions = false;
      continue;
    }
    if (arg === '--no-auto-apply') {
      options.autoApply = false;
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

    if (arg === '--user') options.evalUserId = value;
    if (arg === '--corpus') options.corpusId = value;
    if (arg === '--documents-root') options.documentsRoot = value;
    if (arg === '--out') options.out = value;
    if (arg === '--backend-url') options.backendUrl = value;
    if (arg === '--graphql-url') options.graphqlUrl = value;
    if (arg === '--auth-token') options.authToken = value;
    if (arg === '--seed-preferences') options.seedPreferencesPath = value;
    if (arg === '--export-stored-preferences') options.exportStoredPreferencesPath = value;
    if (arg === '--database-score-report') options.databaseScoreReportPath = value;
    if (arg === '--location-id') options.locationId = value;
    if (arg === '--run-id') options.runId = value;
  }

  for (const key of ['evalUserId', 'corpusId', 'documentsRoot', 'out']) {
    if (!options[key]) {
      return { kind: 'usage-error', message: `Missing required ${optionName(key)}` };
    }
  }
  if (!options.authToken) {
    return {
      kind: 'usage-error',
      message: 'Missing required --auth-token or EVAL_AUTH_TOKEN',
    };
  }
  if (options.databaseScoreReportPath && !options.exportStoredPreferencesPath) {
    return {
      kind: 'usage-error',
      message: 'Expected --export-stored-preferences when --database-score-report is used',
    };
  }

  return { kind: 'ok', options };
}

export function usage() {
  return [
    'Usage:',
    '  pnpm eval:ingest-documents --user <evalUserId> --corpus <corpusId> --documents-root <dir> --out <ingestion-run.json> [options]',
    '',
    'Notes:',
    '  This is a known-schema document ingestion benchmark, not open-schema slug discovery.',
    '  Relative file paths are resolved from the repo root.',
    '  Prefer EVAL_AUTH_TOKEN over --auth-token to avoid shell history and process-list exposure.',
    '',
    'Options:',
    '  --backend-url <url>                       Defaults to EVAL_BACKEND_URL or http://localhost:3000',
    '  --graphql-url <url>                       Defaults to EVAL_GRAPHQL_URL or http://localhost:3000/graphql',
    '  --auth-token <token>                      Defaults to EVAL_AUTH_TOKEN',
    '  --reset-memory                           Clear current backend user memory before ingestion',
    '  --skip-ensure-definitions                Do not create missing known-schema definitions',
    '  --seed-preferences <file>                 Set explicit seed preferences before upload',
    '  --no-auto-apply                           Upload and record suggestions without applying them',
    '  --export-stored-preferences <file>        Export stored-preferences.json after ingestion',
    '  --database-score-report <file>            Score exported preferences after ingestion',
    '  --location-id <locationId>                Export merged global + location view',
    '  --run-id <id>',
  ].join('\n');
}

export function formatIngestDocumentsResult(result) {
  return result.lines.join('\n');
}

async function loadFixture({ repoRoot, options }) {
  const userRoot = path.join(repoRoot, 'examples/eval/users', options.evalUserId);
  const corpusRoot = path.join(userRoot, 'corpora', options.corpusId);
  const [profile, manifest, storageMap] = await Promise.all([
    readYaml(path.join(userRoot, 'profile.yaml')),
    readJson(path.join(corpusRoot, 'manifest.json')),
    readJson(path.join(repoRoot, 'examples/eval/scoring/fact-storage-map.v1.json')),
  ]);
  return {
    profile,
    manifest,
    storageMap,
    documentsRoot: path.resolve(repoRoot, options.documentsRoot),
  };
}

async function ensureDefinitions({ options, targets, fetchImpl }) {
  const setup = { created: [], existing: [], skipped: [] };
  if (!options.ensureDefinitions) {
    setup.skipped = targets.map((target) =>
      summarizeDefinitionTarget(target, { reason: 'definition setup disabled' }),
    );
    return setup;
  }

  const definitions = await fetchPreferenceSchema({
    graphqlUrl: options.graphqlUrl,
    authToken: options.authToken,
    fetchImpl,
  });
  const existing = existingDefinitionMap(definitions);

  for (const target of targets) {
    const existingDefinition = existing.get(target.slug);
    if (existingDefinition) {
      assertExistingDefinitionCompatible({ target, existingDefinition });
    }
  }

  for (const target of targets) {
    const summary = summarizeDefinitionTarget(target);
    if (existing.has(target.slug)) {
      setup.existing.push(summary);
      continue;
    }
    await createPreferenceDefinition({
      graphqlUrl: options.graphqlUrl,
      authToken: options.authToken,
      input: buildDefinitionInput(target),
      fetchImpl,
    });
    existing.set(target.slug, buildDefinitionInput(target));
    setup.created.push(summary);
  }
  return setup;
}

async function seedPreferences({ options, repoRoot, fetchImpl }) {
  const seedPath = path.resolve(repoRoot, options.seedPreferencesPath);
  const seedRows = await readJson(seedPath);
  if (!Array.isArray(seedRows)) {
    throw new Error('--seed-preferences file must contain an array.');
  }
  const written = [];
  for (const [index, row] of seedRows.entries()) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      throw new Error(`seed preference ${index} must be an object.`);
    }
    if (typeof row.slug !== 'string' || row.slug.length === 0) {
      throw new Error(`seed preference ${index}.slug must be a non-empty string.`);
    }
    if (!Object.hasOwn(row, 'value')) {
      throw new Error(`seed preference ${index}.value is missing.`);
    }
    const preference = await setPreference({
      graphqlUrl: options.graphqlUrl,
      authToken: options.authToken,
      input: { slug: row.slug, value: row.value },
      fetchImpl,
    });
    written.push({
      id: preference?.id,
      slug: preference?.slug ?? row.slug,
      status: preference?.status ?? 'ACTIVE',
    });
  }
  return written;
}

async function ingestDocument({ options, repoRoot, documentsRoot, doc, fetchImpl }) {
  const absolutePath = path.resolve(documentsRoot, doc.path);
  if (!isInside(documentsRoot, absolutePath)) {
    throw new Error(`Document path escapes documents root: ${doc.path}`);
  }
  const docReport = {
    id: doc.id,
    path: doc.path,
    title: doc.title,
    status: 'upload_error',
    suggestionCount: 0,
    filteredSuggestionCount: 0,
    appliedSuggestionCount: 0,
    suggestions: [],
    filteredSuggestions: [],
    appliedPreferences: [],
  };

  let uploadResult;
  try {
    uploadResult = await uploadDocumentForAnalysis({
      backendUrl: options.backendUrl,
      authToken: options.authToken,
      filePath: absolutePath,
      relativePath: doc.path,
      mimeType: inferMimeType(absolutePath),
      fetchImpl,
    });
  } catch (error) {
    docReport.error = errorMessage(error, options.authToken);
    return docReport;
  }

  try {
    validateUploadResult(uploadResult, doc.path);
    validateSuggestionItems(uploadResult.suggestions, doc.path);
  } catch (error) {
    docReport.error = errorMessage(error, options.authToken);
    throw new HardDocumentFailure(docReport);
  }

  docReport.status = uploadResult.status;
  docReport.analysisId = uploadResult.analysisId;
  docReport.documentSummary = uploadResult.documentSummary;
  docReport.statusReason = uploadResult.statusReason;
  docReport.suggestions = uploadResult.suggestions.map(suggestionSummary);
  docReport.filteredSuggestions = uploadResult.filteredSuggestions.map(suggestionSummary);
  docReport.suggestionCount = docReport.suggestions.length;
  docReport.filteredSuggestionCount = docReport.filteredSuggestions.length;

  if (uploadResult.status === 'parse_error' || uploadResult.status === 'ai_error') {
    docReport.error = redactSecret(
      uploadResult.statusReason ?? `Document analysis status was ${uploadResult.status}`,
      options.authToken,
    );
    return docReport;
  }

  if (options.autoApply && uploadResult.suggestions.length > 0) {
    let applyInput;
    try {
      applyInput = uploadResult.suggestions.map((suggestion) =>
        applyInputForSuggestion({ suggestion, doc }),
      );
    } catch (error) {
      docReport.status = 'apply_error';
      docReport.error = errorMessage(error, options.authToken);
      throw new HardDocumentFailure(docReport);
    }

    try {
      const applied = await applyPreferenceSuggestions({
        graphqlUrl: options.graphqlUrl,
        authToken: options.authToken,
        analysisId: uploadResult.analysisId,
        input: applyInput,
        fetchImpl,
      });
      docReport.appliedPreferences = applied.map(preferenceSummary);
      docReport.appliedSuggestionCount = applied.length;
      if (applied.length !== applyInput.length) {
        docReport.status = 'apply_error';
        docReport.error = `Applied ${applied.length}/${applyInput.length} suggestions for ${doc.path}.`;
        throw new HardDocumentFailure(docReport);
      }
    } catch (error) {
      if (error instanceof HardDocumentFailure) throw error;
      docReport.status = 'apply_error';
      docReport.error = errorMessage(error, options.authToken);
      throw new HardDocumentFailure(docReport);
    }
  }

  return docReport;
}

function validateUploadResult(result, docPath) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new Error(`Document upload ${docPath} response must be an object.`);
  }
  for (const key of ['nextCursor', 'pageInfo', 'hasNextPage', 'totalCount']) {
    if (Object.hasOwn(result, key)) {
      throw new Error(
        `Document upload ${docPath} response appears paginated; eval ingestor does not support paginated analysis suggestions yet.`,
      );
    }
  }
  if (typeof result.analysisId !== 'string' || result.analysisId.length === 0) {
    throw new Error(`Document upload ${docPath} response missing analysisId.`);
  }
  if (typeof result.status !== 'string' || result.status.length === 0) {
    throw new Error(`Document upload ${docPath} response missing status.`);
  }
  if (!Array.isArray(result.suggestions)) {
    throw new Error(`Document upload ${docPath} response suggestions must be an array.`);
  }
  if (!Array.isArray(result.filteredSuggestions)) {
    throw new Error(`Document upload ${docPath} response filteredSuggestions must be an array.`);
  }
  if (typeof result.filteredCount !== 'number') {
    throw new Error(`Document upload ${docPath} response filteredCount must be a number.`);
  }
}

function applyInputForSuggestion({ suggestion, doc }) {
  for (const key of ['id', 'slug', 'operation', 'newValue', 'confidence', 'sourceSnippet']) {
    if (!Object.hasOwn(suggestion, key)) {
      throw new Error(`Suggestion ${suggestion?.id ?? '<unknown>'} is missing ${key}.`);
    }
  }
  return {
    suggestionId: suggestion.id,
    slug: suggestion.slug,
    operation: suggestion.operation,
    newValue: suggestion.newValue,
    confidence: suggestion.confidence,
    evidence: {
      source: 'eval-ingestor-upload',
      fileName: path.basename(doc.path),
      snippet: suggestion.sourceSnippet,
      sourceMeta: suggestion.sourceMeta ?? null,
    },
  };
}

function validateSuggestionItems(suggestions, docPath) {
  for (const [index, suggestion] of suggestions.entries()) {
    for (const key of ['id', 'slug', 'operation', 'newValue', 'confidence', 'sourceSnippet']) {
      if (!Object.hasOwn(suggestion, key)) {
        throw new Error(`Document upload ${docPath} suggestion ${index} is missing ${key}.`);
      }
    }
  }
}

function assertExistingDefinitionCompatible({ target, existingDefinition }) {
  const actualValueType = String(existingDefinition.valueType ?? '').toUpperCase();
  if (actualValueType !== target.valueType) {
    throw new Error(
      `Existing definition ${target.slug} has valueType ${actualValueType || '<missing>'}, expected ${target.valueType}.`,
    );
  }
}

function exportArgs(options) {
  const args = [
    '--user',
    options.evalUserId,
    '--corpus',
    options.corpusId,
    '--out',
    options.exportStoredPreferencesPath,
    '--graphql-url',
    options.graphqlUrl,
    '--auth-token',
    options.authToken,
    '--ingestion-mode',
    INGESTION_MODE,
    '--suggestions-were-auto-applied',
    String(options.autoApply),
  ];
  if (options.runId) args.push('--run-id', options.runId);
  if (options.locationId) args.push('--location-id', options.locationId);
  return args;
}

function initialReport({ options, startedAt }) {
  return {
    schemaVersion: 1,
    artifactType: 'ingestion-run',
    status: 'fail',
    ...(options.runId ? { runId: options.runId } : {}),
    evalUserId: options.evalUserId,
    corpusId: options.corpusId,
    backendUrl: options.backendUrl,
    graphqlUrl: options.graphqlUrl,
    locationId: options.locationId ?? null,
    settings: {
      resetMemory: options.resetMemory,
      ensureDefinitions: options.ensureDefinitions,
      autoApply: options.autoApply,
      seedPreferences: Boolean(options.seedPreferencesPath),
    },
    definitionSetup: {
      created: [],
      existing: [],
      skipped: [],
    },
    seedPreferences: [],
    documents: [],
    summary: {
      documentCount: 0,
      uploadedCount: 0,
      analyzedCount: 0,
      failedDocumentCount: 0,
      suggestionCount: 0,
      filteredSuggestionCount: 0,
      appliedSuggestionCount: 0,
      applyFailureCount: 0,
      createdDefinitionCount: 0,
      seedPreferenceCount: 0,
    },
    startedAt,
    endedAt: startedAt,
  };
}

function updateDocumentCounts(report) {
  const documents = report.documents ?? [];
  report.summary.uploadedCount = documents.filter((doc) =>
    ['success', 'no_matches'].includes(doc.status),
  ).length;
  report.summary.analyzedCount = documents.filter((doc) => doc.analysisId).length;
  report.summary.failedDocumentCount = documents.filter((doc) => doc.error).length;
  report.summary.applyFailureCount = documents.filter((doc) => doc.status === 'apply_error').length;
  report.summary.suggestionCount = sum(documents, 'suggestionCount');
  report.summary.filteredSuggestionCount = sum(documents, 'filteredSuggestionCount');
  report.summary.appliedSuggestionCount = sum(documents, 'appliedSuggestionCount');
}

async function writeValidatedReport({ repoRoot, outPath, report }) {
  await validateWithSchema(repoRoot, 'ingestion-run.schema.json', report, 'ingestion run');
  await writeJson(outPath, report);
}

function suggestionSummary(suggestion) {
  return {
    id: suggestion.id,
    slug: suggestion.slug,
    operation: suggestion.operation,
    confidence: suggestion.confidence ?? null,
    ...(Object.hasOwn(suggestion, 'newValue') ? { newValue: suggestion.newValue } : {}),
    ...(suggestion.filterReason ? { filterReason: suggestion.filterReason } : {}),
    ...(suggestion.filterDetails ? { filterDetails: suggestion.filterDetails } : {}),
  };
}

function preferenceSummary(preference) {
  return {
    id: preference?.id,
    slug: preference?.slug,
    status: preference?.status ?? 'ACTIVE',
  };
}

function sum(values, key) {
  return values.reduce((total, value) => total + (value[key] ?? 0), 0);
}

function optionName(key) {
  const mapped = key === 'evalUserId' ? 'user' : key;
  return `--${mapped.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`)}`;
}

function isoTimestamp(now) {
  const value = now();
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  return new Date(value).toISOString();
}

function redactSecret(text, secret) {
  if (!secret) return text;
  return text.split(secret).join('[redacted-auth-token]');
}

function errorMessage(error, secret) {
  return redactSecret(error?.message ?? String(error), secret);
}

function isInside(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

class HardDocumentFailure extends Error {
  constructor(docReport) {
    super(docReport.error);
    this.docReport = docReport;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await runIngestDocuments({ args: process.argv.slice(2) });
  console.log(formatIngestDocumentsResult(result));
  process.exitCode = result.exitCode;
}
