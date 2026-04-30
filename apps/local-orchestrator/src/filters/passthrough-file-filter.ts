import { FileFilter } from './file-filter';
import { DiscoveredFile, FileFilterDecision } from '../types';

export class PassthroughFileFilter implements FileFilter {
  readonly name = 'passthrough';

  async decide(_file: DiscoveredFile): Promise<FileFilterDecision> {
    return {
      action: 'analyze',
      reason: 'passthrough',
      score: 1,
      source: 'passthrough',
    };
  }
}
