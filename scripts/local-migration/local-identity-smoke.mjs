import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  readdir,
  readlink,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import {
  combineFailures,
  hasLiveProcessGroupMembers,
  runCommand,
} from "./gate-runner.mjs";
import {
  queryDatabase,
  resolveDockerRouting,
} from "./test-database.mjs";

const PREVIEW_READINESS =
  '{"type":"context-router.local-identity.preview.ready","version":1}\n';
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const MAX_CAPTURE_BYTES = 16_384;
const JOURNALED_NODE_GATE_SOURCE = `
"use strict";
const entrypoint = process.argv[1];
const operation = process.argv[2];
const fail = () => process.exit(70);
const timer = setTimeout(fail, 30_000);
const onDisconnect = () => {
  clearTimeout(timer);
  fail();
};
process.once("disconnect", onDisconnect);
process.once("message", (message) => {
  if (
    message?.type !== "context-router.local-identity-smoke.start" ||
    message?.version !== 1 ||
    Object.keys(message).length !== 2
  ) {
    fail();
    return;
  }
  clearTimeout(timer);
  process.send(
    {
      type: "context-router.local-identity-smoke.accepted",
      version: 1,
    },
    (acknowledgementError) => {
      if (acknowledgementError) {
        fail();
        return;
      }
      let run;
      try {
        ({ runLocalIdentityEntrypoint: run } = require(entrypoint));
      } catch {
        fail();
        return;
      }
      if (typeof run !== "function") {
        fail();
        return;
      }
      Promise.resolve(run({ argv: [operation] })).then(
        (code) => {
          if (!Number.isSafeInteger(code)) {
            fail();
            return;
          }
          process.exitCode = code;
          process.removeListener("disconnect", onDisconnect);
          if (process.connected) process.disconnect();
        },
        fail,
      );
    },
  );
});
if (!process.connected) {
  onDisconnect();
} else {
  process.send(
    {
      type: "context-router.local-identity-smoke.waiting",
      version: 1,
    },
    (waitingError) => {
      if (waitingError) fail();
    },
  );
}
`;

function fixedError(message) {
  return new Error(message);
}

function exactMode(stats, mode) {
  return (stats.mode & 0o7777) === mode;
}

function assertCanonicalToken(value) {
  if (!TOKEN_PATTERN.test(value)) return false;
  const bytes = Buffer.from(value, "base64url");
  return bytes.byteLength === 32 && bytes.toString("base64url") === value;
}

export function decodeSmokeIdentityState(bytes) {
  try {
    if (!Buffer.isBuffer(bytes) || bytes.byteLength > 4_096) throw new Error();
    const text = bytes.toString("utf8");
    if (!text.endsWith("\n") || text.slice(0, -1).includes("\n")) {
      throw new Error();
    }
    const state = JSON.parse(text);
    const expectedKeys = [
      "schemaVersion",
      "databaseTargetId",
      "principalId",
      "credential",
      "generation",
    ];
    if (
      !state ||
      typeof state !== "object" ||
      Array.isArray(state) ||
      JSON.stringify(Object.keys(state)) !== JSON.stringify(expectedKeys) ||
      state.schemaVersion !== 1 ||
      !assertCanonicalToken(state.databaseTargetId) ||
      !assertCanonicalToken(state.principalId) ||
      !assertCanonicalToken(state.credential) ||
      !Number.isSafeInteger(state.generation) ||
      state.generation < 1 ||
      text !== `${JSON.stringify(state)}\n`
    ) {
      throw new Error();
    }
    return state;
  } catch {
    throw fixedError("invalid canonical local identity state");
  }
}

export function parseLocalIdentityPreviewReadiness(value) {
  if (`${value}\n`.replace(/\n\n$/u, "\n") !== PREVIEW_READINESS) {
    throw fixedError("invalid local identity preview readiness");
  }
  let parsed;
  try {
    parsed = JSON.parse(String(value).trimEnd());
  } catch {
    throw fixedError("invalid local identity preview readiness");
  }
  if (
    Object.keys(parsed).length !== 2 ||
    parsed.type !== "context-router.local-identity.preview.ready" ||
    parsed.version !== 1
  ) {
    throw fixedError("invalid local identity preview readiness");
  }
  return true;
}

export function listeningSocketInodesFromProc(tables) {
  const result = new Set();
  for (const table of tables) {
    for (const line of String(table).split(/\r?\n/u).slice(1)) {
      const columns = line.trim().split(/\s+/u);
      if (columns.length >= 10 && columns[3] === "0A" && /^\d+$/u.test(columns[9])) {
        result.add(columns[9]);
      }
    }
  }
  return result;
}

export function buildLocalIdentitySmokeEnvironment(
  sourceEnvironment,
  { home, temporaryDirectory, stateRoot, databaseUrl, caPem },
) {
  return {
    ...Object.fromEntries(
      ["PATH", "LANG", "LC_ALL", "TZ"].flatMap((key) =>
        sourceEnvironment[key] === undefined
          ? []
          : [[key, sourceEnvironment[key]]],
      ),
    ),
    HOME: home,
    TMPDIR: temporaryDirectory,
    TMP: temporaryDirectory,
    TEMP: temporaryDirectory,
    NODE_ENV: "production",
    LOCAL_IDENTITY_STATE_ROOT: stateRoot,
    DATABASE_URL: databaseUrl,
    LOCAL_DATABASE_TLS_CA_PEM: caPem,
    AUTH0_ISSUER: "local-smoke-auth0-canary.invalid",
    GCP_PROJECT_ID: "local-smoke-cloud-canary",
    NODE_PG_FORCE_NATIVE: "1",
    PGBINARY: "1",
  };
}

