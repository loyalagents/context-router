import { Field, InputType, Int } from '@nestjs/graphql';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import {
  McpAccessOutcome,
  McpAccessSurface,
} from '@infrastructure/prisma/generated-client';

@InputType()
export class McpAccessHistoryInput {
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

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  clientKey?: string;

  @Field(() => McpAccessSurface, { nullable: true })
  @IsOptional()
  surface?: McpAccessSurface;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  operationName?: string;

  @Field(() => McpAccessOutcome, { nullable: true })
  @IsOptional()
  outcome?: McpAccessOutcome;

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
