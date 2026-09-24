import type { OpenLocalIdentityState } from "./local-identity-filesystem";

export interface LocalIdentityAdminService {
  initialize(): Promise<OpenLocalIdentityState>;
  recoverInitialize(): Promise<OpenLocalIdentityState | null>;
  rotate(): Promise<OpenLocalIdentityState>;
  recoverRotation(): Promise<OpenLocalIdentityState>;
}

export type LocalIdentityCommand =
  | "initialize"
  | "recover-initialize"
  | "rotate"
  | "recover-rotation";

const COMMANDS = new Set<LocalIdentityCommand>([
  "initialize",
  "recover-initialize",
  "rotate",
  "recover-rotation",
]);

export async function createLocalIdentityAdminService(
  initialize = false,
): Promise<LocalIdentityAdminService> {
  const [
    { createLocalDatabaseConfiguration },
    { createSqliteIdentityRuntime, seedLocalCatalog },
  ] = await Promise.all([
    import("../../config/local-database.config"),
    import("../../infrastructure/storage/sqlite/sqlite-local-runtime"),
  ]);
  const { database, service } = createSqliteIdentityRuntime(
    createLocalDatabaseConfiguration(),
    initialize,
  );
  return {
    initialize: async () => {
      const ready = await service.initialize();
      await seedLocalCatalog(database);
      return ready;
    },
    recoverInitialize: () => service.recoverInitialize(),
    rotate: () => service.rotate(),
    recoverRotation: () => service.recoverRotation(),
  };
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
    type: "context-router.local-identity.admin",
    version: 1,
    operation,
    status: "ok",
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
    writeStderr("Invalid local identity command\n");
    return 2;
  }

  try {
    const service =
      options.createService?.() ??
      (await createLocalIdentityAdminService(command === "initialize"));
    let result: OpenLocalIdentityState | null;
    switch (command) {
      case "initialize":
        result = await service.initialize();
        break;
      case "recover-initialize":
        result = await service.recoverInitialize();
        break;
      case "rotate":
        result = await service.rotate();
        break;
      case "recover-rotation":
        result = await service.recoverRotation();
        break;
    }
    writeStdout(successRecord(command, result));
    return 0;
  } catch {
    writeStderr("Local identity command failed\n");
    return 1;
  }
}

/** SQLite-only pre-acquire bootstrap recovery; the reference dispatcher above keeps its four commands. */
export async function runLocalDatabaseAdminCli(
  options: Parameters<typeof runLocalIdentityAdminCli>[0],
): Promise<number> {
  if (
    options.argv.length !== 1 ||
    options.argv[0] !== "recover-database-bootstrap"
  )
    return runLocalIdentityAdminCli(options);
  try {
    const [{ createLocalDatabaseConfiguration }, { SqliteDatabase }] =
      await Promise.all([
        import("../../config/local-database.config"),
        import("../../infrastructure/storage/sqlite/sqlite-database"),
      ]);
    const configuration = createLocalDatabaseConfiguration();
    const status = SqliteDatabase.recoverBootstrap({
      databaseRoot: configuration.databaseRoot,
      identityRoot: configuration.stateRoot,
    });
    (options.writeStdout ?? ((value) => process.stdout.write(value)))(
      JSON.stringify({
        type: "context-router.local-database.bootstrap-recovery",
        version: 1,
        status,
      }) + "\n",
    );
    return 0;
  } catch {
    (options.writeStderr ?? ((value) => process.stderr.write(value)))(
      "Local identity command failed\n",
    );
    return 1;
  }
}
