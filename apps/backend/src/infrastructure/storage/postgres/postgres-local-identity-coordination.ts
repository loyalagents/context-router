import type { LocalIdentityCoordination, LocalIdentitySession } from '@/domains/shared/storage/local-identity-coordination';
import { Client, type ClientConfig, type QueryResultRow } from 'pg';

import { createSyntheticPrincipalEmail } from '@modules/auth/principal-identity';
import {
  type LocalIdentityState,
  encodeLocalIdentityState,
} from '@modules/auth/local-identity-state.codec';

export const LOCAL_IDENTITY_ADVISORY_KEY = [36_541_118, 1_879_950_420] as const;
export const LOCAL_IDENTITY_ADVISORY_LOCK_SQL =
  'SELECT pg_try_advisory_lock($1::int, $2::int) AS locked';
export const LOCAL_IDENTITY_ADVISORY_UNLOCK_SQL =
  'SELECT pg_advisory_unlock($1::int, $2::int) AS unlocked';

const LOCK_USERS_SQL = 'LOCK TABLE public.users IN SHARE ROW EXCLUSIVE MODE';
const LOCK_EXTERNAL_IDENTITIES_SQL =
  'LOCK TABLE public.external_identities IN SHARE ROW EXCLUSIVE MODE';
const READ_USERS_SQL =
  'SELECT user_id FROM public.users ORDER BY user_id COLLATE "C" LIMIT 2';
const READ_IDENTITIES_SQL =
  'SELECT DISTINCT user_id COLLATE "C" AS user_id FROM public.external_identities ORDER BY user_id LIMIT 2';
const INSERT_USER_SQL =
  'INSERT INTO public.users (user_id, email, created_at, updated_at) VALUES ($1, $2, NOW(), NOW())';
const CLOSE_DEADLINE_MS = 1_000;

export interface LocalIdentityQueryResult<
  Row extends QueryResultRow = QueryResultRow,
> {
  rows: Row[];
  rowCount: number | null;
}

export interface LocalIdentityDatabaseClient {
  connect(): Promise<void>;
  query(
    text: string,
    values?: readonly unknown[],
  ): Promise<LocalIdentityQueryResult>;
  end(): Promise<void>;
  destroy(): void;
  assertHealthy(): void;
}

export interface LocalIdentityDatabaseClock {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

const SYSTEM_DATABASE_CLOCK: LocalIdentityDatabaseClock = {
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (handle) =>
    clearTimeout(handle as ReturnType<typeof setTimeout>),
};

class PgLocalIdentityDatabaseClient implements LocalIdentityDatabaseClient {
  private readonly client: Client;
  private connected = false;
  private closing = false;
  private lost = false;

  constructor(configuration: ClientConfig) {
    this.client = new Client(configuration);
    this.client.on('error', () => {
      this.lost = true;
    });
    this.client.on('end', () => {
      if (!this.closing) this.lost = true;
      this.connected = false;
    });
  }

  async connect(): Promise<void> {
    await this.client.connect();
    this.connected = true;
  }

  async query(
    text: string,
    values?: readonly unknown[],
  ): Promise<LocalIdentityQueryResult> {
    const result = await this.client.query<QueryResultRow>(
      text,
      values as unknown[],
    );
    return { rows: result.rows, rowCount: result.rowCount };
  }

  async end(): Promise<void> {
    this.closing = true;
    try {
      await this.client.end();
    } finally {
      this.connected = false;
    }
  }

  destroy(): void {
    this.lost = true;
    this.connected = false;
    const connection = (
      this.client as unknown as {
        connection?: { stream?: { destroy(): void } };
      }
    ).connection;
    connection?.stream?.destroy();
  }

  assertHealthy(): void {
    if (!this.connected || this.lost || this.closing) {
      throw new Error('Local identity database connection lost');
    }
  }
}

export function createLocalIdentityDatabaseClient(
  configuration: ClientConfig,
): LocalIdentityDatabaseClient {
  return new PgLocalIdentityDatabaseClient(configuration);
}

export type LocalIdentityClientFactory = (
  configuration: ClientConfig,
) => LocalIdentityDatabaseClient;

class DatabaseStateConflict extends Error {}

function fixedError(message: string): Error {
  return new Error(message);
}

function isDatabaseDeadline(error: unknown): boolean {
  const candidate = error as { code?: unknown; message?: unknown };
  return (
    candidate?.code === '57014' ||
    candidate?.code === '55P03' ||
    (typeof candidate?.message === 'string' &&
      /(?:query read )?time(?:d out|out)|deadline/iu.test(candidate.message))
  );
}

async function bounded<T>(options: {
  operation: Promise<T>;
  deadlineMs: number;
  onDeadline(): void;
  deadlineMessage: string;
  clock: LocalIdentityDatabaseClock;
}): Promise<T> {
  let timer: unknown;
  let timerScheduled = false;
  try {
    return await Promise.race([
      options.operation,
      new Promise<T>((_resolve, reject) => {
        timer = options.clock.setTimeout(() => {
          options.onDeadline();
          reject(fixedError(options.deadlineMessage));
        }, options.deadlineMs);
        timerScheduled = true;
      }),
    ]);
  } finally {
    if (timerScheduled) options.clock.clearTimeout(timer);
  }
}

export class PostgresLocalIdentityCoordination implements LocalIdentityCoordination {
  private readonly clientConfig: ClientConfig;
  private readonly clientFactory: LocalIdentityClientFactory;
  private readonly deadlineMs: number;
  private readonly clock: LocalIdentityDatabaseClock;

