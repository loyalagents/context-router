import { constants, type BigIntStats } from 'node:fs';
import {
  lstat,
  link,
  mkdir,
  open,
  readdir,
  realpath,
  rename,
  unlink,
} from 'node:fs/promises';
import {
  dirname,
  isAbsolute,
  join,
  parse as parsePath,
  resolve,
  sep,
} from 'node:path';

import {
  LOCAL_IDENTITY_CANONICAL_BASENAME,
  LOCAL_IDENTITY_MAX_OPERATION_BYTES,
  LOCAL_IDENTITY_MAX_STATE_BYTES,
  LOCAL_IDENTITY_OPERATION_BASENAME,
  type LocalIdentityOperation,
  type LocalIdentityState,
  decodeLocalIdentityOperation,
  decodeLocalIdentityState,
  digestLocalIdentityState,
  encodeLocalIdentityOperation,
  parseLocalIdentityArtifactName,
} from './local-identity-state.codec';

export interface LocalIdentityFileHandle {
  writeFile(bytes: Buffer): Promise<void>;
  readFile(): Promise<Buffer>;
  stat(): Promise<BigIntStats>;
  sync(): Promise<void>;
  close(): Promise<void>;
}

export interface LocalIdentityFileSystem {
  lstat(path: string): Promise<BigIntStats>;
  realpath(path: string): Promise<string>;
  mkdir(path: string, options: { mode: number }): Promise<void>;
  readdir(path: string): Promise<string[]>;
  open(
    path: string,
    flags: number,
    mode?: number,
  ): Promise<LocalIdentityFileHandle>;
  link(existingPath: string, newPath: string): Promise<void>;
  unlink(path: string): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
}

export const nodeLocalIdentityFileSystem: LocalIdentityFileSystem = {
  lstat: (path) => lstat(path, { bigint: true }),
  realpath,
  mkdir: async (path, options) => {
    await mkdir(path, options);
  },
  readdir,
  open: async (path, flags, mode) => {
    const handle = await open(path, flags, mode);
    return {
      writeFile: async (bytes) => {
        await handle.writeFile(bytes);
      },
      readFile: () => handle.readFile(),
      stat: () => handle.stat({ bigint: true }),
      sync: () => handle.sync(),
      close: () => handle.close(),
    };
  },
  link,
  unlink,
  rename,
};

interface PinnedIdentity {
  dev: bigint;
  ino: bigint;
  uid: bigint;
  mode: bigint;
}

export interface LocalIdentityRootLease {
  path: string;
  parentPath: string;
  root: PinnedIdentity;
  parent: PinnedIdentity;
  assertMutationAllowed: () => void;
}

export interface OpenLocalIdentityState {
  state: LocalIdentityState;
  bytes: Buffer;
  digest: string;
}

export interface LocalIdentityArtifactSnapshot {
  names: string[];
  metadata: Record<
    string,
    { dev: string; ino: string; nlink: number; size: number }
  >;
  canonical?: OpenLocalIdentityState;
  operation?: {
    operation: LocalIdentityOperation;
    bytes: Buffer;
  };
  candidates: Array<{
    name: string;
    bytes: Buffer;
    state: LocalIdentityState;
    digest: string;
  }>;
  operationStages: string[];
  candidateStages: string[];
}

function unsafeState(): never {
  throw new Error('Unsafe local identity state');
}

function targetMismatch(): never {
  throw new Error('Local identity target mismatch');
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === 'ENOENT';
}

function isExists(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === 'EEXIST';
}

function pin(stats: BigIntStats): PinnedIdentity {
  return {
    dev: stats.dev,
    ino: stats.ino,
    uid: stats.uid,
    mode: stats.mode,
  };
}

function samePin(stats: BigIntStats, expected: PinnedIdentity): boolean {
  return (
    stats.dev === expected.dev &&
    stats.ino === expected.ino &&
    stats.uid === expected.uid &&
    stats.mode === expected.mode
  );
}

function sameFile(left: BigIntStats, right: BigIntStats): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.uid === right.uid &&
    left.mode === right.mode &&
    left.nlink === right.nlink &&
    left.size === right.size
  );
}

function componentPaths(path: string): string[] {
  const root = parsePath(path).root;
  const remainder = path.slice(root.length).split(sep).filter(Boolean);
  const paths = [root];
  let current = root;
  for (const part of remainder) {
    current = join(current, part);
    paths.push(current);
  }
  return paths;
}

function exactMode(stats: BigIntStats, mode: bigint): boolean {
  return (stats.mode & 0o7777n) === mode;
}

export class LocalIdentityFileStore {
  private readonly stateRoot: string;
  private readonly databaseTargetId: string;
  private readonly fileSystem: LocalIdentityFileSystem;
  private readonly uid: bigint;

