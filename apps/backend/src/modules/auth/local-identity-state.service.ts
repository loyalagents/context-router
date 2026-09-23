import { randomBytes as nodeRandomBytes, timingSafeEqual } from 'node:crypto';

import {
  type LocalIdentityArtifactSnapshot,
  LocalIdentityFileStore,
  type OpenLocalIdentityState,
} from './local-identity-filesystem';
import type { LocalIdentityCoordination, LocalIdentitySession } from '@/domains/shared/storage/local-identity-coordination';
import {
  type LocalIdentityOperation,
  type LocalIdentityState,
  createInitializeOperation,
  createLocalIdentityMaterial,
  createRecoveryOperation,
  createRotationOperation,
  digestLocalIdentityState,
  encodeLocalIdentityState,
} from './local-identity-state.codec';

export type LocalIdentityRepositoryPort = LocalIdentityCoordination;

function unsafeRecovery(): never {
  throw new Error('Unsafe local identity recovery state');
}

function targetMismatch(): never {
  throw new Error('Local identity target mismatch');
}

function tokenFromEntropy(
  randomBytes: (size: number) => Buffer,
  distinctFrom: readonly string[] = [],
): string {
  const bytes = Buffer.from(randomBytes(32));
  if (bytes.byteLength !== 32) {
    throw new Error('Local identity entropy failure');
  }
  for (const value of distinctFrom) {
    const previous = Buffer.from(value, 'base64url');
    if (previous.byteLength !== 32 || timingSafeEqual(bytes, previous)) {
      throw new Error('Local identity entropy failure');
    }
  }
  return bytes.toString('base64url');
}

export class LocalIdentityStateService {
  private readonly fileStore: LocalIdentityFileStore;
  private readonly repository: LocalIdentityRepositoryPort;
  private readonly randomBytes: (size: number) => Buffer;

  constructor(options: {
    fileStore: LocalIdentityFileStore;
    repository: LocalIdentityCoordination;
    randomBytes?: (size: number) => Buffer;
  }) {
    this.fileStore = options.fileStore;
    this.repository = options.repository;
    this.randomBytes = options.randomBytes ?? nodeRandomBytes;
  }

  openReadyState(): Promise<OpenLocalIdentityState> {
    return this.fileStore.openReadyState();
  }

  async verifyReadyState(): Promise<OpenLocalIdentityState> {
    return this.withSession(async (session) => {
      const before = await this.fileStore.openReadyState();
      let after: OpenLocalIdentityState | undefined;
      await session.verify(before.state, async () => {
        const current = await this.fileStore.openReadyState();
        if (
          current.digest !== before.digest ||
          current.bytes.byteLength !== before.bytes.byteLength ||
          !timingSafeEqual(current.bytes, before.bytes)
        ) {
          throw new Error('Local identity state changed during verification');
        }
        after = current;
      });
      if (!after) {
        throw new Error('Local identity state changed during verification');
      }
      return after;
    });
  }

  async initialize(): Promise<OpenLocalIdentityState> {
    return this.withSession(async (session) => {
      const lease = await this.prepareRoot(session, true);
      const snapshot = await this.fileStore.inspect(lease);
      if (snapshot.names.length !== 0) {
        throw new Error('Local identity is already initialized');
      }
      const material = createLocalIdentityMaterial(this.randomBytes);
      const databaseTargetId = this.databaseTargetIdFromStore();
      if (
        material.principalId === databaseTargetId ||
        material.credential === databaseTargetId
      ) {
        throw new Error('Local identity entropy failure');
      }
      const nonce = tokenFromEntropy(this.randomBytes, [
        databaseTargetId,
        material.principalId,
        material.credential,
      ]);
      const state: LocalIdentityState = {
        schemaVersion: 1,
        databaseTargetId,
        principalId: material.principalId,
        credential: material.credential,
        generation: 1,
      };
      const bytes = encodeLocalIdentityState(state);
      const operation = createInitializeOperation({
        databaseTargetId: state.databaseTargetId,
        nonce,
        proposedStateDigest: digestLocalIdentityState(bytes),
      });
      await this.fileStore.publishOperation(lease, operation, (stage) =>
        this.assertStagedOperationFence(lease, snapshot, stage),
      );
      await this.assertOrReleasePublishedOperation(lease, operation);
      await this.fileStore.publishCandidate(lease, operation, bytes);
      await session.initialize(state);
      await this.fileStore.publishInitialState(lease, operation);
      await this.fileStore.removeOperationLast(lease, operation);
      return this.fileStore.openReadyState();
    });
  }

