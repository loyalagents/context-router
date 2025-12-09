import { ObjectType, Field, ID, Float, registerEnumType } from '@nestjs/graphql';
import { GraphQLJSONObject } from 'graphql-type-json';

export enum PreferenceOperation {
  CREATE = 'CREATE',
  UPDATE = 'UPDATE',
  // TODO: Add DELETE operation in v2
  // DELETE = 'DELETE',
}

registerEnumType(PreferenceOperation, {
  name: 'PreferenceOperation',
  description: 'The type of operation to perform on a preference',
});

@ObjectType()
export class SourceMeta {
  @Field(() => Number, { nullable: true })
  page?: number;

  @Field(() => Number, { nullable: true })
  line?: number;

  @Field({ nullable: true })
  filename?: string;
}

@ObjectType()
export class PreferenceSuggestion {
  @Field(() => ID)
  id: string;

  @Field()
  category: string;

  @Field()
  key: string;

  @Field(() => PreferenceOperation)
  operation: PreferenceOperation;

  @Field(() => GraphQLJSONObject, { nullable: true })
  oldValue?: any;

  @Field(() => GraphQLJSONObject)
  newValue: any;

  @Field(() => Float)
  confidence: number;

  @Field()
  sourceSnippet: string;

  @Field(() => SourceMeta, { nullable: true })
  sourceMeta?: SourceMeta;

  @Field({ defaultValue: false })
  wasCorrected: boolean;
}