  constructor(options: {
    stateRoot: string;
    databaseTargetId: string;
    fileSystem?: LocalIdentityFileSystem;
    uid?: number;
  }) {
    const uid = options.uid ?? process.getuid?.();
    if (
      uid === undefined ||
      !Number.isSafeInteger(uid) ||
      uid < 0 ||
      !isAbsolute(options.stateRoot) ||
      resolve(options.stateRoot) !== options.stateRoot ||
      options.stateRoot === parsePath(options.stateRoot).root
    ) {
      unsafeState();
    }
    this.stateRoot = options.stateRoot;
    this.databaseTargetId = options.databaseTargetId;
    this.fileSystem = options.fileSystem ?? nodeLocalIdentityFileSystem;
    this.uid = BigInt(uid);
  }

  getDatabaseTargetId(): string {
    return this.databaseTargetId;
  }

  async prepareRoot(options: {
    create: boolean;
    assertMutationAllowed?: () => void;
  }): Promise<LocalIdentityRootLease> {
    const assertMutationAllowed =
      options.assertMutationAllowed ?? (() => undefined);
    const parentPath = dirname(this.stateRoot);
    let rootStats: BigIntStats;
    try {
      rootStats = await this.fileSystem.lstat(this.stateRoot);
    } catch (error) {
      if (!options.create || !isMissing(error)) unsafeState();
      const ancestry = await this.validateAncestry(parentPath);
      const parentStats = ancestry.at(-1).stats;
      if (parentStats.uid !== this.uid || !exactMode(parentStats, 0o700n)) {
        unsafeState();
      }
      const parentBefore = pin(parentStats);
      assertMutationAllowed();
      try {
        await this.fileSystem.mkdir(this.stateRoot, { mode: 0o700 });
      } catch {
        unsafeState();
      }
      assertMutationAllowed();
      await this.syncPinnedDirectory(
        parentPath,
        parentBefore,
        assertMutationAllowed,
      );
      const parentAfter = await this.fileSystem.lstat(parentPath);
      if (!samePin(parentAfter, parentBefore)) unsafeState();
      try {
        rootStats = await this.fileSystem.lstat(this.stateRoot);
      } catch {
        unsafeState();
      }
    }

    const ancestry = await this.validateAncestry(this.stateRoot);
    rootStats = ancestry.at(-1).stats;
    const parentStats = ancestry.at(-2).stats;
    if (
      !rootStats.isDirectory() ||
      rootStats.uid !== this.uid ||
      !exactMode(rootStats, 0o700n)
    ) {
      unsafeState();
    }
    return {
      path: this.stateRoot,
      parentPath,
      root: pin(rootStats),
      parent: pin(parentStats),
      assertMutationAllowed,
    };
  }

  async openReadyState(): Promise<OpenLocalIdentityState> {
    const lease = await this.prepareRoot({ create: false });
    const names = (await this.fileSystem.readdir(this.stateRoot)).sort();
    if (names.length !== 1 || names[0] !== LOCAL_IDENTITY_CANONICAL_BASENAME) {
      unsafeState();
    }
    const bytes = await this.readPrivateFile(
      lease,
      LOCAL_IDENTITY_CANONICAL_BASENAME,
      LOCAL_IDENTITY_MAX_STATE_BYTES,
      1n,
    );
    let state: LocalIdentityState;
    try {
      state = decodeLocalIdentityState(bytes);
    } catch {
      unsafeState();
    }
    if (state.databaseTargetId !== this.databaseTargetId) targetMismatch();
    await this.assertLease(lease);
    const namesAfterRead = (
      await this.fileSystem.readdir(this.stateRoot)
    ).sort();
    if (
      namesAfterRead.length !== 1 ||
      namesAfterRead[0] !== LOCAL_IDENTITY_CANONICAL_BASENAME
    ) {
      unsafeState();
    }
    return { state, bytes, digest: digestLocalIdentityState(bytes) };
  }

