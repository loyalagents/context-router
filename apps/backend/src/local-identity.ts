#!/usr/bin/env node

type RunPreview = () => Promise<number>;
type RunAdmin = (argv: readonly string[]) => Promise<number>;

export interface LocalIdentityEntrypointDependencies {
  loadPreview?: () => Promise<RunPreview>;
  loadAdmin?: () => Promise<RunAdmin>;
}

async function loadPreview(): Promise<RunPreview> {
  const [{ createLocalDatabaseConfiguration }, { runLocalIdentityPreview }] =
    await Promise.all([
      import("./config/local-database.config"),
      import("./bootstrap/local-identity-preview"),
    ]);
  return () =>
    runLocalIdentityPreview({
      configuration: createLocalDatabaseConfiguration(),
    });
}

async function loadAdmin(): Promise<RunAdmin> {
  const { runLocalDatabaseAdminCli } = await import(
    "./modules/auth/local-identity-admin.cli"
  );
  return (argv) => runLocalDatabaseAdminCli({ argv });
}

export async function main(
  argv: readonly string[] = process.argv.slice(2),
  dependencies: LocalIdentityEntrypointDependencies = {},
) {
  const { clearLocalIdentityAmbientDriverSelection } = await import(
    "./config/local-identity.config"
  );
  clearLocalIdentityAmbientDriverSelection();
  if (argv.length === 1 && argv[0] === "preview") {
    const runPreview = await (dependencies.loadPreview ?? loadPreview)();
    return runPreview();
  }
  const runAdmin = await (dependencies.loadAdmin ?? loadAdmin)();
  return runAdmin(argv);
}

export async function runLocalIdentityEntrypoint(
  options: {
    argv?: readonly string[];
    invoke?: (argv: readonly string[]) => Promise<number>;
    writeStderr?: (value: string) => void;
  } = {},
): Promise<number> {
  try {
    return await (options.invoke ?? main)(
      options.argv ?? process.argv.slice(2),
    );
  } catch {
    (options.writeStderr ?? ((value) => process.stderr.write(value)))(
      "Local identity command failed\n",
    );
    return 1;
  }
}

if (require.main === module) {
  void runLocalIdentityEntrypoint().then((code) => {
    process.exitCode = code;
  });
}