  constructor(options: {
    clientConfig: ClientConfig;
    clientFactory?: LocalIdentityClientFactory;
    deadlineMs?: number;
    clock?: LocalIdentityDatabaseClock;
  }) {
    this.clientConfig = options.clientConfig;
    this.clientFactory =
      options.clientFactory ?? createLocalIdentityDatabaseClient;
    this.deadlineMs = options.deadlineMs ?? 15_000;
    this.clock = options.clock ?? SYSTEM_DATABASE_CLOCK;
    if (!Number.isSafeInteger(this.deadlineMs) || this.deadlineMs < 1) {
      throw fixedError('Invalid local identity database deadline');
    }
  }

  async acquire(): Promise<LocalIdentityDatabaseSession> {
    const client = this.clientFactory(this.clientConfig);
    let destroyed = false;
    const destroy = () => {
      if (destroyed) return;
      destroyed = true;
      client.destroy();
    };
    try {
      await bounded({
        operation: client.connect(),
        deadlineMs: this.deadlineMs,
        onDeadline: destroy,
        deadlineMessage: 'Local identity database deadline exceeded',
        clock: this.clock,
      });
      const result = await bounded({
        operation: client.query(
          LOCAL_IDENTITY_ADVISORY_LOCK_SQL,
          LOCAL_IDENTITY_ADVISORY_KEY,
        ),
        deadlineMs: this.deadlineMs,
        onDeadline: destroy,
        deadlineMessage: 'Local identity database deadline exceeded',
        clock: this.clock,
      });
      if (result.rows.length !== 1 || result.rows[0]?.locked !== true) {
        await bounded({
          operation: client.end(),
          deadlineMs: Math.min(this.deadlineMs, CLOSE_DEADLINE_MS),
          onDeadline: destroy,
          deadlineMessage: 'Local identity database deadline exceeded',
          clock: this.clock,
        }).catch(destroy);
        throw fixedError('Local identity operation busy');
      }
      return new LocalIdentityDatabaseSession(
        client,
        this.deadlineMs,
        destroy,
        this.clock,
      );
    } catch (error) {
      if ((error as Error)?.message === 'Local identity operation busy') {
        throw error;
      }
      destroy();
      if (
        (error as Error)?.message ===
        'Local identity database deadline exceeded'
      ) {
        throw error;
      }
      throw fixedError('Local identity database unavailable');
    }
  }
}

interface UserRow extends QueryResultRow {
  user_id: string;
}

interface ExternalIdentityRow extends QueryResultRow {
  user_id: string;
}

export class LocalIdentityDatabaseSession implements LocalIdentitySession {
  private active = true;
  private destroyed = false;
  private transactionOpen = false;
  private commitAttempted = false;

  constructor(
    private readonly client: LocalIdentityDatabaseClient,
    private readonly deadlineMs: number,
    private readonly destroyClient: () => void,
    private readonly clock: LocalIdentityDatabaseClock,
  ) {}

  async initialize(
    state: LocalIdentityState,
    afterValidation?: (outcome: 'inserted' | 'matched') => Promise<void>,
  ): Promise<'inserted' | 'matched'> {
    encodeLocalIdentityState(state);
    return this.transaction(async () => {
      const snapshot = await this.readLockedSnapshot();
      const email = createSyntheticPrincipalEmail(state.principalId);
      if (snapshot.users.length === 0) {
        if (snapshot.identities.length !== 0) {
          throw new DatabaseStateConflict();
        }
        await afterValidation?.('inserted');
        const inserted = await this.query(INSERT_USER_SQL, [
          state.principalId,
          email,
        ]);
        if (inserted.rowCount !== 1 || inserted.rows.length !== 0) {
          throw new DatabaseStateConflict();
        }
        return 'inserted' as const;
      }
      this.assertExactPrincipal(snapshot.users, state.principalId);
      this.assertIdentityOwners(snapshot.identities, state.principalId);
      await afterValidation?.('matched');
      return 'matched' as const;
    });
  }

  async verify(
    state: LocalIdentityState,
    afterValidation?: () => Promise<void>,
  ): Promise<void> {
    encodeLocalIdentityState(state);
    await this.transaction(async () => {
      const snapshot = await this.readLockedSnapshot();
      this.assertExactPrincipal(snapshot.users, state.principalId);
      this.assertIdentityOwners(snapshot.identities, state.principalId);
      await afterValidation?.();
    });
  }

