#!/usr/bin/env node

import { clearLocalIdentityAmbientDriverSelection } from './config/local-identity.config';

export async function main(argv: readonly string[] = process.argv.slice(2)) {
  clearLocalIdentityAmbientDriverSelection();
  const { runLocalIdentityAdminCli } = await import(
    './modules/auth/local-identity-admin.cli'
  );
  return runLocalIdentityAdminCli({ argv });
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
      'Local identity command failed\n',
    );
    return 1;
  }
}

if (require.main === module) {
  void runLocalIdentityEntrypoint().then((code) => {
    process.exitCode = code;
  });
}
