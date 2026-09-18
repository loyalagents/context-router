import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createIsolatedTestDatabase,
  dropIsolatedTestDatabase,
  prepareTestAdministration,
  resolveDockerRouting,
  withVerifiedPostgresClient,
} from "./test-database.mjs";

function fakeClient(remoteAddress) {
  return {
    connection: { stream: { remoteAddress, destroy() {} } },
    connected: false,
    ended: false,
    async connect() {
      this.connected = true;
    },
    async end() {
      this.ended = true;
    },
  };
}

test("PostgreSQL peer verification and admin callback share the exact connected client", async () => {
  const client = fakeClient("127.0.0.1");
  let creations = 0;
  const returned = await withVerifiedPostgresClient(
    "/repository",
    "postgresql://admin:secret@db.local:5432/postgres",
    async (verifiedClient) => {
      assert.equal(verifiedClient, client);
      assert.equal(verifiedClient.connected, true);
      return "written";
    },
    {
      createClient: (config) => {
        creations += 1;
        assert.equal(
          new URL(config.connectionString).hostname,
          "127.0.0.1",
        );
        return client;
      },
      lookup: async () => [{ address: "127.0.0.1", family: 4 }],
    },
  );
  assert.equal(returned, "written");
  assert.equal(creations, 1);
  assert.equal(client.ended, true);
});

test("same-connection verification rejects a rebound remote peer before the write callback", async () => {
  const client = fakeClient("203.0.113.9");
  let callbackRan = false;
  await assert.rejects(
    withVerifiedPostgresClient(
      "/repository",
      "postgresql://admin:secret@db.local:5432/postgres",
      async () => {
        callbackRan = true;
      },
      {
        createClient: () => client,
        lookup: async () => [{ address: "127.0.0.1", family: 4 }],
      },
    ),
    /connected PostgreSQL peer is not loopback/,
  );
  assert.equal(callbackRan, false);
});

test("DNS preflight rejects mixed or remote answers before constructing a PostgreSQL client", async () => {
  let clientCreations = 0;
  for (const addresses of [
    [{ address: "203.0.113.9", family: 4 }],
    [
      { address: "127.0.0.1", family: 4 },
      { address: "203.0.113.9", family: 4 },
    ],
  ]) {
    await assert.rejects(
      withVerifiedPostgresClient(
        "/repository",
        "postgresql://admin:secret@db.invalid:5432/postgres",
        async () => undefined,
        {
          createClient: () => {
            clientCreations += 1;
            return fakeClient("127.0.0.1");
          },
          lookup: async () => addresses,
        },
      ),
      /non-loopback DNS address/,
    );
  }
  assert.equal(clientCreations, 0);
});

test("duplicate PostgreSQL routing parameters are rejected before a client can receive credentials", async () => {
  let clientCreations = 0;
  await assert.rejects(
    withVerifiedPostgresClient(
      "/repository",
      "postgresql://admin:secret@localhost/postgres?host=%2Ftmp%2Fsafe.sock&host=remote.example",
      async () => undefined,
      {
        createClient: () => {
          clientCreations += 1;
          return fakeClient(null);
        },
      },
    ),
    /duplicate PostgreSQL host parameter/,
  );
  assert.equal(clientCreations, 0);
});

test("a pre-aborted database operation starts neither connect nor query", async () => {
  const controller = new AbortController();
  controller.abort(new Error("received SIGTERM"));
  let connects = 0;
  let callbacks = 0;
  const client = fakeClient("127.0.0.1");
  client.connect = async () => {
    connects += 1;
  };
  await assert.rejects(
    withVerifiedPostgresClient(
      "/repository",
      "postgresql://admin:secret@127.0.0.1:5432/postgres",
      async () => {
        callbacks += 1;
      },
      { createClient: () => client, signal: controller.signal },
    ),
    /received SIGTERM/,
  );
  assert.equal(connects, 0);
  assert.equal(callbacks, 0);
});

