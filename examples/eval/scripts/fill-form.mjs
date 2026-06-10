#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRunPlan } from './eval-runner/actions.mjs';
import { loadScenarioFixture } from './eval-runner/fixtures.mjs';
import { readFilledPdfFieldsFromBase64 } from './eval-runner/pdf.mjs';
import { buildFilledFormSnapshot } from './eval-runner/snapshots.mjs';
import { scoreFormToFile } from './scoring/form.mjs';
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
    const response = await fetchFormFillResponse({
      backendUrl: options.backendUrl,
      authToken: options.authToken,
      formPdfPath: fixture.formPdfPath,
      fetchImpl,
    });
    assertScorableResponse(response);

    const pdfBytes = Buffer.from(response.filledPdfBase64, 'base64');
    const filledPdfFields = await pdfFieldReader({
      repoRoot,
      base64: response.filledPdfBase64,
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
      const responsePath = path.resolve(repoRoot, options.responseOut);
      await writeJson(
        responsePath,
        buildResponseArtifact({ fixture, backendUrl: options.backendUrl, response, pdfBytes }),
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

  for (const key of ['scenarioId', 'out']) {
    if (!options[key]) {
      return { kind: 'usage-error', message: `Missing required ${optionName(key)}` };
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
  ].join('\n');
}

export async function fetchFormFillResponse({
  backendUrl,
  authToken,
  formPdfPath,
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
    throw new Error(
      `Form-fill response status was ${response.status}. This eval runner only scores success or partial responses.`,
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
}

export function buildResponseArtifact({ fixture, backendUrl, response, pdfBytes }) {
  return {
    schemaVersion: 1,
    artifactType: 'form-fill-response',
    scenarioId: fixture.scenario.scenarioId,
    userId: fixture.scenario.userId,
    corpusId: fixture.scenario.corpusId,
    formId: fixture.scenario.formId,
    backendUrl,
    response: redactResponseBase64(response, pdfBytes),
  };
}

export function redactResponseBase64(response, pdfBytes) {
  return {
    ...response,
    filledPdfBase64: response.filledPdfBase64
      ? {
          redacted: true,
          byteLength: pdfBytes.length,
        }
      : null,
  };
}

export function formatFillFormResult(result) {
  return result.lines.join('\n');
}

function formatPayload(payload) {
  if (typeof payload?.message === 'string') return payload.message;
  return JSON.stringify(payload).slice(0, 500);
}

function optionName(key) {
  return `--${key.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`)}`;
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
