import { PermissionGrantRepository } from './permission-grant.repository';
import { PermissionGrantService } from './permission-grant.service';

type MockRepository = Pick<
  PermissionGrantRepository,
  'findMatchingGrants' | 'findByUserClientAction'
>;

describe('PermissionGrantService', () => {
  let repository: jest.Mocked<MockRepository>;
  let service: PermissionGrantService;

  beforeEach(() => {
    repository = {
      findMatchingGrants: jest.fn(),
      findByUserClientAction: jest.fn(),
    };
    service = new PermissionGrantService(
      repository as unknown as PermissionGrantRepository,
    );
  });

  describe('buildPrefixChain', () => {
    it('should build the chain for a two-segment slug', () => {
      expect(service.buildPrefixChain('food.dietary_restrictions')).toEqual([
        'food.dietary_restrictions',
        'food.*',
        '*',
      ]);
    });

    it('should build the chain for a three-segment slug', () => {
      expect(service.buildPrefixChain('food.french.wine')).toEqual([
        'food.french.wine',
        'food.french.*',
        'food.*',
        '*',
      ]);
    });

    it('should include each parent prefix wildcard exactly once', () => {
      expect(
        service.buildPrefixChain('dev.typescript.formatting.rules'),
      ).toEqual([
        'dev.typescript.formatting.rules',
        'dev.typescript.formatting.*',
        'dev.typescript.*',
        'dev.*',
        '*',
      ]);
    });
  });

  describe('evaluateAccess', () => {
    it('should return no-grant when there are no matching grants', async () => {
      repository.findMatchingGrants.mockResolvedValue([]);

      await expect(
        service.evaluateAccess(
          'user-1',
          'claude',
          'READ',
          'food.dietary_restrictions',
        ),
      ).resolves.toBe('no-grant');
    });

    it('should normalize lowercase action inputs for every grant action', async () => {
      repository.findMatchingGrants.mockResolvedValue([]);

      await service.evaluateAccess('user-1', 'claude', 'read', 'food.test');
      await service.evaluateAccess('user-1', 'claude', 'suggest', 'food.test');
      await service.evaluateAccess('user-1', 'claude', 'write', 'food.test');
      await service.evaluateAccess('user-1', 'claude', 'define', 'food.test');

      expect(
        repository.findMatchingGrants.mock.calls.map((call) => call[2]),
      ).toEqual(['READ', 'SUGGEST', 'WRITE', 'DEFINE']);
    });

    it('should use the most specific matching grant', async () => {
      repository.findMatchingGrants.mockResolvedValue([
        {
          target: 'food.dietary_restrictions',
          effect: 'DENY',
        },
        {
          target: 'food.*',
          effect: 'ALLOW',
        },
        {
          target: '*',
          effect: 'DENY',
        },
      ] as any);

      await expect(
        service.evaluateAccess(
          'user-1',
          'claude',
          'READ',
          'food.dietary_restrictions',
        ),
      ).resolves.toBe('deny');
    });

    it('should prefer deny when multiple grants share the same specificity', async () => {
      repository.findMatchingGrants.mockResolvedValue([
        {
          target: 'food.same.*',
          effect: 'ALLOW',
        },
        {
          target: 'food.same.*',
          effect: 'DENY',
        },
        {
          target: '*',
          effect: 'ALLOW',
        },
      ] as any);

      await expect(
        service.evaluateAccess('user-1', 'claude', 'READ', 'food.same.slug'),
      ).resolves.toBe('deny');
    });

    it('should let an exact slug beat a category wildcard', async () => {
      repository.findMatchingGrants.mockResolvedValue([
        {
          target: 'food.dietary_restrictions',
          effect: 'ALLOW',
        },
        {
          target: 'food.*',
          effect: 'DENY',
        },
      ] as any);

      await expect(
        service.evaluateAccess(
          'user-1',
          'claude',
          'READ',
          'food.dietary_restrictions',
        ),
      ).resolves.toBe('allow');
    });

    it('should let a short exact slug beat a same-length wildcard target', async () => {
      repository.findMatchingGrants.mockResolvedValue([
        {
          target: 'a.b',
          effect: 'ALLOW',
        },
        {
          target: 'a.*',
          effect: 'DENY',
        },
      ] as any);

      await expect(
        service.evaluateAccess('user-1', 'claude', 'READ', 'a.b'),
      ).resolves.toBe('allow');
    });

    it('should apply the global wildcard when that is the only match', async () => {
      repository.findMatchingGrants.mockResolvedValue([
        {
          target: '*',
          effect: 'DENY',
        },
      ] as any);

      await expect(
        service.evaluateAccess(
          'user-1',
          'claude',
          'WRITE',
          'system.response_tone',
        ),
      ).resolves.toBe('deny');
    });

    it('should allow multi-segment wildcard matches', async () => {
      repository.findMatchingGrants.mockResolvedValue([
        {
          target: 'food.french.*',
          effect: 'ALLOW',
        },
      ] as any);

      await expect(
        service.evaluateAccess('user-1', 'claude', 'READ', 'food.french.wine'),
      ).resolves.toBe('allow');
    });
  });

  describe('filterSlugsByAccess', () => {
    it('should filter denied slugs while preserving allowed and no-grant slugs', async () => {
      repository.findByUserClientAction.mockResolvedValue([
        {
          target: '*',
          effect: 'ALLOW',
        },
        {
          target: 'food.*',
          effect: 'DENY',
        },
        {
          target: 'food.dietary_restrictions',
          effect: 'ALLOW',
        },
        {
          target: 'dev.secret.*',
          effect: 'DENY',
        },
      ] as any);

      await expect(
        service.filterSlugsByAccess('user-1', 'claude', 'READ', [
          'food.dietary_restrictions',
          'food.favorite_restaurant',
          'system.response_tone',
          'dev.secret.token',
        ]),
      ).resolves.toEqual(['food.dietary_restrictions', 'system.response_tone']);
    });

    it('should preserve short exact-slug allowlist exceptions over wildcard denies', async () => {
      repository.findByUserClientAction.mockResolvedValue([
        {
          target: 'a.*',
          effect: 'DENY',
        },
        {
          target: 'a.b',
          effect: 'ALLOW',
        },
      ] as any);

      await expect(
        service.filterSlugsByAccess('user-1', 'claude', 'READ', ['a.b', 'a.c']),
      ).resolves.toEqual(['a.b']);
    });

    it('should allow all slugs when there are no grants', async () => {
      repository.findByUserClientAction.mockResolvedValue([]);

      await expect(
        service.filterSlugsByAccess('user-1', 'claude', 'READ', [
          'food.dietary_restrictions',
          'system.response_tone',
        ]),
      ).resolves.toEqual(['food.dietary_restrictions', 'system.response_tone']);
    });
  });
});
