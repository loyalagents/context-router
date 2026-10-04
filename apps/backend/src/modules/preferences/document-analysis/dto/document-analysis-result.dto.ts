import type { AiErrorKind } from '../../../../domains/shared/ports/ai-execution';
import { ObjectType, Field, ID, Int, registerEnumType } from '@nestjs/graphql';
import { PreferenceSuggestion, FilteredSuggestion } from './preference-suggestion.dto';

export enum AnalysisStatus {
  SUCCESS = 'success',
  NO_MATCHES = 'no_matches',
  PARSE_ERROR = 'parse_error',
  AI_ERROR = 'ai_error',
}

registerEnumType(AnalysisStatus, {
  name: 'AnalysisStatus',
  description: 'The status of a document analysis operation',
});

@ObjectType()
export class DocumentAnalysisResult {
  @Field(() => ID)
  analysisId: string;

  @Field(() => [PreferenceSuggestion])
  suggestions: PreferenceSuggestion[];

  @Field(() => [FilteredSuggestion], { defaultValue: [] })
  filteredSuggestions: FilteredSuggestion[];

  @Field({ nullable: true })
  documentSummary?: string;

  @Field(() => AnalysisStatus)
  status: AnalysisStatus;

  @Field({ nullable: true })
  statusReason?: string;

  @Field(() => String, { nullable: true, description: 'Safe AI failure category; provider details are never returned.' })
  failureCategory?: AiErrorKind;

  @Field(() => Int, { defaultValue: 0 })
  filteredCount: number;
}
