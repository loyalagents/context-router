import { InputType, Field, ID } from '@nestjs/graphql';
import { IsNotEmpty, IsString, IsEnum, IsOptional } from 'class-validator';
import { GraphQLJSON } from 'graphql-type-json';
import { PreferenceOperation } from './preference-suggestion.dto';

@InputType()
export class ApplyPreferenceSuggestionInput {
  @Field(() => ID)
  @IsString()
  @IsNotEmpty()
  suggestionId: string;

  @Field({
    description: 'The preference slug (e.g., "food.dietary_restrictions")',
  })
  @IsString()
  @IsNotEmpty()
  slug: string;

  @Field(() => PreferenceOperation)
  @IsEnum(PreferenceOperation)
  operation: PreferenceOperation;

  @Field(() => GraphQLJSON, { nullable: true })
  @IsOptional()
  newValue?: any;
}
