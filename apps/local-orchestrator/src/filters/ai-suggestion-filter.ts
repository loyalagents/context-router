import { CommandAIFilterAdapter } from '../ai/command-adapter';
import {
  BatchSuggestionFilterContext,
  SuggestionDecision,
} from '../types';
import { SuggestionFilter } from './suggestion-filter';

interface AISuggestionFilterOptions {
  goal: string;
  adapter: CommandAIFilterAdapter;
}

export class AISuggestionFilter implements SuggestionFilter {
  readonly name = 'ai';

  constructor(private readonly options: AISuggestionFilterOptions) {}

  async decide(
    context: BatchSuggestionFilterContext,
  ): Promise<SuggestionDecision[]> {
    const response = await this.options.adapter.decideSuggestions({
      stage: 'suggestion',
      goal: this.options.goal,
      file: context.file,
      analysis: {
        analysisId: context.analysis.analysisId,
        documentSummary: context.analysis.documentSummary ?? null,
        status: 'success',
        filteredCount: context.analysis.filteredCount,
      },
      suggestions: context.suggestions,
      filteredSuggestions: context.analysis.filteredSuggestions,
    });

    return response.decisions.map((decision) => ({
      suggestionId: decision.suggestionId,
      action: decision.action,
      reason: decision.reason,
      score: decision.score,
      details: decision.details,
      source: 'ai',
      promptVersion: response.promptVersion ?? null,
    }));
  }
}
