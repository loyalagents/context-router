import {
  DiscoveredFile,
  DocumentAnalysisResult,
  PreferenceSuggestion,
  SuggestionDecision,
} from '../types';

export interface SuggestionFilterContext {
  file: DiscoveredFile;
  analysis: DocumentAnalysisResult;
  suggestion: PreferenceSuggestion;
}

export interface SuggestionFilter {
  readonly name: string;
  decide(context: SuggestionFilterContext): Promise<SuggestionDecision>;
}
