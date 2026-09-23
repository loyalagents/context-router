import { writeSync } from "node:fs";

import { ValidationPipe } from "@nestjs/common";

import type { LocalIdentityConfiguration } from "../config/local-identity.config";
import { LocalIdentityFileStore } from "../modules/auth/local-identity-filesystem";
import { PostgresLocalIdentityCoordination } from '@/infrastructure/storage/postgres/postgres-local-identity-coordination';
import { LocalIdentityStateService } from "../modules/auth/local-identity-state.service";

type LocalIdentityPreviewSignal = "SIGINT" | "SIGTERM";

export interface LocalIdentityPreviewApplication {
  useGlobalPipes(...pipes: unknown[]): unknown;
  init(): Promise<unknown>;
  close(): Promise<unknown>;
}

export interface LocalIdentityPreviewProcessController {
  on(signal: LocalIdentityPreviewSignal, listener: () => void): unknown;
  off(signal: LocalIdentityPreviewSignal, listener: () => void): unknown;
  terminate(code: number): unknown;
}

export interface LocalIdentityPreviewOptions {
  configuration: LocalIdentityConfiguration;
  verifyReadyState?: () => Promise<unknown>;
  createApplication?: (
    configuration: LocalIdentityConfiguration,
  ) => Promise<LocalIdentityPreviewApplication>;
  processController?: LocalIdentityPreviewProcessController;
  reportReadiness?: (value: string) => void;
  reportShutdownFailure?: (value: string) => void;
  shutdownTimeoutMs?: number;
}

export const LOCAL_IDENTITY_PREVIEW_READINESS =
  '{"type":"context-router.local-identity.preview.ready","version":1}\n';

const DEFAULT_SHUTDOWN_TIMEOUT_MS = 10_000;
const SHUTDOWN_FAILURE = "Local identity preview shutdown failed\n";

const defaultProcessController: LocalIdentityPreviewProcessController = {
  on: (signal, listener) => process.on(signal, listener),
  off: (signal, listener) => process.off(signal, listener),
  terminate: (code) => process.exit(code),
};

function createDefaultVerifier(
  configuration: LocalIdentityConfiguration,
): () => Promise<unknown> {
  const service = new LocalIdentityStateService({
    fileStore: new LocalIdentityFileStore({
      stateRoot: configuration.stateRoot,
      databaseTargetId: configuration.databaseTargetId,
    }),
    repository: new PostgresLocalIdentityCoordination({
      clientConfig: configuration.clientConfig,
    }),
  });
  return () => service.verifyReadyState();
}

async function createNestLocalIdentityApplication(
  configuration: LocalIdentityConfiguration,
): Promise<LocalIdentityPreviewApplication> {
  const [{ NestFactory }, { LocalApplicationModule }] = await Promise.all([
    import("@nestjs/core"),
    import("../composition/local-application.module"),
  ]);
  return NestFactory.create(LocalApplicationModule.register(configuration), {
    abortOnError: false,
    logger: false,
  });
}

export function configureLocalIdentityPreview(
  application: LocalIdentityPreviewApplication,
): void {
  application.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );
}

function writeReadiness(value: string): void {
  process.stdout.write(value);
}

function writeShutdownFailure(value: string): void {
  writeSync(2, value);
}

async function withDeadline(
  operation: () => Promise<void>,
  timeoutMs: number,
): Promise<void> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw new Error("Invalid local identity preview shutdown deadline");
  }
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      operation(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error("Local identity preview shutdown deadline exceeded"),
            ),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function interrupted(): Error {
  return new Error("Local identity preview interrupted");
}

function signalExitCode(signal: LocalIdentityPreviewSignal): number {
  return signal === "SIGINT" ? 130 : 143;
}

