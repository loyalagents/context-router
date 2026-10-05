import { Field, ID, Int, ObjectType } from '@nestjs/graphql';
import { Preference } from '../../preference/models/preference.model';

@ObjectType()
export class ApplyPreferenceSuggestionV2ItemResult {
  @Field(() => ID) suggestionId: string;
  @Field({
    description:
      'APPLIED, VALIDATION_FAILED, CONFLICT, or UNCERTAIN. Uncertain writes must not be automatically retried.',
  })
  status: string;
  @Field(() => Preference, { nullable: true }) preference?: Preference;
}
@ObjectType()
export class ApplyPreferenceSuggestionsV2Result {
  @Field(() => Int) schemaVersion: number;
  @Field(() => [ApplyPreferenceSuggestionV2ItemResult])
  results: ApplyPreferenceSuggestionV2ItemResult[];
}
