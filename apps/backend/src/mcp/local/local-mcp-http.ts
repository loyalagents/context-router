import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
  type Server as HttpServer,
} from 'node:http';
import { randomBytes } from 'node:crypto';
import type { Socket } from 'node:net';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import {
  InitializeRequestSchema,
  JSONRPCMessageSchema,
  type JSONRPCMessage,
} from '@modelcontextprotocol/sdk/types.js';
import type { McpService } from '../mcp.service';
import { LocalMcpAuthGuard, LocalMcpHttpError } from './local-mcp-auth.guard';
import type { LocalMcpCredential } from './local-mcp-credentials';

const PROTOCOLS = ['2025-06-18', '2025-11-25'] as const;
const LIMITS = {
  sessions: 64,
  clientSessions: 8,
  active: 32,
  clientActive: 8,
  ids: 4096,
  body: 128 * 1024,
  idle: 30 * 60 * 1000,
};
type RequestId = string | number;
type Active = { cancel(): void; done: Promise<void> };
type Session = {
  id: string;
  clientId: string;
  principalId: string;
  generation: number;
  protocol: string;
  initialized: boolean;
  ready: boolean;
  closing: boolean;
  touched: number;
  seen: Set<string>;
  active: Map<string, Active>;
};
const idKey = (id: RequestId) => `${typeof id}:${id}`;
const validId = (id: unknown): id is RequestId =>
  typeof id === 'number'
    ? Number.isSafeInteger(id)
    : typeof id === 'string' && Buffer.byteLength(id, 'utf8') <= 128;
const statusError: (status: number) => never = (status) => {
  throw new LocalMcpHttpError(status);
};

