import path from "node:path";
export function localDatabaseLifecycleResources(base) {
  const root = path.join(
    base,
    "local-database-01234567-89ab-4def-8123-456789abcdef",
  );
  const completed = (id, type, cleanup, identity, recovery) => ({
    id,
    type,
    owned: true,
    status: "acquired",
    identity,
    recovery,
    cleanup: { status: cleanup },
  });
  const process = (id, type, identity, pid) =>
    completed(
      id,
      type,
      "exited",
      {
        ...identity,
        pid,
        exitCode: identity.expectedExitCode ?? 0,
        childSignal: null,
      },
      {
        processGroupId: pid,
        instruction:
          "Verify the recorded child PID, then terminate and reap only the process group with that exact numeric ID.",
      },
    );
  return [
    completed(
      "local-database-state",
      "local-database-private-state",
      "removed",
      {
        root,
        databaseRoot: path.join(root, "data"),
        stateRoot: path.join(root, "identity"),
        initialized: true,
        generation: 2,
        principalStable: true,
        credentialRotated: true,
        recoveryStable: true,
        catalogCount: 19,
        dataStable: true,
        providerBindings: 0,
        node: "24.21.0",
        sqlite: "3.53.4",
        sourceId: "source",
        compileOptionsDigest: "1".repeat(64),
      },
      {
        root,
        databaseRoot: path.join(root, "data"),
        stateRoot: path.join(root, "identity"),
        instruction:
          "Terminate and reap every recorded local database child process group before preserving or removing only these exact owned roots; never delete database journals or identity recovery artifacts while an owner may live.",
      },
    ),
    ...["initialize", "recover-initialize", "rotate", "recover-rotation"].map(
      (operation, i) =>
        process(
          `local-database-admin-${i + 1}`,
          "local-database-admin-process",
          { operation, generation: i < 2 ? 1 : 2 },
          5100 + i,
        ),
    ),
    ...["SIGTERM", "SIGINT"].map((requestedSignal, i) =>
      process(
        `local-database-preview-${i + 1}`,
        "local-database-preview-process",
        {
          operation: "preview",
          generation: i + 1,
          requestedSignal,
          expectedExitCode: i === 0 ? 143 : 130,
          readinessVersion: 1,
          listenerCount: 0,
        },
        5200 + i,
      ),
    ),
    ...["seed", "inspect", "inspect"].map((operation, i) =>
      process(
        `local-database-probe-${i + 1}`,
        "local-database-probe-process",
        { operation },
        5300 + i,
      ),
    ),
  ];
}
