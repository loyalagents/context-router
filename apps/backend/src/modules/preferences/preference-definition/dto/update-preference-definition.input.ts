import { InputType, Field } from "@nestjs/graphql";
import { IsBoolean, IsEnum, IsOptional, IsString } from "class-validator";
import { GraphQLJSON } from "graphql-type-json";
import {
  PreferenceValueType,
  PreferenceScope,
} from "@infrastructure/prisma/generated-client";

@InputType()
export class UpdatePreferenceDefinitionInput {
  @Field({ nullable: true, description: "Optional human-readable display name" })
  @IsString()
  @IsOptional()
  displayName?: string;

  @Field({
    nullable: true,
    description: "Human-readable description of the preference",
  })
  @IsString()
  @IsOptional()
  description?: string;

  @Field(() => PreferenceValueType, {
    nullable: true,
    description: "Data type: STRING, BOOLEAN, ENUM, or ARRAY",
  })
  @IsEnum(PreferenceValueType)
  @IsOptional()
  valueType?: PreferenceValueType;

  @Field(() => PreferenceScope, {
    nullable: true,
    description: "Scope: GLOBAL or LOCATION",
  })
  @IsEnum(PreferenceScope)
  @IsOptional()
  scope?: PreferenceScope;

  @Field(() => GraphQLJSON, {
    nullable: true,
    description: "Valid options for ENUM type preferences",
  })
  @IsOptional()
  options?: unknown;

  @Field({
    nullable: true,
    description: "Whether this preference contains sensitive data",
  })
  @IsBoolean()
  @IsOptional()
  isSensitive?: boolean;

  @Field({
    nullable: true,
    description: "Whether this is a built-in core preference",
  })
  @IsBoolean()
  @IsOptional()
  isCore?: boolean;
}