/** One local Streamable HTTP edge. SDK dispatch remains transport independent. */
export class LocalMcpHttpServer {
  private readonly sessions = new Map<string, Session>();
  private readonly sockets = new Set<Socket>();
  private readonly server: HttpServer;
  private stopping = false;
  private closePromise?: Promise<void>;
  private boundPort = 0;
  constructor(
    private readonly service: McpService,
    private readonly guard: LocalMcpAuthGuard,
    private readonly strictExecutionControls: boolean,
  ) {
    this.server = createServer(
      {
        maxHeaderSize: 16384,
        requestTimeout: 15000,
        headersTimeout: 5000,
        connectionsCheckingInterval: 1000,
      },
      (req, res) => {
        void this.handle(req, res).catch((error) =>
          this.reject(
            res,
            error instanceof LocalMcpHttpError ? error.status : 503,
          ),
        );
      },
    );
    this.server.keepAliveTimeout = 5000;
    this.server.maxConnections = 128;
    this.server.on('connection', (socket) => {
      this.sockets.add(socket);
      socket.once('close', () => this.sockets.delete(socket));
    });
    this.server.on('clientError', (_error, socket) => {
      socket.end(
        'HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n',
      );
    });
  }
  get port() {
    return this.boundPort;
  }
  /** Bounded counters only; useful to assert shutdown and cancellation ownership. */
  get diagnostics() {
    return {
      sessions: this.sessions.size,
      active: [...this.sessions.values()].reduce(
        (n, s) => n + s.active.size,
        0,
      ),
      sockets: this.sockets.size,
      listening: this.server.listening,
    };
  }
  async listen(port: number): Promise<void> {
    if (!Number.isInteger(port) || port < 0 || port > 65535) statusError(400);
    await new Promise<void>((resolve, reject) => {
      const error = () => {
        this.server.removeListener('listening', ready);
        reject(new Error('Local MCP listener unavailable'));
      };
      const ready = () => {
        this.server.removeListener('error', error);
        resolve();
      };
      this.server.once('error', error);
      this.server.once('listening', ready);
      this.server.listen(port, '127.0.0.1');
    });
    this.boundPort = (this.server.address() as { port: number }).port;
  }
  private reject(res: ServerResponse, status: number) {
    if (res.writableEnded || res.destroyed) return;
    if (res.headersSent) {
      res.destroy();
      return;
    }
    if (status === 401) res.setHeader('WWW-Authenticate', 'Bearer');
    if (status === 405) res.setHeader('Allow', 'POST, DELETE');
    res.writeHead(status, {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      connection: 'close',
    });
    res.end(JSON.stringify({ error: 'Local MCP request rejected' }));
  }
  private prune(credential?: LocalMcpCredential) {
    for (const [id, session] of this.sessions) {
      // A fresh credential proves this client's earlier generations are obsolete.
      // Retire idle sessions immediately, but keep admitted work and its quota.
      if (
        credential &&
        session.clientId === credential.id &&
        session.generation !== credential.generation
      )
        session.closing = true;
      if (
        !session.active.size &&
        (session.closing || performance.now() - session.touched >= LIMITS.idle)
      )
        this.sessions.delete(id);
    }
  }
  private session(
    req: IncomingMessage,
    credential: LocalMcpCredential,
  ): Session {
    const id = req.headers['mcp-session-id'];
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(id))
      statusError(400);
    const session = this.sessions.get(id);
    if (
      !session ||
      session.closing ||
      session.clientId !== credential.id ||
      session.principalId !== credential.principalId ||
      session.generation !== credential.generation
    )
      statusError(404);
    const version = req.headers['mcp-protocol-version'];
    if (
      typeof version !== 'string' ||
      version !== session.protocol ||
      !(PROTOCOLS as readonly string[]).includes(version)
    )
      statusError(400);
    session.touched = performance.now();
    return session;
  }
  private async body(req: IncomingMessage): Promise<any> {
    if (
      !/^application\/json(?:\s*;.*)?$/i.test(
        String(req.headers['content-type'] ?? ''),
      )
    )
      statusError(415);
    const accept = String(req.headers.accept ?? '')
      .split(',')
      .map((v) => v.trim().split(';')[0]);
    if (
      !accept.includes('application/json') ||
      !accept.includes('text/event-stream')
    )
      statusError(406);
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > LIMITS.body) statusError(413);
      chunks.push(chunk);
    }
    let value: any;
    try {
      value = JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)),
      );
    } catch {
      statusError(400);
    }
    if (
      !value ||
      Array.isArray(value) ||
      typeof value !== 'object' ||
      !JSONRPCMessageSchema.safeParse(value).success ||
      typeof value.method !== 'string' ||
      value.method.length > 128 ||
      ('id' in value && !validId(value.id))
    )
      statusError(400);
    return value;
  }
  private async handle(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    if (this.stopping) statusError(503);
    if (req.url !== '/mcp') statusError(404);
    this.guard.authenticate(req, this.port);
    this.prune();
    if (req.method === 'DELETE') {
      const session = this.session(
        req,
        this.guard.authenticate(req, this.port),
      );
      session.closing = true;
      for (const request of session.active.values()) request.cancel();
      this.prune();
      res.writeHead(200, { 'cache-control': 'no-store' }).end();
      return;
    }
    if (req.method !== 'POST') statusError(405);
    const message = await this.body(req);
    // Final credential read admits this request. Slow bodies cannot hold old authority.
    const credential = this.guard.authenticate(req, this.port);
    if (this.stopping) statusError(503);
    this.prune(credential);
    let session: Session;
    if (message.method === 'initialize') {
      if (
        !('id' in message) ||
        req.headers['mcp-session-id'] !== undefined ||
        !InitializeRequestSchema.safeParse(message).success
      )
        statusError(400);
      if (
        req.headers['mcp-protocol-version'] !== undefined &&
        !(PROTOCOLS as readonly unknown[]).includes(
          req.headers['mcp-protocol-version'],
        )
      )
        statusError(400);
      const owned = [...this.sessions.values()].filter(
        (s) => s.clientId === credential.id,
      ).length;
      if (
        this.sessions.size >= LIMITS.sessions ||
        owned >= LIMITS.clientSessions
      )
        statusError(429);
      const protocol = (PROTOCOLS as readonly string[]).includes(
        message.params.protocolVersion,
      )
        ? message.params.protocolVersion
        : PROTOCOLS[1];
      session = {
        id: randomBytes(32).toString('base64url'),
        clientId: credential.id,
        principalId: credential.principalId,
        generation: credential.generation,
        protocol,
        ready: false,
        initialized: false,
        closing: false,
        touched: performance.now(),
        seen: new Set(),
        active: new Map(),
      };
      this.sessions.set(session.id, session);
    } else {
      session = this.session(req, credential);
      if (!session.ready) statusError(400);
      if (
        message.method === 'notifications/initialized' &&
        !('id' in message)
      ) {
        session.initialized = true;
        res.writeHead(202, { 'cache-control': 'no-store' }).end();
        return;
      }
      if (!session.initialized) statusError(400);
      if (!('id' in message)) {
        if (
          message.method === 'notifications/cancelled' &&
          validId(message.params?.requestId)
        )
          session.active.get(idKey(message.params.requestId))?.cancel();
        res.writeHead(202, { 'cache-control': 'no-store' }).end();
        return;
      }
    }
    const key = idKey(message.id);
    if (session.seen.has(key) || session.seen.size >= LIMITS.ids)
      statusError(400);
    const active = [...this.sessions.values()].reduce(
      (n, s) => n + s.active.size,
      0,
    );
    const ownedActive = [...this.sessions.values()]
      .filter((s) => s.clientId === credential.id)
      .reduce((n, s) => n + s.active.size, 0);
    if (active >= LIMITS.active || ownedActive >= LIMITS.clientActive) {
      if (message.method === 'initialize') this.sessions.delete(session.id);
      statusError(429);
    }
    session.seen.add(key);
    await this.dispatch(message, session, credential, res);
  }
  private async dispatch(
    message: any,
    session: Session,
    credential: LocalMcpCredential,
    res: ServerResponse,
  ) {
    const key = idKey(message.id),
      controller = new AbortController();
    const context = this.guard.context(credential);
    // Controls are deliberately not sent to hosted or no-model adapters.
    if (this.strictExecutionControls)
      context.execution = {
        signal: controller.signal,
        deadline: performance.now() + 180000,
      };
    const sdk = this.service.createServer(context);
    if (message.method === 'initialize')
      sdk.setRequestHandler(InitializeRequestSchema, async () => ({
        protocolVersion: session.protocol,
        capabilities: { tools: {}, resources: {} },
        serverInfo: { name: 'context-router-local', version: '1.0.0' },
        instructions:
          'Use the registered preference tools within assigned permissions. schema://graphql describes compatibility types, not a local GraphQL endpoint. context-router://capabilities reports model capability and readiness; follow manual model readiness prerequisites first.',
      }));
    let resolve: () => void,
      completed = false,
      cancelled = false;
    const done = new Promise<void>((r) => {
      resolve = r;
    });
    const timer = setTimeout(() => {
      controller.abort();
      this.reject(res, 503);
    }, 185000);
    timer.unref();
    const finish = async () => {
      if (completed) return;
      completed = true;
      clearTimeout(timer);
      try {
        await sdk.close();
      } finally {
        session.active.delete(key);
        this.prune();
        resolve();
      }
    };
    session.active.set(key, {
      done,
      cancel: () => {
        if (completed || cancelled || message.method === 'initialize') return;
        cancelled = true;
        controller.abort();
        if (!res.writableEnded && !res.destroyed)
          res
            .writeHead(200, {
              'content-type': 'text/event-stream',
              'cache-control': 'no-store',
            })
            .end();
      },
    });
    let transportClosed = false;
    const transport: Transport = {
      start: async () => {},
      close: async () => {
        if (transportClosed) return;
        transportClosed = true;
        transport.onclose?.();
      },
      send: async (reply: JSONRPCMessage) => {
        if (
          !('id' in reply) ||
          idKey(reply.id as RequestId) !== key ||
          (!('result' in reply) && !('error' in reply))
        ) {
          controller.abort();
          this.reject(res, 503);
          throw new Error('Unsupported local MCP output');
        }
        if (completed) return;
        if (message.method === 'initialize') {
          session.ready = 'result' in reply;
          if (!session.ready) session.closing = true;
        }
        try {
          if (!cancelled && !res.writableEnded && !res.destroyed) {
            const safeReply =
              'error' in reply
                ? {
                    jsonrpc: '2.0',
                    id: message.id,
                    error: {
                      code: reply.error.code,
                      message: 'Invalid MCP request',
                    },
                  }
                : reply;
            const payload = JSON.stringify(safeReply);
            if (message.method === 'initialize' && session.ready)
              res.setHeader('Mcp-Session-Id', session.id);
            res
              .writeHead(200, {
                'content-type': 'application/json',
                'cache-control': 'no-store',
              })
              .end(payload);
          }
        } catch {
          session.closing = true;
          this.reject(res, 503);
        } finally {
          // A matching terminal reply witnesses handler completion even if publication fails.
          await finish();
        }
      },
    };
    try {
      await sdk.connect(transport);
      transport.onmessage!(message);
    } catch {
      this.reject(res, 503);
      session.closing = true;
      await finish();
    }
    // A disconnect does not cancel work. Terminal SDK output still owns completion.
    await done;
  }
  close(): Promise<void> {
    return (this.closePromise ??= (async () => {
      this.stopping = true;
      const closed = new Promise<void>((resolve) =>
        this.server.close(() => resolve()),
      );
      const pending: Promise<void>[] = [];
      for (const session of this.sessions.values()) {
        session.closing = true;
        for (const active of session.active.values()) {
          active.cancel();
          pending.push(active.done);
        }
      }
      await Promise.all(pending);
      for (const socket of this.sockets) socket.destroy();
      await closed;
      this.sessions.clear();
    })());
  }
}
