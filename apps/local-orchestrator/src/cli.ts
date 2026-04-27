import path from 'node:path';
import { CliOptions } from './types';

export interface ParsedCliCommand {
  kind: 'run' | 'help';
  options?: CliOptions;
}

const DEFAULT_BACKEND_URL = 'http://localhost:3000';

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
    '  --out <path>                 Write JSON manifest to this path',
    '  --file-filter <name>         File filter implementation (default: passthrough)',
    '  --suggestion-filter <name>   Suggestion filter implementation (default: passthrough)',
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
  let out: string | undefined;
  let fileFilter: CliOptions['fileFilter'] = 'passthrough';
  let suggestionFilter: CliOptions['suggestionFilter'] = 'passthrough';

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
      case '--out':
        out = requireValue(argv, ++index, '--out');
        break;
      case '--file-filter':
        fileFilter = parseKnownFilter(
          requireValue(argv, ++index, '--file-filter'),
          '--file-filter',
        );
        break;
      case '--suggestion-filter':
        suggestionFilter = parseKnownFilter(
          requireValue(argv, ++index, '--suggestion-filter'),
          '--suggestion-filter',
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

  return {
    kind: 'run',
    options: {
      folder: path.resolve(folder),
      backendUrl: normalizeBackendUrl(backendUrl),
      token,
      apply,
      concurrency,
      out: out ? path.resolve(out) : undefined,
      fileFilter,
      suggestionFilter,
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

function parseKnownFilter(
  value: string,
  flag: '--file-filter' | '--suggestion-filter',
): 'passthrough' {
  if (value !== 'passthrough') {
    throw new Error(`${flag} only supports "passthrough" in V1`);
  }
  return 'passthrough';
}

function normalizeBackendUrl(input: string): string {
  return input.replace(/\/+$/, '');
}
