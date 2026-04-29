import { BatchSuggestionFilterContext, SuggestionDecision } from '../types';

export interface SuggestionFilter {
  readonly name: string;
  decide(context: BatchSuggestionFilterContext): Promise<SuggestionDecision[]>;
}
