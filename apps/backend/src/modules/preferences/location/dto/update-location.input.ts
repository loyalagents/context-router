import { InputType, Field } from '@nestjs/graphql';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { LocationType } from '../models/location.model';

@InputType()
export class UpdateLocationInput {
  @Field(() => LocationType, { nullable: true })
  @IsEnum(LocationType)
  @IsOptional()
  type?: LocationType;

  @Field({ nullable: true })
  @IsString()
  @IsOptional()
  label?: string;

  @Field({ nullable: true })
  @IsString()
  @IsOptional()
  address?: string;
}
