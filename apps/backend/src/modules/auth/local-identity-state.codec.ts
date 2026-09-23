import {
  createHash,
  randomBytes as nodeRandomBytes,
  timingSafeEqual,
} from 'node:crypto';

export const LOCAL_IDENTITY_MAX_STATE_BYTES = 1_024;
export const LOCAL_IDENTITY_MAX_OPERATION_BYTES = 2_048;
export const LOCAL_IDENTITY_CANONICAL_BASENAME = 'identity.json';
export const LOCAL_IDENTITY_OPERATION_BASENAME = 'identity.operation.json';

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const textDecoder = new TextDecoder('utf-8', { fatal: true });

export interface LocalIdentityState {
  schemaVersion: 1;
  databaseTargetId: string;
  principalId: string;
  credential: string;
  generation: number;
}

export interface InitializeLocalIdentityOperation {
  schemaVersion: 1;
  operation: 'initialize';
  databaseTargetId: string;
  nonce: string;
  candidateBasename: string;
  proposedStateDigest: string;
}

export interface RotateLocalIdentityOperation {
  schemaVersion: 1;
  operation: 'rotate';
  databaseTargetId: string;
  nonce: string;
  baseGeneration: number;
  baseStateDigest: string;
  candidateBasename: string;
  proposedStateDigest: string;
}

export interface RecoverLocalIdentityOperation {
  schemaVersion: 1;
  operation: 'recover-orphans';
  databaseTargetId: string;
  nonce: string;
}

export type LocalIdentityOperation =
  | InitializeLocalIdentityOperation
  | RotateLocalIdentityOperation
  | RecoverLocalIdentityOperation;

export type LocalIdentityArtifact =
  | { kind: 'canonical' }
  | { kind: 'operation' }
  | { kind: 'initialize-candidate'; nonce: string }
  | { kind: 'rotation-candidate'; nonce: string }
  | { kind: 'operation-stage'; nonce: string }
  | { kind: 'candidate-stage'; nonce: string };

function invalidState(): never {
  throw new Error('Invalid local identity state');
}

function invalidOperation(): never {
  throw new Error('Invalid local identity operation');
}

function isToken(value: unknown): value is string {
  if (typeof value !== 'string' || !TOKEN_PATTERN.test(value)) return false;
  const decoded = Buffer.from(value, 'base64url');
  return decoded.byteLength === 32 && decoded.toString('base64url') === value;
}

function isGeneration(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function hasExactKeys(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key, index) => Object.keys(value)[index] === key)
  );
}

function decodeCanonicalJson(
  bytes: Buffer,
  maximumBytes: number,
  invalid: () => never,
): { text: string; parsed: unknown } {
  if (
    !Buffer.isBuffer(bytes) ||
    bytes.byteLength === 0 ||
    bytes.byteLength > maximumBytes ||
    bytes.at(-1) !== 0x0a ||
    bytes.at(-2) === 0x0a ||
    (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)
  ) {
    invalid();
  }
  let text: string;
  let parsed: unknown;
  try {
    text = textDecoder.decode(bytes);
    parsed = JSON.parse(text.slice(0, -1));
  } catch {
    invalid();
  }
  return { text, parsed };
}

function assertState(value: unknown): asserts value is LocalIdentityState {
  if (
    !hasExactKeys(value, [
      'schemaVersion',
      'databaseTargetId',
      'principalId',
      'credential',
      'generation',
    ]) ||
    value.schemaVersion !== 1 ||
    !isToken(value.databaseTargetId) ||
    !isToken(value.principalId) ||
    !isToken(value.credential) ||
    value.databaseTargetId === value.principalId ||
    value.databaseTargetId === value.credential ||
    value.principalId === value.credential ||
    !isGeneration(value.generation)
  ) {
    invalidState();
  }
}

export function encodeLocalIdentityState(value: LocalIdentityState): Buffer {
  assertState(value);
  const encoded = Buffer.from(`${JSON.stringify(value)}\n`, 'utf8');
  if (encoded.byteLength > LOCAL_IDENTITY_MAX_STATE_BYTES) {
    invalidState();
  }
  return encoded;
}

export function decodeLocalIdentityState(bytes: Buffer): LocalIdentityState {
  const { text, parsed } = decodeCanonicalJson(
    bytes,
    LOCAL_IDENTITY_MAX_STATE_BYTES,
    invalidState,
  );
  assertState(parsed);
  const canonical = encodeLocalIdentityState(parsed);
  if (canonical.toString('utf8') !== text) {
    invalidState();
  }
  return parsed;
}

export function digestLocalIdentityState(bytes: Buffer): string {
  decodeLocalIdentityState(bytes);
  return createHash('sha256').update(bytes).digest('base64url');
}

export function createLocalIdentityMaterial(
  randomBytes: (size: number) => Buffer = nodeRandomBytes,
): Pick<LocalIdentityState, 'principalId' | 'credential'> {
  const principal = Buffer.from(randomBytes(32));
  const credential = Buffer.from(randomBytes(32));
  if (
    principal.byteLength !== 32 ||
    credential.byteLength !== 32 ||
    timingSafeEqual(principal, credential)
  ) {
    throw new Error('Local identity entropy failure');
  }
  return {
    principalId: principal.toString('base64url'),
    credential: credential.toString('base64url'),
  };
}

