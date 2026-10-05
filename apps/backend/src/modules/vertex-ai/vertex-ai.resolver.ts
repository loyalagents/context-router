import { createAiWorkflow } from '../../domains/shared/ports/ai-execution';
import { Args, Context, Query, Resolver } from '@nestjs/graphql';
import { Inject, Logger, UseGuards } from '@nestjs/common';
import { AiTextGeneratorPort } from '../../domains/shared/ports/ai-text-generator.port';
import { AI_TEXT_GENERATOR_PORT } from '../../domains/shared/ports/ai.tokens';
import {
  browserExecution,
  LocalUiRequest,
} from '../../local-ui/local-ui-request';
import { GqlAuthGuard } from '../../common/guards/gql-auth.guard';

@Resolver()
@UseGuards(GqlAuthGuard)
export class VertexAiResolver {
  private readonly logger = new Logger(VertexAiResolver.name);

  constructor(
    @Inject(AI_TEXT_GENERATOR_PORT)
    private readonly textGenerator: AiTextGeneratorPort,
  ) {}

  @Query(() => String, {
    name: 'askVertexAI',
    description:
      'Send a text prompt to Vertex AI and receive a generated response',
  })
  async askVertexAI(
    @Args('message', { type: () => String }) message: string,
    @Context() context?: { req?: LocalUiRequest },
  ): Promise<string> {
    try {
      this.logger.log('Processing authenticated text-generation request');
      const execution = createAiWorkflow(
        this.textGenerator.capabilities,
        browserExecution(context?.req),
      );
      const response = this.textGenerator.capabilities.strictExecutionControls
        ? await this.textGenerator.generateText(message, execution.options)
        : await this.textGenerator.generateText(message);
      execution.check();
      return response;
    } catch {
      this.logger.error('Text generation request failed');
      throw new Error(
        'Failed to generate response from Vertex AI. Please try again later.',
      );
    }
  }
}
