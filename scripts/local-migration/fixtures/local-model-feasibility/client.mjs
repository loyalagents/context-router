import https from 'node:https';
import tls from 'node:tls';
import { X509Certificate } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { CompletionStream } from './stream.mjs';

const failure = (kind = 'unavailable') => new Error(`Local model ${kind}`);
const paths = new Set(['/health', '/props', '/models', '/slots', '/apply-template', '/tokenize', '/completion']);

function trust(configuration) {
  const fingerprint = new X509Certificate(configuration.certificate).fingerprint256;
  return { ca: configuration.certificate, rejectUnauthorized: true,
    checkServerIdentity: (_, cert) => tls.checkServerIdentity('127.0.0.1', cert) ||
      (cert.fingerprint256 === fingerprint ? undefined : failure()) };
}

// Node 24 intentionally refuses pooling for per-request identity callbacks.
// Bind immutable trust to this private agent, so control reuse retains the pin.
const agent = (configuration) => new https.Agent({ keepAlive: true, maxSockets: 1,
  maxCachedSessions: 0, proxyEnv: {}, ...trust(configuration) });

function options(configuration, path, body, connectionAgent, key = configuration.apiKey) {
  if (!Number.isInteger(configuration.port) || configuration.port < 1 || configuration.port > 65535 || !paths.has(path)) {
    throw failure();
  }
  return { protocol: 'https:', hostname: '127.0.0.1', port: configuration.port, path,
    method: body === undefined ? 'GET' : 'POST', agent: connectionAgent,
    ...(connectionAgent ? {} : trust(configuration)),
    headers: { ...(key === null ? {} : { authorization: `Bearer ${key}` }),
      ...(body === undefined ? {} : { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }) } };
}

// Exported only for the owned CP1 runner's fixed readiness/template/token probes.
export function probeJson(configuration, path, data, { connectionAgent = false, expectedSocket,
  onSocket = () => {}, signal, timeoutMs = 5000, key = configuration.apiKey, expectedStatus = 200 } = {}) {
  if (![200, 401].includes(expectedStatus)) return Promise.reject(failure());
  const body = data === undefined ? undefined : JSON.stringify(data);
  if (body && Buffer.byteLength(body) > 256 * 1024) return Promise.reject(failure('input limit'));
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(failure('cancelled')); return; }
    let timer;
    const request = https.request(options(configuration, path, body, connectionAgent, key), (response) => {
      const socket = request.socket;
      if (expectedSocket && socket !== expectedSocket) { request.destroy(failure()); return; }
      if (socket.remoteAddress !== '127.0.0.1' || socket.remotePort !== configuration.port) { request.destroy(failure()); return; }
      const chunks = []; let bytes = 0;
      response.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes > 256 * 1024) request.destroy(failure('invalid response'));
        else chunks.push(chunk);
      });
      response.on('error', () => reject(failure()));
      response.on('end', () => {
        try {
          if (response.statusCode !== expectedStatus) throw failure();
          const value = expectedStatus === 200
            ? JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))) : null;
          resolve({ value, socket, status: response.statusCode });
        } catch { reject(failure()); }
      });
    });
    request.on('socket', (socket) => {
      if (expectedSocket && socket !== expectedSocket) request.destroy(failure());
      else onSocket(socket);
    });
    const abort = () => request.destroy(failure('cancelled'));
    signal?.addEventListener('abort', abort, { once: true });
    request.on('error', () => reject(failure()));
    request.on('close', () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); });
    timer = setTimeout(() => request.destroy(failure()), timeoutMs);
    request.end(body);
  });
}

function idle(value) {
  if (!Array.isArray(value) || value.length !== 1 || value[0]?.id !== 0 ||
      typeof value[0].is_processing !== 'boolean') throw failure();
  return !value[0].is_processing;
}

/** Disposable CP1 transport. Does not launch/stop or claim ownership of a runtime. */
export class ProbeClient {
  #configuration;
  #state = 'ready';
  #settlement = Promise.resolve();
  #operation = Promise.resolve();
  #closing = false;
  #abort;
  #pollMs;
  #settleMs;
  #statusTimeoutMs;

