import { createHash } from 'node:crypto';

const FAMILY_COUNTS = Object.freeze({ extraction: 6, search: 4, consolidation: 2, form: 4 });
const invalid = (kind) => { throw new Error(`Invalid quality ${kind}`); };

// Inputs are already semantic units from the actual application validators.
// This function never coerces values or invents a fuzzy normalization rule.
function canonical(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  throw new Error('Non-JSON unit');
}

function keys(units, kind) {
  if (!Array.isArray(units) || units.length > 1000) invalid(kind);
  try { return units.map((unit) => JSON.stringify(canonical(unit))); }
  catch { invalid(kind); }
}

function counts(expected, actual) {
  const remaining = new Set(expected);
  let truePositive = 0;
  for (const unit of actual) {
    if (remaining.delete(unit)) truePositive++;
  }
  return { truePositive, falseNegative: remaining.size, falsePositive: actual.length - truePositive };
}

function metrics(value) {
  const { truePositive: tp, falsePositive: fp, falseNegative: fn } = value;
  return { ...value, recall: tp + fn ? tp / (tp + fn) : null, precision: tp + fp ? tp / (tp + fp) : null };
}

function summarize(trials) {
  const sum = (stage) => metrics(trials.reduce((total, trial) => ({
    truePositive: total.truePositive + trial[stage].truePositive,
    falseNegative: total.falseNegative + trial[stage].falseNegative,
    falsePositive: total.falsePositive + trial[stage].falsePositive,
  }), { truePositive: 0, falseNegative: 0, falsePositive: 0 }));
  const validated = sum('validated');
  const negativeTrials = trials.filter((trial) => trial.negativeCase);
  const negativeCasesCorrect = negativeTrials.filter((trial) => trial.negativeCorrect).length;
  const failedTrials = trials.filter((trial) => trial.failed).length;
  const criticalViolations = trials.reduce((total, trial) => total + trial.criticalViolations, 0);
  return {
    proposal: sum('proposal'), validated, failedTrials, criticalViolations,
    negativeCasesCorrect, negativeTrials: negativeTrials.length,
    passed: failedTrials === 0 && criticalViolations === 0 &&
      negativeCasesCorrect === negativeTrials.length &&
      validated.recall !== null && validated.recall >= 0.9 &&
      validated.precision !== null && validated.precision >= 0.95,
  };
}

/** Fixed CP1 quality gate. Synthetic self-tests are not model qualification. */
export function scoreQuality(manifest, trials) {
  if (manifest?.version !== 1 || manifest.repetitions !== 3 ||
      !Array.isArray(manifest.cases) || manifest.cases.length !== 16) invalid('manifest');
  const cases = new Map();
  for (const entry of manifest.cases) {
    if (!entry || typeof entry.id !== 'string' || !/^[a-z0-9-]{1,80}$/.test(entry.id) ||
        !Object.hasOwn(FAMILY_COUNTS, entry.family) || cases.has(entry.id)) invalid('manifest');
    const expected = keys(entry.expectedUnits, 'manifest');
    if (new Set(expected).size !== expected.length) invalid('manifest');
    cases.set(entry.id, { ...entry, expected });
  }
  for (const [family, count] of Object.entries(FAMILY_COUNTS)) {
    const entries = [...cases.values()].filter((entry) => entry.family === family);
    if (entries.length !== count || !entries.some((entry) => entry.expected.length) ||
        !entries.some((entry) => !entry.expected.length)) invalid('manifest');
  }
  if (!Array.isArray(trials) || trials.length !== 48) throw new Error('Incomplete quality trials');
  const seen = new Set();
  const scored = trials.map((trial) => {
    const entry = cases.get(trial?.caseId);
    const key = `${trial?.caseId}:${trial?.repetition}`;
    if (!entry || !Number.isInteger(trial.repetition) || trial.repetition < 0 || trial.repetition > 2 ||
        seen.has(key) || typeof trial.structureValid !== 'boolean' || typeof trial.failed !== 'boolean' ||
        !Number.isSafeInteger(trial.criticalViolations) || trial.criticalViolations < 0) invalid('trial');
    seen.add(key);
    const proposal = keys(trial.proposalUnits, 'trial');
    const suppliedValidated = keys(trial.validatedUnits, 'trial');
    const failed = trial.failed || !trial.structureValid;
    // A failed trial cannot claim successfully validated units. Keep any output
    // as false positives as well as counting every expected unit as missing.
    const validated = failed
      ? { truePositive: 0, falseNegative: entry.expected.length, falsePositive: suppliedValidated.length }
      : counts(entry.expected, suppliedValidated);
    return {
      caseId: entry.id, family: entry.family, repetition: trial.repetition,
      failed, criticalViolations: trial.criticalViolations,
      negativeCase: entry.expected.length === 0,
      negativeCorrect: !failed && entry.expected.length === 0 && suppliedValidated.length === 0,
      proposal: metrics(counts(entry.expected, proposal)), validated: metrics(validated),
    };
  });
  const families = Object.fromEntries(Object.keys(FAMILY_COUNTS).map((family) =>
    [family, summarize(scored.filter((trial) => trial.family === family))]));
  return {
    manifestSha256: createHash('sha256').update(JSON.stringify(canonical(manifest))).digest('hex'),
    passed: Object.values(families).every((family) => family.passed),
    families, overall: summarize(scored), trials: scored,
  };
}
