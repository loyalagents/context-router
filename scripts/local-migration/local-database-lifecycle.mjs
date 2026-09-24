import path from "node:path";
export const LOCAL_DATABASE_ROOT_RECOVERY =
  "Terminate and reap every recorded local database child process group before preserving or removing only these exact owned roots; never delete database journals or identity recovery artifacts while an owner may live.";
const PROCESS_RECOVERY =
  "Verify the recorded child PID, then terminate and reap only the process group with that exact numeric ID.";
const keys = (value, expected) =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  JSON.stringify(Object.keys(value).sort()) ===
    JSON.stringify([...expected].sort());
const expected = new Map([
  ["local-database-state", "local-database-private-state"],
  ...[1, 2, 3, 4].map((i) => [
    `local-database-admin-${i}`,
    "local-database-admin-process",
  ]),
  ...[1, 2].map((i) => [
    `local-database-preview-${i}`,
    "local-database-preview-process",
  ]),
  ...[1, 2, 3].map((i) => [
    `local-database-probe-${i}`,
    "local-database-probe-process",
  ]),
]);
export function assertLocalDatabaseSmokeSuccessResources(state, label) {
  const fail = (detail) => {
    throw new Error(`${label} local-database ${detail}`);
  };
  const types = new Set(expected.values()),
    resources = state.resources.filter(
      (item) => item.id?.startsWith("local-database-") || types.has(item.type),
    );
  if (resources.length !== expected.size)
    fail("requires the exact approved resource set");
  const selected = new Map();
  for (const [id, type] of expected) {
    const matches = resources.filter(
      (item) => item.id === id && item.type === type,
    );
    if (
      matches.length !== 1 ||
      matches[0].owned !== true ||
      matches[0].cleanup?.status !==
        (id === "local-database-state" ? "removed" : "exited")
    )
      fail(`${id} missing exact owned cleanup evidence`);
    selected.set(id, matches[0]);
  }
  const { identity, recovery } = selected.get("local-database-state");
  if (
    !keys(recovery, ["root", "databaseRoot", "stateRoot", "instruction"]) ||
    !path.isAbsolute(recovery.root) ||
    path.resolve(recovery.root) !== recovery.root ||
    !/^local-database-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      path.basename(recovery.root),
    ) ||
    recovery.databaseRoot !== path.join(recovery.root, "data") ||
    recovery.stateRoot !== path.join(recovery.root, "identity") ||
    recovery.instruction !== LOCAL_DATABASE_ROOT_RECOVERY
  )
    fail("state requires exact-root recovery evidence");
  if (
    !keys(identity, [
      "root",
      "databaseRoot",
      "stateRoot",
      "initialized",
      "generation",
      "principalStable",
      "credentialRotated",
      "recoveryStable",
      "catalogCount",
      "dataStable",
      "providerBindings",
      "node",
      "sqlite",
      "sourceId",
      "compileOptionsDigest",
    ]) ||
    ["root", "databaseRoot", "stateRoot"].some(
      (key) => identity[key] !== recovery[key],
    ) ||
    [
      "initialized",
      "principalStable",
      "credentialRotated",
      "recoveryStable",
      "dataStable",
    ].some((key) => identity[key] !== true) ||
    identity.generation !== 2 ||
    identity.catalogCount !== 19 ||
    identity.providerBindings !== 0 ||
    identity.node !== "24.21.0" ||
    identity.sqlite !== "3.53.4" ||
    typeof identity.sourceId !== "string" ||
    !identity.sourceId ||
    identity.sourceId.length > 200 ||
    !/^[a-f0-9]{64}$/.test(identity.compileOptionsDigest)
  )
    fail("state lacks stable data, identity or exact engine proof");
  function process(id, fields) {
    const record = selected.get(id),
      value = record.identity;
    if (
      !keys(value, [
        "pid",
        "exitCode",
        "childSignal",
        ...Object.keys(fields),
      ]) ||
      !Number.isSafeInteger(value.pid) ||
      value.pid < 1 ||
      value.childSignal !== null ||
      value.exitCode !== (fields.expectedExitCode ?? 0) ||
      Object.entries(fields).some(
        ([key, expected]) => value[key] !== expected,
      ) ||
      !keys(record.recovery, ["processGroupId", "instruction"]) ||
      record.recovery.processGroupId !== value.pid ||
      record.recovery.instruction !== PROCESS_RECOVERY
    )
      fail(`${id} lacks exact operation, PID, readiness or exit evidence`);
  }
  ["initialize", "recover-initialize", "rotate", "recover-rotation"].forEach(
    (operation, i) =>
      process(`local-database-admin-${i + 1}`, {
        operation,
        generation: i < 2 ? 1 : 2,
      }),
  );
  ["SIGTERM", "SIGINT"].forEach((requestedSignal, i) =>
    process(`local-database-preview-${i + 1}`, {
      operation: "preview",
      generation: i + 1,
      requestedSignal,
      expectedExitCode: i === 0 ? 143 : 130,
      listenerCount: 0,
      readinessVersion: 1,
    }),
  );
  ["seed", "inspect", "inspect"].forEach((operation, i) =>
    process(`local-database-probe-${i + 1}`, { operation }),
  );
}
