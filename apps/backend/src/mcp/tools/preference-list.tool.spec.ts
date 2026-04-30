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
    const payload = result.result.structuredContent as {
      success: boolean;
      preferences: Array<{ slug: string }>;
    };

    expect(result.result.isError).not.toBe(true);
    expect(result.result.content[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('listPreferenceSlugs:'),
    });
    expect(authorizationService.filterByTargetAccess).not.toHaveBeenCalled();
    expect(payload.success).toBe(true);
    expect(payload.preferences.map((pref: any) => pref.slug)).toEqual([
      'food.dietary_restrictions',
    ]);
  });

  it('returns a structured MCP error when the catalog lookup throws', async () => {
    const repository = {
      getAll: jest.fn().mockRejectedValue(new Error('catalog exploded')),
    };
    const authorizationService = {
      filterByTargetAccess: jest.fn(),
    };
    const tool = new PreferenceListTool(
      repository as unknown as PreferenceDefinitionRepository,
      authorizationService as unknown as McpAuthorizationService,
    );

    const result = await tool.execute(
      { category: 'food' },
      {
        user: { userId: 'user-1' },
        client: { key: 'claude' },
        grants: [],
      } as any,
    );

    expect(result.result.isError).toBe(true);
    expect(result.result.content[0]).toMatchObject({
      type: 'text',
      text: 'listPreferenceSlugs: error — catalog exploded',
    });
    expect(result.result.structuredContent).toEqual({
      success: false,
      error: 'catalog exploded',
    });
    expect(result.accessLog).toMatchObject({
      requestMetadata: {
        category: 'food',
      },
      errorMetadata: {
        message: 'catalog exploded',
      },
    });
  });
});
