import { localModelLifecycleResources } from './fixtures/local-model-lifecycle.mjs';
import { localDatabaseLifecycleResources } from "./fixtures/local-database-lifecycle.mjs";
import assert from "node:assert/strict";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  validateApprovedPhaseCommands,
  validatePhaseManifest,
  createResourceLifecycleJournal,
} from "./gate-runner.mjs";
import {
  assertGateDiagnosticsOwnership,
  assertDisposableWorkspaceOwnership,
  buildAdministrationCanaries,
  createDeadlineAbortController,
  createFinalCleanupAbortController,
  createGateTimeline,
  effectivePhaseTimeoutMs,
  finalizeGateAttemptEvidence,
  GATE_TIMELINE_MS,
  markGateSuccessCandidate,
  persistExternalGateSummary,
  prepareGateDiagnosticsRoot,
  prepareDisposableWorkspace,
  RESTART_SMOKE_TERMINATION_GRACE_MS,
  runBoundedGateStages,
  formatPreflightEvidence,
  terminationGraceForPhase,
} from "./migration-gate.mjs";
import { RESTART_SMOKE_BOUNDED_CLEANUP_BUDGET_MS } from "./restart-smoke.mjs";

const manifest = JSON.parse(
  await readFile(new URL("./gate-phases.json", import.meta.url), "utf8"),
);
const require = createRequire(new URL("../../package.json", import.meta.url));
const Ajv2020 = require("ajv/dist/2020").default;
const { parse: parseYaml } = require("yaml");
const schema = JSON.parse(
  await readFile(new URL("./gate-phases.schema.json", import.meta.url), "utf8"),
);

test("administration redaction canaries include encoded and decoded credentials", () => {
  assert.deepEqual(
    buildAdministrationCanaries(
      "postgresql://gate-user:p%40ss@127.0.0.1:5433/postgres",
      ["synthetic-extra"],
    ),
    ["synthetic-extra", "p%40ss", "p@ss"],
  );
});

test("completed inner gate work remains nonterminal until outer cleanup", () => {
  const summary = markGateSuccessCandidate({ status: "passed", phases: [] });
  assert.equal(summary.status, "running");
  assert.equal(
    summary.cleanupPending,
    "caller-integrity-workspace-and-diagnostics-removal",
  );
});

