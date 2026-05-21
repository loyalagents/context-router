import { isFixtureId } from '../shared.mjs';

export function parseRunArgs(args) {
  const options = {
    scenarioId: null,
    updateSnapshots: false,
    verbose: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--update-snapshots') {
      options.updateSnapshots = true;
      continue;
    }
    if (arg === '--verbose') {
      options.verbose = true;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      return { kind: 'help', usage: usage() };
    }
    if (arg !== '--scenario') {
      return { kind: 'usage-error', message: `Unsupported argument: ${arg}` };
    }

    const value = args[index + 1];
    if (!value || value.startsWith('--')) {
      return { kind: 'usage-error', message: 'Missing value for --scenario' };
    }
    index += 1;
    options.scenarioId = value;
  }

  if (!options.scenarioId) {
    return { kind: 'usage-error', message: '--scenario is required.' };
  }
  if (!isFixtureId(options.scenarioId)) {
    return { kind: 'usage-error', message: '--scenario must be a fixture id.' };
  }

  return { kind: 'ok', options };
}

export function usage() {
  return [
    'Usage:',
    '  pnpm eval:run --scenario <scenarioId> [--verbose]',
    '  pnpm eval:run --scenario <scenarioId> --update-snapshots [--verbose]',
  ].join('\n');
}
