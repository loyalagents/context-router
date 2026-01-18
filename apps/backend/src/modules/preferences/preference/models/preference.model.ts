import { ObjectType, Field, ID, Float, registerEnumType } from '@nestjs/graphql';
import { GraphQLJSON } from 'graphql-type-json';

// Register enums for GraphQL
export enum PreferenceStatus {
  ACTIVE = 'ACTIVE',
  SUGGESTED = 'SUGGESTED',
  REJECTED = 'REJECTED',
}

export enum SourceType {
  USER = 'USER',
  INFERRED = 'INFERRED',
  IMPORTED = 'IMPORTED',
  SYSTEM = 'SYSTEM',
}

registerEnumType(PreferenceStatus, {
  name: 'PreferenceStatus',
  description: 'The status of a preference',
});

registerEnumType(SourceType, {
  name: 'SourceType',
  description: 'The source/origin of a preference',
});

@ObjectType()
export class Preference {
  @Field(() => ID)
  id: string;

  @Field()
  userId: string;

  @Field({ nullable: true })
  locationId?: string;

  @Field({ description: 'The preference slug (e.g., "food.dietary_restrictions")' })
  slug: string;

  @Field(() => GraphQLJSON, { description: 'The preference value' })
  value: any;

  @Field(() => PreferenceStatus, { description: 'Status: ACTIVE, SUGGESTED, or REJECTED' })
  status: PreferenceStatus;

  @Field(() => SourceType, { description: 'Source: USER, INFERRED, IMPORTED, or SYSTEM' })
  sourceType: SourceType;

  @Field(() => Float, { nullable: true, description: 'Confidence score for inferred preferences (0.0 to 1.0)' })
  confidence?: number;

  @Field(() => GraphQLJSON, { nullable: true, description: 'Evidence/provenance metadata' })
  evidence?: any;

  @Field()
  createdAt: Date;

  @Field()
  updatedAt: Date;

  // Convenience fields resolved from catalog (not stored in DB)
  @Field({ nullable: true, description: 'Category from the preference catalog' })
  category?: string;

  @Field({ nullable: true, description: 'Description from the preference catalog' })
  description?: string;
}
