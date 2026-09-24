import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  lstat,
  realpath,
  rm,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { combineFailures, hasLiveProcessGroupMembers } from "./gate-runner.mjs";
import {
  createGatedNodeChild,
  activateJournaledNodeChild,
  terminateAndReapJournaledNodeChild,
  countListeningSockets,
  buildListenerInspectionEnvironment,
  decodeSmokeIdentityState,
} from "./local-identity-smoke.mjs";
import { LOCAL_DATABASE_ROOT_RECOVERY } from "./local-database-lifecycle.mjs";
const directory = path.dirname(fileURLToPath(import.meta.url));
const readiness =
  '{"type":"context-router.local-identity.preview.ready","version":1}\n';
const failure = (message) => new Error(`Local database smoke ${message}`);
export function buildLocalDatabaseSmokeEnvironment(
  source,
  { home, temporaryDirectory, databaseRoot, stateRoot, runtimeDist },
) {
  return {
    ...Object.fromEntries(
      ["PATH", "LANG", "LC_ALL", "TZ"].flatMap((key) =>
        source[key] === undefined ? [] : [[key, source[key]]],
      ),
    ),
    HOME: home,
    TMPDIR: temporaryDirectory,
    TMP: temporaryDirectory,
    TEMP: temporaryDirectory,
    NODE_ENV: "production",
    LOCAL_DATABASE_ROOT: databaseRoot,
    LOCAL_IDENTITY_STATE_ROOT: stateRoot,
    LOCAL_DATABASE_RUNTIME_DIST: runtimeDist,
  };
}
export function decodeLocalDatabaseProbe(output) {
  try {
    if (
      typeof output !== "string" ||
      output.length > 4096 ||
      !output.endsWith("\n") ||
      output.slice(0, -1).includes("\n")
    )
      throw new Error();
    const value = JSON.parse(output);
    if (
      JSON.stringify(Object.keys(value).sort()) !==
        JSON.stringify(
          [
            "type",
            "version",
            "target",
            "principal",
            "catalog",
            "catalogDigest",
            "dataDigest",
            "preferences",
            "node",
            "sqlite",
            "sourceId",
            "compileOptionsDigest",
          ].sort(),
        ) ||
      value.type !== "context-router.local-database.probe" ||
      value.version !== 1 ||
      value.node !== "24.21.0" ||
      value.sqlite !== "3.53.4" ||
      value.catalog !== 19 ||
      value.preferences !== 1 ||
      !/^[A-Za-z0-9_-]{43}$/.test(value.target) ||
      !/^[A-Za-z0-9_-]{43}$/.test(value.principal) ||
      typeof value.sourceId !== "string" ||
      !value.sourceId ||
      value.sourceId.length > 200
    )
      throw new Error();
    for (const key of ["catalogDigest", "dataDigest", "compileOptionsDigest"])
      if (!/^[a-f0-9]{64}$/.test(value[key])) throw new Error();
    return value;
  } catch {
    throw failure("invalid probe evidence");
  }
}
export function assertLocalDatabaseChildResult(
  result,
  expectedCode,
  expectedOutput,
) {
  if (
    result.code !== expectedCode ||
    result.signal !== null ||
    result.stderr !== "" ||
    result.overflow ||
    (expectedOutput !== undefined && result.stdout !== expectedOutput)
  )
    throw failure("child fixed output contract failed");
}
async function bounded(promise, timeout = 30000) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(failure("deadline exceeded")), timeout);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
async function gone(pid) {
  const deadline = Date.now() + 5000;
  while (await hasLiveProcessGroupMembers(pid)) {
    if (Date.now() > deadline) throw failure("process group still live");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
async function privateTree(root) {
  const stat = await lstat(root);
  assert.equal(stat.mode & 0o7777, stat.isDirectory() ? 0o700 : 0o600);
  assert.equal(stat.uid, process.getuid());
  assert.equal(stat.isSymbolicLink(), false);
  if (stat.isDirectory())
    for (const name of await readdir(root))
      await privateTree(path.join(root, name));
  else assert.equal(stat.nlink, 1);
}
export async function runLocalDatabaseSmoke({
  entrypoint,
  cwd,
  home,
  temporaryDirectory,
  stateParent,
  journal,
  environment = process.env,
  signal,
  verifyArtifact = async () => {},
  terminateChild = terminateAndReapJournaledNodeChild,
}) {
  let canonicalParent;
  try {
    // The outer smoke owns this existing parent; runtime roots must use its canonical path.
    canonicalParent = await realpath(stateParent);
  } catch {
    throw failure("state parent unavailable");
  }
  const root = path.join(canonicalParent, `local-database-${randomUUID()}`),
    databaseRoot = path.join(root, "data"),
    stateRoot = path.join(root, "identity");
  const env = buildLocalDatabaseSmokeEnvironment(environment, {
    home,
    temporaryDirectory,
    databaseRoot,
    stateRoot,
    runtimeDist: path.dirname(entrypoint),
  });
  const children = [];
  let succeeded = false,
    rootClaimed = false,
    initial,
    final;
  const probes = [];
  const rootRecovery = {
    root,
    databaseRoot,
    stateRoot,
    instruction: LOCAL_DATABASE_ROOT_RECOVERY,
  };
  async function identity() {
    assert.deepEqual(await readdir(stateRoot), ["identity.json"]);
    const bytes = await readFile(path.join(stateRoot, "identity.json"));
    const state = decodeSmokeIdentityState(bytes);
    journal.addCanary(state.credential);
    return { bytes, state };
  }
  async function run({
    id,
    type,
    operation,
    generation,
    previewSignal,
    probe = false,
  }) {
    await journal.acquiring({
      id,
      type,
      owned: true,
      identity: { operation, ...(generation ? { generation } : {}) },
      recovery:
        "Terminate and reap only the recorded owned local database child process group.",
    });
    const handle = createGatedNodeChild({
      entrypoint: probe
        ? path.join(directory, "fixtures/local-database-probe.cjs")
        : entrypoint,
      operation,
      cwd,
      env,
      signal,
      preload: path.join(
        directory,
        "fixtures/local-database-deny-provider-network.cjs",
      ),
    });
    const owned = { id, handle, reaped: false };
    children.push(owned);
    let result, primary, listenerCount;
    try {
      await activateJournaledNodeChild({
        handle,
        journal,
        resourceId: id,
        identity: { operation, ...(generation ? { generation } : {}) },
      });
      if (previewSignal) {
        await bounded(
          (async () => {
            while (handle.output().stdout !== readiness) {
              if (
                handle.output().stderr ||
                handle.output().overflow ||
                handle.child.exitCode !== null ||
                handle.child.signalCode !== null
              )
                throw failure("preview failed before readiness");
              await new Promise((resolve) => setTimeout(resolve, 10));
            }
          })(),
        );
        listenerCount = await countListeningSockets(handle.child.pid, {
          cwd,
          env: buildListenerInspectionEnvironment(environment),
          signal,
        });
        assert.equal(listenerCount, 0);
        await journal.acquired(id, {
          identity: {
            readinessVersion: 1,
            listenerCount,
            requestedSignal: previewSignal,
            expectedExitCode: previewSignal === "SIGTERM" ? 143 : 130,
          },
        });
        process.kill(-handle.child.pid, previewSignal);
      }
      result = await bounded(handle.result);
      await gone(handle.child.pid);
      owned.reaped = true;
      assertLocalDatabaseChildResult(
        result,
        previewSignal ? (previewSignal === "SIGTERM" ? 143 : 130) : 0,
        probe
          ? undefined
          : previewSignal
            ? readiness
            : JSON.stringify({
                type: "context-router.local-identity.admin",
                version: 1,
                operation,
                status: "ok",
                generation,
              }) + "\n",
      );
      if (probe) probes.push(decodeLocalDatabaseProbe(result.stdout));
      await verifyArtifact();
      await journal.acquired(id, {
        identity: {
          exitCode: result.code,
          childSignal: null,
          ...(listenerCount === undefined
            ? {}
            : { listenerCount, readinessVersion: 1 }),
        },
      });
    } catch (error) {
      primary = error;
    }
    const errors = owned.reaped
      ? []
      : await terminateChild(handle, "local database child");
    if (errors.length === 0) owned.reaped = true;
    const combined = combineFailures(primary, errors, "local database child");
    await journal.cleanupFinished(id, {
      status: errors.length ? "failed" : "exited",
      error: errors.length
        ? combineFailures(undefined, errors, "local database child cleanup")
        : undefined,
    });
    if (combined) throw combined;
  }
  let primary;
  const cleanup = [];
  try {
    await journal.acquiring({
      id: "local-database-state",
      type: "local-database-private-state",
      owned: true,
      identity: { root, databaseRoot, stateRoot },
      recovery: rootRecovery,
    });
    await mkdir(root, { mode: 0o700 });
    rootClaimed = true;
    await mkdir(home, { mode: 0o700 });
    await mkdir(temporaryDirectory, { mode: 0o700 });
    await journal.acquired("local-database-state", {
      identity: { root, databaseRoot, stateRoot },
      recovery: rootRecovery,
    });
    await run({
      id: "local-database-admin-1",
      type: "local-database-admin-process",
      operation: "initialize",
      generation: 1,
    });
    initial = await identity();
    await run({
      id: "local-database-probe-1",
      type: "local-database-probe-process",
      operation: "seed",
      probe: true,
    });
    await run({
      id: "local-database-preview-1",
      type: "local-database-preview-process",
      operation: "preview",
      generation: 1,
      previewSignal: "SIGTERM",
    });
    assert.ok((await identity()).bytes.equals(initial.bytes));
    await run({
      id: "local-database-probe-2",
      type: "local-database-probe-process",
      operation: "inspect",
      probe: true,
    });
    await run({
      id: "local-database-admin-2",
      type: "local-database-admin-process",
      operation: "recover-initialize",
      generation: 1,
    });
    assert.ok((await identity()).bytes.equals(initial.bytes));
    await run({
      id: "local-database-admin-3",
      type: "local-database-admin-process",
      operation: "rotate",
      generation: 2,
    });
    final = await identity();
    assert.equal(final.state.principalId, initial.state.principalId);
    assert.equal(final.state.databaseTargetId, initial.state.databaseTargetId);
    assert.equal(final.state.generation, 2);
    assert.ok(final.state.credential !== initial.state.credential);
    await run({
      id: "local-database-preview-2",
      type: "local-database-preview-process",
      operation: "preview",
      generation: 2,
      previewSignal: "SIGINT",
    });
    assert.ok((await identity()).bytes.equals(final.bytes));
    await run({
      id: "local-database-admin-4",
      type: "local-database-admin-process",
      operation: "recover-rotation",
      generation: 2,
    });
    assert.ok((await identity()).bytes.equals(final.bytes));
    await run({
      id: "local-database-probe-3",
      type: "local-database-probe-process",
      operation: "inspect",
      probe: true,
    });
    assert.ok(JSON.stringify(probes[1]) === JSON.stringify(probes[0]));
    assert.ok(JSON.stringify(probes[2]) === JSON.stringify(probes[0]));
    assert.equal(probes[0].principal, initial.state.principalId);
    assert.equal(probes[0].target, initial.state.databaseTargetId);
    await privateTree(root);
    await journal.acquired("local-database-state", {
      identity: {
        initialized: true,
        generation: 2,
        principalStable: true,
        credentialRotated: true,
        recoveryStable: true,
        catalogCount: 19,
        dataStable: true,
        providerBindings: 0,
        node: probes[0].node,
        sqlite: probes[0].sqlite,
        sourceId: probes[0].sourceId,
        compileOptionsDigest: probes[0].compileOptionsDigest,
      },
      recovery: rootRecovery,
    });
    succeeded = true;
  } catch (error) {
    primary = error;
  }
  for (const owned of children)
    if (!owned.reaped) {
      const errors = await terminateChild(
        owned.handle,
        "local database cleanup",
      );
      cleanup.push(...errors);
      if (errors.length === 0) {
        owned.reaped = true;
        try {
          await journal.cleanupFinished(owned.id, { status: "exited" });
        } catch (error) {
          cleanup.push(error);
        }
      }
    }
  const canRemove = cleanup.length === 0;
  if (rootClaimed && canRemove) {
    try {
      await rm(root, { recursive: true });
    } catch (error) {
      cleanup.push(error);
    }
  }
  const combined = combineFailures(primary, cleanup, "local database smoke");
  if (
    journal.state.resources.some(
      (resource) => resource.id === "local-database-state",
    )
  )
    await journal.cleanupFinished("local-database-state", {
      status: canRemove && cleanup.length === 0 ? "removed" : "failed",
      error: cleanup.length
        ? combineFailures(undefined, cleanup, "local database cleanup")
        : undefined,
    });
  if (combined) throw combined;
  assert.equal(succeeded, true);
  return {
    generations: 2,
    principalStable: true,
    catalogCount: 19,
    dataStable: true,
    credentialRotated: true,
    recoveryStable: true,
    node: probes[0].node,
    sqlite: probes[0].sqlite,
    sourceId: probes[0].sourceId,
    compileOptionsDigest: probes[0].compileOptionsDigest,
  };
}
