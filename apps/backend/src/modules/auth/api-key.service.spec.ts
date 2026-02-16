import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { createHash } from 'crypto';
import { ApiKeyService } from './api-key.service';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';

const hashKey = (key: string) =>
  createHash('sha256').update(key).digest('hex');

const mockUser = {
  userId: 'user-1',
  email: 'alice@workshop.dev',
  firstName: 'Alice',
  lastName: 'Anderson',
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockApiKey = {
  id: 'key-1',
  keyHash: hashKey('grp-a-abc123'),
  groupName: 'Group A',
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('ApiKeyService', () => {
  let service: ApiKeyService;
  let prisma: {
    apiKey: { findUnique: jest.Mock };
    user: { findUnique: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      apiKey: { findUnique: jest.fn() },
      user: { findUnique: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ApiKeyService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<ApiKeyService>(ApiKeyService);
  });

  describe('validateApiKeyAndUser', () => {
    it('should return user for valid key and valid user', async () => {
      prisma.apiKey.findUnique.mockResolvedValue({
        ...mockApiKey,
        users: [{ user: mockUser }],
      });

      const result = await service.validateApiKeyAndUser(
        'grp-a-abc123',
        'user-1',
      );

      expect(result).toEqual(mockUser);
      expect(prisma.apiKey.findUnique).toHaveBeenCalledWith({
        where: { keyHash: hashKey('grp-a-abc123') },
        include: {
          users: {
            where: { userId: 'user-1' },
            include: { user: true },
          },
        },
      });
    });

    it('should throw 401 for invalid API key', async () => {
      prisma.apiKey.findUnique.mockResolvedValue(null);

      await expect(
        service.validateApiKeyAndUser('invalid-key', 'user-1'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw 401 for inactive API key', async () => {
      prisma.apiKey.findUnique.mockResolvedValue({
        ...mockApiKey,
        isActive: false,
        users: [],
      });

      await expect(
        service.validateApiKeyAndUser('grp-a-abc123', 'user-1'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw 401 when user is not in the API key group', async () => {
      prisma.apiKey.findUnique.mockResolvedValue({
        ...mockApiKey,
        users: [],
      });
      prisma.user.findUnique.mockResolvedValue(mockUser);

      await expect(
        service.validateApiKeyAndUser('grp-a-abc123', 'user-1'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw 401 when user does not exist', async () => {
      prisma.apiKey.findUnique.mockResolvedValue({
        ...mockApiKey,
        users: [],
      });
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.validateApiKeyAndUser('grp-a-abc123', 'nonexistent'),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('validateApiKey', () => {
    it('should return API key record for valid key', async () => {
      prisma.apiKey.findUnique.mockResolvedValue(mockApiKey);

      const result = await service.validateApiKey('grp-a-abc123');

      expect(result).toEqual(mockApiKey);
    });

    it('should throw 401 for invalid API key', async () => {
      prisma.apiKey.findUnique.mockResolvedValue(null);

      await expect(
        service.validateApiKey('invalid-key'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw 401 for inactive API key', async () => {
      prisma.apiKey.findUnique.mockResolvedValue({
        ...mockApiKey,
        isActive: false,
      });

      await expect(
        service.validateApiKey('grp-a-abc123'),
      ).rejects.toThrow(UnauthorizedException);
    });
  });
});
