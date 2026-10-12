// Test-only, import-safe attribution experiment. No inference occurs on import.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { chmod, lstat, mkdir, mkdtemp, open, readFile, readdir, readlink, realpath, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../../..');
const backend = join(repoRoot, 'apps/backend');
const fixturePath = join(backend, 'src/modules/preferences/document-analysis/__fixtures__/attribution-cases.json');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const digest = (value) => sha256(JSON.stringify(value));
const modelPin = Object.freeze({
  bytes: 5680522464,
  sha256: '03b74727a860a56338e042c4420bb3f04b2fec5734175f4cb9fa853daf52b7e8',
});
const archivePin = '1ad3f9eff80edb9dbef4259ad564d1720612ef7eea48fa4afed0e54f5f3d5711';

async function boundedObservation(task, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve(task).then(() => true, () => false),
      new Promise((settle) => { timer = setTimeout(() => settle(false), timeoutMs); }),
    ]);
  } finally { clearTimeout(timer); }
}

function abortable(task, signal) {
  return new Promise((settle, reject) => {
    const abort = () => reject(new Error('Attribution run stopped'));
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(task).then(settle, reject).finally(() => signal.removeEventListener('abort', abort));
    if (signal.aborted) abort();
  });
}

/** Exact-child stop never waits behind readiness, work, or adapter close. */
export async function runOwnedSession({ startRuntime, waitReady, run, closeAdapter, removeRoots,
  controller = new AbortController(), workMs = 44 * 60000, cleanupMs = 15000 }) {
  let child; let stopPromise;
  const owners = [];
  const own = (task) => { owners.push(Promise.resolve(task)); return task; };
  const result = { completed: false, stopReason: null, runtimeReaped: false, adapterClosed: false, ownersSettled: false, rootsRemoved: false, cleanupComplete: false };
  const stop = () => {
    if (!child) return Promise.resolve();
    return stopPromise ??= Promise.resolve().then(() => child.stop()).then(() => {
      if (child.running) throw new Error('Owned runtime did not exit');
    });
  };
  const abort = () => { void stop().catch(() => {}); };
  const interrupt = () => controller.abort('SIGINT');
  const terminate = () => controller.abort('SIGTERM');
  const timer = setTimeout(() => controller.abort('time-budget'), workMs);
  process.on('SIGINT', interrupt); process.on('SIGTERM', terminate);
  controller.signal.addEventListener('abort', abort);
  try {
    // startRuntime must retain no unreturned process; spawnOwned resolves at spawn.
    child = await startRuntime(controller.signal);
    if (controller.signal.aborted) throw new Error('Attribution run stopped');
    await abortable(own(waitReady(controller.signal)), controller.signal);
    await abortable(own(run(controller.signal)), controller.signal);
    result.completed = !controller.signal.aborted;
  } catch {
    result.stopReason = controller.signal.aborted ? String(controller.signal.reason) : 'operation-failed';
  } finally {
    const [runtimeReaped, adapterClosed, ownersSettled] = await Promise.all([
      boundedObservation(stop(), cleanupMs),
      boundedObservation(Promise.resolve().then(closeAdapter), cleanupMs),
      boundedObservation(Promise.allSettled(owners), cleanupMs),
    ]);
    result.runtimeReaped = runtimeReaped;
    result.adapterClosed = adapterClosed;
    result.ownersSettled = ownersSettled;
    if (runtimeReaped && adapterClosed && ownersSettled) result.rootsRemoved = await boundedObservation(Promise.resolve().then(removeRoots), cleanupMs);
    result.cleanupComplete = runtimeReaped && adapterClosed && ownersSettled && result.rootsRemoved;
    if (controller.signal.aborted) { result.completed = false; result.stopReason ??= String(controller.signal.reason); }
    clearTimeout(timer);
    controller.signal.removeEventListener('abort', abort);
    process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', terminate);
  }
  return result;
}

export function createCompletionBudget({ controller, cancellationError, maximum = 60 }) {
  let count = 0;
  return {
    get count() { return count; },
    wrap(complete) {
      return async function(...args) {
        if (controller.signal.aborted || count >= maximum) {
          if (!controller.signal.aborted) controller.abort('completion-budget');
          throw cancellationError();
        }
        count++;
        return complete.apply(this, args);
      };
    },
  };
}

