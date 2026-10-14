import { localUiLifecycleResources } from './fixtures/local-ui-lifecycle.mjs';
import { localMcpLifecycleResources } from './fixtures/local-mcp-lifecycle.mjs';
import { localModelLifecycleResources } from './fixtures/local-model-lifecycle.mjs';
import { localDatabaseLifecycleResources } from "./fixtures/local-database-lifecycle.mjs";
import assert from "node:assert/strict";
import { closeSync, constants, fstatSync, openSync, renameSync, writeFileSync, unlinkSync } from "node:fs";
import {
  chmod,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import * as timingGate from "./migration-gate.mjs";
import { PACKAGING_MILESTONES, PACKAGING_OPERATIONS } from "./packaging-progress.mjs";

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

async function withTimingLog(operation) {
  const ownership = await prepareGateDiagnosticsRoot(path.join(os.tmpdir(), "gate-timing-test-"));
  const logPath = path.join(ownership.directory, "phase-11-packaged-composition-smoke-1.log");
  const log = PACKAGING_MILESTONES.filter((name) => name !== "failed")
    .map((name, index) => `packaging-smoke: milestone=${name} elapsedMs=${index}\n`).join("");
  await writeFile(logPath, log, { mode: 0o600 });
  try { await operation({ ownership, logPath, log }); }
  finally { await rm(ownership.directory, { recursive: true, force: true }); }
}

test("packaging timing collection reads only a bounded regular log in owned diagnostics", async () => {
  await withTimingLog(async ({ ownership, logPath, log }) => {
    const read = (options) => timingGate.readPackagingTimings(ownership, logPath, options);
    assert.equal((await read()).availability, "complete");
    await writeFile(logPath, log + "x".repeat(20_000));
    let bytesRequested = 0;
    let closed = false;
    const result = await read({ openFile: async (file, flags) => {
      assert.equal(file, logPath);
      assert.ok(flags & constants.O_NOFOLLOW);
      assert.ok(flags & constants.O_NONBLOCK);
      const handle = await open(file, flags);
      return {
        stat: () => handle.stat(),
        read: async (...args) => { bytesRequested += args[2]; return handle.read(...args); },
        close: async () => { closed = true; await handle.close(); },
      };
    } });
    assert.equal(result.availability, "partial");
    assert.equal(result.reason, "truncated");
    assert.ok(bytesRequested <= 16_384);
    assert.equal(closed, true);
    await rm(logPath);
    assert.equal((await read()).reason, "log-unavailable");
    await symlink(ownership.markerPath, logPath);
    assert.equal((await read()).reason, "unsafe-log");
    await rm(logPath);
    await mkdir(logPath);
    assert.equal((await read()).reason, "unsafe-log");
    assert.equal((await timingGate.readPackagingTimings(ownership, ownership.markerPath)).reason, "unsafe-log");
    assert.equal((await timingGate.readPackagingTimings({ ...ownership, nonce: "wrong" }, logPath)).reason, "ownership-invalid");
  });
});

test("packaging timing owned-log reader keeps optional operation failures separate from milestones", async () => {
  await withTimingLog(async ({ ownership, logPath, log }) => {
    const rows = PACKAGING_OPERATIONS.map((name) =>
      `packaging-smoke: operation=${name} count=0 elapsedMs=0\n`).join("");
    const detail = rows + "packaging-smoke: operations=complete\n";
    await writeFile(logPath, log + detail);
    const valid = await timingGate.readPackagingTimings(ownership, logPath);
    assert.equal(valid.availability, "complete");
    assert.equal(valid.operationTimings.availability, "complete");
    assert.equal(valid.operationTimings.operations.length, PACKAGING_OPERATIONS.length);
    for (const malformed of [
      detail.replace(rows.split("\n")[0] + "\n", ""),
      "packaging-smoke: operation=milestone-private-canary count=0 elapsedMs=0\n" + detail,
      detail.replace("operations=complete", "operations=partial"),
    ]) {
      await writeFile(logPath, log + malformed);
      const result = await timingGate.readPackagingTimings(ownership, logPath);
      assert.equal(result.availability, "complete");
      assert.deepEqual(result.milestones, valid.milestones);
      assert.equal(result.operationTimings.availability, "partial");
      assert.equal(JSON.stringify(result).includes("private-canary"), false);
    }
  });
});

test("packaging timing read and close failures or replaced files cannot escape or leak diagnostics", async () => {
  await withTimingLog(async ({ ownership, logPath }) => {
    for (const [failure, reason] of Object.entries({
      open: "log-unavailable", identity: "log-changed", nonregular: "log-changed",
      read: "read-failed", changed: "log-changed", close: "close-failed",
    })) {
      let closed = false;
      let stats = 0;
      const result = await timingGate.readPackagingTimings(ownership, logPath, {
        openFile: async (file, flags) => {
          if (failure === "open") throw new Error("private-canary");
          const handle = await open(file, flags);
          return {
            stat: async () => {
              const info = await handle.stat(); stats++;
              if (failure === "identity") info.ino++;
              if (failure === "nonregular") info.isFile = () => false;
              if (failure === "changed" && stats > 1) info.size++;
              return info;
            },
            read: (...args) => {
              if (failure === "read") throw new Error("private-canary");
              return handle.read(...args);
            },
            close: async () => {
              closed = true; await handle.close();
              if (failure === "close") throw new Error("private-canary");
            },
          };
        },
      });
      assert.deepEqual(result, {
        schemaVersion: 1, availability: "unavailable", milestones: [], reason,
      }, failure);
      assert.equal(JSON.stringify(result).includes("private-canary"), false);
      assert.equal(closed, failure !== "open");
    }
  });
});

test("packaged dispatch collects timings after settlement without changing command or lifecycle failure", async () => {
  await withTimingLog(async ({ ownership, logPath }) => {
    for (const failure of [null, "command", "lifecycle", "both", "cancelled"]) {
      const summary = {};
      const events = [];
      const dispatched = timingGate.executeGatePhaseCommand({
        phase: { kind: "packaged-smoke" },
        packagingDiagnostics: { ownership, logPath, summary },
        executeCommand: async () => {
          events.push("command");
          if (["command", "both", "cancelled"].includes(failure)) {
            throw Object.assign(new Error("command failure"), { exitCode: failure === "cancelled" ? 143 : 23 });
          }
          return { outputTail: "unchanged result" };
        },
        validatePackagedLifecycle: async ({ commandSucceeded }) => {
          events.push("lifecycle");
          assert.equal(commandSucceeded, !["command", "both", "cancelled"].includes(failure));
          assert.equal(summary.packagingTimings, undefined, "collection follows lifecycle validation");
          if (["lifecycle", "both"].includes(failure)) throw new Error("lifecycle failure");
        },
      });
      if (failure) await assert.rejects(dispatched, (error) => {
        if (failure !== "lifecycle") assert.match(error.message, /command failure/);
        if (["lifecycle", "both"].includes(failure)) assert.match(error.message, /lifecycle failure/);
        if (failure === "cancelled") assert.equal(error.exitCode, 143);
        return true;
      });
      else assert.deepEqual(await dispatched, { outputTail: "unchanged result" });
      assert.deepEqual(events, ["command", "lifecycle"]);
      assert.equal(summary.packagingTimings.availability, "complete");
    }
    await rm(logPath);
    const summary = {};
    assert.equal(await timingGate.executeGatePhaseCommand({
      phase: { kind: "packaged-smoke" }, packagingDiagnostics: { ownership, logPath, summary },
      executeCommand: async () => 42, validatePackagedLifecycle: async () => {},
    }), 42);
    assert.equal(summary.packagingTimings.availability, "unavailable");
    const primary = Object.assign(new Error("original failure"), { exitCode: 23 });
    await assert.rejects(timingGate.executeGatePhaseCommand({
      phase: { kind: "packaged-smoke" }, packagingDiagnostics: { ownership, logPath, summary },
      executeCommand: async () => { throw primary; }, validatePackagedLifecycle: async () => {},
    }), (error) => error === primary && error.exitCode === 23);
  });
});

test("packaging timings survive external persistence and cleanup without conferring gate success", async () => {
  for (const outcome of ["passed", "failed", "cancelled", "cleanup-failed"]) {
    await withTimingLog(async ({ ownership, logPath }) => {
      const timings = await timingGate.readPackagingTimings(ownership, logPath);
      const lifecycle = await createResourceLifecycleJournal(ownership.directory, { filename: "gate-resource-lifecycle.json" });
      const persisted = [];
      const controller = new AbortController();
      if (outcome === "cancelled") controller.abort(new Error("cancelled"));
      const result = await finalizeGateAttemptEvidence({
        timeline: createGateTimeline({ startedAt: 0, now: () => 1 }),
        diagnosticsDirectory: ownership.directory, diagnosticsOwnership: ownership, lifecycle,
        summary: { status: "running", packagingTimings: timings }, wallStartedAt: Date.now(),
        callerIntegrityVerified: true, signals: [controller.signal],
        attemptError: outcome === "failed" ? new Error("failed") : undefined,
        async persistExternal(_env, value) { persisted.push(structuredClone(value)); },
        async removeDiagnostics(directory) {
          assert.ok(persisted.every((value) => value.status !== "passed"));
          if (outcome === "cleanup-failed") throw new Error("cleanup failed");
          await rm(directory, { recursive: true });
        },
      });
      assert.equal(result.summary.status, outcome === "cleanup-failed" ? "failed" : outcome);
      assert.deepEqual(persisted.at(-1).packagingTimings, timings);
      if (outcome === "passed") assert.equal(result.diagnosticsDirectory, null);
      else assert.ok(persisted.every((value) => value.status !== "passed"));
    });
  }
});

test("gate evidence distinguishes packaging not reached from smoke-only mode", async () => {
  for (const mode of ["full", "smoke-only"]) {
    const persisted = [];
    const result = await finalizeGateAttemptEvidence({
      timeline: createGateTimeline(), mode, summary: { status: "failed" },
      wallStartedAt: Date.now(), callerIntegrityVerified: false,
      attemptError: new Error("early preflight failure"),
      async persistExternal(_env, value) { persisted.push(structuredClone(value)); },
    });
    const expected = { schemaVersion: 1, availability: "unavailable", milestones: [],
      reason: mode === "smoke-only" ? "mode-not-applicable" : "phase-not-run" };
    assert.deepEqual(result.summary.packagingTimings, expected);
    assert.deepEqual(persisted.at(-1).packagingTimings, expected);
    assert.equal(persisted.at(-1).status, "failed");
  }
});

test("partial and unavailable packaging timings persist through the real sanitized summary writer", async () => {
  const runnerTemp = await mkdtemp(path.join(os.tmpdir(), "gate-timing-export-"));
  try {
    for (const sample of ["partial", "unavailable"]) {
      await withTimingLog(async ({ ownership, logPath }) => {
        if (sample === "partial") {
          await writeFile(logPath, "[stderr] Bearer private-canary\n[stdout] packaging-smoke: milestone=failed elapsedMs=1\n");
        } else await rm(logPath);
        const packagingTimings = await timingGate.readPackagingTimings(ownership, logPath);
        assert.equal(packagingTimings.availability, sample);
        const lifecycle = await createResourceLifecycleJournal(ownership.directory, { filename: "gate-resource-lifecycle.json" });
        const summaryPath = path.join(runnerTemp, "local-migration-gate-summary.json");
        await finalizeGateAttemptEvidence({
          timeline: createGateTimeline({ startedAt: 0, now: () => 1 }),
          diagnosticsDirectory: ownership.directory, diagnosticsOwnership: ownership, lifecycle,
          summary: { status: "running", packagingTimings }, wallStartedAt: Date.now(),
          callerIntegrityVerified: true, attemptError: new Error("Bearer private-canary"),
          externalEnvironment: { RUNNER_TEMP: runnerTemp, MIGRATION_GATE_CI_SUMMARY_PATH: summaryPath },
        });
        const text = await readFile(summaryPath, "utf8");
        assert.equal(text.includes("private-canary"), false);
        assert.deepEqual(JSON.parse(text).packagingTimings, packagingTimings);
        assert.equal(JSON.parse(text).status, "failed");
      });
    }
  } finally { await rm(runnerTemp, { recursive: true, force: true }); }
});

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
          ...localMcpLifecycleResources(diagnostics),
          ...localUiLifecycleResources(diagnostics),
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
    { id: "local-mcp", status: "active", successorModes: [], requiredEvidenceClasses: ["contract", "build", "state", "restart", "integrity"] },
    { id: "local-ui", status: "active", successorModes: [], requiredEvidenceClasses: ["contract", "build", "state", "restart", "integrity"] },
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
        ? ["hosted-baseline", "local-identity-preview", "local-database-preview", "local-model-preview", "local-mcp", "local-ui"]
        : phase.id === "web-production-build" ? ["hosted-baseline", "local-ui"] : ["hosted-baseline"],
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
          "scripts/local-migration/local-mcp-smoke.test.mjs",
          "scripts/local-migration/local-ui-smoke.test.mjs",
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
        ["pnpm", "--filter", "backend", "test:local-mcp"],
        ["pnpm", "--filter", "backend", "test:local-ui"],
        ["pnpm", "--filter", "desktop", "test"],
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
      [["pnpm", "--filter", "web", "build"], ["pnpm", "--filter", "web", "test:local-ui"]],
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

test("dedicated CI lanes preserve gate deadlines with reviewed source 178/188 and packaging 180/190 budgets", async () => {
  const workflow = parseYaml(
    await readFile(
      new URL("../../.github/workflows/local-migration-baseline.yml", import.meta.url),
      "utf8",
    ),
  );
  for (const jobId of ["source-qualification", "packaging-qualification"]) {
  const job = workflow.jobs[jobId];
  const packagingPrerequisite = jobId === "packaging-qualification" ? 2 : 0;
  assert.equal(job["timeout-minutes"], 188 + packagingPrerequisite);
  const expected = [
    ["actions/checkout@v4", 5],
    ["Initialize private runner caches", 1],
    ["pnpm/action-setup@v6.0.8", 5],
    ["actions/setup-node@v4", 5],
    ["actions/setup-python@v5", 5],
    ["Verify toolchain and seed offline Corepack runtime", 5],
    ["Install dependencies", 15],
    ...(packagingPrerequisite ? [["Prepare pinned Prisma engine prerequisite", 2]] : []),
    ["Install pinned Chromium prerequisite", 10],
    ["Run the Local Migration Baseline Gate", 118],
    ["Persist sanitized gate evidence", 5],
    ["actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02", 2],
    ["actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02", 2],
  ];
  assert.deepEqual(
    job.steps.map((step) => [step.uses ?? step.name, step["timeout-minutes"]]),
    expected,
  );
  assert.equal(
    job.steps.reduce((sum, step) => sum + step["timeout-minutes"], 0),
    178 + packagingPrerequisite,
  );
  assert.equal(job["timeout-minutes"] - (178 + packagingPrerequisite), 10);
  const evidence = job.steps.find((step) => step.name === "Persist sanitized gate evidence");
  assert.equal(evidence.if, "always()");
  assert.equal(
    job.steps.find((step) => step.id === "migration-gate").env.MIGRATION_GATE_CI_SUMMARY_PATH,
    "${{ runner.temp }}/local-migration-gate-summary.json",
  );
  assert.match(
    evidence.run,
    /\$RUNNER_TEMP\/local-migration-gate-summary\.json/,
  );
  assert.match(evidence.run, /\$GITHUB_STEP_SUMMARY/);
  }
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
      candidate.phases[10].timeoutMs = 900_000;
    },
    (candidate) => {
      candidate.phases[10].timeoutMs = 1_500_001;
    },
    (candidate) => {
      candidate.phases[0].timeoutMs++;
    },
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

test("active phase timeouts retain the reviewed global gate windows", async () => {
  const { PACKAGED_SMOKE_PHASE_TIMEOUT_MS } = await import(
    "./packaging-smoke.mjs"
  );
  assert.equal(PACKAGED_SMOKE_PHASE_TIMEOUT_MS, 1_500_000);
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
      1_500_000,
      300_000,
    ],
  );
  assert.equal(
    active.reduce((sum, phase) => sum + phase.timeoutMs, 0),
    104 * 60_000,
  );
});