  constructor({ port, certificate, apiKey, pollMs = 2000, settleMs = 5000, statusTimeoutMs = 5000 }) {
    this.#configuration = { port, certificate, apiKey };
    this.#pollMs = pollMs; this.#settleMs = settleMs; this.#statusTimeoutMs = statusTimeoutMs;
  }
  get state() { return this.#closing ? 'unavailable' : this.#state; }
  async settled() { await this.#settlement; }
  async close() {
    this.#closing = true;
    this.#abort?.('unavailable');
    await this.#operation;
    await this.#settlement;
    this.#state = 'unavailable';
  }

  complete(prompt, options) {
    if (this.#closing || this.#state === 'unavailable') return Promise.reject(failure());
    if (this.#state !== 'ready') return Promise.reject(failure('busy'));
    const operation = this.#execute(prompt, options);
    this.#operation = operation.then(() => this.#settlement, () => this.#settlement);
    return operation;
  }

  async #execute(prompt, { signal, deadline = performance.now() + 120000, schema,
    onProgress = () => {}, maxTokens = 2048 } = {}) {
    if (this.#state === 'unavailable') throw failure();
    if (this.#state !== 'ready') throw failure('busy');
    if (signal?.aborted) throw failure('cancelled');
    const effectiveDeadline = Math.min(deadline, performance.now() + 120000);
    const remaining = effectiveDeadline - performance.now();
    if (!Number.isFinite(remaining) || remaining <= 0) throw failure('deadline');
    if (typeof prompt !== 'string' || !prompt.length || Buffer.byteLength(prompt) > 128 * 1024 ||
        !Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 2048 ||
        (schema && Buffer.byteLength(JSON.stringify(schema)) > 32 * 1024)) throw failure('input limit');
    const body = JSON.stringify({ prompt, stream: true, return_progress: true, cache_prompt: false,
      n_cmpl: 1, n_predict: maxTokens, temperature: 0, seed: 42,
      response_fields: ['index', 'content', 'stop', 'tokens_predicted', 'tokens_evaluated', 'truncated', 'stop_type', 'timings'],
      ...(schema ? { json_schema: schema } : {}) });
    if (Buffer.byteLength(body) > 256 * 1024) throw failure('input limit');

    this.#state = 'active';
    const control = agent(this.#configuration); const inference = agent(this.#configuration);
    const controller = new AbortController();
    const decoder = new CompletionStream({ onProgress });
    let controlSocket; let controlLost = false; let dispatched = false; let request;
    let abortKind; let active = true; let pollTimer; let controlRequests = 0;
    let pendingStatus = Promise.resolve();
    const socketClosures = []; const trackedSockets = new Set();
    let inferenceClosed = Promise.resolve(); let cleanupPromise; let cleaned = false;
    const trackSocket = (socket) => {
      if (trackedSockets.has(socket)) return;
      trackedSockets.add(socket);
      // A malformed final chunk can destroy a socket after Node has detached its request listener.
      // Requests still reject and control close still latches; retain an owner for late socket errors.
      socket.on('error', () => {});
      socketClosures.push(new Promise((resolve) => socket.once('close', resolve)));
    };
    const ready = () => { this.#state = this.#closing ? 'unavailable' : 'ready'; };
    const cleanup = () => cleanupPromise ??= (async () => {
      active = false; clearTimeout(pollTimer); clearTimeout(deadlineTimer);
      signal?.removeEventListener('abort', externalAbort);
      control.destroy(); inference.destroy(); this.#abort = undefined;
      await inferenceClosed;
      await Promise.all(socketClosures);
      cleaned = true;
    })();
    const abort = (kind) => {
      if (abortKind || !active) return;
      abortKind = kind; controller.abort(); request?.destroy(failure(kind));
    };
    const externalAbort = () => abort('cancelled');
    const checkBudget = () => {
      if (this.#closing) abort('unavailable');
      else if (signal?.aborted) abort('cancelled');
      else if (performance.now() >= effectiveDeadline) abort('deadline');
      if (this.#closing) { abortKind ??= 'unavailable'; throw failure('unavailable'); }
      if (signal?.aborted) { abortKind ??= 'cancelled'; throw failure('cancelled'); }
      if (performance.now() >= effectiveDeadline) { abortKind ??= 'deadline'; throw failure('deadline'); }
      if (abortKind || controlLost) throw failure(abortKind);
    };
    this.#abort = abort;
    signal?.addEventListener('abort', externalAbort, { once: true });
    const deadlineTimer = setTimeout(() => abort('deadline'), Math.max(0, effectiveDeadline - performance.now()));
    const status = async (duringSettlement = false, preserveAtAbort = false) => {
      if (++controlRequests > 90 || controlLost) throw failure();
      const result = await probeJson(this.#configuration, '/slots', undefined, {
        connectionAgent: control, expectedSocket: controlSocket,
        signal: duringSettlement || preserveAtAbort ? undefined : controller.signal,
        timeoutMs: duringSettlement ? Math.min(500, this.#statusTimeoutMs) : this.#statusTimeoutMs,
        onSocket: (socket) => {
          trackSocket(socket);
          if (!controlSocket) {
            controlSocket = socket;
            socket.once('close', () => {
              if (!active) return;
              controlLost = true;
              if (dispatched) abort('unavailable');
            });
          }
        },
      });
      if (controlLost || result.socket !== controlSocket) throw failure();
      return idle(result.value);
    };
    const schedulePoll = () => {
      pollTimer = setTimeout(() => {
        if (!active || abortKind) return;
        // A status already in flight at abort is awaited, never reused as a settlement witness.
        pendingStatus = status(false, true).catch(() => { if (active) { controlLost = true; abort('unavailable'); } });
        pendingStatus.finally(() => { if (active && !abortKind) schedulePoll(); });
      }, this.#pollMs);
    };

    try {
      if (!await status()) throw failure('busy');
      checkBudget();
      schedulePoll();
      const result = await new Promise((resolve, reject) => {
        request = https.request(options(this.#configuration, '/completion', body, inference), (response) => {
          if (response.statusCode !== 200 || !/^text\/event-stream(?:;|$)/i.test(response.headers['content-type'] || '')) {
            request.destroy(failure('invalid response')); return;
          }
          response.on('data', (bytes) => {
            try { decoder.push(bytes); }
            catch { request.destroy(failure('invalid response')); }
          });
          response.on('error', () => reject(failure(abortKind || 'unavailable')));
          response.on('end', () => {
            try {
              checkBudget();
              resolve(decoder.finish());
            } catch { reject(failure(abortKind || 'invalid response')); }
          });
        });
        inferenceClosed = new Promise((resolve) => request.once('close', resolve));
        request.on('socket', trackSocket);
        request.on('error', () => reject(failure(abortKind || 'unavailable')));
        checkBudget();
        dispatched = true;
        request.end(body);
      });
      checkBudget();
      await cleanup();
      checkBudget();
      ready();
      return result;
    } catch (error) {
      clearTimeout(pollTimer); clearTimeout(deadlineTimer);
      signal?.removeEventListener('abort', externalAbort);
      request?.destroy();
      if (!dispatched || cleaned) { await cleanup(); ready(); }
      else if (!decoder.witnessed || controlLost) { this.#state = 'unavailable'; await cleanup(); }
      else {
        this.#state = 'cancel-pending';
        const settlementEnd = performance.now() + this.#settleMs;
        this.#settlement = (async () => {
          try {
            await pendingStatus;
            while (!controlLost && performance.now() < settlementEnd) {
              if (await status(true)) {
                if (performance.now() >= settlementEnd || controlLost) throw failure();
                ready(); return;
              }
              await delay(Math.min(250, this.#pollMs));
            }
            throw failure();
          } catch { this.#state = 'unavailable'; }
          finally { await cleanup(); }
        })();
      }
      throw failure(abortKind || (error.message === 'Local model busy' ? 'busy' : 'unavailable'));
    }
  }
}