export const plannedTrials = (cases) => cases.flatMap((entry) => [0, 1].map((repetition) => ({ caseId: entry.id, repetition, status: 'not_run' })));

/** Facts, evidence and execution are distinct; summaries are not preference facts. */
export function scoreObservation(entry, result) {
  const expected = entry.expectedProposals.map((item) => JSON.stringify([item.slug, item.value]));
  const actual = (result?.suggestions ?? []).map((item) => JSON.stringify([item.slug, item.newValue]));
  const unexpectedFacts = actual.filter((item) => !expected.includes(item));
  const missingFacts = expected.filter((item) => !actual.includes(item));
  const evidence = (result?.suggestions ?? []).map((item) => ({
    slug: item.slug,
    quoted: typeof item.sourceSnippet === 'string' && !!item.sourceSnippet && entry.documentText.includes(item.sourceSnippet),
    containsValue: typeof item.newValue === 'string' && typeof item.sourceSnippet === 'string' && item.sourceSnippet.includes(item.newValue),
  }));
  const runtimeCompleted = ['success', 'no_matches'].includes(result?.status);
  const subjectViolations = (result?.suggestions ?? []).filter((item) =>
    entry.identityBasis === 'unavailable-to-extraction' || entry.forbiddenValues.some((value) => (JSON.stringify(item.newValue) ?? 'null').includes(JSON.stringify(value))));
  const attributionCorrect = subjectViolations.length === 0;
  const expectedFactsPresent = missingFacts.length === 0;
  const evidenceCorrect = evidence.every((item) => item.quoted && item.containsValue);
  return { attributionCorrect, expectedFactsPresent, evidenceCorrect, runtimeCompleted,
    subjectViolations, unexpectedFacts, missingFacts, evidence,
    passed: runtimeCompleted && attributionCorrect && unexpectedFacts.length === 0 && expectedFactsPresent && evidenceCorrect };
}

export function scoreStages(entry, calls) {
  const allowed = [...entry.expectedProposals, ...entry.activePreferences.map((value) => ({ slug: value.slug, value: value.value }))];
  return calls.map((call) => {
    const suggestions = call.parsed?.suggestions ?? (call.parsed?.suggestion ? [call.parsed.suggestion] : []);
    const expectedProposals = call.stage === 'consolidation' ? allowed.filter((item) => suggestions.some((value) => value.slug === item.slug)) : allowed;
    return { stage: call.stage, ...scoreObservation({ ...entry, expectedProposals }, { suggestions, status: call.status === 'completed' ? 'success' : 'ai_error' }) };
  });
}

export function finishReceipt(receipt, integrity) {
  for (const trial of receipt.trials) if (trial.status === 'started') trial.status = 'incomplete';
  receipt.integrity = integrity;
  receipt.passed = Object.values(integrity).every((value) => value === true) && receipt.lifecycle.completed && receipt.lifecycle.cleanupComplete &&
    receipt.trials.every((trial) => trial.status === 'completed' && trial.score.passed && trial.stageScores.every((stage) => stage.attributionCorrect));
}

function checkTime(signal, deadline = Infinity) {
  if (signal?.aborted || performance.now() >= deadline) throw new Error('Attribution verification stopped');
}

async function treeHashes(directory, prefix = '', options = {}) {
  const { signal, deadline, allowInternalSymlinks = false, root = directory } = options;
  checkTime(signal, deadline);
  const entries = [];
  for (const item of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const file = join(directory, item.name); const name = `${prefix}${item.name}`;
    checkTime(signal, deadline);
    if (item.isDirectory()) entries.push(...await treeHashes(file, `${name}/`, { ...options, root }));
    else if (item.isFile()) entries.push([name, sha256(await readFile(file, { signal }))]);
    else if (allowInternalSymlinks && item.isSymbolicLink()) {
      assert.ok((await realpath(file)).startsWith(`${root}/`));
      entries.push([name, `symlink:${await readlink(file)}`]);
    }
    else throw new Error('Unexpected build entry');
  }
  return entries;
}