export async function runLocalIdentityPreview({
  configuration,
  verifyReadyState = createDefaultVerifier(configuration),
  createApplication = createNestLocalIdentityApplication,
  processController = defaultProcessController,
  reportReadiness = writeReadiness,
  reportShutdownFailure = writeShutdownFailure,
  shutdownTimeoutMs = DEFAULT_SHUTDOWN_TIMEOUT_MS,
}: LocalIdentityPreviewOptions): Promise<number> {
  let application: LocalIdentityPreviewApplication | undefined;
  let applicationPromise: Promise<LocalIdentityPreviewApplication> | undefined;
  let initializationPromise: Promise<unknown> | undefined;
  let verificationPromise: Promise<unknown> | undefined;
  let closePromise: Promise<void> | undefined;
  let keepAlive: NodeJS.Timeout | undefined;
  let receivedSignal: LocalIdentityPreviewSignal | undefined;
  let resolveSignal!: (signal: LocalIdentityPreviewSignal) => void;
  let resolveShutdown!: (code: number) => void;
  const signalReceived = new Promise<LocalIdentityPreviewSignal>((resolve) => {
    resolveSignal = resolve;
  });
  const shutdownComplete = new Promise<number>((resolve) => {
    resolveShutdown = resolve;
  });

  const removeSignalHandlers = () => {
    processController.off("SIGINT", onSigint);
    processController.off("SIGTERM", onSigterm);
    if (keepAlive) {
      clearInterval(keepAlive);
      keepAlive = undefined;
    }
  };

  const reportFixedShutdownFailure = () => {
    try {
      reportShutdownFailure(SHUTDOWN_FAILURE);
    } catch {
      // Reporting must never prevent bounded shutdown completion.
    }
  };

  const closeWhenAvailable = async (): Promise<void> => {
    const ownedVerification = verificationPromise;
    const ownedApplicationPromise = applicationPromise;
    const ownedInitialization = initializationPromise;
    await withDeadline(async () => {
      const settleVerification = ownedVerification
        ? ownedVerification.then(
            () => undefined,
            () => undefined,
          )
        : Promise.resolve();
      const settleInitialization = ownedInitialization
        ? ownedInitialization.then(
            () => undefined,
            () => undefined,
          )
        : Promise.resolve();
      const closeApplication = async () => {
        await settleInitialization;
        let ownedApplication = application;
        if (!ownedApplication && ownedApplicationPromise) {
          ownedApplication = await ownedApplicationPromise.catch(
            () => undefined,
          );
        }
        if (ownedApplication) {
          await Promise.resolve(ownedApplication.close()).then(() => undefined);
        }
      };
      await Promise.all([settleVerification, closeApplication()]);
    }, shutdownTimeoutMs);
  };

  const closeOnce = (): Promise<void> => {
    closePromise ??= closeWhenAvailable();
    return closePromise;
  };

  const handleSignal = (signal: LocalIdentityPreviewSignal) => {
    if (receivedSignal) return;
    receivedSignal = signal;
    resolveSignal(signal);
    void (async () => {
      try {
        await closeOnce();
      } catch {
        reportFixedShutdownFailure();
      } finally {
        removeSignalHandlers();
        const exitCode = signalExitCode(signal);
        resolveShutdown(exitCode);
        processController.terminate(exitCode);
      }
    })();
  };
  const onSigint = () => handleSignal("SIGINT");
  const onSigterm = () => handleSignal("SIGTERM");

  const awaitStartup = async <T>(operation: Promise<T>): Promise<T> => {
    const outcome = await Promise.race([
      operation.then((value) => ({ kind: "value" as const, value })),
      signalReceived.then(() => ({ kind: "signal" as const })),
    ]);
    if (outcome.kind === "signal" || receivedSignal) throw interrupted();
    return outcome.value;
  };

  processController.on("SIGINT", onSigint);
  processController.on("SIGTERM", onSigterm);
  keepAlive = setInterval(() => undefined, 60_000);

  try {
    verificationPromise = Promise.resolve().then(verifyReadyState);
    await awaitStartup(verificationPromise);

    applicationPromise = createApplication(configuration);
    application = await awaitStartup(applicationPromise);

    configureLocalIdentityPreview(application);
    if (receivedSignal) throw interrupted();

    initializationPromise = Promise.resolve().then(() => application!.init());
    await awaitStartup(initializationPromise);

    verificationPromise = Promise.resolve().then(verifyReadyState);
    await awaitStartup(verificationPromise);
    if (receivedSignal) throw interrupted();

    reportReadiness(LOCAL_IDENTITY_PREVIEW_READINESS);
    if (receivedSignal) throw interrupted();

    return await shutdownComplete;
  } catch (primaryError) {
    if (receivedSignal) return shutdownComplete;

    let cleanupError: unknown;
    if (application || applicationPromise) {
      try {
        await closeOnce();
      } catch (error) {
        cleanupError = error;
      }
    }
    removeSignalHandlers();

    if (cleanupError) {
      reportFixedShutdownFailure();
      processController.terminate(1);
      throw new AggregateError(
        [primaryError, cleanupError],
        "Local identity preview startup failed during cleanup",
      );
    }
    throw primaryError;
  }
}