function candidateName(
  operation: 'initialize' | 'rotate',
  nonce: string,
): string {
  if (!isToken(nonce)) {
    invalidOperation();
  }
  return operation === 'initialize'
    ? `identity.pending-${nonce}.json`
    : `identity.rotate-${nonce}.json`;
}

export function createInitializeOperation(input: {
  databaseTargetId: string;
  nonce: string;
  proposedStateDigest: string;
}): InitializeLocalIdentityOperation {
  const operation: InitializeLocalIdentityOperation = {
    schemaVersion: 1,
    operation: 'initialize',
    databaseTargetId: input.databaseTargetId,
    nonce: input.nonce,
    candidateBasename: candidateName('initialize', input.nonce),
    proposedStateDigest: input.proposedStateDigest,
  };
  assertOperation(operation);
  return operation;
}

export function createRotationOperation(input: {
  databaseTargetId: string;
  nonce: string;
  baseGeneration: number;
  baseStateDigest: string;
  proposedStateDigest: string;
}): RotateLocalIdentityOperation {
  const operation: RotateLocalIdentityOperation = {
    schemaVersion: 1,
    operation: 'rotate',
    databaseTargetId: input.databaseTargetId,
    nonce: input.nonce,
    baseGeneration: input.baseGeneration,
    baseStateDigest: input.baseStateDigest,
    candidateBasename: candidateName('rotate', input.nonce),
    proposedStateDigest: input.proposedStateDigest,
  };
  assertOperation(operation);
  return operation;
}

export function createRecoveryOperation(input: {
  databaseTargetId: string;
  nonce: string;
}): RecoverLocalIdentityOperation {
  const operation: RecoverLocalIdentityOperation = {
    schemaVersion: 1,
    operation: 'recover-orphans',
    databaseTargetId: input.databaseTargetId,
    nonce: input.nonce,
  };
  assertOperation(operation);
  return operation;
}

function assertOperation(
  value: unknown,
): asserts value is LocalIdentityOperation {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    (value as Record<string, unknown>).schemaVersion !== 1
  ) {
    invalidOperation();
  }
  const record = value as Record<string, unknown>;
  if (!isToken(record.databaseTargetId) || !isToken(record.nonce)) {
    invalidOperation();
  }
  if (record.operation === 'initialize') {
    if (
      !hasExactKeys(record, [
        'schemaVersion',
        'operation',
        'databaseTargetId',
        'nonce',
        'candidateBasename',
        'proposedStateDigest',
      ]) ||
      record.candidateBasename !== candidateName('initialize', record.nonce) ||
      !isToken(record.proposedStateDigest)
    ) {
      invalidOperation();
    }
    return;
  }
  if (record.operation === 'rotate') {
    if (
      !hasExactKeys(record, [
        'schemaVersion',
        'operation',
        'databaseTargetId',
        'nonce',
        'baseGeneration',
        'baseStateDigest',
        'candidateBasename',
        'proposedStateDigest',
      ]) ||
      !isGeneration(record.baseGeneration) ||
      !isToken(record.baseStateDigest) ||
      record.candidateBasename !== candidateName('rotate', record.nonce) ||
      !isToken(record.proposedStateDigest)
    ) {
      invalidOperation();
    }
    return;
  }
  if (
    record.operation !== 'recover-orphans' ||
    !hasExactKeys(record, [
      'schemaVersion',
      'operation',
      'databaseTargetId',
      'nonce',
    ])
  ) {
    invalidOperation();
  }
}

export function encodeLocalIdentityOperation(
  value: LocalIdentityOperation,
): Buffer {
  assertOperation(value);
  const encoded = Buffer.from(`${JSON.stringify(value)}\n`, 'utf8');
  if (encoded.byteLength > LOCAL_IDENTITY_MAX_OPERATION_BYTES) {
    invalidOperation();
  }
  return encoded;
}

export function decodeLocalIdentityOperation(
  bytes: Buffer,
): LocalIdentityOperation {
  const { text, parsed } = decodeCanonicalJson(
    bytes,
    LOCAL_IDENTITY_MAX_OPERATION_BYTES,
    invalidOperation,
  );
  assertOperation(parsed);
  const canonical = encodeLocalIdentityOperation(parsed);
  if (canonical.toString('utf8') !== text) {
    invalidOperation();
  }
  return parsed;
}

export function parseLocalIdentityArtifactName(
  name: string,
): LocalIdentityArtifact | null {
  if (name === LOCAL_IDENTITY_CANONICAL_BASENAME) return { kind: 'canonical' };
  if (name === LOCAL_IDENTITY_OPERATION_BASENAME) return { kind: 'operation' };
  const patterns: Array<[RegExp, LocalIdentityArtifact['kind']]> = [
    [/^identity\.pending-([A-Za-z0-9_-]{43})\.json$/u, 'initialize-candidate'],
    [/^identity\.rotate-([A-Za-z0-9_-]{43})\.json$/u, 'rotation-candidate'],
    [
      /^identity\.stage-operation-([A-Za-z0-9_-]{43})\.tmp$/u,
      'operation-stage',
    ],
    [
      /^identity\.stage-([A-Za-z0-9_-]{43})-candidate\.tmp$/u,
      'candidate-stage',
    ],
  ];
  for (const [pattern, kind] of patterns) {
    const match = pattern.exec(name);
    if (match && isToken(match[1])) {
      return { kind: kind as never, nonce: match[1] } as LocalIdentityArtifact;
    }
  }
  return null;
}
