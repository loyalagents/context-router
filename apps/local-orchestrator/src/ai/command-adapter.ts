import { spawn } from 'node:child_process';
import {
  DiscoveredFile,
  FilteredSuggestion,
  PreferenceSuggestion,
  RequestErrorRecord,
} from '../types';
import { RequestError } from '../server/request-error';

export interface SuggestionStageAdapterRequest {
  stage: 'suggestion';
  goal: string;
  file: DiscoveredFile;
  analysis: {
    analysisId: string;
    documentSummary: string | null;
    status: 'success';
    filteredCount: number;
  };
  suggestions: PreferenceSuggestion[];
  filteredSuggestions: FilteredSuggestion[];
}

export interface SuggestionStageAdapterDecision {
  suggestionId: string;
  action: 'apply' | 'skip';
  reason: string;
  score?: number;
  details?: string;
}

export interface SuggestionStageAdapterResponse {
  promptVersion?: string;
  decisions: SuggestionStageAdapterDecision[];
}

export interface FileStageAdapterRequest {
  stage: 'file';
  goal: string;
  file: DiscoveredFile;
  preview: {
    text: string;
    truncated: boolean;
    lineCount: number;
    byteCount: number;
    encoding: 'utf-8';
  };
}

export interface FileStageAdapterResponse {
  promptVersion?: string;
  decision: {
    action: 'analyze' | 'skip';
    reason: string;
    score?: number;
    details?: string;
  };
}

interface CommandAIFilterAdapterOptions {
  command: string;
  commandArgs?: string[];
  timeoutMs: number;
}

export class CommandAIFilterAdapter {
  readonly name = 'command';
  private readonly options: Required<CommandAIFilterAdapterOptions>;

  constructor(options: CommandAIFilterAdapterOptions) {
    this.options = {
      ...options,
      commandArgs: options.commandArgs ?? [],
    };
  }

  async decideSuggestions(
    request: SuggestionStageAdapterRequest,
  ): Promise<SuggestionStageAdapterResponse> {
    const parsed = await this.execute(request);
    return validateSuggestionStageResponse(request, parsed);
  }

  async decideFile(
    request: FileStageAdapterRequest,
  ): Promise<FileStageAdapterResponse> {
    const parsed = await this.execute(request);
    return validateFileStageResponse(parsed);
  }

  private async execute(
    payload: SuggestionStageAdapterRequest | FileStageAdapterRequest,
  ): Promise<unknown> {
    const output = await executeCommand(
      this.options.command,
      this.options.commandArgs,
      JSON.stringify(payload),
      this.options.timeoutMs,
    );

    try {
      return JSON.parse(output);
    } catch (error) {
      throw new RequestError(
        error instanceof Error
          ? `AI adapter returned invalid JSON: ${error.message}`
          : 'AI adapter returned invalid JSON',
        'invalid_response',
      );
    }
  }
}

async function executeCommand(
  command: string,
  commandArgs: string[],
  input: string,
  timeoutMs: number,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let settled = false;
    let stdout = '';
    let stderr = '';

    const child = spawn(command, commandArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const finish = (fn: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      fn();
    };

    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      finish(() =>
        reject(
          new RequestError(
            `AI adapter command timed out after ${timeoutMs}ms`,
            'timeout',
          ),
        ),
      );
    }, timeoutMs);

    child.on('error', (error) => {
      finish(() =>
        reject(
          new RequestError(
            `AI adapter command failed to start: ${error.message}`,
            'process',
          ),
        ),
      );
    });

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });

    child.on('close', (code, signal) => {
      finish(() => {
        if (code !== 0) {
          const suffix = stderr.trim().length > 0 ? `: ${stderr.trim()}` : '';
          reject(
            new RequestError(
              `AI adapter command exited with code ${code ?? 'unknown'}${signal ? ` (${signal})` : ''}${suffix}`,
              'process',
            ),
          );
          return;
        }

        resolve(stdout);
      });
    });

    child.stdin.on('error', (error) => {
      finish(() =>
        reject(
          new RequestError(
            `AI adapter command stdin failed: ${error.message}`,
            'process',
          ),
        ),
      );
    });

    child.stdin.end(input);
  });
}