  async rotate(): Promise<OpenLocalIdentityState> {
    return this.withSession(async (session) => {
      const lease = await this.prepareRoot(session, false);
      const snapshot = await this.fileStore.inspect(lease);
      const ready = this.requireOnlyCanonical(snapshot);
      const credential = tokenFromEntropy(this.randomBytes, [
        ready.state.databaseTargetId,
        ready.state.principalId,
        ready.state.credential,
      ]);
      const nonce = tokenFromEntropy(this.randomBytes, [
        ready.state.databaseTargetId,
        ready.state.principalId,
        ready.state.credential,
        credential,
      ]);
      const proposed: LocalIdentityState = {
        ...ready.state,
        credential,
        generation: ready.state.generation + 1,
      };
      if (!Number.isSafeInteger(proposed.generation)) unsafeRecovery();
      const proposedBytes = encodeLocalIdentityState(proposed);
      const operation = createRotationOperation({
        databaseTargetId: ready.state.databaseTargetId,
        nonce,
        baseGeneration: ready.state.generation,
        baseStateDigest: ready.digest,
        proposedStateDigest: digestLocalIdentityState(proposedBytes),
      });
      await this.fileStore.publishOperation(lease, operation, (stage) =>
        this.assertStagedOperationFence(lease, snapshot, stage),
      );
      await this.assertOrReleasePublishedOperation(lease, operation, ready);
      await this.fileStore.publishCandidate(lease, operation, proposedBytes);
      await session.verify(ready.state);
      await this.fileStore.replaceWithRotatedState(lease, operation);
      await this.fileStore.removeOperationLast(lease, operation);
      return this.fileStore.openReadyState();
    });
  }

