#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRunPlan, evalSlugForFactKey } from './eval-runner/actions.mjs';
import { loadScenarioFixture } from './eval-runner/fixtures.mjs';
import { readFilledPdfFieldsFromBase64 } from './eval-runner/pdf.mjs';
import { buildFilledFormSnapshot } from './eval-runner/snapshots.mjs';
import { scoreFormToFile } from './scoring/form.mjs';
import {
  readJson,
  relativePath,
  validateWithSchema,
  writeJson,
} from './scoring/io.mjs';
import { formatResult as formatValidationResult, runValidation } from './validate.mjs';
import { isFixtureId } from './shared.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultRepoRoot = path.resolve(__dirname, '../../..');
const DEFAULT_BACKEND_URL = 'http://localhost:3000';
const SCORABLE_STATUSES = new Set(['success', 'partial']);
const TERMINAL_STATUSES = new Set([
  'failed',
  'no_fillable_fields',
  'unsupported_format',
]);
const ALL_STATUSES = new Set([...SCORABLE_STATUSES, ...TERMINAL_STATUSES]);

export async function runFillForm({
  repoRoot = defaultRepoRoot,
  args = [],
  env = process.env,
  fetchImpl = globalThis.fetch,
  pdfFieldReader = readFilledPdfFieldsFromBase64,
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

    const fixture = await loadScenarioFixture({
      repoRoot,
      scenarioId: options.scenarioId,
    });
    const runPlan = buildRunPlan(fixture);
    const fieldPolicies = options.fieldPolicies
      ? await buildFieldPoliciesForFixture({ fixture })
      : undefined;
    const response = await fetchFormFillResponse({
      backendUrl: options.backendUrl,
      authToken: options.authToken,
      formPdfPath: fixture.formPdfPath,
      fieldPolicies,
      fetchImpl,
    });
    const responsePdfBytes = decodeResponsePdfBytes(response);
    const responsePath = options.responseOut
      ? path.resolve(repoRoot, options.responseOut)
      : null;
    if (responsePath) {
      await writeJson(
        responsePath,
        buildResponseArtifact({
          fixture,
          backendUrl: options.backendUrl,
          response,
          pdfBytes: responsePdfBytes,
        }),
      );
    }
    assertScorableResponse(response);

    const pdfBytes = responsePdfBytes ?? Buffer.from(response.filledPdfBase64, 'base64');
    const filledPdfFields = await pdfFieldReader({
      repoRoot,
      base64: response.filledPdfBase64,
      pdfBytes,
    });
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
      'eval fill-form passed',
      `status=${response.status} filled=${response.summary.filledCount} skipped=${response.summary.skippedCount}`,
      `wrote ${relativePath(repoRoot, outPath)}`,
    ];

    if (options.filledPdfOut) {
      const filledPdfPath = path.resolve(repoRoot, options.filledPdfOut);
      await mkdir(path.dirname(filledPdfPath), { recursive: true });
      await writeFile(filledPdfPath, pdfBytes);
      lines.push(`filled-pdf ${relativePath(repoRoot, filledPdfPath)}`);
    }

    if (options.responseOut) {
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
    };
  } catch (error) {
    return {
      exitCode: 1,
      lines: [
        'eval fill-form failed',
        '',
        redactSecret(error?.stack ?? error?.message ?? String(error), options.authToken),
      ],
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
    authToken: env.EVAL_AUTH_TOKEN,
    fieldPolicies: true,
  };

  const valueArgs = new Set([
    '--scenario',
    '--out',
    '--backend-url',
    '--auth-token',
    '--filled-pdf-out',
    '--response-out',
    '--form-score-report',
  ]);

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--no-field-policies') {
      options.fieldPolicies = false;
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
    if (arg === '--out') options.out = value;
    if (arg === '--backend-url') options.backendUrl = value;
    if (arg === '--auth-token') options.authToken = value;
    if (arg === '--filled-pdf-out') options.filledPdfOut = value;
    if (arg === '--response-out') options.responseOut = value;
    if (arg === '--form-score-report') options.formScoreReport = value;
  }

  const requiredOptions = [
    ['scenarioId', '--scenario'],
    ['out', '--out'],
  ];
  for (const [key, flag] of requiredOptions) {
    if (!options[key]) {
      return { kind: 'usage-error', message: `Missing required ${flag}` };
    }
  }
  if (!isFixtureId(options.scenarioId)) {
    return { kind: 'usage-error', message: '--scenario must be a fixture id.' };
  }
  if (!options.authToken) {
    return {
      kind: 'usage-error',
      message: 'Missing required --auth-token or EVAL_AUTH_TOKEN',
    };
  }

  return { kind: 'ok', options };
}

