import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import {
  assertRoot,
  pin,
  privateRoot,
  regular,
  samePin,
  syncDirectory,
  type FilePin,
  type RootPin,
} from '../infrastructure/storage/sqlite/sqlite-files';

const UNLOCK_TTL = 300_000;
const SESSION_TTL = 8 * 60 * 60 * 1000;
const MAX_SESSIONS = 32;
const unavailable = (): never => {
  throw new Error('Local UI session unavailable');
};
const hash = (value: string) => createHash('sha256').update(value).digest();
const key = (value: string) => hash(value).toString('hex');
function valid(value: unknown, prefix: string): value is string {
  if (typeof value !== 'string' || !value.startsWith(prefix)) return false;
  const secret = value.slice(prefix.length);
  return (
    /^[A-Za-z0-9_-]{43}$/.test(secret) &&
    Buffer.from(secret, 'base64url').toString('base64url') === secret
  );
}
type Session = {
  expires: number;
  timer: ReturnType<typeof setTimeout>;
  requests: Set<AbortController>;
};
type Bootstrap = {
  digest: Buffer;
  expires: number;
  file: string;
  root: RootPin;
  pin: FilePin;
  timer: ReturnType<typeof setTimeout>;
};

/** Ephemeral browser authority only. No human, MCP or inference secret is accepted. */
export class LocalUiSessions {
  private readonly sessions = new Map<string, Session>();
  private bootstrap?: Bootstrap;
  private closed = false;
  private readonly now: () => number;
  constructor(
    private readonly options: {
      principalId: string;
      exportRoot: string;
      excludedRoots: readonly string[];
      now?: () => number;
    },
  ) {
    this.now = options.now ?? (() => performance.now());
  }

  /** Validate before application/model acquisition, and again at each delivery. */
  validateExportRoot(): RootPin {
    if (this.closed) unavailable();
    try {
      const destination = this.options.exportRoot;
      if (
        !path.isAbsolute(destination) ||
        path.resolve(destination) !== destination ||
        destination.length > 4096 ||
        /[\u0000-\u001f\u007f]/u.test(destination)
      )
        unavailable();
      for (const excluded of this.options.excludedRoots) {
        const relative = path.relative(destination, excluded);
        const reverse = path.relative(excluded, destination);
        if (
          !relative ||
          (!relative.startsWith('..' + path.sep) && relative !== '..') ||
          (!reverse.startsWith('..' + path.sep) && reverse !== '..')
        )
          unavailable();
      }
      return privateRoot(destination);
    } catch {
      return unavailable();
    }
  }

  /** Delivery is exclusive and durable before replacing the current bootstrap. */
  issue(): { path: string; expiresInSeconds: number } {
    let root: RootPin, file: string, owned: FilePin;
    try {
      root = this.validateExportRoot();
      file = path.join(this.options.exportRoot, `unlock-${randomUUID()}.token`);
      const token = `cr_ui_unlock_${randomBytes(32).toString('base64url')}`;
      const fd = fs.openSync(
        file,
        fs.constants.O_CREAT |
          fs.constants.O_EXCL |
          fs.constants.O_WRONLY |
          fs.constants.O_NOFOLLOW,
        0o600,
      );
      try {
        owned = pin(fs.fstatSync(fd));
        fs.writeFileSync(fd, token + '\n');
        fs.fsyncSync(fd);
        assertRoot(root);
        if (!samePin(regular(file), owned)) unavailable();
      } finally {
        fs.closeSync(fd);
      }
      syncDirectory(root);
      const bootstrap: Bootstrap = {
        digest: hash(token),
        expires: this.now() + UNLOCK_TTL,
        file,
        root,
        pin: owned,
        timer: undefined,
      };
      this.forgetBootstrap();
      this.bootstrap = bootstrap;
      this.armBootstrap(bootstrap);
      return { path: file, expiresInSeconds: UNLOCK_TTL / 1000 };
    } catch {
      if (root && file && owned) this.removeOwnedFile(root, file, owned);
      return unavailable();
    }
  }