  async inspect(
    lease: LocalIdentityRootLease,
  ): Promise<LocalIdentityArtifactSnapshot> {
    await this.assertLease(lease);
    const names = (await this.fileSystem.readdir(this.stateRoot)).sort();
    const snapshot: LocalIdentityArtifactSnapshot = {
      names,
      metadata: {},
      candidates: [],
      operationStages: [],
      candidateStages: [],
    };
    const statsByName = new Map<string, BigIntStats>();
    for (const name of names) {
      const artifact = parseLocalIdentityArtifactName(name);
      if (!artifact) unsafeState();
      let stats: BigIntStats;
      try {
        stats = await this.fileSystem.lstat(join(this.stateRoot, name));
      } catch {
        unsafeState();
      }
      const maximumBytes =
        artifact.kind === 'operation' || artifact.kind === 'operation-stage'
          ? LOCAL_IDENTITY_MAX_OPERATION_BYTES
          : LOCAL_IDENTITY_MAX_STATE_BYTES;
      const isStage =
        artifact.kind === 'operation-stage' ||
        artifact.kind === 'candidate-stage';
      if (
        !stats.isFile() ||
        stats.uid !== this.uid ||
        !exactMode(stats, 0o600n) ||
        (stats.nlink !== 1n && stats.nlink !== 2n) ||
        stats.size < (isStage ? 0n : 1n) ||
        stats.size > BigInt(maximumBytes)
      ) {
        unsafeState();
      }
      statsByName.set(name, stats);
      snapshot.metadata[name] = {
        dev: stats.dev.toString(),
        ino: stats.ino.toString(),
        nlink: Number(stats.nlink),
        size: Number(stats.size),
      };
    }
    for (const name of names) {
      const artifact = parseLocalIdentityArtifactName(name);
      const stats = statsByName.get(name);
      if (!artifact || !stats) unsafeState();
      if (artifact.kind === 'canonical') {
        const bytes = await this.readPrivateFile(
          lease,
          name,
          LOCAL_IDENTITY_MAX_STATE_BYTES,
          stats.nlink,
        );
        let state: LocalIdentityState;
        try {
          state = decodeLocalIdentityState(bytes);
        } catch {
          unsafeState();
        }
        snapshot.canonical = {
          state,
          bytes,
          digest: digestLocalIdentityState(bytes),
        };
      } else if (artifact.kind === 'operation') {
        const bytes = await this.readPrivateFile(
          lease,
          name,
          LOCAL_IDENTITY_MAX_OPERATION_BYTES,
          stats.nlink,
        );
        let operation: LocalIdentityOperation;
        try {
          operation = decodeLocalIdentityOperation(bytes);
        } catch {
          unsafeState();
        }
        snapshot.operation = { operation, bytes };
      } else if (
        artifact.kind === 'initialize-candidate' ||
        artifact.kind === 'rotation-candidate'
      ) {
        const bytes = await this.readPrivateFile(
          lease,
          name,
          LOCAL_IDENTITY_MAX_STATE_BYTES,
          stats.nlink,
        );
        let state: LocalIdentityState;
        try {
          state = decodeLocalIdentityState(bytes);
        } catch {
          unsafeState();
        }
        snapshot.candidates.push({
          name,
          bytes,
          state,
          digest: digestLocalIdentityState(bytes),
        });
      } else if (artifact.kind === 'operation-stage') {
        snapshot.operationStages.push(name);
      } else {
        snapshot.candidateStages.push(name);
      }
    }
    this.validateSnapshotHardlinks(snapshot);
    await this.assertLease(lease);
    return snapshot;
  }

  sameSnapshotInode(
    snapshot: LocalIdentityArtifactSnapshot,
    first: string,
    second: string,
  ): boolean {
    const left = snapshot.metadata[first];
    const right = snapshot.metadata[second];
    return (
      Boolean(left) &&
      Boolean(right) &&
      left.dev === right.dev &&
      left.ino === right.ino
    );
  }

  async removeRedundantHardlink(
    lease: LocalIdentityRootLease,
    redundant: string,
    retained: string,
  ): Promise<void> {
    const redundantArtifact = parseLocalIdentityArtifactName(redundant);
    const retainedArtifact = parseLocalIdentityArtifactName(retained);
    if (!redundantArtifact || !retainedArtifact) unsafeState();
    const maximumBytes =
      redundantArtifact.kind === 'operation-stage' ||
      retainedArtifact.kind === 'operation'
        ? LOCAL_IDENTITY_MAX_OPERATION_BYTES
        : LOCAL_IDENTITY_MAX_STATE_BYTES;
    const [redundantStats, retainedStats] = await Promise.all([
      this.fileSystem.lstat(join(this.stateRoot, redundant)).catch(unsafeState),
      this.fileSystem.lstat(join(this.stateRoot, retained)).catch(unsafeState),
    ]);
    if (
      redundantStats.nlink !== 2n ||
      retainedStats.nlink !== 2n ||
      redundantStats.dev !== retainedStats.dev ||
      redundantStats.ino !== retainedStats.ino
    ) {
      unsafeState();
    }
    const redundantBytes = await this.readPrivateFile(
      lease,
      redundant,
      maximumBytes,
      2n,
    );
    await this.readPrivateFile(
      lease,
      retained,
      maximumBytes,
      2n,
      redundantBytes,
    );
    await this.unlinkChecked(lease, redundant);
    await this.syncDirectory(lease);
    await this.readPrivateFile(
      lease,
      retained,
      maximumBytes,
      1n,
      redundantBytes,
    );
  }