test("packaged smoke phase independently rejects an incomplete child journal", async () => {
  const gate = await import("./migration-gate.mjs");
  assert.equal(typeof gate.assertPackagedSmokeLifecycleEvidence, "function");
  assert.equal(typeof gate.executePackagedSmokeCommand, "function");
  assert.equal(typeof gate.executeGatePhaseCommand, "function");
  const root = await mkdtemp(path.join(os.tmpdir(), "gate-packaging-journal-test-"));
  const diagnostics = path.join(root, "packaging-smoke");
  const journalPath = path.join(diagnostics, "resource-lifecycle.json");
  await mkdir(diagnostics, { mode: 0o700 });
  try {
    await writeFile(
      journalPath,
      `${JSON.stringify({
        schemaVersion: 1,
        status: "running",
        resources: [
          {
            id: "backend-generation-1",
            type: "staged-backend-process",
            status: "acquired",
            identity: { pid: 4242 },
            cleanup: { status: "pending" },
            recovery: "Verify the recorded PID before scoped recovery.",
          },
        ],
      })}\n`,
      { mode: 0o600 },
    );
    await assert.rejects(
      gate.executePackagedSmokeCommand({
        executeCommand: async () => ({ outputTail: "smoke exited zero" }),
        validateLifecycle: ({ commandSucceeded }) =>
          gate.assertPackagedSmokeLifecycleEvidence(diagnostics, {
            commandSucceeded,
          }),
      }),
      /backend-generation-1.*4242/,
    );

    await writeFile(
      journalPath,
      `${JSON.stringify({ schemaVersion: 1, status: "passed", resources: [] })}\n`,
      { mode: 0o600 },
    );
    await assert.rejects(
      gate.assertPackagedSmokeLifecycleEvidence(diagnostics, {
        commandSucceeded: true,
      }),
      /private-root/,
    );

    await writeFile(
      journalPath,
      `${JSON.stringify({ schemaVersion: 2, status: "passed", resources: [] })}\n`,
      { mode: 0o600 },
    );
    await assert.rejects(
      gate.assertPackagedSmokeLifecycleEvidence(diagnostics, {
        commandSucceeded: true,
      }),
      /schemaVersion must be 1/,
    );

    const completed = (id, type, cleanup, identity = {}, recovery) => ({
      id,
      type,
      owned: true,
      status: "acquired",
      identity,
      ...(recovery === undefined ? {} : { recovery }),
      cleanup: { status: cleanup },
    });
    const localIdentityProcessRecovery = (pid) => ({
      processGroupId: pid,
      instruction:
        "Verify the recorded child PID, then terminate and reap only the process group with that exact numeric ID.",
    });
    const localIdentityStateRoot = path.join(
      diagnostics,
      "local-identity-state",
    );
    const localIdentityResources = [
      completed(
        "local-identity-postgres",
        "local-identity-tls-postgres-container",
        "removed",
        {
          fixture: "fresh-native-tls-database",
          tls: true,
          loopback: true,
          tlsOnly: true,
          plaintextRejected: true,
        },
        {
          inspectCommand: [
            "docker",
            "container",
            "inspect",
            "lmid-pg-0123456789abcdef01234567",
          ],
          environment: { DOCKER_HOST: "unix:///var/run/docker.sock" },
          requiredLabel:
            "context-router.local-identity-smoke-owner=01234567-89ab-4def-8123-456789abcdef",
          instruction:
            "Verify the ownership label and remove only the inspected immutable container ID.",
        },
      ),
      completed(
        "local-identity-state",
        "local-identity-private-state",
        "removed",
        {
          initialized: true,
          generation: 2,
          principalStable: true,
          credentialRotated: true,
          recoveryStable: true,
          providerBindings: 2,
        },
        {
          stateRoot: localIdentityStateRoot,
          instruction:
            "Remove only this exact private state root after every recorded child process group exits.",
        },
      ),
      completed(
        "local-identity-admin-1",
        "local-identity-admin-process",
        "exited",
        {
          operation: "initialize",
          generation: 1,
          pid: 4201,
          exitCode: 0,
          childSignal: null,
        },
        localIdentityProcessRecovery(4201),
      ),
      completed(
        "local-identity-admin-2",
        "local-identity-admin-process",
        "exited",
        {
          operation: "recover-initialize",
          generation: 1,
          pid: 4202,
          exitCode: 0,
          childSignal: null,
        },
        localIdentityProcessRecovery(4202),
      ),
      completed(
        "local-identity-admin-3",
        "local-identity-admin-process",
        "exited",
        {
          operation: "rotate",
          generation: 2,
          pid: 4203,
          exitCode: 0,
          childSignal: null,
        },
        localIdentityProcessRecovery(4203),
      ),
      completed(
        "local-identity-admin-4",
        "local-identity-admin-process",
        "exited",
        {
          operation: "recover-rotation",
          generation: 2,
          pid: 4204,
          exitCode: 0,
          childSignal: null,
        },
        localIdentityProcessRecovery(4204),
      ),
      completed(
        "local-identity-preview-1",
        "local-identity-preview-process",
        "exited",
        {
          generation: 1,
          pid: 4301,
          requestedSignal: "SIGTERM",
          expectedExitCode: 143,
          exitCode: 143,
          childSignal: null,
          readinessVersion: 1,
          listenerCount: 0,
        },
        localIdentityProcessRecovery(4301),
      ),
      completed(
        "local-identity-preview-2",
        "local-identity-preview-process",
        "exited",
        {
          generation: 2,
          pid: 4302,
          requestedSignal: "SIGINT",
          expectedExitCode: 130,
          exitCode: 130,
          childSignal: null,
          readinessVersion: 1,
          listenerCount: 0,
        },
        localIdentityProcessRecovery(4302),
      ),
    ];
    await writeFile(
      journalPath,
      `${JSON.stringify({
        schemaVersion: 1,
        status: "passed",
        resources: [
          completed("private-root", "packaging-private-root", "removed"),
          completed("stable-proxy", "loopback-http-proxy", "closed"),
          completed("sealed-stage", "read-only-packaged-stage", "removed"),
          completed("database", "owned-test-database", "removed"),
          completed(
            "administration",
            "external-administration",
            "not-owned",
          ),
          completed(
            "synthetic-secrets",
            "synthetic-credential-directory",
            "removed",
          ),
          completed("synthetic-jwks", "loopback-synthetic-jwks", "closed"),
          completed(
            "backend-generation-1",
            "staged-backend-process",
            "exited",
            { pid: 4242 },
          ),
          completed(
            "backend-generation-2",
            "staged-backend-process",
            "exited",
            { pid: 4243 },
          ),
          completed(
            "web-generation-1-attempt-1",
            "staged-web-process",
            "exited",
            { generation: 1, pid: 4244 },
          ),
          completed(
            "web-generation-2-attempt-1",
            "staged-web-process",
            "exited",
            { generation: 2, pid: 4245 },
          ),
          ...localIdentityResources,
          ...localDatabaseLifecycleResources(diagnostics),
          ...localModelLifecycleResources(diagnostics),
        ],
      })}\n`,
      { mode: 0o600 },
    );
    const result = await gate.executePackagedSmokeCommand({
      executeCommand: async () => ({ outputTail: "smoke exited zero" }),
      validateLifecycle: ({ commandSucceeded }) =>
        gate.assertPackagedSmokeLifecycleEvidence(diagnostics, {
          commandSucceeded,
        }),
    });
    assert.equal(result.outputTail, "smoke exited zero");
    await gate.assertRestartSmokeLifecycleEvidence(diagnostics, {
      commandSucceeded: true,
    });

    const bothModes = JSON.parse(await readFile(journalPath, "utf8"));
    const missingSqlite = structuredClone(bothModes); missingSqlite.resources = missingSqlite.resources.filter(item => !item.id.startsWith("local-database-"));
    await writeFile(journalPath, JSON.stringify(missingSqlite) + "\n", { mode: 0o600 });
    await assert.rejects(gate.assertRestartSmokeLifecycleEvidence(diagnostics, { commandSucceeded: true }), /local-database/);
    await assert.rejects(gate.assertPackagedSmokeLifecycleEvidence(diagnostics, { commandSucceeded: true }), /local-database/);
    await writeFile(journalPath, JSON.stringify(bothModes) + "\n", { mode: 0o600 });

    const missingModel = structuredClone(bothModes); missingModel.resources = missingModel.resources.filter(item => !item.id.startsWith('local-model-'));
    await writeFile(journalPath, JSON.stringify(missingModel) + '\n', { mode: 0o600 });
    await assert.rejects(gate.assertRestartSmokeLifecycleEvidence(diagnostics, { commandSucceeded: true }), /model lifecycle/);
    await assert.rejects(gate.assertPackagedSmokeLifecycleEvidence(diagnostics, { commandSucceeded: true }), /model lifecycle/);
    await writeFile(journalPath, JSON.stringify(bothModes) + '\n', { mode: 0o600 });

    const dispatchEvents = [];
    const dispatched = await gate.executeGatePhaseCommand({
      phase: { kind: "packaged-smoke" },
      executeCommand: async () => {
        dispatchEvents.push("command");
        return { outputTail: "dispatched" };
      },
      validatePackagedLifecycle: async ({ commandSucceeded }) => {
        dispatchEvents.push(`lifecycle:${commandSucceeded}`);
      },
    });
    assert.equal(dispatched.outputTail, "dispatched");
    assert.deepEqual(dispatchEvents, ["command", "lifecycle:true"]);
    const restartEvents = [];
    const restartDispatched = await gate.executeGatePhaseCommand({
      phase: { kind: "restart-smoke" },
      executeCommand: async () => {
        restartEvents.push("command");
        return { outputTail: "restart-dispatched" };
      },
      validateRestartLifecycle: async ({ commandSucceeded }) => {
        restartEvents.push(`lifecycle:${commandSucceeded}`);
      },
    });
    assert.equal(restartDispatched.outputTail, "restart-dispatched");
    assert.deepEqual(restartEvents, ["command", "lifecycle:true"]);
    await assert.rejects(
      gate.executeGatePhaseCommand({
        phase: { kind: "restart-smoke" },
        executeCommand: async () => ({ outputTail: "unvalidated" }),
      }),
      /requires lifecycle validation/,
    );
    await assert.rejects(
      gate.executeGatePhaseCommand({
        phase: { kind: "packaged-smoke" },
        executeCommand: async () => ({ outputTail: "unvalidated" }),
      }),
      /requires lifecycle validation/,
    );
    let ordinaryValidated = false;
    const ordinary = await gate.executeGatePhaseCommand({
      phase: { kind: "command" },
      executeCommand: async () => ({ outputTail: "ordinary" }),
      validatePackagedLifecycle: async () => {
        ordinaryValidated = true;
      },
    });
    assert.equal(ordinary.outputTail, "ordinary");
    assert.equal(ordinaryValidated, false);

    await assert.rejects(
      gate.executePackagedSmokeCommand({
        executeCommand: async () => {
          throw new Error("packaged smoke command failed");
        },
        validateLifecycle: async ({ commandSucceeded }) => {
          assert.equal(commandSucceeded, false);
          throw new Error("packaged smoke journal incomplete");
        },
      }),
      (error) => {
        assert.match(error.message, /packaged smoke command failed/);
        assert.match(error.message, /packaged smoke journal incomplete/);
        assert.equal(error.primaryError?.message, "packaged smoke command failed");
        assert.equal(
          error.secondaryErrors?.[0]?.message,
          "packaged smoke journal incomplete",
        );
        return true;
      },
    );

    const validLifecycle = JSON.parse(await readFile(journalPath, "utf8"));
    const invalidLocalEvidence = [
      (state) => {
        state.resources.find(
          (resource) => resource.id === "local-identity-postgres",
        ).type = "wrong-postgres-type";
      },
      (state) => {
        state.resources.find(
          (resource) => resource.id === "local-identity-state",
        ).cleanup.status = "closed";
      },
      (state) => {
        state.resources.find(
          (resource) => resource.id === "local-identity-state",
        ).identity.providerBindings = 1;
      },
      (state) => {
        state.resources.find(
          (resource) => resource.id === "local-identity-state",
        ).identity.initialized = false;
      },
      (state) => {
        state.resources.find(
          (resource) => resource.id === "local-identity-admin-3",
        ).identity.operation = "initialize";
      },
      (state) => {
        state.resources.find(
          (resource) => resource.id === "local-identity-admin-2",
        ).identity.pid = null;
      },
      (state) => {
        state.resources.find(
          (resource) => resource.id === "local-identity-admin-4",
        ).identity.childSignal = "SIGTERM";
      },
      (state) => {
        state.resources.find(
          (resource) => resource.id === "local-identity-admin-1",
        ).identity.generation = 2;
      },
      (state) => {
        state.resources.find(
          (resource) => resource.id === "local-identity-admin-2",
        ).identity.exitCode = 1;
      },
      (state) => {
        state.resources.find(
          (resource) => resource.id === "local-identity-preview-1",
        ).identity.exitCode = 0;
      },
      (state) => {
        state.resources.find(
          (resource) => resource.id === "local-identity-preview-2",
        ).identity.childSignal = "SIGINT";
      },
      (state) => {
        state.resources.find(
          (resource) => resource.id === "local-identity-preview-1",
        ).identity.generation = 2;
      },
      (state) => {
        state.resources.find(
          (resource) => resource.id === "local-identity-preview-1",
        ).identity.pid = null;
      },
      (state) => {
        state.resources.find(
          (resource) => resource.id === "local-identity-preview-1",
        ).identity.requestedSignal = "SIGINT";
      },
      (state) => {
        state.resources.find(
          (resource) => resource.id === "local-identity-preview-2",
        ).identity.expectedExitCode = 143;
      },
      (state) => {
        state.resources.find(
          (resource) => resource.id === "local-identity-preview-2",
        ).identity.readinessVersion = 2;
      },
      (state) => {
        state.resources.find(
          (resource) => resource.id === "local-identity-preview-2",
        ).identity.listenerCount = 1;
      },
      (state) => {
        delete state.resources.find(
          (resource) => resource.id === "local-identity-postgres",
        ).recovery;
      },
      (state) => {
        state.resources.find(
          (resource) => resource.id === "local-identity-postgres",
        ).recovery.environment.DOCKER_HOST = "tcp://127.0.0.1:2375";
      },
      (state) => {
        const inspectCommand = state.resources.find(
          (resource) => resource.id === "local-identity-postgres",
        ).recovery.inspectCommand;
        inspectCommand[inspectCommand.length - 1] = "unowned-container";
      },
      (state) => {
        state.resources.find(
          (resource) => resource.id === "local-identity-postgres",
        ).recovery.requiredLabel = "wrong-owner=true";
      },
      (state) => {
        state.resources.find(
          (resource) => resource.id === "local-identity-state",
        ).recovery.stateRoot = "relative/state";
      },
      (state) => {
        state.resources.find(
          (resource) => resource.id === "local-identity-state",
        ).recovery.instruction = "remove it";
      },
      ...[
        "local-identity-admin-1",
        "local-identity-admin-2",
        "local-identity-admin-3",
        "local-identity-admin-4",
        "local-identity-preview-1",
        "local-identity-preview-2",
      ].map(
        (id) => (state) => {
          const resource = state.resources.find(
            (candidate) => candidate.id === id,
          );
          resource.recovery.processGroupId = resource.identity.pid + 1;
        },
      ),
      (state) => {
        state.resources.push(
          completed(
            "local-identity-admin-5",
            "local-identity-admin-process",
            "exited",
            {
              operation: "initialize",
              generation: 1,
              pid: 4205,
              exitCode: 0,
              childSignal: null,
            },
          ),
        );
      },
      (state) => {
        state.resources.push(
          completed(
            "local-identity-rogue",
            "rogue-type",
            "removed",
          ),
        );
      },
      (state) => {
        state.resources.push(
          completed(
            "local-identity-preview-3",
            "local-identity-preview-process",
            "exited",
            {
              generation: 3,
              pid: 4303,
              requestedSignal: "SIGTERM",
              expectedExitCode: 143,
              exitCode: 143,
              childSignal: null,
              readinessVersion: 1,
              listenerCount: 0,
            },
          ),
        );
      },
    ];
    for (const mutate of invalidLocalEvidence) {
      const invalid = structuredClone(validLifecycle);
      mutate(invalid);
      await writeFile(journalPath, `${JSON.stringify(invalid)}\n`, {
        mode: 0o600,
      });
      await assert.rejects(
        gate.assertRestartSmokeLifecycleEvidence(diagnostics, {
          commandSucceeded: true,
        }),
        /local-identity/,
      );
    }
    await writeFile(journalPath, `${JSON.stringify(validLifecycle)}\n`, {
      mode: 0o600,
    });

    if (process.platform !== "win32") {
      await chmod(journalPath, 0o644);
      await assert.rejects(
        gate.assertPackagedSmokeLifecycleEvidence(diagnostics, {
          commandSucceeded: true,
        }),
        /mode 0600/,
      );
      await chmod(journalPath, 0o600);
    }

    const linkedDiagnostics = path.join(root, "linked-packaging-smoke");
    await symlink(diagnostics, linkedDiagnostics, "dir");
    await assert.rejects(
      gate.assertPackagedSmokeLifecycleEvidence(linkedDiagnostics, {
        commandSucceeded: true,
      }),
      /not a real directory/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("disposable workspace identity is durable before preparation and fails closed on replacement", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "gate-workspace-identity-test-"));
  const diagnostics = path.join(root, "diagnostics");
  await mkdir(diagnostics);
  let ownership;
  try {
    await assert.rejects(
      prepareDisposableWorkspace(diagnostics, undefined, {
        onWorkspaceCreated(value) {
          ownership = value;
        },
        async beforeWorkspacePreparation() {
          throw new Error("injected first preparation failure");
        },
      }),
      /injected first preparation failure/,
    );
    const marker = JSON.parse(
      await readFile(path.join(diagnostics, "workspace-ownership.json"), "utf8"),
    );
    assert.equal(marker.workspace, ownership.workspace);
    assert.equal(marker.ownershipMarker, ownership.ownershipMarker);
    assert.equal(marker.ownershipMarkerPath, ownership.ownershipMarkerPath);
    assert.equal(marker.workspaceMarkerPath, ownership.workspaceMarkerPath);
    assert.equal(marker.device, ownership.device);
    assert.equal(marker.inode, ownership.inode);
    const workspaceMarkerContent = await readFile(
      ownership.workspaceMarkerPath,
      "utf8",
    );
    const workspaceMarker = JSON.parse(workspaceMarkerContent);
    assert.equal(workspaceMarker.schemaVersion, 1);
    assert.equal(workspaceMarker.workspace, ownership.workspace);
    assert.equal(workspaceMarker.ownershipMarker, ownership.ownershipMarker);
    assert.equal(workspaceMarker.device, ownership.device);
    assert.equal(workspaceMarker.inode, ownership.inode);
    assert.equal(
      await assertDisposableWorkspaceOwnership(ownership),
      ownership.workspace,
    );

    await writeFile(
      ownership.ownershipMarkerPath,
      `${JSON.stringify({
        ...marker,
        ownershipMarkerPath: path.join(root, "replacement-ownership.json"),
      })}\n`,
    );
    await assert.rejects(
      assertDisposableWorkspaceOwnership(ownership),
      /marker did not verify/,
    );
    await writeFile(
      ownership.ownershipMarkerPath,
      `${JSON.stringify(marker)}\n`,
    );

    await writeFile(
      ownership.workspaceMarkerPath,
      `${JSON.stringify({ ...workspaceMarker, ownershipMarker: "replacement" })}\n`,
    );
    await assert.rejects(
      assertDisposableWorkspaceOwnership(ownership),
      /changed identity/,
    );
    await writeFile(ownership.workspaceMarkerPath, workspaceMarkerContent);
    assert.equal(
      await assertDisposableWorkspaceOwnership(ownership),
      ownership.workspace,
    );

    await writeFile(ownership.workspaceMarkerPath, "{not-json\n");
    await assert.rejects(
      assertDisposableWorkspaceOwnership(ownership),
      /changed identity/,
    );
    await writeFile(ownership.workspaceMarkerPath, workspaceMarkerContent);

    if (process.platform !== "win32") {
      await chmod(ownership.workspaceMarkerPath, 0o644);
      await assert.rejects(
        assertDisposableWorkspaceOwnership(ownership),
        /changed identity/,
      );
      await chmod(ownership.workspaceMarkerPath, 0o600);
    }

    await rm(ownership.workspaceMarkerPath);
    await assert.rejects(
      assertDisposableWorkspaceOwnership(ownership),
      /changed identity/,
    );
    await writeFile(ownership.workspaceMarkerPath, workspaceMarkerContent, {
      mode: 0o600,
    });

    const decoyMarkerPath = path.join(root, "decoy-workspace-marker.json");
    await writeFile(decoyMarkerPath, workspaceMarkerContent, { mode: 0o600 });
    await rm(ownership.workspaceMarkerPath);
    await symlink(decoyMarkerPath, ownership.workspaceMarkerPath);
    await assert.rejects(
      assertDisposableWorkspaceOwnership(ownership),
      /changed identity/,
    );
    await rm(ownership.workspaceMarkerPath);
    await writeFile(ownership.workspaceMarkerPath, workspaceMarkerContent, {
      mode: 0o600,
    });
    assert.equal(
      await assertDisposableWorkspaceOwnership(ownership),
      ownership.workspace,
    );

    await rm(ownership.workspace, { recursive: true, force: true });
    await mkdir(ownership.workspace);
    await assert.rejects(
      assertDisposableWorkspaceOwnership(ownership),
      /changed identity/,
    );
    await rm(ownership.workspace, { recursive: true, force: true });
    await symlink(root, ownership.workspace);
    await assert.rejects(
      assertDisposableWorkspaceOwnership(ownership),
      /changed identity/,
    );
  } finally {
    if (ownership?.workspace) {
      await rm(ownership.workspace, { recursive: true, force: true });
    }
    await rm(root, { recursive: true, force: true });
  }
});

test("disposable workspace records external ownership before internal marker setup", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "gate-workspace-recovery-test-"));
  const diagnostics = path.join(root, "diagnostics");
  await mkdir(diagnostics);
  let ownership;
  try {
    await assert.rejects(
      prepareDisposableWorkspace(diagnostics, undefined, {
        async onWorkspaceCreated(value) {
          ownership = value;
          await writeFile(path.join(value.workspace, ".git"), "blocking file\n", {
            mode: 0o600,
          });
        },
      }),
    );
    const marker = JSON.parse(
      await readFile(path.join(diagnostics, "workspace-ownership.json"), "utf8"),
    );
    assert.equal(marker.schemaVersion, 1);
    assert.equal(marker.workspace, ownership.workspace);
    assert.equal(marker.ownershipMarker, ownership.ownershipMarker);
    assert.equal(marker.ownershipMarkerPath, ownership.ownershipMarkerPath);
    assert.equal(marker.workspaceMarkerPath, ownership.workspaceMarkerPath);
    assert.equal(marker.device, ownership.device);
    assert.equal(marker.inode, ownership.inode);
  } finally {
    if (ownership?.workspace) {
      await rm(ownership.workspace, { recursive: true, force: true });
    }
    await rm(root, { recursive: true, force: true });
  }
});

