import { ObjectType, Field, ID } from '@nestjs/graphql';
import { GraphQLJSON } from 'graphql-type-json';

@ObjectType()
export class Preference {
  @Field(() => ID)
  preferenceId: string;

  @Field()
  userId: string;

  @Field({ nullable: true })
  locationId?: string;

  @Field()
  category: string;

  @Field()
  key: string;

  @Field(() => GraphQLJSON)
  value: any;

  @Field()
  createdAt: Date;

  @Field()
  updatedAt: Date;
}