export function buildListenerInspectionEnvironment(sourceEnvironment) {
  return Object.fromEntries(
    ["LANG", "LC_ALL", "TZ"].flatMap((key) =>
      sourceEnvironment[key] === undefined
        ? []
        : [[key, sourceEnvironment[key]]],
    ),
  );
}

function commandStdout(outputTail) {
  return String(outputTail ?? "")
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => line.replace(/^\[stdout\]\s?/u, ""))
    .filter((line) => !line.startsWith("[stderr]"))
    .join("\n")
    .trim();
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

async function waitForDatabase(
  repositoryRoot,
  databaseUrl,
  query,
  signal,
  timeoutMs = 30_000,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (signal?.aborted) throw signal.reason ?? fixedError("local identity smoke aborted");
    try {
      await query(repositoryRoot, databaseUrl, "SELECT 1 AS ready", [], {
        signal,
      });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw fixedError("local identity TLS PostgreSQL did not become ready");
}

async function prepareLocalIdentityTlsPostgres({
  repositoryRoot,
  diagnosticsDirectory,
  environment,
  tlsDirectory,
  serverKey,
  serverCertificate,
  journal,
  registerCanary,
  signal,
  commandRunner,
  query,
  portFinder = findFreeLoopbackPort,
}) {
  const resourceId = "local-identity-postgres";
  const ownershipNonce = randomUUID().toLowerCase();
  const suffix = randomBytes(12).toString("hex");
  const containerName = `lmid-pg-${suffix}`;
  const ownershipLabel = "context-router.local-identity-smoke-owner";
  const password = `lmid-${randomBytes(24).toString("base64url")}`;
  registerCanary(password);
  registerCanary(encodeURIComponent(password));

  await mkdir(tlsDirectory, { mode: 0o700 });
  await Promise.all([
    writeFile(path.join(tlsDirectory, "server.key"), serverKey, { mode: 0o600 }),
    writeFile(path.join(tlsDirectory, "server.crt"), serverCertificate, { mode: 0o600 }),
  ]);
  for (const basename of ["server.key", "server.crt"]) {
    const info = await lstat(path.join(tlsDirectory, basename));
    if (!info.isFile() || info.isSymbolicLink() || !exactMode(info, 0o600)) {
      throw fixedError("invalid local identity TLS material");
    }
  }

  const inspectionEnvironment = Object.fromEntries(
    ["PATH", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL", "HOME"].flatMap(
      (key) => environment[key] === undefined ? [] : [[key, environment[key]]],
    ),
  );
  let inspectedEndpoint;
  if (environment.DOCKER_HOST) {
    inspectedEndpoint = environment.DOCKER_HOST;
    inspectionEnvironment.DOCKER_HOST = environment.DOCKER_HOST;
  } else {
    inspectionEnvironment.DOCKER_CONTEXT = "default";
    const context = await commandRunner(
      [
        "docker",
        "--context",
        "default",
        "context",
        "inspect",
        "default",
        "--format",
        "{{.Endpoints.docker.Host}}",
      ],
      {
        cwd: repositoryRoot,
        env: inspectionEnvironment,
        timeoutMs: 15_000,
        logPath: path.join(diagnosticsDirectory, "local-identity-docker-context.log"),
        signal,
      },
    );
    inspectedEndpoint = commandStdout(context.outputTail);
  }
  const routing = resolveDockerRouting(environment, inspectedEndpoint);
  const dockerHome = path.join(diagnosticsDirectory, "local-identity-docker-home");
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
    DOCKER_HOST: routing.verifiedHost,
  };
  const image = "postgres:15-alpine";
  try {
    await commandRunner([...routing.commandPrefix, "image", "inspect", image], {
      cwd: repositoryRoot,
      env: dockerEnvironment,
      timeoutMs: 15_000,
      logPath: path.join(diagnosticsDirectory, "local-identity-docker-image.log"),
      signal,
    });
  } catch {
    throw fixedError(
      `cached ${image} is required for the local identity TLS smoke`,
    );
  }

  const removeContainer = async (logName, cleanupSignal) => {
    let inspection;
    try {
      inspection = await commandRunner(
        [
          ...routing.commandPrefix,
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
          canaries: [password],
          signal: cleanupSignal,
        },
      );
    } catch (error) {
      if (/No such (?:container|object)/iu.test(error.outputTail ?? error.message)) return;
      throw error;
    }
    const [containerId, actualOwner, ...unexpected] = commandStdout(
      inspection.outputTail,
    ).split(/\s+/u);
    if (
      unexpected.length ||
      !/^[a-f0-9]{12,64}$/u.test(containerId ?? "") ||
      actualOwner !== ownershipNonce
    ) {
      throw fixedError("refusing local identity PostgreSQL cleanup: ownership mismatch");
    }
    await commandRunner(
      [...routing.commandPrefix, "rm", "--force", containerId],
      {
        cwd: repositoryRoot,
        env: dockerEnvironment,
        timeoutMs: 30_000,
        logPath: path.join(diagnosticsDirectory, logName),
        canaries: [password],
        signal: cleanupSignal,
      },
    );
  };

  await journal.acquiring({
    id: resourceId,
    type: "local-identity-tls-postgres-container",
    owned: true,
    identity: { ownerPid: process.pid, fixture: "fresh-native-tls-database" },
    recovery: {
      inspectCommand: [
        ...routing.commandPrefix,
        "container",
        "inspect",
        containerName,
      ],
      environment: { DOCKER_HOST: routing.verifiedHost },
      requiredLabel: `${ownershipLabel}=${ownershipNonce}`,
      instruction: "Verify the ownership label and remove only the inspected immutable container ID.",
    },
  });

  const postgresScript = [
    "install -o postgres -g postgres -m 0600 /tls-source/server.key /var/lib/postgresql/server.key",
    "install -o postgres -g postgres -m 0644 /tls-source/server.crt /var/lib/postgresql/server.crt",
    "exec docker-entrypoint.sh postgres -c ssl=on -c ssl_cert_file=/var/lib/postgresql/server.crt -c ssl_key_file=/var/lib/postgresql/server.key -c ssl_min_protocol_version=TLSv1.2",
  ].join("\n");
  let port;
  let started = false;
  try {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      port = await portFinder();
      try {
        await commandRunner(
          [
            ...routing.commandPrefix,
            "run",
            "--pull=never",
            "--detach",
            "--rm",
            "--name",
            containerName,
            "--label",
            `${ownershipLabel}=${ownershipNonce}`,
            "--publish",
            `127.0.0.1:${port}:5432`,
            "--tmpfs",
            "/var/lib/postgresql/data:rw,noexec,nosuid,nodev,mode=0700",
            "--mount",
            `type=bind,src=${tlsDirectory},dst=/tls-source,readonly`,
            "--env",
            "POSTGRES_USER=postgres",
            "--env",
            "POSTGRES_PASSWORD",
            "--env",
            "POSTGRES_DB=postgres",
            "--entrypoint",
            "/bin/sh",
            image,
            "-ceu",
            postgresScript,
          ],
          {
            cwd: repositoryRoot,
            env: { ...dockerEnvironment, POSTGRES_PASSWORD: password },
            timeoutMs: 30_000,
            logPath: path.join(
              diagnosticsDirectory,
              `local-identity-postgres-start-${attempt}.log`,
            ),
            canaries: [password],
            signal,
          },
        );
        started = true;
        break;
      } catch (error) {
        const collision =
          attempt < 3 &&
          !signal?.aborted &&
          /(?:port is already allocated|address already in use|bind:)/iu.test(
            error.outputTail ?? error.message,
          );
        await removeContainer(
          `local-identity-postgres-start-${attempt}-cleanup.log`,
          AbortSignal.timeout(30_000),
        ).catch((cleanupError) => {
          throw combineFailures(error, [cleanupError], "local identity PostgreSQL start");
        });
        if (!collision) throw error;
      }
    }
    if (!started || !port) throw fixedError("local identity PostgreSQL failed to start");
    const databaseUrl =
      `postgresql://postgres:${encodeURIComponent(password)}@127.0.0.1:${port}/postgres`;
    await waitForDatabase(repositoryRoot, databaseUrl, query, signal);
    await journal.acquired(resourceId, {
      identity: { tls: true, loopback: true },
    });
    return {
      databaseUrl,
      inspectionDatabaseUrl: (() => {
        const url = new URL(databaseUrl);
        url.searchParams.set("sslmode", "no-verify");
        return url.toString();
      })(),
      requireTls: async () => {
        const hbaScript = [
          'printf "%s\\n" \\',
          "  'local all all trust' \\",
          "  'hostnossl all all 0.0.0.0/0 reject' \\",
          "  'hostnossl all all ::/0 reject' \\",
          "  'hostssl all all 0.0.0.0/0 scram-sha-256' \\",
          "  'hostssl all all ::/0 scram-sha-256' > \"$PGDATA/pg_hba.conf\"",
          'exec pg_ctl -D "$PGDATA" reload',
        ].join("\n");
        await commandRunner(
          [
            ...routing.commandPrefix,
            "exec",
            "--user",
            "postgres",
            containerName,
            "/bin/sh",
            "-ceu",
            hbaScript,
          ],
          {
            cwd: repositoryRoot,
            env: dockerEnvironment,
            timeoutMs: 15_000,
            logPath: path.join(
              diagnosticsDirectory,
              "local-identity-postgres-require-tls.log",
            ),
            canaries: [password],
            signal,
          },
        );
        const inspectionUrl = new URL(databaseUrl);
        inspectionUrl.searchParams.set("sslmode", "no-verify");
        await waitForDatabase(
          repositoryRoot,
          inspectionUrl.toString(),
          query,
          signal,
        );
        let plaintextAccepted = false;
        try {
          await query(repositoryRoot, databaseUrl, "SELECT 1", [], { signal });
          plaintextAccepted = true;
        } catch {
          // The TLS-only HBA must reject this otherwise-valid plaintext route.
        }
        if (plaintextAccepted) {
          throw fixedError("local identity PostgreSQL still accepted plaintext");
        }
      },
      cleanup: () =>
        removeContainer(
          "local-identity-postgres-cleanup.log",
          AbortSignal.timeout(30_000),
        ),
    };
  } catch (error) {
    let cleanupError;
    if (started) {
      try {
        await removeContainer(
          "local-identity-postgres-acquisition-cleanup.log",
          AbortSignal.timeout(30_000),
        );
      } catch (caught) {
        cleanupError = caught;
      }
    }
    if (
      journal.state.resources.find((resource) => resource.id === resourceId)?.status ===
      "acquiring"
    ) {
      await journal.acquired(resourceId, {
        identity: { tls: true, loopback: true, acquisitionFailed: true },
      });
    }
    await journal.cleanupFinished(resourceId, {
      status: cleanupError ? "failed" : "removed",
      error: cleanupError,
    });
    throw combineFailures(error, [cleanupError].filter(Boolean), "local identity PostgreSQL");
  }
}