test("checked-in gate manifest contains the complete approved lifecycle in order", () => {
  const validate = new Ajv2020({ strict: true, allErrors: true }).compile(schema);
  assert.equal(validate(manifest), true, JSON.stringify(validate.errors));
  assert.deepEqual(validatePhaseManifest(manifest), []);
  assert.deepEqual(validateApprovedPhaseCommands(manifest), []);
  assert.deepEqual(
    manifest.phases.map(({ id }) => id),
    [
      "contract-baseline",
      "documentation",
      "backend-unit-build",
      "backend-database",
      "local-orchestrator",
      "eval-fixtures",
      "eval-deterministic-scenarios",
      "web-production-build",
      "harbor-static",
      "restart-smoke",
      "packaged-composition-smoke",
      "repository-integrity",
    ],
  );
  assert.equal(manifest.phases[9].kind, "restart-smoke");
  assert.equal(manifest.phases[10].kind, "packaged-smoke");
  assert.equal(manifest.phases[10].terminationGraceMs, 180_000);
  assert.equal(manifest.phases[10].ownerStep, "02");
  assert.deepEqual(manifest.supportedModes, [
    {
      id: "hosted-baseline",
      status: "active",
      successorModes: [],
      requiredEvidenceClasses: ["contract", "build", "state", "restart", "integrity"],
    },
    {
      id: "local-identity-preview",
      status: "active",
      successorModes: [],
      requiredEvidenceClasses: ["contract", "build", "state", "restart", "integrity"],
    },
    { id: "local-database-preview", status: "active", successorModes: [], requiredEvidenceClasses: ["contract", "build", "state", "restart", "integrity"] },
    { id: "local-model-preview", status: "active", successorModes: [], requiredEvidenceClasses: ["contract", "build", "state", "restart", "integrity"] },
  ]);
  const dualModePhases = new Set([
    "contract-baseline",
    "documentation",
    "backend-unit-build",
    "backend-database",
    "restart-smoke",
    "packaged-composition-smoke",
    "repository-integrity",
  ]);
  for (const phase of manifest.phases) {
    assert.deepEqual(
      phase.modes,
      dualModePhases.has(phase.id)
        ? ["hosted-baseline", "local-identity-preview", "local-database-preview", "local-model-preview"]
        : ["hosted-baseline"],
    );
  }
  assert.deepEqual(
    manifest.phases.map((phase) => phase.commands.map((command) => command.argv)),
    [
      [
        [
          "node",
          "--test",
          "scripts/local-migration/check-contract-baseline.test.mjs",
          "scripts/local-migration/gate-runner.test.mjs",
          "scripts/local-migration/gate-phases.test.mjs",
          "scripts/local-migration/restart-smoke.test.mjs",
          "scripts/local-migration/test-database.test.mjs",
          "scripts/local-migration/web-support-smoke.test.mjs",
          "scripts/local-migration/eval-test-discovery.test.mjs",
          "scripts/local-migration/toolchain-contract.test.mjs",
          "scripts/local-migration/ci-path-filters.test.mjs",
          "scripts/local-migration/runtime-process.test.mjs",
          "scripts/local-migration/web-runtime-config.test.mjs",
          "scripts/local-migration/runtime-resources.test.mjs",
          "scripts/local-migration/packaging-smoke.test.mjs",
          "scripts/local-migration/local-database-smoke.test.mjs",
          "scripts/local-migration/local-model-smoke.test.mjs",
        ],
        ["node", "scripts/local-migration/check-contract-baseline.mjs"],
      ],
      [
        ["node", "--test", "scripts/check-markdown-links.test.mjs"],
        ["node", "scripts/check-markdown-links.mjs"],
      ],
      [
        ["pnpm", "--filter", "backend", "prisma:generate"],
        ["pnpm", "--filter", "backend", "typecheck:seed"],
        ["pnpm", "--filter", "backend", "build"],
        ["pnpm", "--filter", "backend", "test:unit"],
        ["pnpm", "--filter", "backend", "test:local-model"],
      ],
      [
        ["pnpm", "--filter", "backend", "exec", "prisma", "migrate", "deploy"],
        ["pnpm", "--filter", "backend", "test:integration"],
        ["pnpm", "--filter", "backend", "test:e2e:tests-only"],
        ["pnpm", "--filter", "backend", "test:local-database"],
      ],
      [
        ["pnpm", "--filter", "local-orchestrator", "test"],
        ["pnpm", "--filter", "local-orchestrator", "lint"],
        ["pnpm", "--filter", "local-orchestrator", "build"],
      ],
      [["pnpm", "eval:verify"]],
      [
        ["pnpm", "eval:run", "--scenario", "samir-desai-i9-template-smoke"],
        ["pnpm", "eval:run", "--scenario", "elena-marquez-i9-template-smoke"],
      ],
      [["pnpm", "--filter", "web", "build"]],
      [["bash", "examples/eval-harbor/scripts/check_static.sh"]],
      [["node", "scripts/local-migration/restart-smoke.mjs"]],
      [["node", "scripts/local-migration/packaging-smoke.mjs"]],
      [["node", "scripts/local-migration/check-generated-integrity.mjs"]],
    ],
  );
});

