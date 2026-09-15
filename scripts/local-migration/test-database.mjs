import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";

import {
  assertSafePostgresEndpoint,
  assertServerVerifiedTestDatabase,
  buildDatabaseUrl,
  generateDatabaseName,
  redactSecrets,
  runCommand,
  validateGeneratedDatabaseName,
} from "./gate-runner.mjs";

function pgFor(repositoryRoot) {
  const require = createRequire(path.join(repositoryRoot, "apps/backend/package.json"));
  return require("pg");
}

async function withClient(repositoryRoot, connectionString, callback) {
  const { Client } = pgFor(repositoryRoot);
  const client = new Client({ connectionString, connectionTimeoutMillis: 5_000 });
  await client.connect();
  try {
    return await callback(client);
  } finally {
    await client.end();
  }
}

export async function inspectPostgresPeer(repositoryRoot, connectionString) {
  return withClient(repositoryRoot, connectionString, async (client) =>
    client.connection?.stream?.remoteAddress ?? null,
  );
}

export async function validateAdministrationDatabase(repositoryRoot, administrationUrl) {
  return assertSafePostgresEndpoint(administrationUrl, {
    inspectPeer: (url) => inspectPostgresPeer(repositoryRoot, url),
  });
}

export async function createIsolatedTestDatabase(repositoryRoot, administrationUrl) {
  await validateAdministrationDatabase(repositoryRoot, administrationUrl);
  const databaseName = generateDatabaseName();
  await withClient(repositoryRoot, administrationUrl, (client) =>
    client.query(`CREATE DATABASE "${databaseName}"`),
  );
  const databaseUrl = buildDatabaseUrl(administrationUrl, databaseName);
  try {
    await assertSafePostgresEndpoint(databaseUrl, {
      inspectPeer: (url) => inspectPostgresPeer(repositoryRoot, url),
    });
    await assertServerVerifiedTestDatabase(databaseName, () =>
      withClient(repositoryRoot, databaseUrl, async (client) => {
        const result = await client.query("SELECT current_database() AS current_database");
        return result.rows[0];
      }),
    );
  } catch (error) {
    await dropIsolatedTestDatabase(repositoryRoot, administrationUrl, databaseName).catch(() => {});
    throw error;
  }
  return { databaseName, databaseUrl };
}

export async function dropIsolatedTestDatabase(
  repositoryRoot,
  administrationUrl,
  databaseName,
) {
  validateGeneratedDatabaseName(databaseName);
  await validateAdministrationDatabase(repositoryRoot, administrationUrl);
  await withClient(repositoryRoot, administrationUrl, async (client) => {
    await client.query(
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
      [databaseName],
    );
    await client.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
  });
}

export async function queryDatabase(repositoryRoot, databaseUrl, text, values = []) {
  return withClient(repositoryRoot, databaseUrl, async (client) => {
    const result = await client.query(text, values);
    return result.rows;
  });
}

async function findFreeLoopbackPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

async function waitForAdministration(repositoryRoot, administrationUrl, deadlineMs = 30_000) {
  const deadline = Date.now() + deadlineMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      await validateAdministrationDatabase(repositoryRoot, administrationUrl);
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error(`PostgreSQL test administration did not become ready: ${redactSecrets(lastError?.message)}`);
}

export async function prepareTestAdministration({
  repositoryRoot,
  diagnosticsDirectory,
  environment = process.env,
}) {
  if (environment.MIGRATION_TEST_ADMIN_URL) {
    await validateAdministrationDatabase(repositoryRoot, environment.MIGRATION_TEST_ADMIN_URL);
    return {
      administrationUrl: environment.MIGRATION_TEST_ADMIN_URL,
      source: "supplied-loopback-administration-url",
      cleanup: async () => {},
    };
  }

  const image = "postgres:15-alpine";
  try {
    await runCommand(["docker", "image", "inspect", image], {
      cwd: repositoryRoot,
      timeoutMs: 15_000,
      logPath: path.join(diagnosticsDirectory, "docker-image-inspect.log"),
    });
  } catch {
    throw new Error(
      `No MIGRATION_TEST_ADMIN_URL was supplied and cached ${image} is unavailable. Install that image explicitly or supply a loopback PostgreSQL administration URL; the gate never pulls images.`,
    );
  }

  const port = await findFreeLoopbackPort();
  const suffix = generateDatabaseName().replace(/^context_router_|_test$/g, "");
  const containerName = `lmbg-postgres-${suffix}`;
  const syntheticPassword = `lmbg-${suffix}`;
  await runCommand(
    [
      "docker",
      "run",
      "--pull=never",
      "--detach",
      "--rm",
      "--name",
      containerName,
      "--label",
      "context-router.local-migration-gate=true",
      "--publish",
      `127.0.0.1:${port}:5432`,
      "--env",
      "POSTGRES_USER=postgres",
      "--env",
      `POSTGRES_PASSWORD=${syntheticPassword}`,
      "--env",
      "POSTGRES_DB=postgres",
      image,
    ],
    {
      cwd: repositoryRoot,
      timeoutMs: 30_000,
      logPath: path.join(diagnosticsDirectory, "docker-start.log"),
      canaries: [syntheticPassword],
    },
  );
  const administrationUrl = `postgresql://postgres:${encodeURIComponent(syntheticPassword)}@127.0.0.1:${port}/postgres`;
  try {
    await waitForAdministration(repositoryRoot, administrationUrl);
  } catch (error) {
    await runCommand(["docker", "rm", "--force", containerName], {
      cwd: repositoryRoot,
      timeoutMs: 30_000,
      logPath: path.join(diagnosticsDirectory, "docker-cleanup.log"),
      canaries: [syntheticPassword],
    }).catch(() => {});
    throw error;
  }

  return {
    administrationUrl,
    source: "created-loopback-container",
    containerName,
    cleanup: async () => {
      if (!/^lmbg-postgres-[a-f0-9]{24}$/.test(containerName)) {
        throw new Error("refusing to clean an unexpected PostgreSQL container name");
      }
      await runCommand(["docker", "rm", "--force", containerName], {
        cwd: repositoryRoot,
        timeoutMs: 30_000,
        logPath: path.join(diagnosticsDirectory, "docker-cleanup.log"),
        canaries: [syntheticPassword],
      });
    },
  };
}