  async recoverInitialize(): Promise<OpenLocalIdentityState | null> {
    return this.withSession(async (session) => {
      const lease = await this.prepareRoot(session, false);
      let snapshot = await this.fileStore.inspect(lease);
      this.assertSnapshotTargets(snapshot);

      if (!snapshot.operation) {
        if (
          snapshot.candidates.length !== 0 ||
          snapshot.candidateStages.length !== 0
        ) {
          unsafeRecovery();
        }
        return this.recoverWithoutPublishedOperation(lease, snapshot);
      }

      const operation = snapshot.operation.operation;
      if (operation.operation === 'recover-orphans') {
        if (
          snapshot.candidates.length !== 0 ||
          snapshot.candidateStages.length !== 0
        ) {
          unsafeRecovery();
        }
        await this.removeStages(lease, snapshot, snapshot.operationStages);
        await this.fileStore.removeOperationLast(lease, operation);
        if (snapshot.canonical) return this.fileStore.openReadyState();
        const finalSnapshot = await this.fileStore.inspect(lease);
        if (finalSnapshot.names.length !== 0) unsafeRecovery();
        return null;
      }
      if (operation.operation !== 'initialize') {
        throw new Error('Local identity recovery command mismatch');
      }
      const expectedStage = `identity.stage-${operation.nonce}-candidate.tmp`;
      const linkedCandidateStages = snapshot.candidateStages.filter((name) =>
        this.linkedCounterpart(snapshot, name),
      );
      const unlinkedCandidateStages = snapshot.candidateStages.filter(
        (name) => !this.linkedCounterpart(snapshot, name),
      );
      if (
        snapshot.candidateStages.some((name) => name !== expectedStage) ||
        linkedCandidateStages.some(
          (name) =>
            this.linkedCounterpart(snapshot, name) !==
            operation.candidateBasename,
        ) ||
        unlinkedCandidateStages.length > 1
      ) {
        unsafeRecovery();
      }

      if (snapshot.candidates.length === 0) {
        if (linkedCandidateStages.length !== 0) unsafeRecovery();
        if (snapshot.canonical) {
          if (
            unlinkedCandidateStages.length !== 0 ||
            snapshot.canonical.digest !== operation.proposedStateDigest ||
            snapshot.canonical.state.generation !== 1
          ) {
            unsafeRecovery();
          }
          await session.verify(snapshot.canonical.state, async () => {
            await this.removeStages(lease, snapshot, snapshot.operationStages);
          });
          await this.fileStore.removeOperationLast(lease, operation);
          return snapshot.canonical;
        }
        await this.removeStages(lease, snapshot, snapshot.operationStages);
        await this.removeStages(lease, snapshot, unlinkedCandidateStages);
        await this.fileStore.removeOperationLast(lease, operation);
        return null;
      }
      if (
        snapshot.candidates.length !== 1 ||
        unlinkedCandidateStages.length !== 0
      ) {
        unsafeRecovery();
      }
      const candidate = snapshot.candidates[0];
      if (
        candidate.name !== operation.candidateBasename ||
        candidate.digest !== operation.proposedStateDigest ||
        candidate.state.generation !== 1
      ) {
        unsafeRecovery();
      }
      if (snapshot.canonical) {
        if (
          snapshot.canonical.digest !== operation.proposedStateDigest ||
          !this.fileStore.sameSnapshotInode(
            snapshot,
            snapshot.candidates[0].name,
            'identity.json',
          )
        ) {
          unsafeRecovery();
        }
        await session.verify(snapshot.canonical.state, async () => {
          await this.removeStages(lease, snapshot, snapshot.operationStages);
          await this.removeStages(lease, snapshot, linkedCandidateStages);
          await this.fileStore.removeRedundantHardlink(
            lease,
            candidate.name,
            'identity.json',
          );
        });
        await this.fileStore.removeOperationLast(lease, operation);
        return snapshot.canonical;
      }
      await session.initialize(candidate.state, async () => {
        await this.removeStages(lease, snapshot, snapshot.operationStages);
        await this.removeStages(lease, snapshot, linkedCandidateStages);
      });
      await this.fileStore.publishInitialState(lease, operation);
      await this.fileStore.removeOperationLast(lease, operation);
      return this.fileStore.openReadyState();
    });
  }