function createCapturedChild({ executable, args, cwd, env, signal, ipc = false }) {
  const child = spawn(executable, args, {
    cwd,
    env,
    detached: true,
    stdio: ipc
      ? ["ignore", "pipe", "pipe", "ipc"]
      : ["ignore", "pipe", "pipe"],
  });
  let stdout = Buffer.alloc(0);
  let stderr = Buffer.alloc(0);
  let overflow = false;
  const append = (current, chunk) => {
    const next = Buffer.concat([current, chunk]);
    if (next.byteLength > MAX_CAPTURE_BYTES) {
      overflow = true;
      return next.subarray(0, MAX_CAPTURE_BYTES);
    }
    return next;
  };
  child.stdout.on("data", (chunk) => {
    stdout = append(stdout, chunk);
  });
  child.stderr.on("data", (chunk) => {
    stderr = append(stderr, chunk);
  });
  let abortListener;
  let spawnError;
  const spawned = new Promise((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
  void spawned.catch(() => undefined);
  const ready = ipc
    ? new Promise((resolve, reject) => {
        let settled = false;
        const finish = (error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          child.removeListener("message", onMessage);
          child.removeListener("disconnect", onDisconnect);
          child.removeListener("error", onError);
          child.removeListener("close", onClose);
          if (error) reject(error);
          else resolve();
        };
        const onMessage = (message) => {
          if (
            message?.type !==
              "context-router.local-identity-smoke.waiting" ||
            message?.version !== 1 ||
            Object.keys(message).length !== 2
          ) {
            finish(fixedError("invalid local identity child waiting record"));
            return;
          }
          finish();
        };
        const onDisconnect = () =>
          finish(fixedError("local identity child disconnected before waiting"));
        const onError = (error) => finish(error);
        const onClose = () =>
          finish(fixedError("local identity child closed before waiting"));
        const timer = setTimeout(
          () => finish(fixedError("local identity child waiting timed out")),
          5_000,
        );
        child.once("message", onMessage);
        child.once("disconnect", onDisconnect);
        child.once("error", onError);
        child.once("close", onClose);
      })
    : spawned;
  void ready.catch(() => undefined);
  const result = new Promise((resolve, reject) => {
    let settled = false;
    let exitRecord;
    let stdoutEnded = false;
    let stderrEnded = false;
    let streamError;
    const removeAbortListener = () => {
      if (abortListener) signal?.removeEventListener("abort", abortListener);
    };
    const finishIfComplete = () => {
      if (settled || !exitRecord || !stdoutEnded || !stderrEnded) return;
      settled = true;
      removeAbortListener();
      if (spawnError || streamError) {
        reject(spawnError ?? streamError);
        return;
      }
      resolve({
        code: exitRecord.code,
        signal: exitRecord.signal,
        stdout: stdout.toString("utf8"),
        stderr: stderr.toString("utf8"),
        overflow,
      });
    };
    const stdoutFinished = () => {
      stdoutEnded = true;
      finishIfComplete();
    };
    const stderrFinished = () => {
      stderrEnded = true;
      finishIfComplete();
    };
    child.stdout.once("end", stdoutFinished);
    child.stdout.once("close", stdoutFinished);
    child.stderr.once("end", stderrFinished);
    child.stderr.once("close", stderrFinished);
    child.stdout.once("error", (error) => {
      streamError = error;
    });
    child.stderr.once("error", (error) => {
      streamError = error;
    });
    child.once("error", (error) => {
      spawnError = error;
      if (!child.pid && !settled) {
        settled = true;
        removeAbortListener();
        reject(error);
      }
    });
    child.once("exit", (code, childSignal) => {
      exitRecord = { code, signal: childSignal };
      finishIfComplete();
    });
    abortListener = () => {
      terminateProcessGroup(child, "SIGKILL");
    };
    signal?.addEventListener("abort", abortListener, { once: true });
    if (signal?.aborted) abortListener();
  });
  return {
    child,
    result,
    spawned,
    ready,
    release: () =>
      new Promise((resolve, reject) => {
        if (!ipc || !child.connected) {
          reject(fixedError("journaled local identity child is not connected"));
          return;
        }
        let settled = false;
        const finish = (error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          child.removeListener("message", onMessage);
          child.removeListener("disconnect", onDisconnect);
          if (error) reject(error);
          else resolve();
        };
        const onMessage = (message) => {
          if (
            message?.type !==
              "context-router.local-identity-smoke.accepted" ||
            message?.version !== 1 ||
            Object.keys(message).length !== 2
          ) {
            finish(fixedError("invalid local identity child acknowledgement"));
            return;
          }
          finish();
        };
        const onDisconnect = () =>
          finish(fixedError("local identity child disconnected before acknowledgement"));
        const timer = setTimeout(
          () => finish(fixedError("local identity child acknowledgement timed out")),
          5_000,
        );
        child.once("message", onMessage);
        child.once("disconnect", onDisconnect);
        child.send(
          {
            type: "context-router.local-identity-smoke.start",
            version: 1,
          },
          (error) => {
            if (error) finish(error);
          },
        );
      }),
    output: () => ({
      stdout: stdout.toString("utf8"),
      stderr: stderr.toString("utf8"),
      overflow,
    }),
  };
}

export function createGatedNodeChild({
  entrypoint,
  operation,
  cwd,
  env,
  signal,
}) {
  if (!path.isAbsolute(entrypoint)) {
    throw fixedError("local identity child entrypoint must be absolute");
  }
  return createCapturedChild({
    executable: process.execPath,
    args: [
      "--no-global-search-paths",
      "--eval",
      JOURNALED_NODE_GATE_SOURCE,
      entrypoint,
      operation,
    ],
    cwd,
    env,
    signal,
    ipc: true,
  });
}

function terminateProcessGroup(child, signalName) {
  if (!child.pid) return false;
  try {
    process.kill(-child.pid, signalName);
    return true;
  } catch {
    if (child.exitCode !== null || child.signalCode !== null) return false;
    try {
      return child.kill(signalName);
    } catch {
      return false;
    }
  }
}

async function waitForProcessGroupExit(pid, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await hasLiveProcessGroupMembers(pid))) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw fixedError("local identity child process group did not exit");
}