test("PostgreSQL cleanup is bounded and preserves the primary failure", async () => {
  const rejectingEnd = fakeClient("127.0.0.1");
  rejectingEnd.end = async () => {
    throw new Error("end failed");
  };
  await assert.rejects(
    withVerifiedPostgresClient(
      "/repository",
      "postgresql://admin:secret@127.0.0.1:5432/postgres",
      async () => {
        throw new Error("query failed");
      },
      { createClient: () => rejectingEnd },
    ),
    (error) => {
      assert.match(error.message, /query failed/);
      assert.match(error.message, /end failed/);
      return true;
    },
  );

  const hangingEnd = fakeClient("127.0.0.1");
  let destroyed = false;
  hangingEnd.connection.stream.destroy = () => {
    destroyed = true;
  };
  hangingEnd.end = () => new Promise(() => {});
  await assert.rejects(
    withVerifiedPostgresClient(
      "/repository",
      "postgresql://admin:secret@127.0.0.1:5432/postgres",
      async () => "done",
      { createClient: () => hangingEnd, endTimeoutMs: 10 },
    ),
    /did not close within 10ms/,
  );
  assert.equal(destroyed, true);
});

test("verified ambiguous CREATE DATABASE failure attempts exact idempotent cleanup", async () => {
  const calls = [];
  const ownershipNonce = "01234567-89ab-4cde-8fab-0123456789ab";
  const expectedMarker = `context-router-lmbg-owner:${ownershipNonce}`;
  const cleanupController = new AbortController();
  await assert.rejects(
    createIsolatedTestDatabase(
      "/repository",
      "postgresql://admin:secret@127.0.0.1:5432/postgres",
      {
        withClient: async (_root, _url, callback) => {
          await callback({
            async query(sql) {
              calls.push(sql);
              throw new Error("connection reset after create");
            },
          });
        },
        ownershipNonce,
        cleanupSignal: () => cleanupController.signal,
        dropDatabase: async (_root, _url, databaseName, options) => {
          assert.equal(options.expectedOwnershipMarker, expectedMarker);
          assert.equal(options.signal, cleanupController.signal);
          calls.push(`DROP:${databaseName}`);
          throw new Error("drop confirmation failed");
        },
        verifyOwnership: async (_root, _url, _databaseName, marker, options) => {
          assert.equal(marker, expectedMarker);
          assert.equal(options.signal, cleanupController.signal);
          return true;
        },
      },
    ),
    (error) => {
      assert.match(error.message, /connection reset after create/);
      assert.match(error.message, /drop confirmation failed/);
      return true;
    },
  );
  assert.match(calls[0], /^CREATE DATABASE "context_router_[a-f0-9]{24}_test"$/);
  assert.match(calls[1], /^DROP:context_router_[a-f0-9]{24}_test$/);
});

test("database creation journals and persists an independent ownership nonce", async () => {
  const ownershipNonce = "01234567-89ab-4cde-8fab-0123456789ab";
  const expectedMarker = `context-router-lmbg-owner:${ownershipNonce}`;
  const statements = [];
  let lifecycleRecord;
  let acquiredId;
  const result = await createIsolatedTestDatabase(
    "/repository",
    "postgresql://admin:secret@127.0.0.1:5432/postgres",
    {
      ownershipNonce,
      lifecycle: {
        async acquiring(record) {
          lifecycleRecord = record;
        },
        async acquired(id) {
          acquiredId = id;
        },
      },
      withClient: async (_root, url, callback) =>
        callback({
          async query(sql) {
            statements.push(sql);
            if (sql.includes("current_database")) {
              return {
                rows: [
                  {
                    current_database: new URL(url).pathname.slice(1),
                  },
                ],
              };
            }
            return { rows: [] };
          },
        }),
    },
  );
  assert.equal(result.ownershipMarker, expectedMarker);
  assert.equal(lifecycleRecord.identity.ownershipMarker, expectedMarker);
  assert.match(lifecycleRecord.recovery, new RegExp(expectedMarker));
  assert.equal(acquiredId, "database");
  assert.equal(
    statements.some((sql) =>
      sql.includes(`COMMENT ON DATABASE "${result.databaseName}" IS '${expectedMarker}'`),
    ),
    true,
  );
});

test("database name conflicts and unverified ambiguous outcomes are never dropped", async () => {
  for (const createError of [
    Object.assign(new Error("database already exists"), { code: "42P04" }),
    new Error("connection reset after create"),
  ]) {
    let drops = 0;
    await assert.rejects(
      createIsolatedTestDatabase(
        "/repository",
        "postgresql://admin:secret@127.0.0.1:5432/postgres",
        {
          withClient: async (_root, _url, callback) =>
            callback({
              async query() {
                throw createError;
              },
            }),
          verifyOwnership: async () => false,
          dropDatabase: async () => {
            drops += 1;
          },
        },
      ),
      (error) => {
        assert.match(error.message, /already exists|connection reset/);
        return true;
      },
    );
    assert.equal(drops, 0);
  }
});

