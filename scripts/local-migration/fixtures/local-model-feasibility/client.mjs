import https from 'node:https';
import tls from 'node:tls';
import { X509Certificate } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { CompletionStream } from './stream.mjs';
import { createControlEvidence } from './control-evidence.mjs';

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
  onSocket = () => {}, onFailure = () => {}, signal, timeoutMs = 5000, key = configuration.apiKey, expectedStatus = 200 } = {}) {
  if (![200, 401].includes(expectedStatus)) return Promise.reject(failure());
  const body = data === undefined ? undefined : JSON.stringify(data);
  if (body && Buffer.byteLength(body) > 256 * 1024) return Promise.reject(failure('input limit'));
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(failure('cancelled')); return; }
    let timer; let fault; let reported = false;
    const rejectFixed = () => { if (!reported) { reported = true; onFailure(fault ?? 'transport'); } reject(failure()); };
    const request = https.request(options(configuration, path, body, connectionAgent, key), (response) => {
      const socket = request.socket;
      if (expectedSocket && socket !== expectedSocket) { fault ??= 'continuity'; request.destroy(failure()); return; }
      if (socket.remoteAddress !== '127.0.0.1' || socket.remotePort !== configuration.port) { fault ??= 'continuity'; request.destroy(failure()); return; }
      const chunks = []; let bytes = 0;
      response.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes > 256 * 1024) { fault ??= 'invalid'; request.destroy(failure('invalid response')); }
        else chunks.push(chunk);
      });
      response.on('error', rejectFixed);
      response.on('end', () => {
        try {
          if (response.statusCode !== expectedStatus) { fault ??= 'http'; throw failure(); }
          const value = expectedStatus === 200
            ? JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))) : null;
          resolve({ value, socket, status: response.statusCode });
        } catch { fault ??= 'invalid'; rejectFixed(); }
      });
    });
    request.on('socket', (socket) => {
      if (expectedSocket && socket !== expectedSocket) { fault ??= 'continuity'; request.destroy(failure()); }
      else onSocket(socket);
    });
    const abort = () => { fault ??= 'aborted'; request.destroy(failure('cancelled')); };
    signal?.addEventListener('abort', abort, { once: true });
    request.on('error', rejectFixed);
    request.on('close', () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); });
    timer = setTimeout(() => { fault ??= 'timeout'; request.destroy(failure()); }, timeoutMs);
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
  #evidence = createControlEvidence();

  constructor({ port, certificate, apiKey, pollMs = 2000, settleMs = 5000, statusTimeoutMs = 5000 }) {
    this.#configuration = { port, certificate, apiKey };
    this.#pollMs = pollMs; this.#settleMs = settleMs; this.#statusTimeoutMs = statusTimeoutMs;
  }
  get state() { return this.#closing ? 'unavailable' : this.#state; }
  get controlEvidence() { return this.#evidence.snapshot(this.state); }
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
    onProgress = () => {}, onTerminalObservation = () => {}, maxTokens = 2048 } = {}) {
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

    this.#evidence = createControlEvidence(); const evidence = this.#evidence;
    this.#state = 'active';
    const control = agent(this.#configuration); const inference = agent(this.#configuration);
    const controller = new AbortController();
    const decoder = new CompletionStream({ onProgress, onTerminalObservation });
    let controlSocket; let controlLost = false; let dispatched = false; let request;
    let settlementEnd; let settlementTimer;
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
      active = false; clearTimeout(pollTimer); clearTimeout(deadlineTimer); clearTimeout(settlementTimer);
      signal?.removeEventListener('abort', externalAbort);
      control.destroy(); inference.destroy(); this.#abort = undefined;
      await inferenceClosed;
      await Promise.all(socketClosures);
      cleaned = true;
    })();
    const startSettlement = () => {
      if (settlementEnd !== undefined || !active) return;
      settlementEnd = performance.now() + this.#settleMs;
      evidence.record('settlement', controlRequests, 'start', this.#settleMs);
      settlementTimer = setTimeout(() => {
        if (!active) return;
        evidence.record('settlement', controlRequests, 'deadline', 0);
        controlLost = true; control.destroy(); request?.destroy(failure(abortKind || 'unavailable'));
      }, Math.max(0, settlementEnd - performance.now()));
    };
    const abort = (kind) => {
      if (abortKind || !active) return;
      startSettlement();
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
      if (controlLost || controlRequests >= 90) throw failure();
      const phase = duringSettlement ? 'settlement' : dispatched ? 'active' : 'readiness';
      const budget = duringSettlement ? settlementEnd - performance.now() : this.#statusTimeoutMs;
      if (!Number.isFinite(budget) || budget <= 0) throw failure();
      const sequence = ++controlRequests; let fault = 'transport';
      evidence.record(phase, sequence, 'dispatch', budget);
      try {
        const result = await probeJson(this.#configuration, '/slots', undefined, {
          connectionAgent: control, expectedSocket: controlSocket,
          signal: duringSettlement || preserveAtAbort ? undefined : controller.signal,
          timeoutMs: Math.min(budget, this.#statusTimeoutMs),
          onFailure: (reason) => { fault = reason; },
          onSocket: (socket) => {
            trackSocket(socket);
            if (!controlSocket) {
              controlSocket = socket;
              socket.once('close', () => {
                evidence.record(active ? 'control' : 'cleanup', controlRequests, 'close', Math.max(0, (settlementEnd ?? performance.now()) - performance.now()));
                if (!active) return;
                controlLost = true;
                if (dispatched) abort('unavailable');
              });
            }
          },
        });
        if (controlLost || result.socket !== controlSocket) { fault = 'continuity'; throw failure(); }
        if (duringSettlement && performance.now() >= settlementEnd) { fault = 'deadline'; throw failure(); }
        let available;
        try { available = idle(result.value); } catch { fault = 'invalid'; throw failure(); }
        evidence.record(phase, sequence, available ? 'idle' : 'busy', duringSettlement ? Math.max(0, settlementEnd - performance.now()) : this.#statusTimeoutMs);
        return available;
      } catch (error) {
        if (active && dispatched) startSettlement();
        evidence.record(active ? phase : 'cleanup', sequence, fault, Math.max(0, (settlementEnd ?? performance.now()) - performance.now()));
        throw error;
      }
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
            startSettlement(); request.destroy(failure('invalid response')); return;
          }
          response.on('data', (bytes) => {
            try { decoder.push(bytes); }
            catch { startSettlement(); request.destroy(failure('invalid response')); }
          });
          response.on('error', () => { startSettlement(); reject(failure(abortKind || 'unavailable')); });
          response.on('end', () => {
            try {
              checkBudget();
              resolve(decoder.finish());
            } catch { startSettlement(); reject(failure(abortKind || 'invalid response')); }
          });
        });
        inferenceClosed = new Promise((resolve) => request.once('close', resolve));
        request.on('socket', trackSocket);
        request.on('error', () => { startSettlement(); reject(failure(abortKind || 'unavailable')); });
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
      startSettlement();
      clearTimeout(pollTimer); clearTimeout(deadlineTimer);
      signal?.removeEventListener('abort', externalAbort);
      request?.destroy();
      if (!dispatched || cleaned) { await cleanup(); ready(); }
      else if (!decoder.witnessed || controlLost) { this.#state = 'unavailable'; await cleanup(); }
      else {
        this.#state = 'cancel-pending';
        this.#settlement = (async () => {
          try {
            await pendingStatus;
            while (!controlLost && performance.now() < settlementEnd) {
              if (await status(true)) {
                if (performance.now() >= settlementEnd || controlLost) throw failure();
                await cleanup();
                if (performance.now() >= settlementEnd || controlLost) throw failure();
                ready(); return;
              }
              await delay(Math.min(250, this.#pollMs, Math.max(0, settlementEnd - performance.now())));
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
