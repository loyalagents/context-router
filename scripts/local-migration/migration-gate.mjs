#!/usr/bin/env node
import { assertLocalUiSmokeSuccessResources } from './local-ui-lifecycle.mjs';
import { localUiBrowserPrerequisite } from './local-ui-browser.mjs';
import { assertLocalMcpSmokeSuccessResources } from './local-mcp-lifecycle.mjs';
import { assertLocalModelSmokeSuccessResources } from './local-model-lifecycle.mjs';

import {
  createLaneReceipt, parseQualificationProfile, publishLaneReceipt,
  qualificationContract, qualificationProvenance, qualificationRunner,
  selectQualificationPhases,
} from "./ci-qualification.mjs";

import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, realpathSync, renameSync, unlinkSync } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readFile,
  readlink,
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
import { PACKAGING_TIMING_MAX_BYTES, parsePackagingTimings } from "./packaging-progress.mjs";
import { isLocalDatabaseCommand, projectDatabaseCommandFailure, runWithDatabaseEvidence, unavailableDatabaseEvidence, persistDatabaseEvidence } from "./local-database-evidence.mjs";
import {
  checkCurrentToolchain,
  EXPECTED_PNPM_VERSION,
  TOOLCHAIN_ERROR_MESSAGE,
} from "../check-toolchain.mjs";

const execFileAsync = promisify(execFile);
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "../..");
const dependencyRoots = ["", "apps/backend", "apps/web", "apps/local-orchestrator", "apps/desktop"];
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
  phaseCancellation: 107 * 60_000,
  childSettlement: 110 * 60_000,
  finalCleanup: 113 * 60_000,
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

async function externalGateSummaryTarget(environment) {
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
  return path.join(runnerTemporaryReal, expectedName);
}

export async function persistExternalGateSummary(environment, summary, canaries = []) {
  const target = await externalGateSummaryTarget(environment);
  if (!target) return null;
  await writeSanitizedJson(target, summary, canaries);
  return target;
}

const sameCiIdentity = (actual, expected) => actual.dev === expected.dev && actual.ino === expected.ino;
const privateCiFile = value => value.isFile() && !value.isSymbolicLink() &&
  value.uid === process.getuid() && (value.mode & 0o777) === 0o600;
const ciPinOperations = { open: openSync, stat: fstatSync, close: closeSync };
function closeCiPins(pins) {
  const errors = [];
  for (const pin of pins) {
    if (!pin.live) continue;
    // Never retry a raw descriptor: even a failed close can have released its number.
    pin.live = false;
    try { pin.operations.close(pin.fd); } catch (error) { errors.push(error); }
  }
  if (errors.length) throw combineFailures(errors[0], errors.slice(1), "CI descriptor release");
}
function assertCiPin(pin) {
  if (!pin.live) throw new Error("CI terminal summary ownership already released");
  const descriptor = pin.operations.stat(pin.fd), current = lstatSync(pin.file);
  const validType = pin.directory
    ? current.isDirectory() && !current.isSymbolicLink() && current.uid === process.getuid() && realpathSync(pin.file) === pin.file
    : privateCiFile(current);
  if (!validType || !sameCiIdentity(descriptor, pin.identity) || !sameCiIdentity(current, descriptor)) {
    throw new Error("CI terminal summary publication identity changed");
  }
}
function openCiPin(file, directory, operations, expected = lstatSync(file)) {
  const fd = operations.open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK |
    (directory ? constants.O_DIRECTORY : 0));
  const pin = { fd, file, directory, operations, identity: expected, live: true };
  try { assertCiPin(pin); return pin; }
  catch (error) {
    try { closeCiPins([pin]); } catch (cleanupError) { throw combineFailures(error, [cleanupError], "CI pin acquisition"); }
    throw error;
  }
}
function assertCiSummaryOwnership(ownership) {
  if (ownership.released) throw new Error("CI terminal summary ownership already released");
  assertCiPin(ownership.parentPin);
  assertCiPin(ownership.targetPin);
}
function releaseCiSummaryOwnership(ownership) {
  if (!ownership || ownership.released) return;
  ownership.released = true;
  closeCiPins(ownership.pins);
}
async function captureCiSummaryOwnership(environment, operations = ciPinOperations) {
  const target = await externalGateSummaryTarget(environment);
  if (!target) throw new Error("CI terminal summary requires an export path");
  const parent = path.dirname(target), pins = [];
  try {
    // Synchronous no-follow acquisition pins each inode before any further await.
    const parentPin = openCiPin(parent, true, operations); pins.push(parentPin);
    const targetPin = openCiPin(target, false, operations); pins.push(targetPin);
    const ownership = { target, parent, parentPin, targetPin, pins, operations, released: false };
    assertCiSummaryOwnership(ownership);
    return ownership;
  } catch (error) {
    try { closeCiPins(pins); } catch (cleanupError) { throw combineFailures(error, [cleanupError], "CI ownership acquisition"); }
    throw error;
  }
}