async function withinDeadline(promise, timeoutMs, message, onTimeout) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          onTimeout?.();
          reject(fixedError(message));
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function terminateAndReapJournaledNodeChild(handle, label) {
  const errors = [];
  terminateProcessGroup(handle.child, "SIGKILL");
  try {
    await withinDeadline(
      handle.result,
      5_000,
      `${label} reap timed out`,
      () => terminateProcessGroup(handle.child, "SIGKILL"),
    );
  } catch (error) {
    errors.push(error);
  }
  if (Number.isSafeInteger(handle.child.pid) && handle.child.pid > 0) {
    try {
      await waitForProcessGroupExit(handle.child.pid);
    } catch (error) {
      errors.push(error);
    }
  }
  return errors;
}

export async function activateJournaledNodeChild({
  handle,
  journal,
  resourceId,
  identity,
  releaseChild,
}) {
  let primaryError;
  try {
    await handle.ready;
    if (!Number.isSafeInteger(handle?.child?.pid) || handle.child.pid < 1) {
      throw fixedError("journaled local identity child has no PID");
    }
    await journal.acquired(resourceId, {
      identity: { ...identity, pid: handle.child.pid },
      recovery: {
        processGroupId: handle.child.pid,
        instruction:
          "Verify the recorded child PID, then terminate and reap only the process group with that exact numeric ID.",
      },
    });
    await (releaseChild ?? handle.release)();
    return handle.child.pid;
  } catch (error) {
    primaryError = error;
  }
  const cleanupErrors = await terminateAndReapJournaledNodeChild(
    handle,
    "journaled local identity child",
  );
  throw combineFailures(
    primaryError,
    cleanupErrors,
    "journaled local identity child",
  );
}

