import { Field, Int, ObjectType } from '@nestjs/graphql';
import { ResetMemoryMode } from './reset-memory-mode.enum';

@ObjectType('ResetMyMemoryPayload')
export class ResetMyMemoryPayload {
  @Field(() => ResetMemoryMode)
  mode: ResetMemoryMode;

  @Field(() => Int)
  preferencesDeleted: number;

  @Field(() => Int)
  preferenceDefinitionsDeleted: number;

  @Field(() => Int)
  locationsDeleted: number;

  @Field(() => Int)
  preferenceAuditEventsDeleted: number;

  @Field(() => Int)
  mcpAccessEventsDeleted: number;

  @Field(() => Int)
  permissionGrantsDeleted: number;
}
