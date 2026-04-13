import { ConfigService } from '@nestjs/config';
import { SmartSearchTool } from './smart-search.tool';
import { PreferenceSearchWorkflow } from '@modules/workflows/preferences/preference-search/preference-search.workflow';
import { McpAuthorizationService } from '../auth/mcp-authorization.service';

describe('SmartSearchTool', () => {
  let workflow: jest.Mocked<Pick<PreferenceSearchWorkflow, 'run'>>;
  let configService: jest.Mocked<Pick<ConfigService, 'get'>>;
  let authorizationService: jest.Mocked<
    Pick<McpAuthorizationService, 'filterByTargetAccess'>
  >;
  let tool: SmartSearchTool;

  const context = {
    user: { userId: 'user-1' },
    client: {
      key: 'claude',
      policy: {
        key: 'claude',
        label: 'Claude',
        capabilities: ['preferences:read', 'preferences:write'],
        targetRules: [],
      },
    },
    grants: ['preferences:read'],
  } as any;

  beforeEach(() => {
    workflow = {
      run: jest.fn().mockResolvedValue({
        matchedDefinitions: [
          {
            slug: 'food.dietary_restrictions',
            description: 'Dietary restrictions',
            category: 'food',
          },
          {
            slug: 'system.response_tone',
            description: 'Response tone',
            category: 'system',
          },
        ],
        matchedActivePreferences: [
          {
            id: 'pref-1',
            slug: 'food.dietary_restrictions',
          },
        ],
        matchedSuggestedPreferences: [
          {
            id: 'pref-2',
            slug: 'system.response_tone',
          },
        ],
        queryInterpretation: 'tone preferences',
      }),
    };

    configService = {
      get: jest.fn().mockReturnValue(25),
    };

    authorizationService = {
      filterByTargetAccess: jest.fn().mockResolvedValue(['system.response_tone']),
    };

    tool = new SmartSearchTool(
      workflow as unknown as PreferenceSearchWorkflow,
      configService as unknown as ConfigService,
      authorizationService as unknown as McpAuthorizationService,
    );
  });

  it('passes an access filter into the workflow and post-filters matched definitions', async () => {
    const result = await tool.execute({ query: 'tone' }, context);
    const payload = JSON.parse((result.content[0] as { text: string }).text);

    expect(workflow.run).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        clientKey: 'claude',
        naturalLanguageQuery: 'tone',
        filterAccessibleSlugs: expect.any(Function),
      }),
    );
    expect(authorizationService.filterByTargetAccess).toHaveBeenCalledWith(
      context.client,
      { resource: 'preferences', action: 'read' },
      context.grants,
      'user-1',
      [
        'food.dietary_restrictions',
        'system.response_tone',
        'food.dietary_restrictions',
        'system.response_tone',
      ],
    );
    expect(payload.matchedDefinitions.map((definition: any) => definition.slug)).toEqual([
      'system.response_tone',
    ]);
    expect(payload.matchedActivePreferences).toEqual([]);
    expect(payload.matchedSuggestedPreferences.map((pref: any) => pref.slug)).toEqual([
      'system.response_tone',
    ]);
  });
});