export function usage() {
  return [
    'Usage:',
    '  pnpm eval:fill-form --scenario <scenarioId> --out <filled-form.json> [options]',
    '',
    'Notes:',
    '  This is the live backend-memory runner. It does not seed, reset, hydrate, or mutate memory.',
    '  Prepare backend memory first with ingestion, manual upload, or an MCP/agent run.',
    '  Relative output paths are resolved from the repo root.',
    '  Prefer EVAL_AUTH_TOKEN over --auth-token to avoid shell history and process-list exposure.',
    '',
    'Options:',
    '  --backend-url <url>              Defaults to EVAL_BACKEND_URL or http://localhost:3000',
    '  --auth-token <token>             Defaults to EVAL_AUTH_TOKEN',
    '  --filled-pdf-out <file>          Write the decoded filled PDF for visual review',
    '  --response-out <file>            Write a redacted backend response artifact',
    '  --form-score-report <file>       Also run eval:score --mode form output',
    '  --no-field-policies              Send only the PDF, without eval field-policy metadata',
  ].join('\n');
}

export async function fetchFormFillResponse({
  backendUrl,
  authToken,
  formPdfPath,
  fieldPolicies,
  fetchImpl = globalThis.fetch,
}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('No fetch implementation is available.');
  }
  if (typeof FormData !== 'function' || typeof Blob !== 'function') {
    throw new Error('This Node.js runtime does not provide FormData and Blob.');
  }

  const pdfBytes = await readFile(formPdfPath);
  const formData = new FormData();
  formData.append(
    'file',
    new Blob([pdfBytes], { type: 'application/pdf' }),
    path.basename(formPdfPath),
  );
  if (fieldPolicies) {
    formData.append('fieldPolicies', JSON.stringify(fieldPolicies));
  }

  const endpoint = new URL('/api/form-fill/pdf', backendUrl).toString();
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${authToken}`,
    },
    body: formData,
  });

  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch (error) {
    throw new Error(`Form-fill response was not valid JSON: ${error.message}`);
  }

  if (!response.ok) {
    throw new Error(
      `Form-fill request failed with HTTP ${response.status}: ${formatPayload(payload)}`,
    );
  }
  if (!payload || typeof payload !== 'object') {
    throw new Error('Form-fill response did not include a JSON object.');
  }

  return payload;
}

export async function buildFieldPoliciesForFixture({ fixture }) {
  const storageMap = await readJson(
    path.join(fixture.evalRoot, 'scoring/fact-storage-map.v1.json'),
  );
  return buildFormFillFieldPolicies({ fixture, storageMap });
}

export function buildFormFillFieldPolicies({ fixture, storageMap }) {
  const fields = [];

  for (const { fieldMap, generated } of fixture.joinedFields) {
    if (fieldMap.mode === 'skip') {
      fields.push({
        fieldName: fieldMap.pdfFieldName,
        mode: 'skip',
        reason: fieldMap.reason ?? 'structural_skip',
      });
      continue;
    }

    if (fieldMap.mode !== 'fact') {
      continue;
    }

    const policy = {
      fieldName: fieldMap.pdfFieldName,
      mode: 'fact',
      factKey: fieldMap.factKey,
      sourceSlugs: sourceSlugsForFactKey(fieldMap.factKey, storageMap),
    };

    if (fieldMap.when) {
      policy.when = {
        factKey: fieldMap.when.factKey,
        sourceSlugs: sourceSlugsForFactKey(fieldMap.when.factKey, storageMap),
        equals: fieldMap.when.equals,
      };
      if (generated.type === 'checkbox') {
        policy.groupId = fieldMap.when.factKey;
      }
    }

    fields.push(policy);
  }

  return {
    schemaVersion: 1,
    fields,
  };
}

function sourceSlugsForFactKey(factKey, storageMap) {
  const mapEntry = storageMap.facts?.[factKey] ?? {};
  return unique([
    ...(mapEntry.canonicalSlugs ?? []),
    ...(mapEntry.acceptedAliasSlugs ?? []),
    evalSlugForFactKey(factKey),
  ]);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

export function assertScorableResponse(response) {
  if (!response || typeof response !== 'object') {
    throw new Error('Form-fill response did not include a response object.');
  }
  if (!ALL_STATUSES.has(response.status)) {
    throw new Error(
      `Form-fill response status ${JSON.stringify(response.status)} is not supported.`,
    );
  }
  if (TERMINAL_STATUSES.has(response.status)) {
    const detail = terminalResponseDetail(response);
    throw new Error(
      `Form-fill response status was ${response.status}. This eval runner only scores success or partial responses.${detail ? ` Detail: ${detail}` : ''}`,
    );
  }
  for (const key of ['originalFilename', 'outputFilename', 'outputMimeType']) {
    if (typeof response[key] !== 'string' || response[key].length === 0) {
      throw new Error(`Form-fill response is missing string field ${key}.`);
    }
  }
  if (response.outputMimeType !== 'application/pdf') {
    throw new Error(
      `Form-fill response outputMimeType ${JSON.stringify(response.outputMimeType)} is not application/pdf.`,
    );
  }
  if (typeof response.filledPdfBase64 !== 'string' || !response.filledPdfBase64) {
    throw new Error(
      `Form-fill response status ${response.status} did not include filledPdfBase64.`,
    );
  }
  if (!response.summary || typeof response.summary !== 'object') {
    throw new Error('Form-fill response is missing summary.');
  }
  for (const key of ['totalFields', 'filledCount', 'skippedCount']) {
    if (!Number.isInteger(response.summary[key]) || response.summary[key] < 0) {
      throw new Error(`Form-fill response summary.${key} must be a nonnegative integer.`);
    }
  }
  for (const key of ['filledFields', 'skippedFields', 'warnings']) {
    if (!Array.isArray(response.summary[key])) {
      throw new Error(`Form-fill response summary.${key} must be an array.`);
    }
  }
  if (response.summary.filledCount !== response.summary.filledFields.length) {
    throw new Error(
      `Form-fill response summary.filledCount ${response.summary.filledCount} does not match filledFields length ${response.summary.filledFields.length}.`,
    );
  }
  if (response.summary.skippedCount !== response.summary.skippedFields.length) {
    throw new Error(
      `Form-fill response summary.skippedCount ${response.summary.skippedCount} does not match skippedFields length ${response.summary.skippedFields.length}.`,
    );
  }
  if (
    response.summary.totalFields <
    response.summary.filledCount + response.summary.skippedCount
  ) {
    throw new Error(
      `Form-fill response summary.totalFields ${response.summary.totalFields} is less than filledCount + skippedCount.`,
    );
  }
}

function terminalResponseDetail(response) {
  const summary = response?.summary;
  if (!summary || typeof summary !== 'object') return null;

  const warnings = Array.isArray(summary.warnings)
    ? summary.warnings.filter((warning) => typeof warning === 'string' && warning.trim())
    : [];
  const warning =
    warnings.find((value) => value.trim() !== 'Form fill failed. Please try again.') ??
    warnings[0];
  if (warning) return compactDetail(warning);

  const validationEvents = Array.isArray(summary.validationEvents)
    ? summary.validationEvents
    : [];
  const event = validationEvents.find((value) => value && typeof value === 'object');
  if (!event) return null;
  if (typeof event.message === 'string' && event.message.trim()) {
    return compactDetail(event.message);
  }
  if (typeof event.kind === 'string' && typeof event.fieldName === 'string') {
    return compactDetail(`${event.kind} for ${event.fieldName}`);
  }
  if (typeof event.kind === 'string') return compactDetail(event.kind);
  return null;
}

function compactDetail(value) {
  const detail = value.replace(/\s+/g, ' ').trim();
  return detail ? detail.slice(0, 500) : null;
}

export function buildResponseArtifact({ fixture, backendUrl, response, pdfBytes }) {
  return {
    schemaVersion: 1,
    artifactType: 'form-fill-response',
    scenarioId: fixture.scenario.scenarioId,
    userId: fixture.scenario.userId,
    corpusId: fixture.scenario.corpusId,
    formId: fixture.scenario.formId,
    backendUrl: sanitizeUrlForArtifact(backendUrl),
    response: redactResponseBase64(response, pdfBytes),
  };
}

export function redactResponseBase64(response, pdfBytes) {
  return {
    ...response,
    filledPdfBase64: response.filledPdfBase64
      ? {
          redacted: true,
          byteLength: pdfBytes?.length ?? Buffer.from(response.filledPdfBase64, 'base64').length,
        }
      : null,
  };
}

function decodeResponsePdfBytes(response) {
  if (typeof response?.filledPdfBase64 !== 'string' || !response.filledPdfBase64) {
    return null;
  }
  return Buffer.from(response.filledPdfBase64, 'base64');
}

export function formatFillFormResult(result) {
  return result.lines.join('\n');
}

function formatPayload(payload) {
  if (typeof payload?.message === 'string') return payload.message;
  return JSON.stringify(payload).slice(0, 500);
}

export function sanitizeUrlForArtifact(value) {
  try {
    const url = new URL(value);
    url.username = '';
    url.password = '';
    return url.toString();
  } catch {
    return value;
  }
}

function redactSecret(text, secret) {
  if (!secret) return text;
  return text.split(secret).join('[redacted-auth-token]');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await runFillForm({ args: process.argv.slice(2) });
  console.log(formatFillFormResult(result));
  process.exitCode = result.exitCode;
}
