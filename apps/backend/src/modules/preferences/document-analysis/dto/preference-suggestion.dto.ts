import { ObjectType, Field, ID, Float, registerEnumType } from '@nestjs/graphql';
import { GraphQLJSON } from 'graphql-type-json';

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

export enum FilterReason {
  MISSING_FIELDS = 'MISSING_FIELDS',
  DUPLICATE_KEY = 'DUPLICATE_KEY',
  NO_CHANGE = 'NO_CHANGE',
}

registerEnumType(FilterReason, {
  name: 'FilterReason',
  description: 'The reason a suggestion was filtered out',
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

  @Field(() => GraphQLJSON, { nullable: true })
  oldValue?: any;

  @Field(() => GraphQLJSON)
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

@ObjectType()
export class FilteredSuggestion extends PreferenceSuggestion {
  @Field(() => FilterReason)
  filterReason: FilterReason;

  @Field({ nullable: true })
  filterDetails?: string;
}
