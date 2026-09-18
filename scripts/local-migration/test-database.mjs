import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import net from "node:net";
import path from "node:path";

import {
  assertConnectedPostgresPeer,
  assertServerVerifiedTestDatabase,
  buildDatabaseUrl,
  generateDatabaseName,
  pinPostgresConnectionString,
  redactSecrets,
  runCommand,
  validateGeneratedDatabaseName,
  validatePostgresEndpointBeforeConnect,
} from "./gate-runner.mjs";

function combinePrimaryAndCleanupError(primaryError, cleanupError, context) {
  if (!cleanupError) return primaryError;
  if (!primaryError) return cleanupError;
  const combined = new Error(
    `${primaryError.message}; ${context} cleanup failed: ${cleanupError.message}`,
    { cause: primaryError },
  );
  combined.primaryError = primaryError;
  combined.cleanupError = cleanupError;
  combined.exitCode = primaryError.exitCode;
  combined.signal = primaryError.signal;
  combined.code = primaryError.code;
  return combined;
}

async function awaitWithSignal(operation, signal, onAbort) {
  if (!signal) return operation();
  if (signal.aborted) {
    onAbort?.();
    throw signal.reason ?? new Error("operation aborted");
  }
  return new Promise((resolve, reject) => {
    const abort = () => {
      onAbort?.();
      reject(signal.reason ?? new Error("operation aborted"));
    };
    signal.addEventListener("abort", abort, { once: true });
    let promise;
    try {
      promise = operation();
    } catch (error) {
      signal.removeEventListener("abort", abort);
      reject(error);
      return;
    }
    Promise.resolve(promise).then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}

function pgFor(repositoryRoot) {
  const require = createRequire(path.join(repositoryRoot, "apps/backend/package.json"));
  return require("pg");
}

function validateOwnershipNonce(ownershipNonce) {
  if (
    typeof ownershipNonce !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      ownershipNonce,
    )
  ) {
    throw new Error("invalid local migration ownership nonce");
  }
  return ownershipNonce.toLowerCase();
}

function databaseOwnershipMarker(ownershipNonce) {
  return `context-router-lmbg-owner:${validateOwnershipNonce(ownershipNonce)}`;
}

async function verifyDatabaseOwnership(
  repositoryRoot,
  administrationUrl,
  databaseName,
  expectedOwnershipMarker,
  options = {},
) {
  validateGeneratedDatabaseName(databaseName);
  return withVerifiedPostgresClient(
    repositoryRoot,
    administrationUrl,
    async (client) => {
      const result = await client.query(
        "SELECT shobj_description(oid, 'pg_database') AS owner_marker FROM pg_database WHERE datname = $1",
        [databaseName],
      );
      return result.rows[0]?.owner_marker === expectedOwnershipMarker;
    },
    options,
  );
}

function resolveCleanupSignal(cleanupSignal) {
  return typeof cleanupSignal === "function"
    ? cleanupSignal()
    : cleanupSignal;
}

export async function withVerifiedPostgresClient(
  repositoryRoot,
  connectionString,
  callback,
  {
    createClient,
    lookup,
    signal,
    endTimeoutMs = 5_000,
  } = {},
) {
  const endpoint = await validatePostgresEndpointBeforeConnect(
    connectionString,
    lookup ? { lookup } : {},
  );
  const pinnedConnectionString = pinPostgresConnectionString(
    connectionString,
    endpoint,
  );
  const clientConfig = {
    connectionString: pinnedConnectionString,
    connectionTimeoutMillis: 5_000,
    query_timeout: 10_000,
    statement_timeout: 10_000,
  };
  const client = createClient
    ? createClient(clientConfig)
    : new (pgFor(repositoryRoot).Client)({
        ...clientConfig,
      });
  let result;
  let primaryError;
  try {
    await awaitWithSignal(() => client.connect(), signal, () =>
      client.connection?.stream?.destroy(),
    );
    assertConnectedPostgresPeer(
      endpoint,
      client.connection?.stream?.remoteAddress ?? null,
    );
    result = await awaitWithSignal(() => callback(client), signal, () =>
      client.connection?.stream?.destroy(),
    );
  } catch (error) {
    primaryError = error;
  } finally {
    let cleanupError;
    let timer;
    try {
      const ended = await Promise.race([
        Promise.resolve().then(() => client.end()).then(() => true),
        new Promise((resolve) => {
          timer = setTimeout(() => resolve(false), endTimeoutMs);
        }),
      ]);
      if (!ended) {
        client.connection?.stream?.destroy();
        cleanupError = new Error(
          `PostgreSQL client did not close within ${endTimeoutMs}ms`,
        );
      }
    } catch (error) {
      client.connection?.stream?.destroy();
      cleanupError = error;
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (primaryError || cleanupError) {
      throw combinePrimaryAndCleanupError(
        primaryError,
        cleanupError,
        "PostgreSQL client",
      );
    }
  }
  return result;
}

export async function inspectPostgresPeer(repositoryRoot, connectionString) {
  return withVerifiedPostgresClient(repositoryRoot, connectionString, async (client) =>
    client.connection?.stream?.remoteAddress ?? null,
  );
}

export async function validateAdministrationDatabase(
  repositoryRoot,
  administrationUrl,
  options = {},
) {
  return withVerifiedPostgresClient(
    repositoryRoot,
    administrationUrl,
    async () => undefined,
    options,
  );
}

export async function createIsolatedTestDatabase(
  repositoryRoot,
  administrationUrl,
  {
    signal,
    cleanupSignal,
    lifecycle,
    withClient = withVerifiedPostgresClient,
    dropDatabase = dropIsolatedTestDatabase,
    verifyOwnership = verifyDatabaseOwnership,
    ownershipNonce = randomUUID(),
  } = {},
) {
  const databaseName = generateDatabaseName();
  const ownershipMarker = databaseOwnershipMarker(ownershipNonce);
  const resourceId = "database";
  await lifecycle?.acquiring?.({
    id: resourceId,
    type: "owned-test-database",
    owned: true,
    identity: { name: databaseName, ownershipMarker },
    recovery: `Verify database "${databaseName}" has ownership comment "${ownershipMarker}", then use the same verified local administration endpoint to drop only that database.`,
  });
  try {
    await withClient(
      repositoryRoot,
      administrationUrl,
      async (client) => {
        await client.query(`CREATE DATABASE "${databaseName}"`);
        await client.query(
          `COMMENT ON DATABASE "${databaseName}" IS '${ownershipMarker}'`,
        );
      },
      { signal },
    );
    const databaseUrl = buildDatabaseUrl(administrationUrl, databaseName);
    await assertServerVerifiedTestDatabase(databaseName, () =>
      withClient(
        repositoryRoot,
        databaseUrl,
        async (client) => {
          const result = await client.query(
            "SELECT current_database() AS current_database",
          );
          return result.rows[0];
        },
        { signal },
      ),
    );
    await lifecycle?.acquired?.(resourceId);
    return { databaseName, databaseUrl, ownershipMarker };
  } catch (error) {
    let cleanupError;
    let cleanupStatus = "not-owned";
    if (error.code !== "42P04") {
      let owned = false;
      try {
        owned = await verifyOwnership(
          repositoryRoot,
          administrationUrl,
          databaseName,
          ownershipMarker,
          { signal: resolveCleanupSignal(cleanupSignal) },
        );
      } catch (ownershipError) {
        cleanupError = new Error(
          `could not verify ownership marker for ${databaseName}: ${ownershipError.message}`,
          { cause: ownershipError },
        );
      }
      if (owned) {
        try {
          await dropDatabase(repositoryRoot, administrationUrl, databaseName, {
            expectedOwnershipMarker: ownershipMarker,
            signal: resolveCleanupSignal(cleanupSignal),
          });
          cleanupStatus = "removed";
        } catch (dropError) {
          cleanupError = combinePrimaryAndCleanupError(
            cleanupError,
            dropError,
            `database ${databaseName}`,
          );
        }
      } else if (!cleanupError) {
        cleanupError = new Error(
          `refusing to drop ${databaseName}: ownership marker was not verified`,
        );
      }
    }
    try {
      await lifecycle?.cleanupFinished?.(resourceId, {
        status: cleanupError ? "failed" : cleanupStatus,
        error: cleanupError,
      });
    } catch (journalError) {
      cleanupError = combinePrimaryAndCleanupError(
        cleanupError,
        journalError,
        `database ${databaseName} journal`,
      );
    }
    throw combinePrimaryAndCleanupError(
      error,
      cleanupError,
      `database ${databaseName}`,
    );
  }
}

export async function dropIsolatedTestDatabase(
  repositoryRoot,
  administrationUrl,
  databaseName,
  {
    withClient = withVerifiedPostgresClient,
    expectedOwnershipMarker,
    signal,
  } = {},
) {
  validateGeneratedDatabaseName(databaseName);
  if (
    typeof expectedOwnershipMarker !== "string" ||
    !/^context-router-lmbg-owner:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      expectedOwnershipMarker,
    )
  ) {
    throw new Error(
      `refusing to drop ${databaseName}: an independent ownership marker is required`,
    );
  }
  await withClient(
    repositoryRoot,
    administrationUrl,
    async (client) => {
      const inspectOwnership = () =>
        client.query(
          "SELECT oid::text AS database_id, shobj_description(oid, 'pg_database') AS owner_marker FROM pg_database WHERE datname = $1",
          [databaseName],
        );
      const ownership = await inspectOwnership();
      if (!ownership.rows.length) return;
      const databaseId = ownership.rows[0]?.database_id;
      if (ownership.rows[0]?.owner_marker !== expectedOwnershipMarker) {
        throw new Error(
          `refusing to drop ${databaseName}: ownership marker was not verified`,
        );
      }
      await client.query(
        "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
        [databaseName],
      );
      const confirmation = await inspectOwnership();
      if (
        confirmation.rows.length !== 1 ||
        confirmation.rows[0]?.database_id !== databaseId ||
        confirmation.rows[0]?.owner_marker !== expectedOwnershipMarker
      ) {
        throw new Error(
          `refusing to drop ${databaseName}: database identity or ownership marker changed during cleanup`,
        );
      }
      await client.query(`DROP DATABASE "${databaseName}"`);
    },
    { signal },
  );
}

export async function queryDatabase(
  repositoryRoot,
  databaseUrl,
  text,
  values = [],
  options = {},
) {
  return withVerifiedPostgresClient(
    repositoryRoot,
    databaseUrl,
    async (client) => {
      const result = await client.query(text, values);
      return result.rows;
    },
    options,
  );
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

async function waitForAdministration(
  repositoryRoot,
  administrationUrl,
  deadlineMs = 30_000,
  signal,
) {
  const deadline = Date.now() + deadlineMs;
  let lastError;
  while (Date.now() < deadline) {
    if (signal?.aborted) throw signal.reason;
    try {
      await validateAdministrationDatabase(repositoryRoot, administrationUrl, {
        signal,
      });
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
  signal,
  cleanupSignal,
  lifecycle,
  commandRunner = runCommand,
  portFinder = findFreeLoopbackPort,
  waitForAdministrationFn = waitForAdministration,
  acquisitionCleanupSignal = () => AbortSignal.timeout(60_000),
  ownershipNonce = randomUUID(),
}) {
  if (environment.MIGRATION_TEST_ADMIN_URL) {
    const resourceId = "administration";
    await lifecycle?.acquiring?.({
      id: resourceId,
      type: "external-administration",
      owned: false,
      identity: { source: "supplied-loopback-administration-url" },
      recovery: "The supplied PostgreSQL administration service is not owned by the gate.",
    });
    try {
      if (signal?.aborted) throw signal.reason;
      await validateAdministrationDatabase(
        repositoryRoot,
        environment.MIGRATION_TEST_ADMIN_URL,
        { signal },
      );
      await lifecycle?.acquired?.(resourceId);
      return {
        administrationUrl: environment.MIGRATION_TEST_ADMIN_URL,
        source: "supplied-loopback-administration-url",
        cleanup: async () => {},
      };
    } catch (error) {
      let journalError;
      try {
        await lifecycle?.cleanupFinished?.(resourceId, {
          status: "not-owned",
          error,
        });
      } catch (recordError) {
        journalError = recordError;
      }
      throw combinePrimaryAndCleanupError(
        error,
        journalError,
        "external PostgreSQL administration journal",
      );
    }
  }

  const image = "postgres:15-alpine";
  const dockerInspectionEnvironment = Object.fromEntries(
    ["PATH", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL", "HOME"].flatMap(
      (key) => environment[key] === undefined ? [] : [[key, environment[key]]],
    ),
  );
  let inspectedEndpoint;
  if (environment.DOCKER_HOST) {
    inspectedEndpoint = environment.DOCKER_HOST;
    dockerInspectionEnvironment.DOCKER_HOST = environment.DOCKER_HOST;
  } else {
    dockerInspectionEnvironment.DOCKER_CONTEXT = "default";
    const context = await commandRunner(
      ["docker", "--context", "default", "context", "inspect", "default", "--format", "{{.Endpoints.docker.Host}}"],
      {
        cwd: repositoryRoot,
        env: dockerInspectionEnvironment,
        timeoutMs: 15_000,
        logPath: path.join(diagnosticsDirectory, "docker-context-inspect.log"),
        signal,
      },
    );
    inspectedEndpoint = context.outputTail
      .replace(/^\[stdout\]\s*/m, "")
      .trim();
  }
  const dockerRouting = resolveDockerRouting(environment, inspectedEndpoint);
  const dockerHome = path.join(diagnosticsDirectory, "docker-home");
  const dockerConfig = path.join(dockerHome, ".docker");
  await mkdir(dockerConfig, { recursive: true, mode: 0o700 });
  const dockerEnvironment = {
    ...Object.fromEntries(
      ["PATH", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL"].flatMap(
        (key) => environment[key] === undefined ? [] : [[key, environment[key]]],
      ),
    ),
    HOME: dockerHome,
    DOCKER_CONFIG: dockerConfig,
    DOCKER_HOST: dockerRouting.verifiedHost,
  };
  try {
    await commandRunner([...dockerRouting.commandPrefix, "image", "inspect", image], {
      cwd: repositoryRoot,
      env: dockerEnvironment,
      timeoutMs: 15_000,
      logPath: path.join(diagnosticsDirectory, "docker-image-inspect.log"),
      signal,
    });
  } catch (error) {
    if (signal?.aborted) throw signal.reason ?? error;
    throw new Error(
      `No MIGRATION_TEST_ADMIN_URL was supplied and cached ${image} is unavailable. Install that image explicitly or supply a loopback PostgreSQL administration URL; the gate never pulls images.`,
    );
  }

  const suffix = generateDatabaseName().replace(/^context_router_|_test$/g, "");
  const containerName = `lmbg-postgres-${suffix}`;
  const ownershipLabel = "context-router.local-migration-gate-owner";
  const expectedOwner = validateOwnershipNonce(ownershipNonce);
  const syntheticPassword = `lmbg-${suffix}`;
  const containerResourceId = "container";
  const removeContainer = async (
    logName = "docker-cleanup.log",
    boundedSignal = resolveCleanupSignal(cleanupSignal),
  ) => {
    let inspection;
    try {
      inspection = await commandRunner(
        [
          ...dockerRouting.commandPrefix,
          "container",
          "inspect",
          "--format",
          `{{.Id}} {{ index .Config.Labels "${ownershipLabel}" }}`,
          containerName,
        ],
        {
          cwd: repositoryRoot,
          env: dockerEnvironment,
          timeoutMs: 15_000,
          logPath: path.join(diagnosticsDirectory, `${logName}.inspect`),
          canaries: [syntheticPassword],
          signal: boundedSignal,
        },
      );
    } catch (error) {
      if (/No such (?:container|object)/i.test(error.outputTail ?? error.message)) {
        return;
      }
      throw error;
    }
    const [containerId, actualOwner, ...unexpected] = inspection.outputTail
      .replace(/^\[stdout\]\s*/m, "")
      .trim()
      .split(/\s+/);
    if (
      unexpected.length ||
      !/^[a-f0-9]{12,64}$/.test(containerId ?? "") ||
      actualOwner !== expectedOwner
    ) {
      throw new Error(
        `refusing to remove ${containerName}: ownership label mismatch`,
      );
    }
    await commandRunner(
      [...dockerRouting.commandPrefix, "rm", "--force", containerId],
      {
        cwd: repositoryRoot,
        env: dockerEnvironment,
        timeoutMs: 30_000,
        logPath: path.join(diagnosticsDirectory, logName),
        canaries: [syntheticPassword],
        signal: boundedSignal,
      },
    );
  };
  await lifecycle?.acquiring?.({
    id: containerResourceId,
    type: "local-administration-container",
    owned: true,
    identity: { name: containerName, ownershipNonce: expectedOwner },
    recovery: {
      inspectCommand: ["docker", "container", "inspect", containerName],
      instruction:
        "Verify the required ownership label, take the immutable container ID from that same inspection result, and remove only that ID.",
      environment: { DOCKER_HOST: dockerRouting.verifiedHost },
      requiredLabel: `${ownershipLabel}=${expectedOwner}`,
    },
  });
  let port;
  let startError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    port = await portFinder();
    try {
      await commandRunner(
        [
          ...dockerRouting.commandPrefix,
          "run",
          "--pull=never",
          "--detach",
          "--rm",
          "--name",
          containerName,
          "--label",
          `${ownershipLabel}=${expectedOwner}`,
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
          env: dockerEnvironment,
          timeoutMs: 30_000,
          logPath: path.join(
            diagnosticsDirectory,
            `docker-start-${attempt}.log`,
          ),
          canaries: [syntheticPassword],
          signal,
        },
      );
      startError = null;
      break;
    } catch (error) {
      const retryableCollision =
        !signal?.aborted &&
        attempt < 3 &&
        /(?:port is already allocated|address already in use|bind:)/i.test(
          error.outputTail ?? error.message,
        );
      let cleanupError;
      try {
        await removeContainer(
          `docker-start-${attempt}-cleanup.log`,
          retryableCollision
            ? resolveCleanupSignal(acquisitionCleanupSignal)
            : resolveCleanupSignal(cleanupSignal),
        );
      } catch (removeError) {
        cleanupError = removeError;
      }
      const combined = combinePrimaryAndCleanupError(
        error,
        cleanupError,
        `container ${containerName}`,
      );
      if (retryableCollision && !cleanupError) {
        startError = combined;
        continue;
      }
      let journalError;
      try {
        await lifecycle?.cleanupFinished?.(containerResourceId, {
          status: cleanupError ? "failed" : "removed",
          error: cleanupError,
        });
      } catch (error) {
        journalError = error;
      }
      throw combinePrimaryAndCleanupError(
        combined,
        journalError,
        `container ${containerName} journal`,
      );
    }
  }
  if (startError) throw startError;
  const administrationUrl = `postgresql://postgres:${encodeURIComponent(syntheticPassword)}@127.0.0.1:${port}/postgres`;
  try {
    await lifecycle?.acquired?.(containerResourceId);
    await waitForAdministrationFn(
      repositoryRoot,
      administrationUrl,
      30_000,
      signal,
    );
  } catch (error) {
    let cleanupError;
    try {
      await removeContainer();
    } catch (removeError) {
      cleanupError = removeError;
    }
    let journalError;
    try {
      await lifecycle?.cleanupFinished?.(containerResourceId, {
        status: cleanupError ? "failed" : "removed",
        error: cleanupError,
      });
    } catch (recordError) {
      journalError = recordError;
    }
    const combined = combinePrimaryAndCleanupError(
      error,
      cleanupError,
      `container ${containerName}`,
    );
    throw combinePrimaryAndCleanupError(
      combined,
      journalError,
      `container ${containerName} journal`,
    );
  }

  return {
    administrationUrl,
    source: "created-loopback-container",
    containerName,
    recovery: {
      inspectCommand: ["docker", "container", "inspect", containerName],
      instruction:
        "Verify the recorded ownership label, take the immutable container ID from that same inspection result, and remove only that ID.",
      environment: { DOCKER_HOST: dockerRouting.verifiedHost },
      requiredLabel: `${ownershipLabel}=${expectedOwner}`,
    },
    cleanup: async ({ signal: boundedSignal } = {}) => {
      if (!/^lmbg-postgres-[a-f0-9]{24}$/.test(containerName)) {
        throw new Error("refusing to clean an unexpected PostgreSQL container name");
      }
      await removeContainer(
        "docker-cleanup.log",
        boundedSignal ?? resolveCleanupSignal(cleanupSignal),
      );
    },
  };
}

export function resolveDockerRouting(environment, inspectedEndpoint) {
  if (
    environment.DOCKER_CONTEXT &&
    environment.DOCKER_CONTEXT !== "default"
  ) {
    throw new Error("automatic fallback requires a local Unix-socket Docker daemon and the default context");
  }
  const explicitHost = environment.DOCKER_HOST ?? null;
  let parsed;
  try {
    parsed = new URL(inspectedEndpoint);
  } catch {
    throw new Error("automatic fallback requires a local Unix-socket Docker daemon");
  }
  if (
    parsed.protocol !== "unix:" ||
    !path.isAbsolute(decodeURIComponent(parsed.pathname)) ||
    (explicitHost && explicitHost !== inspectedEndpoint)
  ) {
    throw new Error("automatic fallback requires a local Unix-socket Docker daemon");
  }
  return {
    commandPrefix: ["docker"],
    explicitHost,
    verifiedHost: inspectedEndpoint,
  };
}
