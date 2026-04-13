import { PreferenceSchemaSnapshotService } from './preference-schema-snapshot.service';
import { PreferenceDefinitionRepository } from './preference-definition.repository';
import { PermissionGrantService } from '@modules/permission-grant/permission-grant.service';

describe('PreferenceSchemaSnapshotService', () => {
  let repository: jest.Mocked<
    Pick<PreferenceDefinitionRepository, 'getAll' | 'getByScope'>
  >;
  let permissionGrantService: jest.Mocked<
    Pick<PermissionGrantService, 'filterSlugsByAccess'>
  >;
  let service: PreferenceSchemaSnapshotService;

  beforeEach(() => {
    repository = {
      getAll: jest.fn().mockResolvedValue([
        {
          slug: 'food.dietary_restrictions',
          description: 'Dietary restrictions',
          valueType: 'ARRAY',
          options: null,
          namespace: 'GLOBAL',
          scope: 'GLOBAL',
        },
        {
          slug: 'system.response_tone',
          description: 'Response tone',
          valueType: 'STRING',
          options: null,
          namespace: 'GLOBAL',
          scope: 'GLOBAL',
        },
      ]),
      getByScope: jest.fn(),
    };

    permissionGrantService = {
      filterSlugsByAccess: jest
        .fn()
        .mockResolvedValue(['food.dietary_restrictions', 'system.response_tone']),
    };

    service = new PreferenceSchemaSnapshotService(
      repository as unknown as PreferenceDefinitionRepository,
      permissionGrantService as unknown as PermissionGrantService,
    );
  });

  it('uses a custom slug filter when one is provided', async () => {
    const customFilter = jest.fn().mockResolvedValue(['system.response_tone']);

    const snapshot = await (service as any).getGrantFilteredSnapshot(
      'user-1',
      'claude',
      'read',
      undefined,
      customFilter,
    );

    expect(customFilter).toHaveBeenCalledWith([
      'food.dietary_restrictions',
      'system.response_tone',
    ]);
    expect(permissionGrantService.filterSlugsByAccess).not.toHaveBeenCalled();
    expect(snapshot.definitions.map((definition: any) => definition.slug)).toEqual([
      'system.response_tone',
    ]);
    expect(snapshot.promptJson).toContain('system.response_tone');
    expect(snapshot.promptJson).not.toContain('food.dietary_restrictions');
  });
});