test("dedicated CI seeds the exact offline pnpm Corepack cache before invoking the gate", async () => {
  const workflow = await readFile(
    new URL("../../.github/workflows/local-migration-baseline.yml", import.meta.url),
    "utf8",
  );
  const seed = workflow.indexOf("corepack prepare pnpm@10.25.0 --activate");
  const gate = workflow.indexOf("run: pnpm migration:gate");
  assert.ok(seed >= 0, "workflow must seed the pnpm 10.25.0 Corepack cache");
  assert.ok(gate > seed, "workflow must seed Corepack before running the gate");
});

test("dedicated CI enforces the reviewed 153/165-minute workflow budget", async () => {
  const workflow = parseYaml(
    await readFile(
      new URL("../../.github/workflows/local-migration-baseline.yml", import.meta.url),
      "utf8",
    ),
  );
  const job = workflow.jobs["local-migration-baseline"];
  assert.equal(job["timeout-minutes"], 165);
  const expected = [
    ["actions/checkout@v4", 5],
    ["pnpm/action-setup@v6.0.8", 5],
    ["actions/setup-node@v4", 5],
    ["actions/setup-python@v5", 5],
    ["Verify toolchain and seed offline Corepack runtime", 5],
    ["Install dependencies", 15],
    ["Run the Local Migration Baseline Gate", 108],
    ["Persist sanitized gate evidence", 5],
  ];
  assert.deepEqual(
    job.steps.map((step) => [step.uses ?? step.name, step["timeout-minutes"]]),
    expected,
  );
  assert.equal(
    job.steps.reduce((sum, step) => sum + step["timeout-minutes"], 0),
    153,
  );
  assert.equal(job["timeout-minutes"] - 153, 12);
  const evidence = job.steps.at(-1);
  assert.equal(evidence.if, "always()");
  assert.equal(
    job.steps.at(-2).env.MIGRATION_GATE_CI_SUMMARY_PATH,
    "${{ runner.temp }}/local-migration-gate-summary.json",
  );
  assert.match(
    evidence.run,
    /\$RUNNER_TEMP\/local-migration-gate-summary\.json/,
  );
  assert.match(evidence.run, /\$GITHUB_STEP_SUMMARY/);
});