function validateSuggestionStageResponse(
  request: SuggestionStageAdapterRequest,
  value: unknown,
): SuggestionStageAdapterResponse {
  if (!isObject(value)) {
    throw new RequestError(
      'AI adapter response must be a JSON object',
      'invalid_response',
    );
  }

  const promptVersion = optionalString(value.promptVersion, 'promptVersion');
  if (!Array.isArray(value.decisions)) {
    throw new RequestError(
      'AI adapter response must include a decisions array',
      'invalid_response',
    );
  }

  const expectedIds = new Set(request.suggestions.map((suggestion) => suggestion.id));
  const seenIds = new Set<string>();
  const decisions: SuggestionStageAdapterDecision[] = value.decisions.map(
    (candidate, index) => {
      if (!isObject(candidate)) {
        throw new RequestError(
          `AI adapter decision ${index} must be an object`,
          'invalid_response',
        );
      }

      const suggestionId = requiredString(
        candidate.suggestionId,
        `decisions[${index}].suggestionId`,
      );
      if (!expectedIds.has(suggestionId)) {
        throw new RequestError(
          `AI adapter returned unknown suggestionId "${suggestionId}"`,
          'invalid_response',
        );
      }
      if (seenIds.has(suggestionId)) {
        throw new RequestError(
          `AI adapter returned duplicate suggestionId "${suggestionId}"`,
          'invalid_response',
        );
      }
      seenIds.add(suggestionId);

      const action = candidate.action;
      if (action !== 'apply' && action !== 'skip') {
        throw new RequestError(
          `AI adapter decision ${index} must use action "apply" or "skip"`,
          'invalid_response',
        );
      }

      const reason = requiredString(candidate.reason, `decisions[${index}].reason`);
      const score = optionalScore(candidate.score, `decisions[${index}].score`);
      const details = optionalString(candidate.details, `decisions[${index}].details`);

      return {
        suggestionId,
        action,
        reason,
        score,
        details,
      };
    },
  );

  if (seenIds.size !== expectedIds.size) {
    const missingIds = Array.from(expectedIds).filter((id) => !seenIds.has(id));
    throw new RequestError(
      `AI adapter must return exactly one decision per suggestion. Missing: ${missingIds.join(', ')}`,
      'invalid_response',
    );
  }

  return {
    promptVersion,
    decisions,
  };
}

function validateFileStageResponse(value: unknown): FileStageAdapterResponse {
  if (!isObject(value)) {
    throw new RequestError(
      'AI adapter response must be a JSON object',
      'invalid_response',
    );
  }

  const promptVersion = optionalString(value.promptVersion, 'promptVersion');
  if (!isObject(value.decision)) {
    throw new RequestError(
      'AI adapter file-stage response must include a decision object',
      'invalid_response',
    );
  }

  const action = value.decision.action;
  if (action !== 'analyze' && action !== 'skip') {
    throw new RequestError(
      'AI adapter file-stage decision must use action "analyze" or "skip"',
      'invalid_response',
    );
  }

  return {
    promptVersion,
    decision: {
      action,
      reason: requiredString(value.decision.reason, 'decision.reason'),
      score: optionalScore(value.decision.score, 'decision.score'),
      details: optionalString(value.decision.details, 'decision.details'),
    },
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new RequestError(
      `AI adapter field "${field}" must be a non-empty string`,
      'invalid_response',
    );
  }

  return value;
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value == null) {
    return undefined;
  }

  if (typeof value !== 'string') {
    throw new RequestError(
      `AI adapter field "${field}" must be a string when provided`,
      'invalid_response',
    );
  }

  return value;
}

function optionalScore(value: unknown, field: string): number | undefined {
  if (value == null) {
    return undefined;
  }

  if (typeof value !== 'number' || Number.isNaN(value) || value < 0 || value > 1) {
    throw new RequestError(
      `AI adapter field "${field}" must be a number between 0 and 1`,
      'invalid_response',
    );
  }

  return value;
}
