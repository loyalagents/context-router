import https from 'node:https';
import { once } from 'node:events';
import { readFile, mkdtemp, mkdir, rm, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { createTlsFixture } from '../../../../../scripts/local-migration/fixtures/local-model-feasibility/tls-fixture.mjs';
const require = createRequire(import.meta.url);
require('reflect-metadata');
const { z } = require('zod');
const { LocalModelService } = require('../../../dist/infrastructure/local-model/local-model.service.js');
const template = await readFile(new URL('./qwen35-template.txt', import.meta.url), 'utf8');
const send = (response, value) => response.write(`data: ${JSON.stringify(value)}\n\n`);
export async function fixture(t) {
  const credentials = await createTlsFixture();
  const roots = await realpath(await mkdtemp(join(tmpdir(), 'local-model-app-test-')));
  await mkdir(join(roots, 'identity')); await mkdir(join(roots, 'database'));
  const state = { calls: [], completionBodies: [], reply: '{"answer":"ok"}', hook: null, tokens: 10, authBypass: null, auth: [] };
  const server = https.createServer({ key: credentials.key, cert: credentials.cert }, async (request, response) => {
    state.calls.push(request.url);
    state.auth.push(request.headers.authorization);
    if (state.authBypass && await state.authBypass(request, response)) return;
    if (request.headers.authorization !== `Bearer ${credentials.apiKey}`) { response.writeHead(401).end('{}'); return; }
    let body = ''; for await (const chunk of request) body += chunk;
    if (state.hook && await state.hook(request, response, body)) return;
    response.setHeader('content-type', 'application/json');
    const result = request.url === '/props' ? { total_slots: 1, default_generation_settings: { n_ctx: 16384 }, chat_template: template }
      : request.url === '/models' ? { data: [{ id: 'step06-qwen35' }] }
      : request.url === '/apply-template' ? { prompt: '<think></think>' + JSON.parse(body).messages[0].content }
      : request.url === '/tokenize' ? { tokens: Array(state.tokens).fill(1) }
      : request.url === '/slots' ? [{ id: 0, is_processing: false }] : null;
    if (result) { response.end(JSON.stringify(result)); return; }
    if (request.url !== '/completion') { response.writeHead(404).end('{}'); return; }
    state.completionBodies.push(JSON.parse(body));
    response.setHeader('content-type', 'text/event-stream');
    send(response, { index: 0, stop: false, content: '', tokens_predicted: 0, tokens_evaluated: state.tokens,
      prompt_progress: { total: state.tokens, cache: 0, processed: 0, time_ms: 0 } });
    send(response, { index: 0, stop: true, content: state.reply, tokens_predicted: 2, tokens_evaluated: state.tokens, stop_type: 'eos', truncated: false }); response.end();
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const config = { root: await realpath(credentials.root), identityRoot: join(roots, 'identity'), databaseRoot: join(roots, 'database'), port: server.address().port };
  const service = new LocalModelService(config);
  t.after(async () => { await service.onModuleDestroy(); server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); await credentials.remove(); await rm(roots, { recursive: true, force: true }); });
  return { service, state, config, credentials };
}