export async function buildBinding(options = {}) {
  checkTime(options.signal, options.deadline);
  const args = ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--',
    'apps/backend/src', 'apps/backend/scripts', 'apps/backend/test/document-attribution', 'apps/backend/package.json', 'apps/backend/tsconfig.json',
    'apps/backend/nest-cli.json', 'apps/backend/prisma/schema.prisma', 'apps/backend/prisma.config.ts',
    'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'scripts/local-migration/fixtures/local-model-feasibility'];
  const timeout = Math.max(1, Math.min(5000, Math.floor((options.deadline ?? Infinity) - performance.now())));
  const paths = execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', timeout }).split('\0').filter(Boolean).sort();
  const source = await Promise.all(paths.map(async (file) => [file, sha256(await readFile(join(repoRoot, file), { signal: options.signal }))]));
  const built = await treeHashes(join(backend, 'dist'), '', options);
  assert.ok(!built.some(([name]) => name.includes('attribution-')), 'Test-only attribution artifacts entered the production build');
  return { schemaVersion: 1, node: process.version, sourceSha256: digest(source), buildSha256: digest(built), source, built };
}

async function hashAsset(file, signal) {
  const hash = createHash('sha256');
  const before = await lstat(file, { bigint: true });
  assert.ok(before.isFile());
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await handle.stat({ bigint: true });
    for (const key of ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs']) assert.equal(before[key], opened[key]);
    for await (const chunk of handle.createReadStream({ autoClose: false, signal })) hash.update(chunk);
    const after = await handle.stat({ bigint: true });
    const named = await lstat(file, { bigint: true });
    for (const key of ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs']) {
      assert.equal(opened[key], after[key]); assert.equal(opened[key], named[key]);
    }
    return hash.digest('hex');
  } finally { await handle.close(); }
}

