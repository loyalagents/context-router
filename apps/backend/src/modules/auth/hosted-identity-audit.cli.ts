import { isAbsolute } from "path";
import { PrismaClient } from "@infrastructure/prisma/generated-client";
import { buildPrismaClientOptions } from "@infrastructure/prisma/prisma-client-options";
import { loadHostedIdentityAuditEnvironment } from "@config/hosted-identity-audit.config";
import {
  parseHostedIssuerConfiguration,
  type HostedIssuerConfiguration,
} from "./hosted-identity-policy";
import {
  HostedIdentityAuditService,
  type HostedIdentityAuditOutput,
  readHostedIdentityAuditIntentFile,
} from "./hosted-identity-audit";
import { HostedIdentityRepository } from "./hosted-identity.repository";

export interface HostedIdentityAuditCliConfiguration
  extends HostedIssuerConfiguration {
  intentPath: string;
  databaseUrl: string;
}

interface HostedIdentityAuditCliStreams {
  stdout: { write(value: string): unknown };
  stderr: { write(value: string): unknown };
}

function invalidCommand(): never {
  throw new Error("Invalid hosted identity audit command");
}

function invalidConfiguration(): never {
  throw new Error("Invalid hosted identity audit configuration");
}

export function parseHostedIdentityAuditCliConfiguration(
  argv: string[],
  environment: NodeJS.ProcessEnv,
): HostedIdentityAuditCliConfiguration {
  if (
    argv.length !== 1 ||
    typeof argv[0] !== "string" ||
    !isAbsolute(argv[0])
  ) {
    return invalidCommand();
  }
  if (
    typeof environment.DATABASE_URL !== "string" ||
    environment.DATABASE_URL.length === 0
  ) {
    return invalidConfiguration();
  }

  let issuerConfiguration: HostedIssuerConfiguration;
  try {
    issuerConfiguration = parseHostedIssuerConfiguration({
      issuer: environment.AUTH0_ISSUER,
      domain: environment.AUTH0_DOMAIN,
      legacyIssuer: environment.AUTH0_LEGACY_ISSUER,
    });
  } catch {
    return invalidConfiguration();
  }
  return {
    intentPath: argv[0],
    databaseUrl: environment.DATABASE_URL,
    ...issuerConfiguration,
  };
}

export async function runHostedIdentityAuditCli(
  argv: string[] = process.argv.slice(2),
  environment: NodeJS.ProcessEnv = loadHostedIdentityAuditEnvironment(),
): Promise<HostedIdentityAuditOutput> {
  const configuration = parseHostedIdentityAuditCliConfiguration(
    argv,
    environment,
  );
  const intent = await readHostedIdentityAuditIntentFile(
    configuration.intentPath,
  );
  const prisma = new PrismaClient(
    buildPrismaClientOptions({ databaseUrl: configuration.databaseUrl }),
  );
  try {
    await prisma.$connect();
    return await new HostedIdentityAuditService(
      new HostedIdentityRepository(prisma as never),
    ).audit(intent, configuration);
  } finally {
    await prisma.$disconnect();
  }
}

export async function executeHostedIdentityAuditCli(
  argv: string[] = process.argv.slice(2),
  environment: NodeJS.ProcessEnv = loadHostedIdentityAuditEnvironment(),
  streams: HostedIdentityAuditCliStreams = process,
): Promise<0 | 1> {
  try {
    const output = await runHostedIdentityAuditCli(argv, environment);
    streams.stdout.write(`${JSON.stringify(output)}\n`);
    return 0;
  } catch {
    streams.stderr.write("Hosted identity audit failed\n");
    return 1;
  }
}

if (require.main === module) {
  void executeHostedIdentityAuditCli().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
