import http from 'node:http';

export const VERSION = '0.1.0';
export const DEFAULT_LIMITS = Object.freeze({
  inputBytes: 128 * 1024,
  responseBytes: 8 * 1024 * 1024,
  aggregateResponseBytes: 16 * 1024 * 1024,
  outputBytes: 8 * 1024 * 1024,
  activeRequests: 8,
  controls: 16,
  ids: 4096,
  handshakeMs: 10000,
  operationMs: 190000,
  controlMs: 3000,
  shutdownMs: 5000,
  drainMs: 5000,
});
const protocols = new Set(['2025-06-18', '2025-11-25']);
const key = (id) => `${typeof id}:${id}`;
const validId = (id) =>
  typeof id === 'number'
    ? Number.isSafeInteger(id)
    : typeof id === 'string' && Buffer.byteLength(id) <= 128;
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const owns = (v, k) => Object.hasOwn(v, k);
const validError = (v) =>
  object(v) && Number.isSafeInteger(v.code) && typeof v.message === 'string';
// Match the pinned SDK's generic ResultSchema without importing backend dependencies.
function validResult(value) {
  if (!object(value)) return false;
  if (!owns(value, '_meta')) return true;
  const meta = value._meta;
  if (!object(meta)) return false;
  if (
    owns(meta, 'progressToken') &&
    typeof meta.progressToken !== 'string' &&
    !Number.isSafeInteger(meta.progressToken)
  )
    return false;
  const related = 'io.modelcontextprotocol/related-task';
  return (
    !owns(meta, related) ||
    (object(meta[related]) && typeof meta[related].taskId === 'string')
  );
}
// Presentation only: routing and backend validation remain authoritative. Task
// requests keep protocol errors because this fixed result carries no correlation.
function ordinaryToolCall(message) {
  if (
    !Object.keys(message).every((k) =>
      ['jsonrpc', 'id', 'method', 'params'].includes(k),
    ) ||
    message.method !== 'tools/call' ||
    !object(message.params)
  )
    return false;
  const params = message.params;
  if (
    typeof params.name !== 'string' ||
    (owns(params, 'arguments') && !object(params.arguments)) ||
    owns(params, 'task')
  )
    return false;
  if (!owns(params, '_meta')) return true;
  const meta = params._meta;
  return (
    object(meta) &&
    !owns(meta, 'io.modelcontextprotocol/related-task') &&
    (!owns(meta, 'progressToken') ||
      typeof meta.progressToken === 'string' ||
      Number.isSafeInteger(meta.progressToken))
  );
}
const fault = (kind, status) =>
  Object.assign(new Error(kind), { kind, status });
const decode = (bytes) =>
  new TextDecoder('utf-8', { fatal: true }).decode(bytes);
const messages = Object.freeze({
  unknown:
    'Outcome unknown. The request may have completed. Inspect state before retrying a write; no request was replayed.',
  stale:
    'Session expired. This request was not dispatched. Make an explicit new request to reconnect; earlier uncertain work may still have completed.',
  authority:
    'Access denied. Check the client credential and grants. Reconnect explicitly after credential rotation.',
  unavailable:
    'Context Router connection unavailable. Open the app, then reconnect explicitly.',
  contract: 'Connection contract changed. Restart this bridge explicitly.',
  capacity: 'Bridge capacity reached. This request was not dispatched.',
  exhausted:
    'Request ID limit reached. Restart the bridge explicitly; this request was not dispatched.',
  invalid: 'Invalid MCP request.',
  notReady: 'Initialize the connection before making requests.',
  cancelled: 'Request cancelled before dispatch.',
});

