import { PostgresStorageUnitOfWork } from '@/infrastructure/storage/postgres/postgres-unit-of-work';
import { AuthService } from './auth.service';
import {
  createM2MCompatibilityEmail,
  createM2MCompatibilityPrincipalId,
} from './principal-identity';

describe('AuthService', () => {
  const now = new Date('2026-01-01T00:00:00.000Z');

  function createService() {
    const userService = { findOne: jest.fn() };
    const transaction = {
      user: {
        upsert: jest.fn().mockImplementation(({ create }) =>
          Promise.resolve({
            userId: create.userId,
            email: create.email,
            createdAt: now,
            updatedAt: now,
          }),
        ),
      },
      externalIdentity: {
        count: jest.fn().mockResolvedValue(0),
      },
    };
    const prisma = {
      $transaction: jest
        .fn()
        .mockImplementation(async (operation) => operation(transaction)),
    };
    return {
      service: new AuthService(userService as never, new PostgresStorageUnitOfWork(prisma as never)),
      userService,
      prisma,
      transaction,
    };
  }

  it('loads the current human principal only by opaque userId', async () => {
    const { service, userService } = createService();
    const expected = {
      userId: 'principal-1',
      email: 'same@example.test',
      createdAt: now,
      updatedAt: now,
    };
    userService.findOne.mockResolvedValue(expected);

    await expect(service.getCurrentUser('principal-1')).resolves.toEqual(
      expected,
    );
    expect(userService.findOne).toHaveBeenCalledWith('principal-1');
  });

  it('atomically upserts M2M compatibility by deterministic namespaced userId', async () => {
    const { service, prisma, transaction } = createService();
    const key = {
      provider: 'auth0',
      issuer: 'https://tenant.auth0.test/',
      subject: 'client-123@clients',
    };
    const expectedUserId = createM2MCompatibilityPrincipalId(key);
    const expectedEmail = createM2MCompatibilityEmail(key);

    await expect(service.findOrCreateM2MUser(key)).resolves.toEqual(
      expect.objectContaining({
        userId: expectedUserId,
        email: expectedEmail,
      }),
    );

    expect(expectedUserId).toMatch(/^m2m_[A-Za-z0-9_-]{43}$/);
    expect(expectedEmail).toMatch(/^[a-f0-9]{64}@m2m\.invalid$/);
    expect(expectedUserId).not.toContain(key.subject);
    expect(expectedEmail).not.toContain(key.subject);
    expect(transaction.user.upsert).toHaveBeenCalledWith({
      where: { userId: expectedUserId },
      create: { userId: expectedUserId, email: expectedEmail },
      update: {},
    });
    expect(transaction.externalIdentity.count).toHaveBeenCalledWith({
      where: { userId: expectedUserId },
    });
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
    });
  });

  it('returns the same compatibility principal for repeated resolution', async () => {
    const { service } = createService();

    const key = {
      provider: 'auth0',
      issuer: 'https://tenant.auth0.test/',
      subject: 'client@clients',
    };
    const first = await service.findOrCreateM2MUser(key);
    const second = await service.findOrCreateM2MUser(key);

    expect(second.userId).toBe(first.userId);
    expect(second.email).toBe(first.email);
  });

  it('retries a serialization conflict in a fresh transaction', async () => {
    const { service, prisma } = createService();
    prisma.$transaction.mockRejectedValueOnce({ code: 'P2034' });

    await expect(
      service.findOrCreateM2MUser({
        provider: 'auth0',
        issuer: 'https://tenant.auth0.test/',
        subject: 'client@clients',
      }),
    ).resolves.toEqual(expect.objectContaining({ email: expect.any(String) }));
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
  });

  it('fails with one fixed error after serialization retries are exhausted', async () => {
    const { service, prisma } = createService();
    prisma.$transaction.mockRejectedValue({
      code: 'P2010',
      meta: { code: '40001', message: 'database-secret-canary' },
    });

    await expect(
      service.findOrCreateM2MUser({
        provider: 'auth0',
        issuer: 'https://tenant.auth0.test/',
        subject: 'client@clients',
      }),
    ).rejects.toThrow('Hosted M2M compatibility principal failed');
    expect(prisma.$transaction).toHaveBeenCalledTimes(5);
  });

  it('does not merge the same client subject across issuers', () => {
    const first = createM2MCompatibilityPrincipalId({
      provider: 'auth0',
      issuer: 'https://tenant-one.auth0.test/',
      subject: 'client@clients',
    });
    const second = createM2MCompatibilityPrincipalId({
      provider: 'auth0',
      issuer: 'https://tenant-two.auth0.test/',
      subject: 'client@clients',
    });

    expect(first).not.toBe(second);
  });

  it('fails closed if the deterministic M2M row has conflicting account data', async () => {
    const { service, transaction } = createService();
    const key = {
      provider: 'auth0',
      issuer: 'https://tenant.auth0.test/',
      subject: 'client@clients',
    };
    transaction.user.upsert.mockResolvedValue({
      userId: createM2MCompatibilityPrincipalId(key),
      email: 'conflict@example.test',
      createdAt: now,
      updatedAt: now,
    });

    await expect(service.findOrCreateM2MUser(key)).rejects.toThrow(
      'Hosted M2M compatibility principal conflict',
    );
  });

  it('fails closed if the compatibility row has a human identity binding', async () => {
    const { service, transaction } = createService();
    transaction.externalIdentity.count.mockResolvedValue(1);

    await expect(
      service.findOrCreateM2MUser({
        provider: 'auth0',
        issuer: 'https://tenant.auth0.test/',
        subject: 'client@clients',
      }),
    ).rejects.toThrow('Hosted M2M compatibility principal conflict');
  });

  it.each(['', ' client@clients', 'x'.repeat(1025), 'bad\u0000subject'])(
    'rejects an invalid M2M subject before touching the database (%p)',
    async (subject) => {
      const { service, prisma } = createService();

      await expect(
        service.findOrCreateM2MUser({
          provider: 'auth0',
          issuer: 'https://tenant.auth0.test/',
          subject,
        }),
      ).rejects.toThrow('Invalid hosted M2M identity');
      expect(prisma.$transaction).not.toHaveBeenCalled();
    },
  );

  it('rejects a non-client subject before touching the database', async () => {
    const { service, prisma } = createService();

    await expect(
      service.findOrCreateM2MUser({
        provider: 'auth0',
        issuer: 'https://tenant.auth0.test/',
        subject: 'auth0|human',
      }),
    ).rejects.toThrow('Invalid hosted M2M identity');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('maps database causes to a fixed M2M failure', async () => {
    const { service, prisma } = createService();
    prisma.$transaction.mockRejectedValue(new Error('database-secret-canary'));

    await expect(
      service.findOrCreateM2MUser({
        provider: 'auth0',
        issuer: 'https://tenant.auth0.test/',
        subject: 'client@clients',
      }),
    ).rejects.toThrow('Hosted M2M compatibility principal failed');
  });
});
