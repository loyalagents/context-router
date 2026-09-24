#!/usr/bin/env node

import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { assertLocalDatabaseSmokeSuccessResources } from "./local-database-lifecycle.mjs";
import {
  assertCallerIntegrity,
  assertCompletedResourceLifecycle,
  assertContractBaselineComparisonPerformed,
  buildIsolatedGateEnvironment,
  buildIsolatedGitEnvironment,
  buildPhaseEnvironment,
  captureCallerIntegrity,
  cloneCorepackCache,
  cloneDependencyTrees,
  combineFailures,
  copyWorkspaceFiles,
  createResourceLifecycleJournal,
  createSignalAbortController,
  gitWithoutHooks,
  loadAcceptedDecisionEvidence,
  prepareOwnedTemporaryDirectory,
  readPrivateRegularJson,
  readContractBaselineComparisonEvidence,
  redactSecrets,
  resolveOwnedArtifactPath,
  runCommand,
  runPhaseSequence,
  validateMergeBase,
  validateApprovedPhaseCommands,
  validatePhaseManifest,
  writeSanitizedJson,
} from "./gate-runner.mjs";
import {
  createIsolatedTestDatabase,
  dropIsolatedTestDatabase,
  prepareTestAdministration,
  queryDatabase,
} from "./test-database.mjs";
import { RESTART_SMOKE_BOUNDED_CLEANUP_BUDGET_MS } from "./restart-smoke.mjs";
import {
  checkCurrentToolchain,
  EXPECTED_PNPM_VERSION,
  TOOLCHAIN_ERROR_MESSAGE,
} from "../check-toolchain.mjs";

const execFileAsync = promisify(execFile);
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "../..");
const dependencyRoots = ["", "apps/backend", "apps/web", "apps/local-orchestrator"];
const disposableWorkspaceMarkerRelativePath = path.join(
  ".git",
  "lmbg-workspace-owner.json",
);
const callerIntegrityPaths = [
  path.join(repositoryRoot, "apps/backend/src/schema.gql"),
  path.join(repositoryRoot, "apps/backend/src/generated/prisma"),
  path.join(repositoryRoot, "apps/web/lib/generated"),
];
export const RESTART_SMOKE_TERMINATION_GRACE_MS =
  RESTART_SMOKE_BOUNDED_CLEANUP_BUDGET_MS + 20_000;

export const GATE_TIMELINE_MS = Object.freeze({
  preflight: 3 * 60_000,
  phaseCancellation: 97 * 60_000,
  childSettlement: 100 * 60_000,
  finalCleanup: 103 * 60_000,
});

const GATE_TIMELINE_LABELS = Object.freeze({
  preflight: "preflight",
  phaseCancellation: "phase cancellation",
  childSettlement: "child settlement",
  finalCleanup: "final cleanup",
});

export function createGateTimeline({
  startedAt = performance.now(),
  now = () => performance.now(),
} = {}) {
  if (!Number.isFinite(startedAt)) throw new Error("gate start must be monotonic");
  return {
    startedAt,
    now,
    elapsed() {
      return Math.max(0, now() - startedAt);
    },
    remaining(stage) {
      if (!(stage in GATE_TIMELINE_MS)) {
        throw new Error(`unknown gate deadline ${stage}`);
      }
      return Math.max(0, GATE_TIMELINE_MS[stage] - this.elapsed());
    },
    assertBefore(stage) {
      const remaining = this.remaining(stage);
      if (remaining <= 0) {
        throw new Error(`${GATE_TIMELINE_LABELS[stage]} deadline exceeded`);
      }
      return remaining;
    },
  };
}

export function effectivePhaseTimeoutMs({
  phaseTimeoutMs,
  phaseStartedAt,
  timeline,
}) {
  if (!Number.isInteger(phaseTimeoutMs) || phaseTimeoutMs <= 0) {
    throw new Error("phase timeout must be positive");
  }
  const phaseRemaining = Math.max(
    0,
    phaseTimeoutMs - Math.max(0, timeline.now() - phaseStartedAt),
  );
  const globalRemaining = timeline.assertBefore("phaseCancellation");
  const effective = Math.floor(Math.min(phaseRemaining, globalRemaining));
  if (effective <= 0) throw new Error("phase deadline exceeded");
  return effective;
}

export function createDeadlineAbortController({
  startedAt,
  deadlineOffsetMs,
  label,
  parentSignal,
  now = () => performance.now(),
  schedule = setTimeout,
  cancel = clearTimeout,
}) {
  const controller = new AbortController();
  const abort = (reason) => {
    if (!controller.signal.aborted) controller.abort(reason);
  };
  const parentAbort = () =>
    abort(parentSignal.reason ?? new Error(`${label} aborted`));
  parentSignal?.addEventListener("abort", parentAbort, { once: true });
  if (parentSignal?.aborted) parentAbort();
  const remaining = Math.max(0, startedAt + deadlineOffsetMs - now());
  let timer;
  if (remaining <= 0) {
    abort(new Error(`${label} deadline exceeded`));
  } else {
    timer = schedule(
      () => abort(new Error(`${label} deadline exceeded`)),
      remaining,
    );
  }
  timer?.unref?.();
  return {
    signal: controller.signal,
    dispose() {
      cancel(timer);
      parentSignal?.removeEventListener("abort", parentAbort);
    },
  };
}

export function createFinalCleanupAbortController({
  timeline,
  schedule = setTimeout,
  cancel = clearTimeout,
}) {
  let deadline;
  return {
    start() {
      if (deadline) return deadline.signal;
      timeline.assertBefore("finalCleanup");
      const startedAt = timeline.now();
      const globalRemaining = Math.max(
        0,
        timeline.startedAt + GATE_TIMELINE_MS.finalCleanup - startedAt,
      );
      if (globalRemaining <= 0) {
        throw new Error("final cleanup deadline exceeded");
      }
      deadline = createDeadlineAbortController({
        startedAt,
        deadlineOffsetMs: Math.min(3 * 60_000, globalRemaining),
        label: "final cleanup",
        now: timeline.now,
        schedule,
        cancel,
      });
      return deadline.signal;
    },
    get signal() {
      return this.start();
    },
    dispose() {
      deadline?.dispose();
    },
  };
}

export function terminationGraceForPhase(phase) {
  if (phase.kind === "packaged-smoke") return phase.terminationGraceMs;
  return phase.kind === "restart-smoke"
    ? RESTART_SMOKE_TERMINATION_GRACE_MS
    : 5_000;
}

export function buildAdministrationCanaries(
  administrationUrl,
  additionalCanaries = [],
) {
  const canaries = [...additionalCanaries].filter(Boolean);
  if (administrationUrl) {
    try {
      const encodedPassword = new URL(administrationUrl).password;
      if (encodedPassword) {
        canaries.push(encodedPassword);
        try {
          canaries.push(decodeURIComponent(encodedPassword));
        } catch {
          // The encoded form remains protected even if it is malformed.
        }
      }
    } catch {
      // Administration URL validation is owned by the database helper.
    }
  }
  return [...new Set(canaries)];
}

export async function persistExternalGateSummary(
  environment,
  summary,
  canaries = [],
) {
  const requested = environment.MIGRATION_GATE_CI_SUMMARY_PATH;
  if (!requested) return null;
  const runnerTemporaryDirectory = environment.RUNNER_TEMP;
  if (
    !runnerTemporaryDirectory ||
    !path.isAbsolute(runnerTemporaryDirectory) ||
    !path.isAbsolute(requested)
  ) {
    throw new Error(
      "CI gate evidence requires absolute RUNNER_TEMP and summary paths",
    );
  }
  const [runnerTemporaryReal, requestedParentReal] = await Promise.all([
    realpath(runnerTemporaryDirectory),
    realpath(path.dirname(requested)),
  ]);
  const expectedName = "local-migration-gate-summary.json";
  if (
    requestedParentReal !== runnerTemporaryReal ||
    path.basename(requested) !== expectedName
  ) {
    throw new Error(
      "CI gate evidence must use the exact runner temporary summary path",
    );
  }
  const target = path.join(runnerTemporaryReal, expectedName);
  await writeSanitizedJson(target, summary, canaries);
  return target;
}

export async function prepareGateDiagnosticsRoot(
  prefix,
  { onAllocated = () => {} } = {},
) {
  const prepared = await prepareOwnedTemporaryDirectory(
    prefix,
    async (directory) => {
      const canonicalDirectory = await realpath(directory);
      const ownership = {
        directory: canonicalDirectory,
        markerPath: path.join(canonicalDirectory, ".gate-diagnostics-owner.json"),
        nonce: randomBytes(24).toString("hex"),
      };
      await writeSanitizedJson(ownership.markerPath, {
        schemaVersion: 1,
        directory: ownership.directory,
        nonce: ownership.nonce,
      });
      return ownership;
    },
    {
      cleanupOnFailure: false,
      onCreated: onAllocated,
    },
  );
  return prepared.value;
}

export async function assertGateDiagnosticsOwnership(ownership) {
  if (!ownership?.directory || !ownership.markerPath || !ownership.nonce) {
    throw new Error("gate diagnostics ownership is incomplete");
  }
  const [directoryInfo, markerInfo] = await Promise.all([
    lstat(ownership.directory),
    lstat(ownership.markerPath),
  ]);
  if (
    !directoryInfo.isDirectory() ||
    directoryInfo.isSymbolicLink() ||
    !markerInfo.isFile() ||
    markerInfo.isSymbolicLink() ||
    (await realpath(ownership.directory)) !== ownership.directory
  ) {
    throw new Error("gate diagnostics ownership path is invalid");
  }
  const marker = JSON.parse(await readFile(ownership.markerPath, "utf8"));
  if (
    marker.schemaVersion !== 1 ||
    marker.directory !== ownership.directory ||
    marker.nonce !== ownership.nonce
  ) {
    throw new Error("gate diagnostics ownership marker did not verify");
  }
  return ownership.directory;
}

