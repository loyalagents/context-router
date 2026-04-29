import { CommandAIFilterAdapter } from '../ai/command-adapter';
import { buildTextPreview } from '../file-preview';
import { DiscoveredFile, FileFilterDecision } from '../types';
import { FileFilter } from './file-filter';

interface AIFileFilterOptions {
  goal: string;
  adapter: CommandAIFilterAdapter;
}

export class AIFileFilter implements FileFilter {
  readonly name = 'ai';

  constructor(private readonly options: AIFileFilterOptions) {}

  async decide(file: DiscoveredFile): Promise<FileFilterDecision> {
    const preview = await buildTextPreview(file);
    if (!preview) {
      return {
        action: 'analyze',
        reason: 'ai_bypass_non_text_preview',
        details:
          'File-stage AI filtering is bypassed for non-text-like files in V1.',
        source: 'bypass',
      };
    }

    const response = await this.options.adapter.decideFile({
      stage: 'file',
      goal: this.options.goal,
      file,
      preview,
    });

    return {
      action: response.decision.action,
      reason: response.decision.reason,
      score: response.decision.score,
      details: response.decision.details,
      source: 'ai',
      promptVersion: response.promptVersion ?? null,
    };
  }
}
