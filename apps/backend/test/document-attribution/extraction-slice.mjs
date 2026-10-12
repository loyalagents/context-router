// Test-only affected quality slice. Historical fixtures and gates stay unchanged.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const digest = (value) => sha256(JSON.stringify(value));
export const historicalManifestPath = 'docs/evidence/local-migration/06-local-model/quality-manifest.json';
export const historicalManifestSha256 = '186e1d0a2cc88ef966fc030ec6857403784f2472a695d7ca99714604b6d136be';
export const historicalInputs = [
  historicalManifestPath,
  'examples/eval/users/elena-marquez/corpora/template-smoke/documents/identity/002-name-history-note.md',
  'examples/eval/users/samir-desai/corpora/template-smoke/documents/work-authorization/004-lawful-permanent-resident-note.md',
  'examples/eval/users/maya-chen-newhire/corpora/packet-hard-required-v2/documents/hr-onboarding/035-hr-support-correction-thread.txt',
  'examples/eval/users/maya-chen-newhire/corpora/packet-small/documents/noise/008-other-employee-sample-packet.md',
];
export const extractionCaseIds = Object.freeze([
  'extraction-name-history', 'extraction-work-authorization', 'extraction-stale-title',
  'extraction-absent-values', 'extraction-other-person-decoy', 'extraction-instruction-injection',
]);

function requireSixCases(entries) {
  assert.equal(entries.length, 6);
  assert.deepEqual(entries.map((entry) => entry.id).sort(), [...extractionCaseIds].sort());
}

export function verifyLegacyExtractionEntries(cases, original) {
  const entries = cases.filter((entry) => entry.family === 'extraction');
  requireSixCases(entries);
  const frozen = original.cases.filter((entry) => entry.family === 'extraction');
  requireSixCases(frozen);
  for (const entry of entries) {
    const expected = frozen.find((item) => item.id === entry.id);
    assert.equal(digest(entry), expected.fixtureSha256, 'Historical extraction fixture changed');
    assert.deepEqual(entry.expectedUnits, expected.expectedUnits);
    assert.equal(expected.criticalPolicy, entry.criticalUnexpected ? 'each-unexpected-validated-unit' : 'none');
  }
  return entries;
}

export async function loadLegacyExtractionEntries(options = {}) {
  const bytes = await readFile(join(repoRoot, historicalManifestPath), { signal: options.signal });
  assert.equal(sha256(bytes), historicalManifestSha256, 'Historical manifest changed');
  const original = JSON.parse(bytes);
  const { cases } = await import(pathToFileURL(join(repoRoot, 'scripts/local-migration/fixtures/local-model-feasibility/cases.mjs')));
  return { entries: verifyLegacyExtractionEntries(cases, original), original };
}

export function plannedExtractionTrials(entries) {
  requireSixCases(entries);
  return entries.flatMap((entry) => [0, 1, 2].map((repetition) => ({ suite: 'affected-extraction', caseId: entry.id, repetition, status: 'not_run' })));
}