test("a 42P04 conflict remains non-owned when PostgreSQL client cleanup also fails", async () => {
  const client = fakeClient("127.0.0.1");
  client.end = async () => {
    throw new Error("client close failed");
  };
  let wrappedConflict;
  try {
    await withVerifiedPostgresClient(
      "/repository",
      "postgresql://admin:secret@127.0.0.1:5432/postgres",
      async () => {
        throw Object.assign(new Error("database already exists"), {
          code: "42P04",
        });
      },
      { createClient: () => client },
    );
  } catch (error) {
    wrappedConflict = error;
  }
  assert.equal(wrappedConflict.code, "42P04");
  let ownershipChecks = 0;
  let drops = 0;
  await assert.rejects(
    createIsolatedTestDatabase(
      "/repository",
      "postgresql://admin:secret@127.0.0.1:5432/postgres",
      {
        withClient: async () => {
          throw wrappedConflict;
        },
        verifyOwnership: async () => {
          ownershipChecks += 1;
          return true;
        },
        dropDatabase: async () => {
          drops += 1;
        },
      },
    ),
    /already exists.*client close failed/,
  );
  assert.equal(ownershipChecks, 0);
  assert.equal(drops, 0);
});

test("normal database cleanup re-verifies the exact ownership comment before dropping", async () => {
  const databaseName = "context_router_0123456789abcdef01234567_test";
  const expectedMarker =
    "context-router-lmbg-owner:01234567-89ab-4cde-8fab-0123456789ab";
  for (const [rows, shouldDrop] of [
    [[], false],
    [[{ database_id: "123", owner_marker: "different-owner" }], false],
    [[{ database_id: "123", owner_marker: expectedMarker }], true],
  ]) {
    const statements = [];
    const operation = dropIsolatedTestDatabase(
      "/repository",
      "postgresql://admin:secret@127.0.0.1:5432/postgres",
      databaseName,
      {
        expectedOwnershipMarker: expectedMarker,
        withClient: async (_root, _url, callback) =>
          callback({
            async query(sql, values) {
              statements.push({ sql, values });
              if (sql.includes("shobj_description")) return { rows };
              return { rows: [] };
            },
          }),
      },
    );
    if (rows[0]?.owner_marker && !shouldDrop) {
      await assert.rejects(operation, /ownership marker was not verified/);
    } else {
      await operation;
    }
    assert.equal(
      statements.some(({ sql }) => sql.startsWith("DROP DATABASE")),
      shouldDrop,
    );
    assert.equal(
      statements.some(({ sql }) => sql.includes("pg_terminate_backend")),
      shouldDrop,
    );
  }
});

test("database cleanup forwards its bounded cleanup signal to the verified client", async () => {
  const databaseName = "context_router_0123456789abcdef01234567_test";
  const expectedMarker =
    "context-router-lmbg-owner:01234567-89ab-4cde-8fab-0123456789ab";
  const controller = new AbortController();
  let observedOptions;
  await dropIsolatedTestDatabase(
    "/repository",
    "postgresql://admin:secret@127.0.0.1:5432/postgres",
    databaseName,
    {
      expectedOwnershipMarker: expectedMarker,
      signal: controller.signal,
      withClient: async (_root, _url, callback, options) => {
        observedOptions = options;
        let inspection = 0;
        return callback({
          async query(sql) {
            if (sql.includes("shobj_description")) {
              inspection += 1;
              return {
                rows: [{ database_id: "123", owner_marker: expectedMarker }],
              };
            }
            return { rows: [] };
          },
        });
      },
    },
  );
  assert.equal(observedOptions.signal, controller.signal);
});

