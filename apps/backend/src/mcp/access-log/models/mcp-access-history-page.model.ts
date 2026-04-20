import { Field, ObjectType } from '@nestjs/graphql';
import { McpAccessEventModel } from './mcp-access-event.model';

@ObjectType('McpAccessHistoryPage')
export class McpAccessHistoryPageModel {
  @Field(() => [McpAccessEventModel])
  items: McpAccessEventModel[];

  @Field({ nullable: true })
  nextCursor: string | null;

  @Field()
  hasNextPage: boolean;
}
