import { Field, ObjectType } from '@nestjs/graphql';
import { PreferenceAuditEventModel } from './preference-audit-event.model';

@ObjectType('PreferenceAuditHistoryPage')
export class PreferenceAuditHistoryPageModel {
  @Field(() => [PreferenceAuditEventModel])
  items: PreferenceAuditEventModel[];

  @Field({ nullable: true })
  nextCursor: string | null;

  @Field()
  hasNextPage: boolean;
}
