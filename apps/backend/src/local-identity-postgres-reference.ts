#!/usr/bin/env node

/** Explicit retained PostgreSQL preview. Clear ambient driver selection before loading any provider. */
export async function main(
  argv: readonly string[] = process.argv.slice(2),
): Promise<number> {
  const {
    createLocalIdentityConfiguration,
    clearLocalIdentityAmbientDriverSelection,
  } = await import("./config/local-identity.config");
  clearLocalIdentityAmbientDriverSelection();
  const [
    { runLocalIdentityAdminCli },
    { LocalIdentityFileStore },
    { LocalIdentityStateService },
    { PostgresLocalIdentityCoordination },
  ] = await Promise.all([
    import("./modules/auth/local-identity-admin.cli"),
    import("./modules/auth/local-identity-filesystem"),
    import("./modules/auth/local-identity-state.service"),
    import(
      "./infrastructure/storage/postgres/postgres-local-identity-coordination"
    ),
  ]);
  const createService = (configuration = createLocalIdentityConfiguration()) =>
    new LocalIdentityStateService({
      fileStore: new LocalIdentityFileStore({
        stateRoot: configuration.stateRoot,
        databaseTargetId: configuration.databaseTargetId,
      }),
      repository: new PostgresLocalIdentityCoordination({
        clientConfig: configuration.clientConfig,
      }),
    });
  if (argv.length === 1 && argv[0] === "preview") {
    const configuration = createLocalIdentityConfiguration(),
      service = createService(configuration);
    const { runLocalIdentityPreview } = await import(
      "./bootstrap/local-identity-preview"
    );
    return runLocalIdentityPreview({
      configuration,
      verifyReadyState: () => service.verifyReadyState(),
      createApplication: async () => {
        const [{ NestFactory }, { PostgresReferenceLocalApplicationModule }] =
          await Promise.all([
            import("@nestjs/core"),
            import("./composition/postgres-reference-local-application.module"),
          ]);
        return NestFactory.create(
          PostgresReferenceLocalApplicationModule.register(configuration),
          { abortOnError: false, logger: false },
        );
      },
    });
  }
  return runLocalIdentityAdminCli({
    argv,
    createService: () => createService(),
  });
}
export async function runPostgresReferenceEntrypoint(
  options: { argv?: readonly string[] } = {},
): Promise<number> {
  try {
    return await main(options.argv);
  } catch {
    process.stderr.write("Local identity command failed\n");
    return 1;
  }
}
// Retain the bounded journaled launcher contract used by both explicit preview entrypoints.
export const runLocalIdentityEntrypoint = runPostgresReferenceEntrypoint;

if (require.main === module)
  void runPostgresReferenceEntrypoint().then((code) => {
    process.exitCode = code;
  });
