import { InputType, Field } from "@nestjs/graphql";
import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
} from "class-validator";
import { GraphQLJSON } from "graphql-type-json";
import {
  PreferenceValueType,
  PreferenceScope,
} from "@infrastructure/prisma/generated-client";

@InputType()
export class CreatePreferenceDefinitionInput {
  @Field({
    description: 'Unique slug identifier (e.g., "food.dietary_restrictions")',
  })
  @IsString()
  @IsNotEmpty()
  slug: string;

  @Field({ description: "Human-readable description of the preference" })
  @IsString()
  @IsNotEmpty()
  description: string;

  @Field(() => PreferenceValueType, {
    description: "Data type: STRING, BOOLEAN, ENUM, or ARRAY",
  })
  @IsEnum(PreferenceValueType)
  valueType: PreferenceValueType;

  @Field(() => PreferenceScope, { description: "Scope: GLOBAL or LOCATION" })
  @IsEnum(PreferenceScope)
  scope: PreferenceScope;

  @Field(() => GraphQLJSON, {
    nullable: true,
    description: "Valid options for ENUM type preferences",
  })
  @IsOptional()
  options?: unknown;

  @Field({
    nullable: true,
    defaultValue: false,
    description: "Whether this preference contains sensitive data",
  })
  @IsBoolean()
  @IsOptional()
  isSensitive?: boolean;

  @Field({
    nullable: true,
    defaultValue: false,
    description: "Whether this is a built-in core preference",
  })
  @IsBoolean()
  @IsOptional()
  isCore?: boolean;
}