  async recoverRotation(): Promise<OpenLocalIdentityState> {
    return this.withSession(async (session) => {
      const lease = await this.prepareRoot(session, false);
      const snapshot = await this.fileStore.inspect(lease);
      this.assertSnapshotTargets(snapshot);
      if (!snapshot.operation) {
        if (
          snapshot.candidates.length !== 0 ||
          snapshot.candidateStages.length !== 0
        ) {
          unsafeRecovery();
        }
        if (!snapshot.canonical) unsafeRecovery();
        const ready = await this.recoverWithoutPublishedOperation(
          lease,
          snapshot,
        );
        if (!ready) unsafeRecovery();
        return ready;
      }
      const operation = snapshot.operation.operation;
      if (operation.operation === 'recover-orphans') {
        if (
          snapshot.candidates.length !== 0 ||
          snapshot.candidateStages.length !== 0
        ) {
          unsafeRecovery();
        }
        if (!snapshot.canonical) unsafeRecovery();
        await this.removeStages(lease, snapshot, snapshot.operationStages);
        await this.fileStore.removeOperationLast(lease, operation);
        return this.fileStore.openReadyState();
      }
      if (operation.operation !== 'rotate') {
        throw new Error('Local identity recovery command mismatch');
      }
      if (!snapshot.canonical) unsafeRecovery();
      const expectedStage = `identity.stage-${operation.nonce}-candidate.tmp`;
      const linkedCandidateStages = snapshot.candidateStages.filter((name) =>
        this.linkedCounterpart(snapshot, name),
      );
      const unlinkedCandidateStages = snapshot.candidateStages.filter(
        (name) => !this.linkedCounterpart(snapshot, name),
      );
      if (
        snapshot.candidateStages.some((name) => name !== expectedStage) ||
        linkedCandidateStages.some(
          (name) =>
            this.linkedCounterpart(snapshot, name) !==
            operation.candidateBasename,
        ) ||
        unlinkedCandidateStages.length > 1 ||
        (unlinkedCandidateStages.length !== 0 &&
          snapshot.candidates.length !== 0)
      ) {
        unsafeRecovery();
      }

      if (
        snapshot.canonical.state.generation === operation.baseGeneration + 1 &&
        snapshot.canonical.digest === operation.proposedStateDigest
      ) {
        if (
          snapshot.candidates.length !== 0 ||
          snapshot.candidateStages.length !== 0
        ) {
          unsafeRecovery();
        }
        await session.verify(snapshot.canonical.state, () =>
          this.removeStages(lease, snapshot, snapshot.operationStages),
        );
        await this.fileStore.removeOperationLast(lease, operation);
        return snapshot.canonical;
      }
      if (
        snapshot.canonical.state.generation !== operation.baseGeneration ||
        snapshot.canonical.digest !== operation.baseStateDigest
      ) {
        unsafeRecovery();
      }
      if (snapshot.candidates.length > 1) unsafeRecovery();
      if (snapshot.candidates.length === 1) {
        const candidate = snapshot.candidates[0];
        if (
          candidate.name !== operation.candidateBasename ||
          candidate.digest !== operation.proposedStateDigest ||
          candidate.state.principalId !==
            snapshot.canonical.state.principalId ||
          candidate.state.generation !== operation.baseGeneration + 1
        ) {
          unsafeRecovery();
        }
      }
      await session.verify(snapshot.canonical.state, async () => {
        await this.removeStages(lease, snapshot, snapshot.operationStages);
        await this.removeStages(lease, snapshot, linkedCandidateStages);
        await this.removeStages(lease, snapshot, unlinkedCandidateStages);
        if (snapshot.candidates.length === 1) {
          await this.fileStore.removeArtifact(
            lease,
            snapshot.candidates[0].name,
          );
        }
      });
      await this.fileStore.removeOperationLast(lease, operation);
      return snapshot.canonical;
    });
  }

  private async withSession<T>(
    operation: (session: LocalIdentitySession) => Promise<T>,
  ): Promise<T> {
    const session = await this.repository.acquire();
    let primaryError: unknown;
    try {
      return await operation(session);
    } catch (error) {
      primaryError = error;
      throw error;
    } finally {
      try {
        await session.release();
      } catch (releaseError) {
        if (!primaryError) throw releaseError;
      }
    }
  }

  private prepareRoot(session: LocalIdentitySession, create: boolean) {
    session.assertHeld();
    return this.fileStore.prepareRoot({
      create,
      assertMutationAllowed: () => session.assertHeld(),
    });
  }

  private async recoverWithoutPublishedOperation(
    lease: Awaited<ReturnType<LocalIdentityFileStore['prepareRoot']>>,
    snapshot: LocalIdentityArtifactSnapshot,
  ): Promise<OpenLocalIdentityState | null> {
    const canonical = snapshot.canonical;
    const operation = createRecoveryOperation({
      databaseTargetId: this.databaseTargetIdFromSnapshot(snapshot),
      nonce: tokenFromEntropy(
        this.randomBytes,
        canonical
          ? [
              canonical.state.databaseTargetId,
              canonical.state.principalId,
              canonical.state.credential,
            ]
          : [this.databaseTargetIdFromStore()],
      ),
    });
    const owned = await this.publishRecoveryMutex(lease, snapshot, operation);
    await this.removeStages(lease, owned, owned.operationStages);
    await this.fileStore.removeOperationLast(lease, operation);
    if (canonical) return this.fileStore.openReadyState();
    const finalSnapshot = await this.fileStore.inspect(lease);
    if (finalSnapshot.names.length !== 0) unsafeRecovery();
    return null;
  }

