import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { cases, repoRoot } from './cases.mjs';
import { runConsumer, grammarSchema, semanticUnits, criticalViolations } from './consumers.mjs';
import { freezeManifest, digest } from './freeze.mjs';
import { renderForCompletion } from './protocol.mjs';
import { scoreQuality } from './quality.mjs';

export async function runQuality(configuration, client, { render = renderForCompletion, onProgress = () => {} } = {}) {
  const manifest = JSON.parse(await readFile(resolve(repoRoot, 'docs/plans/active/local-migration/06-local-model/evidence/quality-manifest.json'), 'utf8'));
  if (digest(manifest) !== digest(await freezeManifest())) throw new Error('Frozen quality manifest changed');
  const trials = []; const measurements = [];
  for (const entry of cases) for (let repetition = 0; repetition < 3; repetition++) {
    const start = performance.now(); const deadline = start + 180000;
    const trial = { caseId: entry.id, repetition, structureValid: false, failed: false,
      criticalViolations: 0, proposalUnits: [], validatedUnits: [] };
    const calls = []; let firstProposal; let initialProposalValid = false; let fatalCall = false;
    const invoke = async (prompt, schema, file) => {
      let grammar;
      try { grammar = grammarSchema(schema); }
      catch { fatalCall = true; calls.push({ attempt: 0, preparationFailed: true, structureValid: false }); throw new Error('Quality grammar failure'); }
      for (let attempt = 0; attempt < 2; attempt++) {
        const callStart = performance.now();
        const callDeadline = Math.min(deadline, callStart + 120000);
        const task = attempt === 0 ? prompt : `${prompt}\n\nThe previous response failed JSON/schema validation. Return one complete JSON value satisfying the requested schema. Do not include commentary.`;
        const observation = { attempt, promptSha256: digest(task), schemaSha256: digest(grammar), structureValid: false };
        calls.push(observation);
        let rendered; let response;
        try { rendered = await render(configuration, task, file, callDeadline); }
        catch { fatalCall = true; observation.preparationFailed = true; observation.elapsedMs = performance.now() - callStart; throw new Error('Quality preparation failed'); }
        try { response = await client.complete(rendered.prompt, { deadline: callDeadline, schema: grammar }); }
        catch { fatalCall = true; observation.transportFailed = true; observation.elapsedMs = performance.now() - callStart; throw new Error('Quality inference failed'); }
        Object.assign(observation, { elapsedMs: performance.now() - callStart, inputTokens: response.inputTokens, outputTokens: response.outputTokens });
        try {
          const raw = JSON.parse(response.text);
          if (calls.length === 1) firstProposal = raw;
          const parsed = schema.parse(raw);
          observation.structureValid = true;
          if (calls.length === 1) initialProposalValid = true;
          return parsed;
        } catch { if (attempt === 1 || performance.now() >= deadline) { fatalCall = true; throw new Error('Quality structure failure'); } }
      }
    };
    try {
      const result = await runConsumer(entry, { generateStructured: (prompt, schema) => invoke(prompt, schema),
        generateStructuredWithFile: (prompt, file, schema) => invoke(prompt, schema, file) });
      if (performance.now() >= deadline) throw new Error('Quality workflow deadline');
      trial.structureValid = !fatalCall;
      trial.failed = fatalCall;
      trial.validatedUnits = semanticUnits(entry, result, 'validated');
      trial.criticalViolations = criticalViolations(entry, trial.validatedUnits);
    } catch { trial.failed = true; }
    try { if (firstProposal !== undefined) trial.proposalUnits = semanticUnits(entry, firstProposal, 'proposal'); }
    catch { /* malformed proposal is retained as structure failure/correction in call records */ }
    await client.settled();
    trials.push(trial);
    measurements.push({ caseId: entry.id, repetition, workflowMs: performance.now() - start, calls, initialProposalValid, clientState: client.state });
    // Keep progress free of prompts, answers, credentials and semantic units.
    onProgress({ caseId: entry.id, repetition, completed: true, failed: trial.failed, criticalViolations: trial.criticalViolations });
  }
  return { score: scoreQuality(manifest, trials), measurements };
}
