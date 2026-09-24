import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { readFile } from 'node:fs/promises';
import { createTlsFixture } from './tls-fixture.mjs';
import { spawnOwned } from './process.mjs';
import { probeJson, ProbeClient } from './client.mjs';

const fail = () => new Error('Native probe readiness failed');
export function runtimeArgs({ model, port, keyPath, certPath, apiKeyPath }) {
  if (!Number.isInteger(port) || port < 1 || port > 65535 ||
      [model, keyPath, certPath, apiKeyPath].some((path) => typeof path !== 'string' || !path.startsWith('/'))) throw fail();
  return ['--model', model, '--host', '127.0.0.1', '--port', String(port), '--alias', 'step06-qwen35',
    '--ctx-size', '16384', '--parallel', '1', '--gpu-layers', 'all', '--flash-attn', 'on', '--fit', 'off',
    '--batch-size', '512', '--ubatch-size', '512', '--load-mode', 'mmap',
    '--offline', '--api-key-file', apiKeyPath, '--ssl-key-file', keyPath, '--ssl-cert-file', certPath,
    '--chat-template-kwargs', '{"enable_thinking":false}', '--no-webui', '--slots', '--no-context-shift',
    '--cache-ram', '0', '--no-cache-idle-slots', '--no-cache-prompt', '--log-verbosity', '3', '--threads-http', '4'];
}

export function summarizeProps(props) {
  if (props?.total_slots !== 1 || props?.default_generation_settings?.n_ctx !== 16384 ||
      typeof props.chat_template !== 'string' || !props.chat_template.length) throw fail();
  return { context: 16384, slots: 1,
    templateSha256: createHash('sha256').update(props.chat_template).digest('hex') };
}

export async function auditDiagnostics(logPath, secret, overflow) {
  try {
    const log = await readFile(logPath);
    if (overflow || log.includes(Buffer.from(secret))) throw fail();
  } catch { throw new Error('Native probe diagnostic audit failed'); }
}

async function vacantPort() {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

/** CP1 only: exact owned disposable child, separate from the inference client. */
export async function withNative({ binary, model, logPath, sandboxProfile }, use) {
  const credentials = await createTlsFixture();
  let child; let client; let stopped = false;
  const start = performance.now();
  try {
    const port = await vacantPort();
    const configuration = { port, certificate: credentials.cert, apiKey: credentials.apiKey };
    const args = runtimeArgs({ model, port, ...credentials });
    child = await spawnOwned({ command: sandboxProfile ? '/usr/bin/sandbox-exec' : binary,
      args: sandboxProfile ? ['-p', sandboxProfile.replaceAll('PORT', String(port)), binary, ...args] : args,
      cwd: credentials.root, logPath });
    const until = start + 120000;
    let health = false;
    while (performance.now() < until && child.running && !child.logOverflow) {
      try { await probeJson(configuration, '/health', undefined, { timeoutMs: Math.min(1000, until - performance.now()) }); health = true; break; }
      catch { await delay(200); }
    }
    if (!health || performance.now() >= until || !child.running || child.logOverflow) throw fail();
    for (const key of [null, 'deliberately-wrong-key']) {
      await probeJson(configuration, '/props', undefined, { key, expectedStatus: 401 });
    }
    const props = (await probeJson(configuration, '/props')).value;
    const metadata = summarizeProps(props);
    const models = (await probeJson(configuration, '/models')).value;
    if (!Array.isArray(models?.data) || models.data.length !== 1 || models.data[0].id !== 'step06-qwen35') throw fail();
    const coldReadyMs = performance.now() - start;
    if (coldReadyMs > 120000) throw fail();
    client = new ProbeClient(configuration);
    return await use({ configuration, client, child, metadata: { ...metadata, coldReadyMs },
      args: args.map((value) => value.startsWith(credentials.root) ? '<private-credential-file>' : value) });
  } finally {
    try { await client?.close(); }
    finally {
      if (child) { await child.stop(); stopped = !child.running; }
      else stopped = true;
    }
    if (stopped) {
      // Do not publish diagnostics containing a secret. Logs remain private even on failure.
      try { await auditDiagnostics(logPath, credentials.apiKey, child?.logOverflow ?? false); }
      finally { await credentials.remove(); }
    }
  }
}
