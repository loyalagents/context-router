import { Logger, ValidationPipe } from "@nestjs/common";
import type { CorsOptions } from "@nestjs/common/interfaces/external/cors-options.interface";
import type { AddressInfo } from "net";
import { resolveListenArguments } from "../config/listener-options";
import {
  loadRuntimeConfiguration,
  type RuntimeConfiguration,
  type RuntimeEnvironment,
} from "../config/runtime-config";

export interface HostedApplication {
  useGlobalPipes(...pipes: unknown[]): unknown;
  enableCors(options: CorsOptions): unknown;
  listen(port: number): Promise<unknown>;
  listen(port: number, host: string): Promise<unknown>;
  getHttpServer(): { address(): AddressInfo | string | null };
  close(): Promise<unknown>;
}

export interface HostedReadiness {
  type: "context-router.backend.ready";
  version: 1;
  address: string;
  port: number;
}

type HostedSignal = "SIGINT" | "SIGTERM";

export interface HostedProcessController {
  on(signal: HostedSignal, listener: () => void): unknown;
  off(signal: HostedSignal, listener: () => void): unknown;
  terminate(code: number): unknown;
}

export interface HostedBootstrapLogger {
  log(message: string): unknown;
  error(message: string): unknown;
}

export interface HostedBootstrapOptions {
  packageRoot: string;
  environment?: RuntimeEnvironment;
  createApplication?: CreateHostedApplication;
  processController?: HostedProcessController;
  reportReadiness?: (readiness: HostedReadiness) => void;
  logger?: HostedBootstrapLogger;
  shutdownTimeoutMs?: number;
}

export interface HostedApplicationController {
  application: HostedApplication;
  readiness: HostedReadiness;
  close(): Promise<void>;
}

export type CreateHostedApplication = (
  configuration: RuntimeConfiguration,
) => Promise<HostedApplication>;

const DEFAULT_SHUTDOWN_TIMEOUT_MS = 10_000;

const defaultProcessController: HostedProcessController = {
  on: (signal, listener) => process.on(signal, listener),
  off: (signal, listener) => process.off(signal, listener),
  terminate: (code) => process.exit(code),
};

async function createNestApplication(
  configuration: RuntimeConfiguration,
): Promise<HostedApplication> {
  const [{ NestFactory }, { AppModule }] = await Promise.all([
    import("@nestjs/core"),
    import("../app.module"),
  ]);
  return NestFactory.create(AppModule.register(configuration, process.env), {
    abortOnError: false,
  });
}

export async function createHostedApplication(
  configuration: RuntimeConfiguration,
  createApplication: CreateHostedApplication = createNestApplication,
): Promise<HostedApplication> {
  return createApplication(configuration);
}

export function configureHostedApplication(
  application: HostedApplication,
  configuration: RuntimeConfiguration,
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

  application.enableCors({
    origin: configuration.corsOrigins,
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "Accept",
      "X-Requested-With",
      "apollographql-client-name",
      "apollographql-client-version",
    ],
  });
}

export function writeReadinessRecord(
  readiness: HostedReadiness,
  output: Pick<NodeJS.WriteStream, "write"> = process.stdout,
): void {
  output.write(`${JSON.stringify(readiness)}\n`);
}

function readBoundAddress(application: HostedApplication): HostedReadiness {
  const address = application.getHttpServer()?.address();
  if (
    !address ||
    typeof address === "string" ||
    typeof address.address !== "string" ||
    !address.address ||
    !Number.isInteger(address.port) ||
    address.port <= 0 ||
    address.port > 65535
  ) {
    throw new Error("Unable to determine backend readiness address");
  }

  return {
    type: "context-router.backend.ready",
    version: 1,
    address: address.address,
    port: address.port,
  };
}

export async function startHostedApplication(
  application: HostedApplication,
  configuration: RuntimeConfiguration,
  reportReadiness: (readiness: HostedReadiness) => void = writeReadinessRecord,
  isStartupInterrupted: () => boolean = () => false,
): Promise<HostedReadiness> {
  const listenArguments = resolveListenArguments(configuration);
  if (listenArguments.length === 2) {
    await application.listen(listenArguments[0], listenArguments[1]);
  } else {
    await application.listen(listenArguments[0]);
  }

  if (isStartupInterrupted()) throw interruptedError();

  const readiness = readBoundAddress(application);
  reportReadiness(readiness);
  return readiness;
}

