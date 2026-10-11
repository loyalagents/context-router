import { setTimeout as delay } from 'node:timers/promises';
import { inspectManualSession } from './manual-session.mjs';
import { probeJson } from './client.mjs';

/** One generation, independent of status callers. Only unauthenticated pinned health precedes the claim. */
export class ManagedModelReadiness {
  #state = 'loading';
  #stop = new AbortController();
  #work;
  #expiry;
  #expiresAt;
  #wallNow;
  #checkAuthority;
  #externalSignal;
  #invalidate = () => this.invalidate();
  constructor(configuration, { signal, startupMs = 60_000, wallNow = Date.now, checkAuthority = () => {} } = {}) {
    if (!Number.isFinite(startupMs) || startupMs < 200 || startupMs > 60_000 || typeof wallNow !== 'function' || typeof checkAuthority !== 'function') throw new Error('MODEL_UNAVAILABLE');
    this.#wallNow = wallNow; this.#checkAuthority = checkAuthority; this.#externalSignal = signal;
    signal?.addEventListener('abort', this.#invalidate, { once: true });
    if (signal?.aborted) this.invalidate();
    const end = performance.now() + startupMs;
    this.#work = this.#start(configuration, end).catch(() => this.invalidate());
  }
  get signal() { return this.#stop.signal; }
  get state() {
    if (this.#state === 'ready') {
      try { this.#checkAuthority(); if (this.#wallNow() >= this.#expiresAt) this.invalidate(); }
      catch { this.invalidate(); }
    }
    return this.#state;
  }
  invalidate() {
    this.#state = 'failed'; this.#stop.abort(); clearTimeout(this.#expiry);
    this.#externalSignal?.removeEventListener('abort', this.#invalidate);
  }
  async #start(configuration, end) {
    this.#checkAuthority();
    if (this.#stop.signal.aborted) return;
    const inspected = await inspectManualSession(configuration);
    this.#expiresAt = inspected.expiresAt;
    while (!this.#stop.signal.aborted && performance.now() < end) {
      this.#checkAuthority();
      if (this.#wallNow() >= this.#expiresAt) throw new Error('MODEL_UNAVAILABLE');
      let socket, closed = Promise.resolve(), response;
      try {
        response = await probeJson(inspected, '/health', undefined, {
          key: null, signal: this.#stop.signal, timeoutMs: Math.max(1, Math.min(1000, end - performance.now())),
          onSocket: owned => { socket = owned; socket.on('error', () => {}); closed = new Promise(resolve => socket.once('close', resolve)); },
        });
      } catch { /* Loading/refused health is retryable only inside this finite startup window. */ }
      finally { socket?.destroy(); await closed; }
      this.#checkAuthority();
      if (this.#stop.signal.aborted) return;
      if (performance.now() >= end) break;
      if (response) {
        if (response.value?.status !== 'ok' || this.#wallNow() >= this.#expiresAt) throw new Error('MODEL_UNAVAILABLE');
        this.#state = 'ready';
        this.#expiry = setTimeout(this.#invalidate, Math.min(2 ** 31 - 1, this.#expiresAt - this.#wallNow()));
        this.#expiry.unref();
        return;
      }
      if (end - performance.now() < 200) break;
      await delay(200, undefined, { signal: this.#stop.signal });
    }
    this.invalidate();
  }
  async close() { this.invalidate(); await this.#work; }
}