  async publishOperation(
    lease: LocalIdentityRootLease,
    operation: LocalIdentityOperation,
    validateStaged?: (stageBasename: string) => Promise<void>,
  ): Promise<void> {
    if (operation.databaseTargetId !== this.databaseTargetId) targetMismatch();
    const bytes = encodeLocalIdentityOperation(operation);
    const stage = `identity.stage-operation-${operation.nonce}.tmp`;
    await this.publishHardlinkArtifact({
      lease,
      stage,
      published: LOCAL_IDENTITY_OPERATION_BASENAME,
      bytes,
      maximumBytes: LOCAL_IDENTITY_MAX_OPERATION_BYTES,
      cleanupStageOnConflict: true,
      afterStage: validateStaged ? () => validateStaged(stage) : undefined,
    });
  }

  async publishCandidate(
    lease: LocalIdentityRootLease,
    operation: LocalIdentityOperation,
    bytes: Buffer,
  ): Promise<void> {
    await this.requireOperation(lease, operation);
    let state: LocalIdentityState;
    try {
      state = decodeLocalIdentityState(bytes);
    } catch {
      unsafeState();
    }
    if (!('candidateBasename' in operation)) {
      unsafeState();
    }
    if (
      state.databaseTargetId !== this.databaseTargetId ||
      digestLocalIdentityState(bytes) !== operation.proposedStateDigest
    ) {
      unsafeState();
    }
    if (
      (operation.operation === 'initialize' && state.generation !== 1) ||
      (operation.operation === 'rotate' &&
        state.generation !== operation.baseGeneration + 1)
    ) {
      unsafeState();
    }
    await this.publishHardlinkArtifact({
      lease,
      stage: `identity.stage-${operation.nonce}-candidate.tmp`,
      published: operation.candidateBasename,
      bytes,
      maximumBytes: LOCAL_IDENTITY_MAX_STATE_BYTES,
      cleanupStageOnConflict: false,
    });
  }

  async publishInitialState(
    lease: LocalIdentityRootLease,
    operation: LocalIdentityOperation,
  ): Promise<void> {
    if (operation.operation !== 'initialize') unsafeState();
    await this.requireOperation(lease, operation);
    const candidateBytes = await this.requireCandidate(lease, operation);
    await this.assertLease(lease);
    this.assertMutationAllowed(lease);
    try {
      await this.fileSystem.link(
        join(this.stateRoot, operation.candidateBasename),
        join(this.stateRoot, LOCAL_IDENTITY_CANONICAL_BASENAME),
      );
    } catch {
      unsafeState();
    }
    this.assertMutationAllowed(lease);
    await this.assertLease(lease);
    await this.verifyHardlinkPair(
      lease,
      operation.candidateBasename,
      LOCAL_IDENTITY_CANONICAL_BASENAME,
      candidateBytes,
      LOCAL_IDENTITY_MAX_STATE_BYTES,
    );
    await this.syncDirectory(lease);
    await this.unlinkChecked(lease, operation.candidateBasename);
    await this.syncDirectory(lease);
    await this.readPrivateFile(
      lease,
      LOCAL_IDENTITY_CANONICAL_BASENAME,
      LOCAL_IDENTITY_MAX_STATE_BYTES,
      1n,
      candidateBytes,
    );
  }

  async replaceWithRotatedState(
    lease: LocalIdentityRootLease,
    operation: LocalIdentityOperation,
  ): Promise<void> {
    if (operation.operation !== 'rotate') unsafeState();
    await this.requireOperation(lease, operation);
    const canonical = await this.readPrivateFile(
      lease,
      LOCAL_IDENTITY_CANONICAL_BASENAME,
      LOCAL_IDENTITY_MAX_STATE_BYTES,
      1n,
    );
    if (
      digestLocalIdentityState(canonical) !== operation.baseStateDigest ||
      decodeLocalIdentityState(canonical).generation !==
        operation.baseGeneration
    ) {
      unsafeState();
    }
    const candidate = await this.requireCandidate(lease, operation);
    await this.assertLease(lease);
    this.assertMutationAllowed(lease);
    try {
      await this.fileSystem.rename(
        join(this.stateRoot, operation.candidateBasename),
        join(this.stateRoot, LOCAL_IDENTITY_CANONICAL_BASENAME),
      );
    } catch {
      unsafeState();
    }
    this.assertMutationAllowed(lease);
    await this.assertLease(lease);
    await this.readPrivateFile(
      lease,
      LOCAL_IDENTITY_CANONICAL_BASENAME,
      LOCAL_IDENTITY_MAX_STATE_BYTES,
      1n,
      candidate,
    );
    await this.syncDirectory(lease);
  }

