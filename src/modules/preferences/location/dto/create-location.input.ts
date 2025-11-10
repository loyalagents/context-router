import { InputType, Field } from '@nestjs/graphql';
import { IsEnum, IsNotEmpty, IsString } from 'class-validator';
import { LocationType } from '../models/location.model';

@InputType()
export class CreateLocationInput {
  @Field(() => LocationType)
  @IsEnum(LocationType)
  type: LocationType;

  @Field()
  @IsString()
  @IsNotEmpty()
  label: string;

  @Field()
  @IsString()
  @IsNotEmpty()
  address: string;
}
