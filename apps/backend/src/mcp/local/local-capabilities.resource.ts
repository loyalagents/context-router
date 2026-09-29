import { Inject, Injectable } from '@nestjs/common';
import { AI_TEXT_GENERATOR_PORT } from '../../domains/shared/ports/ai.tokens';
import type { AiTextGeneratorPort } from '../../domains/shared/ports/ai-text-generator.port';
import type { McpResourceInterface } from '../resources/base/mcp-resource.interface';
import type { McpContext } from '../types/mcp-context.type';
@Injectable()
export class LocalCapabilitiesResource implements McpResourceInterface {
  readonly descriptor = {
    uri: 'context-router://capabilities',
    name: 'Local model capabilities',
    description:
      'Configured model capabilities and bounded current readiness. Check only after the manual model readiness prerequisites; unavailable inference does not disable ordinary tools.',
    mimeType: 'application/json',
  };
  readonly requiredAccess = {
    resource: 'preferences',
    action: 'read',
  } as const;
  constructor(
    @Inject(AI_TEXT_GENERATOR_PORT) private readonly ai: AiTextGeneratorPort,
  ) {}
  async read(context: McpContext) {
    const status = await this.ai.getStatus(
      this.ai.capabilities.strictExecutionControls
        ? {
            ...context.execution,
            deadline: Math.min(
              context.execution?.deadline ?? Infinity,
              performance.now() + 5000,
            ),
          }
        : undefined,
    );
    return {
      result: {
        contents: [
          {
            uri: this.descriptor.uri,
            mimeType: 'application/json',
            text: JSON.stringify({
              capabilities: this.ai.capabilities,
              status,
            }),
          },
        ],
      },
    };
  }
}
