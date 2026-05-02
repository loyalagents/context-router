import { Field, ObjectType } from '@nestjs/graphql';
import { Preference } from '@modules/preferences/preference/models/preference.model';

@ObjectType()
export class MatchedPreferenceDefinition {
  @Field()
  slug: string;

  @Field()
  description: string;

  @Field()
  category: string;
}

@ObjectType()
export class SmartPreferenceSearchResult {
  @Field(() => [MatchedPreferenceDefinition])
  matchedDefinitions: MatchedPreferenceDefinition[];

  @Field(() => [Preference])
  matchedActivePreferences: Preference[];

  @Field(() => [Preference])
  matchedSuggestedPreferences: Preference[];

  @Field()
  queryInterpretation: string;
}
