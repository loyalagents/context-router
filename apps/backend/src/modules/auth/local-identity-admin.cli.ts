import { createLocalIdentityConfiguration } from '@config/local-identity.config';

import { LocalIdentityFileStore } from './local-identity-filesystem';
import { PostgresLocalIdentityCoordination } from '@/infrastructure/storage/postgres/postgres-local-identity-coordination';
import type { OpenLocalIdentityState } from './local-identity-filesystem';
import { LocalIdentityStateService } from './local-identity-state.service';

export interface LocalIdentityAdminService {
  initialize(): Promise<OpenLocalIdentityState>;
  recoverInitialize(): Promise<OpenLocalIdentityState | null>;
  rotate(): Promise<OpenLocalIdentityState>;
  recoverRotation(): Promise<OpenLocalIdentityState>;
}

export type LocalIdentityCommand =
  | 'initialize'
  | 'recover-initialize'
  | 'rotate'
  | 'recover-rotation';

const COMMANDS = new Set<LocalIdentityCommand>([
  'initialize',
  'recover-initialize',
  'rotate',
  'recover-rotation',
]);

export function createLocalIdentityAdminService(): LocalIdentityStateService {
  const configuration = createLocalIdentityConfiguration();
  return new LocalIdentityStateService({
    fileStore: new LocalIdentityFileStore({
      stateRoot: configuration.stateRoot,
      databaseTargetId: configuration.databaseTargetId,
    }),
    repository: new PostgresLocalIdentityCoordination({
      clientConfig: configuration.clientConfig,
    }),
  });
}

function parseCommand(argv: readonly string[]): LocalIdentityCommand | null {
  if (argv.length !== 1 || !COMMANDS.has(argv[0] as LocalIdentityCommand)) {
    return null;
  }
  return argv[0] as LocalIdentityCommand;
}

function successRecord(
  operation: LocalIdentityCommand,
  result: OpenLocalIdentityState | null,
): string {
  return `${JSON.stringify({
    type: 'context-router.local-identity.admin',
    version: 1,
    operation,
    status: 'ok',
    generation: result?.state.generation ?? null,
  })}\n`;
}

export async function runLocalIdentityAdminCli(options: {
  argv: readonly string[];
  createService?: () => LocalIdentityAdminService;
  writeStdout?: (value: string) => void;
  writeStderr?: (value: string) => void;
}): Promise<number> {
  const command = parseCommand(options.argv);
  const writeStdout =
    options.writeStdout ?? ((value) => process.stdout.write(value));
  const writeStderr =
    options.writeStderr ?? ((value) => process.stderr.write(value));
  if (!command) {
    writeStderr('Invalid local identity command\n');
    return 2;
  }

  try {
    const service =
      options.createService?.() ?? createLocalIdentityAdminService();
    let result: OpenLocalIdentityState | null;
    switch (command) {
      case 'initialize':
        result = await service.initialize();
        break;
      case 'recover-initialize':
        result = await service.recoverInitialize();
        break;
      case 'rotate':
        result = await service.rotate();
        break;
      case 'recover-rotation':
        result = await service.recoverRotation();
        break;
    }
    writeStdout(successRecord(command, result));
    return 0;
  } catch {
    writeStderr('Local identity command failed\n');
    return 1;
  }
}
