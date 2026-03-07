import { ObjectType, Field, registerEnumType } from "@nestjs/graphql";
import { GraphQLJSON } from "graphql-type-json";
import {
  PreferenceValueType,
  PreferenceScope,
} from "@infrastructure/prisma/generated-client";

registerEnumType(PreferenceValueType, {
  name: "PreferenceValueType",
  description: "The data type of a preference value",
});

registerEnumType(PreferenceScope, {
  name: "PreferenceScope",
  description: "Whether a preference is global or location-scoped",
});

@ObjectType("PreferenceDefinition")
export class PreferenceDefinitionModel {
  @Field({
    description: 'Unique slug identifier (e.g., "food.dietary_restrictions")',
  })
  slug: string;

  @Field({ description: "Human-readable description of the preference" })
  description: string;

  @Field(() => PreferenceValueType, {
    description: "Data type: STRING, BOOLEAN, ENUM, or ARRAY",
  })
  valueType: PreferenceValueType;

  @Field(() => PreferenceScope, { description: "Scope: GLOBAL or LOCATION" })
  scope: PreferenceScope;

  @Field(() => GraphQLJSON, {
    nullable: true,
    description: "Valid options for ENUM type preferences",
  })
  options?: unknown;

  @Field({ description: "Whether this preference contains sensitive data" })
  isSensitive: boolean;

  @Field({ description: "Whether this is a built-in core preference" })
  isCore: boolean;

  @Field({ description: "Category derived from slug prefix" })
  category: string;
}
