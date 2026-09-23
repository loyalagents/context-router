import { ExternalIdentityRepository } from './external-identity.repository';

describe('ExternalIdentityRepository', () => {
  function createRepository() {
    const prisma = {
      externalIdentity: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
    };
    return {
      repository: new ExternalIdentityRepository(prisma as never),
      prisma,
    };
  }

  it('looks up only by the exact provider, issuer, and subject', async () => {
    const { repository, prisma } = createRepository();
    prisma.externalIdentity.findUnique.mockResolvedValue(null);

    await expect(
      repository.findByProviderAndUserId(
        'example-idp',
        'urn:example:tenant',
        'opaque-subject',
      ),
    ).resolves.toBeNull();

    expect(prisma.externalIdentity.findUnique).toHaveBeenCalledWith({
      where: {
        provider_issuer_providerUserId: {
          provider: 'example-idp',
          issuer: 'urn:example:tenant',
          providerUserId: 'opaque-subject',
        },
      },
    });
  });

  it('passes non-authoritative metadata through without provider policy', async () => {
    const { repository, prisma } = createRepository();
    prisma.externalIdentity.create.mockResolvedValue({ id: 'identity-1' });

    await repository.create({
      userId: 'principal-1',
      provider: 'example-idp',
      issuer: 'urn:example:tenant',
      providerUserId: 'opaque-subject',
      metadata: { display: 'hint-only' },
    });

    expect(prisma.externalIdentity.create).toHaveBeenCalledWith({
      data: {
        userId: 'principal-1',
        provider: 'example-idp',
        issuer: 'urn:example:tenant',
        providerUserId: 'opaque-subject',
        metadata: { display: 'hint-only' },
      },
    });
  });

  it('updates and deletes ordinary metadata rows directly', async () => {
    const { repository, prisma } = createRepository();
    prisma.externalIdentity.update.mockResolvedValue({ id: 'identity-1' });
    prisma.externalIdentity.delete.mockResolvedValue({ id: 'identity-1' });

    await repository.update('identity-1', { metadata: { display: 'new' } });
    await repository.delete('identity-1');

    expect(prisma.externalIdentity.update).toHaveBeenCalledWith({
      where: { id: 'identity-1' },
      data: { metadata: { display: 'new' } },
    });
    expect(prisma.externalIdentity.delete).toHaveBeenCalledWith({
      where: { id: 'identity-1' },
    });
  });
});
