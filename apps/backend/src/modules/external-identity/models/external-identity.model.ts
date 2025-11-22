import { ObjectType, Field, ID } from '@nestjs/graphql';
import { GraphQLJSONObject } from 'graphql-type-json';

@ObjectType()
export class ExternalIdentity {
  @Field(() => ID)
  id: string;

  @Field()
  userId: string;

  @Field()
  provider: string;

  @Field()
  providerUserId: string;

  @Field(() => GraphQLJSONObject, { nullable: true })
  metadata?: any;

  @Field()
  createdAt: Date;

  @Field()
  updatedAt: Date;
}