/** This is a CR-specific client adapter. Only its CLI selects the production endpoint. */
export function createBridge({
  input,
  output,
  diagnostics,
  credential,
  port = 8787,
  limits: overrides = {},
}) {
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw fault('configuration');
  const limits = { ...DEFAULT_LIMITS, ...overrides };
  const requests = new Set(),
    sessions = new Set(),
    active = new Map(),
    seen = new Set();
  let stopping = false,
    phase = 'new',
    current,
    renewal,
    readyBarrier,
    initialParams,
    accepted;
  let sequence = 0,
    generation = 0,
    controlCount = 0,
    responseBytes = 0;
  let buffer = Buffer.alloc(0),
    drainTimer,
    closePromise,
    finish;
  const closed = new Promise((r) => {
    finish = r;
  });

  function diagnostic(category) {
    // Categories are selected by this module, never derived from an exception or payload.
    try {
      diagnostics?.write(`Context Router bridge: ${category}\n`);
    } catch {
      /* Exit still owns cleanup. */
    }
  }
  function send(value) {
    if (stopping) return;
    const payload = `${JSON.stringify(value)}\n`;
    if (
      Buffer.byteLength(payload) + output.writableLength >
      limits.outputBytes
    ) {
      diagnostic('output unavailable');
      void close();
      return;
    }
    try {
      if (!output.write(payload) && !drainTimer) {
        input.pause();
        drainTimer = setTimeout(() => {
          diagnostic('output unavailable');
          void close();
        }, limits.drainMs);
      }
    } catch {
      diagnostic('output unavailable');
      void close();
    }
  }
  function error(id, category, outcome = 'not_dispatched') {
    send({
      jsonrpc: '2.0',
      ...(validId(id) ? { id } : {}),
      error: {
        code: category === 'invalid' ? -32600 : -32000,
        message: messages[category],
        data: { outcome },
      },
    });
  }
  function operationalError(message, category, outcome = 'not_dispatched') {
    if (!ordinaryToolCall(message)) {
      error(message.id, category, outcome);
      return;
    }
    send({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        isError: true,
        content: [{ type: 'text', text: messages[category] }],
      },
    });
  }
  function releaseSession(session) {
    if (
      session &&
      session !== current &&
      sessions.has(session) &&
      ![...active.values()].some((item) => item.session === session)
    ) {
      sessions.delete(session);
      // All bridge calls have settled, but a lost response can leave server work.
      // Best-effort cleanup does not establish rollback or replay anything.
      if (!stopping)
        void exchange(undefined, {
          session,
          method: 'DELETE',
          timeout: limits.controlMs,
          control: true,
        }).catch(() => {});
    }
  }
  function retire(session) {
    if (current === session) current = undefined;
    releaseSession(session);
  }

  function exchange(
    message,
    {
      session,
      method = 'POST',
      timeout = limits.operationMs,
      control = false,
    } = {},
  ) {
    if (control && controlCount >= limits.controls)
      return Promise.reject(fault('capacity'));
    if (control) controlCount++;
    return new Promise((resolve, reject) => {
      let settled = false,
        size = 0,
        timer,
        req;
      const chunks = [];
      function settle(err, value) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        responseBytes -= size;
        if (control) controlCount--;
        requests.delete(req);
        if (err) reject(err);
        else resolve(value);
      }
      const payload =
        message === undefined ? undefined : JSON.stringify(message);
      try {
        req = http.request(
          {
            hostname: '127.0.0.1',
            port,
            path: '/mcp',
            method,
            // A private one-shot agent also ignores poisoned global agents / env proxy settings.
            agent: false,
            maxHeaderSize: 16384,
            headers: {
              authorization: `Bearer ${credential}`,
              accept: 'application/json, text/event-stream',
              ...(payload === undefined
                ? {}
                : {
                    'content-type': 'application/json',
                    'content-length': Buffer.byteLength(payload),
                  }),
              ...(session
                ? {
                    'mcp-session-id': session.id,
                    'mcp-protocol-version': session.protocol,
                  }
                : {}),
            },
          },
          (res) => {
            res.on('data', (chunk) => {
              if (settled) return;
              size += chunk.length;
              responseBytes += chunk.length;
              if (
                size > limits.responseBytes ||
                responseBytes > limits.aggregateResponseBytes
              ) {
                settle(fault('transport'));
                req.destroy();
                return;
              }
              chunks.push(chunk);
            });
            res.on('error', () => settle(fault('transport')));
            res.on('aborted', () => settle(fault('transport')));
            res.on('end', () => {
              if (settled) return;
              try {
                const status = res.statusCode,
                  contentType = String(res.headers['content-type'] ?? '')
                    .split(';')[0]
                    .trim()
                    .toLowerCase();
                if (status === 401 || status === 403)
                  throw fault('authority', status);
                if (status === 404 && contentType === 'application/json') {
                  const body = JSON.parse(decode(Buffer.concat(chunks)));
                  if (body.error === 'Local MCP request rejected')
                    throw fault('stale', 404);
                }
                if (method === 'DELETE' && status === 200 && size === 0) {
                  settle(null, {});
                  return;
                }
                if (
                  message &&
                  !owns(message, 'id') &&
                  status === 202 &&
                  size === 0
                ) {
                  settle(null, {});
                  return;
                }
                if (
                  status === 200 &&
                  contentType === 'text/event-stream' &&
                  size === 0
                ) {
                  settle(null, { cancelled: true });
                  return;
                }
                if (status !== 200 || contentType !== 'application/json')
                  throw fault('transport', status);
                const reply = JSON.parse(decode(Buffer.concat(chunks)));
                if (
                  !object(reply) ||
                  reply.jsonrpc !== '2.0' ||
                  !message ||
                  reply.id !== message.id ||
                  owns(reply, 'result') === owns(reply, 'error') ||
                  (owns(reply, 'error') && !validError(reply.error)) ||
                  (owns(reply, 'result') && !validResult(reply.result)) ||
                  Object.keys(reply).some(
                    (name) =>
                      !['jsonrpc', 'id', 'result', 'error'].includes(name),
                  )
                )
                  throw fault('transport');
                settle(null, {
                  reply,
                  sessionId: res.headers['mcp-session-id'],
                });
              } catch (e) {
                settle(e.kind ? e : fault('transport'));
              }
            });
          },
        );
        requests.add(req);
        timer = setTimeout(() => {
          settle(fault('transport'));
          req.destroy();
        }, timeout);
        req.on('error', () => settle(fault('transport')));
        req.end(payload);
      } catch {
        settle(fault('transport'));
        req?.destroy();
      }
    });
  }

  function compatible(result) {
    return (
      object(result) &&
      protocols.has(result.protocolVersion) &&
      object(result.capabilities) &&
      Object.keys(result.capabilities).every((name) =>
        ['tools', 'resources'].includes(name),
      ) &&
      Object.values(result.capabilities).every(
        (value) => object(value) && Object.keys(value).length === 0,
      ) &&
      object(result.serverInfo) &&
      typeof result.serverInfo.name === 'string' &&
      typeof result.serverInfo.version === 'string' &&
      (!owns(result, 'instructions') || typeof result.instructions === 'string')
    );
  }
  async function initialize(renew = false) {
    const value = await exchange(
      {
        jsonrpc: '2.0',
        id: ++sequence,
        method: 'initialize',
        params: initialParams,
      },
      { timeout: limits.handshakeMs, control: true },
    );
    if (stopping) throw fault('transport');
    const rawResult = value.reply?.result;
    if (
      !compatible(rawResult) ||
      typeof value.sessionId !== 'string' ||
      !/^[A-Za-z0-9_-]{43}$/.test(value.sessionId)
    )
      throw fault('contract');
    const result = {
      protocolVersion: rawResult.protocolVersion,
      capabilities: rawResult.capabilities,
      serverInfo: {
        name: rawResult.serverInfo.name,
        version: rawResult.serverInfo.version,
      },
      ...(owns(rawResult, 'instructions')
        ? { instructions: rawResult.instructions }
        : {}),
    };
    const session = {
      id: value.sessionId,
      protocol: result.protocolVersion,
      generation: ++generation,
    };
    sessions.add(session);
    try {
      if (
        renew &&
        (result.protocolVersion !== accepted.protocolVersion ||
          JSON.stringify(result.capabilities) !==
            JSON.stringify(accepted.capabilities))
      )
        throw fault('contract');
      if (renew)
        await exchange(
          { jsonrpc: '2.0', method: 'notifications/initialized' },
          { session, timeout: limits.handshakeMs, control: true },
        );
      if (stopping) throw fault('transport');
    } catch (e) {
      if (!stopping)
        await exchange(undefined, {
          session,
          method: 'DELETE',
          timeout: limits.controlMs,
          control: true,
        }).catch(() => {});
      sessions.delete(session);
      throw e;
    }
    current = session;
    if (!renew) accepted = result;
    return result;
  }
  function ensureSession() {
    if (current) return Promise.resolve(current);
    if (!renewal)
      renewal = initialize(true)
        .then(() => current)
        .finally(() => {
          renewal = undefined;
        });
    return renewal;
  }
  async function cancel(message) {
    const item = active.get(key(message.params?.requestId));
    if (!item) return;
    item.cancelled = true;
    if (!item.dispatched || !item.session) return;
    try {
      await exchange(
        {
          jsonrpc: '2.0',
          method: 'notifications/cancelled',
          params: { requestId: item.wireId },
        },
        { session: item.session, timeout: limits.controlMs, control: true },
      );
    } catch {
      /* Control failure never establishes the outcome of the original request. */
    }
  }
  async function handle(message) {
    const isRequest = owns(message, 'id');
    if (!isRequest) {
      if (
        message.method === 'notifications/initialized' &&
        phase === 'initialized'
      ) {
        phase = 'ready';
        readyBarrier = exchange(
          { jsonrpc: '2.0', method: message.method },
          { session: current, timeout: limits.handshakeMs, control: true },
        );
        try {
          await readyBarrier;
        } catch {
          diagnostic('connection unavailable');
          void close();
        }
      } else if (
        message.method === 'notifications/cancelled' &&
        validId(message.params?.requestId)
      )
        await cancel(message);
      return;
    }
    const id = message.id,
      idKey = key(id);
    if (seen.has(idKey)) {
      error(id, 'invalid');
      return;
    }
    if (seen.size >= limits.ids) {
      error(id, 'exhausted');
      return;
    }
    seen.add(idKey);
    if (message.method === 'initialize') {
      if (
        phase !== 'new' ||
        !object(message.params) ||
        typeof message.params.protocolVersion !== 'string' ||
        !object(message.params.capabilities) ||
        !object(message.params.clientInfo) ||
        typeof message.params.clientInfo.name !== 'string' ||
        typeof message.params.clientInfo.version !== 'string'
      ) {
        error(id, 'invalid');
        return;
      }
      // The current CR server sends no requests to the client; do not advertise any.
      initialParams = {
        protocolVersion: message.params.protocolVersion,
        capabilities: {},
        clientInfo: { name: 'context-router-stdio-bridge', version: VERSION },
      };
      phase = 'initializing';
      try {
        const result = await initialize();
        phase = 'initialized';
        send({ jsonrpc: '2.0', id, result });
      } catch (e) {
        phase = 'new';
        error(
          id,
          e.kind === 'authority'
            ? 'authority'
            : e.kind === 'contract'
              ? 'contract'
              : 'unavailable',
        );
      }
      return;
    }
    if (phase !== 'ready') {
      error(id, 'notReady');
      return;
    }
    if (active.size >= limits.activeRequests) {
      operationalError(message, 'capacity');
      return;
    }
    const item = {
      id,
      wireId: ++sequence,
      session: undefined,
      dispatched: false,
      cancelled: false,
    };
    active.set(idKey, item);
    try {
      if (readyBarrier) await readyBarrier;
      if (stopping) return;
      item.session = await ensureSession();
      if (stopping) return;
      if (item.cancelled) {
        operationalError(message, 'cancelled');
        return;
      }
      item.dispatched = true;
      const value = await exchange(
        { ...message, id: item.wireId },
        { session: item.session },
      );
      if (value.cancelled) operationalError(message, 'unknown', 'unknown');
      else if (value.reply.error)
        send({
          jsonrpc: '2.0',
          id,
          error: {
            code: value.reply.error.code,
            message: 'Invalid MCP request',
          },
        });
      else send({ jsonrpc: '2.0', id, result: value.reply.result });
    } catch (e) {
      if (item.dispatched && e.kind === 'stale') {
        retire(item.session);
        operationalError(message, 'stale');
      } else if (e.kind === 'authority')
        operationalError(
          message,
          'authority',
          item.dispatched ? 'rejected' : 'not_dispatched',
        );
      else {
        retire(item.session);
        operationalError(
          message,
          item.dispatched
            ? 'unknown'
            : e.kind === 'contract'
              ? 'contract'
              : 'unavailable',
          item.dispatched ? 'unknown' : 'not_dispatched',
        );
      }
    } finally {
      active.delete(idKey);
      releaseSession(item.session);
    }
  }
  function line(bytes) {
    let message;
    try {
      message = JSON.parse(decode(bytes));
      if (
        !object(message) ||
        message.jsonrpc !== '2.0' ||
        typeof message.method !== 'string' ||
        Buffer.byteLength(message.method) > 128 ||
        (owns(message, 'id') && !validId(message.id)) ||
        owns(message, 'result') ||
        owns(message, 'error') ||
        (owns(message, 'params') && !object(message.params))
      )
        throw fault('invalid');
    } catch {
      error(null, 'invalid');
      return;
    }
    void handle(message).catch(() => {
      diagnostic('connection unavailable');
      void close();
    });
  }
  function onData(chunk) {
    if (stopping) return;
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    let start = 0;
    for (let i = 0; i < bytes.length; i++) {
      if (bytes[i] !== 10) continue;
      if (buffer.length + i - start > limits.inputBytes) {
        diagnostic('input unavailable');
        void close();
        return;
      }
      line(Buffer.concat([buffer, bytes.subarray(start, i)]));
      buffer = Buffer.alloc(0);
      start = i + 1;
      if (stopping) return;
    }
    if (buffer.length + bytes.length - start > limits.inputBytes) {
      diagnostic('input unavailable');
      void close();
      return;
    }
    buffer = Buffer.concat([buffer, bytes.subarray(start)]);
  }
  function onDrain() {
    clearTimeout(drainTimer);
    drainTimer = undefined;
    if (!stopping) input.resume();
  }
  function close() {
    if (closePromise) return closePromise;
    stopping = true;
    input.pause();
    input.removeListener('data', onData);
    buffer = Buffer.alloc(0);
    clearTimeout(drainTimer);
    closePromise = (async () => {
      let timer;
      try {
        await Promise.race([
          Promise.all(
            [...sessions].map((session) =>
              exchange(undefined, {
                session,
                method: 'DELETE',
                timeout: limits.controlMs,
                control: true,
              }).catch(() => {}),
            ),
          ),
          new Promise((r) => {
            timer = setTimeout(r, limits.shutdownMs);
          }),
        ]);
      } finally {
        clearTimeout(timer);
        for (const req of requests) req.destroy();
        input.removeListener('end', onEnd);
        input.removeListener('error', onEnd);
        output.removeListener('drain', onDrain);
        credential = undefined;
        sessions.clear();
        finish();
      }
    })();
    return closePromise;
  }
  const onEnd = () => {
    void close();
  };
  input.on('data', onData);
  input.once('end', onEnd);
  input.once('error', onEnd);
  output.on('drain', onDrain);
  output.once('error', onEnd);
  return { close, closed };
}
