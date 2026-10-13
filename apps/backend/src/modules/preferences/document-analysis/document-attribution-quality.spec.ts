import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Pure fixture/scoring checks. No model, native runtime or generated manifest.
function exercise(code: string) {
  const directory = join(__dirname, '../../../../test/document-attribution');
  const moduleUrl = pathToFileURL(join(directory, 'extraction-slice.mjs')).href;
  return JSON.parse(execFileSync(process.execPath, ['--input-type=module'], {
    input: `
      import { readFile } from 'node:fs/promises';
      import { scoreExtractionSlice, verifyLegacyExtractionEntries, plannedExtractionTrials } from ${JSON.stringify(moduleUrl)};
      const root = ${JSON.stringify(join(directory, '../../../..'))};
      const original = JSON.parse(await readFile(root + '/docs/evidence/local-migration/06-local-model/quality-manifest.json'));
      const manifest = { repetitions: 3, cases: original.cases.filter(entry => entry.family === 'extraction') };
      const trials = plannedExtractionTrials(manifest.cases).map(trial => {
        const entry = manifest.cases.find(entry => entry.id === trial.caseId);
        return { ...trial, status: 'completed', structureValid: true, proposalUnits: entry.expectedUnits, validatedUnits: entry.expectedUnits };
      });
      ${code}
    `,
    encoding: 'utf8', timeout: 3000, maxBuffer: 64 * 1024,
  }));
}

describe('attribution affected extraction slice (fake outputs only)', () => {
  it('requires all six original extraction cases three times and reports the strict perfect score', () => {
    const result = exercise('console.log(JSON.stringify({ trials, score: scoreExtractionSlice(manifest, trials) }));');
    expect(result.trials).toHaveLength(18);
    expect(new Set(result.trials.map(trial => `${trial.caseId}:${trial.repetition}`)).size).toBe(18);
    expect(result.score).toMatchObject({ strictPassed: true, amendmentEAccepted: true, validated: { truePositive: 21, falsePositive: 0, falseNegative: 0 } });
  });

  it('retains a failed strict 18/21 result separately from the narrow historical E exception', () => {
    const result = exercise(`
      for (const trial of trials) if (trial.caseId === 'extraction-instruction-injection') trial.validatedUnits = [];
      console.log(JSON.stringify(scoreExtractionSlice(manifest, trials)));
    `);
    expect(result).toMatchObject({ strictPassed: false, amendmentEAccepted: true, validated: { truePositive: 18, falsePositive: 0, falseNegative: 3 } });
    expect(result.validated.recall).toBeCloseTo(18 / 21);
  });

  it.each(['missing', 'extra', 'duplicate', 'unknown'])(
    'rejects %s trial membership instead of claiming an affected-slice result', (variant) => {
      const result = exercise(`
        const variant = ${JSON.stringify(variant)};
        if (variant === 'missing') trials.pop();
        if (variant === 'extra') trials.push({ ...trials[0], repetition: 3 });
        if (variant === 'duplicate') trials[1] = { ...trials[0] };
        if (variant === 'unknown') trials[0].caseId = 'not-an-original-extraction-case';
        let rejected = false;
        try { scoreExtractionSlice(manifest, trials); } catch { rejected = true; }
        console.log(JSON.stringify({ rejected }));
      `);
      expect(result.rejected).toBe(true);
    },
  );

  it.each(['non-E omission', 'wrong fact', 'extra fact', 'failed empty negative'])(
    'does not extend exception E to %s', (variant) => {
      const result = exercise(`
        const variant = ${JSON.stringify(variant)};
        if (variant === 'non-E omission') trials.find(trial => trial.caseId === 'extraction-name-history').validatedUnits = [];
        if (variant === 'wrong fact') trials.find(trial => trial.caseId === 'extraction-instruction-injection').validatedUnits = [{ slug: 'profile.email', value: 'jordan@example.test' }];
        if (variant === 'extra fact') trials[0].validatedUnits = [...trials[0].validatedUnits, { slug: 'profile.email', value: 'jordan@example.test' }];
        if (variant === 'failed empty negative') trials.find(trial => trial.caseId === 'extraction-other-person-decoy').status = 'failed';
        console.log(JSON.stringify(scoreExtractionSlice(manifest, trials)));
      `);
      expect(result.amendmentEAccepted).toBe(false);
    },
  );

  it('rejects changed historical document bytes or definitions against immutable fixture identities', () => {
    const result = exercise(`
      const { cases } = await import(root + '/scripts/local-migration/fixtures/local-model-feasibility/cases.mjs');
      const entries = verifyLegacyExtractionEntries(cases, original);
      let documentRejected = false; let definitionRejected = false;
      const changedDocument = structuredClone(cases);
      changedDocument.find(entry => entry.id === entries[0].id).documentText += '\\nchanged';
      const changedDefinition = structuredClone(cases);
      changedDefinition.find(entry => entry.id === entries[0].id).definitions[0].description += ' changed';
      try { verifyLegacyExtractionEntries(changedDocument, original); } catch { documentRejected = true; }
      try { verifyLegacyExtractionEntries(changedDefinition, original); } catch { definitionRejected = true; }
      console.log(JSON.stringify({ count: entries.length, documentRejected, definitionRejected }));
    `);
    expect(result).toEqual({ count: 6, documentRejected: true, definitionRejected: true });
  });

  it.each(['complete', 'E omission', 'attribution failure', 'incomplete', 'missing native evidence', 'slow workflow'])(
    'keeps bundled attribution and affected-quality acceptance distinct for %s', (variant) => {
      const result = exercise(`
        const { finishReceipt, plannedTrials } = await import(${JSON.stringify(pathToFileURL(join(__dirname, '../../../../test/document-attribution/attribution-live.mjs')).href)});
        const fixtures = JSON.parse(await readFile(root + '/apps/backend/src/modules/preferences/document-analysis/__fixtures__/attribution-cases.json'));
        const attribution = plannedTrials(fixtures.cases).map(trial => ({ ...trial, status: 'completed', score: { passed: true }, stageScores: [{ attributionCorrect: true, unexpectedFacts: [] }] }));
        trials.forEach((trial, index) => Object.assign(trial, { elapsedMs: 1000, modelState: 'ready', calls: [{ index }] }));
        const nativeCompletions = trials.map((trial, index) => ({ callIndex: index, elapsedMs: 900, status: 'completed' }));
        const variant = ${JSON.stringify(variant)};
        if (variant === 'E omission') for (const trial of trials) if (trial.caseId === 'extraction-instruction-injection') trial.validatedUnits = [];
        if (variant === 'attribution failure') attribution[0].score.passed = false;
        if (variant === 'incomplete') { trials[0].status = 'started'; trials[1].status = 'not_run'; }
        if (variant === 'missing native evidence') nativeCompletions.pop();
        if (variant === 'slow workflow') trials[0].elapsedMs = 180001;
        const receipt = { extractionManifest: manifest, trials: [...attribution, ...trials], nativeCompletions, lifecycle: { completed: true, cleanupComplete: true } };
        finishReceipt(receipt, { sourceBuildAndHelpersUnchanged: true, modelUnchanged: true, runtimeUnchanged: true });
        console.log(JSON.stringify(receipt));
      `);
      expect(result.trials).toHaveLength(28);
      expect(result.passed).toBe(['complete', 'E omission'].includes(variant));
      if (variant === 'E omission') expect(result.affectedExtraction).toMatchObject({ strictPassed: false, amendmentEAccepted: true });
      if (variant === 'incomplete') expect(result.trials.slice(10, 12).map(trial => trial.status)).toEqual(['incomplete', 'not_run']);
    },
  );
});
