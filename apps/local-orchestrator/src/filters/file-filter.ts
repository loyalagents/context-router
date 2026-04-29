import { DiscoveredFile, FileFilterDecision } from '../types';

export interface FileFilter {
  readonly name: string;
  decide(file: DiscoveredFile): Promise<FileFilterDecision>;
}
