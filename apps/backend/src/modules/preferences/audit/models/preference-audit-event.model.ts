import { Field, ID, ObjectType, registerEnumType } from '@nestjs/graphql';
import { GraphQLJSON } from 'graphql-type-json';
import {
  AuditActorType,
  AuditEventType,
  AuditOrigin,
  AuditTargetType,
} from '@infrastructure/prisma/generated-client';

registerEnumType(AuditTargetType, {
  name: 'AuditTargetType',
  description: 'The kind of resource touched by an audit event',
});

registerEnumType(AuditEventType, {
  name: 'AuditEventType',
  description: 'The mutation recorded by an audit event',
});

registerEnumType(AuditActorType, {
  name: 'AuditActorType',
  description: 'The actor category recorded for an audit event',
});

registerEnumType(AuditOrigin, {
  name: 'AuditOrigin',
  description: 'The surface where the mutation originated',
});

@ObjectType('PreferenceAuditEvent')
export class PreferenceAuditEventModel {
  @Field(() => ID)
  id: string;

  @Field()
  userId: string;

  @Field()
  subjectSlug: string;

  @Field()
  occurredAt: Date;

  @Field(() => AuditTargetType)
  targetType: AuditTargetType;

  @Field()
  targetId: string;

  @Field(() => AuditEventType)
  eventType: AuditEventType;

  @Field(() => AuditActorType)
  actorType: AuditActorType;

  @Field({ nullable: true })
  actorClientKey?: string | null;

  @Field(() => AuditOrigin)
  origin: AuditOrigin;

  @Field()
  correlationId: string;

  @Field(() => GraphQLJSON, { nullable: true })
  beforeState?: unknown | null;

  @Field(() => GraphQLJSON, { nullable: true })
  afterState?: unknown | null;

  @Field(() => GraphQLJSON, { nullable: true })
  metadata?: unknown | null;
}
