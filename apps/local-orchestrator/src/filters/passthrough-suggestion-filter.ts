import { SuggestionFilter } from './suggestion-filter';
import { SuggestionDecision } from '../types';

export class PassthroughSuggestionFilter implements SuggestionFilter {
  readonly name = 'passthrough';

  async decide(context: {
    suggestions: Array<{ id: string; confidence: number }>;
  }): Promise<SuggestionDecision[]> {
    return context.suggestions.map((suggestion) => ({
      suggestionId: suggestion.id,
      action: 'apply',
      reason: 'passthrough',
      score: suggestion.confidence,
      source: 'passthrough',
    }));
  }
}
