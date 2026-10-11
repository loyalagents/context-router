import { Server, IncomingMessage, type ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import { randomBytes } from 'node:crypto';
import { ExpressAdapter } from '@nestjs/platform-express';
import { UnauthorizedException } from '@nestjs/common';
import type { AiCapabilityProvider } from '../domains/shared/ports/ai-execution';
import { LocalUiSessions } from './local-ui-sessions';
import {
  readBrowserBearer,
  UI_EXECUTION,
  UI_REVALIDATE,
  UI_UPLOAD_POLICY,
  type LocalUiRequest,
} from './local-ui-request';
import type { LocalUiAiPolicy } from './local-ui-ai';
import { LocalUiManagement } from './local-ui-management';

export type LocalUiWebHandler = (
  req: IncomingMessage,
  res: ServerResponse,
) => Promise<void> | void;
const pages = new Set([
  '/',
  '/dashboard',
  '/dashboard/profile',
  '/dashboard/preferences',
  '/dashboard/schema',
  '/dashboard/history',
  '/dashboard/permissions',
  '/dashboard/form-fill',
]);
const apiRoutes = new Set([
  '/graphql',
  '/api/preferences/analysis',
  '/api/form-fill/pdf',
  '/api/local/unlock',
  '/api/local/logout',
  '/api/local/capabilities',
  '/api/local/session',
  '/api/local/mcp/list',
  '/api/local/mcp/inspect',
  '/api/local/mcp/grant',
  '/api/local/mcp/revoke',
]);
const securityHeaders = new Set([
  'host',
  'origin',
  'authorization',
  'content-type',
  'content-length',
  'transfer-encoding',
  'x-context-router-ui',
  'x-context-router-timeout-ms',
]);
const jsonLimit = 256 * 1024;
const uploadLimit = 10 * 1024 * 1024 + 64 * 1024;

/** Count parser input without adding a flowing-mode listener before Multer owns it. */
class LocalBrowserRequest extends IncomingMessage {
  bodyBytes = 0;
  bodyLimit = Infinity;
  onBodyLimit?: () => void;
  constructor(socket: Socket) {
    super(socket);
    // Express replaces the request prototype before middleware runs. Keep the
    // parser hook on the instance so every byte is counted across that change.
    Object.defineProperty(this, 'push', {
      value: LocalBrowserRequest.prototype.push,
    });
  }
  override push(chunk: any, encoding?: BufferEncoding): boolean {
    if (chunk !== null) this.bodyBytes += Buffer.byteLength(chunk, encoding);
    if (this.bodyBytes > this.bodyLimit) {
      this.onBodyLimit?.();
      return false;
    }
    return super.push(chunk, encoding);
  }
}

/** Reject raw protocols even after Next adds upgrade listeners to this same server. */
class LocalBrowserServer extends Server {
  readonly sockets = new Set<Socket>();
  override emit(event: string, ...args: any[]): boolean {
    if (event === 'upgrade' || event === 'connect') {
      (args[1] as Socket).destroy();
      return true;
    }
    return super.emit(event, ...args);
  }
}
export class LocalUiHttpAdapter extends ExpressAdapter {
  override initHttpServer(): void {
    const server = new LocalBrowserServer(
      {
        IncomingMessage: LocalBrowserRequest,
        maxHeaderSize: 16 * 1024,
        headersTimeout: 10000,
        requestTimeout: 15000,
        connectionsCheckingInterval: 1000,
      },
      this.getInstance(),
    );
    server.maxHeadersCount = 64;
    server.maxConnections = 64;
    server.maxRequestsPerSocket = 100;
    server.keepAliveTimeout = 2000;
    server.on('connection', (socket: Socket) => {
      server.sockets.add(socket);
      socket.once('close', () => server.sockets.delete(socket));
    });
    server.on('upgrade', () => {}); // Ensure Node routes upgrades through the closed protocol boundary.
    server.on('connect', () => {});
    server.on('checkContinue', (_req, res) => {
      res.writeHead(417, { connection: 'close' });
      res.end();
    });
    server.on('checkExpectation', (_req, res) => {
      res.writeHead(417, { connection: 'close' });
      res.end();
    });
    server.on('clientError', (_error, socket) => socket.destroy());
    this.httpServer = server;
  }
}

function reply(res: ServerResponse, status: number, body: unknown): void {
  if (res.destroyed || res.writableEnded) return;
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
}
export const rejectUiRequest = (res: ServerResponse, status = 400) => {
  if (!res.headersSent) res.setHeader('connection', 'close');
  reply(res, status, { error: 'Local UI request rejected' });
};

export class LocalUiBoundary {
  private active = 0;
  private controls = 0;
  private unlocks = 0;
  private closed = false;
  constructor(
    private readonly sessions: LocalUiSessions,
    private readonly server: Server,
    private readonly ai: AiCapabilityProvider,
    private readonly web: LocalUiWebHandler,
    private readonly management?: LocalUiManagement,
    private readonly aiPolicy?: LocalUiAiPolicy,
  ) {}

  middleware = (
    req: LocalUiRequest,
    res: ServerResponse,
    next: () => void,
  ): void => {
    void this.handle(req, res, next).catch((error) =>
      rejectUiRequest(
        res,
        [401, 409].includes(error?.getStatus?.()) ? error.getStatus() : 400,
      ),
    );
  };
  close(): void {
    this.closed = true;
    this.sessions.close();
  }

  private async handle(
    req: LocalUiRequest,
    res: ServerResponse,
    next: () => void,
  ): Promise<void> {
    res.setHeader('cache-control', 'no-store');
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('referrer-policy', 'no-referrer');
    res.setHeader('cross-origin-opener-policy', 'same-origin');
    res.setHeader('x-frame-options', 'DENY');
    if (this.closed) return rejectUiRequest(res, 503);
    const bound = this.server.address();
    if (!bound || typeof bound === 'string') return rejectUiRequest(res, 503);
    const host = `127.0.0.1:${bound.port}`,
      origin = `http://${host}`;
    const seen = new Set<string>();
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      const name = req.rawHeaders[i].toLowerCase();
      if (securityHeaders.has(name) && seen.has(name))
        return rejectUiRequest(res);
      seen.add(name);
    }
    if (
      req.headers.host !== host ||
      req.headers['x-forwarded-host'] !== undefined ||
      req.headers['x-forwarded-for'] !== undefined ||
      req.headers.forwarded !== undefined ||
      req.headers['x-forwarded-proto'] !== undefined
    )
      return rejectUiRequest(res, 403);
    const route = req.url ?? '';
    if (
      !route.startsWith('/') ||
      route.startsWith('//') ||
      /[%\\\u0000-\u0020\u007f]/u.test(route)
    )
      return rejectUiRequest(res);
    const pathname = route.split('?')[0];
    const page = pages.has(pathname);
    const asset =
      /^\/_next\/static\/[A-Za-z0-9_./@+-]+$/.test(pathname) &&
      !pathname.split('/').includes('..');
    if ((page || asset) && (req.method === 'GET' || req.method === 'HEAD')) {
      if (req.headers.origin !== undefined && req.headers.origin !== origin)
        return rejectUiRequest(res, 403);
      if (
        route.includes('?') &&
        !/^\?_rsc=[A-Za-z0-9_-]{1,64}$/.test(route.slice(pathname.length))
      )
        return rejectUiRequest(res);
      const nonce = randomBytes(18).toString('base64');
      const csp = `default-src 'self'; script-src 'self' 'nonce-${nonce}'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data: blob:; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`;
      // Next reads the request policy to nonce its own inline hydration scripts.
      req.headers['content-security-policy'] = csp;
      res.setHeader('content-security-policy', csp);
      await this.web(req, res);
      return;
    }
    if (!apiRoutes.has(route)) return rejectUiRequest(res, 404);
    if (req.method !== 'POST') return rejectUiRequest(res, 405);
    if (
      req.headers.origin !== origin ||
      req.headers['x-context-router-ui'] !== '1'
    )
      return rejectUiRequest(res, 403);
    const requestedTimeout = req.headers['x-context-router-timeout-ms'];
    if (
      requestedTimeout !== undefined &&
      (typeof requestedTimeout !== 'string' ||
        !/^[1-9][0-9]{0,5}$/.test(requestedTimeout) ||
        Number(requestedTimeout) > 180000)
    )
      return rejectUiRequest(res);
    const timeout =
      requestedTimeout === undefined ? 180000 : Number(requestedTimeout);
    const upload =
      route === '/api/preferences/analysis' || route === '/api/form-fill/pdf';
    const type = req.headers['content-type'];
    if (
      typeof type !== 'string' ||
      (upload
        ? !/^multipart\/form-data;\s*boundary=[^\r\n]{1,200}$/i.test(type)
        : !/^application\/json(?:;\s*charset=utf-8)?$/i.test(type))
    )
      return rejectUiRequest(res, 415);
    const control =
      route === '/api/local/unlock' || route === '/api/local/logout';
    const limit = upload ? uploadLimit : control ? 4096 : jsonLimit;
    const length = req.headers['content-length'];
    if (
      length !== undefined &&
      (!/^(0|[1-9][0-9]*)$/.test(length) || Number(length) > limit)
    )
      return rejectUiRequest(res, 413);
    const token = readBrowserBearer(req);
    if (route !== '/api/local/unlock' && !this.sessions.authenticate(token))
      return rejectUiRequest(res, 401);
    const unlock = route === '/api/local/unlock';
    if (
      unlock
        ? this.unlocks >= 8
        : control
          ? this.controls >= 8
          : this.active >= 32
    )
      return rejectUiRequest(res, 429);
    if (unlock) this.unlocks++;
    else if (control) this.controls++;
    else this.active++;
    const abort = new AbortController();
    const release =
      token && route !== '/api/local/unlock'
        ? this.sessions.track(token, abort)
        : () => {};
    let finished = false;
    const body = req as LocalUiRequest & LocalBrowserRequest;
    let bodyRejected = false;
    const rejectBody = () => {
      if (bodyRejected) return;
      bodyRejected = true;
      abort.abort();
      res.once('finish', () => req.destroy());
      rejectUiRequest(res, 413);
    };
    body.bodyLimit = limit;
    body.onBodyLimit = rejectBody;
    if (!unlock)
      req[UI_REVALIDATE] = () => {
        if (abort.signal.aborted || !this.sessions.authenticate(token))
          throw new UnauthorizedException('Local browser session unavailable');
      };
    const bodyTimer = setTimeout(() => {
      rejectUiRequest(res, 408);
      req.destroy();
    }, 15000);
    bodyTimer.unref?.();
    const bodyDone = () => clearTimeout(bodyTimer);
    const interrupted = () => abort.abort();
    const prematureClose = () => {
      if (!res.writableFinished) interrupted();
      cleanup();
    };
    const deadline = performance.now() + timeout;
    const executionTimer = setTimeout(() => {
      abort.abort();
      rejectUiRequest(res, 504);
    }, timeout);
    executionTimer.unref?.();
    const cleanup = () => {
      if (finished) return;
      finished = true;
      if (unlock) this.unlocks--;
      else if (control) this.controls--;
      else this.active--;
      clearTimeout(bodyTimer);
      clearTimeout(executionTimer);
      release();
      body.onBodyLimit = undefined;
      req.off('end', bodyDone);
      req.off('aborted', interrupted);
      res.off('finish', cleanup);
      res.off('close', prematureClose);
    };
    req.once('end', bodyDone);
    req.once('aborted', interrupted);
    res.once('finish', cleanup);
    res.once('close', prematureClose);
    if (body.bodyBytes > limit) return rejectBody();
    if (
      this.aiPolicy?.strictExecutionControls ??
      this.ai.capabilities.strictExecutionControls
    )
      Object.defineProperty(req, UI_EXECUTION, {
        value: Object.freeze({ signal: abort.signal, deadline }),
      });
    if (this.aiPolicy)
      Object.defineProperty(req, UI_UPLOAD_POLICY, { value: this.aiPolicy });
    if (
      control ||
      route === '/api/local/capabilities' ||
      route === '/api/local/session' ||
      route.startsWith('/api/local/mcp/')
    ) {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        if (
          (req as LocalUiRequest & LocalBrowserRequest).bodyBytes > limit
        )
          return;
        if (abort.signal.aborted) return rejectUiRequest(res, 401);
        chunks.push(Buffer.from(chunk));
      }
      if (res.writableEnded || res.destroyed) return;
      let body: any;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        return rejectUiRequest(res);
      }
      if (!body || typeof body !== 'object' || Array.isArray(body))
        return rejectUiRequest(res);
      if (route.startsWith('/api/local/mcp/')) {
        req[UI_REVALIDATE]();
        if (!this.management) return rejectUiRequest(res, 503);
        const result = await this.management.handle(route, body);
        req[UI_REVALIDATE]();
        reply(res, 200, result);
        return;
      }
      if (route === '/api/local/unlock') {
        if (Object.keys(body).join() !== 'bootstrap')
          return rejectUiRequest(res);
        try {
          const session = this.sessions.exchange(body.bootstrap);
          if (!session) return rejectUiRequest(res, 401);
          reply(res, 200, { token: session, expiresInSeconds: 8 * 60 * 60 });
        } catch {
          rejectUiRequest(res, 429);
        }
      } else {
        if (!this.sessions.authenticate(token))
          return rejectUiRequest(res, 401);
        if (Object.keys(body).length) return rejectUiRequest(res);
        if (route === '/api/local/logout') {
          this.sessions.logout(token);
          reply(res, 200, { loggedOut: true });
        } else {
          const status = route === '/api/local/capabilities'
            ? await this.ai.getStatus(req[UI_EXECUTION]) : undefined;
          req[UI_REVALIDATE]();
          const remainingMilliseconds =
            this.sessions.remainingMilliseconds(token);
          if (remainingMilliseconds === null) return rejectUiRequest(res, 401);
          reply(res, 200, route === '/api/local/session' ? { remainingMilliseconds } : {
            capabilities: this.ai.capabilities,
            status,
            remainingMilliseconds,
            operations: this.aiPolicy,
          });
        }
      }
      return;
    }
    next(); // Nest parsers/guards revalidate this same independent session at use-case admission.
  }
}
