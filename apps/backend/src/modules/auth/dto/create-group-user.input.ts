import { InputType, Field } from '@nestjs/graphql';
import { IsEmail, IsNotEmpty, IsString, MinLength } from 'class-validator';

@InputType()
export class CreateGroupUserInput {
  @Field()
  @IsString()
  @IsNotEmpty()
  apiKey: string;

  @Field()
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @Field()
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  firstName: string;

  @Field()
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  lastName: string;
}
