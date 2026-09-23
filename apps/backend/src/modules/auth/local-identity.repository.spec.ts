import type { ClientConfig } from 'pg';

import {
  LOCAL_IDENTITY_ADVISORY_KEY,
  LOCAL_IDENTITY_ADVISORY_LOCK_SQL,
  LOCAL_IDENTITY_ADVISORY_UNLOCK_SQL,
  type LocalIdentityDatabaseClock,
  type LocalIdentityDatabaseClient,
  PostgresLocalIdentityCoordination as LocalIdentityRepository,
} from '@/infrastructure/storage/postgres/postgres-local-identity-coordination';
import { createSyntheticPrincipalEmail } from './principal-identity';
import type { LocalIdentityState } from './local-identity-state.codec';

const token = (fill: number) => Buffer.alloc(32, fill).toString('base64url');

const STATE: LocalIdentityState = {
  schemaVersion: 1,
  databaseTargetId: token(1),
  principalId: token(2),
  credential: token(3),
  generation: 1,
};

interface FakeOptions {
  lock?: boolean;
  users?: Array<{ user_id: string; email: string }>;
  identities?: Array<{ id: string; user_id: string }>;
  insertRowCount?: number;
  insertRows?: Array<Record<string, unknown>>;
  failCommit?: boolean;
  pendingConnect?: boolean;
  pendingEnd?: boolean;
  pendingSql?: string;
  queryFailure?: { sql: string; error: Error & { code?: string } };
  unhealthy?: boolean;
  unlock?: boolean;
}

function fakeClient(options: FakeOptions = {}): {
  client: LocalIdentityDatabaseClient;
  events: string[];
  queries: Array<{ text: string; values?: readonly unknown[] }>;
} {
  const events: string[] = [];
  const queries: Array<{ text: string; values?: readonly unknown[] }> = [];
  const client: LocalIdentityDatabaseClient = {
    async connect() {
      events.push('connect');
      if (options.pendingConnect) return new Promise(() => undefined);
    },
    async query(text, values) {
      queries.push({ text, values });
      events.push(`query:${text}`);
      if (options.pendingSql && text === options.pendingSql) {
        return new Promise(() => undefined);
      }
      if (options.queryFailure?.sql === text) {
        throw options.queryFailure.error;
      }
      if (text === LOCAL_IDENTITY_ADVISORY_LOCK_SQL) {
        return { rows: [{ locked: options.lock ?? true }], rowCount: 1 };
      }
      if (text === LOCAL_IDENTITY_ADVISORY_UNLOCK_SQL) {
        return {
          rows: [{ unlocked: options.unlock ?? true }],
          rowCount: 1,
        };
      }
      if (text.includes('FROM public.users')) {
        return {
          rows: options.users ?? [],
          rowCount: options.users?.length ?? 0,
        };
      }
      if (text.includes('FROM public.external_identities')) {
        return {
          rows: options.identities ?? [],
          rowCount: options.identities?.length ?? 0,
        };
      }
      if (text.includes('INSERT INTO public.users')) {
        return {
          rows: options.insertRows ?? [],
          rowCount: options.insertRowCount ?? 1,
        };
      }
      if (text === 'COMMIT' && options.failCommit) {
        throw new Error('commit-canary-secret');
      }
      return { rows: [], rowCount: 0 };
    },
    async end() {
      events.push('end');
      if (options.pendingEnd) return new Promise(() => undefined);
    },
    destroy() {
      events.push('destroy');
    },
    assertHealthy() {
      if (options.unhealthy) throw new Error('connection lost');
    },
  };
  return { client, events, queries };
}

function repositoryFor(
  client: LocalIdentityDatabaseClient,
  options: {
    deadlineMs?: number;
    clock?: LocalIdentityDatabaseClock;
  } = {},
): LocalIdentityRepository {
  return new LocalIdentityRepository({
    clientConfig: {} as ClientConfig,
    clientFactory: () => client,
    deadlineMs: options.deadlineMs,
    clock: options.clock,
  });
}