export async function runBoundedGateStages({
  timeline,
  cancellationSignal,
  execute,
  cleanup,
  finalize,
  deadlineFactory = createDeadlineAbortController,
  finalCleanupFactory = createFinalCleanupAbortController,
}) {
  const preflightDeadline = deadlineFactory({
    startedAt: timeline.startedAt,
    deadlineOffsetMs: GATE_TIMELINE_MS.preflight,
    label: "preflight",
    parentSignal: cancellationSignal,
    now: timeline.now,
  });
  const workDeadline = deadlineFactory({
    startedAt: timeline.startedAt,
    deadlineOffsetMs: GATE_TIMELINE_MS.phaseCancellation,
    label: "phase cancellation",
    parentSignal: cancellationSignal,
    now: timeline.now,
  });
  const cleanupDeadline = finalCleanupFactory({ timeline });
  let preflightComplete = false;
  let childSettlementAttempted = false;
  let result;
  let primaryError;
  const secondaryErrors = [];

  const completePreflight = () => {
    if (preflightComplete) return;
    timeline.assertBefore("preflight");
    preflightComplete = true;
    preflightDeadline.dispose();
  };
  const confirmChildSettlement = () => {
    if (childSettlementAttempted) return;
    childSettlementAttempted = true;
    try {
      timeline.assertBefore("childSettlement");
    } finally {
      // Once every owned child has settled, T+97 must no longer be able to
      // reclassify a valid final-cleanup window as cancelled.
      workDeadline.dispose();
    }
  };

  try {
    result = await execute({
      preflightSignal: preflightDeadline.signal,
      workSignal: workDeadline.signal,
      cleanupDeadline,
      completePreflight,
      confirmChildSettlement,
    });
    for (const signal of [cancellationSignal, preflightDeadline.signal, workDeadline.signal]) {
      if (signal?.aborted) {
        throw signal.reason ?? new Error("gate execution was cancelled");
      }
    }
  } catch (error) {
    primaryError = error;
  } finally {
    if (!childSettlementAttempted) {
      try {
        confirmChildSettlement();
      } catch (error) {
        secondaryErrors.push(error);
      }
    }
    let cleanupSignal;
    try {
      cleanupSignal = cleanupDeadline.start();
    } catch (error) {
      secondaryErrors.push(error);
    }
    if (cleanupSignal) {
      try {
        await cleanup({
          signal: cleanupSignal,
          preflightSignal: preflightDeadline.signal,
          workSignal: workDeadline.signal,
          result,
          primaryError,
          secondaryErrors,
        });
      } catch (error) {
        secondaryErrors.push(error);
      }
    }
    if (cleanupSignal?.aborted) {
      const reason = cleanupSignal.reason ?? new Error("final cleanup was cancelled");
      if (!secondaryErrors.includes(reason)) secondaryErrors.push(reason);
    }
    try {
      timeline.assertBefore("finalCleanup");
    } catch (error) {
      secondaryErrors.push(error);
    }
    if (finalize) {
      try {
        await finalize({
          signal: cleanupSignal,
          preflightSignal: preflightDeadline.signal,
          workSignal: workDeadline.signal,
          result,
          primaryError,
          secondaryErrors,
        });
      } catch (error) {
        secondaryErrors.push(error);
      }
    }
    for (const signal of [
      cancellationSignal,
      preflightDeadline.signal,
      workDeadline.signal,
      cleanupSignal,
    ]) {
      if (!signal?.aborted) continue;
      const reason = signal.reason ?? new Error("gate finalization was cancelled");
      if (reason !== primaryError && !secondaryErrors.includes(reason)) {
        secondaryErrors.push(reason);
      }
    }
    try {
      timeline.assertBefore("finalCleanup");
    } catch (error) {
      if (!secondaryErrors.some((existing) => existing.message === error.message)) {
        secondaryErrors.push(error);
      }
    }
    if (!preflightComplete) preflightDeadline.dispose();
    workDeadline.dispose();
    cleanupDeadline.dispose();
  }

  return {
    result,
    primaryError,
    secondaryErrors,
    preflightComplete,
    childSettlementAttempted,
  };
}

export function assertGateLifecycleReadyForSuccess(state) {
  for (const resource of state?.resources ?? []) {
    if (
      resource.status !== "acquired" ||
      !resource.cleanup?.status ||
      new Set(["pending", "failed"]).has(resource.cleanup.status) ||
      resource.recoveryRequired
    ) {
      throw new Error(`gate lifecycle resource ${resource.id ?? "<unknown>"} is incomplete`);
    }
  }
  return state;
}

export function markGateSuccessCandidate(summary) {
  summary.status = "running";
  summary.cleanupPending =
    "caller-integrity-workspace-and-diagnostics-removal";
  return summary;
}

export async function finalizeGateAttemptEvidence({
  timeline,
  diagnosticsDirectory,
  diagnosticsOwnership,
  lifecycle,
  summary,
  wallStartedAt,
  callerIntegrityVerified,
  attemptError,
  cleanupErrors = [],
  signals = [],
  summaryCanaries = [],
  externalEnvironment = process.env,
  persistExternal = persistExternalGateSummary,
  removeDiagnostics = (directory) =>
    rm(directory, { recursive: true, force: true }),
}) {
  const evidenceErrors = [];
  const recordError = (error) => {
    const normalized = error ?? new Error("gate evidence operation failed");
    if (
      !evidenceErrors.some(
        (existing) =>
          existing === normalized || existing.message === normalized.message,
      )
    ) {
      evidenceErrors.push(normalized);
    }
  };
  const observeSignals = () => {
    for (const signal of signals) {
      if (signal?.aborted) {
        recordError(signal.reason ?? new Error("gate operation was cancelled"));
      }
    }
    return signals.some((signal) => signal?.aborted);
  };
  observeSignals();
  const allErrors = () => [...cleanupErrors, ...evidenceErrors];
  const failureStatus = () =>
    signals.some((signal) => signal?.aborted) ? "cancelled" : "failed";
  const refresh = (status) => {
    summary.elapsedMs = Date.now() - wallStartedAt;
    summary.mode = "full";
    summary.callerIntegrity = callerIntegrityVerified;
    summary.status = status;
    summary.cleanupErrors = allErrors().map((error) =>
      redactSecrets(error.message, summaryCanaries),
    );
    const failure = attemptError ?? allErrors()[0];
    summary.failure = failure
      ? {
          message: redactSecrets(failure.message, summaryCanaries),
          exitCode: failure.exitCode ?? 1,
        }
      : null;
    if (status !== "running") delete summary.cleanupPending;
  };
  const verifyOwnership = async ({ record = true } = {}) => {
    try {
      await assertGateDiagnosticsOwnership(diagnosticsOwnership);
      return true;
    } catch (error) {
      if (record) recordError(error);
      return false;
    }
  };
  const writeInternalSummary = async () => {
    await writeSanitizedJson(
      path.join(diagnosticsDirectory, "summary.json"),
      summary,
      summaryCanaries,
    );
  };
  const persistFailure = async () => {
    observeSignals();
    refresh(failureStatus());
    if (await verifyOwnership()) {
      observeSignals();
      try {
        await writeInternalSummary();
      } catch (error) {
        recordError(error);
      }
      observeSignals();
      refresh(failureStatus());
      try {
        await lifecycle?.finish(
          summary.status,
          attemptError ?? allErrors()[0],
        );
      } catch (error) {
        recordError(error);
      }
      observeSignals();
      refresh(failureStatus());
      try {
        await writeInternalSummary();
      } catch (error) {
        recordError(error);
      }
      observeSignals();
    }
    refresh(failureStatus());
    try {
      await persistExternal(externalEnvironment, summary, summaryCanaries);
    } catch (error) {
      recordError(error);
    }
    observeSignals();
    refresh(failureStatus());
  };

  if (!attemptError && !cleanupErrors.length && !evidenceErrors.length) {
    try {
      timeline.assertBefore("finalCleanup");
      assertGateLifecycleReadyForSuccess(lifecycle?.state);
      if (!(await verifyOwnership())) {
        throw evidenceErrors.at(-1) ?? new Error("gate diagnostics ownership failed");
      }
      observeSignals();
      timeline.assertBefore("finalCleanup");
    } catch (error) {
      recordError(error);
    }
  }
  if (attemptError || cleanupErrors.length || evidenceErrors.length) {
    await persistFailure();
    return { summary, diagnosticsDirectory, evidenceErrors };
  }

  // Keep local evidence and the lifecycle nonterminal until automatic
  // diagnostics removal has completed. This prevents a failed removal from
  // leaving a retained `passed` record.
  refresh("running");
  summary.cleanupPending = "automatic-diagnostics-removal";
  try {
    await writeInternalSummary();
  } catch (error) {
    recordError(error);
    await persistFailure();
    return { summary, diagnosticsDirectory, evidenceErrors };
  }
  observeSignals();
  try {
    timeline.assertBefore("finalCleanup");
  } catch (error) {
    recordError(error);
  }
  if (evidenceErrors.length) {
    await persistFailure();
    return { summary, diagnosticsDirectory, evidenceErrors };
  }

  // External evidence is also nonterminal until the owned diagnostics tree is
  // removed. A crash can therefore leave only a recoverable running record,
  // never a false durable pass.
  try {
    await persistExternal(externalEnvironment, summary, summaryCanaries);
  } catch (error) {
    recordError(error);
  }
  observeSignals();
  try {
    timeline.assertBefore("finalCleanup");
  } catch (error) {
    recordError(error);
  }
  if (evidenceErrors.length) {
    await persistFailure();
    return { summary, diagnosticsDirectory, evidenceErrors };
  }

  let removalSucceeded = false;
  try {
    await assertGateDiagnosticsOwnership(diagnosticsOwnership);
    observeSignals();
    timeline.assertBefore("finalCleanup");
    if (evidenceErrors.length) {
      throw evidenceErrors.at(-1);
    }
    await removeDiagnostics(diagnosticsDirectory);
    removalSucceeded = true;
    diagnosticsDirectory = null;
  } catch (error) {
    recordError(error);
  }
  observeSignals();
  try {
    timeline.assertBefore("finalCleanup");
  } catch (error) {
    recordError(error);
  }
  if (evidenceErrors.length) {
    // Never recreate or mutate a tree whose ownership marker disappeared
    // during a partial removal. The external nonterminal record is downgraded
    // regardless of whether local evidence remains writable.
    if (!removalSucceeded && (await verifyOwnership({ record: false }))) {
      await persistFailure();
    } else {
      refresh(failureStatus());
      try {
        await persistExternal(externalEnvironment, summary, summaryCanaries);
      } catch (externalError) {
        recordError(externalError);
        refresh(failureStatus());
      }
    }
    return { summary, diagnosticsDirectory, evidenceErrors };
  }

  const externalPassedSummary = structuredClone(summary);
  externalPassedSummary.status = "passed";
  externalPassedSummary.failure = null;
  delete externalPassedSummary.cleanupPending;
  try {
    await persistExternal(
      externalEnvironment,
      externalPassedSummary,
      summaryCanaries,
    );
  } catch (error) {
    recordError(error);
  }
  observeSignals();
  try {
    timeline.assertBefore("finalCleanup");
  } catch (error) {
    recordError(error);
  }
  if (evidenceErrors.length) {
    refresh(failureStatus());
    try {
      await persistExternal(externalEnvironment, summary, summaryCanaries);
    } catch (externalError) {
      recordError(externalError);
      refresh(failureStatus());
    }
    return { summary, diagnosticsDirectory, evidenceErrors };
  }

  refresh("passed");
  if (lifecycle?.state) {
    lifecycle.state.status = "passed";
    lifecycle.state.finishedAt = new Date().toISOString();
  }
  return { summary, diagnosticsDirectory, evidenceErrors };
}

