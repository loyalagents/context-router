import { InputType, Field, ID } from '@nestjs/graphql';
import { IsNotEmpty, IsString, IsEnum, IsOptional } from 'class-validator';
import { GraphQLJSONObject } from 'graphql-type-json';
import { PreferenceOperation } from './preference-suggestion.dto';

@InputType()
export class ApplyPreferenceSuggestionInput {
  @Field(() => ID)
  @IsString()
  @IsNotEmpty()
  suggestionId: string;

  @Field()
  @IsString()
  @IsNotEmpty()
  key: string;

  @Field()
  @IsString()
  @IsNotEmpty()
  category: string;

  @Field(() => PreferenceOperation)
  @IsEnum(PreferenceOperation)
  operation: PreferenceOperation;

  @Field(() => GraphQLJSONObject, { nullable: true })
  @IsOptional()
  newValue?: any;
}
