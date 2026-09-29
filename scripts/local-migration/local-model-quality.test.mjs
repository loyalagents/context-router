import assert from 'node:assert/strict';
import test from 'node:test';
import { scoreQuality } from './fixtures/local-model-feasibility/quality.mjs';

function fixture() {
  const cases = Object.entries({ extraction: 6, search: 4, consolidation: 2, form: 4 })
    .flatMap(([family, count]) => Array.from({ length: count }, (_, index) => ({
      id: `${family}-${index}`, family,
      expectedUnits: index === count - 1 ? [] : [{ slug: 'synthetic.value', value: '0012' }],
    })));
  const manifest = { version: 1, repetitions: 3, cases };
  const trials = cases.flatMap((entry) => [0, 1, 2].map((repetition) => ({
    caseId: entry.id, repetition, structureValid: true, failed: false,
    proposalUnits: structuredClone(entry.expectedUnits),
    validatedUnits: structuredClone(entry.expectedUnits), criticalViolations: 0,
  })));
  return { manifest, trials };
}

test('requires complete independently passing families and reports proposal/validated metrics', () => {
  const { manifest, trials } = fixture();
  const report = scoreQuality(manifest, trials);
  assert.equal(report.passed, true);
  assert.equal(report.trials.length, 48);
  assert.match(report.manifestSha256, /^[a-f0-9]{64}$/);
  assert.equal(report.overall.validated.recall, 1);
  assert.equal(report.families.search.validated.precision, 1);
  assert.equal(report.families.search.negativeCasesCorrect, 3);
  trials[0].proposalUnits.push({ slug: 'inaccessible.secret', value: 'decoy' });
  const filtered = scoreQuality(manifest, trials);
  assert.equal(filtered.passed, true);
  assert.ok(filtered.overall.proposal.precision < 1);
  assert.equal(filtered.overall.validated.precision, 1);
});

test('strong extraction cannot conceal another task family failing', () => {
  const { manifest, trials } = fixture();
  for (const trial of trials.filter((entry) => entry.caseId.startsWith('search-'))) {
    trial.validatedUnits = [{ slug: 'wrong', value: 'wrong' }];
  }
  const report = scoreQuality(manifest, trials);
  assert.equal(report.passed, false);
  assert.equal(report.families.extraction.passed, true);
  assert.equal(report.families.search.passed, false);
  assert.equal(report.families.search.validated.recall, 0);
  assert.equal(report.families.search.negativeCasesCorrect, 0);
});

for (const dimension of ['recall', 'precision']) {
  test(`rejects a family-only ${dimension} failure even when aggregate utility and every negative pass`, () => {
    const { manifest, trials } = fixture();
    for (const entry of manifest.cases.filter((entry) => entry.family === 'extraction' && entry.expectedUnits.length)) {
      entry.expectedUnits = Array.from({ length: 20 }, (_, index) => ({ slug: `synthetic.${index}`, value: '0012' }));
      for (const trial of trials.filter((trial) => trial.caseId === entry.id)) {
        trial.proposalUnits = structuredClone(entry.expectedUnits);
        trial.validatedUnits = structuredClone(entry.expectedUnits);
      }
    }
    const searchTrial = trials.find((trial) => trial.caseId === 'search-0');
    if (dimension === 'recall') searchTrial.validatedUnits = [];
    else searchTrial.validatedUnits.push({ slug: 'unexpected', value: 'extra' });
    const report = scoreQuality(manifest, trials);
    assert.equal(report.overall.passed, true);
    assert.equal(report.overall.negativeCasesCorrect, report.overall.negativeTrials);
    assert.equal(report.families.search.passed, false);
    assert.equal(report.passed, false);
    assert.equal(report.families.search.validated[dimension === 'recall' ? 'precision' : 'recall'], 1);
  });
}

