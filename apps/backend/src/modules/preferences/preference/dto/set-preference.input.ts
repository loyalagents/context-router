import { InputType, Field } from '@nestjs/graphql';
import { IsDefined, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { GraphQLJSON } from 'graphql-type-json';

/**
 * Input for setting (creating/updating) an ACTIVE preference.
 * Used by authenticated users via GraphQL mutations.
 */
@InputType()
export class SetPreferenceInput {
  @Field({ description: 'The preference slug (e.g., "food.dietary_restrictions")' })
  @IsString()
  @IsNotEmpty()
  slug: string;

  @Field(() => GraphQLJSON, { description: 'The preference value (type depends on slug definition)' })
  @IsDefined()
  value: any;

  @Field({ nullable: true, description: 'Optional location ID for location-scoped preferences' })
  @IsString()
  @IsOptional()
  locationId?: string;
}
