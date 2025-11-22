import { InputType, Field } from '@nestjs/graphql';
import { IsOptional, IsString, IsObject } from 'class-validator';
import { GraphQLJSONObject } from 'graphql-type-json';

@InputType()
export class UpdatePreferenceInput {
  @Field({ nullable: true })
  @IsString()
  @IsOptional()
  locationId?: string;

  @Field({ nullable: true })
  @IsString()
  @IsOptional()
  category?: string;

  @Field({ nullable: true })
  @IsString()
  @IsOptional()
  key?: string;

  @Field(() => GraphQLJSONObject, { nullable: true })
  @IsObject()
  @IsOptional()
  value?: any;
}
