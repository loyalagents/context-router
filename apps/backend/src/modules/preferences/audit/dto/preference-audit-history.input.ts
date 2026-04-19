import { Field, InputType, Int } from '@nestjs/graphql';
import {
  AuditEventType,
  AuditOrigin,
  AuditTargetType,
} from '@infrastructure/prisma/generated-client';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

@InputType()
export class PreferenceAuditHistoryInput {
  @Field(() => Int, {
    nullable: true,
    defaultValue: 20,
    description: 'Page size. Defaults to 20 and is capped at 100.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  first?: number;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  after?: string;

  @Field({
    nullable: true,
    description:
      'Matches audit events whose subject slug starts with the provided prefix.',
  })
  @IsOptional()
  @IsString()
  subjectSlug?: string;

  @Field(() => AuditEventType, { nullable: true })
  @IsOptional()
  eventType?: AuditEventType;

  @Field(() => AuditTargetType, { nullable: true })
  @IsOptional()
  targetType?: AuditTargetType;

  @Field(() => AuditOrigin, { nullable: true })
  @IsOptional()
  origin?: AuditOrigin;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  actorClientKey?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  correlationId?: string;

  @Field(() => Date, { nullable: true })
  @IsOptional()
  occurredFrom?: Date;

  @Field(() => Date, { nullable: true })
  @IsOptional()
  occurredTo?: Date;
}
