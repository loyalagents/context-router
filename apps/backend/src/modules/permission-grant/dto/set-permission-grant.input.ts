import { Field, InputType } from '@nestjs/graphql';
import { IsEnum, IsNotEmpty, IsString, Matches } from 'class-validator';
import {
  GrantAction,
  GrantEffect,
} from '@infrastructure/prisma/generated-client';
import { PERMISSION_GRANT_TARGET_PATTERN } from '../permission-grant.service';

@InputType()
export class SetPermissionGrantInput {
  @Field()
  @IsString()
  @IsNotEmpty()
  clientKey: string;

  @Field()
  @IsString()
  @IsNotEmpty()
  @Matches(PERMISSION_GRANT_TARGET_PATTERN, {
    message:
      'target must be "*", a prefix wildcard like "food.*" / "food.french.*", or an exact slug',
  })
  target: string;

  @Field(() => GrantAction)
  @IsEnum(GrantAction)
  action: GrantAction;

  @Field(() => GrantEffect)
  @IsEnum(GrantEffect)
  effect: GrantEffect;
}