export function assertStateBytesUnchanged(before, after) {
  if (!Buffer.isBuffer(before) || !Buffer.isBuffer(after) || !before.equals(after)) {
    throw fixedError("local identity recovery changed identity state");
  }
}

async function waitForReadiness(processHandle, timeoutMs = 30_000) {
  const poll = async () => {
    for (;;) {
      const output = processHandle.output();
      if (output.overflow) throw fixedError("local identity preview output exceeded limit");
      if (output.stdout.includes("\n")) {
        if (output.stdout !== PREVIEW_READINESS || output.stderr !== "") {
          throw fixedError("invalid local identity preview output");
        }
        return;
      }
      if (
        processHandle.child.exitCode !== null ||
        processHandle.child.signalCode !== null
      ) {
        throw fixedError("local identity preview exited before readiness");
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  };
  await withinDeadline(
    poll(),
    timeoutMs,
    "local identity preview readiness timed out",
    () => terminateProcessGroup(processHandle.child, "SIGKILL"),
  );
  parseLocalIdentityPreviewReadiness(PREVIEW_READINESS.trimEnd());
}

export async function captureUtility(executable, args, options = {}) {
  const { timeoutMs = 10_000, ...spawnOptions } = options;
  const handle = createCapturedChild({
    executable,
    args,
    ...spawnOptions,
  });
  let primaryError;
  try {
    const result = await withinDeadline(
      handle.result,
      timeoutMs,
      "listener inspection timed out",
      () => terminateProcessGroup(handle.child, "SIGKILL"),
    );
    if (Number.isSafeInteger(handle.child.pid) && handle.child.pid > 0) {
      await waitForProcessGroupExit(handle.child.pid);
    }
    return result;
  } catch (error) {
    primaryError = error;
  }
  const cleanupErrors = await terminateAndReapJournaledNodeChild(
    handle,
    "listener inspection",
  );
  throw combineFailures(primaryError, cleanupErrors, "listener inspection");
}

async function countListeningSockets(pid, options = {}) {
  if (process.platform === "linux") {
    const fdDirectory = `/proc/${pid}/fd`;
    const socketInodes = new Set();
    for (const name of await readdir(fdDirectory)) {
      const target = await readlink(path.join(fdDirectory, name)).catch(() => "");
      const match = /^socket:\[(\d+)\]$/u.exec(target);
      if (match) socketInodes.add(match[1]);
    }
    const tables = await Promise.all(
      ["/proc/net/tcp", "/proc/net/tcp6"].map((filePath) =>
        readFile(filePath, "utf8").catch(() => ""),
      ),
    );
    const listening = listeningSocketInodesFromProc(tables);
    return [...socketInodes].filter((inode) => listening.has(inode)).length;
  }
  if (process.platform === "darwin") {
    const result = await captureUtility(
      "/usr/sbin/lsof",
      ["-nP", "-a", "-p", String(pid), "-iTCP", "-sTCP:LISTEN"],
      options,
    );
    if (result.signal || !new Set([0, 1]).has(result.code)) {
      throw fixedError("local identity listener inspection failed");
    }
    if (result.stderr !== "" || result.overflow) {
      throw fixedError("local identity listener inspection failed");
    }
    if (result.code === 1) return 0;
    const lines = result.stdout.trim().split(/\r?\n/u).filter(Boolean);
    return Math.max(0, lines.length - 1);
  }
  throw fixedError(`unsupported local identity smoke platform: ${os.platform()}`);
}

async function assertStateArtifact(stateRoot) {
  const root = await lstat(stateRoot);
  if (!root.isDirectory() || root.isSymbolicLink() || !exactMode(root, 0o700)) {
    throw fixedError("invalid local identity state root");
  }
  const names = await readdir(stateRoot);
  if (JSON.stringify(names) !== '["identity.json"]') {
    throw fixedError("invalid local identity state root contents");
  }
  const statePath = path.join(stateRoot, "identity.json");
  const info = await lstat(statePath);
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    info.nlink !== 1 ||
    !exactMode(info, 0o600)
  ) {
    throw fixedError("invalid local identity state artifact");
  }
  const bytes = await readFile(statePath);
  return { bytes, state: decodeSmokeIdentityState(bytes) };
}

function expectedAdminOutput(operation, generation) {
  return `${JSON.stringify({
    type: "context-router.local-identity.admin",
    version: 1,
    operation,
    status: "ok",
    generation,
  })}\n`;
}

async function runAdminCommand({
  number,
  operation,
  expectedGeneration,
  entrypoint,
  cwd,
  environment,
  diagnosticsDirectory,
  journal,
  signal,
  verifyArtifact,
}) {
  const resourceId = `local-identity-admin-${number}`;
  await journal.acquiring({
    id: resourceId,
    type: "local-identity-admin-process",
    owned: true,
    identity: { operation },
    recovery: "Terminate the owned local identity admin process group if it is still running.",
  });
  const handle = createGatedNodeChild({
    entrypoint,
    operation,
    cwd,
    env: environment,
    signal,
  });
  let result;
  let primaryError;
  const cleanupErrors = [];
  try {
    await activateJournaledNodeChild({
      handle,
      journal,
      resourceId,
      identity: { operation },
    });
    result = await withinDeadline(
      handle.result,
      30_000,
      "local identity admin command timed out",
      () => terminateProcessGroup(handle.child, "SIGKILL"),
    );
    await waitForProcessGroupExit(handle.child.pid);
    if (
      result.code !== 0 ||
      result.signal !== null ||
      result.overflow ||
      result.stderr !== "" ||
      result.stdout !== expectedAdminOutput(operation, expectedGeneration)
    ) {
      throw fixedError("local identity admin command failed its fixed contract");
    }
    await verifyArtifact();
    await writeFile(
      path.join(diagnosticsDirectory, `local-identity-admin-${number}.log`),
      result.stdout,
      { mode: 0o600 },
    );
  } catch (error) {
    primaryError = error;
    cleanupErrors.push(
      ...(await terminateAndReapJournaledNodeChild(
        handle,
        "local identity admin command",
      )),
    );
  }
  try {
    await journal.acquired(resourceId, {
      identity: {
        operation,
        pid: handle.child.pid ?? null,
        generation: expectedGeneration,
        exitCode: result?.code ?? null,
        childSignal: result?.signal ?? null,
      },
    });
  } catch (error) {
    cleanupErrors.push(error);
  }
  let failure = combineFailures(
    primaryError,
    cleanupErrors,
    "local identity admin command",
  );
  try {
    await journal.cleanupFinished(resourceId, {
      status: failure ? "failed" : "exited",
      error: failure,
    });
  } catch (error) {
    failure = combineFailures(
      failure,
      [error],
      "local identity admin command",
    );
  }
  if (failure) throw failure;
}

async function assertTlsOnlyDatabase(repositoryRoot, databaseUrl, query, signal) {
  const rows = await query(
    repositoryRoot,
    databaseUrl,
    `SELECT ssl, version, cipher
       FROM pg_catalog.pg_stat_ssl
      WHERE pid = pg_backend_pid()`,
    [],
    { signal },
  );
  if (
    rows.length < 1 ||
    rows.some(
      (row) =>
        row.ssl !== true ||
        typeof row.version !== "string" ||
        row.version.length === 0 ||
        typeof row.cipher !== "string" ||
        row.cipher.length === 0,
    )
  ) {
    throw fixedError("local identity PostgreSQL inspection was not TLS");
  }
}

async function runPreview({
  number,
  generation,
  requestedSignal,
  expectedExitCode,
  repositoryRoot,
  databaseUrl,
  query,
  entrypoint,
  cwd,
  environment,
  stateRoot,
  diagnosticsDirectory,
  journal,
  signal,
  verifyArtifact,
}) {
  const resourceId = `local-identity-preview-${number}`;
  const before = await assertStateArtifact(stateRoot);
  await journal.acquiring({
    id: resourceId,
    type: "local-identity-preview-process",
    owned: true,
    identity: { generation, requestedSignal, expectedExitCode },
    recovery: "Terminate the owned local identity preview process group if it is still running.",
  });
  const handle = createGatedNodeChild({
    entrypoint,
    operation: "preview",
    cwd,
    env: environment,
    signal,
  });
  let result;
  let listenerCount;
  let primaryError;
  const cleanupErrors = [];
  try {
    await activateJournaledNodeChild({
      handle,
      journal,
      resourceId,
      identity: { generation, requestedSignal, expectedExitCode },
    });
    await waitForReadiness(handle);
    listenerCount = await countListeningSockets(handle.child.pid, {
      cwd,
      env: buildListenerInspectionEnvironment(environment),
      signal,
    });
    if (listenerCount !== 0) {
      throw fixedError("local identity preview opened a TCP listener");
    }
    await assertTlsOnlyDatabase(
      repositoryRoot,
      databaseUrl,
      query,
      signal,
    );
    await journal.acquired(resourceId, {
      identity: {
        pid: handle.child.pid,
        listenerCount,
        readinessVersion: 1,
      },
    });
    if (!terminateProcessGroup(handle.child, requestedSignal)) {
      throw fixedError("local identity preview signal delivery failed");
    }
    result = await withinDeadline(
      handle.result,
      20_000,
      "local identity preview shutdown timed out",
      () => terminateProcessGroup(handle.child, "SIGKILL"),
    );
    await waitForProcessGroupExit(handle.child.pid);
    if (
      result.code !== expectedExitCode ||
      result.signal !== null ||
      result.overflow ||
      result.stdout !== PREVIEW_READINESS ||
      result.stderr !== ""
    ) {
      throw fixedError("local identity preview shutdown failed its fixed contract");
    }
    await journal.acquired(resourceId, {
      identity: { exitCode: result.code, childSignal: result.signal },
    });
    const after = await assertStateArtifact(stateRoot);
    if (!after.bytes.equals(before.bytes)) {
      throw fixedError("local identity preview changed identity state");
    }
    await verifyArtifact();
    await writeFile(
      path.join(diagnosticsDirectory, `local-identity-preview-${number}.log`),
      result.stdout,
      { mode: 0o600 },
    );
  } catch (error) {
    primaryError = error;
    cleanupErrors.push(
      ...(await terminateAndReapJournaledNodeChild(
        handle,
        "local identity preview",
      )),
    );
  }
  try {
    await journal.acquired(resourceId, {
      identity: {
        pid: handle.child.pid ?? null,
        listenerCount: listenerCount ?? null,
        readinessVersion: listenerCount === undefined ? null : 1,
        exitCode: result?.code ?? null,
        childSignal: result?.signal ?? null,
      },
    });
  } catch (error) {
    cleanupErrors.push(error);
  }
  let failure = combineFailures(
    primaryError,
    cleanupErrors,
    "local identity preview",
  );
  try {
    await journal.cleanupFinished(resourceId, {
      status: failure ? "failed" : "exited",
      error: failure,
    });
  } catch (error) {
    failure = combineFailures(failure, [error], "local identity preview");
  }
  if (failure) throw failure;
  return expectedExitCode;
}

async function assertPrivateDirectory(directory, label) {
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || !exactMode(info, 0o700)) {
    throw fixedError(`${label} must be an owned private directory`);
  }
}