test("gate-wide monotonic deadlines cap preflight, phases, settlement, and cleanup", () => {
  let now = 10_000;
  const timeline = createGateTimeline({ startedAt: now, now: () => now });
  assert.deepEqual(GATE_TIMELINE_MS, {
    preflight: 3 * 60_000,
    phaseCancellation: 107 * 60_000,
    childSettlement: 110 * 60_000,
    finalCleanup: 113 * 60_000,
  });
  assert.equal(timeline.remaining("preflight"), 3 * 60_000);
  now += 3 * 60_000;
  assert.equal(timeline.remaining("preflight"), 0);
  assert.throws(() => timeline.assertBefore("preflight"), /preflight deadline/);

  now = 10_000 + 106 * 60_000;
  assert.equal(
    effectivePhaseTimeoutMs({
      phaseTimeoutMs: 25 * 60_000,
      phaseStartedAt: now,
      timeline,
    }),
    60_000,
  );
  now = 10_000 + 113 * 60_000;
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

test("final cleanup gets one lazy three-minute window capped by T+113", () => {
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

  now = 5_000 + 112 * 60_000;
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

test("settled work disposes T+107 before final cleanup crosses that boundary", async () => {
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
      now = 106 * 60_000;
      confirmChildSettlement();
      return { status: "passed" };
    },
    cleanup: async ({ workSignal }) => {
      now = 108 * 60_000;
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
  for (const job of ["source-qualification", "packaging-qualification"]) {
    const gateStep = workflow.jobs[job].steps.find(
      ({ name }) => name === "Run the Local Migration Baseline Gate",
    );
    assert.equal(gateStep["timeout-minutes"], 118);
  }
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


async function qualificationFixture() {
  const api = await import("./ci-qualification.mjs");
  const contract = api.qualificationContract(
    await readFile(new URL("./gate-phases.json", import.meta.url), "utf8"),
    await readFile(new URL("./gate-phases.schema.json", import.meta.url), "utf8"),
  );
  const provenance = {
    repository: "loyalagents/context-router", event: "pull_request",
    workflowRef: "loyalagents/context-router/.github/workflows/local-migration-baseline.yml@refs/pull/42/merge",
    runId: "1234", runAttempt: "1", checkoutSha: "a".repeat(40),
    pullRequestHeadSha: "b".repeat(40),
  };
  const source = { headSha: provenance.checkoutSha, dirty: false, copiedInputsSha256: "c".repeat(64) };
  const base = { sha: "d".repeat(40), manifestSha256: "e".repeat(64) };
  const versions = { node: "v24.21.0", pnpm: "10.25.0", python: "3.12.8", postgres: "15.15", chromium: "140.0.7339.16", playwright: "1.63.0" };
  const runner = { os: "Linux", arch: "X64", image: "ubuntu24", imageVersion: "20261012.1" };
  const completion = {
    boundedStages: true, preflight: true, childSettlement: true,
    workspaceRemoved: true, diagnosticsRemoved: true, gateLifecycle: true,
  };
  const summaryFor = (profile) => ({
    status: "passed", mode: profile, source, baseSha: base.sha,
    baseManifestSha256: base.manifestSha256,
    versions, baseComparison: profile === "ci-source" ? "performed" : "not-in-profile",
    callerIntegrity: true, cleanupErrors: [], failure: null,
    cleanup: [{ resource: "database", status: "removed" }, { resource: "administration", status: "clean" }],
    phases: api.selectQualificationPhases(manifest, profile).map(({ id }) => ({ id, status: "passed", elapsedMs: 1 })),
    smokeLifecycle: profile === "ci-source" ? { "restart-smoke": true } : { "packaged-composition-smoke": true },
  });
  const make = (profile, changes = {}) => api.createLaneReceipt({
    profile, summary: summaryFor(profile), completion, contract, provenance, runner, ...changes,
  });
  return { api, contract, provenance, source, base, versions, runner, completion, summaryFor, make,
    expected: { contract, provenance, source, base, dependencyResults: { source: "success", packaging: "success" } } };
}

test("CI qualification profiles are exhaustive fixed projections of the validated full gate", async () => {
  const { api } = await qualificationFixture();
  const ids = (profile) => api.selectQualificationPhases(manifest, profile).map(({ id }) => id);
  assert.deepEqual(ids("full"), manifest.phases.map(({ id }) => id));
  assert.deepEqual(ids("ci-source"), [...manifest.phases.slice(0, 10), manifest.phases[11]].map(({ id }) => id));
  assert.deepEqual(ids("ci-packaging"), manifest.phases.slice(10).map(({ id }) => id));
  assert.deepEqual([...new Set([...ids("ci-source"), ...ids("ci-packaging")])], ids("full").filter(id => id !== "packaged-composition-smoke").concat("packaged-composition-smoke"));
  for (const profile of ["", "source", "skip-packaging", ["contract-baseline"]]) {
    assert.throws(() => api.selectQualificationPhases(manifest, profile), /profile/);
  }
  for (const mutate of [
    m => m.phases.pop(),
    m => m.phases[10].commands[0].argv.push("--skip-integrity"),
    m => m.phases[10].modes.pop(),
    m => m.phases[10].predecessors = [],
  ]) {
    const altered = structuredClone(manifest); mutate(altered);
    assert.throws(() => api.selectQualificationPhases(altered, "ci-packaging"), /manifest|policy/);
  }
});

test("CI qualification CLI preserves full and smoke modes and rejects ambiguous or arbitrary selection", async () => {
  const { api } = await qualificationFixture();
  for (const [argv, expected] of [[[], "full"], [["--smoke-only"], "smoke-only"], [["--ci-source"], "ci-source"], [["--ci-packaging"], "ci-packaging"]]) {
    assert.equal(api.parseQualificationProfile(argv), expected);
  }
  for (const argv of [["--skip", "1"], ["--ci-source", "--ci-packaging"], ["--ci-source", "--smoke-only"], ["--ci-source", "--ci-source"]]) {
    assert.throws(() => api.parseQualificationProfile(argv), /argument|profile/);
  }
});

test("CI qualification accepts only complete matching post-finalization receipts", async () => {
  const f = await qualificationFixture();
  const receipts = [f.make("ci-source"), f.make("ci-packaging")];
  assert.equal(f.api.validateLaneReceipts(receipts, f.expected).status, "passed");
  assert.equal(f.api.validateLaneReceipts(receipts.toReversed(), f.expected).status, "passed");
  assert.deepEqual(receipts[1].coverage[0].commands, manifest.phases[10].commands.map(c => c.argv));
  assert.deepEqual(receipts[1].coverage[0].modes, manifest.supportedModes.map(m => m.id));
  assert.equal(JSON.stringify(receipts).includes("databaseName"), false);
});

test("CI qualification rejects failed skipped cancelled or unknown upstream job results", async () => {
  const f = await qualificationFixture();
  for (const lane of ["source", "packaging"]) for (const status of ["failure", "skipped", "cancelled", "", null, undefined]) {
    assert.throws(() => f.api.validateLaneReceipts([f.make("ci-source"), f.make("ci-packaging")], {
      ...f.expected, dependencyResults: { ...f.expected.dependencyResults, [lane]: status },
    }), /dependency/);
  }
});

test("CI qualification rejects missing duplicate stale mismatched incomplete and tampered receipts", async () => {
  const f = await qualificationFixture();
  const good = [f.make("ci-source"), f.make("ci-packaging")];
  for (const receipts of [[], good.slice(0, 1), [...good, good[0]], [good[0], good[0]]]) {
    assert.throws(() => f.api.validateLaneReceipts(receipts, f.expected), /receipt|lane/);
  }
  const mutations = [
    r => r.provenance.runAttempt = "2", r => r.provenance.runId = "555",
    r => r.provenance.checkoutSha = "f".repeat(40), r => r.provenance.pullRequestHeadSha = "f".repeat(40),
    r => r.provenance.repository = "other/repo", r => r.provenance.workflowRef += "-other",
    r => r.source.headSha = r.provenance.pullRequestHeadSha,
    r => r.source.dirty = true, r => r.source.copiedInputsSha256 = "f".repeat(64),
    r => r.base.sha = "f".repeat(40), r => r.base.manifestSha256 = "f".repeat(64),
    r => r.contract.manifestSha256 = "f".repeat(64), r => r.contract.partitionSha256 = "f".repeat(64),
    r => r.versions.node = "v24.20.0", r => r.versions.pnpm = "10.24.0",
    r => r.versions.python = "3.11.9", r => r.versions.postgres = "14.9",
    r => r.versions.playwright = "1.62.0", r => r.versions.chromium = "0",
    r => r.coverage.pop(), r => r.coverage.push(r.coverage[0]),
    r => r.coverage[0].commands = [], r => r.coverage[0].modes.pop(),
    r => r.coverage[0].evidenceClasses = [], r => r.coverage[0].status = "skipped",
    r => r.coverage[0].elapsedMs = -1, r => r.coverage[0].unexpected = true,
    r => r.verification.callerIntegrity = false, r => r.verification.generatedIntegrity = false,
    r => r.verification.smokeLifecycle = {}, r => r.verification.cleanup = false,
    r => r.completion.childSettlement = false, r => r.completion.workspaceRemoved = false,
    r => r.completion.diagnosticsRemoved = false, r => r.completion.boundedStages = false,
    r => r.status = "running", r => r.failure = "hidden failure",
    r => r.contract.unexpected = true, r => r.source.copiedInputsSha256 = "",
  ];
  for (const mutate of mutations) {
    const receipts = structuredClone(good); mutate(receipts[1]);
    assert.throws(() => f.api.validateLaneReceipts(receipts, f.expected), /qualification|receipt|coverage|toolchain|provenance|source|base|contract|integrity|completion|cleanup/);
  }
  const bothStale = structuredClone(good);
  for (const receipt of bothStale) receipt.provenance.runAttempt = "0";
  assert.throws(() => f.api.validateLaneReceipts(bothStale, f.expected), /provenance/);
});

test("CI qualification cannot construct a receipt from premature pass cleanup errors or missing smoke proof", async () => {
  const f = await qualificationFixture();
  for (const mutate of [
    s => s.status = "running", s => s.callerIntegrity = false,
    s => s.cleanupErrors.push("failure"), s => s.cleanup[0].status = "failed",
    s => s.cleanup.pop(), s => s.smokeLifecycle = {},
    s => s.phases[0].status = "failed", s => s.phases[0].status = "cancelled",
    s => s.baseComparison = "skipped", s => s.failure = { message: "failure" },
    s => s.cleanupPending = "automatic-diagnostics-removal",
  ]) {
    const summary = f.summaryFor("ci-source"); mutate(summary);
    assert.throws(() => f.make("ci-source", { summary }), /qualification|receipt|integrity|cleanup|comparison|lifecycle/);
  }
  for (const field of Object.keys(f.completion)) {
    assert.throws(() => f.make("ci-source", { completion: { ...f.completion, [field]: false } }), /completion/);
  }
});

test("CI qualification receipt publication preserves cancellation failure and deadline outcomes", async (t) => {
  const f = await qualificationFixture();
  const root = await mkdtemp(path.join(os.tmpdir(), "ci-receipt-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = path.join(root, "ci-source.json");
  for (const failure of ["write", "cancel", "deadline"]) {
    const controller = new AbortController();
    let late = false;
    await assert.rejects(f.api.publishLaneReceipt(file, f.make("ci-source"), {
      signal: controller.signal,
      assertDeadline() { if (late && failure === "deadline") throw new Error("deadline"); },
      async write(target, value) {
        if (failure === "write") throw new Error("write failure");
        await writeFile(target, value);
        late = true;
        if (failure === "cancel") controller.abort(new Error("late cancellation"));
      },
    }), /write failure|late cancellation|deadline/);
    await assert.rejects(lstat(file), { code: "ENOENT" });
  }
  await f.api.publishLaneReceipt(file, f.make("ci-source"));
  assert.equal(JSON.parse(await readFile(file, "utf8")).status, "passed");
});

test("CI qualification reads exactly two bounded regular receipt files", async (t) => {
  const f = await qualificationFixture();
  const root = await mkdtemp(path.join(os.tmpdir(), "ci-receipt-read-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const profile of ["ci-source", "ci-packaging"]) {
    await writeFile(path.join(root, profile + ".json"), JSON.stringify(f.make(profile)));
  }
  assert.equal((await f.api.readLaneReceipts(root)).length, 2);
  await writeFile(path.join(root, "unexpected.json"), "{}");
  await assert.rejects(f.api.readLaneReceipts(root), /receipt/);
  await rm(path.join(root, "unexpected.json"));
  const target = path.join(root, "ci-source.json");
  await rm(target); await symlink(path.join(root, "ci-packaging.json"), target);
  await assert.rejects(f.api.readLaneReceipts(root), /regular|symlink|receipt/);
  await rm(target); await writeFile(target, "x".repeat(262145));
  await assert.rejects(f.api.readLaneReceipts(root), /bound|size|receipt/);
});


test("CI qualification publication cannot overwrite or remove preexisting or replaced targets", async (t) => {
  const f = await qualificationFixture();
  const root = await mkdtemp(path.join(os.tmpdir(), "ci-receipt-owner-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const target = path.join(root, "ci-source.json");
  await writeFile(target, "preexisting");
  await assert.rejects(f.api.publishLaneReceipt(target, f.make("ci-source")));
  assert.equal(await readFile(target, "utf8"), "preexisting");
  await rm(target);
  for (const kind of ["file", "symlink"]) {
    const replacement = path.join(root, "replacement-" + kind);
    await writeFile(replacement, "replacement");
    const controller = new AbortController();
    await assert.rejects(f.api.publishLaneReceipt(target, f.make("ci-source"), {
      signal: controller.signal,
      async write() {
        await rm(target);
        if (kind === "file") {
          const { rename } = await import("node:fs/promises");
          await rename(replacement, target);
        } else await symlink(replacement, target);
        controller.abort(new Error("cancel after replacement"));
      },
    }), /cancel after replacement/);
    assert.equal(await readFile(target, "utf8"), "replacement");
    await rm(target);
  }
});

test("CI packaging dispatch seam invokes outer smoke verification before final integrity", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ci-profile-dispatch-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const events = [];
  const artifact = path.join(root, "built-by-packaging");
  const results = await timingGate.runQualificationPhaseSequence(manifest, "ci-packaging", {
    execute: (command, phase) => timingGate.executeGatePhaseCommand({
      phase,
      executeCommand: async () => {
        events.push(phase.id);
        if (phase.kind === "packaged-smoke") {
          await assert.rejects(lstat(artifact), { code: "ENOENT" });
          await writeFile(artifact, "independent build");
        } else assert.equal(await readFile(artifact, "utf8"), "independent build");
        return { outputTail: "" };
      },
      validatePackagedLifecycle: async ({ commandSucceeded }) => {
        assert.equal(commandSucceeded, true);
        events.push("outer-lifecycle");
      },
    }),
  });
  assert.deepEqual(events, ["packaged-composition-smoke", "outer-lifecycle", "repository-integrity"]);
  assert.deepEqual(results.map(r => r.status), ["passed", "passed"]);
  for (const failure of ["command", "lifecycle"]) {
    const failures = [];
    await assert.rejects(timingGate.runQualificationPhaseSequence(manifest, "ci-packaging", {
      execute: (command, phase) => timingGate.executeGatePhaseCommand({
        phase, executeCommand: async () => {
          failures.push("command");
          if (failure === "command") throw new Error("fixture command failure");
          return { outputTail: "" };
        },
        validatePackagedLifecycle: async ({ commandSucceeded }) => {
          failures.push("lifecycle");
          assert.equal(commandSucceeded, failure !== "command");
          if (failure === "lifecycle") throw new Error("fixture lifecycle failure");
        },
      }),
    }), /fixture .* failure/);
    assert.deepEqual(failures, ["command", "lifecycle"]);
  }
});


test("CI qualification combined entrypoint succeeds without installed dependencies and independently binds source/base", async (t) => {
  const { execFileSync, spawnSync } = await import("node:child_process");
  const { pathToFileURL } = await import("node:url");
  const root = await mkdtemp(path.join(os.tmpdir(), "ci-combine-cli-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const checkout = path.join(root, "checkout"), runner = path.join(root, "runner");
  await mkdir(checkout); await mkdir(runner);
  const repo = path.resolve(import.meta.dirname, "../..");
  const archive = execFileSync("git", ["archive", "HEAD"], { cwd: repo, maxBuffer: 64 * 1024 * 1024 });
  execFileSync("tar", ["-xf", "-", "-C", checkout], { input: archive });
  for (const name of ["migration-gate.mjs", "ci-qualification.mjs", "combine-ci-qualification.mjs"]) {
    await writeFile(path.join(checkout, "scripts/local-migration", name), await readFile(path.join(repo, "scripts/local-migration", name)));
  }
  const environment = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
  const git = args => execFileSync("git", ["-c", "core.hooksPath=/dev/null", ...args], { cwd: checkout, env: environment, encoding: "utf8" }).trim();
  git(["init", "--quiet"]); git(["config", "user.name", "Fixture"]); git(["config", "user.email", "fixture@invalid.local"]);
  git(["add", "--all"]); git(["commit", "--quiet", "--no-gpg-sign", "-m", "qualification fixture"]);
  const baseHead = git(["rev-parse", "HEAD"]);
  const tree = git(["rev-parse", "HEAD^{tree}"]);
  const commit = parents => git(["commit-tree", tree, ...parents.flatMap(p => ["-p", p]), "-m", "ancestry fixture"]);
  const first = commit([baseHead]);
  const prHead = commit([first]);
  const merge = commit([first, prHead]);
  const gate = await import(pathToFileURL(path.join(checkout, "scripts/local-migration/migration-gate.mjs")));
  const f = await qualificationFixture();
  const baseRoot = path.join(root, "base"); await mkdir(baseRoot);
  const base = await gate.exportBaseContracts(baseHead, baseRoot);
  const receiptsRoot = path.join(runner, "qualification-receipts"); await mkdir(receiptsRoot);
  let census = 0;
  const prepare = async (head, event = "pull_request", eventHead = prHead) => {
    git(["reset", "--quiet", "--hard", head]);
    const source = (await gate.copyGateSourceInputs(checkout, path.join(root, "source-copy-" + census++))).source;
    const provenance = { ...f.provenance, checkoutSha: head, event,
      pullRequestHeadSha: event === "pull_request" ? eventHead : null };
    for (const profile of ["ci-source", "ci-packaging"]) {
      const summary = { ...f.summaryFor(profile), source, baseSha: baseHead, baseManifestSha256: base.manifestSha256 };
      await writeFile(path.join(receiptsRoot, profile + ".json"), JSON.stringify(f.make(profile, { summary, provenance })));
    }
    return {
      ...environment, RUNNER_TEMP: runner, GITHUB_REPOSITORY: provenance.repository,
      GITHUB_EVENT_NAME: provenance.event, GITHUB_WORKFLOW_REF: provenance.workflowRef,
      GITHUB_RUN_ID: provenance.runId, GITHUB_RUN_ATTEMPT: provenance.runAttempt,
      GITHUB_SHA: head, MIGRATION_GATE_PR_HEAD_SHA: provenance.pullRequestHeadSha ?? "",
      MIGRATION_GATE_BASE_SHA: baseHead, SOURCE_RESULT: "success", PACKAGING_RESULT: "success",
    };
  };
  let env = await prepare(merge);
  const execute = extra => spawnSync(process.execPath, ["scripts/local-migration/combine-ci-qualification.mjs", "--combine"], {
    cwd: checkout, env: { ...env, ...extra }, encoding: "utf8", timeout: 30000,
  });
  await assert.rejects(lstat(path.join(checkout, "node_modules")), { code: "ENOENT" });
  assert.notEqual(baseHead, first, "a validated ancestor base need not equal the merge first parent");
  const passed = execute({});
  assert.equal(passed.status, 0, passed.stderr);
  assert.match(passed.stdout, /both finalized lanes/);
  for (const change of [{ SOURCE_RESULT: "skipped" }, { PACKAGING_RESULT: "cancelled" }, { GITHUB_RUN_ATTEMPT: "2" }, { GITHUB_SHA: "f".repeat(40) }, { MIGRATION_GATE_BASE_SHA: "f".repeat(40) }]) {
    assert.notEqual(execute(change).status, 0);
  }
  for (const head of [baseHead, first, commit([baseHead, first, prHead])]) {
    env = await prepare(head);
    assert.notEqual(execute({}).status, 0, "PR checkout must have exactly two parents");
  }
  env = await prepare(merge);
  assert.equal(execute({ MIGRATION_GATE_BASE_SHA: commit([]) }).stderr.trim(), "ci-qualification: failed; base", "existing nonancestor base fails");
  env = await prepare(merge, "pull_request", first);
  assert.notEqual(execute({}).status, 0, "consistent receipt/event relabelling cannot replace actual second parent");
  env = await prepare(first, "push");
  assert.equal(execute({}).status, 0, "ordinary push commits need no merge shape");
  env = await prepare(merge);
  await writeFile(path.join(receiptsRoot, "ci-source.json"), '{"private-secret":');
  const malformed = execute({});
  assert.notEqual(malformed.status, 0);
  assert.equal(malformed.stderr.trim(), "ci-qualification: failed; validation-incomplete");
  env = await prepare(merge);
  const unavailable = execute({ RUNNER_TEMP: path.join(root, "missing-private-path") });
  assert.equal(unavailable.stderr.trim(), "ci-qualification: failed; validation-incomplete");
  assert.equal(execute({ SOURCE_RESULT: "failure" }).stderr.trim(), "ci-qualification: failed; dependency-results");
  assert.equal(execute({ GITHUB_SHA: "f".repeat(40) }).stderr.trim(), "ci-qualification: failed; provenance");
  await writeFile(path.join(checkout, "README.md"), "tampered");
  assert.equal(execute({}).stderr.trim(), "ci-qualification: failed; source");
});


test("CI qualification publication observes bounded-stage post-finalization cancellation and deadlines", async (t) => {
  const f = await qualificationFixture();
  const root = await mkdtemp(path.join(os.tmpdir(), "ci-final-boundary-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const mode of ["success", "late-cancel", "late-deadline", "cleanup-failed", "finalizer-failed"]) {
    const cancellation = new AbortController();
    let clock = 0, publications = 0;
    const timeline = timingGate.createGateTimeline({ startedAt: 0, now: () => clock });
    const outcome = await timingGate.runBoundedGateStages({
      timeline, cancellationSignal: cancellation.signal,
      execute: async ({ completePreflight }) => { completePreflight(); return {}; },
      cleanup: async () => { if (mode === "cleanup-failed") throw new Error("cleanup fixture"); },
      finalize: async () => {
        if (mode === "finalizer-failed") throw new Error("finalizer fixture");
        if (mode === "late-cancel") cancellation.abort(new Error("late cancellation"));
        if (mode === "late-deadline") clock = timingGate.GATE_TIMELINE_MS.finalCleanup + 1;
      },
    });
    const publish = () => timingGate.publishCompletedCiQualification({
      profile: "ci-source", summary: { ...f.summaryFor("ci-source"), qualification: f.contract },
      outcome, provenance: f.provenance, runner: f.runner,
      workspaceRemoved: true, diagnosticsDirectory: null, gateLifecycle: { state: { status: "passed" } },
      runnerTemp: root, signal: cancellation.signal, timeline,
      publish: async () => { publications++; },
    });
    if (mode === "success") { await publish(); assert.equal(publications, 1); }
    else { await assert.rejects(publish()); assert.equal(publications, 0); }
  }
});


test("CI packaging prerequisites use only the fixed bounded owned-workspace command", async () => {
  assert.equal(typeof timingGate.prepareQualificationPrerequisites, "function");
  const controller = new AbortController();
  const environment = { PATH: "/pinned/bin", HOME: "/owned/home", COREPACK_ENABLE_NETWORK: "0" };
  const calls = [];
  const options = { workspace: "/owned/workspace", diagnosticsDirectory: "/owned/diagnostics", environment, signal: controller.signal,
    execute: async (argv, commandOptions) => calls.push({ argv, commandOptions }) };
  for (const profile of ["full", "ci-source", "smoke-only"]) await timingGate.prepareQualificationPrerequisites(profile, options);
  assert.deepEqual(calls, []);
  await assert.rejects(timingGate.prepareQualificationPrerequisites("arbitrary", options), /profile/);
  await timingGate.prepareQualificationPrerequisites("ci-packaging", options);
  assert.deepEqual(calls, [{ argv: ["pnpm", "--filter", "backend", "exec", "prisma", "--version"], commandOptions: {
    cwd: options.workspace, env: environment, signal: controller.signal, timeoutMs: 120_000,
    logPath: "/owned/diagnostics/preflight-packaging-prisma.log",
  } }]);
  const failed = new Error("preparation failed");
  await assert.rejects(timingGate.prepareQualificationPrerequisites("ci-packaging", { ...options, execute: async () => { throw failed; } }), error => error === failed);
  const cancelled = new Error("preparation cancelled");
  controller.abort(cancelled);
  await assert.rejects(timingGate.prepareQualificationPrerequisites("ci-packaging", options), error => error === cancelled);
  assert.equal(calls.length, 1);
  const deadline = new AbortController();
  const expired = new Error("shared preflight deadline");
  await assert.rejects(timingGate.prepareQualificationPrerequisites("ci-packaging", {
    ...options, signal: deadline.signal, execute: async () => deadline.abort(expired),
  }), error => error === expired);
});

test("CI packaging prerequisites prepare path-local Prisma config before dependency integrity capture", async () => {
  const { captureCallerIntegrity, assertCallerIntegrity } = await import("./gate-runner.mjs");
  const backendRequire = createRequire(new URL("../../apps/backend/package.json", import.meta.url));
  const loader = createRequire(backendRequire.resolve("prisma/package.json"))("@prisma/config").loadConfigFromFile;
  const root = await mkdtemp(path.join(os.tmpdir(), "gate-prisma-config-test-"));
  try {
    const caller = path.join(root, "caller/apps/backend");
    const workspace = path.join(root, "copied");
    const copied = path.join(workspace, "apps/backend");
    await mkdir(path.join(caller, "node_modules"), { recursive: true });
    await cp(new URL("../../apps/backend/prisma.config.ts", import.meta.url), path.join(caller, "prisma.config.ts"));
    for (const pkg of ["prisma", "dotenv"]) await symlink(path.dirname(backendRequire.resolve(pkg + "/package.json")), path.join(caller, "node_modules", pkg));
    const load = async (configRoot) => assert.equal((await loader({ configRoot })).error, undefined);
    await load(caller);
    await cp(caller, copied, { recursive: true, verbatimSymlinks: true });
    const cache = path.join(copied, "node_modules/.cache/jiti");
    const beforeFiles = await readdir(cache);
    const before = await captureCallerIntegrity([path.join(copied, "node_modules")]);
    await load(copied);
    const additions = (await readdir(cache)).filter(name => !beforeFiles.includes(name));
    assert.equal(additions.length, 1);
    assert.match(additions[0], /^backend-prisma\.config\.[a-f0-9]+\.mjs$/);
    await assert.rejects(assertCallerIntegrity(before), /caller path changed/);
    await rm(path.join(cache, additions[0]));
    const signal = new AbortController().signal;
    await timingGate.prepareQualificationPrerequisites("ci-packaging", {
      workspace, diagnosticsDirectory: root, environment: {}, signal,
      execute: async (argv, options) => {
        assert.deepEqual(argv, ["pnpm", "--filter", "backend", "exec", "prisma", "--version"]);
        assert.equal(options.cwd, workspace);
        assert.equal(options.signal, signal);
        await load(path.join(options.cwd, "apps/backend"));
      },
    });
    assert.deepEqual((await readdir(cache)).filter(name => !beforeFiles.includes(name)), additions);
    const preparedBytes = await readFile(path.join(cache, additions[0]));
    const prepared = await captureCallerIntegrity([path.join(copied, "node_modules")]);
    await load(copied);
    await assertCallerIntegrity(prepared);
    assert.deepEqual(await readFile(path.join(cache, additions[0])), preparedBytes);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("CI packaging prerequisites run inside preflight before database and phase dispatch", async () => {
  const source = await readFile(new URL("./migration-gate.mjs", import.meta.url), "utf8");
  const preflight = source.indexOf("const versions = await runPreflight({");
  const prepare = source.indexOf("await prepareQualificationPrerequisites(profile, {", preflight);
  const database = source.indexOf("administration = await prepareTestAdministration({", preflight);
  const complete = source.indexOf("completePreflight();", preflight);
  const phases = source.indexOf("summary.phases = await runQualificationPhaseSequence", preflight);
  assert.ok(preflight >= 0 && prepare > preflight && database > prepare && complete > database && phases > complete);
  assert.match(source.slice(prepare, database), /signal: preflightSignal/);
});


test("CI runner policy allows only supported patch and image-release variation", async () => {
  const f = await qualificationFixture();
  for (const mutate of [
    r => r.runner.imageVersion = "20261014.99.1",
    r => r.versions.python = "3.12.15",
    r => r.versions.postgres = "15.19 (Debian distribution)",
  ]) {
    const receipts = [f.make("ci-source"), f.make("ci-packaging")];
    mutate(receipts[1]);
    assert.equal(f.api.validateLaneReceipts(receipts, f.expected).status, "passed");
  }
  for (const mutate of [
    r => r.runner.os = "macOS", r => r.runner.arch = "ARM64",
    r => r.runner.image = "ubuntu22", r => r.runner.image = "windows2025",
    r => r.runner.image = "ubuntu", r => r.runner.image = "ubuntu2404",
    r => r.runner.imageVersion = "", r => r.runner.imageVersion = "private\nvalue",
    r => r.runner.imageVersion = "a".repeat(513), r => r.runner.extra = true,
    r => delete r.runner.arch, r => r.versions.python = "3.13.1",
    r => r.versions.postgres = "16.1", r => r.versions.chromium = "153.0.8010.99",
  ]) {
    const receipts = [f.make("ci-source"), f.make("ci-packaging")]; mutate(receipts[1]);
    assert.throws(() => f.api.validateLaneReceipts(receipts, f.expected));
  }
});

test("CI public failures are typed fixed categories and never arbitrary error text", async () => {
  const f = await qualificationFixture();
  const privateText = "postgresql://private:secret@host/db /private/path receipt-secret";
  assert.equal(typeof f.api.formatQualificationFailure, "function");
  for (const value of [new Error(privateText), new SyntaxError(privateText), { code: "provenance", message: privateText }, new f.api.QualificationError("unknown", privateText)]) {
    assert.equal(f.api.formatQualificationFailure(value), "ci-qualification: failed; validation-incomplete");
  }
  for (const code of ["dependency-results", "receipt-invalid", "receipt-files", "provenance", "source", "base", "contract", "runner-toolchain", "invocation"]) {
    assert.equal(f.api.formatQualificationFailure(new f.api.QualificationError(code, privateText)), "ci-qualification: failed; " + code);
  }
  try { f.api.validateLaneReceipts([], { ...f.expected, dependencyResults: { source: "failure", packaging: "success" } }); assert.fail("must fail"); }
  catch (error) { assert.equal(f.api.formatQualificationFailure(error), "ci-qualification: failed; dependency-results"); }
});

async function ciFinalizationFixture(t, profile = "ci-source") {
  const f = await qualificationFixture();
  const root = await mkdtemp(path.join(os.tmpdir(), "ci-terminal-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const environment = { RUNNER_TEMP: root, MIGRATION_GATE_CI_SUMMARY_PATH: path.join(root, "local-migration-gate-summary.json") };
  const ownership = await prepareGateDiagnosticsRoot(path.join(root, "diagnostics-"));
  const lifecycle = await createResourceLifecycleJournal(ownership.directory, { filename: "gate-resource-lifecycle.json" });
  const controller = new AbortController();
  const clock = { value: 1 };
  const timeline = createGateTimeline({ startedAt: 0, now: () => clock.value });
  let finalized;
  const finalize = async ({ primaryError, secondaryErrors = [] } = {}) => {
    finalized = await finalizeGateAttemptEvidence({
      timeline, mode: profile, diagnosticsDirectory: ownership.directory, diagnosticsOwnership: ownership,
      lifecycle, summary: { ...f.summaryFor(profile), qualification: f.contract },
      attemptError: primaryError, cleanupErrors: secondaryErrors,
      source: f.source, wallStartedAt: Date.now(), callerIntegrityVerified: true,
      signals: [controller.signal], externalEnvironment: environment,
    });
    if (finalized.evidenceErrors.length) throw finalized.evidenceErrors[0];
  };
  const evidence = () => ({ profile, summary: finalized?.summary, provenance: f.provenance, runner: f.runner,
    workspaceRemoved: true, diagnosticsDirectory: finalized?.diagnosticsDirectory, gateLifecycle: lifecycle,
    runnerTemp: root, signal: controller.signal, timeline });
  const readSummary = async () => JSON.parse(await readFile(environment.MIGRATION_GATE_CI_SUMMARY_PATH, "utf8"));
  return { f, root, environment, ownership, lifecycle, controller, clock, timeline, finalize, evidence, readSummary };
}

test("CI finalizer retains durable pending evidence until required publication completes", async t => {
  for (const profile of ["ci-source", "ci-packaging"]) {
    const f = await ciFinalizationFixture(t, profile);
    await f.finalize();
    assert.equal(f.evidence().summary.status, "passed", "internal candidate is finalized");
    assert.equal((await f.readSummary()).status, "running");
    assert.equal((await f.readSummary()).cleanupPending, "required-receipt-publication");
  }
});

test("CI production orchestration cannot expose pass before its terminal commit", async t => {
  for (const fault of ["none", "execution-failed", "cleanup-failed", "finalizer-postcheck-cancel", "finalizer-postcheck-deadline", "receipt-write", "receipt-cancel", "receipt-deadline", "summary-prepare", "failure-persist"]) {
    await t.test(fault, async t => {
      const f = await ciFinalizationFixture(t);
      const events = [];
      assert.equal(typeof timingGate.runCiQualificationAttempt, "function");
      const outcome = await timingGate.runCiQualificationAttempt({
        environment: f.environment, evidence: f.evidence,
        stages: { timeline: f.timeline, cancellationSignal: f.controller.signal,
          execute: async ({ completePreflight }) => { completePreflight(); if (fault === "execution-failed") throw new Error("work failed"); return {}; },
          cleanup: async () => { if (fault === "cleanup-failed") throw new Error("cleanup failed"); },
          finalize: async context => {
            await f.finalize(context);
            assert.notEqual((await f.readSummary()).status, "passed");
            if (fault === "finalizer-postcheck-cancel") f.controller.abort(new Error("postcheck cancel"));
            if (fault === "finalizer-postcheck-deadline") f.clock.value = GATE_TIMELINE_MS.finalCleanup + 1;
          },
        },
        publish: async options => {
          events.push("receipt");
          assert.notEqual((await f.readSummary()).status, "passed");
          await timingGate.publishCompletedCiQualification({ ...options,
            publish: (target, receipt, publicationOptions) => f.f.api.publishLaneReceipt(target, receipt, {
              ...publicationOptions, write: async (file, bytes) => {
                if (["receipt-write", "failure-persist"].includes(fault)) throw new Error("receipt write failure");
                await writeFile(file, bytes);
                if (fault === "receipt-cancel") f.controller.abort(new Error("receipt cancel"));
                if (fault === "receipt-deadline") f.clock.value = GATE_TIMELINE_MS.finalCleanup + 1;
              },
            }),
          });
        },
        prepare: async (...args) => {
          events.push("prepare");
          assert.equal((await f.readSummary()).status, "running");
          if (fault === "summary-prepare") throw new Error("summary preparation failure");
          const prepared = await timingGate.prepareCiTerminalSummary(...args);
          return { ...prepared, commit() { events.push("commit"); prepared.commit(); } };
        },
        persistFailure: fault === "failure-persist"
          ? async () => { throw new Error("failure persistence failed too"); } : undefined,
        dispose: () => events.push("dispose"),
      });
      if (fault === "none") {
        assert.equal(outcome.ciCommitted, true);
        assert.equal((await f.readSummary()).status, "passed");
        assert.deepEqual(events, ["receipt", "prepare", "commit", "dispose"]);
      } else {
        assert.notEqual(outcome.ciCommitted, true);
        assert.ok(outcome.primaryError || outcome.secondaryErrors.length);
        assert.notEqual((await f.readSummary()).status, "passed");
        assert.equal(events.includes("commit"), false);
      }
    });
  }
});

test("CI terminal summary staging faults leave pending evidence and preserve foreign replacements", async t => {
  for (const fault of ["write", "sync", "close", "identity", "target", "target-symlink", "parent", "rename", "cancel", "deadline"]) {
    await t.test(fault, async t => {
      const f = await ciFinalizationFixture(t);
      await f.finalize();
      const pending = await readFile(f.environment.MIGRATION_GATE_CI_SUMMARY_PATH, "utf8");
      let prepared, stagePath;
      await assert.rejects(async () => {
        prepared = await timingGate.prepareCiTerminalSummary(f.environment, f.evidence().summary, {
          signal: f.controller.signal, timeline: f.timeline,
          openFile: async (file, flags, mode) => {
            stagePath = file;
            const handle = await open(file, flags, mode);
            let closed = false;
            return {
              stat: () => handle.stat(),
              writeFile: async bytes => {
                if (fault === "write") throw new Error("staged write failure");
                await handle.writeFile(bytes);
                if (fault === "identity") { await rm(file); await writeFile(file, "foreign"); }
                if (["target", "target-symlink"].includes(fault)) {
                  await rm(f.environment.MIGRATION_GATE_CI_SUMMARY_PATH);
                  if (fault === "target") await writeFile(f.environment.MIGRATION_GATE_CI_SUMMARY_PATH, "foreign", { mode: 0o600 });
                  else { const other = path.join(f.root, "foreign"); await writeFile(other, "foreign"); await symlink(other, f.environment.MIGRATION_GATE_CI_SUMMARY_PATH); }
                }
                if (fault === "parent") {
                  const { rename, link } = await import("node:fs/promises");
                  const moved = f.root + "-moved";
                  await rename(f.root, moved);
                  t.after(() => rm(moved, { recursive: true, force: true }));
                  await mkdir(f.root, { mode: 0o700 });
                  await writeFile(f.environment.MIGRATION_GATE_CI_SUMMARY_PATH, "foreign", { mode: 0o600 });
                  await link(path.join(moved, path.basename(file)), file);
                }
              },
              sync: async () => { if (fault === "sync") throw new Error("staged sync failure"); await handle.sync(); },
              close: async () => {
                if (!closed) { await handle.close(); closed = true; }
                if (fault === "close") throw new Error("staged close failure");
                if (fault === "cancel") f.controller.abort(new Error("staged cancellation"));
                if (fault === "deadline") f.clock.value = GATE_TIMELINE_MS.finalCleanup + 1;
              },
            };
          },
          commitRename: fault === "rename" ? () => { throw new Error("rename failure"); } : renameSync,
        });
        prepared.commit();
      }, {
        write: /staged write failure/, sync: /staged sync failure/, close: /staged close failure/,
        identity: /identity changed/, target: /identity changed/, "target-symlink": /identity changed/,
        parent: /identity changed/, rename: /rename failure/, cancel: /staged cancellation/,
        deadline: /final cleanup deadline exceeded/,
      }[fault]);
      await prepared?.discard();
      assert.equal(await readFile(f.environment.MIGRATION_GATE_CI_SUMMARY_PATH, "utf8"), ["target", "target-symlink", "parent"].includes(fault) ? "foreign" : pending);
      if (fault === "identity") assert.equal(await readFile(stagePath, "utf8"), "foreign");
      else if (fault === "parent") assert.equal((await lstat(stagePath)).isFile(), true, "foreign parent owns the replacement hardlink");
      else if (fault === "rename") assert.equal((await lstat(stagePath)).isFile(), true, "released stage remains diagnostic evidence");
      else await assert.rejects(lstat(stagePath), { code: "ENOENT" });
    });
  }
});

test("CI production failure persistence cannot overwrite a replaced summary target or parent", async t => {
  for (const replacement of ["target", "parent"]) await t.test(replacement, async t => {
    const f = await ciFinalizationFixture(t);
    const outcome = await timingGate.runCiQualificationAttempt({
      environment: f.environment, evidence: f.evidence, dispose: () => {},
      stages: { timeline: f.timeline, cancellationSignal: f.controller.signal,
        execute: async ({ completePreflight }) => { completePreflight(); return {}; },
        cleanup: async () => {}, finalize: f.finalize },
      prepare: async (...args) => {
        const prepared = await timingGate.prepareCiTerminalSummary(...args);
        if (replacement === "parent") {
          const { rename } = await import("node:fs/promises");
          const moved = f.root + "-original";
          await rename(f.root, moved); t.after(() => rm(moved, { recursive: true, force: true }));
          await mkdir(f.root, { mode: 0o700 });
        } else await rm(f.environment.MIGRATION_GATE_CI_SUMMARY_PATH);
        await writeFile(f.environment.MIGRATION_GATE_CI_SUMMARY_PATH, "foreign summary", { mode: 0o600 });
        return prepared;
      },
    });
    assert.notEqual(outcome.ciCommitted, true);
    assert.ok(outcome.secondaryErrors.length);
    assert.equal(await readFile(f.environment.MIGRATION_GATE_CI_SUMMARY_PATH, "utf8"), "foreign summary");
  });
});


test("CI summary pins keep every original inode live through awaited publication", async t => {
  for (const fault of ["none", "parent-close", "target-close", "stage-close", "all-close", "cancel-after-close", "deadline-after-close", "rename-after-close", "foreign-after-close"]) {
    await t.test(fault, async t => {
      const f = await ciFinalizationFixture(t);
      const live = new Map(), closed = [];
      const canonicalRoot = await realpath(f.root);
      let stagePath, failureWrites = 0;
      const pinOperations = {
        open(file, flags) {
          assert.ok(flags & constants.O_NOFOLLOW);
          assert.ok(flags & constants.O_NONBLOCK);
          const fd = openSync(file, flags);
          live.set(fd, file); return fd;
        },
        stat: fstatSync,
        close(fd) {
          assert.ok(live.has(fd), "each raw descriptor is released only once");
          const file = live.get(fd); closeSync(fd); live.delete(fd); closed.push(file);
          const kind = file === canonicalRoot ? "parent" : path.basename(file) === "local-migration-gate-summary.json" ? "target" : "stage";
          if (fault === kind + "-close" || fault === "all-close") throw new Error(kind + " pin close failure");
          if (!live.size) {
            if (fault === "cancel-after-close") f.controller.abort(new Error("cancel after pins closed"));
            if (fault === "deadline-after-close") f.clock.value = GATE_TIMELINE_MS.finalCleanup + 1;
            if (fault === "foreign-after-close") {
              unlinkSync(f.environment.MIGRATION_GATE_CI_SUMMARY_PATH);
              writeFileSync(f.environment.MIGRATION_GATE_CI_SUMMARY_PATH, "foreign after close", { mode: 0o600 });
              throw new Error("ownership released before foreign replacement");
            }
          }
        },
      };
      const outcome = await timingGate.runCiQualificationAttempt({
        environment: f.environment, evidence: f.evidence, dispose: () => {}, pinOperations,
        stages: { timeline: f.timeline, cancellationSignal: f.controller.signal,
          execute: async ({ completePreflight }) => { completePreflight(); return {}; },
          cleanup: async () => {}, finalize: f.finalize },
        publish: async options => {
          assert.equal(live.size, 2, "parent and original target pinned before receipt await");
          await timingGate.publishCompletedCiQualification(options);
          assert.equal(live.size, 2);
        },
        prepare: async (...args) => {
          const prepared = await timingGate.prepareCiTerminalSummary(args[0], args[1], {
            ...args[2],
            openFile: async (file, flags, mode) => {
              stagePath = file;
              const handle = await open(file, flags, mode);
              return { stat: () => handle.stat(), sync: () => handle.sync(),
                writeFile: async bytes => {
                  assert.equal(live.size, 3, "stage pin acquired before awaited write");
                  await handle.writeFile(bytes);
                }, close: () => handle.close() };
            },
            commitRename: (from, to) => {
              assert.equal(live.size, 0, "all checked closes precede rename");
              if (fault === "rename-after-close") throw new Error("rename after close failure");
              renameSync(from, to);
            },
          });
          assert.equal(live.size, 3, "stage stays pinned after writable close");
          return prepared;
        },
        persistFailure: async () => { failureWrites++; },
      });
      assert.equal(live.size, 0);
      assert.equal(closed.length, 3, "every acquired descriptor had one release attempt");
      assert.equal(failureWrites, 0, "no asynchronous downgrade after ownership release");
      if (fault === "none") {
        assert.equal(outcome.ciCommitted, true);
        assert.equal((await f.readSummary()).status, "passed");
        await assert.rejects(lstat(stagePath), { code: "ENOENT" });
      } else {
        assert.notEqual(outcome.ciCommitted, true);
        const expected = {
          "all-close": /parent pin close failure.*target pin close failure.*stage pin close failure/,
          "parent-close": /parent pin close failure/, "target-close": /target pin close failure/,
          "stage-close": /stage pin close failure/, "cancel-after-close": /cancel after pins closed/,
          "deadline-after-close": /final cleanup deadline exceeded/, "rename-after-close": /rename after close failure/,
          "foreign-after-close": /ownership released before foreign replacement/,
        }[fault];
        assert.match(outcome.secondaryErrors[0].message, expected);
        assert.equal((await lstat(stagePath)).isFile(), true, "released stage is retained without stale-identity unlink");
        if (fault === "foreign-after-close") assert.equal(await readFile(f.environment.MIGRATION_GATE_CI_SUMMARY_PATH, "utf8"), "foreign after close");
        else assert.equal((await f.readSummary()).status, "running");
      }
    });
  }
});

test("CI stage pin survives writer close and preserves a later unlink/recreate replacement", async t => {
  const f = await ciFinalizationFixture(t);
  await f.finalize();
  let staged;
  const prepared = await timingGate.prepareCiTerminalSummary(f.environment, f.evidence().summary, {
    timeline: f.timeline,
    openFile: async (...args) => { staged = args[0]; return open(...args); },
  });
  await rm(staged);
  await writeFile(staged, "foreign stage", { mode: 0o600 });
  assert.throws(() => prepared.commit(), /identity changed/);
  await prepared.discard();
  assert.equal(await readFile(staged, "utf8"), "foreign stage");
  assert.equal((await f.readSummary()).status, "running");
});


test("CI descriptor acquisition and failed downgrade preserve primary errors and release all pins", async t => {
  for (const fault of ["target-open", "prepare-write", "failure-commit-discard"]) await t.test(fault, async t => {
    const f = await ciFinalizationFixture(t);
    const live = new Map(), closed = [];
    let stageStats = 0;
    const pinOperations = {
      open(file, flags) {
        if (fault === "target-open" && path.basename(file) === "local-migration-gate-summary.json") throw new Error("target pin open failed");
        const fd = openSync(file, flags); live.set(fd, file); return fd;
      },
      stat(fd) {
        if (path.basename(live.get(fd)).startsWith(".local-migration-gate-summary.ci-") && ++stageStats === 2 && fault === "failure-commit-discard") throw new Error("failure commit guard");
        return fstatSync(fd);
      },
      close(fd) {
        assert.ok(live.has(fd));
        const file = live.get(fd); closeSync(fd); live.delete(fd); closed.push(file);
        if (path.basename(file).startsWith(".local-migration-gate-summary.ci-") && fault !== "target-open") throw new Error("stage release failed too");
      },
    };
    if (fault === "prepare-write") {
      await f.finalize();
      await assert.rejects(timingGate.prepareCiTerminalSummary(f.environment, f.evidence().summary, {
        timeline: f.timeline, pinOperations,
        openFile: async (...args) => {
          const handle = await open(...args);
          return { stat: () => handle.stat(), close: () => handle.close(), sync: () => handle.sync(),
            writeFile: async () => { throw new Error("original staged write failure"); } };
        },
      }), /original staged write failure.*stage release failed too/);
    } else {
      const outcome = await timingGate.runCiQualificationAttempt({
        environment: f.environment, evidence: f.evidence, dispose: () => {}, pinOperations,
        stages: { timeline: f.timeline, cancellationSignal: f.controller.signal,
          execute: async ({ completePreflight }) => { completePreflight(); return {}; },
          cleanup: async () => {}, finalize: f.finalize },
        publish: async () => { throw new Error("receipt failed first"); },
      });
      assert.notEqual(outcome.ciCommitted, true);
      if (fault === "target-open") assert.match(outcome.secondaryErrors[0].message, /target pin open failed/);
      else {
        assert.match(outcome.secondaryErrors[0].message, /receipt failed first/);
        assert.match(outcome.secondaryErrors[1].message, /failure commit guard.*stage release failed too/);
      }
    }
    assert.equal(live.size, 0);
    assert.equal(closed.length, fault === "target-open" ? 1 : 3);
    assert.equal((await f.readSummary()).status, "running");
  });
});
