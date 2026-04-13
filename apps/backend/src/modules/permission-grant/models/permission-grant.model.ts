import { Field, ID, ObjectType, registerEnumType } from '@nestjs/graphql';
import {
  GrantAction,
  GrantEffect,
} from '@infrastructure/prisma/generated-client';

registerEnumType(GrantAction, {
  name: 'GrantAction',
  description: 'The action covered by a permission grant',
});

registerEnumType(GrantEffect, {
  name: 'GrantEffect',
  description: 'Whether the grant allows or denies the action',
});

@ObjectType('PermissionGrant')
export class PermissionGrantModel {
  @Field(() => ID)
  id: string;

  @Field()
  clientKey: string;

  @Field()
  target: string;

  @Field(() => GrantAction)
  action: GrantAction;

  @Field(() => GrantEffect)
  effect: GrantEffect;

  @Field()
  createdAt: Date;

  @Field()
  updatedAt: Date;
}
