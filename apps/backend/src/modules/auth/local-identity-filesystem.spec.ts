import { constants } from 'node:fs';
import {
  chmod,
  link,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import {
  type LocalIdentityFileHandle,
  type LocalIdentityFileSystem,
  LocalIdentityFileStore,
  nodeLocalIdentityFileSystem,
} from './local-identity-filesystem';
import {
  createInitializeOperation,
  createRotationOperation,
  digestLocalIdentityState,
  encodeLocalIdentityOperation,
  encodeLocalIdentityState,
} from './local-identity-state.codec';

const token = (fill: number) => Buffer.alloc(32, fill).toString('base64url');
const TARGET_ID = token(1);
const PRINCIPAL_ID = token(2);
const CREDENTIAL = token(3);
const NEXT_CREDENTIAL = token(4);
const NONCE = token(5);

function stateBytes(generation = 1, credential = CREDENTIAL): Buffer {
  return encodeLocalIdentityState({
    schemaVersion: 1,
    databaseTargetId: TARGET_ID,
    principalId: PRINCIPAL_ID,
    credential,
    generation,
  });
}

async function secureFixture(): Promise<{
  parent: string;
  root: string;
  cleanup: () => Promise<void>;
}> {
  const created = await mkdtemp(join(tmpdir(), 'local-identity-fs-'));
  await chmod(created, 0o700);
  const parent = await realpath(created);
  return {
    parent,
    root: join(parent, 'state'),
    cleanup: () => rm(parent, { recursive: true, force: true }),
  };
}

function operationFor(bytes: Buffer) {
  return createInitializeOperation({
    databaseTargetId: TARGET_ID,
    nonce: NONCE,
    proposedStateDigest: digestLocalIdentityState(bytes),
  });
}

function traceFileSystem(trace: string[]): LocalIdentityFileSystem {
  return {
    ...nodeLocalIdentityFileSystem,
    async open(path, flags, mode) {
      trace.push(`open:${basename(path)}`);
      const handle = await nodeLocalIdentityFileSystem.open(path, flags, mode);
      return {
        async writeFile(bytes) {
          trace.push(`write:${basename(path)}`);
          return handle.writeFile(bytes);
        },
        async readFile() {
          trace.push(`read:${basename(path)}`);
          return handle.readFile();
        },
        async stat() {
          trace.push(`fstat:${basename(path)}`);
          return handle.stat();
        },
        async sync() {
          trace.push(`fsync:${basename(path)}`);
          return handle.sync();
        },
        async close() {
          trace.push(`close:${basename(path)}`);
          return handle.close();
        },
      } satisfies LocalIdentityFileHandle;
    },
    async link(existingPath, newPath) {
      trace.push(`link:${basename(existingPath)}->${basename(newPath)}`);
      return nodeLocalIdentityFileSystem.link(existingPath, newPath);
    },
    async unlink(path) {
      trace.push(`unlink:${basename(path)}`);
      return nodeLocalIdentityFileSystem.unlink(path);
    },
    async rename(oldPath, newPath) {
      trace.push(`rename:${basename(oldPath)}->${basename(newPath)}`);
      return nodeLocalIdentityFileSystem.rename(oldPath, newPath);
    },
  };
}

function expectOrdered(trace: string[], expected: string[]): void {
  let index = -1;
  for (const item of expected) {
    index = trace.indexOf(item, index + 1);
    expect(index).toBeGreaterThanOrEqual(0);
  }
}

function overrideStats(
  stats: Awaited<ReturnType<LocalIdentityFileSystem['lstat']>>,
  overrides: Record<PropertyKey, unknown>,
): Awaited<ReturnType<LocalIdentityFileSystem['lstat']>> {
  return new Proxy(stats, {
    get(target, property) {
      if (Object.prototype.hasOwnProperty.call(overrides, property)) {
        return overrides[property];
      }
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

describe('LocalIdentityFileStore', () => {
  it('creates only a 0700 state root beneath an existing current-UID 0700 parent', async () => {
    const fixture = await secureFixture();
    try {
      const store = new LocalIdentityFileStore({
        stateRoot: fixture.root,
        databaseTargetId: TARGET_ID,
      });
      const lease = await store.prepareRoot({ create: true });

      expect(lease.path).toBe(fixture.root);
      expect((await stat(fixture.root)).mode & 0o7777).toBe(0o700);
      await expect(readdir(fixture.root)).resolves.toEqual([]);
    } finally {
      await fixture.cleanup();
    }
  });

  it('refuses missing roots beneath loose parents and unsafe existing ancestry', async () => {
    const fixture = await secureFixture();
    try {
      await chmod(fixture.parent, 0o755);
      const missingStore = new LocalIdentityFileStore({
        stateRoot: fixture.root,
        databaseTargetId: TARGET_ID,
      });
      await expect(missingStore.prepareRoot({ create: true })).rejects.toThrow(
        'Unsafe local identity state',
      );
      await mkdir(fixture.root, { mode: 0o700 });
      await chmod(fixture.root, 0o755);
      await expect(missingStore.prepareRoot({ create: false })).rejects.toThrow(
        'Unsafe local identity state',
      );
    } finally {
      await fixture.cleanup();
    }
  });

  it('rejects symlinked and group-writable ancestry beneath the trusted sticky anchor', async () => {
    const fixture = await secureFixture();
    try {
      const realParent = join(fixture.parent, 'real-parent');
      const linkedParent = join(fixture.parent, 'linked-parent');
      await mkdir(realParent, { mode: 0o700 });
      await symlink(realParent, linkedParent);
      const linkedStore = new LocalIdentityFileStore({
        stateRoot: join(linkedParent, 'state'),
        databaseTargetId: TARGET_ID,
      });
      await expect(linkedStore.prepareRoot({ create: true })).rejects.toThrow(
        'Unsafe local identity state',
      );

      const looseParent = join(fixture.parent, 'loose-parent');
      await mkdir(looseParent, { mode: 0o770 });
      const looseStore = new LocalIdentityFileStore({
        stateRoot: join(looseParent, 'state'),
        databaseTargetId: TARGET_ID,
      });
      await expect(looseStore.prepareRoot({ create: true })).rejects.toThrow(
        'Unsafe local identity state',
      );
    } finally {
      await fixture.cleanup();
    }
  });

  it('rejects foreign-owner roots and artifacts before opening their contents', async () => {
    const fixture = await secureFixture();
    try {
      await mkdir(fixture.root, { mode: 0o700 });
      const canonical = join(fixture.root, 'identity.json');
      await writeFile(canonical, stateBytes(), { mode: 0o600 });
      const foreignRootFileSystem: LocalIdentityFileSystem = {
        ...nodeLocalIdentityFileSystem,
        async lstat(path) {
          const stats = await nodeLocalIdentityFileSystem.lstat(path);
          return path === fixture.root
            ? overrideStats(stats, { uid: stats.uid + 1n })
            : stats;
        },
      };
      const foreignRoot = new LocalIdentityFileStore({
        stateRoot: fixture.root,
        databaseTargetId: TARGET_ID,
        fileSystem: foreignRootFileSystem,
      });
      await expect(foreignRoot.openReadyState()).rejects.toThrow(
        'Unsafe local identity state',
      );

      let openedCanonical = false;
      const foreignArtifactFileSystem: LocalIdentityFileSystem = {
        ...nodeLocalIdentityFileSystem,
        async lstat(path) {
          const stats = await nodeLocalIdentityFileSystem.lstat(path);
          return path === canonical
            ? overrideStats(stats, { uid: stats.uid + 1n })
            : stats;
        },
        async open(path, flags, mode) {
          if (path === canonical) openedCanonical = true;
          return nodeLocalIdentityFileSystem.open(path, flags, mode);
        },
      };
      const foreignArtifact = new LocalIdentityFileStore({
        stateRoot: fixture.root,
        databaseTargetId: TARGET_ID,
        fileSystem: foreignArtifactFileSystem,
      });
      await expect(foreignArtifact.openReadyState()).rejects.toThrow(
        'Unsafe local identity state',
      );
      expect(openedCanonical).toBe(false);
    } finally {
      await fixture.cleanup();
    }
  });

  it.each([
    'identity.json',
    'identity.operation.json',
    `identity.pending-${NONCE}.json`,
    `identity.rotate-${NONCE}.json`,
    `identity.stage-operation-${NONCE}.tmp`,
    `identity.stage-${NONCE}-candidate.tmp`,
  ])('rejects a nonregular %s artifact without opening it', async (name) => {
    const fixture = await secureFixture();
    let openedArtifact = false;
    try {
      await mkdir(fixture.root, { mode: 0o700 });
      await mkdir(join(fixture.root, name), { mode: 0o700 });
      const fileSystem: LocalIdentityFileSystem = {
        ...nodeLocalIdentityFileSystem,
        async open(path, flags, mode) {
          if (path === join(fixture.root, name)) openedArtifact = true;
          return nodeLocalIdentityFileSystem.open(path, flags, mode);
        },
      };
      const store = new LocalIdentityFileStore({
        stateRoot: fixture.root,
        databaseTargetId: TARGET_ID,
        fileSystem,
      });
      const lease = await store.prepareRoot({ create: false });

      await expect(store.inspect(lease)).rejects.toThrow(
        'Unsafe local identity state',
      );
      expect(openedArtifact).toBe(false);
    } finally {
      await fixture.cleanup();
    }
  });

  it('opens only the exact target-matching canonical file at successful rest', async () => {
    const fixture = await secureFixture();
    try {
      await mkdir(fixture.root, { mode: 0o700 });
      await writeFile(join(fixture.root, 'identity.json'), stateBytes(), {
        mode: 0o600,
      });
      const store = new LocalIdentityFileStore({
        stateRoot: fixture.root,
        databaseTargetId: TARGET_ID,
      });

      const ready = await store.openReadyState();
      expect(ready.state).toMatchObject({
        databaseTargetId: TARGET_ID,
        principalId: PRINCIPAL_ID,
        generation: 1,
      });
      expect(ready.bytes).toEqual(stateBytes());
      expect(ready.digest).toBe(digestLocalIdentityState(stateBytes()));

      await writeFile(join(fixture.root, 'unexpected'), 'x', { mode: 0o600 });
      await expect(store.openReadyState()).rejects.toThrow(
        'Unsafe local identity state',
      );
    } finally {
      await fixture.cleanup();
    }
  });

  it('rejects canonical symlinks, hardlinks, loose modes, and wrong targets', async () => {
    const fixture = await secureFixture();
    try {
      await mkdir(fixture.root, { mode: 0o700 });
      const canonical = join(fixture.root, 'identity.json');
      const outside = join(fixture.parent, 'outside.json');
      const store = new LocalIdentityFileStore({
        stateRoot: fixture.root,
        databaseTargetId: TARGET_ID,
      });

      await writeFile(outside, stateBytes(), { mode: 0o600 });
      await symlink(outside, canonical);
      await expect(store.openReadyState()).rejects.toThrow(
        'Unsafe local identity state',
      );
      await unlink(canonical);

      await link(outside, canonical);
      await expect(store.openReadyState()).rejects.toThrow(
        'Unsafe local identity state',
      );
      await unlink(canonical);

      await writeFile(canonical, stateBytes(), { mode: 0o644 });
      await expect(store.openReadyState()).rejects.toThrow(
        'Unsafe local identity state',
      );
      await unlink(canonical);

      await writeFile(
        canonical,
        encodeLocalIdentityState({
          schemaVersion: 1,
          databaseTargetId: token(26),
          principalId: PRINCIPAL_ID,
          credential: CREDENTIAL,
          generation: 1,
        }),
        { mode: 0o600 },
      );
      await expect(store.openReadyState()).rejects.toThrow(
        'Local identity target mismatch',
      );
    } finally {
      await fixture.cleanup();
    }
  });

  it('refuses a canonical read when an operation appears between enumeration and the file read', async () => {
    const fixture = await secureFixture();
    let injected = false;
    try {
      await mkdir(fixture.root, { mode: 0o700 });
      const bytes = stateBytes();
      await writeFile(join(fixture.root, 'identity.json'), bytes, {
        mode: 0o600,
      });
      const operation = operationFor(bytes);
      const adversarial: LocalIdentityFileSystem = {
        ...nodeLocalIdentityFileSystem,
        async open(path, flags, mode) {
          if (!injected && basename(path) === 'identity.json') {
            injected = true;
            await writeFile(
              join(fixture.root, 'identity.operation.json'),
              encodeLocalIdentityOperation(operation),
              { mode: 0o600 },
            );
          }
          return nodeLocalIdentityFileSystem.open(path, flags, mode);
        },
      };
      const store = new LocalIdentityFileStore({
        stateRoot: fixture.root,
        databaseTargetId: TARGET_ID,
        fileSystem: adversarial,
      });

      await expect(store.openReadyState()).rejects.toThrow(
        'Unsafe local identity state',
      );
    } finally {
      await fixture.cleanup();
    }
  });

  it('refuses a stale canonical descriptor after a complete concurrent replacement', async () => {
    const fixture = await secureFixture();
    let injected = false;
    try {
      await mkdir(fixture.root, { mode: 0o700 });
      const initial = stateBytes();
      const replacement = stateBytes(2, NEXT_CREDENTIAL);
      await writeFile(join(fixture.root, 'identity.json'), initial, {
        mode: 0o600,
      });
      const operation = createRotationOperation({
        databaseTargetId: TARGET_ID,
        nonce: NONCE,
        baseGeneration: 1,
        baseStateDigest: digestLocalIdentityState(initial),
        proposedStateDigest: digestLocalIdentityState(replacement),
      });
      const adversarial: LocalIdentityFileSystem = {
        ...nodeLocalIdentityFileSystem,
        async open(path, flags, mode) {
          const handle = await nodeLocalIdentityFileSystem.open(
            path,
            flags,
            mode,
          );
          if (injected || basename(path) !== 'identity.json') return handle;
          injected = true;
          return {
            ...handle,
            async close() {
              await writeFile(
                join(fixture.root, 'identity.operation.json'),
                encodeLocalIdentityOperation(operation),
                { mode: 0o600 },
              );
              const candidate = join(
                fixture.root,
                `identity.rotate-${NONCE}.json`,
              );
              await writeFile(candidate, replacement, { mode: 0o600 });
              await rename(candidate, join(fixture.root, 'identity.json'));
              await unlink(join(fixture.root, 'identity.operation.json'));
              await handle.close();
            },
          } satisfies LocalIdentityFileHandle;
        },
      };
      const store = new LocalIdentityFileStore({
        stateRoot: fixture.root,
        databaseTargetId: TARGET_ID,
        fileSystem: adversarial,
      });

      await expect(store.openReadyState()).rejects.toThrow(
        'Unsafe local identity state',
      );
      await expect(
        new LocalIdentityFileStore({
          stateRoot: fixture.root,
          databaseTargetId: TARGET_ID,
        }).openReadyState(),
      ).resolves.toMatchObject({
        state: { generation: 2, credential: NEXT_CREDENTIAL },
      });
    } finally {
      await fixture.cleanup();
    }
  });

  it('durably publishes operation, candidate, and first canonical state in the mandated order', async () => {
    const fixture = await secureFixture();
    const trace: string[] = [];
    try {
      const bytes = stateBytes();
      const operation = operationFor(bytes);
      const store = new LocalIdentityFileStore({
        stateRoot: fixture.root,
        databaseTargetId: TARGET_ID,
        fileSystem: traceFileSystem(trace),
      });
      const lease = await store.prepareRoot({ create: true });
      await store.publishOperation(lease, operation);
      await store.publishCandidate(lease, operation, bytes);
      await store.publishInitialState(lease, operation);
      await store.removeOperationLast(lease, operation);

      expect(await readdir(fixture.root)).toEqual(['identity.json']);
      await expect(store.openReadyState()).resolves.toMatchObject({
        state: { principalId: PRINCIPAL_ID, generation: 1 },
      });
      expectOrdered(trace, [
        `open:identity.stage-operation-${NONCE}.tmp`,
        `write:identity.stage-operation-${NONCE}.tmp`,
        `fsync:identity.stage-operation-${NONCE}.tmp`,
        `link:identity.stage-operation-${NONCE}.tmp->identity.operation.json`,
        'fsync:state',
        `unlink:identity.stage-operation-${NONCE}.tmp`,
        'fsync:state',
        `open:identity.stage-${NONCE}-candidate.tmp`,
        `write:identity.stage-${NONCE}-candidate.tmp`,
        `fsync:identity.stage-${NONCE}-candidate.tmp`,
        `link:identity.stage-${NONCE}-candidate.tmp->identity.pending-${NONCE}.json`,
        'fsync:state',
        `unlink:identity.stage-${NONCE}-candidate.tmp`,
        'fsync:state',
        `link:identity.pending-${NONCE}.json->identity.json`,
        'fsync:state',
        `unlink:identity.pending-${NONCE}.json`,
        'fsync:state',
        'unlink:identity.operation.json',
        'fsync:state',
      ]);
    } finally {
      await fixture.cleanup();
    }
  });

  it('atomically replaces a pinned canonical state during rotation', async () => {
    const fixture = await secureFixture();
    const trace: string[] = [];
    try {
      await mkdir(fixture.root, { mode: 0o700 });
      const initial = stateBytes();
      const proposed = stateBytes(2, NEXT_CREDENTIAL);
      await writeFile(join(fixture.root, 'identity.json'), initial, {
        mode: 0o600,
      });
      const operation = createRotationOperation({
        databaseTargetId: TARGET_ID,
        nonce: NONCE,
        baseGeneration: 1,
        baseStateDigest: digestLocalIdentityState(initial),
        proposedStateDigest: digestLocalIdentityState(proposed),
      });
      const store = new LocalIdentityFileStore({
        stateRoot: fixture.root,
        databaseTargetId: TARGET_ID,
        fileSystem: traceFileSystem(trace),
      });
      const lease = await store.prepareRoot({ create: false });
      await store.publishOperation(lease, operation);
      await store.publishCandidate(lease, operation, proposed);
      await store.replaceWithRotatedState(lease, operation);
      await store.removeOperationLast(lease, operation);

      await expect(store.openReadyState()).resolves.toMatchObject({
        state: { generation: 2, credential: NEXT_CREDENTIAL },
      });
      expectOrdered(trace, [
        `rename:identity.rotate-${NONCE}.json->identity.json`,
        'fsync:state',
        'unlink:identity.operation.json',
        'fsync:state',
      ]);
    } finally {
      await fixture.cleanup();
    }
  });

  it('detects a root inode replacement around a pathname mutation', async () => {
    const fixture = await secureFixture();
    const displaced = `${fixture.root}-displaced`;
    let replaced = false;
    const adversarial: LocalIdentityFileSystem = {
      ...nodeLocalIdentityFileSystem,
      async link(existingPath, newPath) {
        await nodeLocalIdentityFileSystem.link(existingPath, newPath);
        if (!replaced) {
          replaced = true;
          await rename(fixture.root, displaced);
          await mkdir(fixture.root, { mode: 0o700 });
        }
      },
    };
    try {
      const bytes = stateBytes();
      const store = new LocalIdentityFileStore({
        stateRoot: fixture.root,
        databaseTargetId: TARGET_ID,
        fileSystem: adversarial,
      });
      const lease = await store.prepareRoot({ create: true });
      await expect(
        store.publishOperation(lease, operationFor(bytes)),
      ).rejects.toThrow('Unsafe local identity state');
    } finally {
      await fixture.cleanup();
      await rm(displaced, { recursive: true, force: true });
    }
  });

  it('uses O_NOFOLLOW and exclusive create for stage files', async () => {
    const fixture = await secureFixture();
    const observed: Array<{ path: string; flags: number }> = [];
    const inspecting: LocalIdentityFileSystem = {
      ...nodeLocalIdentityFileSystem,
      async open(path, flags, mode) {
        observed.push({ path, flags });
        return nodeLocalIdentityFileSystem.open(path, flags, mode);
      },
    };
    try {
      const store = new LocalIdentityFileStore({
        stateRoot: fixture.root,
        databaseTargetId: TARGET_ID,
        fileSystem: inspecting,
      });
      const lease = await store.prepareRoot({ create: true });
      await store.publishOperation(lease, operationFor(stateBytes()));
      const stageOpen = observed.find(({ path }) =>
        basename(path).startsWith('identity.stage-operation-'),
      );
      expect(stageOpen.flags & constants.O_NOFOLLOW).toBe(constants.O_NOFOLLOW);
      expect(stageOpen.flags & constants.O_EXCL).toBe(constants.O_EXCL);
      expect(stageOpen.flags & constants.O_CREAT).toBe(constants.O_CREAT);
    } finally {
      await fixture.cleanup();
    }
  });
});
