import { SuggestionFilter, SuggestionFilterContext } from './suggestion-filter';
import { SuggestionDecision } from '../types';

export class PassthroughSuggestionFilter implements SuggestionFilter {
  readonly name = 'passthrough';

  async decide(
    context: SuggestionFilterContext,
  ): Promise<SuggestionDecision> {
    return {
      suggestionId: context.suggestion.id,
      action: 'apply',
      reason: 'passthrough',
      score: context.suggestion.confidence,
    };
  }
}
