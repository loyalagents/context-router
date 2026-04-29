import { CommandAIFilterAdapter } from './ai/command-adapter';
import { CliOptions } from './types';
import { AIFileFilter } from './filters/ai-file-filter';
import { AISuggestionFilter } from './filters/ai-suggestion-filter';
import { FileFilter } from './filters/file-filter';
import { PassthroughFileFilter } from './filters/passthrough-file-filter';
import { PassthroughSuggestionFilter } from './filters/passthrough-suggestion-filter';
import { SuggestionFilter } from './filters/suggestion-filter';

export interface RuntimeFilters {
  adapter: CommandAIFilterAdapter | null;
  fileFilter: FileFilter;
  suggestionFilter: SuggestionFilter;
}

export function buildRuntimeFilters(options: CliOptions): RuntimeFilters {
  const adapter =
    options.aiFilter && options.aiAdapter === 'command' && options.aiCommand
      ? new CommandAIFilterAdapter({
          command: options.aiCommand,
          timeoutMs: options.aiTimeoutMs,
        })
      : null;

  const fileFilter =
    adapter &&
    (options.aiFilterStage === 'file' || options.aiFilterStage === 'both') &&
    options.aiGoal
      ? new AIFileFilter({
          goal: options.aiGoal,
          adapter,
        })
      : new PassthroughFileFilter();

  const suggestionFilter =
    adapter &&
    (options.aiFilterStage === 'suggestion' ||
      options.aiFilterStage === 'both') &&
    options.aiGoal
      ? new AISuggestionFilter({
          goal: options.aiGoal,
          adapter,
        })
      : new PassthroughSuggestionFilter();

  return {
    adapter,
    fileFilter,
    suggestionFilter,
  };
}