test("external CI evidence is restricted to the exact runner-temp path and sanitized", async () => {
  const root = await mkdtemp("/tmp/local-migration-summary-test-");
  const requested = `${root}/local-migration-gate-summary.json`;
  const expected = `${await realpath(root)}/local-migration-gate-summary.json`;
  try {
    assert.equal(
      await persistExternalGateSummary(
        {
          RUNNER_TEMP: root,
          MIGRATION_GATE_CI_SUMMARY_PATH: requested,
        },
        { status: "failed", message: "Bearer summary-secret" },
      ),
      expected,
    );
    const written = await readFile(expected, "utf8");
    assert.equal(written.includes("summary-secret"), false);
    assert.match(written, /<redacted>/);
    await assert.rejects(
      persistExternalGateSummary(
        {
          RUNNER_TEMP: root,
          MIGRATION_GATE_CI_SUMMARY_PATH: `${root}/unexpected.json`,
        },
        { status: "passed" },
      ),
      /exact runner temporary summary path/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("backend build and seed configs pin production and smoke entrypoints", async () => {
  const [backendTsconfig, seedTsconfig] = await Promise.all(
    ["../../apps/backend/tsconfig.json", "../../apps/backend/tsconfig.seed.json"].map(
      async (relativePath) =>
        JSON.parse(await readFile(new URL(relativePath, import.meta.url), "utf8")),
    ),
  );
  assert.equal(backendTsconfig.compilerOptions.rootDir, "./src");
  assert.equal(backendTsconfig.compilerOptions.outDir, "./dist");
  assert.equal(
    backendTsconfig.compilerOptions.tsBuildInfoFile,
    "./dist/tsconfig.tsbuildinfo",
  );
  assert.equal(
    backendTsconfig.compilerOptions.tsBuildInfoFile.startsWith(
      `${backendTsconfig.compilerOptions.outDir}/`,
    ),
    true,
  );
  assert.deepEqual(seedTsconfig.include, [
    "prisma/seed.ts",
    "prisma/seed-catalog-smoke.ts",
  ]);
  assert.equal(seedTsconfig.compilerOptions.rootDir, ".");
  const backendJest = require("./apps/backend/jest.config.js");
  const unit = backendJest.projects.find(
    (project) => project.displayName === "unit",
  );
  assert.ok(unit.testMatch.includes("<rootDir>/test/contracts/**/*.spec.ts"));
});

test("approved command policy rejects substitution, removal, unknown commands, and eval indirection", () => {
  for (const mutate of [
    (candidate) => {
      candidate.phases[0].commands[0].argv = ["true"];
    },
    (candidate) => {
      candidate.phases[2].commands.pop();
    },
    (candidate) => {
      candidate.phases[4].commands.push({ argv: ["curl", "https://example.test"] });
    },
    (candidate) => {
      candidate.phases[8].commands[0].argv = ["bash", "-c", "true"];
    },
    (candidate) => {
      candidate.phases[10].commands[0].argv = ["node", "-e", "process.exit(0)"];
    },
  ]) {
    const candidate = structuredClone(manifest);
    mutate(candidate);
    assert.ok(validateApprovedPhaseCommands(candidate).length > 0);
  }
});

test("packaged smoke and final integrity retain their exact reviewed transition semantics", () => {
  const mutations = [
    (candidate) => {
      candidate.phases[10].predecessors = ["harbor-static"];
    },
    (candidate) => {
      candidate.phases[10].evidenceClasses.push("state");
    },
    (candidate) => {
      candidate.phases[10].evidenceClasses = ["build", "restart"];
    },
    (candidate) => {
      candidate.phases[10].modes.push("future-mode");
    },
    (candidate) => {
      candidate.phases[11].predecessors = ["restart-smoke"];
    },
  ];

  for (const mutate of mutations) {
    const candidate = structuredClone(manifest);
    mutate(candidate);
    assert.ok(
      validatePhaseManifest(candidate).length > 0,
      `mutation should violate the reviewed transition contract: ${JSON.stringify(
        candidate.phases.slice(10).map(({ id, modes, evidenceClasses, predecessors }) => ({
          id,
          modes,
          evidenceClasses,
          predecessors,
        })),
      )}`,
    );
  }
});

test("phase manifest schema rejects unknown fields and incomplete lifecycle records", () => {
  const validate = new Ajv2020({ strict: true, allErrors: true }).compile(schema);
  const invalid = structuredClone(manifest);
  invalid.phases[0].unexpected = true;
  delete invalid.phases[0].timeoutMs;
  assert.equal(validate(invalid), false);
  assert.ok(validate.errors.some((error) => error.keyword === "additionalProperties"));
  assert.ok(validate.errors.some((error) => error.keyword === "required"));
});

test("every phase has explicit transition metadata and no live-provider dependency", () => {
  for (const phase of manifest.phases) {
    assert.equal(
      phase.ownerStep,
      phase.id === "packaged-composition-smoke" ? "02" : "01",
    );
    assert.equal(phase.status, "active");
    assert.ok(Number.isInteger(phase.timeoutMs) && phase.timeoutMs > 0);
    assert.ok(phase.retirementCondition.length > 20);
    assert.ok(Array.isArray(phase.replacementEvidence));
    assert.ok(phase.modes.includes("hosted-baseline"));
    assert.ok(phase.evidenceClasses.length > 0);
  }
  const commands = JSON.stringify(manifest.phases.flatMap((phase) => phase.commands));
  for (const prohibited of [
    "AUTH0_CLIENT_SECRET",
    "GOOGLE_APPLICATION_CREDENTIALS",
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "eval-harbor:smoke",
    "pnpm install",
    "docker pull",
  ]) {
    assert.equal(commands.includes(prohibited), false, prohibited);
  }
});

test("the outer gate grants restart smoke more time than its cumulative cleanup budget", () => {
  assert.ok(
    RESTART_SMOKE_TERMINATION_GRACE_MS >
      RESTART_SMOKE_BOUNDED_CLEANUP_BUDGET_MS,
  );
  assert.equal(
    terminationGraceForPhase({ kind: "restart-smoke" }),
    RESTART_SMOKE_TERMINATION_GRACE_MS,
  );
  assert.equal(
    terminationGraceForPhase({
      kind: "packaged-smoke",
      terminationGraceMs: 180_000,
    }),
    180_000,
  );
  assert.equal(terminationGraceForPhase({ kind: "command" }), 5_000);
});

test("active phase timeouts retain the reviewed global gate windows", () => {
  const active = manifest.phases.filter(({ status }) => status === "active");
  assert.deepEqual(
    active.map(({ timeoutMs }) => timeoutMs),
    [
      120_000,
      120_000,
      600_000,
      900_000,
      300_000,
      300_000,
      600_000,
      600_000,
      300_000,
      600_000,
      900_000,
      300_000,
    ],
  );
  assert.equal(
    active.reduce((sum, phase) => sum + phase.timeoutMs, 0),
    94 * 60_000,
  );
});

test("gate-wide monotonic deadlines cap preflight, phases, settlement, and cleanup", () => {
  let now = 10_000;
  const timeline = createGateTimeline({ startedAt: now, now: () => now });
  assert.deepEqual(GATE_TIMELINE_MS, {
    preflight: 3 * 60_000,
    phaseCancellation: 97 * 60_000,
    childSettlement: 100 * 60_000,
    finalCleanup: 103 * 60_000,
  });
  assert.equal(timeline.remaining("preflight"), 3 * 60_000);
  now += 3 * 60_000;
  assert.equal(timeline.remaining("preflight"), 0);
  assert.throws(() => timeline.assertBefore("preflight"), /preflight deadline/);

  now = 10_000 + 96 * 60_000;
  assert.equal(
    effectivePhaseTimeoutMs({
      phaseTimeoutMs: 15 * 60_000,
      phaseStartedAt: now,
      timeline,
    }),
    60_000,
  );
  now = 10_000 + 103 * 60_000;
  assert.throws(() => timeline.assertBefore("finalCleanup"), /final cleanup deadline/);
});

test("real monotonic fractional timestamps still produce an integer command timeout", () => {
  const timeline = createGateTimeline({
    startedAt: 10_000.125,
    now: () => 10_000.875,
  });
  const timeoutMs = effectivePhaseTimeoutMs({
    phaseTimeoutMs: 120_000,
    phaseStartedAt: 10_000.25,
    timeline,
  });
  assert.equal(Number.isInteger(timeoutMs), true);
  assert.equal(timeoutMs, 119_999);
});

test("deadline controller aborts a forced hang using an injected fake clock", async () => {
  let scheduled;
  let cancelled = false;
  const deadline = createDeadlineAbortController({
    startedAt: 1_000,
    deadlineOffsetMs: 500,
    label: "forced acquisition",
    now: () => 1_100,
    schedule(callback, milliseconds) {
      scheduled = { callback, milliseconds };
      return 41;
    },
    cancel(timer) {
      assert.equal(timer, 41);
      cancelled = true;
    },
  });
  assert.equal(scheduled.milliseconds, 400);
  const hung = new Promise((resolve, reject) => {
    deadline.signal.addEventListener(
      "abort",
      () => reject(deadline.signal.reason),
      { once: true },
    );
  });
  scheduled.callback();
  await assert.rejects(hung, /forced acquisition deadline exceeded/);
  deadline.dispose();
  assert.equal(cancelled, true);

  const expired = createDeadlineAbortController({
    startedAt: 1_000,
    deadlineOffsetMs: 500,
    label: "already expired",
    now: () => 1_500,
    schedule() {
      throw new Error("expired deadlines must not defer through the scheduler");
    },
  });
  assert.equal(expired.signal.aborted, true);
  assert.match(expired.signal.reason.message, /already expired deadline exceeded/);
  expired.dispose();
});

test("final cleanup gets one lazy three-minute window capped by T+103", () => {
  const scheduled = [];
  let now = 5_000;
  const timeline = createGateTimeline({ startedAt: now, now: () => now });
  const early = createFinalCleanupAbortController({
    timeline,
    schedule(callback, milliseconds) {
      scheduled.push({ callback, milliseconds });
      return scheduled.length;
    },
    cancel() {},
  });
  assert.equal(scheduled.length, 0, "cleanup timer must be lazy");
  now += 60_000;
  early.start();
  assert.equal(scheduled[0].milliseconds, 180_000);
  early.start();
  assert.equal(scheduled.length, 1, "cleanup timer must be memoized");
  early.dispose();

  now = 5_000 + 102 * 60_000;
  const late = createFinalCleanupAbortController({
    timeline,
    schedule(callback, milliseconds) {
      scheduled.push({ callback, milliseconds });
      return scheduled.length;
    },
    cancel() {},
  });
  late.start();
  assert.equal(scheduled[1].milliseconds, 60_000);
  late.dispose();
});

function controlledDeadlineFactory(records) {
  return ({ label, parentSignal }) => {
    const controller = new AbortController();
    const parentAbort = () =>
      controller.abort(parentSignal.reason ?? new Error(`${label} cancelled`));
    parentSignal?.addEventListener("abort", parentAbort, { once: true });
    if (parentSignal?.aborted) parentAbort();
    const record = {
      controller,
      disposed: false,
      dispose() {
        record.disposed = true;
        parentSignal?.removeEventListener("abort", parentAbort);
      },
    };
    records.set(label, record);
    return { signal: controller.signal, dispose: record.dispose };
  };
}

function controlledCleanupFactory(record) {
  return () => {
    const controller = new AbortController();
    return {
      start() {
        record.starts += 1;
        record.controller = controller;
        return controller.signal;
      },
      dispose() {
        record.disposed = true;
      },
    };
  };
}

function rejectWhenAborted(signal) {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), {
      once: true,
    });
  });
}

test("production gate orchestration bounds acquisition and cleans after settlement", async () => {
  const deadlines = new Map();
  const cleanupRecord = { starts: 0, disposed: false };
  const events = [];
  const timeline = createGateTimeline({ startedAt: 0, now: () => 1 });
  const running = runBoundedGateStages({
    timeline,
    cancellationSignal: new AbortController().signal,
    deadlineFactory: controlledDeadlineFactory(deadlines),
    finalCleanupFactory: controlledCleanupFactory(cleanupRecord),
    execute: async ({ preflightSignal }) => {
      events.push("acquisition-started");
      await rejectWhenAborted(preflightSignal);
      events.push("work-must-not-run");
    },
    cleanup: async () => {
      events.push("cleanup");
    },
  });
  deadlines.get("preflight").controller.abort(
    new Error("preflight deadline exceeded"),
  );
  const outcome = await running;
  assert.match(outcome.primaryError.message, /preflight deadline exceeded/);
  assert.deepEqual(events, ["acquisition-started", "cleanup"]);
  assert.equal(outcome.childSettlementAttempted, true);
  assert.equal(cleanupRecord.starts, 1);
  assert.equal(cleanupRecord.disposed, true);
});

test("production gate orchestration settles failed work before its one cleanup", async () => {
  const deadlines = new Map();
  const cleanupRecord = { starts: 0, disposed: false };
  const events = [];
  const baseTimeline = createGateTimeline({ startedAt: 0, now: () => 1 });
  const timeline = {
    ...baseTimeline,
    assertBefore(stage) {
      events.push(`assert-${stage}`);
      return baseTimeline.assertBefore(stage);
    },
  };
  const running = runBoundedGateStages({
    timeline,
    cancellationSignal: new AbortController().signal,
    deadlineFactory: controlledDeadlineFactory(deadlines),
    finalCleanupFactory: controlledCleanupFactory(cleanupRecord),
    execute: async ({ completePreflight, workSignal }) => {
      completePreflight();
      events.push("work-started");
      await rejectWhenAborted(workSignal);
    },
    cleanup: async () => {
      events.push("cleanup");
    },
  });
  deadlines.get("phase cancellation").controller.abort(
    new Error("phase cancellation deadline exceeded"),
  );
  const outcome = await running;
  assert.match(outcome.primaryError.message, /phase cancellation deadline/);
  assert.ok(
    events.indexOf("assert-childSettlement") < events.indexOf("cleanup"),
  );
  assert.equal(cleanupRecord.starts, 1);
});

test("settled work disposes T+97 before final cleanup crosses that boundary", async () => {
  const deadlines = new Map();
  const cleanupRecord = { starts: 0, disposed: false };
  let now = 1;
  const timeline = createGateTimeline({ startedAt: 0, now: () => now });
  const outcome = await runBoundedGateStages({
    timeline,
    cancellationSignal: new AbortController().signal,
    deadlineFactory: controlledDeadlineFactory(deadlines),
    finalCleanupFactory: controlledCleanupFactory(cleanupRecord),
    execute: async ({ completePreflight, confirmChildSettlement }) => {
      completePreflight();
      now = 96 * 60_000;
      confirmChildSettlement();
      return { status: "passed" };
    },
    cleanup: async ({ workSignal }) => {
      now = 98 * 60_000;
      assert.equal(
        deadlines.get("phase cancellation").disposed,
        true,
        "the phase timer must be cancelled before cleanup starts",
      );
      assert.equal(workSignal.aborted, false);
    },
  });
  assert.equal(outcome.primaryError, undefined);
  assert.deepEqual(outcome.secondaryErrors, []);
});

