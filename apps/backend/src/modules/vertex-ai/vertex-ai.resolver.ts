import {
  Args,
  Query,
  Resolver,
} from '@nestjs/graphql';
import { UseGuards, Logger } from '@nestjs/common';
import { VertexAiService } from '../../infrastructure/vertex-ai/vertex-ai.service';
import { GqlAuthGuard } from '../../common/guards/gql-auth.guard';

@Resolver()
@UseGuards(GqlAuthGuard)
export class VertexAiResolver {
  private readonly logger = new Logger(VertexAiResolver.name);

  constructor(private readonly vertexAiService: VertexAiService) {}

  @Query(() => String, {
    name: 'askVertexAI',
    description: 'Send a text prompt to Vertex AI and receive a generated response',
  })
  async askVertexAI(
    @Args('message', { type: () => String }) message: string,
  ): Promise<string> {
    try {
      this.logger.log(`Received query with message: ${message.substring(0, 50)}...`);
      const response = await this.vertexAiService.generateText(message);
      return response;
    } catch (error) {
      this.logger.error('Failed to generate text from Vertex AI', error);
      throw new Error(
        'Failed to generate response from Vertex AI. Please try again later.',
      );
    }
  }
}