function canonical(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(canonical);
  assert.ok(value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype);
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

function counts(expected, actual) {
  assert.ok(Array.isArray(actual));
  const remaining = new Set(expected.map((value) => JSON.stringify(canonical(value))));
  assert.equal(remaining.size, expected.length);
  let truePositive = 0;
  for (const value of actual) if (remaining.delete(JSON.stringify(canonical(value)))) truePositive++;
  return { truePositive, falsePositive: actual.length - truePositive, falseNegative: remaining.size };
}

const metrics = (value) => ({ ...value,
  recall: value.truePositive + value.falseNegative ? value.truePositive / (value.truePositive + value.falseNegative) : null,
  precision: value.truePositive + value.falsePositive ? value.truePositive / (value.truePositive + value.falsePositive) : null,
});

/** Original family thresholds and amendment E are separate from exact oracles. */
export function scoreExtractionSlice(manifest, trials) {
  requireSixCases(manifest.cases);
  assert.equal(manifest.repetitions, 3);
  assert.equal(trials.length, 18, 'Incomplete affected extraction trials');
  const seen = new Set();
  const scored = trials.map((trial) => {
    const entry = manifest.cases.find((entry) => entry.id === trial.caseId);
    const key = `${trial.caseId}:${trial.repetition}`;
    assert.ok(entry && Number.isInteger(trial.repetition) && trial.repetition >= 0 && trial.repetition < 3 && !seen.has(key));
    seen.add(key);
    const failed = trial.status !== 'completed' || trial.structureValid !== true;
    const actual = trial.validatedUnits ?? [];
    const validated = failed ? { truePositive: 0, falsePositive: actual.length, falseNegative: entry.expectedUnits.length } : counts(entry.expectedUnits, actual);
    const criticalViolations = entry.criticalPolicy === 'each-unexpected-validated-unit' ? counts(entry.expectedUnits, actual).falsePositive : 0;
    return { caseId: entry.id, repetition: trial.repetition, failed, criticalViolations,
      negativeCase: entry.expectedUnits.length === 0, negativeCorrect: !failed && entry.expectedUnits.length === 0 && actual.length === 0,
      proposal: metrics(counts(entry.expectedUnits, trial.proposalUnits ?? [])), validated: metrics(validated) };
  });
  const sum = (stage) => metrics(scored.reduce((total, trial) => ({
    truePositive: total.truePositive + trial[stage].truePositive,
    falsePositive: total.falsePositive + trial[stage].falsePositive,
    falseNegative: total.falseNegative + trial[stage].falseNegative,
  }), { truePositive: 0, falsePositive: 0, falseNegative: 0 }));
  const validated = sum('validated');
  const failedTrials = scored.filter((trial) => trial.failed).length;
  const criticalViolations = scored.reduce((total, trial) => total + trial.criticalViolations, 0);
  const negatives = scored.filter((trial) => trial.negativeCase);
  const strictPassed = failedTrials === 0 && criticalViolations === 0 && negatives.every((trial) => trial.negativeCorrect) && validated.recall >= 0.9 && validated.precision >= 0.95;
  const exactOraclePassed = scored.every((trial) => !trial.failed && trial.validated.falsePositive === 0 && trial.validated.falseNegative === 0);
  const amendmentEAccepted = scored.every((trial) => !trial.failed && trial.criticalViolations === 0 && trial.validated.falsePositive === 0 &&
    (trial.validated.falseNegative === 0 || (trial.caseId === 'extraction-instruction-injection' && trial.validated.falseNegative === 1 && trial.validated.truePositive === 0)));
  return { scope: 'six-case-extraction-slice-only', fullQualityQualification: false,
    strictPolicy: { minimumRecall: 0.9, minimumPrecision: 0.95, zeroFailures: true, zeroCriticalViolations: true, allNegativeCasesCorrect: true },
    strictPassed, exactOraclePassed, amendmentEAccepted, failedTrials, criticalViolations,
    proposal: sum('proposal'), validated, trials: scored };
}

/** Run only after the approved candidate build; golden replies bind prompts only. */
export async function createExtractionManifest(binding, options = {}) {
  const { entries, original } = await loadLegacyExtractionEntries(options);
  const shared = join(repoRoot, 'scripts/local-migration/fixtures/local-model-feasibility');
  const { runConsumer, fixtureReply } = await import(pathToFileURL(join(shared, 'consumers.mjs')));
  const { userMessage } = await import(pathToFileURL(join(shared, 'freeze.mjs')));
  const require = createRequire(join(repoRoot, 'apps/backend/package.json'));
  const { localJsonSchema } = require(join(repoRoot, 'apps/backend/dist/infrastructure/local-model/schema.js'));
  const { LOCAL_AI_CAPABILITIES } = require(join(repoRoot, 'apps/backend/dist/domains/shared/ports/ai-execution.js'));
  const cases = [];
  for (const entry of entries) {
    if (options.signal?.aborted || performance.now() >= (options.deadline ?? Infinity)) throw new Error('Extraction manifest verification stopped');
    const calls = [];
    const invoke = async (prompt, schema, file) => {
      calls.push({ promptSha256: sha256(prompt), messageSha256: sha256(userMessage(prompt, file)), schemaSha256: digest(localJsonSchema(schema)),
        fileSha256: sha256(file.buffer), mimeType: file.mimeType });
      return schema.parse(fixtureReply(entry));
    };
    await runConsumer(entry, { capabilities: LOCAL_AI_CAPABILITIES, generateStructuredWithFile: (p, f, s) => invoke(p, s, f),
      generateStructured: () => { throw new Error('Unexpected golden consolidation'); } }, options);
    assert.equal(calls.length, 1);
    const frozen = original.cases.find((item) => item.id === entry.id);
    cases.push({ ...frozen, filename: `${entry.id}.txt`, calls });
  }
  const inputs = await Promise.all(historicalInputs.map(async (file) => [file, sha256(await readFile(join(repoRoot, file), { signal: options.signal }))]));
  return { schemaVersion: 1, scope: 'six-case-extraction-slice-only', repetitions: 3, originalManifestSha256: historicalManifestSha256,
    sourceSha256: binding.sourceSha256, buildSha256: binding.buildSha256, inputs, cases };
}