// CI alone has required evidence after bounded finalization. Pins prevent inode
// reuse throughout awaited work. Final checked closes, guards and rename form one
// synchronous suffix; this does not claim atomicity against external processes.
export async function prepareCiTerminalSummary(environment, summary, {
  signal, timeline, canaries = [], openFile = open, commitRename = renameSync,
  ownership: suppliedOwnership, pinOperations = ciPinOperations,
} = {}) {
  const ownership = suppliedOwnership ?? await captureCiSummaryOwnership(environment, pinOperations);
  const { target, parent } = ownership;
  const staged = path.join(parent, ".local-migration-gate-summary.ci-" + randomBytes(16).toString("hex"));
  let handle, stagePin;
  const discard = async () => {
    // A failed close/final guard/rename may leave a private stage. Once original
    // ownership was released, no async path may mutate using its stale identity.
    if (ownership.released) return;
    const errors = [];
    const writer = handle; handle = null;
    try { await writer?.close(); } catch (error) { errors.push(error); }
    if (stagePin?.live) {
      let owned = false;
      try { assertCiPin(ownership.parentPin); assertCiPin(stagePin); owned = true; } catch { /* Preserve foreign paths. */ }
      if (owned) { try { unlinkSync(staged); } catch (error) { errors.push(error); } }
      try { closeCiPins([stagePin]); } catch (error) { errors.push(error); }
    }
    if (!suppliedOwnership) {
      try { releaseCiSummaryOwnership(ownership); } catch (error) { errors.push(error); }
    }
    if (errors.length) throw combineFailures(errors[0], errors.slice(1), "CI stage discard");
  };
  const check = () => {
    if (signal?.aborted) throw signal.reason ?? new Error("CI terminal publication cancelled");
    timeline.assertBefore("finalCleanup");
  };
  try {
    if (await externalGateSummaryTarget(environment) !== target) throw new Error("CI summary target changed");
    assertCiSummaryOwnership(ownership);
    check();
    handle = await openFile(staged, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    const identity = await handle.stat();
    // Acquire and verify the read pin while the writer still holds the original.
    stagePin = openCiPin(staged, false, ownership.operations, identity);
    ownership.pins.push(stagePin);
    await handle.writeFile(redactSecrets(JSON.stringify(summary, null, 2), canaries) + "\n");
    await handle.sync();
    const writer = handle; handle = null;
    await writer.close();
    return {
      discard,
      commit() {
        assertCiSummaryOwnership(ownership);
        assertCiPin(stagePin);
        check();
        // Every release is checked before pass. No event-loop yield, downgrade,
        // or unpinned stage deletion is permitted after this release starts.
        releaseCiSummaryOwnership(ownership);
        check();
        commitRename(staged, target);
        // Successful rename is the terminal commit. No fallible postcheck here.
      },
    };
  } catch (error) {
    try { await discard(); } catch (cleanupError) { throw combineFailures(error, [cleanupError], "CI preparation"); }
    throw error;
  }
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

function unavailablePackagingTimings(reason) {
  return { schemaVersion: 1, availability: "unavailable", milestones: [], reason };
}

/** Best-effort projection from the settled command's owned log, never raw output. */
export async function readPackagingTimings(ownership, logPath, {
  openFile = open,
} = {}) {
  let handle;
  let result;
  let failureReason = "ownership-invalid";
  try {
    const directory = await assertGateDiagnosticsOwnership(ownership);
    failureReason = "unsafe-log";
    if (logPath !== path.join(directory, "phase-11-packaged-composition-smoke-1.log")) {
      throw new Error("unexpected packaging log");
    }
    if (!constants.O_NOFOLLOW || !constants.O_NONBLOCK) {
      failureReason = "unsupported-safe-open";
      throw new Error("safe open unavailable");
    }
    failureReason = "log-unavailable";
    const inspected = await lstat(logPath);
    failureReason = "unsafe-log";
    if (!inspected.isFile() || inspected.isSymbolicLink()) throw new Error("unsafe log");
    failureReason = "log-unavailable";
    handle = await openFile(logPath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    failureReason = "log-changed";
    const before = await handle.stat();
    if (!before.isFile() || before.dev !== inspected.dev || before.ino !== inspected.ino) {
      throw new Error("log replaced");
    }
    failureReason = "read-failed";
    const length = Math.min(before.size, PACKAGING_TIMING_MAX_BYTES);
    const buffer = Buffer.alloc(length);
    let offset = 0;
    while (offset < length) {
      const { bytesRead } = await handle.read(buffer, offset, length - offset, offset);
      if (!Number.isInteger(bytesRead) || bytesRead <= 0 || bytesRead > length - offset) {
        throw new Error("short log read");
      }
      offset += bytesRead;
    }
    failureReason = "log-changed";
    const after = await handle.stat();
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) {
      throw new Error("log changed during read");
    }
    result = parsePackagingTimings(buffer, { truncated: before.size > length });
  } catch {
    result = unavailablePackagingTimings(failureReason);
  } finally {
    if (handle) {
      try { await handle.close(); }
      catch { result = unavailablePackagingTimings("close-failed"); }
    }
  }
  return result;
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
      // Once every owned child has settled, T+107 must no longer be able to
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
  mode = "full",
  source = summary.source ?? emptyGateSource(),
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
  summary.source = structuredClone(source);
  if (mode !== "smoke-only") {
    summary.databaseTests ??= unavailableDatabaseEvidence("command-not-run", { source, environment: externalEnvironment });
    await persistDatabaseEvidence(summary, externalEnvironment);
  }
  summary.packagingTimings ??= unavailablePackagingTimings(
    mode === "smoke-only" ? "mode-not-applicable" : "phase-not-run",
  );
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
    summary.mode = mode;
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

  if (mode === "ci-source" || mode === "ci-packaging" || mode === "ci-ui") {
    // Required receipt publication and bounded-stage postchecks are still ahead.
    // The returned candidate is internal; durable external evidence stays pending.
    refresh("running");
    summary.cleanupPending = "required-receipt-publication";
    try { await persistExternal(externalEnvironment, summary, summaryCanaries); }
    catch (error) { recordError(error); }
    observeSignals();
    try { timeline.assertBefore("finalCleanup"); } catch (error) { recordError(error); }
    if (evidenceErrors.length) {
      await persistFailure();
      return { summary, diagnosticsDirectory, evidenceErrors };
    }
    refresh("passed");
    if (lifecycle?.state) {
      lifecycle.state.status = "passed";
      lifecycle.state.finishedAt = new Date().toISOString();
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

async function listWorkspaceFiles({ signal, cwd = repositoryRoot } = {}) {
  const [output, deletedOutput] = await Promise.all([
    requireGitSuccess(
      ["ls-files", "-co", "--exclude-standard", "-z"],
      { encoding: "buffer", signal, cwd },
    ),
    requireGitSuccess(["ls-files", "--deleted", "-z"], {
      encoding: "buffer",
      signal,
      cwd,
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

function emptyGateSource() {
  return { headSha: null, dirty: null, copiedInputsSha256: null };
}

/** Identify the actual copied source inputs before generated files or harness setup can change them. */
export async function copyGateSourceInputs(
  callerRoot,
  workspace,
  { signal, onSourceCaptured = () => {} } = {},
) {
  const source = emptyGateSource();
  const publish = () => onSourceCaptured(Object.freeze({ ...source }));
  await publish();
  source.headSha = (
    await requireGitSuccess(["rev-parse", "HEAD"], { cwd: callerRoot, signal })
  ).trim();
  if (!/^[a-f0-9]{40,64}$/.test(source.headSha))
    throw new Error("caller source HEAD is unavailable");
  await publish();
  const statusArgs = [
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
    "-z",
  ];
  const beforeStatus = await requireGitSuccess(statusArgs, {
    cwd: callerRoot,
    signal,
  });
  source.dirty = beforeStatus.length !== 0;
  await publish();
  const files = [
    ...new Set(await listWorkspaceFiles({ cwd: callerRoot, signal })),
  ].sort();
  await copyWorkspaceFiles(callerRoot, workspace, files, { signal });
  const digest = createHash("sha256").update(
    "context-router-gate-copied-inputs-v1\n",
  );
  for (const relativePath of files) {
    if (signal?.aborted) throw signal.reason;
    const file = path.join(workspace, relativePath),
      info = await lstat(file);
    let record;
    if (info.isFile()) {
      record = [
        relativePath,
        "file",
        info.mode & 0o777,
        createHash("sha256")
          .update(await readFile(file, { signal }))
          .digest("hex"),
      ];
    } else if (info.isSymbolicLink()) {
      record = [relativePath, "symlink", await readlink(file)];
    } else throw new Error("copied source input changed kind");
    digest.update(JSON.stringify(record)).update("\n");
  }
  source.copiedInputsSha256 = digest.digest("hex");
  await publish();
  // These are observations, not an atomic working-tree snapshot or a global source lock.
  const afterHead = (
    await requireGitSuccess(["rev-parse", "HEAD"], { cwd: callerRoot, signal })
  ).trim();
  const afterStatus = await requireGitSuccess(statusArgs, {
    cwd: callerRoot,
    signal,
  });
  if (source.headSha !== afterHead || beforeStatus !== afterStatus)
    throw new Error("caller source HEAD or status changed during copy");
  return { files, source: Object.freeze({ ...source }) };
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
    onSourceCaptured = () => {},
  } = {},
) {
  let workspaceOwnership;
  const prepared = await prepareOwnedTemporaryDirectory(
    path.join(os.tmpdir(), "context-router-lmbg-workspace-"),
    async (workspace) => {
      await beforeWorkspacePreparation(workspaceOwnership);
      const { files, source } = await copyGateSourceInputs(
        repositoryRoot, workspace, { signal, onSourceCaptured },
      );
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
        source,
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

export async function exportBaseContracts(
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
    assertLocalModelSmokeSuccessResources(state, smokeLabel);
    assertLocalMcpSmokeSuccessResources(state, smokeLabel);
    assertLocalUiSmokeSuccessResources(state, smokeLabel);
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
    assertLocalModelSmokeSuccessResources(state, smokeLabel);
    assertLocalMcpSmokeSuccessResources(state, smokeLabel);
    assertLocalUiSmokeSuccessResources(state, smokeLabel);
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
  packagingDiagnostics,
  databaseDiagnostics,
}) {
  if (isLocalDatabaseCommand(phase, databaseDiagnostics?.commandArgv)) {
    return runWithDatabaseEvidence({
      ...databaseDiagnostics,
      execute: executeCommand,
      onEvidence(report) { databaseDiagnostics.summary.databaseTests = report; },
    });
  }
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
  try {
    return await executePackagedSmokeCommand({
      executeCommand,
      validateLifecycle: validatePackagedLifecycle,
    });
  } finally {
    if (packagingDiagnostics) {
      const { ownership, logPath, summary } = packagingDiagnostics;
      summary.packagingTimings = await readPackagingTimings(ownership, logPath);
    }
  }
}

async function sha256(filePath) {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

// Native binaries are acquired by the CI prerequisite. Prisma's config loader
// also caches by absolute source path, so prime it in the owned copied workspace
// before packaging snapshots its dependencies. This is not a qualification phase.
export async function prepareQualificationPrerequisites(
  profile,
  { workspace, diagnosticsDirectory, environment, signal, execute = runCommand },
) {
  if (!["full", "smoke-only", "ci-source", "ci-packaging", "ci-ui"].includes(profile)) {
    throw new Error("unknown qualification prerequisite profile");
  }
  if (profile !== "ci-packaging") return;
  if (signal?.aborted) throw signal.reason;
  await execute(["pnpm", "--filter", "backend", "exec", "prisma", "--version"], {
    cwd: workspace,
    env: environment,
    signal,
    timeoutMs: 120_000,
    logPath: path.join(diagnosticsDirectory, "preflight-packaging-prisma.log"),
  });
  if (signal?.aborted) throw signal.reason;
}

export function runQualificationPhaseSequence(manifest, profile, options) {
  return runPhaseSequence(selectQualificationPhases(manifest, profile), options);
}

async function executeFullGate({
  profile = "full",
  workspace,
  files,
  source,
  diagnosticsDirectory,
  diagnosticsOwnership,
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
    databaseTests: unavailableDatabaseEvidence("command-not-run", { source, environment: sourceEnvironment }),
    packagingTimings: unavailablePackagingTimings("phase-not-run"),
    source,
    baseSha,
    baseManifestSha256,
    smokeLifecycle: {},
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
    const phases = selectQualificationPhases(manifest, profile);
    if (profile !== "full") {
      summary.qualification = qualificationContract(
        await readFile(path.join(workspace, "scripts/local-migration/gate-phases.json"), "utf8"),
        await readFile(path.join(workspace, "scripts/local-migration/gate-phases.schema.json"), "utf8"),
      );
    }
    if (profile === "ci-packaging" || profile === "ci-ui") summary.baseComparison = "not-in-profile";
    const phaseTotal = phases.length;

    const temporaryHome = path.join(workspace, ".lmbg-home");
    await mkdir(path.join(temporaryHome, ".cache"), { recursive: true, mode: 0o700 });
    const gateEnvironment = buildIsolatedGateEnvironment(
      sourceEnvironment,
      temporaryHome,
      corepackHome,
    );
    const browserPrerequisite = localUiBrowserPrerequisite(workspace, sourceEnvironment);
    gateEnvironment.LOCAL_UI_BROWSER_EXECUTABLE = browserPrerequisite.executable;
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
    summary.versions = { ...versions, postgres: "pending", chromium: browserPrerequisite.version, playwright: browserPrerequisite.playwright };
    await prepareQualificationPrerequisites(profile, {
      workspace,
      diagnosticsDirectory,
      environment: gateEnvironment,
      signal: preflightSignal,
    });
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
    summary.phases = await runQualificationPhaseSequence(manifest, profile, {
      projectFailureMessage: projectDatabaseCommandFailure,
      onPhaseStart: async (phase) => {
        phaseStart.set(phase.id, timeline.now());
        console.log(`migration-gate: phase ${phases.findIndex(row => row.id === phase.id) + 1}/${phaseTotal} ${phase.id} started`);
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
        const logPath = path.join(
          diagnosticsDirectory,
          `phase-${String(phase.order).padStart(2, "0")}-${phase.id}-${commandIndex}.log`,
        );
        const executeCommand = (evidenceEnvironment = {}) =>
          runCommand(command.argv, {
            cwd: workspace,
            env: { ...phaseEnvironment, ...evidenceEnvironment },
            timeoutMs: remaining,
            logPath,
            signal: workSignal,
            terminationGraceMs: terminationGraceForPhase(phase),
            canaries: sensitiveCanaries,
          });
        const commandResult = await executeGatePhaseCommand({
          phase,
          executeCommand,
          packagingDiagnostics: { ownership: diagnosticsOwnership, logPath, summary },
          databaseDiagnostics: { commandArgv: command.argv, workspace, files, source, environment: sourceEnvironment, canaries: sensitiveCanaries, summary },
          validateRestartLifecycle: async ({ commandSucceeded }) => {
            await assertRestartSmokeLifecycleEvidence(
              phaseEnvironment.MIGRATION_RESTART_SMOKE_DIAGNOSTICS_DIR,
              { commandSucceeded },
            );
            if (commandSucceeded) summary.smokeLifecycle[phase.id] = true;
          },
          validatePackagedLifecycle: async ({ commandSucceeded }) => {
            await assertPackagedSmokeLifecycleEvidence(
              phaseEnvironment.MIGRATION_PACKAGING_SMOKE_DIAGNOSTICS_DIR,
              { commandSucceeded },
            );
            if (commandSucceeded) summary.smokeLifecycle[phase.id] = true;
          },
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
        console.log(`migration-gate: phase ${phases.findIndex(row => row.id === phase.id) + 1}/${phaseTotal} ${phase.id} passed (${result.elapsedMs}ms)`);
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
  source,
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
  environment.LOCAL_UI_BROWSER_EXECUTABLE = localUiBrowserPrerequisite(workspace, sourceEnvironment).executable;
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
  return markGateSuccessCandidate({
    status: "running", mode: "smoke-only", source,
  });
}

export async function publishCompletedCiQualification({
  profile, summary, outcome, provenance, runner,
  workspaceRemoved, diagnosticsDirectory, gateLifecycle,
  runnerTemp, signal, timeline, publish = publishLaneReceipt,
}) {
  if (!outcome || outcome.primaryError || outcome.secondaryErrors?.length ||
      !Array.isArray(outcome.secondaryErrors)) {
    throw new Error("CI qualification bounded-stage finalization did not succeed");
  }
  if (signal?.aborted) throw signal.reason;
  timeline.assertBefore("finalCleanup");
  const receipt = createLaneReceipt({
    profile, summary, contract: summary.qualification, provenance, runner,
    completion: {
      boundedStages: true,
      preflight: outcome.preflightComplete === true,
      childSettlement: outcome.childSettlementAttempted === true,
      workspaceRemoved,
      diagnosticsRemoved: diagnosticsDirectory === null,
      gateLifecycle: gateLifecycle?.state?.status === "passed",
    },
  });
  await publish(path.join(await realpath(runnerTemp), profile + ".json"), receipt, {
    signal, assertDeadline: () => timeline.assertBefore("finalCleanup"),
  });
}

async function persistOwnedCiFailure(environment, summary, canaries, { ownership, timeline }) {
  // A downgrade uses the same atomic ownership-checked path as terminal success.
  // If ownership or the deadline was lost, leave pending/foreign evidence alone.
  const prepared = await prepareCiTerminalSummary(environment, summary, { ownership, timeline, canaries });
  try { prepared.commit(); }
  catch (error) {
    try { await prepared.discard(); } catch (cleanupError) { throw combineFailures(error, [cleanupError], "CI failure publication"); }
    throw error;
  }
}

// This is the production CI orchestration seam: finalizer and bounded-stage
// postchecks, required receipt, private terminal summary preparation, then commit.
export async function runCiQualificationAttempt({
  stages, evidence, environment, summaryCanaries = [], dispose,
  publish = publishCompletedCiQualification,
  prepare = prepareCiTerminalSummary,
  persistFailure = persistOwnedCiFailure, pinOperations = ciPinOperations,
}) {
  const outcome = await runBoundedGateStages(stages);
  const details = evidence();
  let prepared, ownership;
  try {
    ownership = await captureCiSummaryOwnership(environment, pinOperations);
    await publish({ ...details, outcome });
    prepared = await prepare(environment, details.summary, {
      signal: details.signal, timeline: details.timeline, canaries: summaryCanaries, ownership,
    });
    // No await or verdict-affecting work is allowed after this commit. Listener
    // disposal is synchronous and signals delivered afterwards are post-completion.
    const committed = { ...outcome, ciCommitted: true };
    prepared.commit();
    try { dispose(); } catch { /* Disposal cannot reclassify a committed result. */ }
    return committed;
  } catch (error) {
    outcome.secondaryErrors.push(error);
    try { await prepared?.discard(); } catch (cleanupError) { outcome.secondaryErrors.push(cleanupError); }
    const failed = structuredClone(details.summary ?? { mode: details.profile });
    failed.status = details.signal?.aborted ? "cancelled" : "failed";
    delete failed.cleanupPending;
    failed.cleanupErrors = outcome.secondaryErrors.map(error => redactSecrets(error.message, summaryCanaries));
    const primary = outcome.primaryError ?? outcome.secondaryErrors[0];
    failed.failure = { message: redactSecrets(primary.message, summaryCanaries), exitCode: primary.exitCode ?? 1 };
    if (ownership && !ownership.released) {
      try { await persistFailure(environment, failed, summaryCanaries, { ownership, timeline: details.timeline }); }
      catch (persistenceError) { outcome.secondaryErrors.push(persistenceError); }
    }
    try { releaseCiSummaryOwnership(ownership); } catch (releaseError) { outcome.secondaryErrors.push(releaseError); }
    return outcome;
  }
}

async function executeGate({ timeline: suppliedTimeline } = {}) {
  const profile = parseQualificationProfile(process.argv.slice(2));
  const provenance = profile.startsWith("ci-") ? qualificationProvenance(process.env) : null;
  const cancellation = createSignalAbortController();
  const smokeOnly = profile === "smoke-only";
  const wallStartedAt = Date.now();
  const timeline = suppliedTimeline ?? createGateTimeline();
  let diagnosticsDirectory;
  let diagnosticsOwnership;
  let callerIntegrity;
  let callerIntegrityVerified = false;
  let disposable;
  let result;
  let primaryError;
  let cleanupErrors = [];
  let finalSummary;
  let workspaceRemoved = false;
  let source = emptyGateSource();
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
        onSourceCaptured(value) {
          source = value;
        },
        onWorkspaceCreated(workspaceOwnership) {
          disposable = {
            workspace: workspaceOwnership.workspace,
            workspaceOwnership,
          };
        },
      },
    );
    return executeFullGate({
      profile,
      source,
      workspace: disposable.workspace,
      files: disposable.files,
      diagnosticsDirectory,
      diagnosticsOwnership,
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
        workspaceRemoved = true;
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
      mode: profile,
      diagnosticsDirectory,
      diagnosticsOwnership,
      lifecycle: gateLifecycle,
      summary,
      source,
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
          onSourceCaptured(value) {
            source = value;
          },
          onWorkspaceCreated(workspaceOwnership) {
            disposable = {
              workspace: workspaceOwnership.workspace,
              workspaceOwnership,
            };
          },
        },
      );
      result = await executeSmokeOnly({
        source,
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
    const stages = {
      timeline,
      cancellationSignal: cancellation.signal,
      execute: executeAttempt,
      cleanup: cleanupAttempt,
      finalize: finalizeAttempt,
    };
    const outcome = provenance
      ? await runCiQualificationAttempt({
          stages, environment: process.env, summaryCanaries,
          dispose: cancellation.dispose,
          evidence: () => ({
            profile, summary: finalSummary, provenance, runner: qualificationRunner(process.env),
            workspaceRemoved, diagnosticsDirectory, gateLifecycle,
            runnerTemp: process.env.RUNNER_TEMP, signal: cancellation.signal, timeline,
          }),
        })
      : await runBoundedGateStages(stages);
    if (outcome.ciCommitted) return;
    result = outcome.result;
    primaryError = outcome.primaryError;
    cleanupErrors = outcome.secondaryErrors;
  }
  try {
    if (smokeOnly) {
      const finalized = await finalizeGateAttemptEvidence({
        timeline,
        mode: "smoke-only",
        source,
        diagnosticsDirectory,
        diagnosticsOwnership,
        summary: primaryError?.gateSummary ?? result ?? { status: "failed" },
        wallStartedAt,
        callerIntegrityVerified,
        attemptError: primaryError,
        cleanupErrors,
        signals: [cancellation.signal],
        summaryCanaries,
        externalEnvironment: process.env,
      });
      diagnosticsDirectory = finalized.diagnosticsDirectory;
      finalSummary = finalized.summary;
      cleanupErrors.push(...finalized.evidenceErrors);
    }
  } finally {
    cancellation.dispose();
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