test("phase and parent cancellation cannot be swallowed by a normally resolving callback", async () => {
  for (const source of ["phase", "parent"]) {
    const deadlines = new Map();
    const cleanupRecord = { starts: 0, disposed: false };
    const parent = new AbortController();
    const reason = new Error(`${source} cancellation sentinel`);
    const outcome = await runBoundedGateStages({
      timeline: createGateTimeline({ startedAt: 0, now: () => 1 }),
      cancellationSignal: parent.signal,
      deadlineFactory: controlledDeadlineFactory(deadlines),
      finalCleanupFactory: controlledCleanupFactory(cleanupRecord),
      execute: async ({ completePreflight, confirmChildSettlement }) => {
        completePreflight();
        if (source === "phase") {
          deadlines.get("phase cancellation").controller.abort(reason);
        } else {
          parent.abort(reason);
        }
        confirmChildSettlement();
        return { status: "passed" };
      },
      cleanup: async () => {},
    });
    assert.equal(outcome.primaryError, reason);
    assert.equal(cleanupRecord.starts, 1);
  }
});

test("cancellation triggered by finalization cannot be swallowed", async () => {
  const deadlines = new Map();
  const cleanupRecord = { starts: 0, disposed: false };
  const parent = new AbortController();
  const reason = new Error("finalization cancellation sentinel");
  const outcome = await runBoundedGateStages({
    timeline: createGateTimeline({ startedAt: 0, now: () => 1 }),
    cancellationSignal: parent.signal,
    deadlineFactory: controlledDeadlineFactory(deadlines),
    finalCleanupFactory: controlledCleanupFactory(cleanupRecord),
    execute: async ({ completePreflight, confirmChildSettlement }) => {
      completePreflight();
      confirmChildSettlement();
      return { status: "running" };
    },
    cleanup: async () => {},
    finalize: async () => {
      parent.abort(reason);
    },
  });
  assert.equal(outcome.primaryError, undefined);
  assert.ok(outcome.secondaryErrors.includes(reason));
});

test("non-cooperative work is not abandoned and remains bounded only by the workflow step", async () => {
  const deadlines = new Map();
  const cleanupRecord = { starts: 0, disposed: false };
  const release = Promise.withResolvers();
  let cleanupRan = false;
  let settled = false;
  const running = runBoundedGateStages({
    timeline: createGateTimeline({ startedAt: 0, now: () => 1 }),
    cancellationSignal: new AbortController().signal,
    deadlineFactory: controlledDeadlineFactory(deadlines),
    finalCleanupFactory: controlledCleanupFactory(cleanupRecord),
    execute: async ({ completePreflight }) => {
      completePreflight();
      await release.promise;
      return { status: "passed" };
    },
    cleanup: async () => {
      cleanupRan = true;
    },
  });
  running.finally(() => {
    settled = true;
  });
  deadlines.get("phase cancellation").controller.abort(
    new Error("cooperative internal budget exceeded"),
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false, "cleanup must not race live non-cooperative work");
  assert.equal(cleanupRan, false);
  release.resolve();
  const outcome = await running;
  assert.match(outcome.primaryError.message, /cooperative internal budget exceeded/);
  assert.equal(cleanupRan, true);

  const workflow = parseYaml(
    await readFile(
      new URL("../../.github/workflows/local-migration-baseline.yml", import.meta.url),
      "utf8",
    ),
  );
  const gateStep = workflow.jobs["local-migration-baseline"].steps.find(
    ({ name }) => name === "Run the Local Migration Baseline Gate",
  );
  assert.equal(gateStep["timeout-minutes"], 108);
});

test("production gate orchestration bounds cleanup and preserves settlement errors", async () => {
  const deadlines = new Map();
  const cleanupRecord = { starts: 0, disposed: false };
  const cleanupStarted = Promise.withResolvers();
  const events = [];
  const baseTimeline = createGateTimeline({ startedAt: 0, now: () => 1 });
  const timeline = {
    ...baseTimeline,
    assertBefore(stage) {
      if (stage === "childSettlement") {
        throw new Error("child settlement deadline exceeded");
      }
      return baseTimeline.assertBefore(stage);
    },
  };
  const running = runBoundedGateStages({
    timeline,
    cancellationSignal: new AbortController().signal,
    deadlineFactory: controlledDeadlineFactory(deadlines),
    finalCleanupFactory: controlledCleanupFactory(cleanupRecord),
    execute: async () => {
      throw new Error("ordinary work failure");
    },
    cleanup: async ({ signal }) => {
      cleanupStarted.resolve();
      await rejectWhenAborted(signal);
    },
    finalize: async ({ secondaryErrors }) => {
      events.push("finalize");
      assert.ok(
        secondaryErrors.some((error) =>
          /child settlement deadline exceeded/.test(error.message),
        ),
      );
      assert.ok(
        secondaryErrors.some((error) =>
          /final cleanup deadline exceeded/.test(error.message),
        ),
      );
    },
  });
  await cleanupStarted.promise;
  cleanupRecord.controller.abort(new Error("final cleanup deadline exceeded"));
  const outcome = await running;
  assert.match(outcome.primaryError.message, /ordinary work failure/);
  assert.ok(
    outcome.secondaryErrors.some((error) =>
      /child settlement deadline exceeded/.test(error.message),
    ),
  );
  assert.ok(
    outcome.secondaryErrors.some((error) =>
      /final cleanup deadline exceeded/.test(error.message),
    ),
  );
  assert.equal(cleanupRecord.starts, 1);
  assert.deepEqual(events, ["finalize"]);
});

