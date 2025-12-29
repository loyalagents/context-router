import { InputType, Field } from '@nestjs/graphql';
import { IsDefined, IsNotEmpty, IsOptional, IsString } from 'class-validator';
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
  @IsDefined()
  value: any;
}