test("database cleanup refuses a marker or database identity change before DROP", async () => {
  const databaseName = "context_router_0123456789abcdef01234567_test";
  const expectedOwnershipMarker =
    "context-router-lmbg-owner:01234567-89ab-4cde-8fab-0123456789ab";
  for (const confirmation of [
    { database_id: "123", owner_marker: "changed-owner" },
    { database_id: "456", owner_marker: expectedOwnershipMarker },
  ]) {
    let inspections = 0;
    let dropped = false;
    await assert.rejects(
      dropIsolatedTestDatabase(
        "/repository",
        "postgresql://admin:secret@127.0.0.1:5432/postgres",
        databaseName,
        {
          expectedOwnershipMarker,
          withClient: async (_root, _url, callback) =>
            callback({
              async query(sql) {
                if (sql.includes("shobj_description")) {
                  inspections += 1;
                  return {
                    rows: [
                      inspections === 1
                        ? {
                            database_id: "123",
                            owner_marker: expectedOwnershipMarker,
                          }
                        : confirmation,
                    ],
                  };
                }
                if (sql.startsWith("DROP DATABASE")) dropped = true;
                return { rows: [] };
              },
            }),
        },
      ),
      /identity or ownership marker changed/,
    );
    assert.equal(dropped, false);
  }
});

test("automatic Docker fallback accepts only a verified local daemon route", () => {
  assert.deepEqual(
    resolveDockerRouting({}, "unix:///var/run/docker.sock"),
    {
      commandPrefix: ["docker"],
      explicitHost: null,
      verifiedHost: "unix:///var/run/docker.sock",
    },
  );
  assert.deepEqual(
    resolveDockerRouting(
      { DOCKER_HOST: "unix:///Users/test/.docker/run/docker.sock" },
      "unix:///Users/test/.docker/run/docker.sock",
    ),
    {
      commandPrefix: ["docker"],
      explicitHost: "unix:///Users/test/.docker/run/docker.sock",
      verifiedHost: "unix:///Users/test/.docker/run/docker.sock",
    },
  );
  for (const [environment, endpoint] of [
    [{ DOCKER_HOST: "tcp://docker.example.test:2376" }, "tcp://docker.example.test:2376"],
    [{ DOCKER_HOST: "ssh://builder@example.test" }, "ssh://builder@example.test"],
    [{ DOCKER_CONTEXT: "remote-builder" }, "unix:///var/run/docker.sock"],
    [{}, "tcp://127.0.0.1:2375"],
  ]) {
    assert.throws(
      () => resolveDockerRouting(environment, endpoint),
      /local Unix-socket Docker daemon/,
    );
  }
});

test("Docker fallback uses an isolated config and cleans ambiguous container starts", async () => {
  const diagnostics = await mkdtemp(path.join(os.tmpdir(), "lmbg-docker-test-"));
  const calls = [];
  const ownershipNonce = "01234567-89ab-4cde-8fab-0123456789ab";
  const verifiedContainerId = "a".repeat(64);
  const cleanupController = new AbortController();
  const commandRunner = async (argv, options) => {
    calls.push({ argv, env: options.env, signal: options.signal });
    if (argv.includes("run")) {
      const error = new Error("daemon connection reset after container start");
      error.outputTail = "daemon connection reset after container start";
      throw error;
    }
    if (argv.includes("container") && argv.includes("inspect")) {
      return { outputTail: `${verifiedContainerId} ${ownershipNonce}` };
    }
    return { outputTail: "" };
  };
  try {
    await assert.rejects(
      prepareTestAdministration({
        repositoryRoot: "/repository",
        diagnosticsDirectory: diagnostics,
        environment: {
          PATH: "/bin",
          HOME: "/host/home",
          DOCKER_HOST: "unix:///var/run/docker.sock",
        },
        commandRunner,
        portFinder: async () => 54321,
        ownershipNonce,
        cleanupSignal: () => cleanupController.signal,
      }),
      /connection reset after container start/,
    );
    const executionCalls = calls.filter(({ argv }) =>
      argv.some((item) => ["image", "run", "rm"].includes(item)),
    );
    assert.equal(executionCalls.some(({ argv }) => argv.includes("rm")), true);
    assert.equal(
      executionCalls
        .filter(({ argv }) => argv.includes("rm"))
        .every(({ argv }) => argv.at(-1) === verifiedContainerId),
      true,
    );
    const inspectCall = calls.find(
      ({ argv }) => argv.includes("container") && argv.includes("inspect"),
    );
    assert.ok(inspectCall);
    assert.equal(
      inspectCall.argv.filter((argument) => argument === "--format").length,
      1,
    );
    assert.deepEqual(inspectCall.argv.slice(0, 5), [
      "docker",
      "container",
      "inspect",
      "--format",
      '{{.Id}} {{ index .Config.Labels "context-router.local-migration-gate-owner" }}',
    ]);
    assert.equal(inspectCall.signal, cleanupController.signal);
    assert.equal(
      calls.find(({ argv }) => argv.includes("rm")).signal,
      cleanupController.signal,
    );
    for (const { env } of executionCalls) {
      assert.notEqual(env.HOME, "/host/home");
      assert.equal(env.DOCKER_HOST, "unix:///var/run/docker.sock");
      assert.ok(env.DOCKER_CONFIG.startsWith(diagnostics));
    }
  } finally {
    await rm(diagnostics, { recursive: true, force: true });
  }
});