function manualClock(): {
  clock: LocalIdentityDatabaseClock;
  expireNext(): void;
  pending(): number;
} {
  let nextHandle = 0;
  const callbacks = new Map<number, () => void>();
  return {
    clock: {
      setTimeout(callback) {
        nextHandle += 1;
        callbacks.set(nextHandle, callback);
        return nextHandle;
      },
      clearTimeout(handle) {
        callbacks.delete(handle as number);
      },
    },
    expireNext() {
      const next = callbacks.entries().next().value as
        | [number, () => void]
        | undefined;
      if (!next) throw new Error('No pending database deadline');
      callbacks.delete(next[0]);
      next[1]();
    },
    pending: () => callbacks.size,
  };
}

async function flushMicrotasksUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error('Expected database boundary was not reached');
}

describe('LocalIdentityRepository', () => {
  it('uses one dedicated session, the fixed two-int32 lock, table-lock order, and an explicit principal insert', async () => {
    const { client, queries, events } = fakeClient();
    const repository = repositoryFor(client);
    const session = await repository.acquire();

    await expect(session.initialize(STATE)).resolves.toBe('inserted');
    await session.release();

    expect(LOCAL_IDENTITY_ADVISORY_KEY).toEqual([36541118, 1879950420]);
    expect(queries[0]).toEqual({
      text: LOCAL_IDENTITY_ADVISORY_LOCK_SQL,
      values: LOCAL_IDENTITY_ADVISORY_KEY,
    });
    expect(queries.map(({ text }) => text)).toEqual([
      LOCAL_IDENTITY_ADVISORY_LOCK_SQL,
      'BEGIN',
      'LOCK TABLE public.users IN SHARE ROW EXCLUSIVE MODE',
      'LOCK TABLE public.external_identities IN SHARE ROW EXCLUSIVE MODE',
      expect.stringContaining('FROM public.users'),
      expect.stringContaining('FROM public.external_identities'),
      expect.stringContaining('INSERT INTO public.users'),
      'COMMIT',
      LOCAL_IDENTITY_ADVISORY_UNLOCK_SQL,
    ]);
    const insert = queries.find(({ text }) =>
      text.includes('INSERT INTO public.users'),
    );
    expect(insert.values).toEqual([
      STATE.principalId,
      createSyntheticPrincipalEmail(STATE.principalId),
    ]);
    expect(events).toEqual([
      'connect',
      ...queries.map(({ text }) => `query:${text}`),
      'end',
    ]);
  });

  it('reconciles the exact sole principal with changed email and same-principal provider bindings', async () => {
    const { client, queries } = fakeClient({
      users: [
        {
          user_id: STATE.principalId,
          email: 'changed@example.test',
        },
      ],
      identities: [
        { id: 'auth0', user_id: STATE.principalId },
        { id: 'second-provider', user_id: STATE.principalId },
      ],
    });
    const session = await repositoryFor(client).acquire();

    await expect(session.initialize(STATE)).resolves.toBe('matched');
    expect(
      queries.some(({ text }) => text.includes('INSERT INTO public.users')),
    ).toBe(false);
    await session.release();
  });

  it('runs initialize cleanup after exact database validation and before mutation or commit', async () => {
    const { client, queries, events } = fakeClient();
    const session = await repositoryFor(client).acquire();

    await expect(
      session.initialize(STATE, async (outcome) => {
        expect(outcome).toBe('inserted');
        events.push('after-validation');
      }),
    ).resolves.toBe('inserted');

    expect(events).toEqual([
      'connect',
      `query:${LOCAL_IDENTITY_ADVISORY_LOCK_SQL}`,
      'query:BEGIN',
      'query:LOCK TABLE public.users IN SHARE ROW EXCLUSIVE MODE',
      'query:LOCK TABLE public.external_identities IN SHARE ROW EXCLUSIVE MODE',
      expect.stringContaining('query:SELECT user_id'),
      expect.stringContaining('query:SELECT DISTINCT user_id'),
      'after-validation',
      expect.stringContaining('query:INSERT INTO public.users'),
      'query:COMMIT',
    ]);
    await session.release();
    expect(queries.at(-1)?.text).toBe(LOCAL_IDENTITY_ADVISORY_UNLOCK_SQL);
  });

  it('runs matched-user cleanup after exact validation and before commit without inserting', async () => {
    const { client, queries, events } = fakeClient({
      users: [
        {
          user_id: STATE.principalId,
          email: createSyntheticPrincipalEmail(STATE.principalId),
        },
      ],
    });
    const session = await repositoryFor(client).acquire();

    await expect(
      session.initialize(STATE, async (outcome) => {
        expect(outcome).toBe('matched');
        events.push('after-validation');
      }),
    ).resolves.toBe('matched');

    const callbackIndex = events.indexOf('after-validation');
    const usersIndex = events.findIndex((event) =>
      event.includes('FROM public.users'),
    );
    const identitiesIndex = events.findIndex((event) =>
      event.includes('FROM public.external_identities'),
    );
    const commitIndex = events.indexOf('query:COMMIT');
    expect(callbackIndex).toBeGreaterThan(usersIndex);
    expect(callbackIndex).toBeGreaterThan(identitiesIndex);
    expect(callbackIndex).toBeLessThan(commitIndex);
    expect(
      queries.some(({ text }) => text.includes('INSERT INTO public.users')),
    ).toBe(false);
    await session.release();
  });

  it('rolls back without mutation when post-validation cleanup fails', async () => {
    const { client, queries } = fakeClient();
    const session = await repositoryFor(client).acquire();

    await expect(
      session.initialize(STATE, async () => {
        throw new Error('cleanup failed');
      }),
    ).rejects.toThrow('cleanup failed');

    expect(queries.at(-1)?.text).toBe('ROLLBACK');
    expect(
      queries.some(({ text }) => text.includes('INSERT INTO public.users')),
    ).toBe(false);
    expect(queries.map(({ text }) => text)).not.toContain('COMMIT');
    await session.release();
  });

  it.each([
    ['zero affected rows', { insertRowCount: 0 }],
    [
      'unexpected returned rows',
      { insertRows: [{ user_id: STATE.principalId }] },
    ],
  ])('rolls back when the insert reports %s', async (_name, options) => {
    const { client, queries } = fakeClient(options);
    const session = await repositoryFor(client).acquire();

    await expect(session.initialize(STATE)).rejects.toThrow(
      'Local identity database state conflict',
    );

    expect(queries.at(-1)?.text).toBe('ROLLBACK');
    expect(queries.map(({ text }) => text)).not.toContain('COMMIT');
    await session.release();
  });

  it('does not run cleanup when database validation fails', async () => {
    const { client, queries } = fakeClient({
      users: [{ user_id: 'wrong', email: 'wrong@principal.invalid' }],
    });
    const session = await repositoryFor(client).acquire();
    const afterValidation = jest.fn(async () => undefined);

    await expect(session.initialize(STATE, afterValidation)).rejects.toThrow(
      'Local identity database state conflict',
    );

    expect(afterValidation).not.toHaveBeenCalled();
    expect(queries.at(-1)?.text).toBe('ROLLBACK');
    await session.release();
  });

  it.each([
    [
      'wrong user',
      [{ user_id: 'wrong', email: 'wrong@principal.invalid' }],
      [],
    ],
    [
      'multiple users',
      [
        {
          user_id: STATE.principalId,
          email: createSyntheticPrincipalEmail(STATE.principalId),
        },
        { user_id: 'other', email: 'other@principal.invalid' },
      ],
      [],
    ],
    [
      'foreign external identity owner hidden after same-principal bindings',
      [
        {
          user_id: STATE.principalId,
          email: createSyntheticPrincipalEmail(STATE.principalId),
        },
      ],
      [
        { id: 'identity-a', user_id: STATE.principalId },
        { id: 'identity-b', user_id: STATE.principalId },
        { id: 'identity-c', user_id: 'foreign-principal' },
      ],
    ],
  ])('rolls back without mutation for %s', async (_name, users, identities) => {
    const { client, queries } = fakeClient({ users, identities });
    const session = await repositoryFor(client).acquire();

    await expect(session.initialize(STATE)).rejects.toThrow(
      'Local identity database state conflict',
    );
    expect(queries.at(-1)?.text).toBe('ROLLBACK');
    expect(
      queries.some(({ text }) => text.includes('INSERT INTO public.users')),
    ).toBe(false);
    await session.release();
  });

  it('verifies the exact ready state in a read-only transaction', async () => {
    const { client, queries } = fakeClient({
      users: [
        {
          user_id: STATE.principalId,
          email: 'changed@example.test',
        },
      ],
      identities: [{ id: 'binding', user_id: STATE.principalId }],
    });
    const session = await repositoryFor(client).acquire();

    await expect(session.verify(STATE)).resolves.toBeUndefined();
    expect(queries.map(({ text }) => text)).not.toContain(
      expect.stringContaining('INSERT INTO public.users'),
    );
    await session.release();
  });

  it('verifies an empty database under the same ordered table locks', async () => {
    const { client, queries } = fakeClient();
    const session = await repositoryFor(client).acquire();

    await expect(session.verifyEmpty()).resolves.toBeUndefined();
    expect(queries.map(({ text }) => text)).toEqual([
      LOCAL_IDENTITY_ADVISORY_LOCK_SQL,
      'BEGIN',
      'LOCK TABLE public.users IN SHARE ROW EXCLUSIVE MODE',
      'LOCK TABLE public.external_identities IN SHARE ROW EXCLUSIVE MODE',
      expect.stringContaining('FROM public.users'),
      expect.stringContaining('FROM public.external_identities'),
      'COMMIT',
    ]);
    await session.release();
  });

  it.each([
    {
      method: 'verify' as const,
      users: [
        {
          user_id: STATE.principalId,
          email: createSyntheticPrincipalEmail(STATE.principalId),
        },
      ],
    },
    { method: 'verifyEmpty' as const, users: [] },
  ])(
    'runs $method cleanup after both locked reads and before commit',
    async ({ method, users }) => {
      const { client, events } = fakeClient({ users });
      const session = await repositoryFor(client).acquire();
      const callback = jest.fn(async () => {
        events.push('after-validation');
      });

      if (method === 'verify') {
        await session.verify(STATE, callback);
      } else {
        await session.verifyEmpty(callback);
      }

      const callbackIndex = events.indexOf('after-validation');
      expect(callbackIndex).toBeGreaterThan(
        events.findIndex((event) => event.includes('FROM public.users')),
      );
      expect(callbackIndex).toBeGreaterThan(
        events.findIndex((event) =>
          event.includes('FROM public.external_identities'),
        ),
      );
      expect(callbackIndex).toBeLessThan(events.indexOf('query:COMMIT'));
      await session.release();
    },
  );

  it.each([
    {
      method: 'verify' as const,
      users: [{ user_id: 'wrong', email: 'wrong@principal.invalid' }],
    },
    {
      method: 'verifyEmpty' as const,
      users: [
        {
          user_id: STATE.principalId,
          email: createSyntheticPrincipalEmail(STATE.principalId),
        },
      ],
    },
  ])(
    'does not run $method cleanup when validation conflicts',
    async ({ method, users }) => {
      const { client, queries } = fakeClient({ users });
      const session = await repositoryFor(client).acquire();
      const callback = jest.fn(async () => undefined);

      const verification =
        method === 'verify'
          ? session.verify(STATE, callback)
          : session.verifyEmpty(callback);
      await expect(verification).rejects.toThrow(
        'Local identity database state conflict',
      );

      expect(callback).not.toHaveBeenCalled();
      expect(queries.at(-1)?.text).toBe('ROLLBACK');
      await session.release();
    },
  );

  it('returns fixed busy immediately and closes a session that loses the advisory lock', async () => {
    const { client, queries, events } = fakeClient({ lock: false });

    await expect(repositoryFor(client).acquire()).rejects.toThrow(
      'Local identity operation busy',
    );
    expect(queries).toEqual([
      {
        text: LOCAL_IDENTITY_ADVISORY_LOCK_SQL,
        values: LOCAL_IDENTITY_ADVISORY_KEY,
      },
    ]);
    expect(events).toEqual([
      'connect',
      `query:${LOCAL_IDENTITY_ADVISORY_LOCK_SQL}`,
      'end',
    ]);
  });

  it('treats every COMMIT error as ambiguous, destroys the client, and issues no later query', async () => {
    const { client, queries, events } = fakeClient({ failCommit: true });
    const session = await repositoryFor(client).acquire();

    await expect(session.initialize(STATE)).rejects.toThrow(
      'Local identity recovery required',
    );
    expect(queries.at(-1)?.text).toBe('COMMIT');
    expect(queries.map(({ text }) => text)).not.toContain('ROLLBACK');
    expect(events.at(-1)).toBe('destroy');
    await expect(session.release()).resolves.toBeUndefined();
    expect(queries.at(-1)?.text).toBe('COMMIT');
  });

  it('latches an idle pre-commit connection loss before later filesystem work', async () => {
    const options: FakeOptions = {};
    const { client, events } = fakeClient(options);
    const session = await repositoryFor(client).acquire();

    options.unhealthy = true;

    expect(() => session.assertHeld()).toThrow(
      'Local identity database unavailable',
    );
    expect(events.at(-1)).toBe('destroy');
    await expect(session.release()).resolves.toBeUndefined();
  });

  it('requires recovery when the held session is lost after an acknowledged commit', async () => {
    const options: FakeOptions = {};
    const { client, events } = fakeClient(options);
    const session = await repositoryFor(client).acquire();
    await session.verifyEmpty();

    options.unhealthy = true;

    expect(() => session.assertHeld()).toThrow(
      'Local identity recovery required',
    );
    expect(events.at(-1)).toBe('destroy');
    await expect(session.release()).resolves.toBeUndefined();
  });

  it('destroys a timed-out session and permits no query after the deadline', async () => {
    jest.useFakeTimers();
    try {
      const { client, queries, events } = fakeClient({ pendingSql: 'BEGIN' });
      const session = await repositoryFor(client, { deadlineMs: 50 }).acquire();
      const initialization = session.initialize(STATE);
      const rejection = expect(initialization).rejects.toThrow(
        'Local identity database deadline exceeded',
      );
      await Promise.resolve();
      await jest.advanceTimersByTimeAsync(51);

      await rejection;
      expect(queries.at(-1)?.text).toBe('BEGIN');
      expect(events.at(-1)).toBe('destroy');
      await expect(session.verify(STATE)).rejects.toThrow(
        'Local identity database session is closed',
      );
      expect(queries.at(-1)?.text).toBe('BEGIN');
    } finally {
      jest.useRealTimers();
    }
  });

  it('uses the injected database clock for deadlines', async () => {
    const { client, events } = fakeClient({ pendingConnect: true });
    const time = manualClock();
    const acquisition = repositoryFor(client, {
      deadlineMs: 50,
      clock: time.clock,
    }).acquire();
    const rejection = expect(acquisition).rejects.toThrow(
      'Local identity database deadline exceeded',
    );

    expect(time.pending()).toBe(1);
    time.expireNext();

    await rejection;
    expect(time.pending()).toBe(0);
    expect(events).toEqual(['connect', 'destroy']);
  });

  it('passes the injected clock into session queries', async () => {
    const { client, queries, events } = fakeClient({ pendingSql: 'BEGIN' });
    const time = manualClock();
    const session = await repositoryFor(client, {
      deadlineMs: 50,
      clock: time.clock,
    }).acquire();
    const initialization = session.initialize(STATE);
    const rejection = expect(initialization).rejects.toThrow(
      'Local identity database deadline exceeded',
    );
    await flushMicrotasksUntil(
      () => queries.at(-1)?.text === 'BEGIN' && time.pending() === 1,
    );

    time.expireNext();

    await rejection;
    expect(time.pending()).toBe(0);
    expect(queries.at(-1)?.text).toBe('BEGIN');
    expect(events.at(-1)).toBe('destroy');
  });

  it('uses the injected clock for rollback and issues no later query after expiry', async () => {
    const { client, queries, events } = fakeClient({
      users: [{ user_id: 'wrong', email: 'wrong@example.invalid' }],
      pendingSql: 'ROLLBACK',
    });
    const time = manualClock();
    const session = await repositoryFor(client, {
      deadlineMs: 50,
      clock: time.clock,
    }).acquire();
    const initialization = session.initialize(STATE);
    const rejection = expect(initialization).rejects.toThrow(
      'Local identity database deadline exceeded',
    );
    await flushMicrotasksUntil(
      () => queries.at(-1)?.text === 'ROLLBACK' && time.pending() === 1,
    );

    time.expireNext();

    await rejection;
    expect(time.pending()).toBe(0);
    expect(queries.at(-1)?.text).toBe('ROLLBACK');
    expect(events.at(-1)).toBe('destroy');
  });

  it.each([
    ['unlock', { pendingSql: LOCAL_IDENTITY_ADVISORY_UNLOCK_SQL }],
    ['end', { pendingEnd: true }],
  ] as const)(
    'uses the injected clock for post-commit %s deadlines',
    async (_name, options) => {
      const { client, queries, events } = fakeClient(options);
      const time = manualClock();
      const session = await repositoryFor(client, {
        deadlineMs: 50,
        clock: time.clock,
      }).acquire();
      await session.verifyEmpty();
      const release = session.release();
      const rejection = expect(release).rejects.toThrow(
        'Local identity recovery required',
      );
      await flushMicrotasksUntil(
        () =>
          time.pending() === 1 &&
          ('pendingSql' in options
            ? queries.at(-1)?.text === LOCAL_IDENTITY_ADVISORY_UNLOCK_SQL
            : events.at(-1) === 'end'),
      );

      time.expireNext();

      await rejection;
      expect(time.pending()).toBe(0);
      expect(events.at(-1)).toBe('destroy');
      if ('pendingSql' in options) {
        expect(queries.at(-1)?.text).toBe(LOCAL_IDENTITY_ADVISORY_UNLOCK_SQL);
      }
    },
  );

  it.each([
    ['connect', { pendingConnect: true }],
    ['advisory lock', { pendingSql: LOCAL_IDENTITY_ADVISORY_LOCK_SQL }],
  ] as const)(
    'destroys on a %s acquisition deadline',
    async (_name, options) => {
      jest.useFakeTimers();
      try {
        const { client, queries, events } = fakeClient(options);
        const acquisition = repositoryFor(client, { deadlineMs: 50 }).acquire();
        const rejection = expect(acquisition).rejects.toThrow(
          'Local identity database deadline exceeded',
        );
        await Promise.resolve();
        await jest.advanceTimersByTimeAsync(51);

        await rejection;
        expect(events.at(-1)).toBe('destroy');
        if ('pendingConnect' in options) expect(queries).toEqual([]);
        else
          expect(queries.at(-1)?.text).toBe(LOCAL_IDENTITY_ADVISORY_LOCK_SQL);
      } finally {
        jest.useRealTimers();
      }
    },
  );

  it.each([
    'BEGIN',
    'LOCK TABLE public.users IN SHARE ROW EXCLUSIVE MODE',
    'LOCK TABLE public.external_identities IN SHARE ROW EXCLUSIVE MODE',
    'SELECT user_id FROM public.users ORDER BY user_id COLLATE "C" LIMIT 2',
    'SELECT DISTINCT user_id COLLATE "C" AS user_id FROM public.external_identities ORDER BY user_id LIMIT 2',
    'INSERT INTO public.users (user_id, email, created_at, updated_at) VALUES ($1, $2, NOW(), NOW())',
  ])(
    'destroys on a pre-commit deadline at %s and issues no later query',
    async (sql) => {
      jest.useFakeTimers();
      try {
        const { client, queries, events } = fakeClient({ pendingSql: sql });
        const session = await repositoryFor(client, {
          deadlineMs: 50,
        }).acquire();
        const initialization = session.initialize(STATE);
        const rejection = expect(initialization).rejects.toThrow(
          'Local identity database deadline exceeded',
        );
        await Promise.resolve();
        await jest.advanceTimersByTimeAsync(51);

        await rejection;
        expect(queries.at(-1)?.text).toBe(sql);
        expect(queries.map(({ text }) => text)).not.toContain('ROLLBACK');
        expect(events.at(-1)).toBe('destroy');
        await session.release();
        expect(queries.at(-1)?.text).toBe(sql);
      } finally {
        jest.useRealTimers();
      }
    },
  );

  it('treats a COMMIT deadline as ambiguous and issues no later query', async () => {
    jest.useFakeTimers();
    try {
      const { client, queries, events } = fakeClient({ pendingSql: 'COMMIT' });
      const session = await repositoryFor(client, { deadlineMs: 50 }).acquire();
      const initialization = session.initialize(STATE);
      const rejection = expect(initialization).rejects.toThrow(
        'Local identity recovery required',
      );
      await Promise.resolve();
      await jest.advanceTimersByTimeAsync(51);

      await rejection;
      expect(queries.at(-1)?.text).toBe('COMMIT');
      expect(queries.map(({ text }) => text)).not.toContain('ROLLBACK');
      expect(events.at(-1)).toBe('destroy');
      await session.release();
      expect(queries.at(-1)?.text).toBe('COMMIT');
    } finally {
      jest.useRealTimers();
    }
  });

  it('destroys on a ROLLBACK deadline and preserves the deadline result', async () => {
    jest.useFakeTimers();
    try {
      const { client, queries, events } = fakeClient({
        users: [{ user_id: 'wrong', email: 'ignored@example.test' }],
        pendingSql: 'ROLLBACK',
      });
      const session = await repositoryFor(client, { deadlineMs: 50 }).acquire();
      const initialization = session.initialize(STATE);
      const rejection = expect(initialization).rejects.toThrow(
        'Local identity database deadline exceeded',
      );
      await Promise.resolve();
      await jest.advanceTimersByTimeAsync(51);

      await rejection;
      expect(queries.at(-1)?.text).toBe('ROLLBACK');
      expect(events.at(-1)).toBe('destroy');
      await session.release();
      expect(queries.at(-1)?.text).toBe('ROLLBACK');
    } finally {
      jest.useRealTimers();
    }
  });

  it.each([
    ['unlock', { pendingSql: LOCAL_IDENTITY_ADVISORY_UNLOCK_SQL }],
    ['end', { pendingEnd: true }],
  ] as const)('destroys on a %s release deadline', async (_name, options) => {
    jest.useFakeTimers();
    try {
      const { client, queries, events } = fakeClient(options);
      const session = await repositoryFor(client, { deadlineMs: 50 }).acquire();
      await session.verifyEmpty();
      const release = session.release();
      const rejection = expect(release).rejects.toThrow(
        'Local identity recovery required',
      );
      await Promise.resolve();
      await jest.advanceTimersByTimeAsync(51);

      await rejection;
      expect(events.at(-1)).toBe('destroy');
      if ('pendingSql' in options) {
        expect(queries.at(-1)?.text).toBe(LOCAL_IDENTITY_ADVISORY_UNLOCK_SQL);
      }
    } finally {
      jest.useRealTimers();
    }
  });

  it.each([
    ['lost connection', { unhealthy: true }],
    ['negative unlock acknowledgement', { unlock: false }],
  ] as const)(
    'requires recovery when release observes %s after commit',
    async (_name, options) => {
      const mutableOptions: FakeOptions = {
        ...options,
        unhealthy: false,
      };
      const { client, events } = fakeClient(mutableOptions);
      const session = await repositoryFor(client).acquire();
      await session.verifyEmpty();
      if ('unhealthy' in options) mutableOptions.unhealthy = true;

      await expect(session.release()).rejects.toThrow(
        'Local identity recovery required',
      );
      expect(events.at(-1)).toBe('destroy');
    },
  );

  it.each([
    Object.assign(new Error('Query read timeout'), { code: undefined }),
    Object.assign(new Error('statement cancelled'), { code: '57014' }),
    Object.assign(new Error('lock unavailable'), { code: '55P03' }),
  ])(
    'destroys on driver/server timeout and never queues rollback or unlock',
    async (failure) => {
      const { client, queries, events } = fakeClient({
        queryFailure: {
          sql: 'LOCK TABLE public.users IN SHARE ROW EXCLUSIVE MODE',
          error: failure,
        },
      });
      const session = await repositoryFor(client).acquire();

      await expect(session.initialize(STATE)).rejects.toThrow(
        'Local identity database deadline exceeded',
      );
      expect(queries.at(-1)?.text).toBe(
        'LOCK TABLE public.users IN SHARE ROW EXCLUSIVE MODE',
      );
      expect(queries.map(({ text }) => text)).not.toContain('ROLLBACK');
      expect(events.at(-1)).toBe('destroy');
      await session.release();
      expect(queries.at(-1)?.text).toBe(
        'LOCK TABLE public.users IN SHARE ROW EXCLUSIVE MODE',
      );
    },
  );
});
