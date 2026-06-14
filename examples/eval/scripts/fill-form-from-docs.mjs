#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRunPlan } from './eval-runner/actions.mjs';
import { loadScenarioFixture, optionValuesForField } from './eval-runner/fixtures.mjs';
import { loadBackendPdfLib, readFilledPdfFields } from './eval-runner/pdf.mjs';
import { buildFilledFormSnapshot } from './eval-runner/snapshots.mjs';
import { generateWithVertex } from './generate.mjs';
import { scoreFormToFile } from './scoring/form.mjs';
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
const MAX_EVIDENCE_CHARS = 200_000;
const TEXT_EXTENSIONS = new Set(['.txt', '.md', '.yaml', '.yml', '.json']);
const FILL_ACTIONS = new Set(['SET_TEXT', 'CHECK', 'UNCHECK', 'SELECT_OPTION', 'SKIP']);

export async function runFillFormFromDocs({
  repoRoot = defaultRepoRoot,
  args = [],
  env = process.env,
  generateResponse = null,
  pdfLib,
  now = () => new Date(),
} = {}) {
  const parsed = parseArgs(args, env);
  if (parsed.kind === 'help') {
    return { exitCode: 0, lines: [usage()] };
  }
  if (parsed.kind === 'usage-error') {
    return { exitCode: 2, lines: [parsed.message, '', usage()] };
  }

  const options = parsed.options;
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

    const fixture = await loadScenarioFixture({ repoRoot, scenarioId: options.scenarioId });
    const documentsRoot = path.resolve(
      repoRoot,
      options.documentsRoot ??
        path.join('examples/eval/users', fixture.scenario.userId, 'corpora', fixture.scenario.corpusId),
    );
    const evidenceDocuments = await loadEvidenceDocuments({
      manifest: fixture.manifest,
      documentsRoot,
    });
    const fieldMetadata = buildPromptFieldMetadata(fixture);
    const prompt = buildDirectFormFillPrompt({ fieldMetadata, evidenceDocuments });
    const model = options.model ?? env.EVAL_DIRECT_FORM_FILL_MODEL;
    if (!model) {
      throw new Error('Set EVAL_DIRECT_FORM_FILL_MODEL or pass --model.');
    }

    const provider =
      generateResponse ??
      ((requestPrompt) =>
        generateWithVertex(requestPrompt, {
          env,
          model,
          temperature: options.temperature,
        }));
    const rawText = await provider(prompt, {
      fixture,
      fieldMetadata,
      evidenceDocuments,
      model,
      temperature: options.temperature,
    });
    const aiResult = parseModelResponse(rawText);
    const validationResult = validateDocFillActions({
      actions: aiResult.fillActions,
      fields: fieldMetadata,
      evidenceDocuments,
      confidenceThreshold: DEFAULT_CONFIDENCE_THRESHOLD,
    });

    const formPdfBytes = await readFile(fixture.formPdfPath);
    const filledPdfBytes = await fillPdfFromActions({
      repoRoot,
      pdfBytes: formPdfBytes,
      actions: validationResult.validActions,
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
      validationResult,
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

    const outPath = path.resolve(repoRoot, options.out);
    await validateWithSchema(
      repoRoot,
      'filled-form-snapshot.schema.json',
      snapshot,
      'filled form snapshot',
    );
    await writeJson(outPath, snapshot);

    const lines = [
      'eval fill-form-from-docs passed',
      `status=${response.status} filled=${response.summary.filledCount} skipped=${response.summary.skippedCount}`,
      `documents=${evidenceDocuments.length} model=${model}`,
      `wrote ${relativePath(repoRoot, outPath)}`,
    ];

    if (options.filledPdfOut) {
      const filledPdfPath = path.resolve(repoRoot, options.filledPdfOut);
      await mkdir(path.dirname(filledPdfPath), { recursive: true });
      await writeFile(filledPdfPath, filledPdfBytes);
      lines.push(`filled-pdf ${relativePath(repoRoot, filledPdfPath)}`);
    }

    if (options.responseOut) {
      const responsePath = path.resolve(repoRoot, options.responseOut);
      await writeJson(
        responsePath,
        buildResponseArtifact({
          fixture,
          documentsRoot,
          evidenceDocuments,
          fieldMetadata,
          model,
          temperature: options.temperature,
          rawText,
          aiResult,
          validationResult,
          response,
          now,
        }),
      );
      lines.push(`response ${relativePath(repoRoot, responsePath)}`);
    }

    if (options.formScoreReport) {
      const reportPath = path.resolve(repoRoot, options.formScoreReport);
      const report = await scoreFormToFile({
        repoRoot,
        scenarioId: options.scenarioId,
        filledFormPath: outPath,
        outPath: reportPath,
      });
      lines.push(
        `form-score known=${report.summary.knownFieldTotal} abstention=${report.summary.abstentionFieldTotal}`,
      );
      lines.push(`form-score-report ${relativePath(repoRoot, reportPath)}`);
    }

    return {
      exitCode: 0,
      lines,
      snapshot,
      response,
      validationResult,
      evidenceDocuments,
      prompt,
    };
  } catch (error) {
    return {
      exitCode: 1,
      lines: ['eval fill-form-from-docs failed', '', error?.stack ?? error?.message ?? String(error)],
      error,
    };
  }
}

export function parseArgs(args, env = process.env) {
  if (args.includes('--help') || args.includes('-h')) {
    return { kind: 'help' };
  }

  const options = {
    backend: 'vertex',
    model: env.EVAL_DIRECT_FORM_FILL_MODEL,
    temperature: DEFAULT_TEMPERATURE,
  };
  const valueArgs = new Set([
    '--scenario',
    '--out',
    '--documents-root',
    '--backend',
    '--model',
    '--temperature',
    '--filled-pdf-out',
    '--response-out',
    '--form-score-report',
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

    if (arg === '--scenario') options.scenarioId = value;
    if (arg === '--out') options.out = value;
    if (arg === '--documents-root') options.documentsRoot = value;
    if (arg === '--backend') options.backend = value;
    if (arg === '--model') options.model = value;
    if (arg === '--temperature') options.temperature = Number(value);
    if (arg === '--filled-pdf-out') options.filledPdfOut = value;
    if (arg === '--response-out') options.responseOut = value;
    if (arg === '--form-score-report') options.formScoreReport = value;
  }

  for (const [key, flag] of [
    ['scenarioId', '--scenario'],
    ['out', '--out'],
  ]) {
    if (!options[key]) {
      return { kind: 'usage-error', message: `Missing required ${flag}` };
    }
  }
  if (!isFixtureId(options.scenarioId)) {
    return { kind: 'usage-error', message: '--scenario must be a fixture id.' };
  }
  if (options.backend !== 'vertex') {
    return { kind: 'usage-error', message: '--backend currently supports only vertex.' };
  }
  if (
    typeof options.temperature !== 'number' ||
    Number.isNaN(options.temperature) ||
    options.temperature < 0 ||
    options.temperature > 2
  ) {
    return { kind: 'usage-error', message: '--temperature must be a number from 0 to 2.' };
  }

  return { kind: 'ok', options };
}

export function usage() {
  return [
    'Usage:',
    '  pnpm eval:fill-form-from-docs --scenario <scenarioId> --out <filled-form.json> [options]',
    '',
    'Notes:',
    '  This is an eval-only direct-document baseline. It does not call the backend or read DB memory.',
    '  Evidence documents are read locally and sent as text in one Vertex prompt.',
    '  Relative output paths are resolved from the repo root.',
    '',
    'Options:',
    '  --documents-root <dir>           Defaults to examples/eval/users/<scenario user>/corpora/<scenario corpus>',
    '  --backend vertex                 Only vertex is supported',
    '  --model <model>                  Defaults to EVAL_DIRECT_FORM_FILL_MODEL',
    '  --temperature <number>           Defaults to 0.2',
    '  --filled-pdf-out <file>          Write the filled PDF for visual review',
    '  --response-out <file>            Write model/validation diagnostics',
    '  --form-score-report <file>       Also run eval:score --mode form output',
  ].join('\n');
}

export async function loadEvidenceDocuments({ manifest, documentsRoot }) {
  const root = path.resolve(documentsRoot);
  const documents = [];
  let totalChars = 0;

  for (const doc of manifest.documents ?? []) {
    const relativeDocPath = doc.path;
    const absolutePath = path.resolve(root, relativeDocPath);
    if (!isInside(root, absolutePath)) {
      throw new Error(`Document path escapes documents root: ${relativeDocPath}`);
    }
    const extension = path.extname(absolutePath).toLowerCase();
    if (!TEXT_EXTENSIONS.has(extension)) {
      throw new Error(`Direct-document baseline supports text-like evidence only: ${relativeDocPath}`);
    }
    const content = await readFile(absolutePath, 'utf8');
    totalChars += content.length;
    if (totalChars > MAX_EVIDENCE_CHARS) {
      throw new Error(
        `Evidence packet exceeds ${MAX_EVIDENCE_CHARS} characters. Reduce corpus size or add document selection before using this runner.`,
      );
    }
    documents.push({
      id: doc.id,
      ref: `doc:${doc.id}`,
      path: toPosixPath(relativeDocPath),
      title: doc.title ?? doc.id,
      category: doc.category ?? null,
      content,
    });
  }

  return documents;
}

export function buildPromptFieldMetadata(fixture) {
  return fixture.joinedFields.map(({ fieldMap, generated }) => {
    const options = optionValuesForField(generated, fixture.fieldsGenerated);
    return {
      fieldName: generated.pdfFieldName,
      fieldType: generated.type,
      inferredLabel: generated.inferredLabel ?? null,
      inferredDataKey: generated.inferredDataKey ?? null,
      fillPolicy: generated.fillPolicy ?? null,
      fieldPolicy: promptFieldPolicy(fieldMap),
      options,
    };
  });
}

export function buildDirectFormFillPrompt({ fieldMetadata, evidenceDocuments }) {
  return [
    'You are filling a fillable PDF form using only the supplied evidence documents.',
    '',
    'Return JSON only. Do not include markdown fences or explanatory wrapper text.',
    'Return exactly one fill action for every PDF field in the metadata list.',
    'Use exact case-sensitive fieldName values from the field metadata.',
    'For dropdown, radio, and option-list fields, use exact option value strings from the metadata.',
    'Field policy is authoritative.',
    'When fieldPolicy.action is "skip", return SKIP for that field even if the evidence contains plausible values.',
    'Never fill fields with skip reasons manual_attestation, out_of_scope, or unmapped.',
    'Include numeric confidence from 0 to 1 when available; do not omit an evidence-backed value solely because confidence is uncertain.',
    'Use SKIP when evidence is missing, contradicted, stale, ambiguous, or the field requires a signature/manual attestation.',
    'Do not infer or invent values that are not present in the evidence documents.',
    'Every non-SKIP action must include at least one sourceSlugs entry using a document ref such as doc:example-document-id.',
    'Use sourceSlugs: [] for SKIP actions.',
    '',
    'Allowed response shape:',
    JSON.stringify(
      {
        fillActions: [
          {
            fieldName: 'exact PDF field name',
            action: 'SET_TEXT | CHECK | UNCHECK | SELECT_OPTION | SKIP',
            value: 'required only for SET_TEXT and SELECT_OPTION',
            sourceSlugs: ['doc:document-id'],
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
    JSON.stringify(fieldMetadata, null, 2),
    '',
    'Evidence documents:',
    evidenceDocuments.map(formatEvidenceDocument).join('\n\n'),
  ].join('\n');
}

function promptFieldPolicy(fieldMap) {
  if (fieldMap?.mode === 'skip') {
    return {
      action: 'skip',
      reason: fieldMap.reason ?? 'structural_skip',
    };
  }
  return { action: 'fillable' };
}

export function parseModelResponse(text) {
  const trimmed = String(text ?? '').trim();
  const fence = trimmed.match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i);
  const body = fence ? fence[1].trim() : trimmed;
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch (error) {
    throw new Error(`Model response was not valid JSON: ${error.message}`);
  }
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.fillActions)) {
    throw new Error('Model response must be an object with fillActions[].');
  }
  return parsed;
}

export function validateDocFillActions({
  actions,
  fields,
  evidenceDocuments,
  confidenceThreshold = DEFAULT_CONFIDENCE_THRESHOLD,
}) {
  const warnings = [];
  const diagnostics = {
    missingConfidenceCount: 0,
    lowConfidenceCount: 0,
    invalidActionReasonCounts: {},
  };
  const docRefs = new Set(evidenceDocuments.map((doc) => doc.ref));
  const fieldByName = new Map(fields.map((field) => [field.fieldName, field]));
  const actionByField = new Map();

  for (const action of actions ?? []) {
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
    const invalidReason = invalidActionReason({
      action,
      field,
      docRefs,
    });
    if (invalidReason) {
      countInvalidActionReason(diagnostics, invalidReason);
      skippedFields.push(skipField(field, invalidReason, action.confidence, action.sourceSlugs));
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
          action.sourceSlugs,
        ),
      );
      continue;
    }

    const confidence = confidenceForFilledAction({
      action,
      diagnostics,
      confidenceThreshold,
    });
    const validAction = {
      fieldName: action.fieldName,
      fieldType: field.fieldType,
      action: action.action,
      value: action.value,
      sourceSlugs: action.sourceSlugs,
      confidence,
    };
    validActions.push(validAction);
    filledFields.push({
      pdfFieldName: field.fieldName,
      fieldType: field.fieldType,
      sourceSlugs: action.sourceSlugs,
      confidence,
    });
  }

  appendConfidenceWarnings(warnings, diagnostics, confidenceThreshold);
  return { validActions, filledFields, skippedFields, warnings, diagnostics };
}

export async function fillPdfFromActions({
  repoRoot,
  pdfBytes,
  actions,
  pdfLib = loadBackendPdfLib(repoRoot),
}) {
  const { PDFDocument, StandardFonts } = pdfLib;
  const bytes = Buffer.isBuffer(pdfBytes) ? pdfBytes : Buffer.from(pdfBytes);
  const pdfDoc = await PDFDocument.load(bytes);
  const form = pdfDoc.getForm();

  for (const action of actions) {
    switch (action.fieldType) {
      case 'text':
        form.getTextField(action.fieldName).setText(normalizeTextValueForPdfField(action));
        break;
      case 'checkbox':
        if (action.action === 'CHECK') {
          form.getCheckBox(action.fieldName).check();
        } else {
          form.getCheckBox(action.fieldName).uncheck();
        }
        break;
      case 'radio':
        form.getRadioGroup(action.fieldName).select(action.value ?? '');
        break;
      case 'dropdown':
        form.getDropdown(action.fieldName).select(action.value ?? '');
        break;
      case 'option_list':
        form.getOptionList(action.fieldName).select([action.value ?? '']);
        break;
      case 'button':
      case 'signature':
      case 'unknown':
        break;
      default:
        break;
    }
  }

  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  form.updateFieldAppearances(font);
  return Buffer.from(await pdfDoc.save());
}

function buildFormFillResponse({ fixture, filledPdfBytes, validationResult }) {
  const outputFilename = `direct-doc-filled-${path.basename(fixture.formPdfPath)}`;
  const summary = {
    totalFields: fixture.joinedFields.length,
    filledCount: validationResult.filledFields.length,
    skippedCount: validationResult.skippedFields.length,
    filledFields: validationResult.filledFields,
    skippedFields: validationResult.skippedFields,
    warnings: validationResult.warnings,
  };
  return {
    fillId: `direct-doc-${fixture.scenario.scenarioId}`,
    status: summary.skippedCount === 0 && summary.filledCount > 0 ? 'success' : 'partial',
    originalFilename: path.basename(fixture.formPdfPath),
    outputFilename,
    outputMimeType: 'application/pdf',
    filledPdfBase64: filledPdfBytes.toString('base64'),
    summary,
  };
}

function buildResponseArtifact({
  fixture,
  documentsRoot,
  evidenceDocuments,
  fieldMetadata,
  model,
  temperature,
  rawText,
  aiResult,
  validationResult,
  response,
  now,
}) {
  return {
    schemaVersion: 1,
    artifactType: 'direct-doc-form-fill-response',
    generatedAt: isoTimestamp(now),
    scenarioId: fixture.scenario.scenarioId,
    userId: fixture.scenario.userId,
    corpusId: fixture.scenario.corpusId,
    formId: fixture.scenario.formId,
    model,
    temperature,
    documentsRoot: toPosixPath(documentsRoot),
    evidenceDocuments: evidenceDocuments.map((doc) => ({
      id: doc.id,
      ref: doc.ref,
      path: doc.path,
      title: doc.title,
      category: doc.category,
      charCount: doc.content.length,
    })),
    fieldCount: fieldMetadata.length,
    rawModelText: rawText,
    returnedActionCount: aiResult.fillActions.length,
    validActionCount: validationResult.validActions.length,
    skippedFieldCount: validationResult.skippedFields.length,
    validationDiagnostics: validationResult.diagnostics,
    warnings: validationResult.warnings,
    responseSummary: response.summary,
    note: 'sourceSlugAgreementRate in form score is not meaningful for this baseline because sourceSlugs are document refs, not DB slugs.',
  };
}

function invalidActionReason({ action, field, docRefs }) {
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
  if (action.action === 'SKIP') return null;
  if (!Array.isArray(action.sourceSlugs) || action.sourceSlugs.length === 0) {
    return 'missing source document ref';
  }
  for (const sourceRef of action.sourceSlugs) {
    if (!docRefs.has(sourceRef)) {
      return `unknown source document ref "${sourceRef}"`;
    }
  }
  return null;
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

function isCompatible(action, fieldType) {
  if (fieldType === 'text') return action === 'SET_TEXT';
  if (fieldType === 'checkbox') return action === 'CHECK' || action === 'UNCHECK';
  if (fieldType === 'radio' || fieldType === 'dropdown' || fieldType === 'option_list') {
    return action === 'SELECT_OPTION';
  }
  return false;
}

function skipField(field, reason, confidence, sourceSlugs) {
  return {
    pdfFieldName: field.fieldName,
    fieldType: field.fieldType,
    reason,
    confidence: typeof confidence === 'number' ? confidence : null,
    sourceSlugs: Array.isArray(sourceSlugs) ? sourceSlugs : [],
  };
}

function formatEvidenceDocument(doc) {
  return [
    `--- ${doc.ref} ---`,
    `id: ${doc.id}`,
    `title: ${doc.title}`,
    `path: ${doc.path}`,
    doc.category ? `category: ${doc.category}` : null,
    'content:',
    doc.content,
  ].filter((line) => line != null).join('\n');
}

function normalizeTextValueForPdfField(action) {
  const value = action.value ?? '';
  if (!isSocialSecurityNumberAction(action)) return value;
  const digits = value.replace(/\D/g, '');
  return digits.length === 9 ? digits : value;
}

function isSocialSecurityNumberAction(action) {
  return (
    action.fieldName === 'US Social Security Number' ||
    action.sourceSlugs.some((slug) => slug.endsWith('.identity.ssn') || slug === 'identity.ssn')
  );
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function isoTimestamp(now) {
  const value = now();
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  return new Date(value).toISOString();
}

export function formatFillFormFromDocsResult(result) {
  return result.lines.join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await runFillFormFromDocs({ args: process.argv.slice(2) });
  console.log(formatFillFormFromDocsResult(result));
  process.exitCode = result.exitCode;
}