  async removeArtifact(
    lease: LocalIdentityRootLease,
    basename: string,
  ): Promise<void> {
    const artifact = parseLocalIdentityArtifactName(basename);
    if (
      !artifact ||
      artifact.kind === 'canonical' ||
      artifact.kind === 'operation'
    ) {
      unsafeState();
    }
    if (
      artifact.kind === 'operation-stage' ||
      artifact.kind === 'candidate-stage'
    ) {
      await this.validateRemovableStage(
        lease,
        basename,
        artifact.kind === 'operation-stage'
          ? LOCAL_IDENTITY_MAX_OPERATION_BYTES
          : LOCAL_IDENTITY_MAX_STATE_BYTES,
      );
    } else {
      await this.readPrivateFile(
        lease,
        basename,
        LOCAL_IDENTITY_MAX_STATE_BYTES,
        1n,
      );
    }
    await this.unlinkChecked(lease, basename);
    await this.syncDirectory(lease);
  }

  async removeOperationLast(
    lease: LocalIdentityRootLease,
    operation: LocalIdentityOperation,
  ): Promise<void> {
    while (true) {
      await this.requireOperation(lease, operation);
      const names = (await this.fileSystem.readdir(this.stateRoot)).sort();
      const operationStages: string[] = [];
      for (const name of names) {
        if (
          name === LOCAL_IDENTITY_CANONICAL_BASENAME ||
          name === LOCAL_IDENTITY_OPERATION_BASENAME
        ) {
          continue;
        }
        const artifact = parseLocalIdentityArtifactName(name);
        if (!artifact || artifact.kind !== 'operation-stage') unsafeState();
        operationStages.push(name);
      }
      if (operationStages.length === 0) break;
      for (const name of operationStages) {
        if (await this.removeOperationStageIfPresent(lease, name)) {
          await this.syncDirectory(lease);
        }
      }
    }
    await this.requireOperation(lease, operation);
    await this.unlinkChecked(lease, LOCAL_IDENTITY_OPERATION_BASENAME);
    await this.syncDirectory(lease);
  }

  async removeRecoveryOperationOnAbort(
    lease: LocalIdentityRootLease,
    operation: LocalIdentityOperation,
  ): Promise<void> {
    if (operation.operation !== 'recover-orphans') unsafeState();
    await this.requireOperation(lease, operation);
    const names = (await this.fileSystem.readdir(this.stateRoot)).sort();
    for (const name of names) {
      if (
        name === LOCAL_IDENTITY_CANONICAL_BASENAME ||
        name === LOCAL_IDENTITY_OPERATION_BASENAME
      ) {
        continue;
      }
      const artifact = parseLocalIdentityArtifactName(name);
      if (!artifact || artifact.kind !== 'operation-stage') unsafeState();
    }
    await this.unlinkChecked(lease, LOCAL_IDENTITY_OPERATION_BASENAME);
    await this.syncDirectory(lease);
  }

  private async validateAncestry(
    target: string,
  ): Promise<Array<{ path: string; stats: BigIntStats }>> {
    const items: Array<{ path: string; stats: BigIntStats }> = [];
    for (const path of componentPaths(target)) {
      let stats: BigIntStats;
      try {
        stats = await this.fileSystem.lstat(path);
      } catch {
        unsafeState();
      }
      if (
        !stats.isDirectory() ||
        (stats.uid !== 0n && stats.uid !== this.uid)
      ) {
        unsafeState();
      }
      items.push({ path, stats });
    }
    for (let index = 0; index < items.length; index += 1) {
      const stats = items[index].stats;
      const writable = (stats.mode & 0o022n) !== 0n;
      if (!writable) continue;
      const next = items[index + 1]?.stats;
      if (
        stats.uid !== 0n ||
        (stats.mode & 0o1000n) === 0n ||
        !next ||
        next.uid !== this.uid
      ) {
        unsafeState();
      }
    }
    try {
      if ((await this.fileSystem.realpath(target)) !== target) unsafeState();
    } catch {
      unsafeState();
    }
    for (const item of items) {
      let after: BigIntStats;
      try {
        after = await this.fileSystem.lstat(item.path);
      } catch {
        unsafeState();
      }
      if (!samePin(after, pin(item.stats))) unsafeState();
    }
    return items;
  }

  private async assertLease(lease: LocalIdentityRootLease): Promise<void> {
    if (
      lease.path !== this.stateRoot ||
      lease.parentPath !== dirname(this.stateRoot)
    ) {
      unsafeState();
    }
    const ancestry = await this.validateAncestry(this.stateRoot);
    const root = ancestry.at(-1).stats;
    const parent = ancestry.at(-2).stats;
    if (
      !samePin(root, lease.root) ||
      !samePin(parent, lease.parent) ||
      root.uid !== this.uid ||
      !exactMode(root, 0o700n)
    ) {
      unsafeState();
    }
  }

