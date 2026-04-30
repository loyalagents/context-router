import path from 'node:path';
import { AIFilterAdapter, AIFilterStage, CliOptions } from './types';

export interface ParsedCliCommand {
  kind: 'run' | 'help';
  options?: CliOptions;
}

const DEFAULT_BACKEND_URL = 'http://localhost:3000';
const DEFAULT_AI_TIMEOUT_MS = 30000;

export function buildHelpText(): string {
  return [
    'Usage:',
    '  pnpm --filter local-orchestrator start -- --folder <path> --token <bearer-token> [options]',
    '',
    'Options:',
    '  --folder <path>              Folder to scan recursively',
    '  --backend-url <url>          Backend base URL (default: http://localhost:3000)',
    '  --token <token>              Bearer token for backend auth',
    '  --apply                      Persist accepted suggestions (default: dry-run)',
    '  --concurrency <n>            Analysis concurrency (default: 1)',
    '  --include-hidden             Traverse hidden files and directories (default: skip hidden entries)',
    '  --out <path>                 Write JSON manifest to this path',
    '  --ai-filter                  Enable local AI filtering',
    '  --ai-filter-stage <name>     AI filter stage: suggestion|file|both (default: suggestion)',
    '  --ai-adapter <name>          AI adapter implementation (default: command)',
    '  --ai-command <path-or-name>  Command to execute for the command adapter',
    '  --ai-goal <text>             Required filtering goal when AI filtering is enabled',
    '  --ai-timeout-ms <n>          AI adapter timeout in milliseconds (default: 30000)',
    '  --help                       Show this help',
  ].join('\n');
}

export function parseCliArgs(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
): ParsedCliCommand {
  if (argv.includes('--help') || argv.includes('-h')) {
    return { kind: 'help' };
  }

  let folder: string | undefined;
  let backendUrl = DEFAULT_BACKEND_URL;
  let token = env.CONTEXT_ROUTER_BEARER_TOKEN ?? '';
  let apply = false;
  let concurrency = 1;
  let includeHidden = false;
  let out: string | undefined;
  let aiFilter = false;
  let aiFilterStage: CliOptions['aiFilterStage'] = 'suggestion';
  let aiAdapter: CliOptions['aiAdapter'] = 'command';
  let aiCommand: string | undefined;
  let aiGoal: string | undefined;
  let aiTimeoutMs = DEFAULT_AI_TIMEOUT_MS;
  let sawAIOption = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    switch (arg) {
      case '--':
        break;
      case '--folder':
        folder = requireValue(argv, ++index, '--folder');
        break;
      case '--backend-url':
        backendUrl = requireValue(argv, ++index, '--backend-url');
        break;
      case '--token':
        token = requireValue(argv, ++index, '--token');
        break;
      case '--apply':
        apply = true;
        break;
      case '--concurrency':
        concurrency = parsePositiveInteger(
          requireValue(argv, ++index, '--concurrency'),
          '--concurrency',
        );
        break;
      case '--include-hidden':
        includeHidden = true;
        break;
      case '--out':
        out = requireValue(argv, ++index, '--out');
        break;
      case '--ai-filter':
        aiFilter = true;
        break;
      case '--ai-filter-stage':
        sawAIOption = true;
        aiFilterStage = parseAIFilterStage(
          requireValue(argv, ++index, '--ai-filter-stage'),
        );
        break;
      case '--ai-adapter':
        sawAIOption = true;
        aiAdapter = parseAIAdapter(requireValue(argv, ++index, '--ai-adapter'));
        break;
      case '--ai-command':
        sawAIOption = true;
        aiCommand = requireValue(argv, ++index, '--ai-command');
        break;
      case '--ai-goal':
        sawAIOption = true;
        aiGoal = requireValue(argv, ++index, '--ai-goal');
        break;
      case '--ai-timeout-ms':
        sawAIOption = true;
        aiTimeoutMs = parsePositiveInteger(
          requireValue(argv, ++index, '--ai-timeout-ms'),
          '--ai-timeout-ms',
        );
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!folder) {
    throw new Error('Missing required --folder argument');
  }

  if (!token) {
    throw new Error(
      'Missing bearer token. Pass --token or set CONTEXT_ROUTER_BEARER_TOKEN.',
    );
  }

  if (!aiFilter && sawAIOption) {
    throw new Error('AI options require --ai-filter.');
  }

  if (aiFilter && !aiGoal) {
    throw new Error('--ai-goal is required when --ai-filter is enabled.');
  }

  if (aiFilter && aiAdapter === 'command' && !aiCommand) {
    throw new Error('--ai-command is required when --ai-adapter is "command".');
  }

  if (aiCommand && aiAdapter !== 'command') {
    throw new Error('--ai-command is only valid when --ai-adapter is "command".');
  }

  return {
    kind: 'run',
    options: {
      folder: path.resolve(folder),
      backendUrl: normalizeBackendUrl(backendUrl),
      token,
      apply,
      concurrency,
      includeHidden,
      out: out ? path.resolve(out) : undefined,
      aiFilter,
      aiFilterStage,
      aiAdapter,
      aiCommand,
      aiGoal,
      aiTimeoutMs,
    },
  };
}

function requireValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];

  if (!value || value.startsWith('--')) {
    throw new Error(`Missing value for ${flag}`);
  }

  return value;
}

function parsePositiveInteger(value: string, flag: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return parsed;
}

function parseAIAdapter(value: string): AIFilterAdapter {
  if (value !== 'command') {
    throw new Error(`--ai-adapter only supports "command" in V1.`);
  }
  return 'command';
}

function parseAIFilterStage(value: string): AIFilterStage {
  if (value === 'suggestion' || value === 'file' || value === 'both') {
    return value;
  }

  throw new Error(
    '--ai-filter-stage must be one of "suggestion", "file", or "both".',
  );
}

function normalizeBackendUrl(input: string): string {
  return input.replace(/\/+$/, '');
}