async function runLive(configPath, approvedConfigSha256) {
  const configBytes = await readFile(configPath);
  assert.equal(sha256(configBytes), approvedConfigSha256, 'Use the exact reviewed and approved private run configuration');
  const config = JSON.parse(configBytes);
  assert.equal(config.modelSha256, modelPin.sha256);
  assert.equal(config.modelBytes, modelPin.bytes);
  assert.equal(config.maximumAnalyses, 10); assert.equal(config.maximumCompletions, 60); assert.equal(config.maximumMinutes, 45);
  assert.match(config.runtimeSha256, /^[a-f0-9]{64}$/u);
  assert.equal(config.runtimeArchiveSha256, archivePin);
  assert.equal(process.version, 'v24.21.0');
  const currentHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8', timeout: 5000 }).trim();
  assert.equal(currentHead, config.sourceCommit);
  assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: repoRoot, encoding: 'utf8', timeout: 5000 }).trim(), '', 'Freeze and commit source inputs before inference');
  const outputRoot = await realpath(config.outputRoot);
  assert.equal(outputRoot, config.outputRoot);
  const outputStat = await lstat(outputRoot);
  assert.ok(outputStat.isDirectory() && outputStat.uid === process.getuid() && (outputStat.mode & 0o777) === 0o700);
  assert.deepEqual(await readdir(outputRoot), [], 'Use a fresh empty private output directory');
  const fixtureBytes = await readFile(fixturePath);
  const fixtures = JSON.parse(fixtureBytes);
  assert.equal(fixtures.cases.length, 5);
  assert.equal(fixtures.filename, 'synthetic-note.txt');
  const receipt = { schemaVersion: 1, sourceCommit: currentHead, configSha256: sha256(configBytes), fixtureSha256: sha256(fixtureBytes),
    limitations: ['Synthetic reproduction cannot identify the original private incident.', 'Synthetic storage/review preparation; no browser or persistence qualification.', 'Three-slug catalog subset; no full-catalog quality qualification.'],
    startedAt: new Date().toISOString(), trials: plannedTrials(fixtures.cases), nativeCompletions: [], passed: false };
  const controller = new AbortController();
  let credentials; let root; let model; let budget; let child; let currentCall; let finalizing = false;
  const started = performance.now();
  const overallDeadline = started + 45 * 60000;
  const overallTimer = setTimeout(() => controller.abort('overall-time-budget'), 45 * 60000);
  const partial = () => finalizing ? Promise.resolve() : writeFile(join(outputRoot, 'receipt.partial.json'), `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
  const shared = join(repoRoot, 'scripts/local-migration/fixtures/local-model-feasibility');
  const { createTlsFixture } = await import(pathToFileURL(join(shared, 'tls-fixture.mjs')));
  const { runtimeArgs, vacantPort, summarizeProps, auditDiagnostics } = await import(pathToFileURL(join(shared, 'native.mjs')));
  const { spawnOwned } = await import(pathToFileURL(join(shared, 'process.mjs')));
  const { probeJson } = await import(pathToFileURL(join(shared, 'client.mjs')));
  const nativeLog = join(outputRoot, 'native.log');
  let configuration;
  receipt.lifecycle = await runOwnedSession({ controller,
    async startRuntime(signal) {
      receipt.build = await buildBinding({ signal, deadline: overallDeadline });
      assert.deepEqual(receipt.build, JSON.parse(await readFile(config.buildBindingPath, 'utf8')));
      assert.equal(await realpath(config.modelPath), config.modelPath);
      const modelBefore = await lstat(config.modelPath, { bigint: true });
      assert.ok(modelBefore.isFile() && modelBefore.size === BigInt(modelPin.bytes) && modelBefore.nlink === 1n);
      assert.equal(await hashAsset(config.modelPath, signal), modelPin.sha256);
      const modelAfter = await lstat(config.modelPath, { bigint: true });
      for (const key of ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs']) assert.equal(modelBefore[key], modelAfter[key]);
      receipt.model = { path: config.modelPath, bytes: modelPin.bytes, sha256: modelPin.sha256,
        fileIdentity: Object.fromEntries(['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'].map((key) => [key, String(modelAfter[key])])) };
      assert.equal(await realpath(config.runtimeBinary), config.runtimeBinary);
      assert.equal(await hashAsset(config.runtimeBinary, signal), config.runtimeSha256);
      assert.equal(await hashAsset(config.runtimeArchive, signal), archivePin);
      assert.equal(await realpath(config.runtimeRoot), config.runtimeRoot);
      assert.ok(config.runtimeBinary.startsWith(`${config.runtimeRoot}/`));
      const closure = await treeHashes(config.runtimeRoot, '', { signal, deadline: overallDeadline, allowInternalSymlinks: true });
      assert.equal(digest(closure), config.runtimeClosureSha256);
      receipt.runtime = { path: config.runtimeBinary, sha256: config.runtimeSha256, archiveSha256: archivePin, closureSha256: digest(closure), closure };
      if (signal.aborted) throw new Error('Attribution run stopped');
      root = await realpath(await mkdtemp('/private/tmp/cr-attribution-state-'));
      await chmod(root, 0o700);
      await mkdir(join(root, 'data'), { mode: 0o700 }); await mkdir(join(root, 'identity'), { mode: 0o700 });
      credentials = await createTlsFixture();
      const port = await vacantPort();
      configuration = { port, certificate: credentials.cert, apiKey: credentials.apiKey };
      const args = runtimeArgs({ model: config.modelPath, port, ...credentials });
      receipt.runtime.args = args.map((argument) => argument.startsWith(credentials.root) ? '<private-credential-file>' : argument);
      receipt.runtime.generation = { temperature: 0, seed: 42, maximumOutputTokens: 2048 };
      receipt.retainedRoots = { state: root, credentials: credentials.root };
      await partial();
      if (signal.aborted) throw new Error('Attribution run stopped');
      const profile = '(version 1)(allow default)(deny network*)(allow network-bind network-inbound (local tcp "localhost:PORT"))(allow network-outbound (remote tcp "localhost:PORT"))(deny mach-lookup (global-name "com.apple.dnssd.service"))'.replaceAll('PORT', String(port));
      child = await spawnOwned({ command: '/usr/bin/sandbox-exec', args: ['-p', profile, config.runtimeBinary, ...args], cwd: root, logPath: nativeLog });
      return child;
    },
    async waitReady(signal) {
      const deadline = performance.now() + 120000;
      let ready = false;
      while (!signal.aborted && performance.now() < deadline && child.running && !child.logOverflow) {
        try { await probeJson(configuration, '/health', undefined, { signal, timeoutMs: 1000 }); ready = true; break; }
        catch { await delay(200, undefined, { signal }); }
      }
      assert.ok(ready);
      for (const key of [null, 'deliberately-wrong-key']) await probeJson(configuration, '/props', undefined, { key, expectedStatus: 401, signal });
      receipt.runtime.properties = summarizeProps((await probeJson(configuration, '/props', undefined, { signal })).value);
      const models = (await probeJson(configuration, '/models', undefined, { signal })).value;
      assert.equal(models.data.length, 1); assert.equal(models.data[0].id, 'step06-qwen35');
    },
    async run(signal) {
      const require = createRequire(join(backend, 'package.json'));
      require('reflect-metadata');
      require('tsconfig-paths').register({ baseUrl: join(backend, 'dist'), paths: {
        '@/*': ['*'], '@config/*': ['config/*'], '@common/*': ['common/*'], '@infrastructure/*': ['infrastructure/*'], '@modules/*': ['modules/*'],
      } });
      require('@nestjs/common').Logger.overrideLogger(false);
      const load = (file) => require(join(backend, 'dist', `${file}.js`));
      const { LocalModelService } = load('infrastructure/local-model/local-model.service');
      const { AiError } = load('domains/shared/ports/ai-execution');
      const { localJsonSchema } = load('infrastructure/local-model/schema');
      const { PREFERENCE_CATALOG } = load('config/preferences.catalog');
      const { ConfigService } = require('@nestjs/config');
      const { PreferenceExtractionService } = load('modules/preferences/document-analysis/preference-extraction.service');
      const { DocumentAnalysisService } = load('modules/preferences/document-analysis/document-analysis.service');
      const { ReviewedSuggestionService } = load('modules/preferences/document-analysis/reviewed-suggestion.service');
      const { PreferenceSchemaSnapshotService } = load('modules/preferences/preference-definition/preference-schema-snapshot.service');
      model = new LocalModelService({ root: await realpath(credentials.root), port: configuration.port, identityRoot: join(root, 'identity'), databaseRoot: join(root, 'data') });
      assert.equal((await model.getStatus({ signal })).state, 'available'); await model.settled();
      budget = createCompletionBudget({ controller, maximum: 60, cancellationError: () => new AiError('cancelled') });
      const nativeComplete = model.client.complete;
      model.client.complete = budget.wrap(async function(prompt, options) {
        const observation = { index: receipt.nativeCompletions.length, callIndex: currentCall?.index,
          renderedSha256: sha256(prompt), schemaSha256: digest(options.schema), status: 'started' };
        receipt.nativeCompletions.push(observation);
        const start = performance.now();
        try {
          const value = await nativeComplete.call(this, prompt, options);
          Object.assign(observation, { status: 'completed', raw: value.text, inputTokens: value.inputTokens, outputTokens: value.outputTokens });
          return value;
        } catch (error) { observation.status = 'failed'; throw error; }
        finally { observation.elapsedMs = performance.now() - start; }
      });
      for (const trial of receipt.trials) {
        if (signal.aborted) break;
        const entry = fixtures.cases.find((item) => item.id === trial.caseId);
        Object.assign(trial, { status: 'started', calls: [], documentText: entry.documentText, activePreferences: entry.activePreferences });
        const definitions = fixtures.schemaSlugs.map((slug) => ({ id: `definition:${slug}`, slug, namespace: 'GLOBAL', ownerUserId: null,
          ...PREFERENCE_CATALOG[slug], valueType: 'STRING', scope: 'GLOBAL', options: null, archivedAt: null }));
        const definitionRepo = { getAll: async () => definitions, getDefinitionBySlug: async (slug) => definitions.find((item) => item.slug === slug) ?? null };
        const noWrite = async () => { throw new Error('Synthetic attribution run cannot write preferences'); };
        const savedRows = entry.activePreferences.map((preference) => ({ ...preference, id: `saved:${preference.slug}`, userId: 'synthetic-attribution-owner',
          definitionId: `definition:${preference.slug}`, locationId: null, contextKey: 'GLOBAL', status: 'ACTIVE', sourceType: 'USER',
          confidence: null, evidence: null, lastActorType: null, lastActorClientKey: null, lastOrigin: null, createdAt: new Date(0), updatedAt: new Date(0) }));
        const unit = { serializable: async (operation) => operation({ definitions: definitionRepo,
          preferences: { findActiveExact: async (key) => savedRows.find((row) => row.userId === key.userId && row.definitionId === key.definitionId && key.locationId === null) ?? null,
            compareAndSetActive: noWrite, upsertActive: noWrite }, audit: { record: noWrite } }) };
        const invoke = async (prompt, schema, file, options) => {
          assert.ok(!prompt.includes(entry.id));
          const call = { index: receipt.trials.flatMap((item) => item.calls ?? []).length, stage: file ? 'extraction' : 'consolidation',
            prompt, promptSha256: sha256(prompt), schemaSha256: digest(localJsonSchema(schema)), status: 'started',
            ...(file ? { fileSha256: sha256(file.buffer), mimeType: file.mimeType } : {}) };
          trial.calls.push(call); currentCall = call;
          try {
            const value = await (file ? model.generateStructuredWithFile(prompt, file, schema, options) : model.generateStructured(prompt, schema, options));
            call.status = 'completed'; call.parsed = value; return value;
          } catch (error) { call.status = 'failed'; call.failureKind = error instanceof AiError ? error.kind : 'unexpected'; throw error; }
          finally { currentCall = undefined; }
        };
        const ai = { capabilities: model.capabilities, generateStructuredWithFile: (p, f, s, o) => invoke(p, s, f, o), generateStructured: (p, s, o) => invoke(p, s, undefined, o) };
        const configService = new ConfigService({ documentUpload: { maxSuggestions: 25 } });
        const extraction = new PreferenceExtractionService(ai, { getActivePreferences: async () => entry.activePreferences }, definitionRepo,
          new PreferenceSchemaSnapshotService(definitionRepo, null), configService);
        const analysis = new DocumentAnalysisService(extraction, new ReviewedSuggestionService(unit, configService));
        const start = performance.now();
        trial.result = await analysis.analyzeDocument('synthetic-attribution-owner', Buffer.from(entry.documentText), 'text/plain', fixtures.filename,
          { signal, deadline: Math.min(start + 180000, started + 44 * 60000) });
        await model.settled();
        trial.elapsedMs = performance.now() - start;
        trial.status = ['success', 'no_matches'].includes(trial.result.status) ? 'completed' : 'failed';
        trial.score = scoreObservation(entry, trial.result);
        trial.stageScores = scoreStages(entry, trial.calls);
        await partial();
        if (model.client.state !== 'ready') { controller.abort('model-session-unavailable'); break; }
      }
    },
    closeAdapter: async () => { if (model) await model.onModuleDestroy(); },
    async removeRoots() {
      if (credentials && child) await auditDiagnostics(nativeLog, credentials.apiKey, child.logOverflow);
      if (credentials) await credentials.remove();
      if (root) await rm(root, { recursive: true, force: true });
      delete receipt.retainedRoots;
    },
  });
  finalizing = true;
  const integrity = { sourceBuildAndHelpersUnchanged: false, modelUnchanged: false, runtimeUnchanged: false };
  try {
    assert.deepEqual(await abortable(buildBinding({ signal: controller.signal, deadline: overallDeadline }), controller.signal), receipt.build);
    integrity.sourceBuildAndHelpersUnchanged = true;
    checkTime(controller.signal, overallDeadline);
    const metadata = await lstat(config.modelPath, { bigint: true });
    assert.deepEqual(Object.fromEntries(['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'].map((key) => [key, String(metadata[key])])), receipt.model.fileIdentity);
    assert.ok(metadata.isFile()); assert.equal(await realpath(config.modelPath), config.modelPath);
    integrity.modelUnchanged = true;
    assert.equal(digest(await abortable(treeHashes(config.runtimeRoot, '', { signal: controller.signal, deadline: overallDeadline, allowInternalSymlinks: true }), controller.signal)), receipt.runtime.closureSha256);
    checkTime(controller.signal, overallDeadline);
    integrity.runtimeUnchanged = true;
  } catch { /* Preserve every observation, but changed/unverified inputs cannot pass. */ }
  receipt.elapsedMs = performance.now() - started;
  receipt.completionCount = budget?.count ?? 0;
  finishReceipt(receipt, integrity);
  try { await writeFile(join(outputRoot, 'receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx', mode: 0o600 }); }
  finally { clearTimeout(overallTimer); }
  console.log(JSON.stringify({ receipt: join(outputRoot, 'receipt.json'), passed: receipt.passed, completionCount: receipt.completionCount, lifecycle: receipt.lifecycle }));
  process.exitCode = receipt.passed ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv[2] === '--bind-build' && process.argv.length === 4) {
    await writeFile(process.argv[3], `${JSON.stringify(await buildBinding(), null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  } else if (process.argv[2] === '--run' && process.argv.length === 5) {
    await runLive(process.argv[3], process.argv[4]);
  } else throw new Error('Use --bind-build PATH after the approved isolated build, or --run CONFIG APPROVED_CONFIG_SHA256 only after explicit live-run approval.');
}
