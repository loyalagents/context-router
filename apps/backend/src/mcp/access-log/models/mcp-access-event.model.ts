import { Field, ID, ObjectType, registerEnumType } from '@nestjs/graphql';
import { GraphQLJSON } from 'graphql-type-json';
import {
  McpAccessOutcome,
  McpAccessSurface,
} from '@infrastructure/prisma/generated-client';

registerEnumType(McpAccessSurface, {
  name: 'McpAccessSurface',
  description: 'The MCP surface where an access event occurred',
});

registerEnumType(McpAccessOutcome, {
  name: 'McpAccessOutcome',
  description: 'The result of an MCP access event',
});

@ObjectType('McpAccessEvent')
export class McpAccessEventModel {
  @Field(() => ID)
  id: string;

  @Field()
  userId: string;

  @Field()
  clientKey: string;

  @Field()
  occurredAt: Date;

  @Field(() => McpAccessSurface)
  surface: McpAccessSurface;

  @Field()
  operationName: string;

  @Field(() => McpAccessOutcome)
  outcome: McpAccessOutcome;

  @Field()
  correlationId: string;

  @Field()
  latencyMs: number;

  @Field(() => GraphQLJSON, { nullable: true })
  requestMetadata?: unknown | null;

  @Field(() => GraphQLJSON, { nullable: true })
  responseMetadata?: unknown | null;

  @Field(() => GraphQLJSON, { nullable: true })
  errorMetadata?: unknown | null;
}