export async function runLocalIdentitySmoke({
  repositoryRoot,
  entrypoint,
  cwd,
  home,
  temporaryDirectory,
  stateParent,
  tlsParent,
  caPem,
  serverKey,
  serverCertificate,
  diagnosticsDirectory,
  journal,
  canaries = [],
  environment = process.env,
  signal,
  migrateDatabase,
  verifyArtifact = async () => {},
  commandRunner = runCommand,
  query = queryDatabase,
}) {
  for (const [value, label] of [
    [repositoryRoot, "repositoryRoot"],
    [entrypoint, "entrypoint"],
    [cwd, "cwd"],
    [home, "home"],
    [temporaryDirectory, "temporaryDirectory"],
    [stateParent, "stateParent"],
    [tlsParent, "tlsParent"],
    [diagnosticsDirectory, "diagnosticsDirectory"],
  ]) {
    if (typeof value !== "string" || !path.isAbsolute(value)) {
      throw fixedError(`local identity smoke ${label} must be absolute`);
    }
  }
  if (!Buffer.isBuffer(serverKey) || !Buffer.isBuffer(serverCertificate)) {
    throw fixedError("local identity smoke requires in-memory TLS server material");
  }
  if (typeof caPem !== "string" || !caPem.includes("BEGIN CERTIFICATE")) {
    throw fixedError("local identity smoke requires a CA certificate");
  }
  for (const [directory, label] of [
    [stateParent, "state parent"],
    [tlsParent, "TLS parent"],
  ]) {
    await assertPrivateDirectory(directory, label);
  }
  await Promise.all([
    mkdir(home, { recursive: true, mode: 0o700 }),
    mkdir(temporaryDirectory, { recursive: true, mode: 0o700 }),
  ]);
  await Promise.all([chmod(home, 0o700), chmod(temporaryDirectory, 0o700)]);

  const [canonicalStateParent, canonicalTlsParent] = await Promise.all([
    realpath(stateParent),
    realpath(tlsParent),
  ]);
  const stateRoot = path.join(
    canonicalStateParent,
    "local-identity-state",
  );
  const tlsDirectory = path.join(canonicalTlsParent, "local-postgres-tls");
  const registerCanary = (value) => {
    if (!value) return;
    if (!canaries.includes(value)) canaries.push(value);
    journal.addCanary(value);
  };
  let administration;
  let stateRegistered = false;
  let primaryError;
  let result;
  try {
    await verifyArtifact();
    administration = await prepareLocalIdentityTlsPostgres({
      repositoryRoot,
      diagnosticsDirectory,
      environment,
      tlsDirectory,
      serverKey,
      serverCertificate,
      journal,
      registerCanary,
      signal,
      commandRunner,
      query,
    });
    await migrateDatabase(administration.databaseUrl);
    await administration.requireTls();
    await journal.acquired("local-identity-postgres", {
      identity: { tlsOnly: true, plaintextRejected: true },
    });
    await assertTlsOnlyDatabase(
      repositoryRoot,
      administration.inspectionDatabaseUrl,
      query,
      signal,
    );
    const localEnvironment = buildLocalIdentitySmokeEnvironment(environment, {
      home,
      temporaryDirectory,
      stateRoot,
      databaseUrl: administration.databaseUrl,
      caPem,
    });
    await journal.acquiring({
      id: "local-identity-state",
      type: "local-identity-private-state",
      owned: true,
      identity: { ownerPid: process.pid, expectedBasename: "identity.json" },
      recovery: {
        stateRoot,
        instruction:
          "Remove only this exact private state root after every recorded child process group exits.",
      },
    });
    stateRegistered = true;
    await runAdminCommand({
      number: 1,
      operation: "initialize",
      expectedGeneration: 1,
      entrypoint,
      cwd,
      environment: localEnvironment,
      diagnosticsDirectory,
      journal,
      signal,
      verifyArtifact,
    });
    await journal.acquired("local-identity-state", {
      identity: { initialized: true },
    });
    const initial = await assertStateArtifact(stateRoot);
    registerCanary(initial.state.principalId);
    registerCanary(initial.state.credential);
    registerCanary(initial.state.databaseTargetId);
    await runAdminCommand({
      number: 2,
      operation: "recover-initialize",
      expectedGeneration: 1,
      entrypoint,
      cwd,
      environment: localEnvironment,
      diagnosticsDirectory,
      journal,
      signal,
      verifyArtifact,
    });
    const recoveredInitial = await assertStateArtifact(stateRoot);
    assertStateBytesUnchanged(initial.bytes, recoveredInitial.bytes);
    await runPreview({
      number: 1,
      generation: 1,
      requestedSignal: "SIGTERM",
      expectedExitCode: 143,
      repositoryRoot,
      databaseUrl: administration.inspectionDatabaseUrl,
      query,
      entrypoint,
      cwd,
      environment: localEnvironment,
      stateRoot,
      diagnosticsDirectory,
      journal,
      signal,
      verifyArtifact,
    });

    const userRows = await query(
      repositoryRoot,
      administration.inspectionDatabaseUrl,
      "SELECT user_id FROM public.users ORDER BY user_id",
      [],
      { signal },
    );
    assert.deepEqual(userRows, [{ user_id: initial.state.principalId }]);
    await query(
      repositoryRoot,
      administration.inspectionDatabaseUrl,
      `INSERT INTO public.external_identities
        (id, user_id, provider, issuer, provider_user_id, updated_at)
       VALUES
        ($1, $2, 'auth0', 'https://tenant.example.test/', 'subject-one', NOW()),
        ($3, $2, 'second-idp', 'https://issuer.example.test/', 'subject-two', NOW())`,
      [randomUUID(), initial.state.principalId, randomUUID()],
      { signal },
    );

    await runAdminCommand({
      number: 3,
      operation: "rotate",
      expectedGeneration: 2,
      entrypoint,
      cwd,
      environment: localEnvironment,
      diagnosticsDirectory,
      journal,
      signal,
      verifyArtifact,
    });
    const rotated = await assertStateArtifact(stateRoot);
    registerCanary(rotated.state.credential);
    if (
      rotated.state.principalId !== initial.state.principalId ||
      rotated.state.databaseTargetId !== initial.state.databaseTargetId ||
      rotated.state.generation !== 2 ||
      rotated.state.credential === initial.state.credential
    ) {
      throw fixedError("local identity rotation changed stable identity fields");
    }
    await runAdminCommand({
      number: 4,
      operation: "recover-rotation",
      expectedGeneration: 2,
      entrypoint,
      cwd,
      environment: localEnvironment,
      diagnosticsDirectory,
      journal,
      signal,
      verifyArtifact,
    });
    const recoveredRotation = await assertStateArtifact(stateRoot);
    assertStateBytesUnchanged(rotated.bytes, recoveredRotation.bytes);
    await runPreview({
      number: 2,
      generation: 2,
      requestedSignal: "SIGINT",
      expectedExitCode: 130,
      repositoryRoot,
      databaseUrl: administration.inspectionDatabaseUrl,
      query,
      entrypoint,
      cwd,
      environment: localEnvironment,
      stateRoot,
      diagnosticsDirectory,
      journal,
      signal,
      verifyArtifact,
    });
    const bindings = await query(
      repositoryRoot,
      administration.inspectionDatabaseUrl,
      `SELECT provider, issuer, provider_user_id, user_id
         FROM public.external_identities
        ORDER BY provider`,
      [],
      { signal },
    );
    assert.deepEqual(bindings, [
      {
        provider: "auth0",
        issuer: "https://tenant.example.test/",
        provider_user_id: "subject-one",
        user_id: initial.state.principalId,
      },
      {
        provider: "second-idp",
        issuer: "https://issuer.example.test/",
        provider_user_id: "subject-two",
        user_id: initial.state.principalId,
      },
    ]);
    await journal.acquired("local-identity-state", {
      identity: {
        initialized: true,
        generation: 2,
        principalStable: true,
        credentialRotated: true,
        recoveryStable: true,
        providerBindings: 2,
      },
    });
    await verifyArtifact();
    result = {
      previews: 2,
      tlsVerified: true,
      listenerCount: 0,
      providerBindings: 2,
      principalStable: true,
      credentialRotated: true,
      generation: 2,
      signalExitCodes: [143, 130],
    };
  } catch (error) {
    primaryError = error;
  }

  const cleanupErrors = [];
  if (stateRegistered) {
    try {
      if (
        journal.state.resources.find((item) => item.id === "local-identity-state")
          ?.status === "acquiring"
      ) {
        await journal.acquired("local-identity-state", {
          identity: { initialized: false },
        });
      }
      await rm(stateRoot, { recursive: true, force: true });
      await journal.cleanupFinished("local-identity-state", {
        status: "removed",
      });
    } catch (error) {
      cleanupErrors.push(error);
      await journal.cleanupFinished("local-identity-state", {
        status: "failed",
        error,
      }).catch((journalError) => cleanupErrors.push(journalError));
    }
  }
  if (administration) {
    try {
      await administration.cleanup();
      await journal.cleanupFinished("local-identity-postgres", {
        status: "removed",
      });
    } catch (error) {
      cleanupErrors.push(error);
      await journal.cleanupFinished("local-identity-postgres", {
        status: "failed",
        error,
      }).catch((journalError) => cleanupErrors.push(journalError));
    }
  }
  try {
    await rm(tlsDirectory, { recursive: true, force: true });
  } catch (error) {
    cleanupErrors.push(error);
  }
  const combined = combineFailures(
    primaryError,
    cleanupErrors,
    "local identity smoke",
  );
  if (combined) throw combined;
  return result;
}