  async verifyEmpty(afterValidation?: () => Promise<void>): Promise<void> {
    await this.transaction(async () => {
      const snapshot = await this.readLockedSnapshot();
      if (snapshot.users.length !== 0 || snapshot.identities.length !== 0) {
        throw new DatabaseStateConflict();
      }
      await afterValidation?.();
    });
  }

  async release(): Promise<void> {
    if (!this.active) return;
    try {
      const result = await this.query<{ unlocked: boolean }>(
        LOCAL_IDENTITY_ADVISORY_UNLOCK_SQL,
        LOCAL_IDENTITY_ADVISORY_KEY,
      );
      if (result.rows.length !== 1 || result.rows[0]?.unlocked !== true) {
        throw fixedError('Local identity database lock release failed');
      }
      await bounded({
        operation: this.client.end(),
        deadlineMs: this.deadlineMs,
        onDeadline: () => this.forceDestroy(),
        deadlineMessage: 'Local identity database deadline exceeded',
        clock: this.clock,
      });
      this.active = false;
    } catch (error) {
      const recoveryRequired = this.commitAttempted;
      this.forceDestroy();
      if (recoveryRequired) {
        throw fixedError('Local identity recovery required');
      }
      if (
        (error as Error)?.message ===
        'Local identity database deadline exceeded'
      ) {
        throw error;
      }
      throw fixedError('Local identity database lock release failed');
    }
  }

  destroy(): void {
    this.forceDestroy();
  }

  assertHeld(): void {
    this.assertActive();
    try {
      this.client.assertHealthy();
    } catch {
      const recoveryRequired = this.commitAttempted;
      this.forceDestroy();
      throw fixedError(
        recoveryRequired
          ? 'Local identity recovery required'
          : 'Local identity database unavailable',
      );
    }
  }

  private forceDestroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.active = false;
    this.transactionOpen = false;
    this.destroyClient();
  }

  private async transaction<T>(operation: () => Promise<T>): Promise<T> {
    this.assertActive();
    this.commitAttempted = false;
    await this.query('BEGIN');
    this.transactionOpen = true;
    try {
      await this.query(LOCK_USERS_SQL);
      await this.query(LOCK_EXTERNAL_IDENTITIES_SQL);
      const result = await operation();
      this.commitAttempted = true;
      try {
        await this.query('COMMIT');
      } catch {
        this.destroy();
        throw fixedError('Local identity recovery required');
      }
      this.transactionOpen = false;
      return result;
    } catch (error) {
      if (this.commitAttempted) throw error;
      if (!this.active) throw error;
      try {
        await this.query('ROLLBACK');
      } catch (rollbackError) {
        this.destroy();
        if (
          (rollbackError as Error)?.message ===
          'Local identity database deadline exceeded'
        ) {
          throw rollbackError;
        }
        throw fixedError('Local identity database unavailable');
      }
      this.transactionOpen = false;
      if (error instanceof DatabaseStateConflict) {
        throw fixedError('Local identity database state conflict');
      }
      throw error;
    }
  }

  private async readLockedSnapshot(): Promise<{
    users: UserRow[];
    identities: ExternalIdentityRow[];
  }> {
    const users = await this.query<UserRow>(READ_USERS_SQL);
    const identities =
      await this.query<ExternalIdentityRow>(READ_IDENTITIES_SQL);
    if (
      users.rows.some((row) => typeof row.user_id !== 'string') ||
      identities.rows.some((row) => typeof row.user_id !== 'string')
    ) {
      throw new DatabaseStateConflict();
    }
    return { users: users.rows, identities: identities.rows };
  }

  private assertIdentityOwners(
    rows: ExternalIdentityRow[],
    principalId: string,
  ): void {
    if (rows.some((row) => row.user_id !== principalId)) {
      throw new DatabaseStateConflict();
    }
  }

  private assertExactPrincipal(rows: UserRow[], principalId: string): void {
    if (rows.length !== 1 || rows[0].user_id !== principalId) {
      throw new DatabaseStateConflict();
    }
  }

  private assertActive(): void {
    if (!this.active) {
      throw fixedError('Local identity database session is closed');
    }
  }

  private async query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<LocalIdentityQueryResult<Row>> {
    this.assertHeld();
    try {
      return await bounded({
        operation: this.client.query(text, values) as Promise<
          LocalIdentityQueryResult<Row>
        >,
        deadlineMs: this.deadlineMs,
        onDeadline: () => this.forceDestroy(),
        deadlineMessage: 'Local identity database deadline exceeded',
        clock: this.clock,
      });
    } catch (error) {
      this.forceDestroy();
      if (isDatabaseDeadline(error)) {
        throw fixedError('Local identity database deadline exceeded');
      }
      throw fixedError('Local identity database unavailable');
    }
  }
}
