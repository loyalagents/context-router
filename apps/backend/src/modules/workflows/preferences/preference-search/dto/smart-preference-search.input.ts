import { Field, ID, InputType } from '@nestjs/graphql';
import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

@InputType()
export class SmartPreferenceSearchInput {
  @Field({
    description:
      'Natural-language task or question to map to relevant preference slugs',
  })
  @IsString()
  @IsNotEmpty()
  query: string;

  @Field(() => ID, {
    nullable: true,
    description: 'Optional location ID for merged location-scoped preferences',
  })
  @IsString()
  @IsOptional()
  locationId?: string;

  @Field({
    nullable: true,
    description: 'If true, include SUGGESTED preferences in the result',
  })
  @IsBoolean()
  @IsOptional()
  includeSuggestions?: boolean;
}