  private validatePrivateFile(
    stats: BigIntStats,
    maximumBytes: number,
    expectedLinks: bigint,
  ): void {
    if (
      !stats.isFile() ||
      stats.uid !== this.uid ||
      !exactMode(stats, 0o600n) ||
      stats.nlink !== expectedLinks ||
      stats.size < 1n ||
      stats.size > BigInt(maximumBytes)
    ) {
      unsafeState();
    }
  }

  private async readPrivateFile(
    lease: LocalIdentityRootLease,
    basename: string,
    maximumBytes: number,
    expectedLinks: bigint,
    expectedBytes?: Buffer,
  ): Promise<Buffer> {
    if (basename.includes(sep) || basename === '.' || basename === '..') {
      unsafeState();
    }
    await this.assertLease(lease);
    const path = join(this.stateRoot, basename);
    let before: BigIntStats;
    try {
      before = await this.fileSystem.lstat(path);
    } catch {
      unsafeState();
    }
    this.validatePrivateFile(before, maximumBytes, expectedLinks);
    let handle: LocalIdentityFileHandle;
    try {
      handle = await this.fileSystem.open(
        path,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
    } catch {
      unsafeState();
    }
    let bytes: Buffer;
    try {
      const opened = await handle.stat();
      this.validatePrivateFile(opened, maximumBytes, expectedLinks);
      if (!sameFile(before, opened)) unsafeState();
      bytes = await handle.readFile();
      const after = await handle.stat();
      if (
        !sameFile(opened, after) ||
        BigInt(bytes.byteLength) !== opened.size
      ) {
        unsafeState();
      }
    } catch {
      unsafeState();
    } finally {
      await handle.close().catch(unsafeState);
    }
    let pathAfter: BigIntStats;
    try {
      pathAfter = await this.fileSystem.lstat(path);
    } catch {
      unsafeState();
    }
    this.validatePrivateFile(pathAfter, maximumBytes, expectedLinks);
    if (!sameFile(before, pathAfter)) unsafeState();
    await this.assertLease(lease);
    if (expectedBytes && !bytes.equals(expectedBytes)) unsafeState();
    return bytes;
  }

  private async writeStage(
    lease: LocalIdentityRootLease,
    basename: string,
    bytes: Buffer,
  ): Promise<void> {
    await this.assertLease(lease);
    const path = join(this.stateRoot, basename);
    let handle: LocalIdentityFileHandle;
    this.assertMutationAllowed(lease);
    try {
      handle = await this.fileSystem.open(
        path,
        constants.O_WRONLY |
          constants.O_CREAT |
          constants.O_EXCL |
          constants.O_NOFOLLOW |
          constants.O_NONBLOCK,
        0o600,
      );
    } catch {
      unsafeState();
    }
    try {
      this.assertMutationAllowed(lease);
      const created = await handle.stat();
      if (
        !created.isFile() ||
        created.uid !== this.uid ||
        !exactMode(created, 0o600n) ||
        created.nlink !== 1n ||
        created.size !== 0n
      ) {
        unsafeState();
      }
      this.assertMutationAllowed(lease);
      await handle.writeFile(bytes);
      this.assertMutationAllowed(lease);
      const written = await handle.stat();
      this.validatePrivateFile(written, bytes.byteLength, 1n);
      if (written.size !== BigInt(bytes.byteLength)) unsafeState();
      this.assertMutationAllowed(lease);
      await handle.sync();
      this.assertMutationAllowed(lease);
      const synced = await handle.stat();
      if (!sameFile(written, synced)) unsafeState();
    } catch (error) {
      throw error;
    } finally {
      await handle.close().catch(unsafeState);
    }
    await this.assertLease(lease);
  }

  private async publishHardlinkArtifact(options: {
    lease: LocalIdentityRootLease;
    stage: string;
    published: string;
    bytes: Buffer;
    maximumBytes: number;
    cleanupStageOnConflict: boolean;
    afterStage?: () => Promise<void>;
  }): Promise<void> {
    await this.writeStage(options.lease, options.stage, options.bytes);
    if (options.afterStage) {
      try {
        await options.afterStage();
      } catch (error) {
        const removed = options.cleanupStageOnConflict
          ? await this.removeOperationStageIfPresent(
              options.lease,
              options.stage,
            )
          : (await this.unlinkChecked(options.lease, options.stage), true);
        if (removed) await this.syncDirectory(options.lease);
        throw error;
      }
    }
    await this.assertLease(options.lease);
    this.assertMutationAllowed(options.lease);
    try {
      await this.fileSystem.link(
        join(this.stateRoot, options.stage),
        join(this.stateRoot, options.published),
      );
    } catch (error) {
      if (options.cleanupStageOnConflict && isExists(error)) {
        if (
          await this.removeOperationStageIfPresent(options.lease, options.stage)
        ) {
          await this.syncDirectory(options.lease);
        }
        throw new Error('Local identity operation busy');
      }
      throw error;
    }
    this.assertMutationAllowed(options.lease);
    await this.assertLease(options.lease);
    await this.verifyHardlinkPair(
      options.lease,
      options.stage,
      options.published,
      options.bytes,
      options.maximumBytes,
    );
    await this.syncDirectory(options.lease);
    await this.unlinkChecked(options.lease, options.stage);
    await this.syncDirectory(options.lease);
    await this.readPrivateFile(
      options.lease,
      options.published,
      options.maximumBytes,
      1n,
      options.bytes,
    );
  }

  private async verifyHardlinkPair(
    lease: LocalIdentityRootLease,
    first: string,
    second: string,
    bytes: Buffer,
    maximumBytes: number,
  ): Promise<void> {
    const firstPath = join(this.stateRoot, first);
    const secondPath = join(this.stateRoot, second);
    let firstStats: BigIntStats;
    let secondStats: BigIntStats;
    try {
      [firstStats, secondStats] = await Promise.all([
        this.fileSystem.lstat(firstPath),
        this.fileSystem.lstat(secondPath),
      ]);
    } catch {
      unsafeState();
    }
    this.validatePrivateFile(firstStats, maximumBytes, 2n);
    this.validatePrivateFile(secondStats, maximumBytes, 2n);
    if (
      firstStats.dev !== secondStats.dev ||
      firstStats.ino !== secondStats.ino ||
      !sameFile(firstStats, secondStats)
    ) {
      unsafeState();
    }
    await this.readPrivateFile(lease, first, maximumBytes, 2n, bytes);
    await this.readPrivateFile(lease, second, maximumBytes, 2n, bytes);
  }

  private async requireOperation(
    lease: LocalIdentityRootLease,
    expected: LocalIdentityOperation,
  ): Promise<void> {
    const bytes = await this.readPrivateFile(
      lease,
      LOCAL_IDENTITY_OPERATION_BASENAME,
      LOCAL_IDENTITY_MAX_OPERATION_BYTES,
      1n,
    );
    let operation: LocalIdentityOperation;
    try {
      operation = decodeLocalIdentityOperation(bytes);
    } catch {
      unsafeState();
    }
    if (
      operation.databaseTargetId !== this.databaseTargetId ||
      !encodeLocalIdentityOperation(operation).equals(
        encodeLocalIdentityOperation(expected),
      )
    ) {
      unsafeState();
    }
  }

  private async requireCandidate(
    lease: LocalIdentityRootLease,
    operation: LocalIdentityOperation,
  ): Promise<Buffer> {
    if (!('candidateBasename' in operation)) unsafeState();
    const bytes = await this.readPrivateFile(
      lease,
      operation.candidateBasename,
      LOCAL_IDENTITY_MAX_STATE_BYTES,
      1n,
    );
    let state: LocalIdentityState;
    try {
      state = decodeLocalIdentityState(bytes);
    } catch {
      unsafeState();
    }
    if (
      state.databaseTargetId !== this.databaseTargetId ||
      digestLocalIdentityState(bytes) !== operation.proposedStateDigest
    ) {
      unsafeState();
    }
    return bytes;
  }

  private async unlinkChecked(
    lease: LocalIdentityRootLease,
    basename: string,
  ): Promise<void> {
    await this.assertLease(lease);
    this.assertMutationAllowed(lease);
    try {
      await this.fileSystem.unlink(join(this.stateRoot, basename));
    } catch {
      unsafeState();
    }
    this.assertMutationAllowed(lease);
    await this.assertLease(lease);
  }

  private async validateRemovableStage(
    lease: LocalIdentityRootLease,
    basename: string,
    maximumBytes: number,
  ): Promise<void> {
    await this.assertLease(lease);
    let stats: BigIntStats;
    try {
      stats = await this.fileSystem.lstat(join(this.stateRoot, basename));
    } catch {
      unsafeState();
    }
    if (
      !stats.isFile() ||
      stats.uid !== this.uid ||
      !exactMode(stats, 0o600n) ||
      stats.nlink !== 1n ||
      stats.size < 0n ||
      stats.size > BigInt(maximumBytes)
    ) {
      unsafeState();
    }
    await this.assertLease(lease);
  }

  private async removeOperationStageIfPresent(
    lease: LocalIdentityRootLease,
    basename: string,
  ): Promise<boolean> {
    const artifact = parseLocalIdentityArtifactName(basename);
    if (!artifact || artifact.kind !== 'operation-stage') unsafeState();
    await this.assertLease(lease);
    let stats: BigIntStats;
    try {
      stats = await this.fileSystem.lstat(join(this.stateRoot, basename));
    } catch (error) {
      if (isMissing(error)) return false;
      unsafeState();
    }
    if (
      !stats.isFile() ||
      stats.uid !== this.uid ||
      !exactMode(stats, 0o600n) ||
      stats.nlink !== 1n ||
      stats.size < 0n ||
      stats.size > BigInt(LOCAL_IDENTITY_MAX_OPERATION_BYTES)
    ) {
      unsafeState();
    }
    this.assertMutationAllowed(lease);
    try {
      await this.fileSystem.unlink(join(this.stateRoot, basename));
    } catch (error) {
      if (isMissing(error)) return false;
      unsafeState();
    }
    this.assertMutationAllowed(lease);
    await this.assertLease(lease);
    return true;
  }

  private validateSnapshotHardlinks(
    snapshot: LocalIdentityArtifactSnapshot,
  ): void {
    const groups = new Map<string, string[]>();
    for (const name of snapshot.names) {
      const metadata = snapshot.metadata[name];
      if (metadata.nlink !== 2) continue;
      const key = `${metadata.dev}:${metadata.ino}`;
      groups.set(key, [...(groups.get(key) ?? []), name]);
    }
    for (const names of groups.values()) {
      if (names.length !== 2) unsafeState();
      const [firstName, secondName] = names;
      const first = parseLocalIdentityArtifactName(firstName);
      const second = parseLocalIdentityArtifactName(secondName);
      if (!first || !second) unsafeState();
      const entries = [
        { name: firstName, artifact: first },
        { name: secondName, artifact: second },
      ];
      const operation = entries.find(
        ({ artifact }) => artifact.kind === 'operation',
      );
      const operationStage = entries.find(
        ({ artifact }) => artifact.kind === 'operation-stage',
      );
      if (operation && operationStage) {
        if (
          !snapshot.operation ||
          !('nonce' in operationStage.artifact) ||
          operationStage.artifact.nonce !== snapshot.operation.operation.nonce
        ) {
          unsafeState();
        }
        continue;
      }
      const candidateStage = entries.find(
        ({ artifact }) => artifact.kind === 'candidate-stage',
      );
      const candidate = entries.find(
        ({ artifact }) =>
          artifact.kind === 'initialize-candidate' ||
          artifact.kind === 'rotation-candidate',
      );
      if (candidateStage && candidate) {
        if (
          !('nonce' in candidateStage.artifact) ||
          !('nonce' in candidate.artifact) ||
          candidateStage.artifact.nonce !== candidate.artifact.nonce
        ) {
          unsafeState();
        }
        continue;
      }
      const canonical = entries.find(
        ({ artifact }) => artifact.kind === 'canonical',
      );
      const initializeCandidate = entries.find(
        ({ artifact }) => artifact.kind === 'initialize-candidate',
      );
      if (canonical && initializeCandidate) {
        const candidateSnapshot = snapshot.candidates.find(
          ({ name }) => name === initializeCandidate.name,
        );
        if (
          !snapshot.canonical ||
          !candidateSnapshot ||
          !snapshot.canonical.bytes.equals(candidateSnapshot.bytes)
        ) {
          unsafeState();
        }
        continue;
      }
      unsafeState();
    }
  }

  private async syncDirectory(lease: LocalIdentityRootLease): Promise<void> {
    await this.assertLease(lease);
    let handle: LocalIdentityFileHandle;
    try {
      handle = await this.fileSystem.open(
        this.stateRoot,
        constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
      );
    } catch {
      unsafeState();
    }
    try {
      const stats = await handle.stat();
      if (!stats.isDirectory() || !samePin(stats, lease.root)) unsafeState();
      this.assertMutationAllowed(lease);
      await handle.sync();
      this.assertMutationAllowed(lease);
      const after = await handle.stat();
      if (!samePin(after, lease.root)) unsafeState();
    } catch (error) {
      throw error;
    } finally {
      await handle.close().catch(unsafeState);
    }
    await this.assertLease(lease);
  }

  private async syncPinnedDirectory(
    path: string,
    expected: PinnedIdentity,
    assertMutationAllowed: () => void,
  ): Promise<void> {
    let handle: LocalIdentityFileHandle;
    try {
      handle = await this.fileSystem.open(
        path,
        constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
      );
    } catch {
      unsafeState();
    }
    try {
      const before = await handle.stat();
      if (!before.isDirectory() || !samePin(before, expected)) unsafeState();
      assertMutationAllowed();
      await handle.sync();
      assertMutationAllowed();
      const after = await handle.stat();
      if (!after.isDirectory() || !samePin(after, expected)) unsafeState();
    } finally {
      await handle.close().catch(unsafeState);
    }
  }

  private assertMutationAllowed(lease: LocalIdentityRootLease): void {
    lease.assertMutationAllowed();
  }
}