async function gitCapture(
  args,
  { cwd = repositoryRoot, encoding = "utf8", signal } = {},
) {
  try {
    const result = await execFileAsync("git", args, {
      cwd,
      encoding,
      maxBuffer: 64 * 1024 * 1024,
      signal,
    });
    return { exitCode: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    if (signal?.aborted) throw signal.reason ?? error;
    return {
      exitCode: typeof error.code === "number" ? error.code : 1,
      stdout: error.stdout ?? (encoding === "buffer" ? Buffer.alloc(0) : ""),
      stderr: error.stderr ?? "",
    };
  }
}

async function requireGitSuccess(args, options) {
  const result = await gitCapture(args, options);
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${redactSecrets(result.stderr)}`);
  }
  return result.stdout;
}

async function selectAndValidateBaseSha(environment, { signal } = {}) {
  let candidate = environment.MIGRATION_GATE_BASE_SHA;
  if (!candidate) {
    candidate = await requireGitSuccess(
      ["merge-base", "HEAD", "origin/main"],
      { signal },
    );
  }
  return validateMergeBase(candidate, (args) => gitCapture(args, { signal }));
}

async function listWorkspaceFiles({ signal } = {}) {
  const [output, deletedOutput] = await Promise.all([
    requireGitSuccess(
      ["ls-files", "-co", "--exclude-standard", "-z"],
      { encoding: "buffer", signal },
    ),
    requireGitSuccess(["ls-files", "--deleted", "-z"], {
      encoding: "buffer",
      signal,
    }),
  ]);
  const deleted = new Set(
    deletedOutput.toString("utf8").split("\0").filter(Boolean),
  );
  return output
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .filter((relativePath) => !deleted.has(relativePath))
    .filter((relativePath) => {
      const parts = relativePath.split("/");
      return !parts.some((part) => [".git", "node_modules", "dist", ".next"].includes(part));
    });
}

export async function assertDisposableWorkspaceOwnership(ownership) {
  if (
    !ownership?.workspace ||
    !ownership.ownershipMarker ||
    !ownership.ownershipMarkerPath ||
    !ownership.workspaceMarkerPath ||
    !ownership.device ||
    !ownership.inode
  ) {
    throw new Error("disposable workspace ownership is incomplete");
  }
  const expectedWorkspaceMarkerPath = path.join(
    ownership.workspace,
    disposableWorkspaceMarkerRelativePath,
  );
  if (ownership.workspaceMarkerPath !== expectedWorkspaceMarkerPath) {
    throw new Error("disposable workspace ownership path changed identity");
  }
  let workspaceInfo;
  let canonicalWorkspace;
  let canonicalWorkspaceMarker;
  try {
    [
      workspaceInfo,
      canonicalWorkspace,
      canonicalWorkspaceMarker,
    ] = await Promise.all([
      lstat(ownership.workspace),
      realpath(ownership.workspace),
      realpath(ownership.workspaceMarkerPath),
    ]);
  } catch {
    throw new Error("disposable workspace ownership path changed identity");
  }
  if (
    !workspaceInfo.isDirectory() ||
    workspaceInfo.isSymbolicLink() ||
    canonicalWorkspace !== ownership.workspace ||
    canonicalWorkspaceMarker !== ownership.workspaceMarkerPath ||
    String(workspaceInfo.dev) !== ownership.device ||
    String(workspaceInfo.ino) !== ownership.inode
  ) {
    throw new Error("disposable workspace ownership path changed identity");
  }
  let workspaceMarker;
  try {
    ({ value: workspaceMarker } = await readPrivateRegularJson(
      ownership.workspaceMarkerPath,
    ));
  } catch {
    throw new Error("disposable workspace ownership path changed identity");
  }
  if (
    !workspaceMarker ||
    typeof workspaceMarker !== "object" ||
    Array.isArray(workspaceMarker) ||
    workspaceMarker.schemaVersion !== 1 ||
    workspaceMarker.workspace !== ownership.workspace ||
    workspaceMarker.ownershipMarker !== ownership.ownershipMarker ||
    workspaceMarker.device !== ownership.device ||
    workspaceMarker.inode !== ownership.inode
  ) {
    throw new Error("disposable workspace ownership path changed identity");
  }
  let marker;
  let canonicalOwnershipMarker;
  try {
    [{ value: marker }, canonicalOwnershipMarker] = await Promise.all([
      readPrivateRegularJson(ownership.ownershipMarkerPath),
      realpath(ownership.ownershipMarkerPath),
    ]);
  } catch {
    throw new Error("disposable workspace ownership marker did not verify");
  }
  if (
    canonicalOwnershipMarker !== ownership.ownershipMarkerPath ||
    !marker ||
    typeof marker !== "object" ||
    Array.isArray(marker) ||
    marker.schemaVersion !== 1 ||
    marker.workspace !== ownership.workspace ||
    marker.ownershipMarker !== ownership.ownershipMarker ||
    marker.ownershipMarkerPath !== ownership.ownershipMarkerPath ||
    marker.workspaceMarkerPath !== ownership.workspaceMarkerPath ||
    marker.device !== ownership.device ||
    marker.inode !== ownership.inode
  ) {
    throw new Error("disposable workspace ownership marker did not verify");
  }
  return ownership.workspace;
}

async function removeDisposableWorkspace(disposable, signal) {
  if (signal?.aborted) throw signal.reason;
  await assertDisposableWorkspaceOwnership(disposable.workspaceOwnership);
  if (signal?.aborted) throw signal.reason;
  await rm(disposable.workspace, { recursive: true, force: true });
  const remaining = await lstat(disposable.workspace).catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (remaining) throw new Error("disposable workspace removal did not complete");
  if (signal?.aborted) throw signal.reason;
}

export async function prepareDisposableWorkspace(
  diagnosticsDirectory,
  signal,
  {
    onWorkspaceCreated = () => {},
    beforeWorkspacePreparation = () => {},
  } = {},
) {
  let workspaceOwnership;
  const prepared = await prepareOwnedTemporaryDirectory(
    path.join(os.tmpdir(), "context-router-lmbg-workspace-"),
    async (workspace) => {
      await beforeWorkspacePreparation(workspaceOwnership);
      const files = await listWorkspaceFiles({ signal });
      await copyWorkspaceFiles(repositoryRoot, workspace, files, { signal });
      const setupLog = (name) => path.join(diagnosticsDirectory, `workspace-${name}.log`);
      const gitHome = path.join(workspace, ".lmbg-git-home");
      await mkdir(gitHome, { recursive: true, mode: 0o700 });
      const gitEnvironment = buildIsolatedGitEnvironment(process.env, gitHome);
      for (const [argv, logName, timeoutMs] of [
        [["init", "--quiet"], "git-init", 30_000],
        [["config", "user.name", "Local Migration Gate"], "git-config-name", 30_000],
        [["config", "user.email", "migration-gate@invalid.local"], "git-config-email", 30_000],
        [["add", "--all"], "git-add", 60_000],
        [["commit", "--quiet", "--no-gpg-sign", "-m", "Disposable migration gate snapshot"], "git-commit", 60_000],
      ]) {
        await runCommand(gitWithoutHooks(argv), {
          cwd: workspace,
          env: gitEnvironment,
          timeoutMs,
          logPath: setupLog(logName),
          signal,
        });
      }
      await cloneDependencyTrees(repositoryRoot, workspace, dependencyRoots, {
        signal,
      });
      const sourceCorepackHome =
        process.env.COREPACK_HOME ??
        path.join(
          process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), ".cache"),
          "node",
          "corepack",
        );
      const corepackHome = path.join(diagnosticsDirectory, "corepack-home");
      const cachedPnpmVersions = await cloneCorepackCache(
        sourceCorepackHome,
        corepackHome,
        { signal, requiredPnpmVersion: EXPECTED_PNPM_VERSION },
      );
      return {
        files,
        corepackHome,
        cachedPnpmVersions,
        ownershipMarker: workspaceOwnership.ownershipMarker,
        ownershipMarkerPath: workspaceOwnership.ownershipMarkerPath,
        workspaceOwnership,
      };
    },
    {
      cleanupOnFailure: false,
      async onCreated(workspace) {
        const info = await lstat(workspace);
        workspaceOwnership = {
          workspace: await realpath(workspace),
          ownershipMarker: randomBytes(24).toString("hex"),
          ownershipMarkerPath: path.join(
            await realpath(diagnosticsDirectory),
            "workspace-ownership.json",
          ),
          workspaceMarkerPath: path.join(
            await realpath(workspace),
            disposableWorkspaceMarkerRelativePath,
          ),
          device: String(info.dev),
          inode: String(info.ino),
        };
        await onWorkspaceCreated(workspaceOwnership);
        await writeSanitizedJson(
          workspaceOwnership.ownershipMarkerPath,
          { schemaVersion: 1, ...workspaceOwnership },
        );
        await mkdir(path.dirname(workspaceOwnership.workspaceMarkerPath), {
          recursive: true,
          mode: 0o700,
        });
        await writeSanitizedJson(workspaceOwnership.workspaceMarkerPath, {
          schemaVersion: 1,
          workspace: workspaceOwnership.workspace,
          ownershipMarker: workspaceOwnership.ownershipMarker,
          device: workspaceOwnership.device,
          inode: workspaceOwnership.inode,
        });
      },
    },
  );
  return { workspace: prepared.directory, ...prepared.value };
}

async function gitShow(baseSha, relativePath, { signal } = {}) {
  const result = await gitCapture(["show", `${baseSha}:${relativePath}`], {
    encoding: "buffer",
    signal,
  });
  if (result.exitCode !== 0) return null;
  return result.stdout;
}

async function writeBaseArtifact(baseDirectory, relativePath, content) {
  const destination = await resolveOwnedArtifactPath(baseDirectory, relativePath);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, content, { mode: 0o444, flag: "wx" });
  return {
    path: relativePath,
    sha256: createHash("sha256").update(content).digest("hex"),
  };
}

async function exportBaseContracts(
  baseSha,
  diagnosticsDirectory,
  { signal } = {},
) {
  const baseDirectory = path.join(diagnosticsDirectory, "merge-base-contracts");
  await mkdir(baseDirectory, { recursive: true, mode: 0o700 });
  const artifacts = [];
  for (const producer of [
    "apps/backend/src/schema.gql",
    "apps/backend/src/config/preferences.catalog.json",
  ]) {
    await resolveOwnedArtifactPath(baseDirectory, producer);
    const content = await gitShow(baseSha, producer, { signal });
    if (!content) throw new Error(`merge base lacks required producer ${producer}`);
    artifacts.push(await writeBaseArtifact(baseDirectory, producer, content));
  }

  const registryPath = "docs/current/local-migration-contract-baseline.json";
  const registryContent = await gitShow(baseSha, registryPath, { signal });
  if (!registryContent) {
    const marker = Buffer.from(
      `${JSON.stringify({ baseSha, registryAbsent: true, version: 1 }, null, 2)}\n`,
    );
    artifacts.push(await writeBaseArtifact(baseDirectory, "bootstrap-v1.json", marker));
  } else {
    artifacts.push(await writeBaseArtifact(baseDirectory, registryPath, registryContent));
    const registry = JSON.parse(registryContent.toString("utf8"));
    const referenced = [
      registry.contracts.graphql.fixture,
      registry.contracts.catalog.fixture,
      registry.contracts.http.fixture,
      registry.contracts.mcp.fixture,
      registry.contracts.manifest.schema,
    ];
    for (const relativePath of referenced) {
      await resolveOwnedArtifactPath(baseDirectory, relativePath);
      const content = await gitShow(baseSha, relativePath, { signal });
      if (!content) throw new Error(`merge base registry references missing contract ${relativePath}`);
      artifacts.push(await writeBaseArtifact(baseDirectory, relativePath, content));
    }
  }
  const hashManifestPath = path.join(baseDirectory, "artifact-hashes.json");
  await writeSanitizedJson(hashManifestPath, {
    baseSha,
    artifacts,
  });
  return {
    baseDirectory,
    manifestSha256: await sha256(hashManifestPath),
  };
}

async function validatePython312(pythonBin, workspace, diagnosticsDirectory, environment, signal) {
  const result = await runCommand([pythonBin, "--version"], {
    cwd: workspace,
    env: environment,
    timeoutMs: 30_000,
    logPath: path.join(diagnosticsDirectory, "preflight-python.log"),
    signal,
  });
  const match = result.outputTail.match(/Python\s+(3\.12\.[0-9]+(?:[^\s]*)?)/);
  if (!match) {
    throw new Error(
      `LMBG requires Python 3.12; supply MIGRATION_GATE_PYTHON_BIN or PYTHON_BIN with an exact 3.12 executable`,
    );
  }
  return match[1];
}

async function runPreflight({ workspace, diagnosticsDirectory, environment, pythonBin, signal }) {
  const checks = [
    ["node", [process.execPath, "--version"]],
    ["pnpm", ["pnpm", "--version"]],
  ];
  const versions = {};
  for (const [name, argv] of checks) {
    const result = await runCommand(argv, {
      cwd: workspace,
      env: environment,
      timeoutMs: 30_000,
      logPath: path.join(diagnosticsDirectory, `preflight-${name}.log`),
      signal,
    });
    versions[name] = result.outputTail.replace(/^\[stdout\]\s*/, "").trim();
  }
  versions.python = await validatePython312(
    pythonBin,
    workspace,
    diagnosticsDirectory,
    environment,
    signal,
  );
  return versions;
}

function preflightValue(value) {
  return redactSecrets(String(value)).replace(/\s+/g, " ").trim();
}

export function formatPreflightEvidence({
  baseSha,
  versions,
  administrationSource,
}) {
  return (
    "migration-gate: preflight " +
    `base=${preflightValue(baseSha)} ` +
    `node=${preflightValue(versions.node)} ` +
    `pnpm=${preflightValue(versions.pnpm)} ` +
    `python=${preflightValue(versions.python)} ` +
    `postgres=${preflightValue(versions.postgres)} ` +
    `administration=${preflightValue(administrationSource)}`
  );
}

function incompleteLifecycleRecovery(state) {
  const resources = Array.isArray(state?.resources) ? state.resources : [];
  return resources
    .filter(
      (resource) =>
        resource.status !== "acquired" ||
        !new Set(["clean", "closed", "exited", "not-owned", "removed"]).has(
          resource.cleanup?.status,
        ) ||
        resource.recoveryRequired,
    )
    .map((resource) => ({
      id: resource.id ?? "<unknown>",
      type: resource.type ?? "<unknown>",
      status: resource.status ?? null,
      cleanupStatus: resource.cleanup?.status ?? null,
      identity: resource.identity ?? null,
      recovery: resource.recovery ?? null,
    }));
}

const PACKAGED_SMOKE_REQUIRED_SUCCESS_RESOURCES = Object.freeze([
  ["private-root", "packaging-private-root"],
  ["stable-proxy", "loopback-http-proxy"],
  ["sealed-stage", "read-only-packaged-stage"],
  ["database", "owned-test-database"],
  ["synthetic-secrets", "synthetic-credential-directory"],
  ["synthetic-jwks", "loopback-synthetic-jwks"],
  ["backend-generation-1", "staged-backend-process"],
  ["backend-generation-2", "staged-backend-process"],
]);

function assertPackagedSmokeSuccessResources(state) {
  const resources = state.resources;
  for (const [id, type] of PACKAGED_SMOKE_REQUIRED_SUCCESS_RESOURCES) {
    const matches = resources.filter(
      (resource) => resource.id === id && resource.type === type,
    );
    if (matches.length !== 1) {
      throw new Error(
        `packaged smoke successful lifecycle must contain exactly one ${id} (${type}) resource`,
      );
    }
  }
  for (const generation of [1, 2]) {
    const webAttempts = resources.filter(
      (resource) =>
        resource.type === "staged-web-process" &&
        new RegExp(`^web-generation-${generation}-attempt-[1-9][0-9]*$`).test(
          resource.id,
        ) &&
        resource.identity?.generation === generation,
    );
    if (!webAttempts.length) {
      throw new Error(
        `packaged smoke successful lifecycle is missing generation ${generation} staged web process evidence`,
      );
    }
  }
  const administrationResources = resources.filter(
    (resource) =>
      (resource.id === "administration" &&
        resource.type === "external-administration") ||
      (resource.id === "container" &&
        resource.type === "local-administration-container"),
  );
  if (administrationResources.length !== 1) {
    throw new Error(
      "packaged smoke successful lifecycle must contain exactly one PostgreSQL administration source",
    );
  }
}

const LOCAL_IDENTITY_SMOKE_SUCCESS_RESOURCES = Object.freeze([
  [
    "local-identity-postgres",
    "local-identity-tls-postgres-container",
    "removed",
  ],
  [
    "local-identity-state",
    "local-identity-private-state",
    "removed",
  ],
  [
    "local-identity-admin-1",
    "local-identity-admin-process",
    "exited",
  ],
  [
    "local-identity-admin-2",
    "local-identity-admin-process",
    "exited",
  ],
  [
    "local-identity-admin-3",
    "local-identity-admin-process",
    "exited",
  ],
  [
    "local-identity-admin-4",
    "local-identity-admin-process",
    "exited",
  ],
  [
    "local-identity-preview-1",
    "local-identity-preview-process",
    "exited",
  ],
  [
    "local-identity-preview-2",
    "local-identity-preview-process",
    "exited",
  ],
]);

function assertLocalIdentitySmokeSuccessResources(state, smokeLabel) {
  const hasExactKeys = (value, keys) =>
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) ===
      JSON.stringify([...keys].sort());
  const expectedLocalResources = new Map(
    LOCAL_IDENTITY_SMOKE_SUCCESS_RESOURCES.map(([id, type]) => [id, type]),
  );
  const localResourceTypes = new Set(expectedLocalResources.values());
  const observedLocalResources = state.resources.filter(
    (resource) =>
      resource.id?.startsWith("local-identity-") ||
      localResourceTypes.has(resource.type),
  );
  if (
    observedLocalResources.length !== expectedLocalResources.size ||
    observedLocalResources.some(
      (resource) => expectedLocalResources.get(resource.id) !== resource.type,
    )
  ) {
    throw new Error(
      `${smokeLabel} successful lifecycle must contain exactly the approved local-identity resource set`,
    );
  }
  const selected = new Map();
  for (const [id, type, cleanupStatus] of
    LOCAL_IDENTITY_SMOKE_SUCCESS_RESOURCES) {
    const matches = state.resources.filter(
      (resource) => resource.id === id && resource.type === type,
    );
    if (matches.length !== 1) {
      throw new Error(
        `${smokeLabel} successful lifecycle must contain exactly one ${id} (${type}) resource`,
      );
    }
    const resource = matches[0];
    if (resource.owned !== true || resource.cleanup?.status !== cleanupStatus) {
      throw new Error(
        `${smokeLabel} ${id} must be owned and finish with cleanup ${cleanupStatus}`,
      );
    }
    selected.set(id, resource);
  }
  const postgres = selected.get("local-identity-postgres");
  if (
    postgres.identity?.fixture !== "fresh-native-tls-database" ||
    postgres.identity?.tls !== true ||
    postgres.identity?.loopback !== true ||
    postgres.identity?.tlsOnly !== true ||
    postgres.identity?.plaintextRejected !== true
  ) {
    throw new Error(
      `${smokeLabel} local-identity-postgres is missing native loopback TLS evidence`,
    );
  }
  const postgresRecovery = postgres.recovery;
  let dockerHostIsOwnedUnixSocket = false;
  try {
    const dockerHost = new URL(postgresRecovery?.environment?.DOCKER_HOST);
    dockerHostIsOwnedUnixSocket =
      dockerHost.protocol === "unix:" &&
      path.isAbsolute(decodeURIComponent(dockerHost.pathname));
  } catch {
    dockerHostIsOwnedUnixSocket = false;
  }
  if (
    !hasExactKeys(postgresRecovery, [
      "environment",
      "inspectCommand",
      "instruction",
      "requiredLabel",
    ]) ||
    !hasExactKeys(postgresRecovery.environment, ["DOCKER_HOST"]) ||
    !dockerHostIsOwnedUnixSocket ||
    !Array.isArray(postgresRecovery.inspectCommand) ||
    postgresRecovery.inspectCommand.length !== 4 ||
    postgresRecovery.inspectCommand[0] !== "docker" ||
    postgresRecovery.inspectCommand[1] !== "container" ||
    postgresRecovery.inspectCommand[2] !== "inspect" ||
    !/^lmid-pg-[a-f0-9]{24}$/u.test(
      postgresRecovery.inspectCommand[3] ?? "",
    ) ||
    !/^context-router\.local-identity-smoke-owner=[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
      postgresRecovery.requiredLabel ?? "",
    ) ||
    postgresRecovery.instruction !==
      "Verify the ownership label and remove only the inspected immutable container ID."
  ) {
    throw new Error(
      `${smokeLabel} local-identity-postgres has incomplete scoped recovery evidence`,
    );
  }
  const stateResource = selected.get("local-identity-state");
  if (
    stateResource.identity?.initialized !== true ||
    stateResource.identity?.generation !== 2 ||
    stateResource.identity?.principalStable !== true ||
    stateResource.identity?.credentialRotated !== true ||
    stateResource.identity?.recoveryStable !== true ||
    stateResource.identity?.providerBindings !== 2
  ) {
    throw new Error(
      `${smokeLabel} local-identity-state is missing stable recovery, rotation, or provider-binding evidence`,
    );
  }
  const stateRecovery = stateResource.recovery;
  if (
    !hasExactKeys(stateRecovery, ["instruction", "stateRoot"]) ||
    !path.isAbsolute(stateRecovery.stateRoot ?? "") ||
    path.resolve(stateRecovery.stateRoot) !== stateRecovery.stateRoot ||
    path.basename(stateRecovery.stateRoot) !== "local-identity-state" ||
    stateRecovery.instruction !==
      "Remove only this exact private state root after every recorded child process group exits."
  ) {
    throw new Error(
      `${smokeLabel} local-identity-state has incomplete exact-root recovery evidence`,
    );
  }
  const assertProcessRecovery = (resource, id) => {
    const recovery = resource.recovery;
    if (
      !hasExactKeys(recovery, ["instruction", "processGroupId"]) ||
      recovery.processGroupId !== resource.identity?.pid ||
      recovery.instruction !==
        "Verify the recorded child PID, then terminate and reap only the process group with that exact numeric ID."
    ) {
      throw new Error(
        `${smokeLabel} ${id} has incomplete PID-bound process-group recovery evidence`,
      );
    }
  };
  for (const [number, expected] of [
    [1, { operation: "initialize", generation: 1 }],
    [2, { operation: "recover-initialize", generation: 1 }],
    [3, { operation: "rotate", generation: 2 }],
    [4, { operation: "recover-rotation", generation: 2 }],
  ]) {
    const admin = selected.get(`local-identity-admin-${number}`);
    const identity = admin.identity ?? {};
    if (
      identity.operation !== expected.operation ||
      identity.generation !== expected.generation ||
      !Number.isSafeInteger(identity.pid) ||
      identity.pid < 1 ||
      identity.exitCode !== 0 ||
      identity.childSignal !== null
    ) {
      throw new Error(
        `${smokeLabel} local-identity-admin-${number} has incomplete operation, generation, or exit evidence`,
      );
    }
    assertProcessRecovery(admin, `local-identity-admin-${number}`);
  }
  for (const [number, expected] of [
    [1, { generation: 1, requestedSignal: "SIGTERM", exitCode: 143 }],
    [2, { generation: 2, requestedSignal: "SIGINT", exitCode: 130 }],
  ]) {
    const preview = selected.get(`local-identity-preview-${number}`);
    const identity = preview.identity ?? {};
    if (
      identity.generation !== expected.generation ||
      identity.requestedSignal !== expected.requestedSignal ||
      identity.expectedExitCode !== expected.exitCode ||
      identity.exitCode !== expected.exitCode ||
      identity.childSignal !== null ||
      !Number.isSafeInteger(identity.pid) ||
      identity.pid < 1 ||
      identity.readinessVersion !== 1 ||
      identity.listenerCount !== 0
    ) {
      throw new Error(
        `${smokeLabel} local-identity-preview-${number} has incomplete readiness, listener, or signal-exit evidence`,
      );
    }
    assertProcessRecovery(preview, `local-identity-preview-${number}`);
  }
}

async function readSmokeLifecycleEvidence(
  diagnosticsDirectory,
  smokeLabel,
) {
  if (!path.isAbsolute(diagnosticsDirectory)) {
    throw new Error(`${smokeLabel} diagnostics path must be absolute`);
  }
  const requestedDiagnostics = path.resolve(diagnosticsDirectory);
  const requestedInfo = await lstat(requestedDiagnostics);
  if (!requestedInfo.isDirectory() || requestedInfo.isSymbolicLink()) {
    throw new Error(`${smokeLabel} diagnostics path is not a real directory`);
  }
  const canonicalDiagnostics = await realpath(requestedDiagnostics);
  const diagnosticsInfo = await lstat(canonicalDiagnostics);
  if (!diagnosticsInfo.isDirectory() || diagnosticsInfo.isSymbolicLink()) {
    throw new Error(`${smokeLabel} diagnostics path is not a real directory`);
  }
  if (
    requestedInfo.dev !== diagnosticsInfo.dev ||
    requestedInfo.ino !== diagnosticsInfo.ino
  ) {
    throw new Error(`${smokeLabel} diagnostics path changed identity`);
  }
  const journalPath = path.join(
    canonicalDiagnostics,
    "resource-lifecycle.json",
  );
  const journalInfo = await lstat(journalPath);
  if (!journalInfo.isFile() || journalInfo.isSymbolicLink()) {
    throw new Error(`${smokeLabel} lifecycle journal is not a regular file`);
  }
  if (process.platform !== "win32" && (journalInfo.mode & 0o777) !== 0o600) {
    throw new Error(`${smokeLabel} lifecycle journal must use mode 0600`);
  }
  let state;
  try {
    state = JSON.parse(await readFile(journalPath, "utf8"));
  } catch (error) {
    throw new Error(`${smokeLabel} lifecycle journal is not valid JSON`, {
      cause: error,
    });
  }
  try {
    assertCompletedResourceLifecycle(state);
  } catch (error) {
    const recovery = incompleteLifecycleRecovery(state);
    throw new Error(
      `${smokeLabel} lifecycle evidence is incomplete: ${error.message}; ` +
        `status=${state?.status ?? "missing"}; resources=${JSON.stringify(recovery)}`,
      { cause: error },
    );
  }
  return state;
}

export async function assertRestartSmokeLifecycleEvidence(
  diagnosticsDirectory,
  { commandSucceeded = false } = {},
) {
  const smokeLabel = "restart smoke";
  const state = await readSmokeLifecycleEvidence(
    diagnosticsDirectory,
    smokeLabel,
  );
  if (commandSucceeded && state.status !== "passed") {
    throw new Error(
      `${smokeLabel} exited successfully but lifecycle status was ${state.status}`,
    );
  }
  if (commandSucceeded) {
    assertLocalIdentitySmokeSuccessResources(state, smokeLabel);
    assertLocalDatabaseSmokeSuccessResources(state, smokeLabel);
  }
  return state;
}

export async function assertPackagedSmokeLifecycleEvidence(
  diagnosticsDirectory,
  { commandSucceeded = false } = {},
) {
  const smokeLabel = "packaged smoke";
  const state = await readSmokeLifecycleEvidence(
    diagnosticsDirectory,
    smokeLabel,
  );
  if (commandSucceeded && state.status !== "passed") {
    throw new Error(
      `${smokeLabel} exited successfully but lifecycle status was ${state.status}`,
    );
  }
  if (commandSucceeded) {
    assertPackagedSmokeSuccessResources(state);
    assertLocalIdentitySmokeSuccessResources(state, smokeLabel);
    assertLocalDatabaseSmokeSuccessResources(state, smokeLabel);
  }
  return state;
}

export async function executeSmokeCommand({
  executeCommand,
  validateLifecycle,
  label = "smoke",
}) {
  let result;
  let commandError;
  let lifecycleError;
  try {
    result = await executeCommand();
  } catch (error) {
    commandError = error;
  }
  try {
    await validateLifecycle({ commandSucceeded: !commandError });
  } catch (error) {
    lifecycleError = error;
  }
  const combined = combineFailures(
    commandError,
    [lifecycleError],
    `${label} command and lifecycle evidence`,
  );
  if (combined) throw combined;
  return result;
}

export async function executePackagedSmokeCommand(options) {
  return executeSmokeCommand({ ...options, label: "packaged smoke" });
}

export async function executeGatePhaseCommand({
  phase,
  executeCommand,
  validateRestartLifecycle,
  validatePackagedLifecycle,
}) {
  if (phase.kind === "restart-smoke") {
    if (typeof validateRestartLifecycle !== "function") {
      throw new Error("restart smoke phase requires lifecycle validation");
    }
    return executeSmokeCommand({
      executeCommand,
      validateLifecycle: validateRestartLifecycle,
      label: "restart smoke",
    });
  }
  if (phase.kind !== "packaged-smoke") return executeCommand();
  if (typeof validatePackagedLifecycle !== "function") {
    throw new Error("packaged smoke phase requires lifecycle validation");
  }
  return executePackagedSmokeCommand({
    executeCommand,
    validateLifecycle: validatePackagedLifecycle,
  });
}

async function sha256(filePath) {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

async function executeFullGate({
  workspace,
  diagnosticsDirectory,
  baseSha,
  baseDirectory,
  baseManifestSha256,
  sourceEnvironment,
  corepackHome,
  preflightSignal,
  workSignal,
  cleanupDeadline,
  timeline,
  completePreflight,
  confirmChildSettlement,
  workspaceOwnershipMarker,
  workspaceOwnershipMarkerPath,
  onLifecycleCreated = () => {},
}) {
  const summary = {
    status: "running",
    baseSha,
    versions: {
      node: "pending",
      pnpm: "pending",
      python: "pending",
      postgres: "pending",
    },
    administrationSource: "pending",
    databaseName: null,
    baseComparison: "pending",
    phases: [],
    cleanup: [],
  };
  let lifecycle;
  let administration;
  let database;
  let primaryError;
  const lifecycleErrors = [];
  const phaseStart = new Map();
  const sensitiveCanaries = buildAdministrationCanaries(
    sourceEnvironment.MIGRATION_TEST_ADMIN_URL,
  );
  const addSensitiveCanaries = (values) => {
    for (const value of values) {
      if (!value) continue;
      if (!sensitiveCanaries.includes(value)) sensitiveCanaries.push(value);
      lifecycle?.addCanary(value);
    }
  };
  try {
    if (preflightSignal?.aborted) throw preflightSignal.reason;
    lifecycle = await createResourceLifecycleJournal(
      diagnosticsDirectory,
      {
        filename: "gate-resource-lifecycle.json",
        canaries: sensitiveCanaries,
      },
    );
    await onLifecycleCreated(lifecycle);
    const manifest = JSON.parse(
      await readFile(path.join(workspace, "scripts/local-migration/gate-phases.json"), "utf8"),
    );
    const require = createRequire(path.join(workspace, "package.json"));
    const Ajv2020 = require("ajv/dist/2020").default;
    const manifestSchema = JSON.parse(
      await readFile(path.join(workspace, "scripts/local-migration/gate-phases.schema.json"), "utf8"),
    );
    const validateSchema = new Ajv2020({ strict: true }).compile(manifestSchema);
    if (!validateSchema(manifest)) {
      throw new Error(`gate phase manifest violates schema: ${JSON.stringify(validateSchema.errors)}`);
    }
    const decisionExists = await loadAcceptedDecisionEvidence(
      workspace,
      manifest,
    );
    const semanticErrors = validatePhaseManifest(manifest, { decisionExists });
    if (semanticErrors.length) throw new Error(`gate phase manifest invalid: ${semanticErrors.join("; ")}`);
    const commandPolicyErrors = validateApprovedPhaseCommands(manifest);
    if (commandPolicyErrors.length) throw new Error(`gate command policy invalid: ${commandPolicyErrors.join("; ")}`);
    const phases = manifest.phases.filter((phase) => phase.status === "active");
    const phaseTotal = phases.length;

    const temporaryHome = path.join(workspace, ".lmbg-home");
    await mkdir(path.join(temporaryHome, ".cache"), { recursive: true, mode: 0o700 });
    const gateEnvironment = buildIsolatedGateEnvironment(
      sourceEnvironment,
      temporaryHome,
      corepackHome,
    );
    addSensitiveCanaries([gateEnvironment.AUTH0_CLIENT_SECRET]);
    const pythonBin =
      sourceEnvironment.MIGRATION_GATE_PYTHON_BIN ??
      sourceEnvironment.PYTHON_BIN ??
      "python3.12";
    const versions = await runPreflight({
      workspace,
      diagnosticsDirectory,
      environment: gateEnvironment,
      pythonBin,
      signal: preflightSignal,
    });
    summary.versions = { ...versions, postgres: "pending" };
    const trackedSdlSha256 = await sha256(
      path.join(workspace, "apps/backend/src/schema.gql"),
    );

    administration = await prepareTestAdministration({
      repositoryRoot: workspace,
      diagnosticsDirectory,
      environment: sourceEnvironment,
      signal: preflightSignal,
      cleanupSignal: () => cleanupDeadline.start(),
      lifecycle,
    });
    addSensitiveCanaries(
      buildAdministrationCanaries(administration.administrationUrl),
    );
    summary.administrationSource = administration.source;
    database = await createIsolatedTestDatabase(
      workspace,
      administration.administrationUrl,
      {
        signal: preflightSignal,
        cleanupSignal: () => cleanupDeadline.start(),
        lifecycle,
      },
    );
    summary.databaseName = database.databaseName;
    const serverVersion = await queryDatabase(
      workspace,
      database.databaseUrl,
      "SHOW server_version",
      [],
      { signal: preflightSignal },
    );
    summary.versions.postgres = serverVersion[0]?.server_version ?? "unknown";
    console.log(
      formatPreflightEvidence({
        baseSha,
        versions: summary.versions,
        administrationSource: summary.administrationSource,
      }),
    );
    completePreflight();
    summary.phases = await runPhaseSequence(phases, {
      onPhaseStart: async (phase) => {
        phaseStart.set(phase.id, timeline.now());
        console.log(`migration-gate: phase ${phase.order}/${phaseTotal} ${phase.id} started`);
      },
      execute: async (command, phase) => {
        const commandIndex = phase.commands.indexOf(command) + 1;
        const remaining = effectivePhaseTimeoutMs({
          phaseTimeoutMs: phase.timeoutMs,
          phaseStartedAt: phaseStart.get(phase.id),
          timeline,
        });
        const phaseEnvironment = buildPhaseEnvironment(
          gateEnvironment,
          phase.id,
          {
            commandArgv: command.argv,
            databaseUrl: database.databaseUrl,
            administrationUrl: administration.administrationUrl,
            baseSha,
            baseDirectory,
            baseManifestSha256,
            diagnosticsDirectory,
            pythonBin,
            pythonCacheDirectory: path.join(
              workspace,
              ".lmbg-python-cache",
            ),
            trackedSdlSha256,
            workspace,
            workspaceOwnershipMarker,
            workspaceOwnershipMarkerPath,
            corepackHome,
          },
        );
        const executeCommand = () =>
          runCommand(command.argv, {
            cwd: workspace,
            env: phaseEnvironment,
            timeoutMs: remaining,
            logPath: path.join(
              diagnosticsDirectory,
              `phase-${String(phase.order).padStart(2, "0")}-${phase.id}-${commandIndex}.log`,
            ),
            signal: workSignal,
            terminationGraceMs: terminationGraceForPhase(phase),
            canaries: sensitiveCanaries,
          });
        const commandResult = await executeGatePhaseCommand({
          phase,
          executeCommand,
          validateRestartLifecycle: ({ commandSucceeded }) =>
            assertRestartSmokeLifecycleEvidence(
              phaseEnvironment.MIGRATION_RESTART_SMOKE_DIAGNOSTICS_DIR,
              { commandSucceeded },
            ),
          validatePackagedLifecycle: ({ commandSucceeded }) =>
            assertPackagedSmokeLifecycleEvidence(
              phaseEnvironment.MIGRATION_PACKAGING_SMOKE_DIAGNOSTICS_DIR,
              { commandSucceeded },
            ),
        });
        const comparisonEvidence = readContractBaselineComparisonEvidence(
          command.argv,
          commandResult.outputTail,
        );
        if (comparisonEvidence) summary.baseComparison = comparisonEvidence;
      },
      onPhaseFinish: async (phase, result) => {
        if (phase.id === "contract-baseline") {
          assertContractBaselineComparisonPerformed(summary.baseComparison);
        }
        console.log(`migration-gate: phase ${phase.order}/${phaseTotal} ${phase.id} passed (${result.elapsedMs}ms)`);
      },
      onSummary: async (phasesSummary) => {
        summary.phases = phasesSummary;
        await writeSanitizedJson(
          path.join(diagnosticsDirectory, "summary.json"),
          summary,
          sensitiveCanaries,
        );
      },
    });
    markGateSuccessCandidate(summary);
  } catch (error) {
    primaryError = error;
    summary.status =
      preflightSignal?.aborted || workSignal?.aborted ? "cancelled" : "failed";
    summary.failure = {
      phase: error.phase ?? null,
      exitCode: error.exitCode ?? 1,
      signal: error.signal ?? null,
      message: redactSecrets(error.message, sensitiveCanaries),
    };
  } finally {
    let cleanupSignal;
    try {
      confirmChildSettlement();
    } catch (error) {
      lifecycleErrors.push(error);
    }
    try {
      cleanupSignal = cleanupDeadline.start();
    } catch (error) {
      lifecycleErrors.push(error);
    }
    if (database && administration) {
      let databaseCleanupError;
      try {
        if (!cleanupSignal) {
          throw new Error("database cleanup could not start within the final cleanup window");
        }
        await dropIsolatedTestDatabase(
          workspace,
          administration.administrationUrl,
          database.databaseName,
          {
            expectedOwnershipMarker: database.ownershipMarker,
            signal: cleanupSignal,
          },
        );
        summary.cleanup.push({
          resource: "database",
          status: "removed",
          name: database.databaseName,
        });
      } catch (error) {
        databaseCleanupError = error;
        lifecycleErrors.push(error);
        summary.cleanup.push({
          resource: "database",
          status: "failed",
          message: redactSecrets(error.message, sensitiveCanaries),
        });
      }
      try {
        await lifecycle?.cleanupFinished("database", {
          status: databaseCleanupError ? "failed" : "removed",
          error: databaseCleanupError,
        });
      } catch (error) {
        lifecycleErrors.push(error);
      }
    }
    if (administration) {
      let administrationCleanupError;
      try {
        if (!cleanupSignal) {
          throw new Error(
            "administration cleanup could not start within the final cleanup window",
          );
        }
        await administration.cleanup({ signal: cleanupSignal });
        summary.cleanup.push({ resource: "administration", status: "clean" });
      } catch (error) {
        administrationCleanupError = error;
        lifecycleErrors.push(error);
        summary.cleanup.push({
          resource: "administration",
          status: "failed",
          message: redactSecrets(error.message, sensitiveCanaries),
        });
      }
      try {
        await lifecycle?.cleanupFinished(
          administration.containerName ? "container" : "administration",
          {
            status: administrationCleanupError
              ? "failed"
              : administration.containerName
                ? "removed"
                : "not-owned",
            error: administrationCleanupError,
          },
        );
      } catch (error) {
        lifecycleErrors.push(error);
      }
    }
    if (
      lifecycleErrors.length &&
      summary.status === "running" &&
      summary.cleanupPending
    ) {
      summary.status = "failed";
      delete summary.cleanupPending;
      summary.failure = {
        phase: null,
        exitCode: 1,
        signal: null,
        message: "gate cleanup failed",
      };
    }
    try {
      await writeSanitizedJson(
        path.join(diagnosticsDirectory, "summary.json"),
        summary,
        sensitiveCanaries,
      );
    } catch (error) {
      lifecycleErrors.push(error);
    }
  }

  if (primaryError || lifecycleErrors.length) {
    const message = [
      primaryError?.message,
      ...lifecycleErrors.map((error) => `cleanup/diagnostics failure: ${error.message}`),
    ]
      .filter(Boolean)
      .join("; ");
    const error = new Error(redactSecrets(message, sensitiveCanaries), {
      cause: primaryError ?? lifecycleErrors[0],
    });
    error.phase = primaryError?.phase ?? null;
    error.exitCode = primaryError?.exitCode ?? 1;
    error.signal = primaryError?.signal ?? null;
    error.gateSummary = summary;
    throw error;
  }
  return summary;
}

async function executeSmokeOnly({
  workspace,
  diagnosticsDirectory,
  sourceEnvironment,
  corepackHome,
  signal,
}) {
  const temporaryHome = path.join(workspace, ".lmbg-home");
  await mkdir(temporaryHome, { recursive: true, mode: 0o700 });
  const environment = buildIsolatedGateEnvironment(
    sourceEnvironment,
    temporaryHome,
    corepackHome,
  );
  if (sourceEnvironment.MIGRATION_TEST_ADMIN_URL) {
    environment.MIGRATION_TEST_ADMIN_URL = sourceEnvironment.MIGRATION_TEST_ADMIN_URL;
  }
  environment.MIGRATION_RESTART_SMOKE_DIAGNOSTICS_DIR = path.join(
    diagnosticsDirectory,
    "restart-smoke",
  );
  await executeSmokeCommand({
    label: "restart smoke",
    executeCommand: () =>
      runCommand([process.execPath, "scripts/local-migration/restart-smoke.mjs"], {
        cwd: workspace,
        env: environment,
        timeoutMs: 600_000,
        logPath: path.join(diagnosticsDirectory, "restart-smoke-command.log"),
        signal,
        terminationGraceMs: RESTART_SMOKE_TERMINATION_GRACE_MS,
      }),
    validateLifecycle: ({ commandSucceeded }) =>
      assertRestartSmokeLifecycleEvidence(
        environment.MIGRATION_RESTART_SMOKE_DIAGNOSTICS_DIR,
        { commandSucceeded },
      ),
  });
  return { status: "passed", mode: "smoke-only" };
}

async function executeGate({ timeline: suppliedTimeline } = {}) {
  const cancellation = createSignalAbortController();
  const smokeOnly = process.argv.includes("--smoke-only");
  const wallStartedAt = Date.now();
  const timeline = smokeOnly
    ? null
    : suppliedTimeline ?? createGateTimeline();
  let diagnosticsDirectory;
  let diagnosticsOwnership;
  let callerIntegrity;
  let callerIntegrityVerified = false;
  let disposable;
  let result;
  let primaryError;
  let cleanupErrors = [];
  let finalSummary;
  let gateLifecycle;
  const summaryCanaries = buildAdministrationCanaries(
    process.env.MIGRATION_TEST_ADMIN_URL,
  );

  const executeAttempt = async ({
    preflightSignal,
    workSignal,
    cleanupDeadline,
    completePreflight,
    confirmChildSettlement,
  }) => {
    diagnosticsOwnership = await prepareGateDiagnosticsRoot(
      path.join(os.tmpdir(), "context-router-lmbg-"),
      {
        onAllocated(directory) {
          diagnosticsDirectory = directory;
        },
      },
    );
    diagnosticsDirectory = diagnosticsOwnership.directory;
    if (preflightSignal.aborted) throw preflightSignal.reason;
    callerIntegrity = await captureCallerIntegrity(callerIntegrityPaths, {
      signal: preflightSignal,
    });
    const baseSha = await selectAndValidateBaseSha(process.env, {
      signal: preflightSignal,
    });
    for (const [name, args] of [
      ["base-to-head", ["diff", "--check", `${baseSha}...HEAD`]],
      ["worktree", ["diff", "--check"]],
      ["index", ["diff", "--cached", "--check"]],
    ]) {
      await runCommand(["git", ...args], {
        cwd: repositoryRoot,
        timeoutMs: 60_000,
        logPath: path.join(
          diagnosticsDirectory,
          `caller-${name}-whitespace.log`,
        ),
        signal: preflightSignal,
      });
    }
    const baseBundle = await exportBaseContracts(
      baseSha,
      diagnosticsDirectory,
      { signal: preflightSignal },
    );
    disposable = await prepareDisposableWorkspace(
      diagnosticsDirectory,
      preflightSignal,
      {
        onWorkspaceCreated(workspaceOwnership) {
          disposable = {
            workspace: workspaceOwnership.workspace,
            workspaceOwnership,
          };
        },
      },
    );
    return executeFullGate({
      workspace: disposable.workspace,
      diagnosticsDirectory,
      baseSha,
      baseDirectory: baseBundle.baseDirectory,
      baseManifestSha256: baseBundle.manifestSha256,
      sourceEnvironment: process.env,
      corepackHome: disposable.corepackHome,
      preflightSignal,
      workSignal,
      cleanupDeadline,
      timeline,
      completePreflight,
      confirmChildSettlement,
      workspaceOwnershipMarker: disposable.ownershipMarker,
      workspaceOwnershipMarkerPath: disposable.ownershipMarkerPath,
      onLifecycleCreated(lifecycle) {
        gateLifecycle = lifecycle;
      },
    });
  };

  const cleanupAttempt = async ({
    signal,
    preflightSignal,
    workSignal,
    result: attemptResult,
    primaryError: attemptError,
    secondaryErrors,
  }) => {
    const localErrors = [];
    if (callerIntegrity) {
      try {
        await assertCallerIntegrity(callerIntegrity, { signal });
        callerIntegrityVerified = true;
      } catch (error) {
        localErrors.push(error);
      }
    }
    if (disposable?.workspace) {
      try {
        await removeDisposableWorkspace(disposable, signal);
      } catch (error) {
        localErrors.push(error);
      }
    }
    const combined = combineFailures(null, localErrors, "gate");
    if (combined) throw combined;
  };

  const finalizeAttempt = async ({
    signal,
    preflightSignal,
    workSignal,
    result: attemptResult,
    primaryError: attemptError,
    secondaryErrors,
  }) => {
    const summary = attemptError?.gateSummary ??
      attemptResult ?? {
        status: attemptError || secondaryErrors.length ? "failed" : "passed",
        mode: "full",
      };
    const finalized = await finalizeGateAttemptEvidence({
      timeline,
      diagnosticsDirectory,
      diagnosticsOwnership,
      lifecycle: gateLifecycle,
      summary,
      wallStartedAt,
      callerIntegrityVerified,
      attemptError,
      cleanupErrors: secondaryErrors,
      signals: [
        cancellation.signal,
        preflightSignal,
        workSignal,
        signal,
      ],
      summaryCanaries,
      externalEnvironment: process.env,
    });
    diagnosticsDirectory = finalized.diagnosticsDirectory;
    finalSummary = finalized.summary;
    const combined = combineFailures(
      null,
      finalized.evidenceErrors,
      "gate evidence",
    );
    if (combined) throw combined;
  };

  if (smokeOnly) {
    try {
      diagnosticsOwnership = await prepareGateDiagnosticsRoot(
        path.join(os.tmpdir(), "context-router-smoke-run-"),
        {
          onAllocated(directory) {
            diagnosticsDirectory = directory;
          },
        },
      );
      diagnosticsDirectory = diagnosticsOwnership.directory;
      callerIntegrity = await captureCallerIntegrity(callerIntegrityPaths, {
        signal: cancellation.signal,
      });
      disposable = await prepareDisposableWorkspace(
      diagnosticsDirectory,
      cancellation.signal,
      {
          onWorkspaceCreated(workspaceOwnership) {
            disposable = {
              workspace: workspaceOwnership.workspace,
              workspaceOwnership,
            };
          },
        },
      );
      result = await executeSmokeOnly({
        workspace: disposable.workspace,
        diagnosticsDirectory,
        sourceEnvironment: process.env,
        corepackHome: disposable.corepackHome,
        signal: cancellation.signal,
      });
    } catch (error) {
      primaryError = error;
    } finally {
      if (callerIntegrity) {
        try {
          await assertCallerIntegrity(callerIntegrity);
          callerIntegrityVerified = true;
        } catch (error) {
          cleanupErrors.push(error);
        }
      }
      if (disposable?.workspace) {
        try {
          await removeDisposableWorkspace(disposable);
        } catch (error) {
          cleanupErrors.push(error);
        }
      }
    }
  } else {
    const outcome = await runBoundedGateStages({
      timeline,
      cancellationSignal: cancellation.signal,
      execute: executeAttempt,
      cleanup: cleanupAttempt,
      finalize: finalizeAttempt,
    });
    result = outcome.result;
    primaryError = outcome.primaryError;
    cleanupErrors = outcome.secondaryErrors;
  }
  cancellation.dispose();

  if (smokeOnly) {
    finalSummary = primaryError?.gateSummary ?? result ?? {
      status: "failed",
      mode: "smoke-only",
    };
    finalSummary.elapsedMs = Date.now() - wallStartedAt;
    finalSummary.mode = "smoke-only";
    finalSummary.callerIntegrity = callerIntegrityVerified;
    if (primaryError || cleanupErrors.length) {
      finalSummary.status = cancellation.signal.aborted ? "cancelled" : "failed";
      finalSummary.failure ??= primaryError
        ? {
            message: redactSecrets(primaryError.message, summaryCanaries),
            exitCode: primaryError.exitCode ?? 1,
          }
        : null;
      finalSummary.cleanupErrors = cleanupErrors.map((error) =>
        redactSecrets(error.message, summaryCanaries),
      );
      if (diagnosticsDirectory) {
        try {
          await assertGateDiagnosticsOwnership(diagnosticsOwnership);
          await writeSanitizedJson(
            path.join(diagnosticsDirectory, "summary.json"),
            finalSummary,
            summaryCanaries,
          );
        } catch (error) {
          cleanupErrors.push(error);
        }
      }
    } else if (diagnosticsDirectory) {
      try {
        await assertGateDiagnosticsOwnership(diagnosticsOwnership);
        await rm(diagnosticsDirectory, { recursive: true, force: true });
        diagnosticsDirectory = null;
      } catch (error) {
        cleanupErrors.push(error);
        finalSummary.status = "failed";
        finalSummary.cleanupErrors = cleanupErrors.map((cleanupError) =>
          redactSecrets(cleanupError.message, summaryCanaries),
        );
        try {
          await assertGateDiagnosticsOwnership(diagnosticsOwnership);
          await writeSanitizedJson(
            path.join(diagnosticsDirectory, "summary.json"),
            finalSummary,
            summaryCanaries,
          );
        } catch {}
      }
    }
  }

  if (primaryError || cleanupErrors.length) {
    const combined = [
      primaryError?.message,
      ...cleanupErrors.map(
        (error) => `cleanup/integrity: ${error.message}`,
      ),
    ]
      .filter(Boolean)
      .join("; ");
    console.error(`migration-gate: failed: ${redactSecrets(combined)}`);
    if (diagnosticsDirectory) {
      console.error(
        `migration-gate: sanitized diagnostics retained at ${diagnosticsDirectory}`,
      );
    }
    process.exitCode = primaryError?.exitCode ??
      (cancellation.signal.reason?.message?.includes("SIGINT")
        ? 130
        : cancellation.signal.reason?.message?.includes("SIGTERM")
          ? 143
          : 1);
    return;
  }

  const elapsedMs = finalSummary?.elapsedMs ?? Date.now() - wallStartedAt;
  console.log(
    smokeOnly
      ? `migration-smoke: ok; disposable caller-integrity=true elapsedMs=${elapsedMs}`
      : `migration-gate: ok; phases=${result.phases.length} baseComparison=${result.baseComparison} caller-integrity=true elapsedMs=${elapsedMs}`,
  );
}

export async function runWithToolchainPreflight(
  action = executeGate,
  { checkToolchain = checkCurrentToolchain } = {},
) {
  await checkToolchain();
  return action();
}

export function formatUnhandledGateFailure(
  error,
  { beforeResourceAcquisition },
) {
  const rawMessage = error?.message ?? error;
  if (beforeResourceAcquisition && rawMessage === TOOLCHAIN_ERROR_MESSAGE) {
    return TOOLCHAIN_ERROR_MESSAGE;
  }
  const stage = beforeResourceAcquisition
    ? " before resource acquisition"
    : "";
  return `migration-gate: failed${stage}: ${redactSecrets(rawMessage)}`;
}

async function main() {
  const timeline = process.argv.includes("--smoke-only")
    ? undefined
    : createGateTimeline();
  try {
    await checkCurrentToolchain();
  } catch (error) {
    console.error(
      formatUnhandledGateFailure(error, {
        beforeResourceAcquisition: true,
      }),
    );
    process.exitCode = 1;
    return;
  }

  try {
    await executeGate({ timeline });
  } catch (error) {
    console.error(
      formatUnhandledGateFailure(error, {
        beforeResourceAcquisition: false,
      }),
    );
    process.exitCode = error?.exitCode ?? 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