  exchange(supplied: unknown): string | null {
    this.expireBootstrap();
    if (this.closed || !this.bootstrap || !valid(supplied, 'cr_ui_unlock_'))
      return null;
    if (!timingSafeEqual(hash(supplied), this.bootstrap.digest)) return null;
    this.sweep();
    if (this.sessions.size >= MAX_SESSIONS)
      throw new Error('Local UI session capacity');
    const token = `cr_ui_session_${randomBytes(32).toString('base64url')}`;
    const id = key(token);
    const session: Session = {
      expires: this.now() + SESSION_TTL,
      requests: new Set(),
      timer: undefined,
    };
    this.forgetBootstrap(); // synchronous consumption: a second exchange cannot succeed
    this.sessions.set(id, session);
    this.armSession(id, session);
    return token;
  }

  authenticate(token: unknown): string | null {
    if (this.closed || !valid(token, 'cr_ui_session_')) return null;
    const id = key(token);
    this.expireSession(id);
    return this.sessions.has(id) ? this.options.principalId : null;
  }

  remainingMilliseconds(token: unknown): number | null {
    if (!this.authenticate(token)) return null;
    return Math.max(
      0,
      Math.floor(this.sessions.get(key(token as string)).expires - this.now()),
    );
  }

  track(token: string, controller: AbortController): () => void {
    if (!this.authenticate(token)) unavailable();
    const session = this.sessions.get(key(token));
    session.requests.add(controller);
    return () => session.requests.delete(controller);
  }

  logout(token: unknown): boolean {
    if (!valid(token, 'cr_ui_session_')) return false;
    return this.revoke(key(token));
  }

  close(): void {
    this.closed = true;
    this.forgetBootstrap();
    for (const id of this.sessions.keys()) this.revoke(id);
  }

  private sweep(): void {
    for (const id of this.sessions.keys()) this.expireSession(id);
  }
  private armSession(id: string, session: Session): void {
    session.timer = setTimeout(
      () => {
        this.expireSession(id);
        if (this.sessions.get(id) === session) this.armSession(id, session);
      },
      Math.max(1, Math.ceil(session.expires - this.now())),
    );
    session.timer.unref?.();
  }
  private armBootstrap(bootstrap: Bootstrap): void {
    bootstrap.timer = setTimeout(
      () => {
        if (this.bootstrap !== bootstrap) return;
        this.expireBootstrap();
        if (this.bootstrap === bootstrap) this.armBootstrap(bootstrap);
      },
      Math.max(1, Math.ceil(bootstrap.expires - this.now())),
    );
    bootstrap.timer.unref?.();
  }
  private expireSession(id: string): void {
    const session = this.sessions.get(id);
    if (session && this.now() >= session.expires) this.revoke(id);
  }
  private expireBootstrap(): void {
    if (this.bootstrap && this.now() >= this.bootstrap.expires)
      this.forgetBootstrap();
  }
  private revoke(id: string): boolean {
    const session = this.sessions.get(id);
    if (!session) return false;
    this.sessions.delete(id);
    clearTimeout(session.timer);
    for (const controller of session.requests) controller.abort();
    session.requests.clear();
    return true;
  }
  private forgetBootstrap(): void {
    const bootstrap = this.bootstrap;
    if (!bootstrap) return;
    this.bootstrap = undefined;
    clearTimeout(bootstrap.timer);
    bootstrap.digest.fill(0);
    this.removeOwnedFile(bootstrap.root, bootstrap.file, bootstrap.pin);
  }
  private removeOwnedFile(root: RootPin, file: string, owned: FilePin): void {
    // Lost path ownership never authorizes deleting the replacement file/root.
    try {
      assertRoot(root);
      if (!samePin(regular(file), owned)) return;
      fs.unlinkSync(file);
      syncDirectory(root);
    } catch {
      /* Expiry/revocation remains authoritative even if delivery cleanup fails. */
    }
  }
}