test("retryable Docker port cleanup does not consume final gate cleanup", async () => {
  const diagnostics = await mkdtemp(path.join(os.tmpdir(), "lmbg-docker-retry-test-"));
  const ownershipNonce = "11234567-89ab-4cde-8fab-0123456789ab";
  const verifiedContainerId = "b".repeat(64);
  const acquisitionController = new AbortController();
  const finalController = new AbortController();
  const calls = [];
  let runAttempts = 0;
  let acquisitionSignals = 0;
  let finalSignals = 0;
  const commandRunner = async (argv, options) => {
    calls.push({ argv, signal: options.signal });
    if (argv.includes("run")) {
      runAttempts += 1;
      if (runAttempts === 1) {
        const error = new Error("port is already allocated");
        error.outputTail = "port is already allocated";
        throw error;
      }
      return { outputTail: verifiedContainerId };
    }
    if (argv.includes("container") && argv.includes("inspect")) {
      return { outputTail: `${verifiedContainerId} ${ownershipNonce}` };
    }
    return { outputTail: "" };
  };
  try {
    const administration = await prepareTestAdministration({
      repositoryRoot: "/repository",
      diagnosticsDirectory: diagnostics,
      environment: {
        PATH: "/bin",
        DOCKER_HOST: "unix:///var/run/docker.sock",
      },
      commandRunner,
      portFinder: async () => 54321 + runAttempts,
      waitForAdministrationFn: async () => {},
      ownershipNonce,
      acquisitionCleanupSignal: () => {
        acquisitionSignals += 1;
        return acquisitionController.signal;
      },
      cleanupSignal: () => {
        finalSignals += 1;
        return finalController.signal;
      },
    });
    assert.equal(runAttempts, 2);
    assert.equal(acquisitionSignals, 1);
    assert.equal(finalSignals, 0);
    const retryCleanup = calls.filter(({ argv }) => argv.includes("rm"));
    assert.equal(retryCleanup.length, 1);
    assert.equal(retryCleanup[0].signal, acquisitionController.signal);

    await administration.cleanup();
    assert.equal(finalSignals, 1);
    assert.equal(calls.filter(({ argv }) => argv.includes("rm")).at(-1).signal, finalController.signal);
  } finally {
    await rm(diagnostics, { recursive: true, force: true });
  }
});

test("Docker cleanup refuses a same-name container with a different ownership label", async () => {
  const diagnostics = await mkdtemp(path.join(os.tmpdir(), "lmbg-docker-owner-test-"));
  const calls = [];
  const commandRunner = async (argv) => {
    calls.push(argv);
    if (argv.includes("run")) {
      const error = new Error("daemon connection reset after container start");
      error.outputTail = error.message;
      throw error;
    }
    if (argv.includes("container") && argv.includes("inspect")) {
      return { outputTail: `${"b".repeat(64)} different-owner` };
    }
    return { outputTail: "" };
  };
  try {
    await assert.rejects(
      prepareTestAdministration({
        repositoryRoot: "/repository",
        diagnosticsDirectory: diagnostics,
        environment: {
          PATH: "/bin",
          DOCKER_HOST: "unix:///var/run/docker.sock",
        },
        commandRunner,
        portFinder: async () => 54321,
        ownershipNonce: "01234567-89ab-4cde-8fab-0123456789ab",
      }),
      /ownership label mismatch/,
    );
    assert.equal(calls.some((argv) => argv.includes("rm")), false);
  } finally {
    await rm(diagnostics, { recursive: true, force: true });
  }
});
