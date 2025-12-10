import { InputType, Field } from '@nestjs/graphql';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { GraphQLJSON } from 'graphql-type-json';

@InputType()
export class CreatePreferenceInput {
  @Field({ nullable: true })
  @IsString()
  @IsOptional()
  locationId?: string;

  @Field()
  @IsString()
  @IsNotEmpty()
  category: string;

  @Field()
  @IsString()
  @IsNotEmpty()
  key: string;

  @Field(() => GraphQLJSON)
  value: any;
}
