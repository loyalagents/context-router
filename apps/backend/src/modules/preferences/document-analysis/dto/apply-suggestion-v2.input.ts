import { Field, ID, InputType } from '@nestjs/graphql';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApplyPreferenceSuggestionInput } from './apply-suggestion.input';

@InputType()
export class ApplyPreferenceSuggestionV2Input extends ApplyPreferenceSuggestionInput {
  @Field(() => ID) @IsString() @IsNotEmpty() definitionId: string;
  @Field(() => ID, { nullable: true }) @IsString() @IsOptional() locationId?:
    | string
    | null;
  @Field(() => ID, { nullable: true })
  @IsString()
  @IsOptional()
  expectedPreferenceId?: string | null;
  @Field({ nullable: true }) @IsString() @IsOptional() expectedRevision?:
    | string
    | null;
}
