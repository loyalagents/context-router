import {
  LOCAL_IDENTITY_MAX_OPERATION_BYTES,
  LOCAL_IDENTITY_MAX_STATE_BYTES,
  createInitializeOperation,
  createLocalIdentityMaterial,
  createRecoveryOperation,
  createRotationOperation,
  decodeLocalIdentityOperation,
  decodeLocalIdentityState,
  digestLocalIdentityState,
  encodeLocalIdentityOperation,
  encodeLocalIdentityState,
  parseLocalIdentityArtifactName,
} from './local-identity-state.codec';

const token = (fill: number) => Buffer.alloc(32, fill).toString('base64url');
const TARGET_ID = token(1);
const PRINCIPAL_ID = token(2);
const CREDENTIAL = token(3);
const NONCE = token(4);
const DIGEST = token(5);

const READY_STATE = {
  schemaVersion: 1 as const,
  databaseTargetId: TARGET_ID,
  principalId: PRINCIPAL_ID,
  credential: CREDENTIAL,
  generation: 1,
};

describe('local identity state codec', () => {
  it('encodes and decodes the one canonical state representation', () => {
    const encoded = encodeLocalIdentityState(READY_STATE);
    expect(encoded.toString('utf8')).toBe(
      `{"schemaVersion":1,"databaseTargetId":"${TARGET_ID}","principalId":"${PRINCIPAL_ID}","credential":"${CREDENTIAL}","generation":1}\n`,
    );
    expect(encoded.byteLength).toBeLessThanOrEqual(
      LOCAL_IDENTITY_MAX_STATE_BYTES,
    );
    expect(decodeLocalIdentityState(encoded)).toEqual(READY_STATE);
    expect(digestLocalIdentityState(encoded)).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it.each([
    ['missing LF', Buffer.from(JSON.stringify(READY_STATE))],
    ['two final LFs', Buffer.from(`${JSON.stringify(READY_STATE)}\n\n`)],
    [
      'BOM',
      Buffer.concat([
        Buffer.from([0xef, 0xbb, 0xbf]),
        encodeLocalIdentityState(READY_STATE),
      ]),
    ],
    ['invalid UTF-8', Buffer.from([0xff, 0x0a])],
    ['whitespace', Buffer.from(`${JSON.stringify(READY_STATE, null, 2)}\n`)],
    [
      'unknown key',
      Buffer.from(`${JSON.stringify({ ...READY_STATE, extra: true })}\n`),
    ],
    [
      'wrong key order',
      Buffer.from(
        `${JSON.stringify({ generation: 1, schemaVersion: 1, databaseTargetId: TARGET_ID, principalId: PRINCIPAL_ID, credential: CREDENTIAL })}\n`,
      ),
    ],
    [
      'duplicate key',
      Buffer.from(
        `{"schemaVersion":1,"schemaVersion":1,"databaseTargetId":"${TARGET_ID}","principalId":"${PRINCIPAL_ID}","credential":"${CREDENTIAL}","generation":1}\n`,
      ),
    ],
    ['oversize', Buffer.alloc(LOCAL_IDENTITY_MAX_STATE_BYTES + 1, 0x41)],
  ])('rejects non-canonical state: %s', (_name, bytes) => {
    expect(() => decodeLocalIdentityState(bytes)).toThrow(
      'Invalid local identity state',
    );
  });

  it.each([
    { ...READY_STATE, schemaVersion: 2 },
    { ...READY_STATE, databaseTargetId: 'short' },
    { ...READY_STATE, principalId: '!'.repeat(43) },
    { ...READY_STATE, principalId: `${PRINCIPAL_ID.slice(0, -1)}B` },
    { ...READY_STATE, credential: '='.repeat(43) },
    { ...READY_STATE, principalId: TARGET_ID },
    { ...READY_STATE, credential: TARGET_ID },
    { ...READY_STATE, credential: PRINCIPAL_ID },
    { ...READY_STATE, generation: 0 },
    { ...READY_STATE, generation: -1 },
    { ...READY_STATE, generation: Number.MAX_SAFE_INTEGER + 1 },
  ])('rejects invalid state fields without partial output', (state) => {
    expect(() => encodeLocalIdentityState(state as never)).toThrow(
      'Invalid local identity state',
    );
  });

  it.each([
    { ...READY_STATE, principalId: TARGET_ID },
    { ...READY_STATE, credential: TARGET_ID },
    { ...READY_STATE, credential: PRINCIPAL_ID },
  ])(
    'rejects a canonical persisted state with aliased identity material',
    (state) => {
      expect(() =>
        decodeLocalIdentityState(
          Buffer.from(`${JSON.stringify(state)}\n`, 'utf8'),
        ),
      ).toThrow('Invalid local identity state');
    },
  );

  it('generates independent principal and credential values from two 32-byte CSPRNG calls', () => {
    const calls: number[] = [];
    const values = [Buffer.alloc(32, 0x01), Buffer.alloc(32, 0x02)];
    const material = createLocalIdentityMaterial((size) => {
      calls.push(size);
      return values[calls.length - 1];
    });

    expect(calls).toEqual([32, 32]);
    expect(material.principalId).toBe(values[0].toString('base64url'));
    expect(material.credential).toBe(values[1].toString('base64url'));
    expect(material.principalId).not.toBe(material.credential);
  });

  it('fails closed when the entropy source aliases or returns the wrong size', () => {
    expect(() => createLocalIdentityMaterial(() => Buffer.alloc(31))).toThrow(
      'Local identity entropy failure',
    );
    expect(() =>
      createLocalIdentityMaterial(() => Buffer.alloc(32, 0x01)),
    ).toThrow('Local identity entropy failure');
  });
});

describe('local identity operation codec', () => {
  it('round-trips canonical initialize, rotate, and no-mutation recovery records without a credential', () => {
    const initialize = createInitializeOperation({
      databaseTargetId: TARGET_ID,
      nonce: NONCE,
      proposedStateDigest: DIGEST,
    });
    const rotate = createRotationOperation({
      databaseTargetId: TARGET_ID,
      nonce: NONCE,
      baseGeneration: 1,
      baseStateDigest: token(6),
      proposedStateDigest: DIGEST,
    });
    const recover = createRecoveryOperation({
      databaseTargetId: TARGET_ID,
      nonce: NONCE,
    });

    expect(initialize.candidateBasename).toBe(`identity.pending-${NONCE}.json`);
    expect(rotate.candidateBasename).toBe(`identity.rotate-${NONCE}.json`);
    expect(recover.operation).toBe('recover-orphans');
    for (const operation of [initialize, rotate, recover]) {
      const encoded = encodeLocalIdentityOperation(operation);
      expect(encoded.at(-1)).toBe(0x0a);
      expect(encoded.byteLength).toBeLessThanOrEqual(
        LOCAL_IDENTITY_MAX_OPERATION_BYTES,
      );
      expect(encoded.toString('utf8')).not.toContain(CREDENTIAL);
      expect(decodeLocalIdentityOperation(encoded)).toEqual(operation);
    }
  });

  it('rejects record drift, credential-bearing records, inconsistent names, and non-canonical bytes', () => {
    const initialize = createInitializeOperation({
      databaseTargetId: TARGET_ID,
      nonce: NONCE,
      proposedStateDigest: DIGEST,
    });
    const cases = [
      Buffer.from(
        `${JSON.stringify({ ...initialize, credential: CREDENTIAL })}\n`,
      ),
      Buffer.from(
        `${JSON.stringify({ ...initialize, candidateBasename: 'identity.pending-other.json' })}\n`,
      ),
      Buffer.from(`${JSON.stringify(initialize)}`),
      Buffer.alloc(LOCAL_IDENTITY_MAX_OPERATION_BYTES + 1, 0x41),
    ];
    for (const bytes of cases) {
      expect(() => decodeLocalIdentityOperation(bytes)).toThrow(
        'Invalid local identity operation',
      );
    }
  });

  it.each([
    ['identity.json', { kind: 'canonical' }],
    ['identity.operation.json', { kind: 'operation' }],
    [
      `identity.pending-${NONCE}.json`,
      { kind: 'initialize-candidate', nonce: NONCE },
    ],
    [
      `identity.rotate-${NONCE}.json`,
      { kind: 'rotation-candidate', nonce: NONCE },
    ],
    [
      `identity.stage-operation-${NONCE}.tmp`,
      { kind: 'operation-stage', nonce: NONCE },
    ],
    [
      `identity.stage-${NONCE}-candidate.tmp`,
      { kind: 'candidate-stage', nonce: NONCE },
    ],
  ])('recognizes only an exact bounded artifact name: %s', (name, parsed) => {
    expect(parseLocalIdentityArtifactName(name)).toEqual(parsed);
  });

  it.each([
    'identity.pending-short.json',
    `identity.pending-${NONCE}.json.extra`,
    `../identity.pending-${NONCE}.json`,
    '.identity.json',
    'identity.stage.tmp',
    'unrelated',
    `identity.pending-${NONCE.slice(0, -1)}B.json`,
  ])('rejects unknown artifact name %s', (name) => {
    expect(parseLocalIdentityArtifactName(name)).toBeNull();
  });
});
