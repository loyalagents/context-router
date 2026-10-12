import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Native ESM helper tests, with no model/runtime/assets and no shell execution.
function exercise(code: string) {
  const moduleUrl = pathToFileURL(join(__dirname, '../../../../test/document-attribution/attribution-live.mjs')).href;
  const output = execFileSync(process.execPath, ['--input-type=module'], {
    input: `import { runOwnedSession, createCompletionBudget, scoreObservation, scoreStages, plannedTrials, finishReceipt } from ${JSON.stringify(moduleUrl)};\nconst harnessUrl = ${JSON.stringify(moduleUrl)};\n${code}`,
    encoding: 'utf8',
    timeout: 3000,
    maxBuffer: 32 * 1024,
  });
  return JSON.parse(output);
}

describe('attribution live harness controls (fake resources only)', () => {
  it('settles normal work and closes every owner before removing roots and hooks', () => {
    const result = exercise(`
      const events = [];
      const before = process.listenerCount('SIGTERM');
      const child = { running: true, async stop() { events.push('stop'); this.running = false; } };
      const outcome = await runOwnedSession({
        startRuntime: async () => child, waitReady: async () => { events.push('ready'); },
        run: async () => { events.push('run'); }, closeAdapter: async () => { events.push('close'); },
        removeRoots: async () => { events.push('remove'); }, workMs: 1000, cleanupMs: 30,
      });
      console.log(JSON.stringify({ outcome, events, listenersRestored: process.listenerCount('SIGTERM') === before }));
    `);
    expect(result.outcome).toMatchObject({ completed: true, runtimeReaped: true, adapterClosed: true, ownersSettled: true, rootsRemoved: true, cleanupComplete: true });
    expect(result.events.slice(0, 2)).toEqual(['ready', 'run']);
    expect(result.events.at(-1)).toBe('remove');
    expect(result.listenersRestored).toBe(true);
  });

  it('stops and reaps its child when SIGINT arrives during never-completing readiness', () => {
    const result = exercise(`
      const events = [];
      const child = { running: true, async stop() { events.push('stop'); this.running = false; } };
      const before = process.listenerCount('SIGINT');
      const outcome = await runOwnedSession({
        startRuntime: async () => child,
        waitReady: async () => { events.push('ready'); process.emit('SIGINT'); await new Promise(() => {}); },
        run: async () => { events.push('run'); },
        closeAdapter: async () => { events.push('close'); },
        removeRoots: async () => { events.push('remove'); },
        workMs: 1000, cleanupMs: 30,
      });
      console.log(JSON.stringify({ outcome, events, listenersRestored: process.listenerCount('SIGINT') === before }));
    `);
    expect(result.outcome).toMatchObject({ completed: false, stopReason: 'SIGINT', runtimeReaped: true, adapterClosed: true, ownersSettled: false, rootsRemoved: false });
    expect(result.events).toContain('stop');
    expect(result.events).not.toContain('run');
    expect(result.listenersRestored).toBe(true);
  });

  it('does not let a never-settling adapter close gate runtime reaping or remove roots', () => {
    const result = exercise(`
      const events = [];
      const child = { running: true, async stop() { events.push('stop'); this.running = false; } };
      const started = performance.now();
      const outcome = await runOwnedSession({
        startRuntime: async () => child, waitReady: async () => {}, run: async () => {},
        closeAdapter: async () => { events.push('close'); await new Promise(() => {}); },
        removeRoots: async () => { events.push('remove'); }, workMs: 1000, cleanupMs: 30,
      });
      console.log(JSON.stringify({ outcome, events, elapsedMs: performance.now() - started }));
    `);
    expect(result.outcome).toMatchObject({ runtimeReaped: true, adapterClosed: false, rootsRemoved: false, cleanupComplete: false });
    expect(result.events).toContain('stop');
    expect(result.events).not.toContain('remove');
    expect(result.elapsedMs).toBeLessThan(1000);
  });

  it('preserves fresh roots and reports incomplete cleanup when exact-child stop fails', () => {
    const result = exercise(`
      let removed = false;
      const outcome = await runOwnedSession({
        startRuntime: async () => ({ running: true, async stop() { throw new Error('synthetic reap failure'); } }),
        waitReady: async () => {}, run: async () => {}, closeAdapter: async () => {},
        removeRoots: async () => { removed = true; }, workMs: 1000, cleanupMs: 30,
      });
      console.log(JSON.stringify({ outcome, removed }));
    `);
    expect(result.outcome).toMatchObject({ runtimeReaped: false, rootsRemoved: false, cleanupComplete: false });
    expect(result.removed).toBe(false);
  });

  it('bounds hung work with one abort signal and records unused trial slots', () => {
    const result = exercise(`
      let observedSignal;
      const child = { running: true, async stop() { this.running = false; } };
      const outcome = await runOwnedSession({
        startRuntime: async () => child, waitReady: async () => {},
        run: async (signal) => { observedSignal = signal; await new Promise(() => {}); },
        closeAdapter: async () => {}, removeRoots: async () => {}, workMs: 20, cleanupMs: 30,
      });
      console.log(JSON.stringify({ outcome, aborted: observedSignal.aborted, trials: plannedTrials([{ id: 'one' }, { id: 'two' }]) }));
    `);
    expect(result.outcome).toMatchObject({ completed: false, stopReason: 'time-budget', ownersSettled: false, cleanupComplete: false, rootsRemoved: false });
    expect(result.aborted).toBe(true);
    expect(result.trials.map((value) => [value.caseId, value.repetition, value.status])).toEqual([
      ['one', 0, 'not_run'], ['one', 1, 'not_run'], ['two', 0, 'not_run'], ['two', 1, 'not_run'],
    ]);
  });

  it.each([60, 120])('counts every completion and blocks dispatch beyond %i with a typed cancellation', (maximum) => {
    const result = exercise(`
      const maximum = ${maximum};
      const controller = new AbortController();
      class SyntheticAiError extends Error { kind = 'cancelled'; }
      const budget = createCompletionBudget({ controller, cancellationError: () => new SyntheticAiError(), maximum });
      let dispatched = 0;
      const complete = budget.wrap(async () => { dispatched++; return { text: '{}' }; });
      for (let i = 0; i < maximum; i++) await complete();
      let errorKind;
      try { await complete(); } catch (error) { errorKind = error.kind; }
      console.log(JSON.stringify({ dispatched, count: budget.count, aborted: controller.signal.aborted, errorKind }));
    `);
    expect(result).toEqual({ dispatched: maximum, count: maximum, aborted: true, errorKind: 'cancelled' });
  });

  it('separates attribution, useful recall, evidence and runtime completion', () => {
    const result = exercise(`
      const entry = { documentText: 'Maya: maya@example.test. Jordan: jordan@example.test.',
        expectedProposals: [{ slug: 'profile.email', value: 'maya@example.test' }], forbiddenValues: ['jordan@example.test'] };
      const output = (suggestions, status = 'success') => ({ status, suggestions, documentSummary: 'Jordan is also mentioned.' });
      console.log(JSON.stringify({
        good: scoreObservation(entry, output([{ slug: 'profile.email', newValue: 'maya@example.test', sourceSnippet: 'maya@example.test' }])),
        omitted: scoreObservation(entry, output([])),
        foreign: scoreObservation(entry, output([{ slug: 'profile.email', newValue: 'jordan@example.test', sourceSnippet: 'Jordan: jordan@example.test.' }])),
        badEvidence: scoreObservation(entry, output([{ slug: 'profile.email', newValue: 'maya@example.test', sourceSnippet: 'Jordan: jordan@example.test.' }])),
        failed: scoreObservation(entry, output([], 'ai_error')),
      }));
    `);
    expect(result.good).toMatchObject({ attributionCorrect: true, expectedFactsPresent: true, evidenceCorrect: true, runtimeCompleted: true });
    expect(result.omitted).toMatchObject({ expectedFactsPresent: false });
    expect(result.foreign).toMatchObject({ attributionCorrect: false, expectedFactsPresent: false });
    expect(result.badEvidence).toMatchObject({ attributionCorrect: true, evidenceCorrect: false });
    expect(result.failed).toMatchObject({ runtimeCompleted: false, passed: false });
  });

  it('keeps a foreign initial candidate visible despite a correct final result and ignores a harmless own-name no-op', () => {
    const result = exercise(`
      const entry = { documentText: 'Maya. maya@example.test. jordan@example.test.', activePreferences: [{ slug: 'profile.full_name', value: 'Maya' }],
        expectedProposals: [{ slug: 'profile.email', value: 'maya@example.test' }], forbiddenValues: ['jordan@example.test'] };
      const own = { slug: 'profile.email', newValue: 'maya@example.test', sourceSnippet: 'maya@example.test' };
      const other = { slug: 'profile.email', newValue: 'jordan@example.test', sourceSnippet: 'jordan@example.test' };
      const harmless = { slug: 'profile.full_name', newValue: 'Maya', sourceSnippet: 'Maya' };
      console.log(JSON.stringify({
        stages: scoreStages(entry, [{ stage: 'extraction', status: 'completed', parsed: { suggestions: [own, other, harmless] } },
          { stage: 'consolidation', status: 'completed', parsed: { suggestion: own } }]),
        harmless: scoreStages(entry, [{ stage: 'extraction', status: 'completed', parsed: { suggestions: [own, harmless] } }]),
      }));
    `);
    expect(result.stages[0]).toMatchObject({ attributionCorrect: false });
    expect(result.stages[1]).toMatchObject({ attributionCorrect: true, expectedFactsPresent: true });
    expect(result.harmless[0]).toMatchObject({ attributionCorrect: true });
  });

  it('allows a saved-name no-op without requiring the model to repeat it', () => {
    const result = exercise(`
      const entry = { documentText: 'Maya. maya@example.test.', activePreferences: [{ slug: 'profile.full_name', value: 'Maya' }],
        expectedProposals: [{ slug: 'profile.email', value: 'maya@example.test' }], forbiddenValues: [] };
      const own = { slug: 'profile.email', newValue: 'maya@example.test', sourceSnippet: 'maya@example.test' };
      const name = { slug: 'profile.full_name', newValue: 'Maya', sourceSnippet: 'Maya' };
      const score = (suggestions) => scoreStages(entry, [{ stage: 'extraction', status: 'completed', parsed: { suggestions } }])[0];
      console.log(JSON.stringify({ withoutNoop: score([own]), withNoop: score([own, name]), missingWanted: score([name]) }));
    `);
    expect(result.withoutNoop).toMatchObject({ passed: true, missingFacts: [], unexpectedFacts: [] });
    expect(result.withNoop).toMatchObject({ passed: true, missingFacts: [], unexpectedFacts: [] });
    expect(result.missingWanted).toMatchObject({ passed: false, expectedFactsPresent: false });
  });

  it('preserves completed and incomplete evidence while changed bindings prevent success', () => {
    const result = exercise(`
      const receipt = { lifecycle: { completed: true, cleanupComplete: true }, trials: [
        { caseId: 'done', status: 'completed', score: { passed: true }, stageScores: [{ attributionCorrect: true }], calls: [{ parsed: { suggestions: ['retained'] } }] },
        { caseId: 'interrupted', status: 'started', calls: [{ status: 'started' }] },
        { caseId: 'unstarted', status: 'not_run' },
      ] };
      finishReceipt(receipt, { sourceBuildAndHelpersUnchanged: false, modelUnchanged: true, runtimeUnchanged: true });
      console.log(JSON.stringify(receipt));
    `);
    expect(result.passed).toBe(false);
    expect(result.trials[0].calls[0].parsed.suggestions).toEqual(['retained']);
    expect(result.trials.map((trial) => trial.status)).toEqual(['completed', 'incomplete', 'not_run']);
    expect(result.integrity.sourceBuildAndHelpersUnchanged).toBe(false);
  });

  it('rejects an embedded foreign initial value even after correct consolidation and final output', () => {
    const result = exercise(`
      const entry = { documentText: 'Maya: maya@example.test. Jordan: jordan@example.test.', activePreferences: [],
        expectedProposals: [{ slug: 'profile.email', value: 'maya@example.test' }], forbiddenValues: ['jordan@example.test'] };
      const own = { slug: 'profile.email', newValue: 'maya@example.test', sourceSnippet: 'maya@example.test' };
      const combined = { ...own, newValue: 'maya@example.test, jordan@example.test' };
      const stageScores = scoreStages(entry, [
        { stage: 'extraction', status: 'completed', parsed: { suggestions: [combined] } },
        { stage: 'consolidation', status: 'completed', parsed: { suggestion: own } },
      ]);
      const score = scoreObservation(entry, { status: 'success', suggestions: [own] });
      const receipt = { lifecycle: { completed: true, cleanupComplete: true }, trials: [{ status: 'completed', score, stageScores }] };
      finishReceipt(receipt, { sourceBuildAndHelpersUnchanged: true, modelUnchanged: true, runtimeUnchanged: true });
      const structured = scoreObservation(entry, { status: 'success', suggestions: [{ ...own, newValue: { emails: ['maya@example.test', { alternate: 'jordan@example.test' }] } }] });
      console.log(JSON.stringify({ receipt, structured }));
    `);
    expect(result.receipt.trials[0].score.passed).toBe(true);
    expect(result.receipt.trials[0].stageScores[0].attributionCorrect).toBe(false);
    expect(result.receipt.trials[0].stageScores[1].attributionCorrect).toBe(true);
    expect(result.receipt.passed).toBe(false);
    expect(result.structured.attributionCorrect).toBe(false);
  });

  it('rejects replacement build-binding bytes even when they match a new current build', () => {
    const result = exercise(`
      const { readApprovedBuildBinding } = await import(harnessUrl);
      const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
      const { createHash } = await import('node:crypto');
      const root = await mkdtemp('/private/tmp/cr-attribution-binding-test-');
      try {
        const file = root + '/binding.json';
        const original = JSON.stringify({ buildSha256: 'approved-original-build' });
        const approvedSha256 = createHash('sha256').update(original).digest('hex');
        await writeFile(file, original, { mode: 0o600 });
        const accepted = await readApprovedBuildBinding(file, approvedSha256);
        const currentBuild = { buildSha256: 'replacement-current-build' };
        await writeFile(file, JSON.stringify(currentBuild));
        let rejected = false;
        try { await readApprovedBuildBinding(file, approvedSha256); } catch { rejected = true; }
        console.log(JSON.stringify({ accepted, rejected, currentBuild }));
      } finally { await rm(root, { recursive: true, force: true }); }
    `);
    expect(result.accepted).toEqual({ buildSha256: 'approved-original-build' });
    expect(result.currentBuild).toEqual({ buildSha256: 'replacement-current-build' });
    expect(result.rejected).toBe(true);
  });
});
