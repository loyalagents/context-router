import { InputType, Field } from '@nestjs/graphql';
import { IsOptional, IsString } from 'class-validator';
import { GraphQLJSON } from 'graphql-type-json';

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

  @Field(() => GraphQLJSON, { nullable: true })
  @IsOptional()
  value?: any;
}