test("late gate evidence failure leaves retained summary and lifecycle failed", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "gate-finalizer-failure-test-"));
  const source = { headSha: "a".repeat(40), dirty: false, copiedInputsSha256: "b".repeat(64) };
  try {
    const ownership = await prepareGateDiagnosticsRoot(path.join(root, "diagnostics-"));
    assert.equal(
      await assertGateDiagnosticsOwnership(ownership),
      ownership.directory,
    );
    const lifecycle = await createResourceLifecycleJournal(ownership.directory, {
      filename: "gate-resource-lifecycle.json",
    });
    const result = await finalizeGateAttemptEvidence({
      timeline: createGateTimeline({ startedAt: 0, now: () => 1 }),
      diagnosticsDirectory: ownership.directory,
      diagnosticsOwnership: ownership,
      lifecycle,
      summary: { status: "passed", phases: [], source },
      wallStartedAt: Date.now(),
      callerIntegrityVerified: true,
      cleanupErrors: [],
      signals: [],
      async persistExternal() {
        throw new Error("injected external evidence failure");
      },
      async removeDiagnostics() {
        assert.fail("failed evidence must retain diagnostics");
      },
    });
    const summary = JSON.parse(
      await readFile(path.join(ownership.directory, "summary.json"), "utf8"),
    );
    const persistedLifecycle = JSON.parse(await readFile(lifecycle.filePath, "utf8"));
    assert.deepEqual(result.summary.source, source);
    assert.equal(result.summary.status, "failed");
    assert.equal(summary.status, "failed");
    assert.equal(persistedLifecycle.status, "failed");
    assert.match(result.evidenceErrors[0].message, /external evidence failure/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("partial gate diagnostics removal leaves only non-pass internal evidence and never recreates ownership", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "gate-finalizer-removal-test-"));
  const source = { headSha: "a".repeat(40), dirty: false, copiedInputsSha256: "b".repeat(64) };
  try {
    const ownership = await prepareGateDiagnosticsRoot(path.join(root, "diagnostics-"));
    const lifecycle = await createResourceLifecycleJournal(ownership.directory, {
      filename: "gate-resource-lifecycle.json",
    });
    const externalStatuses = [];
    const result = await finalizeGateAttemptEvidence({
      timeline: createGateTimeline({ startedAt: 0, now: () => 1 }),
      diagnosticsDirectory: ownership.directory,
      diagnosticsOwnership: ownership,
      lifecycle,
      summary: { status: "passed", phases: [], source },
      wallStartedAt: Date.now(),
      callerIntegrityVerified: true,
      cleanupErrors: [],
      signals: [],
      async persistExternal(_environment, value) {
        assert.deepEqual(value.source, source);
        externalStatuses.push(value.status);
      },
      async removeDiagnostics() {
        await rm(ownership.markerPath);
        throw new Error("injected partial diagnostics removal failure");
      },
    });
    const summary = JSON.parse(
      await readFile(path.join(ownership.directory, "summary.json"), "utf8"),
    );
    const persistedLifecycle = JSON.parse(await readFile(lifecycle.filePath, "utf8"));
    assert.deepEqual(result.summary.source, source);
    assert.equal(result.summary.status, "failed");
    assert.equal(summary.status, "running");
    assert.equal(summary.cleanupPending, "automatic-diagnostics-removal");
    assert.equal(persistedLifecycle.status, "running");
    assert.deepEqual(externalStatuses, ["running", "failed"]);
    await assert.rejects(lstat(ownership.markerPath), /ENOENT/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("gate success publishes nonterminal evidence, removes diagnostics, then publishes pass", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "gate-finalizer-order-test-"));
  try {
    const ownership = await prepareGateDiagnosticsRoot(path.join(root, "diagnostics-"));
    const lifecycle = await createResourceLifecycleJournal(ownership.directory, {
      filename: "gate-resource-lifecycle.json",
    });
    const events = [];
    const result = await finalizeGateAttemptEvidence({
      timeline: createGateTimeline({ startedAt: 0, now: () => 1 }),
      diagnosticsDirectory: ownership.directory,
      diagnosticsOwnership: ownership,
      lifecycle,
      summary: { status: "running", phases: [] },
      wallStartedAt: Date.now(),
      callerIntegrityVerified: true,
      cleanupErrors: [],
      signals: [],
      async persistExternal(_environment, value) {
        events.push(`external-${value.status}`);
      },
      async removeDiagnostics(directory) {
        events.push("diagnostics-removal");
        await rm(directory, { recursive: true, force: true });
      },
    });
    assert.deepEqual(events, [
      "external-running",
      "diagnostics-removal",
      "external-passed",
    ]);
    assert.equal(result.summary.status, "passed");
    assert.equal(result.diagnosticsDirectory, null);
    assert.equal(lifecycle.state.status, "passed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("gate finalization observes cancellation raised by external persistence", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "gate-finalizer-cancel-test-"));
  const source = { headSha: "a".repeat(40), dirty: false, copiedInputsSha256: "b".repeat(64) };
  try {
    const ownership = await prepareGateDiagnosticsRoot(path.join(root, "diagnostics-"));
    const lifecycle = await createResourceLifecycleJournal(ownership.directory, {
      filename: "gate-resource-lifecycle.json",
    });
    const controller = new AbortController();
    const reason = new Error("injected cancellation from external persistence");
    const externalStatuses = [];
    let removalRan = false;
    const result = await finalizeGateAttemptEvidence({
      timeline: createGateTimeline({ startedAt: 0, now: () => 1 }),
      diagnosticsDirectory: ownership.directory,
      diagnosticsOwnership: ownership,
      lifecycle,
      summary: { status: "running", phases: [], source },
      wallStartedAt: Date.now(),
      callerIntegrityVerified: true,
      cleanupErrors: [],
      signals: [controller.signal],
      async persistExternal(_environment, value) {
        assert.deepEqual(value.source, source);
        externalStatuses.push(value.status);
        if (value.status === "running") controller.abort(reason);
      },
      async removeDiagnostics() {
        removalRan = true;
      },
    });
    assert.equal(removalRan, false);
    assert.deepEqual(result.summary.source, source);
    assert.equal(result.summary.status, "cancelled");
    assert.ok(result.evidenceErrors.includes(reason));
    assert.deepEqual(externalStatuses, ["running", "cancelled"]);
    assert.equal((await lstat(ownership.directory)).isDirectory(), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("successful preflight evidence is exact, single-line, and contains no administration URL", () => {
  assert.equal(
    formatPreflightEvidence({
      baseSha: "a".repeat(40),
      versions: {
        node: "v24.21.0",
        pnpm: "10.25.0",
        python: "3.12.14",
        postgres: "15.15",
      },
      administrationSource: "supplied-loopback-administration-url",
    }),
    `migration-gate: preflight base=${"a".repeat(40)} node=v24.21.0 pnpm=10.25.0 python=3.12.14 postgres=15.15 administration=supplied-loopback-administration-url`,
  );
});

test("disposable-workspace documentation checks cannot discover the private Corepack cache", async () => {
  const source = await readFile(new URL("./migration-gate.mjs", import.meta.url), "utf8");
  assert.match(
    source,
    /path\.join\(diagnosticsDirectory, "corepack-home"\)/,
  );
  assert.doesNotMatch(source, /path\.join\(workspace, "\.lmbg-corepack"\)/);
});

test("replacement evidence is typed, resolvable, and cannot be a free-form completion claim", () => {
  const validate = new Ajv2020({ strict: true, allErrors: true }).compile(schema);
  const invalid = structuredClone(manifest);
  invalid.phases[0].status = "retired";
  invalid.phases[0].replacementEvidence = ["done"];
  assert.equal(validate(invalid), false);

  const dangling = structuredClone(manifest);
  dangling.phases[0].status = "retired";
  dangling.phases[0].replacementEvidence = [
    {
      kind: "phase",
      phaseId: "missing-successor",
      coveredModes: ["hosted-baseline"],
      evidenceClasses: ["contract"],
    },
  ];
  assert.ok(
    validatePhaseManifest(dangling).some((error) =>
      error.includes("replacement evidence"),
    ),
  );
});

async function sourceFixture(t) {
  const { execFileSync } = await import("node:child_process");
  const root = await mkdtemp(path.join(os.tmpdir(), "gate-source-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const caller = path.join(root, "caller");
  await mkdir(caller);
  const git = (...args) =>
    execFileSync("git", ["-c", "core.hooksPath=/dev/null", ...args], {
      cwd: caller,
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_NOSYSTEM: "1",
      },
    }).trim();
  git("init", "--quiet");
  git("config", "user.name", "Fixture");
  git("config", "user.email", "fixture@invalid.local");
  await writeFile(path.join(caller, "tracked"), "first\n");
  await writeFile(path.join(caller, "deleted"), "remove later\n");
  await writeFile(
    path.join(caller, "ignored-tracked"),
    "tracked despite ignore\n",
  );
  git("add", "--all");
  git("commit", "--quiet", "--no-gpg-sign", "-m", "source");
  await writeFile(path.join(caller, ".gitignore"), "ignored-*\n");
  git("add", ".gitignore");
  git("commit", "--quiet", "--no-gpg-sign", "-m", "ignore");
  const gate = await import("./migration-gate.mjs");
  return { root, caller, git, gate };
}

test("source provenance binds copied inputs, not disposable Git or random harness metadata", async (t) => {
  const { root, caller, git, gate } = await sourceFixture(t);
  const head = git("rev-parse", "HEAD");
  const capture = async (name) => {
    const destination = path.join(root, name);
    await mkdir(destination);
    await mkdir(path.join(destination, ".git"));
    await writeFile(path.join(destination, ".git", "random-marker"), name);
    const result = await gate.copyGateSourceInputs(caller, destination);
    return { ...result, destination };
  };
  const a = await capture("a"),
    b = await capture("b");
  assert.equal(a.source.headSha, head);
  assert.equal(a.source.dirty, false);
  assert.match(a.source.copiedInputsSha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(a.source, b.source);
  assert.ok(a.files.includes("ignored-tracked"));
  assert.equal(
    a.files.some((file) => file.startsWith(".git/")),
    false,
  );
  await writeFile(path.join(caller, "ignored-untracked"), "excluded");
  const ignored = await capture("ignored");
  assert.deepEqual(ignored.source, a.source);
  await writeFile(path.join(caller, "tracked"), "staged\n");
  git("add", "tracked");
  await writeFile(path.join(caller, "tracked"), "unstaged\n");
  await writeFile(path.join(caller, "new-input"), "untracked\n");
  await rm(path.join(caller, "deleted"));
  const dirty = await capture("dirty");
  assert.equal(dirty.source.headSha, head);
  assert.equal(dirty.source.dirty, true);
  assert.notEqual(dirty.source.copiedInputsSha256, a.source.copiedInputsSha256);
  assert.equal(dirty.files.includes("deleted"), false);
  assert.ok(dirty.files.includes("new-input"));
  assert.equal(dirty.files.includes("ignored-untracked"), false);
  assert.equal(
    await readFile(path.join(dirty.destination, "tracked"), "utf8"),
    "unstaged\n",
  );
  const original = dirty.source.copiedInputsSha256;
  await writeFile(
    path.join(dirty.destination, "tracked"),
    "generated after capture",
  );
  assert.equal(dirty.source.copiedInputsSha256, original);
  // A downstream synthetic commit identifies another Git history; it cannot become caller HEAD.
  const { execFileSync } = await import("node:child_process");
  for (const args of [
    ["init", "--quiet"],
    ["add", "--all"],
    [
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@invalid.local",
      "commit",
      "--quiet",
      "--no-gpg-sign",
      "-m",
      "synthetic",
    ],
  ]) {
    execFileSync("git", ["-c", "core.hooksPath=/dev/null", ...args], {
      cwd: dirty.destination,
      env: {
        ...process.env,
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_NOSYSTEM: "1",
      },
    });
  }
  assert.notEqual(
    execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: dirty.destination,
      encoding: "utf8",
    }).trim(),
    dirty.source.headSha,
  );
});

test("source digest distinguishes copied bytes, paths, mode and literal symlink target", async (t) => {
  const { root, caller, gate } = await sourceFixture(t);
  const capture = async (label) =>
    (await gate.copyGateSourceInputs(caller, path.join(root, label))).source
      .copiedInputsSha256;
  const original = await capture("original");
  await chmod(path.join(caller, "tracked"), 0o755);
  const mode = await capture("mode");
  assert.notEqual(mode, original);
  await chmod(path.join(caller, "tracked"), 0o644);
  assert.equal(await capture("mode-restored"), original);
  await writeFile(path.join(caller, "tracked"), "new bytes");
  assert.notEqual(await capture("bytes"), original);
  await writeFile(path.join(caller, "tracked"), "first\n");
  await symlink("tracked", path.join(caller, "link"));
  const targetA = await capture("link-a");
  await rm(path.join(caller, "link"));
  await symlink("deleted", path.join(caller, "link"));
  assert.notEqual(await capture("link-b"), targetA);
  await rm(path.join(caller, "link"));
  await writeFile(path.join(caller, "renamed"), "first\n");
  await rm(path.join(caller, "tracked"));
  assert.notEqual(await capture("renamed"), original);
});

test("source observations remain available before later preparation failure and explicitly unknown before capture", async (t) => {
  const { root, caller, gate } = await sourceFixture(t);
  const observed = [];
  await assert.rejects(
    gate.copyGateSourceInputs(caller, path.join(root, "destination"), {
      onSourceCaptured(source) {
        observed.push(source);
        if (source.copiedInputsSha256)
          throw new Error("later preparation failure");
      },
    }),
    /later preparation failure/,
  );
  assert.deepEqual(observed[0], {
    headSha: null,
    dirty: null,
    copiedInputsSha256: null,
  });
  assert.match(observed.at(-1).headSha, /^[a-f0-9]{40}$/);
  assert.equal(observed.at(-1).dirty, false);
  assert.match(observed.at(-1).copiedInputsSha256, /^[a-f0-9]{64}$/);
  const unavailable = [];
  await assert.rejects(
    gate.copyGateSourceInputs(
      path.join(root, "missing"),
      path.join(root, "failed"),
      {
        onSourceCaptured(source) {
          unavailable.push(source);
        },
      },
    ),
  );
  assert.deepEqual(unavailable, [
    { headSha: null, dirty: null, copiedInputsSha256: null },
  ]);
});

for (const mode of ["full", "smoke-only"])
  for (const outcome of [
    "success",
    "failure",
    "preparation-failure",
    "cleanup-failure",
  ]) {
    test(`${mode} ${outcome} preserves source provenance through final evidence and cleanup`, async (t) => {
      const root = await mkdtemp(path.join(os.tmpdir(), "gate-source-final-"));
      t.after(() => rm(root, { recursive: true, force: true }));
      const ownership = await prepareGateDiagnosticsRoot(
        path.join(root, "diagnostics-"),
      );
      const source = {
        headSha: "a".repeat(40),
        dirty: true,
        copiedInputsSha256:
          outcome === "preparation-failure" ? null : "b".repeat(64),
      };
      const external = [];
      const result = await finalizeGateAttemptEvidence({
        timeline: createGateTimeline({ startedAt: 0, now: () => 1 }),
        mode,
        source,
        diagnosticsDirectory: ownership.directory,
        diagnosticsOwnership: ownership,
        summary: { status: "running" },
        wallStartedAt: Date.now(),
        callerIntegrityVerified: true,
        attemptError: ["failure", "preparation-failure"].includes(outcome)
          ? new Error("owned attempt failure")
          : undefined,
        cleanupErrors:
          outcome === "cleanup-failure"
            ? [new Error("owned cleanup failure")]
            : [],
        async persistExternal(_environment, value) {
          external.push(structuredClone(value));
        },
      });
      assert.deepEqual(result.summary.source, source);
      assert.equal(result.summary.mode, mode);
      assert.ok(external.length);
      for (const value of external) {
        assert.deepEqual(value.source, source);
        assert.equal(value.mode, mode);
      }
      if (outcome === "success") {
        assert.deepEqual(
          external.map((value) => value.status),
          ["running", "passed"],
        );
        assert.equal(result.diagnosticsDirectory, null);
      } else {
        assert.equal(result.summary.status, "failed");
        assert.deepEqual(
          JSON.parse(
            await readFile(
              path.join(ownership.directory, "summary.json"),
              "utf8",
            ),
          ).source,
          source,
        );
        assert.equal(
          external.some((value) => value.status === "passed"),
          false,
        );
      }
    });
  }

test("source capture rejects observed caller HEAD/status changes without inventing snapshot atomicity", async (t) => {
  const { root, caller, git, gate } = await sourceFixture(t);
  let captured;
  await assert.rejects(
    gate.copyGateSourceInputs(caller, path.join(root, "changing"), {
      onSourceCaptured(source) {
        captured = source;
        if (source.copiedInputsSha256)
          git(
            "commit",
            "--quiet",
            "--allow-empty",
            "--no-gpg-sign",
            "-m",
            "concurrent head",
          );
      },
    }),
    /caller source HEAD or status changed/,
  );
  assert.match(captured.copiedInputsSha256, /^[a-f0-9]{64}$/);
  assert.notEqual(captured.headSha, git("rev-parse", "HEAD"));
});

test("gate summaries use one monotonic attempt timeline for full and smoke finalization", async () => {
  const source = await readFile(
    new URL("./migration-gate.mjs", import.meta.url),
    "utf8",
  );
  const execute = source.slice(
    source.indexOf("async function executeGate("),
    source.indexOf("export async function runWithToolchainPreflight("),
  );
  assert.match(
    execute,
    /const timeline = suppliedTimeline \?\? createGateTimeline\(\);/,
  );
  assert.doesNotMatch(
    execute,
    /createGateTimeline\(\{ startedAt: wallStartedAt/,
  );
  assert.equal(
    (execute.match(/finalizeGateAttemptEvidence\(\{\s*timeline,/g) ?? [])
      .length,
    2,
  );
});

test("workspace preparation surfaces copied provenance before later setup fails", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "gate-prepare-source-"));
  const diagnostics = path.join(root, "diagnostics");
  await mkdir(diagnostics);
  let ownership, source;
  t.after(async () => {
    if (ownership) {
      await assertDisposableWorkspaceOwnership(ownership);
      await rm(ownership.workspace, { recursive: true });
    }
    await rm(root, { recursive: true, force: true });
  });
  await assert.rejects(
    prepareDisposableWorkspace(diagnostics, undefined, {
      onWorkspaceCreated(value) {
        ownership = value;
      },
      onSourceCaptured(value) {
        source = value;
        if (source.copiedInputsSha256)
          throw new Error("injected later setup failure");
      },
    }),
    /injected later setup failure/,
  );
  assert.match(source.headSha, /^[a-f0-9]{40}$/);
  assert.equal(typeof source.dirty, "boolean");
  assert.match(source.copiedInputsSha256, /^[a-f0-9]{64}$/);
  await assert.rejects(
    lstat(path.join(ownership.workspace, ".lmbg-git-home")),
    /ENOENT/,
  );
});

test("early finalization emits explicit unavailable source fields", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "gate-unknown-source-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const ownership = await prepareGateDiagnosticsRoot(
    path.join(root, "diagnostics-"),
  );
  let persisted;
  const result = await finalizeGateAttemptEvidence({
    timeline: createGateTimeline({ startedAt: 0, now: () => 1 }),
    diagnosticsDirectory: ownership.directory,
    diagnosticsOwnership: ownership,
    summary: { status: "failed" },
    wallStartedAt: Date.now(),
    callerIntegrityVerified: false,
    attemptError: new Error("failure before source capture"),
    async persistExternal(_env, summary) {
      persisted = structuredClone(summary);
    },
  });
  assert.deepEqual(result.summary.source, {
    headSha: null,
    dirty: null,
    copiedInputsSha256: null,
  });
  assert.deepEqual(persisted.source, result.summary.source);
});

test("smoke cancellation listeners survive through asynchronous evidence finalization", async () => {
  const source = await readFile(
    new URL("./migration-gate.mjs", import.meta.url),
    "utf8",
  );
  const execute = source.slice(
    source.indexOf("async function executeGate("),
    source.indexOf("export async function runWithToolchainPreflight("),
  );
  assert.equal((execute.match(/cancellation\.dispose\(\)/g) ?? []).length, 1);
  assert.ok(
    execute.indexOf("cancellation.dispose()") >
      execute.lastIndexOf("await finalizeGateAttemptEvidence("),
  );
  assert.match(execute, /finally\s*\{\s*cancellation\.dispose\(\);/);
});

test("each dirty category independently changes the copied snapshot and observed status", async (t) => {
  const { root, caller, git, gate } = await sourceFixture(t);
  let count = 0;
  const capture = async () =>
    gate.copyGateSourceInputs(caller, path.join(root, `capture-${count++}`));
  const baseline = await capture();
  for (const kind of [
    "staged",
    "unstaged",
    "untracked",
    "deleted",
    "tracked-but-ignored",
  ]) {
    const file =
      kind === "untracked"
        ? "new"
        : kind === "deleted"
          ? "deleted"
          : kind === "tracked-but-ignored"
            ? "ignored-tracked"
            : "tracked";
    const original =
      kind === "untracked" ? null : await readFile(path.join(caller, file));
    if (kind === "deleted") await rm(path.join(caller, file));
    else await writeFile(path.join(caller, file), `${kind} new content`);
    if (kind === "staged") git("add", file);
    const changed = await capture();
    assert.equal(changed.source.headSha, baseline.source.headSha, kind);
    assert.equal(changed.source.dirty, true, kind);
    assert.notEqual(
      changed.source.copiedInputsSha256,
      baseline.source.copiedInputsSha256,
      kind,
    );
    assert.equal(changed.files.includes(file), kind !== "deleted", kind);
    if (original === null) await rm(path.join(caller, file));
    else await writeFile(path.join(caller, file), original);
    if (kind === "staged") git("add", file);
    assert.deepEqual(
      (await capture()).source,
      baseline.source,
      `${kind} restored`,
    );
  }
  await writeFile(path.join(caller, "same-path"), "tracked");
  const regular = await capture();
  await rm(path.join(caller, "same-path"));
  await symlink("tracked", path.join(caller, "same-path"));
  const linked = await capture();
  assert.deepEqual(linked.files, regular.files);
  assert.notEqual(
    linked.source.copiedInputsSha256,
    regular.source.copiedInputsSha256,
  );
});
