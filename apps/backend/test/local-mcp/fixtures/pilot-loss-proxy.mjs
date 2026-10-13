// Opt-in qualification fixture only. Never imported by production or the packager.
// It changes the transport topology; its observations are not natural-fault evidence.
import assert from 'node:assert/strict';
import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';

const MAX_REQUEST = 128 * 1024;
const MAX_RESPONSE = 8 * 1024 * 1024;
const METHODS = new Set(['initialize', 'ping', 'tools/list', 'resources/list',
  'resources/read', 'notifications/initialized', 'notifications/cancelled']);
const READ_TOOLS = new Set(['searchPreferences', 'listPreferenceSlugs']);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const validPort = port => Number.isInteger(port) && port > 0 && port <= 65535;

export async function createPilotLossProxy({ credential, upstreamPort, listenPort = 0,
  slug, value, deadlineMs = 10000 }) {
  if (['NODE_DEBUG', 'NODE_DEBUG_NATIVE', 'NODE_OPTIONS'].some(name => process.env[name]) ||
    typeof credential !== 'string' || !/^cr_mcp_[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/.test(credential))
    throw new Error('Qualification fixture setup refused.');
  assert.ok(validPort(upstreamPort));
  assert.ok(listenPort === 0 || validPort(listenPort));
  assert.match(slug, /^pilot_[a-z0-9_]+\.allowed$/);
  assert.ok(typeof value === 'string' && value.startsWith('synthetic-') && value.length < 256);
  assert.ok(Number.isInteger(deadlineMs) && deadlineMs > 0 && deadlineMs <= 10000);
  const auth = Buffer.from(`Bearer ${credential}`);
  const ledger = { requests: 0, refused: 0, forwarded: 0, mutationAttempts: 0,
    mutationForwards: 0, replyLosses: 0, failedInjection: false, initializes: 0, initialized: 0 };
  let armed = false, consumed = false, closing, active = 0;
  const outbound = new Set();
  function authorized(header) {
    if (typeof header !== 'string') return false;
    const bytes = Buffer.from(header);
    return bytes.length === auth.length && timingSafeEqual(bytes, auth);
  }
  function refuse(res, status = 403) {
    ledger.refused++;
    res.writeHead(status, { 'content-type': 'text/plain', connection: 'close' });
    res.end('Qualification fixture refused request.');
  }
  function exactMutation(body) {
    const args = body.params.arguments;
    return object(args) && Object.keys(args).sort().join(',') === 'operation,preference' &&
      args.operation === 'SET_PREFERENCE' && object(args.preference) &&
      Object.keys(args.preference).sort().join(',') === 'slug,value' &&
      args.preference.slug === slug && args.preference.value === JSON.stringify(value);
  }
  const server = http.createServer({ maxHeaderSize: 16384, requestTimeout: deadlineMs,
    headersTimeout: deadlineMs }, (req, res) => {
    ledger.requests++;
    if (closing || active >= 8 || !authorized(req.headers.authorization) ||
      req.headers.origin !== undefined || req.headers.host !== `127.0.0.1:${server.address().port}` ||
      req.url !== '/mcp' || !['POST', 'DELETE'].includes(req.method)) {
      refuse(res); return;
    }
    active++;
    let upstream, done = false, injection = false;
    const finish = () => {
      if (done) return;
      if (injection && !ledger.replyLosses) ledger.failedInjection = true;
      done = true; active--; clearTimeout(timer);
      if (upstream) { outbound.delete(upstream); upstream.destroy(); }
    };
    const lost = () => {
      if (injection && !ledger.replyLosses) ledger.failedInjection = true;
      res.destroy(); finish();
    };
    const timer = setTimeout(lost, deadlineMs);
    res.on('close', finish);
    req.on('error', lost);
    req.on('aborted', lost);
    let chunks = [], length = 0;
    req.on('data', chunk => {
      length += chunk.length;
      if (length > MAX_REQUEST) { refuse(res, 413); finish(); req.destroy(); }
      else if (!done) chunks.push(chunk);
    });
    req.on('end', () => {
      if (done) return;
      const bytes = Buffer.concat(chunks); chunks = [];
      let body;
      try {
        if (req.method === 'POST') {
          body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
          assert.ok(object(body) && body.jsonrpc === '2.0');
          if (body.method === 'tools/call' && body.params?.name === 'mutatePreferences') {
            ledger.mutationAttempts++;
            assert.ok(armed && !consumed);
            consumed = true; // A refused first attempt cannot be corrected/retried.
            assert.ok(exactMutation(body));
            assert.ok(typeof body.id === 'string' || Number.isSafeInteger(body.id));
            injection = true; ledger.mutationForwards++;
          } else assert.ok(METHODS.has(body.method) ||
            (body.method === 'tools/call' && READ_TOOLS.has(body.params?.name)));
        } else assert.equal(bytes.length, 0);
      } catch { refuse(res); finish(); return; }
      ledger.forwarded++;
      if (body?.method === 'initialize') ledger.initializes++;
      if (body?.method === 'notifications/initialized') ledger.initialized++;
      const headers = { authorization: `Bearer ${credential}`, 'content-length': bytes.length };
      for (const key of ['content-type', 'accept', 'mcp-session-id', 'mcp-protocol-version']) {
        if (typeof req.headers[key] === 'string') headers[key] = req.headers[key];
      }
      upstream = http.request({ hostname: '127.0.0.1', port: upstreamPort,
        method: req.method, path: '/mcp', agent: false, maxHeaderSize: 16384, headers }, reply => {
        let parts = [], size = 0;
        reply.on('data', chunk => {
          size += chunk.length;
          if (size > MAX_RESPONSE) lost();
          else if (!done) parts.push(chunk);
        });
        reply.on('error', lost);
        reply.on('aborted', lost);
        reply.on('end', () => {
          if (done) return;
          const response = Buffer.concat(parts); parts = [];
          if (injection) {
            try {
              assert.equal(reply.statusCode, 200);
              assert.match(reply.headers['content-type'] ?? '', /^application\/json(?:;|$)/i);
              const envelope = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(response));
              assert.equal(envelope.jsonrpc, '2.0'); assert.equal(envelope.id, body.id);
              assert.equal(envelope.error, undefined); assert.equal(envelope.result?.isError, false);
              assert.equal(envelope.result.content[0].type, 'text');
              const result = JSON.parse(envelope.result.content[0].text);
              assert.equal(result.success, true); assert.equal(result.changed, true);
              ledger.replyLosses++;
              res.destroy(); finish(); return;
            } catch { ledger.failedInjection = true; }
          }
          const selected = { 'content-length': response.length };
          for (const key of ['content-type', 'mcp-session-id', 'mcp-protocol-version']) {
            if (typeof reply.headers[key] === 'string') selected[key] = reply.headers[key];
          }
          res.writeHead(reply.statusCode, selected); res.end(response); finish();
        });
      });
      outbound.add(upstream); upstream.on('error', lost); upstream.end(bytes);
    });
  });
  server.on('clientError', (_error, socket) => socket.destroy());
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(listenPort, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
  return {
    port: server.address().port,
    arm() { assert.ok(!armed && !consumed && !closing); armed = true; },
    snapshot() { return { ...ledger, armed, consumed, active }; },
    close() {
      if (!closing) {
        closing = new Promise(resolve => {
          server.close(resolve); server.closeAllConnections();
          for (const req of outbound) req.destroy();
        });
      }
      return closing;
    },
  };
}