export async function closeHostedApplication(
  application: HostedApplication,
  { timeoutMs = DEFAULT_SHUTDOWN_TIMEOUT_MS }: { timeoutMs?: number } = {},
): Promise<void> {
  await withShutdownDeadline(
    () => Promise.resolve(application.close()).then(() => undefined),
    timeoutMs,
  );
}

async function withShutdownDeadline(
  operation: () => Promise<void>,
  timeoutMs: number,
): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      operation(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Backend shutdown deadline exceeded")),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function formatHttpHost(address: string): string {
  return address.includes(":") ? `[${address}]` : address;
}

function interruptedError(): Error {
  return new Error("Backend startup interrupted by shutdown signal");
}

export async function bootstrapHostedApplication({
  packageRoot,
  environment = process.env,
  createApplication = createNestApplication,
  processController = defaultProcessController,
  reportReadiness = writeReadinessRecord,
  logger = new Logger("Bootstrap"),
  shutdownTimeoutMs = DEFAULT_SHUTDOWN_TIMEOUT_MS,
}: HostedBootstrapOptions): Promise<HostedApplicationController> {
  const runtimeConfiguration = loadRuntimeConfiguration({
    packageRoot,
    environment,
  });
  let application: HostedApplication | undefined;
  let applicationPromise: Promise<HostedApplication> | undefined;
  let closePromise: Promise<void> | undefined;
  let receivedSignal: HostedSignal | undefined;
  let rejectInterruption!: (error: Error) => void;
  const interruption = new Promise<never>((_, reject) => {
    rejectInterruption = reject;
  });

  const removeSignalHandlers = () => {
    processController.off("SIGINT", onSigint);
    processController.off("SIGTERM", onSigterm);
  };

  const closeOnce = (): Promise<void> => {
    closePromise ??= closeHostedApplicationWhenAvailable();
    return closePromise;
  };

  const closeHostedApplicationWhenAvailable = async (): Promise<void> => {
    await withShutdownDeadline(async () => {
      const ownedApplication = application ?? (await applicationPromise);
      if (!ownedApplication) return;
      await Promise.resolve(ownedApplication.close()).then(() => undefined);
    }, shutdownTimeoutMs);
  };

  const handleSignal = (signal: HostedSignal) => {
    if (receivedSignal) return;
    receivedSignal = signal;
    rejectInterruption(interruptedError());
    void (async () => {
      try {
        await closeOnce();
      } catch {
        logger.error("Backend shutdown did not complete cleanly");
      } finally {
        removeSignalHandlers();
        processController.terminate(signal === "SIGINT" ? 130 : 143);
      }
    })();
  };
  const onSigint = () => handleSignal("SIGINT");
  const onSigterm = () => handleSignal("SIGTERM");

  processController.on("SIGINT", onSigint);
  processController.on("SIGTERM", onSigterm);

  try {
    applicationPromise = createHostedApplication(
      runtimeConfiguration,
      createApplication,
    );
    application = await Promise.race([applicationPromise, interruption]);
    if (receivedSignal) throw interruptedError();

    configureHostedApplication(application, runtimeConfiguration);
    const readiness = await Promise.race([
      startHostedApplication(
        application,
        runtimeConfiguration,
        reportReadiness,
        () => receivedSignal !== undefined,
      ),
      interruption,
    ]);
    if (receivedSignal) throw interruptedError();

    const httpHost = formatHttpHost(readiness.address);
    logger.log(
      `Application is running on: http://${httpHost}:${readiness.port}`,
    );
    logger.log(
      `GraphQL Playground: http://${httpHost}:${readiness.port}/graphql`,
    );

    return {
      application,
      readiness,
      close: async () => {
        removeSignalHandlers();
        await closeOnce();
      },
    };
  } catch (primaryError) {
    let cleanupError: unknown;
    if (application || receivedSignal) {
      try {
        await closeOnce();
      } catch (error) {
        cleanupError = error;
      }
    }
    removeSignalHandlers();

    const effectivePrimary = receivedSignal ? interruptedError() : primaryError;
    if (cleanupError) {
      throw new AggregateError(
        [effectivePrimary, cleanupError],
        receivedSignal
          ? "Backend startup interrupted during cleanup"
          : "Backend startup failed during cleanup",
      );
    }
    throw effectivePrimary;
  }
}
