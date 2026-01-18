import {
  ObjectType,
  Field,
  ID,
  Float,
  registerEnumType,
} from '@nestjs/graphql';
import { GraphQLJSON } from 'graphql-type-json';

export enum PreferenceOperation {
  CREATE = 'CREATE',
  UPDATE = 'UPDATE',
}

registerEnumType(PreferenceOperation, {
  name: 'PreferenceOperation',
  description: 'The type of operation to perform on a preference',
});

export enum FilterReason {
  MISSING_FIELDS = 'MISSING_FIELDS',
  DUPLICATE_KEY = 'DUPLICATE_KEY',
  NO_CHANGE = 'NO_CHANGE',
  UNKNOWN_SLUG = 'UNKNOWN_SLUG',
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

  @Field({
    description: 'The preference slug (e.g., "food.dietary_restrictions")',
  })
  slug: string;

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

  // Convenience fields from catalog
  @Field({
    nullable: true,
    description: 'Category from the preference catalog',
  })
  category?: string;

  @Field({
    nullable: true,
    description: 'Description from the preference catalog',
  })
  description?: string;
}

@ObjectType()
export class FilteredSuggestion extends PreferenceSuggestion {
  @Field(() => FilterReason)
  filterReason: FilterReason;

  @Field({ nullable: true })
  filterDetails?: string;
}
