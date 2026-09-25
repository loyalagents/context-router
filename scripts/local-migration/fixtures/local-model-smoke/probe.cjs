'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { createRequire } = require('node:module');
async function copyParserWithoutWorker(source, target) {
  await fs.mkdir(target, { mode: 0o700 });
  await fs.mkdir(path.join(target, 'pdfjs'), { mode: 0o700 });
  for (const file of ['pdf-worker.mjs', 'pdf.mjs', 'pdfjs/package.json', 'pdfjs/LICENSE', 'pdfjs/pdf.mjs']) {
    await fs.writeFile(path.join(target, file), await fs.readFile(path.join(source, file)), { mode: 0o600, flag: 'wx' });
  }
}
module.exports.copyParserWithoutWorker = copyParserWithoutWorker;
module.exports.runLocalIdentityEntrypoint = async () => {
  let app; let stage = 'load';
  try {
    const dist = process.env.LOCAL_DATABASE_RUNTIME_DIST;
    const request = createRequire(path.join(dist, 'main.js'));
    request('reflect-metadata'); request('@nestjs/common').Logger.overrideLogger(false);
    const load = (name) => request(path.join(dist, name));
    const { createNestLocalIdentityApplication, configureLocalIdentityPreview } = load('bootstrap/local-identity-preview.js');
    const { AI_TEXT_GENERATOR_PORT, AI_STRUCTURED_OUTPUT_PORT } = load('domains/shared/ports/ai.tokens.js');
    const { z } = request('zod');
    stage = 'controls';
    const controls = await globalThis.__localModelSmoke.controls();
    const configuration = { kind: 'sqlite', databaseRoot: process.env.LOCAL_DATABASE_ROOT, stateRoot: process.env.LOCAL_IDENTITY_STATE_ROOT };
    const bytes = await fs.readFile(path.join(configuration.stateRoot, 'identity.json'));
    stage = 'application';
    await load('infrastructure/storage/sqlite/sqlite-local-runtime.js').createSqliteIdentityRuntime(configuration).service.verifyReadyState();
    app = await createNestLocalIdentityApplication(configuration, { root: process.env.LOCAL_MODEL_SESSION_ROOT, port: Number(process.env.LOCAL_MODEL_PORT) });
    configureLocalIdentityPreview(app); await app.init();
    const model = app.get(AI_TEXT_GENERATOR_PORT);
    if (model !== app.get(AI_STRUCTURED_OUTPUT_PORT) || model.initialization !== undefined) throw new Error();
    stage = 'readiness';
    if ((await model.getStatus()).state !== 'available') throw new Error();
    const expected = { answer: 'synthetic' };
    stage = 'text';
    if (await model.generateText('Synthetic text') !== JSON.stringify(expected)) throw new Error();
    stage = 'structured';
    if (JSON.stringify(await model.generateStructured('Synthetic structured', z.object({ answer: z.literal('synthetic') }))) !== JSON.stringify(expected)) throw new Error();
    stage = 'pdf';
    const pdf = await fs.readFile(process.env.LOCAL_MODEL_SMOKE_PDF);
    if (await model.generateTextWithFile('Synthetic document', { buffer: pdf, mimeType: 'application/pdf' }) !== JSON.stringify(expected)) throw new Error();
    try { await model.generateTextWithFile('Synthetic unsupported', { buffer: pdf, mimeType: 'image/png' }); throw new Error(); }
    catch (error) { if (error.kind !== 'unsupported') throw error; }
    stage = 'missing-worker';
    const engine = path.join(dist, 'infrastructure/local-model/engine');
    const missing = path.join(process.env.LOCAL_MODEL_SMOKE_ROOT, 'missing-engine');
    await copyParserWithoutWorker(engine, missing);
    try {
      const { PdfProcess } = load('infrastructure/local-model/engine/pdf-process.mjs');
      try { await new PdfProcess({ workerPath: path.join(missing, 'pdf-worker.mjs') }).parse(pdf); throw new Error('Unexpected parse'); }
      catch (error) { if (error.message !== 'PDF_INVALID') throw error; }
    } finally { await fs.rm(missing, { recursive: true, force: true }); }
    stage = 'close';
    await app.close(); app = undefined;
    if (!bytes.equals(await fs.readFile(path.join(configuration.stateRoot, 'identity.json')))) throw new Error();
    const c = globalThis.__localModelSmoke.counters;
    if (c.sqliteThreads.length < 1 || c.sqliteThreads.some((t) => !t.exited || t.code !== 0 || t.controls !== 46) || c.allowedConnections < 1 || c.parserChildren.length !== 2 || c.parserChildren.some((p) => !p.closed || p.code !== 0 || p.signal !== null || !Number.isSafeInteger(p.pid))) throw new Error();
    process.stdout.write(JSON.stringify({ type: 'context-router.local-model.probe', version: 1, controls,
      connections: c.allowedConnections, parserChildren: c.parserChildren, sqliteThreads: c.sqliteThreads, calls: 3,
      identityDigest: createHash('sha256').update(bytes).digest('hex'), missingWorkerRejected: true, node: process.versions.node }) + '\n');
    return 0;
  } catch {
    await app?.close(); process.stderr.write(`Local model probe failed during ${stage}\n`); return 1;
  }
};