test('invalid/failed responses remain in denominators and cannot pass negative cases', () => {
  const { manifest, trials } = fixture();
  trials[0].structureValid = false;
  trials[0].validatedUnits = [];
  const negative = trials.find((entry) => entry.caseId === 'form-3');
  negative.failed = true;
  const report = scoreQuality(manifest, trials);
  assert.equal(report.passed, false);
  assert.equal(report.overall.failedTrials, 2);
  assert.equal(report.trials[0].validated.falseNegative, 1);
  assert.equal(report.families.form.negativeCasesCorrect, 2);
});

test('empty negative denominators are not perfect utility evidence', () => {
  const { manifest, trials } = fixture();
  const result = scoreQuality(manifest, trials).trials.find((entry) => entry.caseId === 'form-3');
  assert.equal(result.validated.recall, null);
  assert.equal(result.validated.precision, null);
  manifest.cases.filter((entry) => entry.family === 'form').forEach((entry) => { entry.expectedUnits = []; });
  assert.throws(() => scoreQuality(manifest, trials), /Invalid quality manifest/);
});

test('zero accepted critical violations is independent of aggregate precision', () => {
  const { manifest, trials } = fixture();
  trials[0].criticalViolations = 1;
  const report = scoreQuality(manifest, trials);
  assert.equal(report.overall.validated.precision, 1);
  assert.equal(report.passed, false);
  assert.equal(report.overall.criticalViolations, 1);
});

test('missing, duplicate and unknown trials cannot produce selection evidence', () => {
  const { manifest, trials } = fixture();
  assert.throws(() => scoreQuality(manifest, trials.slice(1)), /Incomplete quality trials/);
  assert.throws(() => scoreQuality(manifest, [...trials.slice(1), trials[1]]), /Invalid quality trial/);
  trials[0].caseId = 'unknown';
  assert.throws(() => scoreQuality(manifest, trials), /Invalid quality trial/);
});

test('rejects sparse trial/semantic arrays instead of silently dropping measurements', () => {
  const missing = fixture();
  delete missing.trials[0];
  assert.throws(() => scoreQuality(missing.manifest, missing.trials), /Invalid quality trial/);
  for (const stage of ['proposalUnits', 'validatedUnits']) {
    const { manifest, trials } = fixture();
    delete trials[0][stage][0];
    assert.throws(() => scoreQuality(manifest, trials), /Invalid quality trial/);
    trials[0][stage] = [{ nested: Array(1) }];
    assert.throws(() => scoreQuality(manifest, trials), /Invalid quality trial/);
  }
  const { manifest, trials } = fixture();
  delete manifest.cases[0].expectedUnits[0];
  assert.throws(() => scoreQuality(manifest, trials), /Invalid quality manifest/);
});

test('semantic comparison preserves identifiers, types, and duplicate penalties', () => {
  const { manifest, trials } = fixture();
  trials[0].validatedUnits = [{ value: '0012', slug: 'synthetic.value' }];
  assert.equal(scoreQuality(manifest, trials).passed, true);
  trials[0].validatedUnits = [{ slug: 'synthetic.value', value: 12 }];
  const typed = scoreQuality(manifest, trials).trials[0].validated;
  assert.equal(typed.falseNegative, 1);
  assert.equal(typed.falsePositive, 1);
  trials[0].validatedUnits = [...trials[0].proposalUnits, ...trials[0].proposalUnits];
  assert.equal(scoreQuality(manifest, trials).trials[0].validated.falsePositive, 1);
});

test('rejects non-JSON units, malformed trial evidence and duplicated expected units', () => {
  for (const value of [undefined, NaN, Infinity, { value: undefined }, new Date(), 1n]) {
    const { manifest, trials } = fixture();
    trials[0].validatedUnits = [value];
    assert.throws(() => scoreQuality(manifest, trials), /Invalid quality trial/);
  }
  const { manifest, trials } = fixture();
  trials[0].criticalViolations = -1;
  assert.throws(() => scoreQuality(manifest, trials), /Invalid quality trial/);
  trials[0].criticalViolations = 0;
  manifest.cases[0].expectedUnits.push(manifest.cases[0].expectedUnits[0]);
  assert.throws(() => scoreQuality(manifest, trials), /Invalid quality manifest/);
});
