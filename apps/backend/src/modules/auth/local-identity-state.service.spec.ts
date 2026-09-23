import { constants } from 'node:fs';
import {
  chmod,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import {
  type OpenLocalIdentityState,
  type LocalIdentityFileHandle,
  type LocalIdentityFileSystem,
  LocalIdentityFileStore,
  nodeLocalIdentityFileSystem,
} from './local-identity-filesystem';
import type { LocalIdentitySession as LocalIdentityDatabaseSession } from '@/domains/shared/storage/local-identity-coordination';
import {
  createInitializeOperation,
  createRecoveryOperation,
  createRotationOperation,
  decodeLocalIdentityState,
  digestLocalIdentityState,
  encodeLocalIdentityOperation,
  encodeLocalIdentityState,
} from './local-identity-state.codec';
import {
  type LocalIdentityRepositoryPort,
  LocalIdentityStateService,
} from './local-identity-state.service';

const token = (fill: number) => Buffer.alloc(32, fill).toString('base64url');
const TARGET_ID = token(1);

function readyState(
  generation = 1,
  credential = token(3),
): OpenLocalIdentityState {
  const state = {
    schemaVersion: 1 as const,
    databaseTargetId: TARGET_ID,
    principalId: token(2),
    credential,
    generation,
  };
  const bytes = encodeLocalIdentityState(state);
  return {
    state,
    bytes,
    digest: digestLocalIdentityState(bytes),
  };
}

async function fixture(): Promise<{
  parent: string;
  root: string;
  store: LocalIdentityFileStore;
  cleanup(): Promise<void>;
}> {
  const created = await mkdtemp(join(tmpdir(), 'local-identity-service-'));
  await chmod(created, 0o700);
  const parent = await realpath(created);
  const root = join(parent, 'state');
  return {
    parent,
    root,
    store: new LocalIdentityFileStore({
      stateRoot: root,
      databaseTargetId: TARGET_ID,
    }),
    cleanup: () => rm(parent, { recursive: true, force: true }),
  };
}

function entropy(...fills: number[]): (size: number) => Buffer {
  const queue = [...fills];
  return (size) => {
    if (size !== 32 || queue.length === 0) {
      throw new Error('unexpected entropy request');
    }
    return Buffer.alloc(32, queue.shift());
  };
}

async function artifactSnapshot(root: string): Promise<
  Array<{
    name: string;
    bytes: Buffer;
    dev: bigint;
    ino: bigint;
    nlink: bigint;
    mode: bigint;
  }>
> {
  const names = (await readdir(root)).sort();
  return Promise.all(
    names.map(async (name) => {
      const path = join(root, name);
      const [bytes, metadata] = await Promise.all([
        readFile(path),
        lstat(path, { bigint: true }),
      ]);
      return {
        name,
        bytes,
        dev: metadata.dev,
        ino: metadata.ino,
        nlink: metadata.nlink,
        mode: metadata.mode,
      };
    }),
  );
}

function fakeRepository(
  options: {
    initialize?: () => Promise<'inserted' | 'matched'>;
    verify?: () => Promise<void>;
    verifyEmpty?: () => Promise<void>;
    assertHeld?: () => void;
  } = {},
): {
  repository: LocalIdentityRepositoryPort;
  session: {
    initialize: jest.Mock;
    verify: jest.Mock;
    verifyEmpty: jest.Mock;
    release: jest.Mock;
    destroy: jest.Mock;
    assertHeld: jest.Mock;
  };
} {
  const session = {
    initialize: jest.fn(async (_state, afterValidation) => {
      const outcome = await (
        options.initialize ?? (async () => 'inserted' as const)
      )();
      await afterValidation?.(outcome);
      return outcome;
    }),
    verify: jest.fn(async (_state, afterValidation) => {
      await (options.verify ?? (async () => undefined))();
      await afterValidation?.();
    }),
    verifyEmpty: jest.fn(async (afterValidation) => {
      await (options.verifyEmpty ?? (async () => undefined))();
      await afterValidation?.();
    }),
    release: jest.fn(async () => undefined),
    destroy: jest.fn(),
    assertHeld: jest.fn(() => options.assertHeld?.()),
  };
  return {
    repository: {
      acquire: jest.fn(
        async () => session as unknown as LocalIdentityDatabaseSession,
      ),
    },
    session,
  };
}

interface StatefulDatabase {
  state: ReturnType<typeof decodeLocalIdentityState> | null;
  externalIdentity?: boolean;
}

function statefulRepository(
  database: StatefulDatabase,
): LocalIdentityRepositoryPort {
  const conflict = () => {
    throw new Error('Local identity database state conflict');
  };
  return {
    acquire: async () =>
      ({
        initialize: async (state, afterValidation) => {
          if (database.externalIdentity) conflict();
          const outcome = database.state ? 'matched' : 'inserted';
          if (
            database.state &&
            database.state.principalId !== state.principalId
          ) {
            conflict();
          }
          await afterValidation?.(outcome);
          if (outcome === 'inserted') database.state = state;
          return outcome;
        },
        verify: async (state, afterValidation) => {
          if (
            database.externalIdentity ||
            !database.state ||
            database.state.principalId !== state.principalId
          ) {
            conflict();
          }
          await afterValidation?.();
        },
        verifyEmpty: async (afterValidation) => {
          if (database.state || database.externalIdentity) conflict();
          await afterValidation?.();
        },
        release: async () => undefined,
        destroy: () => undefined,
        assertHeld: () => undefined,
      }) as LocalIdentityDatabaseSession,
  };
}

type CrashPhase =
  | 'operation-linked'
  | 'operation-stage-unlinked'
  | 'candidate-linked'
  | 'candidate-stage-unlinked'
  | 'initial-linked'
  | 'initial-candidate-unlinked'
  | 'rotation-renamed'
  | 'operation-cleanup-unlinked'
  | 'recovery-stage-unlinked';

function crashAfterBoundary(options: { root: string; boundary: string }): {
  fileSystem: LocalIdentityFileSystem;
  fired(): boolean;
} {
  let fired = false;
  let phase: CrashPhase | undefined;
  const fail = (label: string): void => {
    if (!fired && options.boundary === label) {
      fired = true;
      throw new Error(`simulated crash after ${label}`);
    }
  };
  const stageKind = (path: string): 'operation' | 'candidate' | null => {
    const name = basename(path);
    if (name.startsWith('identity.stage-operation-')) return 'operation';
    if (name.startsWith('identity.stage-') && name.endsWith('-candidate.tmp')) {
      return 'candidate';
    }
    return null;
  };
  const directoryBoundary = (): string | null => {
    switch (phase) {
      case 'operation-linked':
        return 'operation.publish.postlink-verify';
      case 'candidate-linked':
        return 'candidate.publish.postlink-verify';
      case 'initial-linked':
        return 'initial.postlink-verify';
      default:
        return null;
    }
  };
  const directorySyncBoundary = (): string | null => {
    switch (phase) {
      case 'operation-linked':
        return 'operation.publish.dir-fsync';
      case 'operation-stage-unlinked':
        return 'operation.stage.dir-fsync';
      case 'candidate-linked':
        return 'candidate.publish.dir-fsync';
      case 'candidate-stage-unlinked':
        return 'candidate.stage.dir-fsync';
      case 'initial-linked':
        return 'initial.dir-fsync';
      case 'initial-candidate-unlinked':
        return 'initial.cleanup-dir-fsync';
      case 'rotation-renamed':
        return 'rotation.dir-fsync';
      case 'operation-cleanup-unlinked':
        return 'operation-cleanup.dir-fsync';
      case 'recovery-stage-unlinked':
        return 'recovery-stage.cleanup-dir-fsync';
    }
  };
  const fileSystem: LocalIdentityFileSystem = {
    ...nodeLocalIdentityFileSystem,
    async open(path, flags, mode) {
      const isRootDirectory =
        path === options.root && (flags & constants.O_DIRECTORY) !== 0;
      if (isRootDirectory) {
        const label = directoryBoundary();
        if (label) fail(label);
      }
      const handle = await nodeLocalIdentityFileSystem.open(path, flags, mode);
      const kind = stageKind(path);
      if (kind && (flags & constants.O_CREAT) !== 0) {
        try {
          fail(`${kind}.stage.create`);
        } catch (error) {
          await handle.close();
          throw error;
        }
      }
      return {
        async writeFile(bytes) {
          if (
            kind &&
            !fired &&
            options.boundary === `${kind}.stage.partial-write`
          ) {
            await handle.writeFile(bytes.subarray(0, 1));
            fail(`${kind}.stage.partial-write`);
          }
          await handle.writeFile(bytes);
          if (kind) fail(`${kind}.stage.write`);
        },
        readFile: () => handle.readFile(),
        stat: () => handle.stat(),
        async sync() {
          await handle.sync();
          if (kind) fail(`${kind}.stage.file-fsync`);
          if (isRootDirectory) {
            const label = directorySyncBoundary();
            if (label) fail(label);
          }
        },
        close: () => handle.close(),
      } satisfies LocalIdentityFileHandle;
    },
    async link(existingPath, newPath) {
      await nodeLocalIdentityFileSystem.link(existingPath, newPath);
      const published = basename(newPath);
      if (published === 'identity.operation.json') {
        phase = 'operation-linked';
        fail('operation.publish.link');
      } else if (
        published.startsWith('identity.pending-') ||
        published.startsWith('identity.rotate-')
      ) {
        phase = 'candidate-linked';
        fail('candidate.publish.link');
      } else if (published === 'identity.json') {
        phase = 'initial-linked';
        fail('initial.link');
      }
    },
    async unlink(path) {
      await nodeLocalIdentityFileSystem.unlink(path);
      const name = basename(path);
      if (name.startsWith('identity.stage-operation-')) {
        phase = options.boundary.startsWith('recovery-stage.')
          ? 'recovery-stage-unlinked'
          : 'operation-stage-unlinked';
        fail('operation.stage.unlink');
      } else if (
        name.startsWith('identity.stage-') &&
        name.endsWith('-candidate.tmp')
      ) {
        phase = 'candidate-stage-unlinked';
        fail('candidate.stage.unlink');
      } else if (
        name.startsWith('identity.pending-') ||
        name.startsWith('identity.rotate-')
      ) {
        phase = 'initial-candidate-unlinked';
        fail('initial.candidate-unlink');
      } else if (name === 'identity.operation.json') {
        phase = 'operation-cleanup-unlinked';
        fail('operation-cleanup.unlink');
      }
    },
    async rename(oldPath, newPath) {
      await nodeLocalIdentityFileSystem.rename(oldPath, newPath);
      phase = 'rotation-renamed';
      fail('rotation.rename');
    },
  };
  return { fileSystem, fired: () => fired };
}

function crashAfterArtifactCleanup(options: {
  root: string;
  basename: string;
  boundary: 'unlink' | 'dir-fsync';
}): { fileSystem: LocalIdentityFileSystem; fired(): boolean } {
  let fired = false;
  let awaitingDirectorySync = false;
  const fail = () => {
    if (fired) return;
    fired = true;
    throw new Error(
      `simulated crash after ${options.basename} ${options.boundary}`,
    );
  };
  return {
    fileSystem: {
      ...nodeLocalIdentityFileSystem,
      async unlink(path) {
        await nodeLocalIdentityFileSystem.unlink(path);
        if (basename(path) !== options.basename) return;
        awaitingDirectorySync = true;
        if (options.boundary === 'unlink') fail();
      },
      async open(path, flags, mode) {
        const handle = await nodeLocalIdentityFileSystem.open(
          path,
          flags,
          mode,
        );
        if (path !== options.root || (flags & constants.O_DIRECTORY) === 0) {
          return handle;
        }
        return {
          ...handle,
          async sync() {
            await handle.sync();
            if (awaitingDirectorySync && options.boundary === 'dir-fsync') {
              awaitingDirectorySync = false;
              fail();
            }
          },
        } satisfies LocalIdentityFileHandle;
      },
    },
    fired: () => fired,
  };
}

type InitializeCrashShape =
  | 'operation-stage'
  | 'operation-linked'
  | 'operation-only'
  | 'candidate-stage'
  | 'candidate-linked'
  | 'candidate-only'
  | 'canonical-linked'
  | 'canonical-operation'
  | 'canonical-only';

const INITIALIZE_CRASH_CASES: Array<{
  boundary: string;
  shape: InitializeCrashShape;
  retainsOriginalPrincipal: boolean;
}> = [
  ...['create', 'partial-write', 'write', 'file-fsync'].map((point) => ({
    boundary: `operation.stage.${point}`,
    shape: 'operation-stage' as const,
    retainsOriginalPrincipal: false,
  })),
  ...['link', 'postlink-verify', 'dir-fsync'].map((point) => ({
    boundary: `operation.publish.${point}`,
    shape: 'operation-linked' as const,
    retainsOriginalPrincipal: false,
  })),
  ...['unlink', 'dir-fsync'].map((point) => ({
    boundary: `operation.stage.${point}`,
    shape: 'operation-only' as const,
    retainsOriginalPrincipal: false,
  })),
  ...['create', 'partial-write', 'write', 'file-fsync'].map((point) => ({
    boundary: `candidate.stage.${point}`,
    shape: 'candidate-stage' as const,
    retainsOriginalPrincipal: false,
  })),
  ...['link', 'postlink-verify', 'dir-fsync'].map((point) => ({
    boundary: `candidate.publish.${point}`,
    shape: 'candidate-linked' as const,
    retainsOriginalPrincipal: true,
  })),
  ...['unlink', 'dir-fsync'].map((point) => ({
    boundary: `candidate.stage.${point}`,
    shape: 'candidate-only' as const,
    retainsOriginalPrincipal: true,
  })),
  ...['link', 'postlink-verify', 'dir-fsync'].map((point) => ({
    boundary: point === 'link' ? 'initial.link' : `initial.${point}`,
    shape: 'canonical-linked' as const,
    retainsOriginalPrincipal: true,
  })),
  ...['candidate-unlink', 'cleanup-dir-fsync'].map((point) => ({
    boundary: `initial.${point}`,
    shape: 'canonical-operation' as const,
    retainsOriginalPrincipal: true,
  })),
  ...['unlink', 'dir-fsync'].map((point) => ({
    boundary: `operation-cleanup.${point}`,
    shape: 'canonical-only' as const,
    retainsOriginalPrincipal: true,
  })),
];

const ROTATION_CRASH_CASES: Array<{
  boundary: string;
  expected: 'old' | 'new';
}> = [
  ...['create', 'partial-write', 'write', 'file-fsync'].map((point) => ({
    boundary: `operation.stage.${point}`,
    expected: 'old' as const,
  })),
  ...['link', 'postlink-verify', 'dir-fsync'].map((point) => ({
    boundary: `operation.publish.${point}`,
    expected: 'old' as const,
  })),
  ...['unlink', 'dir-fsync'].map((point) => ({
    boundary: `operation.stage.${point}`,
    expected: 'old' as const,
  })),
  ...['create', 'partial-write', 'write', 'file-fsync'].map((point) => ({
    boundary: `candidate.stage.${point}`,
    expected: 'old' as const,
  })),
  ...['link', 'postlink-verify', 'dir-fsync'].map((point) => ({
    boundary: `candidate.publish.${point}`,
    expected: 'old' as const,
  })),
  ...['unlink', 'dir-fsync'].map((point) => ({
    boundary: `candidate.stage.${point}`,
    expected: 'old' as const,
  })),
  ...['rename', 'dir-fsync'].map((point) => ({
    boundary: `rotation.${point}`,
    expected: 'new' as const,
  })),
  ...['unlink', 'dir-fsync'].map((point) => ({
    boundary: `operation-cleanup.${point}`,
    expected: 'new' as const,
  })),
];

describe('LocalIdentityStateService', () => {
  it('verifies one unchanged canonical state while the database session is held', async () => {
    const events: string[] = [];
    const ready = readyState();
    const openReadyState = jest.fn(async () => {
      events.push('open');
      return ready;
    });
    const session = {
      verify: jest.fn(async (_state, afterValidation) => {
        events.push('verify');
        await afterValidation?.();
      }),
      release: jest.fn(async () => {
        events.push('release');
      }),
    };
    const service = new LocalIdentityStateService({
      fileStore: { openReadyState } as never,
      repository: {
        acquire: jest.fn(async () => {
          events.push('acquire');
          return session as never;
        }),
      },
    });

    await expect(service.verifyReadyState()).resolves.toBe(ready);
    expect(events).toEqual(['acquire', 'open', 'verify', 'open', 'release']);
    expect(session.verify).toHaveBeenCalledWith(
      ready.state,
      expect.any(Function),
    );
    expect(session.release).toHaveBeenCalledTimes(1);
  });

  it('rejects a state change during database verification with a fixed diagnostic', async () => {
    const first = readyState();
    const second = readyState(2, token(4));
    const session = {
      verify: jest.fn(async (_state, afterValidation) => afterValidation?.()),
      release: jest.fn(async () => undefined),
    };
    const service = new LocalIdentityStateService({
      fileStore: {
        openReadyState: jest
          .fn()
          .mockResolvedValueOnce(first)
          .mockResolvedValueOnce(second),
      } as never,
      repository: {
        acquire: jest.fn(async () => session as never),
      },
    });

    await expect(service.verifyReadyState()).rejects.toThrow(
      'Local identity state changed during verification',
    );
    expect(session.release).toHaveBeenCalledTimes(1);
  });

  it('releases the database session when ready-state verification fails', async () => {
    const cause = new Error('database-password-canary');
    const session = {
      verify: jest.fn(async () => {
        throw cause;
      }),
      release: jest.fn(async () => undefined),
    };
    const openReadyState = jest.fn(async () => readyState());
    const service = new LocalIdentityStateService({
      fileStore: { openReadyState } as never,
      repository: {
        acquire: jest.fn(async () => session as never),
      },
    });

    await expect(service.verifyReadyState()).rejects.toBe(cause);
    expect(openReadyState).toHaveBeenCalledTimes(1);
    expect(session.release).toHaveBeenCalledTimes(1);
  });

  it.each(INITIALIZE_CRASH_CASES)(
    'converges after an initialize crash at $boundary',
    async ({ boundary, shape, retainsOriginalPrincipal }) => {
      const state = await fixture();
      const database: StatefulDatabase = { state: null };
      const nonce = token(82);
      const operationStage = `identity.stage-operation-${nonce}.tmp`;
      const candidateStage = `identity.stage-${nonce}-candidate.tmp`;
      const candidate = `identity.pending-${nonce}.json`;
      const operation = 'identity.operation.json';
      const canonical = 'identity.json';
      try {
        await mkdir(state.root, { mode: 0o700 });
        const crash = crashAfterBoundary({ root: state.root, boundary });
        const interrupted = new LocalIdentityStateService({
          fileStore: new LocalIdentityFileStore({
            stateRoot: state.root,
            databaseTargetId: TARGET_ID,
            fileSystem: crash.fileSystem,
          }),
          repository: statefulRepository(database),
          randomBytes: entropy(80, 81, 82),
        });

        await expect(interrupted.initialize()).rejects.toThrow();
        expect(crash.fired()).toBe(true);

        const expectedNames: Record<InitializeCrashShape, string[]> = {
          'operation-stage': [operationStage],
          'operation-linked': [operation, operationStage],
          'operation-only': [operation],
          'candidate-stage': [candidateStage, operation],
          'candidate-linked': [candidate, candidateStage, operation],
          'candidate-only': [candidate, operation],
          'canonical-linked': [candidate, canonical, operation],
          'canonical-operation': [canonical, operation],
          'canonical-only': [canonical],
        };
        expect((await readdir(state.root)).sort()).toEqual(
          expectedNames[shape].sort(),
        );
        if (shape === 'operation-linked') {
          const [left, right] = await Promise.all([
            lstat(join(state.root, operation), { bigint: true }),
            lstat(join(state.root, operationStage), { bigint: true }),
          ]);
          expect([left.dev, left.ino, left.nlink]).toEqual([
            right.dev,
            right.ino,
            2n,
          ]);
        }
        if (shape === 'candidate-linked') {
          const [left, right] = await Promise.all([
            lstat(join(state.root, candidate), { bigint: true }),
            lstat(join(state.root, candidateStage), { bigint: true }),
          ]);
          expect([left.dev, left.ino, left.nlink]).toEqual([
            right.dev,
            right.ino,
            2n,
          ]);
        }
        if (shape === 'canonical-linked') {
          const [left, right] = await Promise.all([
            lstat(join(state.root, candidate), { bigint: true }),
            lstat(join(state.root, canonical), { bigint: true }),
          ]);
          expect([left.dev, left.ino, left.nlink]).toEqual([
            right.dev,
            right.ino,
            2n,
          ]);
        }

        const recovery = new LocalIdentityStateService({
          fileStore: state.store,
          repository: statefulRepository(database),
          randomBytes: entropy(86),
        });
        let ready = await recovery.recoverInitialize();
        if (!ready) {
          const retry = new LocalIdentityStateService({
            fileStore: state.store,
            repository: statefulRepository(database),
            randomBytes: entropy(87, 88, 89),
          });
          ready = await retry.initialize();
        }

        expect(await readdir(state.root)).toEqual([canonical]);
        expect(ready.state.principalId).toBe(
          retainsOriginalPrincipal ? token(80) : token(87),
        );
        expect(database.state?.principalId).toBe(ready.state.principalId);
        await expect(state.store.openReadyState()).resolves.toEqual(ready);
      } finally {
        await state.cleanup();
      }
    },
  );

  it('initializes one durable principal and leaves exactly the canonical file', async () => {
    const state = await fixture();
    const database = fakeRepository();
    try {
      const service = new LocalIdentityStateService({
        fileStore: state.store,
        repository: database.repository,
        randomBytes: entropy(2, 3, 4),
      });

      const ready = await service.initialize();

      expect(ready.state).toEqual({
        schemaVersion: 1,
        databaseTargetId: TARGET_ID,
        principalId: Buffer.alloc(32, 2).toString('base64url'),
        credential: Buffer.alloc(32, 3).toString('base64url'),
        generation: 1,
      });
      expect(await readdir(state.root)).toEqual(['identity.json']);
      expect(database.session.initialize).toHaveBeenCalledWith(ready.state);
      expect(database.session.release).toHaveBeenCalledTimes(1);
      await expect(service.openReadyState()).resolves.toEqual(ready);
    } finally {
      await state.cleanup();
    }
  });

  it('rejects entropy that would expose a credential as an operation nonce', async () => {
    const state = await fixture();
    const database = fakeRepository();
    try {
      const service = new LocalIdentityStateService({
        fileStore: state.store,
        repository: database.repository,
        randomBytes: entropy(40, 41, 41),
      });

      await expect(service.initialize()).rejects.toThrow(
        'Local identity entropy failure',
      );
      expect(database.session.initialize).not.toHaveBeenCalled();
      expect(await readdir(state.root)).toEqual([]);
    } finally {
      await state.cleanup();
    }
  });

  it.each([
    ['principal', [1, 2, 3]],
    ['credential', [2, 1, 3]],
  ] as const)(
    'rejects entropy that aliases the database target as the %s',
    async (_name, fills) => {
      const state = await fixture();
      const database = fakeRepository();
      try {
        const service = new LocalIdentityStateService({
          fileStore: state.store,
          repository: database.repository,
          randomBytes: entropy(...fills),
        });

        await expect(service.initialize()).rejects.toThrow(
          'Local identity entropy failure',
        );
        expect(database.session.initialize).not.toHaveBeenCalled();
        expect(await readdir(state.root)).toEqual([]);
      } finally {
        await state.cleanup();
      }
    },
  );

  it('preserves the exact operation and candidate after ambiguous commit', async () => {
    const state = await fixture();
    const database = fakeRepository({
      initialize: async () => {
        throw new Error('Local identity recovery required');
      },
    });
    try {
      const service = new LocalIdentityStateService({
        fileStore: state.store,
        repository: database.repository,
        randomBytes: entropy(4, 5, 6),
      });

      await expect(service.initialize()).rejects.toThrow(
        'Local identity recovery required',
      );
      expect((await readdir(state.root)).sort()).toEqual([
        'identity.operation.json',
        `identity.pending-${Buffer.alloc(32, 6).toString('base64url')}.json`,
      ]);
    } finally {
      await state.cleanup();
    }
  });

  it('performs no filesystem mutation when the database session is already lost', async () => {
    const state = await fixture();
    const database = fakeRepository({
      assertHeld: () => {
        throw new Error('Local identity database unavailable');
      },
    });
    try {
      const service = new LocalIdentityStateService({
        fileStore: state.store,
        repository: database.repository,
        randomBytes: entropy(4, 5, 6),
      });

      await expect(service.initialize()).rejects.toThrow(
        'Local identity database unavailable',
      );
      await expect(lstat(state.root)).rejects.toMatchObject({ code: 'ENOENT' });
      expect(database.session.initialize).not.toHaveBeenCalled();
    } finally {
      await state.cleanup();
    }
  });

  it('stops after a latched session loss at operation publication and recovers the bounded artifacts', async () => {
    const state = await fixture();
    let lost = false;
    const adversarial: LocalIdentityFileSystem = {
      ...nodeLocalIdentityFileSystem,
      async link(existingPath, newPath) {
        await nodeLocalIdentityFileSystem.link(existingPath, newPath);
        if (basename(newPath) === 'identity.operation.json') lost = true;
      },
    };
    const database = fakeRepository({
      assertHeld: () => {
        if (lost) throw new Error('Local identity database unavailable');
      },
    });
    try {
      const service = new LocalIdentityStateService({
        fileStore: new LocalIdentityFileStore({
          stateRoot: state.root,
          databaseTargetId: TARGET_ID,
          fileSystem: adversarial,
        }),
        repository: database.repository,
        randomBytes: entropy(4, 5, 6),
      });

      await expect(service.initialize()).rejects.toThrow(
        'Local identity database unavailable',
      );
      expect(database.session.initialize).not.toHaveBeenCalled();
      expect((await readdir(state.root)).sort()).toEqual([
        'identity.operation.json',
        `identity.stage-operation-${token(6)}.tmp`,
      ]);

      const recovery = new LocalIdentityStateService({
        fileStore: state.store,
        repository: fakeRepository().repository,
        randomBytes: entropy(7),
      });
      await expect(recovery.recoverInitialize()).resolves.toBeNull();
      expect(await readdir(state.root)).toEqual([]);
    } finally {
      await state.cleanup();
    }
  });

  it('retains a recoverable canonical hardlink when the session is lost after commit', async () => {
    const state = await fixture();
    let lost = false;
    const adversarial: LocalIdentityFileSystem = {
      ...nodeLocalIdentityFileSystem,
      async link(existingPath, newPath) {
        await nodeLocalIdentityFileSystem.link(existingPath, newPath);
        if (basename(newPath) === 'identity.json') lost = true;
      },
    };
    const database = fakeRepository({
      assertHeld: () => {
        if (lost) throw new Error('Local identity recovery required');
      },
    });
    try {
      const service = new LocalIdentityStateService({
        fileStore: new LocalIdentityFileStore({
          stateRoot: state.root,
          databaseTargetId: TARGET_ID,
          fileSystem: adversarial,
        }),
        repository: database.repository,
        randomBytes: entropy(4, 5, 6),
      });

      await expect(service.initialize()).rejects.toThrow(
        'Local identity recovery required',
      );
      expect(database.session.initialize).toHaveBeenCalledTimes(1);
      expect((await readdir(state.root)).sort()).toEqual([
        'identity.json',
        'identity.operation.json',
        `identity.pending-${token(6)}.json`,
      ]);

      const recovery = new LocalIdentityStateService({
        fileStore: state.store,
        repository: fakeRepository().repository,
        randomBytes: entropy(7),
      });
      await expect(recovery.recoverInitialize()).resolves.toMatchObject({
        state: { generation: 1, principalId: token(4) },
      });
      expect(await readdir(state.root)).toEqual(['identity.json']);
    } finally {
      await state.cleanup();
    }
  });

  it('loses a shared-root cross-database race before mutation and removes only its own pre-candidate mutex', async () => {
    const state = await fixture();
    const database = fakeRepository();
    const otherTarget = token(99);
    let injected = false;
    const adversarial: LocalIdentityFileSystem = {
      ...nodeLocalIdentityFileSystem,
      async link(existingPath, newPath) {
        if (!injected && newPath.endsWith('/identity.operation.json')) {
          injected = true;
          await writeFile(
            join(state.root, 'identity.json'),
            encodeLocalIdentityState({
              schemaVersion: 1,
              databaseTargetId: otherTarget,
              principalId: token(98),
              credential: token(97),
              generation: 1,
            }),
            { mode: 0o600 },
          );
        }
        return nodeLocalIdentityFileSystem.link(existingPath, newPath);
      },
    };
    try {
      const service = new LocalIdentityStateService({
        fileStore: new LocalIdentityFileStore({
          stateRoot: state.root,
          databaseTargetId: TARGET_ID,
          fileSystem: adversarial,
        }),
        repository: database.repository,
        randomBytes: entropy(33, 34, 35),
      });

      await expect(service.initialize()).rejects.toThrow(
        'Local identity target mismatch',
      );
      expect(database.session.initialize).not.toHaveBeenCalled();
      expect(await readdir(state.root)).toEqual(['identity.json']);
      expect(
        decodeLocalIdentityState(
          await readFile(join(state.root, 'identity.json')),
        ).databaseTargetId,
      ).toBe(otherTarget);
    } finally {
      await state.cleanup();
    }
  });

  it('uses the completed operation stage as a cross-database fence before linking the root mutex', async () => {
    const state = await fixture();
    const database = fakeRepository();
    const otherTarget = token(74);
    let injected = false;
    let operationLinks = 0;
    const otherState = encodeLocalIdentityState({
      schemaVersion: 1,
      databaseTargetId: otherTarget,
      principalId: token(75),
      credential: token(76),
      generation: 1,
    });
    const adversarial: LocalIdentityFileSystem = {
      ...nodeLocalIdentityFileSystem,
      async readdir(path) {
        let names = await nodeLocalIdentityFileSystem.readdir(path);
        if (
          !injected &&
          path === state.root &&
          names.some((name) => name.startsWith('identity.stage-operation-')) &&
          !names.includes('identity.operation.json')
        ) {
          injected = true;
          await writeFile(join(state.root, 'identity.json'), otherState, {
            mode: 0o600,
          });
          names = await nodeLocalIdentityFileSystem.readdir(path);
        }
        return names;
      },
      async link(existingPath, newPath) {
        if (newPath.endsWith('/identity.operation.json')) operationLinks += 1;
        return nodeLocalIdentityFileSystem.link(existingPath, newPath);
      },
    };
    try {
      const service = new LocalIdentityStateService({
        fileStore: new LocalIdentityFileStore({
          stateRoot: state.root,
          databaseTargetId: TARGET_ID,
          fileSystem: adversarial,
        }),
        repository: database.repository,
        randomBytes: entropy(77, 78, 79),
      });

      await expect(service.initialize()).rejects.toThrow(
        'Local identity target mismatch',
      );
      expect(operationLinks).toBe(0);
      expect(database.session.initialize).not.toHaveBeenCalled();
      expect(await readdir(state.root)).toEqual(['identity.json']);
      expect(await readFile(join(state.root, 'identity.json'))).toEqual(
        otherState,
      );
    } finally {
      await state.cleanup();
    }
  });

  it('elects one winner when two databases publish operation stages together and cleans the paused contender', async () => {
    const state = await fixture();
    const otherTarget = token(80);
    const firstDatabase = fakeRepository();
    const secondDatabase = fakeRepository();
    let stageCloses = 0;
    let releaseStageBarrier: () => void;
    const stageBarrier = new Promise<void>((resolveBarrier) => {
      releaseStageBarrier = resolveBarrier;
    });
    let reportConflict: () => void;
    const conflictObserved = new Promise<void>((resolveConflict) => {
      reportConflict = resolveConflict;
    });
    let releaseConflict: () => void;
    const conflictRelease = new Promise<void>((resolveConflict) => {
      releaseConflict = resolveConflict;
    });
    const concurrent: LocalIdentityFileSystem = {
      ...nodeLocalIdentityFileSystem,
      async open(path, flags, mode) {
        const handle = await nodeLocalIdentityFileSystem.open(
          path,
          flags,
          mode,
        );
        if (!basename(path).startsWith('identity.stage-operation-')) {
          return handle;
        }
        return {
          ...handle,
          async close() {
            await handle.close();
            stageCloses += 1;
            if (stageCloses === 2) releaseStageBarrier();
            await stageBarrier;
          },
        } satisfies LocalIdentityFileHandle;
      },
      async link(existingPath, newPath) {
        try {
          await nodeLocalIdentityFileSystem.link(existingPath, newPath);
        } catch (error) {
          if (
            basename(newPath) === 'identity.operation.json' &&
            (error as NodeJS.ErrnoException).code === 'EEXIST'
          ) {
            reportConflict();
            await conflictRelease;
          }
          throw error;
        }
      },
    };
    try {
      await mkdir(state.root, { mode: 0o700 });
      const first = new LocalIdentityStateService({
        fileStore: new LocalIdentityFileStore({
          stateRoot: state.root,
          databaseTargetId: TARGET_ID,
          fileSystem: concurrent,
        }),
        repository: firstDatabase.repository,
        randomBytes: entropy(81, 82, 83),
      });
      const second = new LocalIdentityStateService({
        fileStore: new LocalIdentityFileStore({
          stateRoot: state.root,
          databaseTargetId: otherTarget,
          fileSystem: concurrent,
        }),
        repository: secondDatabase.repository,
        randomBytes: entropy(84, 85, 86),
      });

      const attempts = [first.initialize(), second.initialize()];
      await conflictObserved;
      const winner = await Promise.race(
        attempts.map((attempt, index) =>
          attempt.then((ready) => ({ index, ready })),
        ),
      );
      expect(winner.ready.state.databaseTargetId).toBe(
        winner.index === 0 ? TARGET_ID : otherTarget,
      );
      expect(await readdir(state.root)).toEqual(['identity.json']);

      releaseConflict();
      const results = await Promise.allSettled(attempts);
      expect(
        results.filter(({ status }) => status === 'fulfilled'),
      ).toHaveLength(1);
      const failure = results.find(
        ({ status }) => status === 'rejected',
      ) as PromiseRejectedResult;
      expect((failure.reason as Error).message).toBe(
        'Local identity operation busy',
      );
      expect(
        firstDatabase.session.initialize.mock.calls.length +
          secondDatabase.session.initialize.mock.calls.length,
      ).toBe(1);
      expect(await readdir(state.root)).toEqual(['identity.json']);
    } finally {
      releaseStageBarrier?.();
      releaseConflict?.();
      await state.cleanup();
    }
  });

  it('recovers the same initialize candidate for either zero-user or matching-user database state', async () => {
    for (const outcome of ['inserted', 'matched'] as const) {
      const state = await fixture();
      const firstDatabase = fakeRepository({
        initialize: async () => {
          throw new Error('Local identity recovery required');
        },
      });
      try {
        const first = new LocalIdentityStateService({
          fileStore: state.store,
          repository: firstDatabase.repository,
          randomBytes: entropy(7, 8, 9),
        });
        await expect(first.initialize()).rejects.toThrow();
        const candidateName = (await readdir(state.root)).find((name) =>
          name.startsWith('identity.pending-'),
        );
        const proposed = decodeLocalIdentityState(
          await readFile(join(state.root, candidateName)),
        );

        const recoveryDatabase = fakeRepository({
          initialize: async () => outcome,
        });
        const recovery = new LocalIdentityStateService({
          fileStore: state.store,
          repository: recoveryDatabase.repository,
          randomBytes: entropy(10),
        });
        const ready = await recovery.recoverInitialize();

        expect(ready.state).toEqual(proposed);
        expect(recoveryDatabase.session.initialize).toHaveBeenCalledWith(
          proposed,
          expect.any(Function),
        );
        expect(await readdir(state.root)).toEqual(['identity.json']);
      } finally {
        await state.cleanup();
      }
    }
  });

  it.each(['wrong user', 'multiple users', 'foreign identity owner'])(
    'leaves every recovery artifact and inode unchanged for %s',
    async () => {
      const state = await fixture();
      const firstDatabase = fakeRepository({
        initialize: async () => {
          throw new Error('Local identity recovery required');
        },
      });
      try {
        const first = new LocalIdentityStateService({
          fileStore: state.store,
          repository: firstDatabase.repository,
          randomBytes: entropy(50, 51, 52),
        });
        await expect(first.initialize()).rejects.toThrow(
          'Local identity recovery required',
        );
        const before = await artifactSnapshot(state.root);
        const conflictingDatabase = fakeRepository({
          initialize: async () => {
            throw new Error('Local identity database state conflict');
          },
        });
        const recovery = new LocalIdentityStateService({
          fileStore: state.store,
          repository: conflictingDatabase.repository,
          randomBytes: entropy(53),
        });

        await expect(recovery.recoverInitialize()).rejects.toThrow(
          'Local identity database state conflict',
        );

        expect(await artifactSnapshot(state.root)).toEqual(before);
      } finally {
        await state.cleanup();
      }
    },
  );

  it.each(['candidate-stage', 'canonical-link'] as const)(
    'recovers the mandated post-hardlink crash residue: %s',
    async (residue) => {
      const state = await fixture();
      const firstDatabase = fakeRepository({
        initialize: async () => {
          throw new Error('Local identity recovery required');
        },
      });
      try {
        const nonce = Buffer.alloc(32, 30).toString('base64url');
        const first = new LocalIdentityStateService({
          fileStore: state.store,
          repository: firstDatabase.repository,
          randomBytes: entropy(28, 29, 30),
        });
        await expect(first.initialize()).rejects.toThrow();
        const operationPath = join(state.root, 'identity.operation.json');
        const candidateName = `identity.pending-${nonce}.json`;
        const candidatePath = join(state.root, candidateName);
        if (residue === 'candidate-stage') {
          await link(
            candidatePath,
            join(state.root, `identity.stage-${nonce}-candidate.tmp`),
          );
        } else {
          await link(candidatePath, join(state.root, 'identity.json'));
        }

        const recoveryDatabase = fakeRepository({
          initialize: async () => 'matched',
        });
        const recovery = new LocalIdentityStateService({
          fileStore: state.store,
          repository: recoveryDatabase.repository,
          randomBytes: entropy(31),
        });
        const ready = await recovery.recoverInitialize();

        expect(ready).not.toBeNull();
        expect(await readdir(state.root)).toEqual(['identity.json']);
      } finally {
        await state.cleanup();
      }
    },
  );

  it.each(['initialize', 'rotate'] as const)(
    'compositionally normalizes coexisting operation and candidate publication residue for %s',
    async (kind) => {
      const state = await fixture();
      try {
        let expectedPrincipal: string;
        if (kind === 'initialize') {
          const interrupted = new LocalIdentityStateService({
            fileStore: state.store,
            repository: fakeRepository({
              initialize: async () => {
                throw new Error('Local identity recovery required');
              },
            }).repository,
            randomBytes: entropy(100, 101, 102),
          });
          await expect(interrupted.initialize()).rejects.toThrow(
            'Local identity recovery required',
          );
          expectedPrincipal = token(100);
        } else {
          const initialized = new LocalIdentityStateService({
            fileStore: state.store,
            repository: fakeRepository().repository,
            randomBytes: entropy(103, 104, 105),
          });
          const ready = await initialized.initialize();
          expectedPrincipal = ready.state.principalId;
          const interrupted = new LocalIdentityStateService({
            fileStore: state.store,
            repository: fakeRepository({
              verify: async () => {
                throw new Error('interrupted before rotation commit');
              },
            }).repository,
            randomBytes: entropy(106, 107),
          });
          await expect(interrupted.rotate()).rejects.toThrow(
            'interrupted before rotation commit',
          );
        }

        const names = await readdir(state.root);
        const candidateName = names.find((name) =>
          name.startsWith(
            kind === 'initialize' ? 'identity.pending-' : 'identity.rotate-',
          ),
        );
        if (!candidateName) throw new Error('missing recovery candidate');
        const nonce = candidateName
          .replace(/^identity\.(?:pending|rotate)-/u, '')
          .replace(/\.json$/u, '');
        await link(
          join(state.root, 'identity.operation.json'),
          join(state.root, `identity.stage-operation-${nonce}.tmp`),
        );
        await writeFile(
          join(state.root, `identity.stage-operation-${token(108)}.tmp`),
          Buffer.from('loser'),
          { mode: 0o600 },
        );
        await link(
          join(state.root, candidateName),
          join(state.root, `identity.stage-${nonce}-candidate.tmp`),
        );

        const database = fakeRepository({ initialize: async () => 'matched' });
        const recovery = new LocalIdentityStateService({
          fileStore: state.store,
          repository: database.repository,
          randomBytes: entropy(109),
        });
        const ready =
          kind === 'initialize'
            ? await recovery.recoverInitialize()
            : await recovery.recoverRotation();

        expect(ready?.state.principalId).toBe(expectedPrincipal);
        expect(await readdir(state.root)).toEqual(['identity.json']);
      } finally {
        await state.cleanup();
      }
    },
  );

  it.each(
    (['initialize', 'rotate'] as const).flatMap((kind) =>
      (['winner-operation', 'loser-operation', 'candidate'] as const).flatMap(
        (artifact) =>
          (['unlink', 'dir-fsync'] as const).map((boundary) => ({
            kind,
            artifact,
            boundary,
          })),
      ),
    ),
  )(
    're-enters $kind recovery after a crash at $artifact $boundary normalization',
    async ({ kind, artifact, boundary }) => {
      const state = await fixture();
      try {
        if (kind === 'initialize') {
          const interrupted = new LocalIdentityStateService({
            fileStore: state.store,
            repository: fakeRepository({
              initialize: async () => {
                throw new Error('Local identity recovery required');
              },
            }).repository,
            randomBytes: entropy(110, 111, 112),
          });
          await expect(interrupted.initialize()).rejects.toThrow(
            'Local identity recovery required',
          );
        } else {
          const initialized = new LocalIdentityStateService({
            fileStore: state.store,
            repository: fakeRepository().repository,
            randomBytes: entropy(113, 114, 115),
          });
          await initialized.initialize();
          const interrupted = new LocalIdentityStateService({
            fileStore: state.store,
            repository: fakeRepository({
              verify: async () => {
                throw new Error('interrupted before rotation commit');
              },
            }).repository,
            randomBytes: entropy(116, 117),
          });
          await expect(interrupted.rotate()).rejects.toThrow(
            'interrupted before rotation commit',
          );
        }

        const candidateName = (await readdir(state.root)).find((name) =>
          name.startsWith(
            kind === 'initialize' ? 'identity.pending-' : 'identity.rotate-',
          ),
        );
        if (!candidateName) throw new Error('missing recovery candidate');
        const nonce = candidateName
          .replace(/^identity\.(?:pending|rotate)-/u, '')
          .replace(/\.json$/u, '');
        const winnerOperationStage = `identity.stage-operation-${nonce}.tmp`;
        const loserOperationStage = `identity.stage-operation-${token(118)}.tmp`;
        const candidateStage = `identity.stage-${nonce}-candidate.tmp`;
        await link(
          join(state.root, 'identity.operation.json'),
          join(state.root, winnerOperationStage),
        );
        await writeFile(
          join(state.root, loserOperationStage),
          Buffer.from('x'),
          {
            mode: 0o600,
          },
        );
        await link(
          join(state.root, candidateName),
          join(state.root, candidateStage),
        );
        const target = {
          'winner-operation': winnerOperationStage,
          'loser-operation': loserOperationStage,
          candidate: candidateStage,
        }[artifact];
        const crash = crashAfterArtifactCleanup({
          root: state.root,
          basename: target,
          boundary,
        });
        const crashingRecovery = new LocalIdentityStateService({
          fileStore: new LocalIdentityFileStore({
            stateRoot: state.root,
            databaseTargetId: TARGET_ID,
            fileSystem: crash.fileSystem,
          }),
          repository: fakeRepository({ initialize: async () => 'matched' })
            .repository,
          randomBytes: entropy(119),
        });

        await expect(
          kind === 'initialize'
            ? crashingRecovery.recoverInitialize()
            : crashingRecovery.recoverRotation(),
        ).rejects.toThrow();
        expect(crash.fired()).toBe(true);

        const cleanRecovery = new LocalIdentityStateService({
          fileStore: state.store,
          repository: fakeRepository({ initialize: async () => 'matched' })
            .repository,
          randomBytes: entropy(120),
        });
        await expect(
          kind === 'initialize'
            ? cleanRecovery.recoverInitialize()
            : cleanRecovery.recoverRotation(),
        ).resolves.toBeTruthy();
        expect(await readdir(state.root)).toEqual(['identity.json']);
      } finally {
        await state.cleanup();
      }
    },
  );

  it('recovers a published operation with its same-inode redundant stage before candidate publication without consulting user rows', async () => {
    const state = await fixture();
    const database = fakeRepository();
    try {
      await mkdir(state.root, { mode: 0o700 });
      const nonce = token(36);
      const operation = createInitializeOperation({
        databaseTargetId: TARGET_ID,
        nonce,
        proposedStateDigest: token(37),
      });
      const operationPath = join(state.root, 'identity.operation.json');
      await writeFile(operationPath, encodeLocalIdentityOperation(operation), {
        mode: 0o600,
      });
      await link(
        operationPath,
        join(state.root, `identity.stage-operation-${nonce}.tmp`),
      );
      const service = new LocalIdentityStateService({
        fileStore: state.store,
        repository: database.repository,
        randomBytes: entropy(38),
      });

      await expect(service.recoverInitialize()).resolves.toBeNull();
      expect(database.session.verifyEmpty).not.toHaveBeenCalled();
      expect(database.session.verify).not.toHaveBeenCalled();
      expect(await readdir(state.root)).toEqual([]);
    } finally {
      await state.cleanup();
    }
  });

  it('removes operation-only pre-candidate initialization without consulting user rows', async () => {
    const state = await fixture();
    const database = fakeRepository();
    try {
      await mkdir(state.root, { mode: 0o700 });
      const operation = createInitializeOperation({
        databaseTargetId: TARGET_ID,
        nonce: token(11),
        proposedStateDigest: token(12),
      });
      await writeFile(
        join(state.root, 'identity.operation.json'),
        encodeLocalIdentityOperation(operation),
        { mode: 0o600 },
      );
      const service = new LocalIdentityStateService({
        fileStore: state.store,
        repository: database.repository,
        randomBytes: entropy(11),
      });

      await expect(service.recoverInitialize()).resolves.toBeNull();
      expect(database.session.verifyEmpty).not.toHaveBeenCalled();
      expect(database.session.verify).not.toHaveBeenCalled();
      expect(await readdir(state.root)).toEqual([]);
    } finally {
      await state.cleanup();
    }
  });

  it('uses a published no-mutation recovery mutex to clean bounded orphan operation stages', async () => {
    const state = await fixture();
    try {
      await mkdir(state.root, { mode: 0o700 });
      const orphanOne = `identity.stage-operation-${token(13)}.tmp`;
      const orphanTwo = `identity.stage-operation-${token(14)}.tmp`;
      await writeFile(join(state.root, orphanOne), Buffer.from('partial'), {
        mode: 0o600,
      });
      await writeFile(join(state.root, orphanTwo), Buffer.alloc(0), {
        mode: 0o600,
      });
      const session = {
        initialize: jest.fn(),
        verify: jest.fn(),
        verifyEmpty: jest.fn(),
        release: jest.fn(async () => undefined),
        destroy: jest.fn(),
        assertHeld: jest.fn(),
      };
      const service = new LocalIdentityStateService({
        fileStore: state.store,
        repository: {
          acquire: jest.fn(
            async () => session as unknown as LocalIdentityDatabaseSession,
          ),
        },
        randomBytes: entropy(12),
      });

      await expect(service.recoverInitialize()).resolves.toBeNull();
      expect(await readdir(state.root)).toEqual([]);
      expect(session.verifyEmpty).not.toHaveBeenCalled();
      expect(session.verify).not.toHaveBeenCalled();
    } finally {
      await state.cleanup();
    }
  });

  it.each([0, 1, 3])(
    're-enters a published orphan-recovery operation with %i pre-existing stages',
    async (orphanCount) => {
      const state = await fixture();
      const database = fakeRepository();
      try {
        await mkdir(state.root, { mode: 0o700 });
        const orphans = Array.from(
          { length: orphanCount },
          (_, index) => `identity.stage-operation-${token(180 + index)}.tmp`,
        );
        for (const [index, name] of orphans.entries()) {
          await writeFile(join(state.root, name), Buffer.from([index]), {
            mode: 0o600,
          });
        }
        const publicationCrash = crashAfterBoundary({
          root: state.root,
          boundary: 'operation.stage.dir-fsync',
        });
        const interrupted = new LocalIdentityStateService({
          fileStore: new LocalIdentityFileStore({
            stateRoot: state.root,
            databaseTargetId: TARGET_ID,
            fileSystem: publicationCrash.fileSystem,
          }),
          repository: database.repository,
          randomBytes: entropy(190),
        });

        await expect(interrupted.recoverInitialize()).rejects.toThrow();
        expect(publicationCrash.fired()).toBe(true);
        expect((await readdir(state.root)).sort()).toEqual(
          ['identity.operation.json', ...orphans].sort(),
        );

        const recovery = new LocalIdentityStateService({
          fileStore: state.store,
          repository: database.repository,
          randomBytes: entropy(191),
        });
        await expect(recovery.recoverInitialize()).resolves.toBeNull();
        expect(await readdir(state.root)).toEqual([]);
        expect(database.session.verify).not.toHaveBeenCalled();
        expect(database.session.verifyEmpty).not.toHaveBeenCalled();
      } finally {
        await state.cleanup();
      }
    },
  );

  it.each(
    [
      { orphanCount: 1, targetIndex: 0 },
      { orphanCount: 3, targetIndex: 0 },
      { orphanCount: 3, targetIndex: 1 },
      { orphanCount: 3, targetIndex: 2 },
    ].flatMap(({ orphanCount, targetIndex }) =>
      (['unlink', 'dir-fsync'] as const).map((boundary) => ({
        orphanCount,
        targetIndex,
        boundary,
      })),
    ),
  )(
    're-enters orphan recovery after stage $targetIndex/$orphanCount $boundary',
    async ({ orphanCount, targetIndex, boundary }) => {
      const state = await fixture();
      try {
        await mkdir(state.root, { mode: 0o700 });
        const orphans = Array.from(
          { length: orphanCount },
          (_, index) => `identity.stage-operation-${token(200 + index)}.tmp`,
        ).sort();
        for (const [index, name] of orphans.entries()) {
          await writeFile(join(state.root, name), Buffer.from([index]), {
            mode: 0o600,
          });
        }
        const publicationCrash = crashAfterBoundary({
          root: state.root,
          boundary: 'operation.stage.dir-fsync',
        });
        const publication = new LocalIdentityStateService({
          fileStore: new LocalIdentityFileStore({
            stateRoot: state.root,
            databaseTargetId: TARGET_ID,
            fileSystem: publicationCrash.fileSystem,
          }),
          repository: fakeRepository().repository,
          randomBytes: entropy(210),
        });
        await expect(publication.recoverInitialize()).rejects.toThrow();
        expect(publicationCrash.fired()).toBe(true);

        const cleanupCrash = crashAfterArtifactCleanup({
          root: state.root,
          basename: orphans[targetIndex],
          boundary,
        });
        const interrupted = new LocalIdentityStateService({
          fileStore: new LocalIdentityFileStore({
            stateRoot: state.root,
            databaseTargetId: TARGET_ID,
            fileSystem: cleanupCrash.fileSystem,
          }),
          repository: fakeRepository().repository,
          randomBytes: entropy(211),
        });

        await expect(interrupted.recoverInitialize()).rejects.toThrow();
        expect(cleanupCrash.fired()).toBe(true);
        expect(await readdir(state.root)).toContain('identity.operation.json');

        const recovery = new LocalIdentityStateService({
          fileStore: state.store,
          repository: fakeRepository().repository,
          randomBytes: entropy(212),
        });
        await expect(recovery.recoverInitialize()).resolves.toBeNull();
        expect(await readdir(state.root)).toEqual([]);
      } finally {
        await state.cleanup();
      }
    },
  );

  it.each(
    [0, 1, 3].flatMap((orphanCount) =>
      (['unlink', 'dir-fsync'] as const).map((boundary) => ({
        orphanCount,
        boundary,
      })),
    ),
  )(
    're-enters $orphanCount-stage orphan recovery after final operation $boundary',
    async ({ orphanCount, boundary }) => {
      const state = await fixture();
      try {
        await mkdir(state.root, { mode: 0o700 });
        for (let index = 0; index < orphanCount; index += 1) {
          await writeFile(
            join(
              state.root,
              `identity.stage-operation-${token(220 + index)}.tmp`,
            ),
            Buffer.from([index]),
            { mode: 0o600 },
          );
        }
        const publicationCrash = crashAfterBoundary({
          root: state.root,
          boundary: 'operation.stage.dir-fsync',
        });
        const publication = new LocalIdentityStateService({
          fileStore: new LocalIdentityFileStore({
            stateRoot: state.root,
            databaseTargetId: TARGET_ID,
            fileSystem: publicationCrash.fileSystem,
          }),
          repository: fakeRepository().repository,
          randomBytes: entropy(230),
        });
        await expect(publication.recoverInitialize()).rejects.toThrow();
        expect(publicationCrash.fired()).toBe(true);

        const cleanupCrash = crashAfterArtifactCleanup({
          root: state.root,
          basename: 'identity.operation.json',
          boundary,
        });
        const interrupted = new LocalIdentityStateService({
          fileStore: new LocalIdentityFileStore({
            stateRoot: state.root,
            databaseTargetId: TARGET_ID,
            fileSystem: cleanupCrash.fileSystem,
          }),
          repository: fakeRepository().repository,
          randomBytes: entropy(231),
        });

        await expect(interrupted.recoverInitialize()).rejects.toThrow();
        expect(cleanupCrash.fired()).toBe(true);
        expect(await readdir(state.root)).toEqual([]);

        const recovery = new LocalIdentityStateService({
          fileStore: state.store,
          repository: fakeRepository().repository,
          randomBytes: entropy(232),
        });
        await expect(recovery.recoverInitialize()).resolves.toBeNull();
        expect(await readdir(state.root)).toEqual([]);
      } finally {
        await state.cleanup();
      }
    },
  );

  it('cleans pre-existing orphan stages even when the database contains a different principal', async () => {
    const state = await fixture();
    try {
      await mkdir(state.root, { mode: 0o700 });
      const orphan = `identity.stage-operation-${token(40)}.tmp`;
      await writeFile(join(state.root, orphan), Buffer.from('partial'), {
        mode: 0o600,
      });
      const database = fakeRepository({
        verifyEmpty: async () => {
          throw new Error('Local identity database state conflict');
        },
        verify: async () => {
          throw new Error('Local identity database state conflict');
        },
      });
      const service = new LocalIdentityStateService({
        fileStore: state.store,
        repository: database.repository,
        randomBytes: entropy(41),
      });

      await expect(service.recoverInitialize()).resolves.toBeNull();
      expect(database.session.verifyEmpty).not.toHaveBeenCalled();
      expect(database.session.verify).not.toHaveBeenCalled();
      expect(await readdir(state.root)).toEqual([]);
    } finally {
      await state.cleanup();
    }
  });

  it('removes only its recovery mutex when another database wins the shared-root orphan race', async () => {
    const state = await fixture();
    const otherTarget = token(60);
    const orphan = `identity.stage-operation-${token(61)}.tmp`;
    let injected = false;
    try {
      await mkdir(state.root, { mode: 0o700 });
      await writeFile(join(state.root, orphan), Buffer.from('partial'), {
        mode: 0o600,
      });
      const otherState = encodeLocalIdentityState({
        schemaVersion: 1,
        databaseTargetId: otherTarget,
        principalId: token(62),
        credential: token(63),
        generation: 1,
      });
      const adversarial: LocalIdentityFileSystem = {
        ...nodeLocalIdentityFileSystem,
        async link(existingPath, newPath) {
          if (!injected && newPath.endsWith('/identity.operation.json')) {
            injected = true;
            await rm(join(state.root, orphan));
            await writeFile(join(state.root, 'identity.json'), otherState, {
              mode: 0o600,
            });
          }
          return nodeLocalIdentityFileSystem.link(existingPath, newPath);
        },
      };
      const service = new LocalIdentityStateService({
        fileStore: new LocalIdentityFileStore({
          stateRoot: state.root,
          databaseTargetId: TARGET_ID,
          fileSystem: adversarial,
        }),
        repository: fakeRepository().repository,
        randomBytes: entropy(64),
      });

      await expect(service.recoverInitialize()).rejects.toThrow(
        'Local identity target mismatch',
      );
      expect(await readdir(state.root)).toEqual(['identity.json']);
      expect(await readFile(join(state.root, 'identity.json'))).toEqual(
        otherState,
      );
    } finally {
      await state.cleanup();
    }
  });

  it('rotates only the credential and generation while retaining the principal and database target', async () => {
    const state = await fixture();
    const initializeDatabase = fakeRepository();
    try {
      const initialize = new LocalIdentityStateService({
        fileStore: state.store,
        repository: initializeDatabase.repository,
        randomBytes: entropy(13, 14, 15),
      });
      const first = await initialize.initialize();
      const rotateDatabase = fakeRepository();
      const rotate = new LocalIdentityStateService({
        fileStore: state.store,
        repository: rotateDatabase.repository,
        randomBytes: entropy(16, 17),
      });

      const second = await rotate.rotate();

      expect(second.state).toEqual({
        ...first.state,
        credential: Buffer.alloc(32, 16).toString('base64url'),
        generation: 2,
      });
      expect(rotateDatabase.session.verify).toHaveBeenCalledWith(first.state);
      expect(await readdir(state.root)).toEqual(['identity.json']);
    } finally {
      await state.cleanup();
    }
  });

  it.each(ROTATION_CRASH_CASES)(
    'converges after a rotation crash at $boundary to the exact $expected state',
    async ({ boundary, expected }) => {
      const state = await fixture();
      const database: StatefulDatabase = { state: null };
      try {
        const initialize = new LocalIdentityStateService({
          fileStore: state.store,
          repository: statefulRepository(database),
          randomBytes: entropy(90, 91, 92),
        });
        const oldReady = await initialize.initialize();
        const crash = crashAfterBoundary({ root: state.root, boundary });
        const rotate = new LocalIdentityStateService({
          fileStore: new LocalIdentityFileStore({
            stateRoot: state.root,
            databaseTargetId: TARGET_ID,
            fileSystem: crash.fileSystem,
          }),
          repository: statefulRepository(database),
          randomBytes: entropy(93, 94),
        });

        await expect(rotate.rotate()).rejects.toThrow();
        expect(crash.fired()).toBe(true);

        const recovery = new LocalIdentityStateService({
          fileStore: state.store,
          repository: statefulRepository(database),
          randomBytes: entropy(95),
        });
        const ready = await recovery.recoverRotation();

        expect(await readdir(state.root)).toEqual(['identity.json']);
        expect(ready.state.principalId).toBe(oldReady.state.principalId);
        expect(ready.state.generation).toBe(expected === 'old' ? 1 : 2);
        expect(ready.state.credential).toBe(
          expected === 'old' ? token(91) : token(93),
        );
        expect(database.state?.principalId).toBe(oldReady.state.principalId);
      } finally {
        await state.cleanup();
      }
    },
  );

  it('recovers a large valid orphan-stage set without an arbitrary pathname cap', async () => {
    const state = await fixture();
    try {
      await mkdir(state.root, { mode: 0o700 });
      for (let index = 0; index < 65; index += 1) {
        await writeFile(
          join(
            state.root,
            `identity.stage-operation-${token(100 + index)}.tmp`,
          ),
          Buffer.from([index]),
          { mode: 0o600 },
        );
      }
      const database = fakeRepository();
      const recovery = new LocalIdentityStateService({
        fileStore: state.store,
        repository: database.repository,
        randomBytes: entropy(170),
      });

      await expect(recovery.recoverInitialize()).resolves.toBeNull();
      expect(database.session.verifyEmpty).not.toHaveBeenCalled();
      expect(await readdir(state.root)).toEqual([]);
    } finally {
      await state.cleanup();
    }
  });

  it('recovers a 64-path post-link orphan set one durable removal at a time through zero', async () => {
    const state = await fixture();
    const database: StatefulDatabase = { state: null };
    try {
      await mkdir(state.root, { mode: 0o700 });
      for (let index = 0; index < 62; index += 1) {
        await writeFile(
          join(
            state.root,
            `identity.stage-operation-${token(100 + index)}.tmp`,
          ),
          Buffer.from([index]),
          { mode: 0o600 },
        );
      }
      const publicationCrash = crashAfterBoundary({
        root: state.root,
        boundary: 'operation.publish.link',
      });
      const firstRecovery = new LocalIdentityStateService({
        fileStore: new LocalIdentityFileStore({
          stateRoot: state.root,
          databaseTargetId: TARGET_ID,
          fileSystem: publicationCrash.fileSystem,
        }),
        repository: statefulRepository(database),
        randomBytes: entropy(162),
      });

      await expect(firstRecovery.recoverInitialize()).rejects.toThrow();
      expect(publicationCrash.fired()).toBe(true);
      expect((await readdir(state.root)).length).toBe(64);

      for (let remaining = 63; remaining > 0; remaining -= 1) {
        const cleanupCrash = crashAfterBoundary({
          root: state.root,
          boundary: 'recovery-stage.cleanup-dir-fsync',
        });
        const recovery = new LocalIdentityStateService({
          fileStore: new LocalIdentityFileStore({
            stateRoot: state.root,
            databaseTargetId: TARGET_ID,
            fileSystem: cleanupCrash.fileSystem,
          }),
          repository: statefulRepository(database),
          randomBytes: entropy(163),
        });

        await expect(recovery.recoverInitialize()).rejects.toThrow();
        expect(cleanupCrash.fired()).toBe(true);
        const names = await readdir(state.root);
        expect(names).toContain('identity.operation.json');
        expect(
          names.filter((name) => name.startsWith('identity.stage-operation-')),
        ).toHaveLength(remaining - 1);
      }

      const finalRecovery = new LocalIdentityStateService({
        fileStore: state.store,
        repository: statefulRepository(database),
        randomBytes: entropy(164),
      });
      await expect(finalRecovery.recoverInitialize()).resolves.toBeNull();
      expect(await readdir(state.root)).toEqual([]);
      expect(database.state).toBeNull();
    } finally {
      await state.cleanup();
    }
  }, 30_000);

  it('rejects rotation entropy that would expose the new credential as the operation nonce', async () => {
    const state = await fixture();
    try {
      const initialize = new LocalIdentityStateService({
        fileStore: state.store,
        repository: fakeRepository().repository,
        randomBytes: entropy(65, 66, 67),
      });
      const ready = await initialize.initialize();
      const before = await artifactSnapshot(state.root);
      const database = fakeRepository();
      const rotate = new LocalIdentityStateService({
        fileStore: state.store,
        repository: database.repository,
        randomBytes: entropy(68, 68),
      });

      await expect(rotate.rotate()).rejects.toThrow(
        'Local identity entropy failure',
      );
      expect(database.session.verify).not.toHaveBeenCalled();
      expect(await artifactSnapshot(state.root)).toEqual(before);
      expect((await state.store.openReadyState()).state).toEqual(ready.state);
    } finally {
      await state.cleanup();
    }
  });

  it.each([
    ['principal', 65],
    ['database target', 1],
  ] as const)(
    'rejects rotation entropy that aliases the new credential to the %s',
    async (_name, credentialFill) => {
      const state = await fixture();
      try {
        const initialize = new LocalIdentityStateService({
          fileStore: state.store,
          repository: fakeRepository().repository,
          randomBytes: entropy(65, 66, 67),
        });
        const ready = await initialize.initialize();
        const before = await artifactSnapshot(state.root);
        const database = fakeRepository();
        const rotate = new LocalIdentityStateService({
          fileStore: state.store,
          repository: database.repository,
          randomBytes: entropy(credentialFill, 69),
        });

        await expect(rotate.rotate()).rejects.toThrow(
          'Local identity entropy failure',
        );
        expect(database.session.verify).not.toHaveBeenCalled();
        expect(await artifactSnapshot(state.root)).toEqual(before);
        expect((await state.store.openReadyState()).state).toEqual(ready.state);
      } finally {
        await state.cleanup();
      }
    },
  );

  it('holds the recovery mutex through orphan rotation-stage cleanup without consulting user rows', async () => {
    const state = await fixture();
    try {
      const initialized = new LocalIdentityStateService({
        fileStore: state.store,
        repository: fakeRepository().repository,
        randomBytes: entropy(69, 70, 71),
      });
      const ready = await initialized.initialize();
      const orphan = `identity.stage-operation-${token(72)}.tmp`;
      await writeFile(join(state.root, orphan), Buffer.from('partial'), {
        mode: 0o600,
      });
      const session = {
        initialize: jest.fn(),
        verify: jest.fn(),
        verifyEmpty: jest.fn(),
        release: jest.fn(async () => undefined),
        destroy: jest.fn(),
        assertHeld: jest.fn(),
      };
      const recovery = new LocalIdentityStateService({
        fileStore: state.store,
        repository: {
          acquire: jest.fn(
            async () => session as unknown as LocalIdentityDatabaseSession,
          ),
        },
        randomBytes: entropy(73),
      });

      await expect(recovery.recoverRotation()).resolves.toEqual(ready);
      expect(await readdir(state.root)).toEqual(['identity.json']);
      expect(session.verify).not.toHaveBeenCalled();
    } finally {
      await state.cleanup();
    }
  });

  it('recovers a pre-rename rotation by keeping the old credential and discarding the candidate', async () => {
    const state = await fixture();
    try {
      const initialized = new LocalIdentityStateService({
        fileStore: state.store,
        repository: fakeRepository().repository,
        randomBytes: entropy(18, 19, 20),
      });
      const oldReady = await initialized.initialize();
      const failingDatabase = fakeRepository({
        verify: async () => {
          throw new Error('interrupted-before-rename');
        },
      });
      const rotate = new LocalIdentityStateService({
        fileStore: state.store,
        repository: failingDatabase.repository,
        randomBytes: entropy(21, 22),
      });
      await expect(rotate.rotate()).rejects.toThrow(
        'interrupted-before-rename',
      );

      const recoveryDatabase = fakeRepository();
      const recovery = new LocalIdentityStateService({
        fileStore: state.store,
        repository: recoveryDatabase.repository,
        randomBytes: entropy(23),
      });
      const recovered = await recovery.recoverRotation();

      expect(recovered).toEqual(oldReady);
      expect(await readdir(state.root)).toEqual(['identity.json']);
      expect(recoveryDatabase.session.verify).toHaveBeenCalledWith(
        oldReady.state,
        expect.any(Function),
      );
    } finally {
      await state.cleanup();
    }
  });

  it('recovers a post-rename rotation by retaining the new canonical generation', async () => {
    const state = await fixture();
    const database = fakeRepository();
    try {
      await mkdir(state.root, { mode: 0o700 });
      const oldBytes = encodeLocalIdentityState({
        schemaVersion: 1,
        databaseTargetId: TARGET_ID,
        principalId: token(16),
        credential: token(17),
        generation: 1,
      });
      const newBytes = encodeLocalIdentityState({
        ...decodeLocalIdentityState(oldBytes),
        credential: token(18),
        generation: 2,
      });
      const operation = createRotationOperation({
        databaseTargetId: TARGET_ID,
        nonce: token(19),
        baseGeneration: 1,
        baseStateDigest: digestLocalIdentityState(oldBytes),
        proposedStateDigest: digestLocalIdentityState(newBytes),
      });
      await writeFile(join(state.root, 'identity.json'), newBytes, {
        mode: 0o600,
      });
      await writeFile(
        join(state.root, 'identity.operation.json'),
        encodeLocalIdentityOperation(operation),
        { mode: 0o600 },
      );
      const service = new LocalIdentityStateService({
        fileStore: state.store,
        repository: database.repository,
        randomBytes: entropy(24),
      });

      const ready = await service.recoverRotation();

      expect(ready.state.generation).toBe(2);
      expect(ready.state.credential).toBe(token(18));
      expect(database.session.verify).toHaveBeenCalledWith(
        ready.state,
        expect.any(Function),
      );
      expect(await readdir(state.root)).toEqual(['identity.json']);
    } finally {
      await state.cleanup();
    }
  });

  it('fails wrong-target recovery without deleting any artifact', async () => {
    const state = await fixture();
    try {
      await mkdir(state.root, { mode: 0o700 });
      const operation = createRecoveryOperation({
        databaseTargetId: token(26),
        nonce: token(20),
      });
      const bytes = encodeLocalIdentityOperation(operation);
      await writeFile(join(state.root, 'identity.operation.json'), bytes, {
        mode: 0o600,
      });
      const service = new LocalIdentityStateService({
        fileStore: state.store,
        repository: fakeRepository().repository,
        randomBytes: entropy(25),
      });

      await expect(service.recoverInitialize()).rejects.toThrow(
        'Local identity target mismatch',
      );
      await expect(
        readFile(join(state.root, 'identity.operation.json')),
      ).resolves.toEqual(bytes);
    } finally {
      await state.cleanup();
    }
  });
});
