import { SchemaConsolidationTool } from './schema-consolidation.tool';
import { SchemaConsolidationWorkflow } from '@modules/workflows/preferences/schema-consolidation/schema-consolidation.workflow';
import { McpAuthorizationService } from '../auth/mcp-authorization.service';

describe('SchemaConsolidationTool', () => {
  it('passes an access filter into the workflow', async () => {
    const workflow = {
      run: jest.fn().mockResolvedValue({
        totalDefinitionsAnalyzed: 2,
        consolidationGroups: [],
        summary: 'Nothing to consolidate.',
      }),
    };
    const authorizationService = {
      filterByTargetAccess: jest.fn().mockResolvedValue([]),
    };
    const tool = new (SchemaConsolidationTool as any)(
      workflow as unknown as SchemaConsolidationWorkflow,
      authorizationService as unknown as McpAuthorizationService,
    );

    const result = await tool.execute(
      { scope: 'PERSONAL' },
      {
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
      } as any,
    );

    expect(workflow.run).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        clientKey: 'claude',
        scope: 'PERSONAL',
        filterAccessibleSlugs: expect.any(Function),
      }),
    );
    expect(result.result.structuredContent).toMatchObject({
      success: true,
      totalDefinitionsAnalyzed: 2,
      consolidationGroups: [],
    });
    expect(result.result.content[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('consolidateSchema:'),
    });
  });
});