  private async assertOperationOwnershipAfterPublish(
    lease: Awaited<ReturnType<LocalIdentityFileStore['prepareRoot']>>,
    operation: LocalIdentityOperation,
    expectedCanonical?: OpenLocalIdentityState,
  ): Promise<void> {
    const snapshot = await this.fileStore.inspect(lease);
    this.assertSnapshotTargets(snapshot);
    if (
      !snapshot.operation ||
      snapshot.operation.operation.operation !== operation.operation ||
      snapshot.operation.operation.nonce !== operation.nonce ||
      snapshot.candidates.length !== 0 ||
      snapshot.candidateStages.length !== 0
    ) {
      unsafeRecovery();
    }
    if (
      snapshot.operationStages.some(
        (name) => snapshot.metadata[name]?.nlink !== 1,
      )
    ) {
      unsafeRecovery();
    }
    if (expectedCanonical) {
      if (
        !snapshot.canonical ||
        snapshot.canonical.digest !== expectedCanonical.digest ||
        snapshot.names.length !== 2 + snapshot.operationStages.length
      ) {
        unsafeRecovery();
      }
    } else if (
      snapshot.canonical ||
      snapshot.names.length !== 1 + snapshot.operationStages.length
    ) {
      unsafeRecovery();
    }
  }

  private async publishRecoveryMutex(
    lease: Awaited<ReturnType<LocalIdentityFileStore['prepareRoot']>>,
    before: LocalIdentityArtifactSnapshot,
    operation: LocalIdentityOperation,
  ): Promise<LocalIdentityArtifactSnapshot> {
    if (operation.operation !== 'recover-orphans') unsafeRecovery();
    let published = false;
    let ownershipEstablished = false;
    try {
      await this.fileStore.publishOperation(lease, operation, (stage) =>
        this.assertStagedOperationFence(lease, before, stage),
      );
      published = true;
      const owned = await this.fileStore.inspect(lease);
      this.assertSnapshotTargets(owned);
      if (
        !owned.operation ||
        owned.operation.operation.operation !== 'recover-orphans' ||
        owned.operation.operation.nonce !== operation.nonce ||
        owned.candidates.length !== 0 ||
        owned.candidateStages.length !== 0
      ) {
        unsafeRecovery();
      }
      const beforeCanonical = before.canonical;
      const ownedCanonical = owned.canonical;
      if (beforeCanonical) {
        if (
          !ownedCanonical ||
          ownedCanonical.digest !== beforeCanonical.digest ||
          owned.metadata['identity.json']?.dev !==
            before.metadata['identity.json']?.dev ||
          owned.metadata['identity.json']?.ino !==
            before.metadata['identity.json']?.ino
        ) {
          unsafeRecovery();
        }
      } else if (ownedCanonical) {
        unsafeRecovery();
      }
      ownershipEstablished = true;
      return owned;
    } catch (error) {
      if (published && !ownershipEstablished) {
        await this.fileStore.removeRecoveryOperationOnAbort(lease, operation);
      }
      throw error;
    }
  }

  private async assertOrReleasePublishedOperation(
    lease: Awaited<ReturnType<LocalIdentityFileStore['prepareRoot']>>,
    operation: LocalIdentityOperation,
    expectedCanonical?: OpenLocalIdentityState,
  ): Promise<void> {
    try {
      await this.assertOperationOwnershipAfterPublish(
        lease,
        operation,
        expectedCanonical,
      );
    } catch (error) {
      await this.fileStore.removeOperationLast(lease, operation);
      throw error;
    }
  }

