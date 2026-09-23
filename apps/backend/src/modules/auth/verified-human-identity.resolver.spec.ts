import { PostgresIdentityStorage } from '@/infrastructure/storage/postgres/postgres-identity-storage';
import { PostgresStorageUnitOfWork } from '@/infrastructure/storage/postgres/postgres-unit-of-work';
import { Logger } from '@nestjs/common';
import {
  PreferenceStatus,
  SourceType,
} from '@infrastructure/prisma/generated-client';
import {
  VerifiedHumanIdentityResolver,
  validateVerifiedHumanIdentityAssertion,
} from './verified-human-identity.resolver';

describe('VerifiedHumanIdentityResolver', () => {
  const now = new Date('2026-01-01T00:00:00.000Z');

  function user(userId: string, email = 'person@example.test') {
    return { userId, email, createdAt: now, updatedAt: now };
  }

  function createResolver() {
    const transaction = {
      externalIdentity: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
      },
      user: {
        create: jest
          .fn()
          .mockImplementation(({ data }) =>
            Promise.resolve(user(data.userId, data.email)),
          ),
      },
    };
    const prisma = {
      $transaction: jest
        .fn()
        .mockImplementation(async (operation) => operation(transaction)),
      externalIdentity: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      preferenceDefinition: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'def-full-name', slug: 'profile.full_name' },
          { id: 'def-first-name', slug: 'profile.first_name' },
          { id: 'def-last-name', slug: 'profile.last_name' },
          { id: 'def-email', slug: 'profile.email' },
        ]),
      },
      preference: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
      },
    };

    return {
      resolver: new VerifiedHumanIdentityResolver(new PostgresStorageUnitOfWork(prisma as never), new PostgresIdentityStorage(prisma as never)),
      prisma,
      transaction,
    };
  }

  const auth0Assertion = {
    key: {
      provider: 'auth0',
      issuer: 'https://tenant.auth0.test/',
      subject: 'auth0|subject-1',
    },
    profileHints: {
      verifiedEmail: 'person@example.test',
      displayName: 'Ada Lovelace',
      givenName: 'Ada',
      familyName: 'Lovelace',
    },
  } as const;

  it('resolves an exact provider, issuer, and subject without email lookup', async () => {
    const { resolver, prisma, transaction } = createResolver();
    const existing = user('principal-existing', 'changed@example.test');
    transaction.externalIdentity.findUnique.mockResolvedValue({
      id: 'identity-1',
      user: existing,
    });

    await expect(resolver.resolve(auth0Assertion)).resolves.toEqual(existing);

    expect(transaction.externalIdentity.findUnique).toHaveBeenCalledWith({
      where: {
        provider_issuer_providerUserId: {
          provider: 'auth0',
          issuer: 'https://tenant.auth0.test/',
          providerUserId: 'auth0|subject-1',
        },
      },
      include: { user: true },
    });
    expect(transaction.user.create).not.toHaveBeenCalled();
    expect(transaction.externalIdentity.create).not.toHaveBeenCalled();
    expect(prisma.preferenceDefinition.findMany).not.toHaveBeenCalled();
    expect(prisma.preference.create).not.toHaveBeenCalled();
  });

  it('creates the opaque principal and exact binding in one serializable transaction', async () => {
    const { resolver, prisma, transaction } = createResolver();

    const resolved = await resolver.resolve(auth0Assertion);

    expect(resolved.userId).toMatch(/^[0-9a-f-]{36}$/);
    expect(transaction.user.create).toHaveBeenCalledWith({
      data: {
        userId: resolved.userId,
        email: 'person@example.test',
      },
    });
    expect(transaction.externalIdentity.create).toHaveBeenCalledWith({
      data: {
        userId: resolved.userId,
        provider: 'auth0',
        issuer: 'https://tenant.auth0.test/',
        providerUserId: 'auth0|subject-1',
        metadata: expect.anything(),
      },
    });
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
    });
  });

  it('uses the same core path for a second provider and never merges equal email', async () => {
    const { resolver, transaction } = createResolver();

    const first = await resolver.resolve(auth0Assertion);
    const fakeSecondProviderAdapter = () => ({
      key: {
        provider: 'example-idp',
        issuer: 'urn:example:tenant-a',
        subject: 'opaque-subject-2',
      },
      profileHints: { verifiedEmail: 'person@example.test' },
    });
    const second = await resolver.resolve(fakeSecondProviderAdapter());

    expect(first.userId).not.toBe(second.userId);
    expect(transaction.user.create).toHaveBeenNthCalledWith(1, {
      data: { userId: first.userId, email: 'person@example.test' },
    });
    expect(transaction.user.create).toHaveBeenNthCalledWith(2, {
      data: { userId: second.userId, email: 'person@example.test' },
    });
    expect(transaction.externalIdentity.create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.objectContaining({
          provider: 'example-idp',
          issuer: 'urn:example:tenant-a',
          providerUserId: 'opaque-subject-2',
        }),
      }),
    );
  });

  it('uses deterministic non-routable compatibility email only when verified contact is absent', async () => {
    const { resolver, transaction, prisma } = createResolver();

    const resolved = await resolver.resolve({
      key: {
        provider: 'auth0',
        issuer: 'https://tenant.auth0.test/',
        subject: 'auth0|no-email',
      },
      profileHints: { displayName: 'No Contact' },
    });

    const createdEmail = transaction.user.create.mock.calls[0][0].data.email;
    expect(createdEmail).toMatch(/^[a-f0-9]{64}@principal\.invalid$/);
    expect(createdEmail).not.toContain('no-email');
    expect(resolved.email).toBe(createdEmail);
    expect(prisma.preference.create).not.toHaveBeenCalledWith({
      data: expect.objectContaining({ definitionId: 'def-email' }),
    });
  });

  it('seeds non-authoritative profile hints only after a new principal commits', async () => {
    const { resolver, prisma } = createResolver();

    await resolver.resolve(auth0Assertion);

    expect(prisma.preference.create).toHaveBeenCalledTimes(4);
    expect(prisma.preference.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        definitionId: 'def-full-name',
        value: 'Ada Lovelace',
        status: PreferenceStatus.ACTIVE,
        sourceType: SourceType.IMPORTED,
      }),
    });
    expect(prisma.preference.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        definitionId: 'def-email',
        value: 'person@example.test',
      }),
    });
    expect(prisma.$transaction.mock.invocationCallOrder[0]).toBeLessThan(
      prisma.preferenceDefinition.findMany.mock.invocationCallOrder[0],
    );
  });

  it('does not query profile state until the identity transaction resolves', async () => {
    const { resolver, prisma } = createResolver();
    let finishTransaction: ((value: unknown) => void) | undefined;
    prisma.$transaction.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishTransaction = resolve;
        }),
    );

    const pending = resolver.resolve(auth0Assertion);
    await Promise.resolve();
    expect(prisma.preferenceDefinition.findMany).not.toHaveBeenCalled();

    finishTransaction?.({
      created: true,
      user: user('principal-after-commit'),
    });
    await expect(pending).resolves.toEqual(user('principal-after-commit'));
    expect(prisma.preferenceDefinition.findMany).toHaveBeenCalledTimes(1);
  });

  it('does not fail authentication or expose a cause when profile seeding fails', async () => {
    const { resolver, prisma } = createResolver();
    const warn = jest.spyOn(Logger.prototype, 'warn');
    prisma.preferenceDefinition.findMany.mockRejectedValue(
      new Error('profile-seed-secret'),
    );

    await expect(resolver.resolve(auth0Assertion)).resolves.toEqual(
      expect.objectContaining({ email: 'person@example.test' }),
    );
    expect(warn).toHaveBeenCalledWith(
      'Could not seed initial profile preferences',
    );
    expect(JSON.stringify(warn.mock.calls)).not.toContain(
      'profile-seed-secret',
    );
    warn.mockRestore();
  });

  it('retries serialization conflicts using a fresh transaction', async () => {
    const { resolver, prisma, transaction } = createResolver();
    prisma.$transaction
      .mockRejectedValueOnce({ code: 'P2034' })
      .mockImplementationOnce(async (operation) => operation(transaction));

    await expect(resolver.resolve(auth0Assertion)).resolves.toEqual(
      expect.objectContaining({ email: 'person@example.test' }),
    );
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
  });

  it('accepts a final create race only after an exact post-rollback lookup', async () => {
    const { resolver, prisma } = createResolver();
    const winner = user('principal-winner');
    prisma.$transaction.mockRejectedValue({ code: 'P2002' });
    prisma.externalIdentity.findUnique.mockResolvedValue({ user: winner });

    await expect(resolver.resolve(auth0Assertion)).resolves.toEqual(winner);
    expect(prisma.externalIdentity.findUnique).toHaveBeenCalledWith({
      where: {
        provider_issuer_providerUserId: {
          provider: 'auth0',
          issuer: 'https://tenant.auth0.test/',
          providerUserId: 'auth0|subject-1',
        },
      },
      include: { user: true },
    });
  });

  it('does not reinterpret an exhausted serialization failure as a winner', async () => {
    const { resolver, prisma } = createResolver();
    prisma.$transaction.mockRejectedValue({ code: 'P2034' });
    prisma.externalIdentity.findUnique.mockResolvedValue({
      user: user('unrelated-late-row'),
    });

    await expect(resolver.resolve(auth0Assertion)).rejects.toThrow(
      'Human identity resolution conflict',
    );
    expect(prisma.externalIdentity.findUnique).not.toHaveBeenCalled();
  });

  it('fails closed when a final unique conflict has no exact winner', async () => {
    const { resolver, prisma } = createResolver();
    prisma.$transaction.mockRejectedValue({ code: 'P2002' });

    await expect(resolver.resolve(auth0Assertion)).rejects.toThrow(
      'Human identity resolution conflict',
    );
  });

  it('maps non-retryable database causes to one fixed secret-free failure', async () => {
    const { resolver, prisma } = createResolver();
    prisma.$transaction.mockRejectedValue(
      new Error('postgresql://user:secret@database/internal-table'),
    );

    let failure: Error | undefined;
    try {
      await resolver.resolve(auth0Assertion);
    } catch (error) {
      failure = error as Error;
    }
    expect(failure?.message).toBe('Human identity resolution failed');
    expect(JSON.stringify(failure)).not.toContain('secret');
  });

  it.each([
    [{ provider: 'Auth0', issuer: 'https://tenant/', subject: 's' }],
    [{ provider: 'auth0', issuer: ' https://tenant/', subject: 's' }],
    [{ provider: 'auth0', issuer: 'https://tenant/', subject: '' }],
    [{ provider: 'a'.repeat(33), issuer: 'https://tenant/', subject: 's' }],
    [
      {
        provider: 'auth0',
        issuer: 'https://tenant/',
        subject: 'x'.repeat(1025),
      },
    ],
  ])('rejects malformed assertions before querying %#', async (key) => {
    const { resolver, prisma } = createResolver();

    await expect(resolver.resolve({ key } as never)).rejects.toThrow(
      'Invalid verified human identity assertion',
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it.each([
    [{ verifiedEmail: 'not-an-email' }],
    [{ verifiedEmail: ' person@example.test' }],
    [{ displayName: 'x'.repeat(257) }],
    [{ givenName: 'control\u0000value' }],
    [{ familyName: '' }],
  ])(
    'omits malformed profile hints and creates the exact principal %#',
    async (profileHints) => {
      const { resolver, prisma, transaction } = createResolver();

      const resolved = await resolver.resolve({
        ...auth0Assertion,
        profileHints,
      } as never);
      expect(resolved.email).toMatch(/^[a-f0-9]{64}@principal\.invalid$/);
      expect(transaction.externalIdentity.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: resolved.userId,
          provider: 'auth0',
          issuer: auth0Assertion.key.issuer,
          providerUserId: auth0Assertion.key.subject,
        }),
      });
      expect(prisma.preference.create).not.toHaveBeenCalled();
    },
  );

  it('seeds only valid sibling hints when creating a new principal', async () => {
    const { resolver, prisma } = createResolver();

    const resolved = await resolver.resolve({
      ...auth0Assertion,
      profileHints: {
        verifiedEmail: 'not an email',
        displayName: 'Ada ',
        givenName: 'Ada',
        familyName: '\ud800',
      },
    });

    expect(resolved.email).toMatch(/^[a-f0-9]{64}@principal\.invalid$/);
    expect(prisma.preference.create).toHaveBeenCalledTimes(1);
    expect(prisma.preference.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        definitionId: 'def-first-name',
        value: 'Ada',
      }),
    });
  });

  it.each(['auth0', 'example-idp'])(
    'keeps valid siblings and exact existing identity for %s',
    async (provider) => {
      const { resolver, transaction, prisma } = createResolver();
      const existing = user('principal-existing');
      transaction.externalIdentity.findUnique.mockResolvedValue({
        user: existing,
      });
      const assertion = {
        key: { ...auth0Assertion.key, provider },
        profileHints: {
          verifiedEmail: 'not an email',
          displayName: 'Ada ',
          givenName: 'Ada',
          familyName: '\ud800',
        },
      };

      expect(validateVerifiedHumanIdentityAssertion(assertion)).toEqual({
        key: assertion.key,
        profileHints: { givenName: 'Ada' },
      });
      await expect(resolver.resolve(assertion)).resolves.toBe(existing);
      expect(transaction.user.create).not.toHaveBeenCalled();
      expect(prisma.preference.create).not.toHaveBeenCalled();
    },
  );

  it.each([
    null,
    [],
    'bad-envelope',
    { unknown: 'value' },
    { displayName: 'Ada', token: 'secret-canary' },
  ])(
    'still rejects malformed hint structure before querying %#',
    async (profileHints) => {
      const { resolver, prisma } = createResolver();
      await expect(
        resolver.resolve({ ...auth0Assertion, profileHints } as never),
      ).rejects.toThrow('Invalid verified human identity assertion');
      expect(prisma.$transaction).not.toHaveBeenCalled();
    },
  );
});
