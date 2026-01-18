import { InputType, Field, Float } from '@nestjs/graphql';
import {
  IsDefined,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { GraphQLJSON } from 'graphql-type-json';

/**
 * Input for suggesting a preference (creates SUGGESTED status).
 * Used by MCP tools and internal inference systems.
 */
@InputType()
export class SuggestPreferenceInput {
  @Field({ description: 'The preference slug (e.g., "food.dietary_restrictions")' })
  @IsString()
  @IsNotEmpty()
  slug: string;

  @Field(() => GraphQLJSON, { description: 'The suggested preference value' })
  @IsDefined()
  value: any;

  @Field({ nullable: true, description: 'Optional location ID for location-scoped preferences' })
  @IsString()
  @IsOptional()
  locationId?: string;

  @Field(() => Float, { description: 'Confidence score for the suggestion (0.0 to 1.0)' })
  @IsNumber()
  @Min(0)
  @Max(1)
  confidence: number;

  @Field(() => GraphQLJSON, {
    nullable: true,
    description: 'Evidence/provenance for the suggestion (messageIds, snippets, etc.)',
  })
  @IsOptional()
  evidence?: any;
}
