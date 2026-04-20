import { PreferenceDefinitionRepository } from '@modules/preferences/preference-definition/preference-definition.repository';
import { McpAuthorizationService } from '../auth/mcp-authorization.service';
import { PreferenceListTool } from './preference-list.tool';

describe('PreferenceListTool', () => {
  it('does not crash when a partial context has a user but no resolved client', async () => {
    const repository = {
      getAll: jest.fn().mockResolvedValue([
        {
          slug: 'food.dietary_restrictions',
          description: 'Dietary restrictions',
          valueType: 'ARRAY',
          options: null,
          scope: 'GLOBAL',
        },
      ]),
    };
    const authorizationService = {
      filterByTargetAccess: jest.fn(),
    };
    const tool = new PreferenceListTool(
      repository as unknown as PreferenceDefinitionRepository,
      authorizationService as unknown as McpAuthorizationService,
    );

    const result = await tool.execute(
      {},
      {
        user: { userId: 'user-1' },
      } as any,
    );
    const payload = JSON.parse((result.result.content[0] as { text: string }).text);

    expect(result.result.isError).not.toBe(true);
    expect(authorizationService.filterByTargetAccess).not.toHaveBeenCalled();
    expect(payload.success).toBe(true);
    expect(payload.preferences.map((pref: any) => pref.slug)).toEqual([
      'food.dietary_restrictions',
    ]);
  });
});