  private async assertStagedOperationFence(
    lease: Awaited<ReturnType<LocalIdentityFileStore['prepareRoot']>>,
    before: LocalIdentityArtifactSnapshot,
    stage: string,
  ): Promise<void> {
    const staged = await this.fileStore.inspect(lease);
    this.assertSnapshotTargets(staged);
    const priorNames = new Set(before.names);
    const additionalNames = staged.names.filter(
      (name) => !priorNames.has(name) && name !== stage,
    );
    if (
      staged.operation ||
      staged.candidates.length !== before.candidates.length ||
      staged.candidateStages.length !== before.candidateStages.length ||
      before.names.some((name) => !staged.names.includes(name)) ||
      additionalNames.some(
        (name) =>
          !staged.operationStages.includes(name) ||
          staged.metadata[name]?.nlink !== 1,
      ) ||
      staged.operationStages.filter((name) => name === stage).length !== 1 ||
      staged.metadata[stage]?.nlink !== 1
    ) {
      unsafeRecovery();
    }
    for (const name of before.names) {
      const prior = before.metadata[name];
      const current = staged.metadata[name];
      if (
        !prior ||
        !current ||
        prior.dev !== current.dev ||
        prior.ino !== current.ino ||
        prior.nlink !== current.nlink ||
        prior.size !== current.size
      ) {
        unsafeRecovery();
      }
    }
    if (before.canonical) {
      if (
        !staged.canonical ||
        staged.canonical.digest !== before.canonical.digest
      ) {
        unsafeRecovery();
      }
    } else if (staged.canonical) {
      unsafeRecovery();
    }
  }

  private requireOnlyCanonical(
    snapshot: LocalIdentityArtifactSnapshot,
  ): OpenLocalIdentityState {
    if (
      snapshot.names.length !== 1 ||
      !snapshot.canonical ||
      snapshot.operation ||
      snapshot.candidates.length !== 0 ||
      snapshot.operationStages.length !== 0 ||
      snapshot.candidateStages.length !== 0
    ) {
      unsafeRecovery();
    }
    this.assertTarget(snapshot.canonical.state.databaseTargetId);
    return snapshot.canonical;
  }

  private assertSnapshotTargets(snapshot: LocalIdentityArtifactSnapshot): void {
    if (snapshot.canonical) {
      this.assertTarget(snapshot.canonical.state.databaseTargetId);
    }
    if (snapshot.operation) {
      this.assertTarget(snapshot.operation.operation.databaseTargetId);
    }
    for (const candidate of snapshot.candidates) {
      this.assertTarget(candidate.state.databaseTargetId);
    }
  }

  private assertTarget(value: string): void {
    if (value !== this.databaseTargetIdFromStore()) targetMismatch();
  }

  private databaseTargetIdFromSnapshot(
    snapshot: LocalIdentityArtifactSnapshot,
  ): string {
    if (snapshot.canonical) return snapshot.canonical.state.databaseTargetId;
    return this.databaseTargetIdFromStore();
  }

  private databaseTargetIdFromStore(): string {
    return this.fileStore.getDatabaseTargetId();
  }

  private async removeStages(
    lease: Awaited<ReturnType<LocalIdentityFileStore['prepareRoot']>>,
    snapshot: LocalIdentityArtifactSnapshot,
    names: string[],
  ): Promise<void> {
    for (const name of names) {
      const counterpart = this.linkedCounterpart(snapshot, name);
      if (counterpart) {
        await this.fileStore.removeRedundantHardlink(lease, name, counterpart);
      } else {
        await this.fileStore.removeArtifact(lease, name);
      }
    }
  }

  private linkedCounterpart(
    snapshot: LocalIdentityArtifactSnapshot,
    name: string,
  ): string | null {
    const metadata = snapshot.metadata[name];
    if (!metadata || metadata.nlink !== 2) return null;
    const matches = snapshot.names.filter(
      (candidate) =>
        candidate !== name &&
        snapshot.metadata[candidate]?.dev === metadata.dev &&
        snapshot.metadata[candidate]?.ino === metadata.ino,
    );
    if (matches.length !== 1) unsafeRecovery();
    return matches[0];
  }
}
