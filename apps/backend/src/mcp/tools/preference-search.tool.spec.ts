import { ConfigService } from '@nestjs/config';
import { PreferenceService } from '@modules/preferences/preference/preference.service';
import { PreferenceDefinitionRepository } from '@modules/preferences/preference-definition/preference-definition.repository';
import { McpAuthorizationService } from '../auth/mcp-authorization.service';
import { PreferenceSearchTool } from './preference-search.tool';

describe('PreferenceSearchTool', () => {
  it('returns a structured MCP error when active preference lookup throws', async () => {
    const preferenceService = {
      getActivePreferences: jest
        .fn()
        .mockRejectedValue(new Error('active lookup exploded')),
      getSuggestedPreferences: jest.fn(),
    };
    const configService = {
      get: jest.fn().mockReturnValue(100),
    };
    const definitionRepository = {
      getAll: jest.fn(),
    };
    const authorizationService = {
      filterByTargetAccess: jest.fn(),
    };
    const tool = new PreferenceSearchTool(
      preferenceService as unknown as PreferenceService,
      configService as unknown as ConfigService,
      definitionRepository as unknown as PreferenceDefinitionRepository,
      authorizationService as unknown as McpAuthorizationService,
    );

    const result = await tool.execute(
      {
        includeSuggestions: false,
      },
      {
        user: { userId: 'user-1' },
        client: { key: 'claude' },
        grants: [],
      } as any,
    );

    expect(result.result.isError).toBe(true);
    expect(result.result.structuredContent).toEqual({
      success: false,
      error: 'active lookup exploded',
    });
    const textContent = result.result.content[0] as {
      type: 'text';
      text: string;
    };
    expect(textContent.type).toBe('text');
    expect(JSON.parse(textContent.text)).toEqual(
      result.result.structuredContent,
    );
    expect(result.accessLog).toMatchObject({
      requestMetadata: {
        locationId: null,
        includeSuggestions: false,
        queryPresent: false,
        queryLength: 0,
      },
      errorMetadata: {
        message: 'active lookup exploded',
      },
    });
    expect(preferenceService.getSuggestedPreferences).not.toHaveBeenCalled();
    expect(authorizationService.filterByTargetAccess).not.toHaveBeenCalled();
  });
});
