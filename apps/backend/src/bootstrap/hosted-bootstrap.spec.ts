import { EventEmitter } from "events";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { ValidationPipe } from "@nestjs/common";
import {
  bootstrapHostedApplication,
  closeHostedApplication,
  configureHostedApplication,
  createHostedApplication,
  startHostedApplication,
  type HostedApplication,
  type HostedProcessController,
} from "./hosted-bootstrap";
import type { RuntimeConfiguration } from "../config/runtime-config";

const runtime = (
  overrides: Partial<RuntimeConfiguration> = {},
): RuntimeConfiguration => ({
  port: 0,
  host: "127.0.0.1",
  corsOrigins: ["http://localhost:3002"],
  ...overrides,
});

const fakeAddress = {
  address: "127.0.0.1",
  family: "IPv4",
  port: 43123,
};

function makeApplication(
  overrides: Partial<HostedApplication> = {},
): HostedApplication {
  return {
    useGlobalPipes: jest.fn(),
    enableCors: jest.fn(),
    listen: jest.fn().mockResolvedValue(undefined),
    getHttpServer: jest.fn().mockReturnValue({
      address: jest.fn().mockReturnValue(fakeAddress),
    }),
    close: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

class FakeProcessController
  extends EventEmitter
  implements HostedProcessController
{
  readonly terminate = jest.fn();

  override on(event: "SIGINT" | "SIGTERM", listener: () => void): this {
    return super.on(event, listener);
  }

  off(event: "SIGINT" | "SIGTERM", listener: () => void): this {
    return super.off(event, listener);
  }
}

async function flushAsyncWork(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
  await new Promise<void>((resolve) => setImmediate(resolve));
}

describe("hosted bootstrap", () => {
  it("rejects a custom environment without a custom application factory", async () => {
    await expect(
      bootstrapHostedApplication({
        packageRoot: "relative-package-root",
        environment: { PORT: "0" },
      }),
    ).rejects.toThrow(
      "Custom runtime environment requires a custom application factory",
    );
  });

  it("keeps create, configure, start, and close as separable operations", async () => {
    const app = makeApplication();
    const create = jest.fn().mockResolvedValue(app);
    const reports: unknown[] = [];

    await expect(createHostedApplication(runtime(), create)).resolves.toBe(app);
    configureHostedApplication(app, runtime());
    const readiness = await startHostedApplication(app, runtime(), (record) =>
      reports.push(record),
    );
    await closeHostedApplication(app, { timeoutMs: 100 });

    expect(app.useGlobalPipes).toHaveBeenCalledTimes(1);
    const pipe = (app.useGlobalPipes as jest.Mock).mock.calls[0][0];
    expect(pipe).toBeInstanceOf(ValidationPipe);
    expect(pipe.validatorOptions).toMatchObject({
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    expect(app.enableCors).toHaveBeenCalledWith({
      origin: runtime().corsOrigins,
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
    expect(app.listen).toHaveBeenCalledWith(0, "127.0.0.1");
    expect(readiness).toEqual({
      type: "context-router.backend.ready",
      version: 1,
      address: "127.0.0.1",
      port: 43123,
    });
    expect(reports).toEqual([readiness]);
    expect(app.close).toHaveBeenCalledTimes(1);
  });

  it("preserves the one-argument hosted listener and reports only after listen resolves", async () => {
    let resolveListen!: () => void;
    const events: string[] = [];
    const app = makeApplication({
      listen: jest.fn(
        () =>
          new Promise<void>((resolve) => {
            resolveListen = () => {
              events.push("listen-resolved");
              resolve();
            };
          }),
      ),
    });
    const start = startHostedApplication(
      app,
      runtime({ port: 4100, host: undefined }),
      () => events.push("readiness"),
    );

    expect(app.listen).toHaveBeenCalledWith(4100);
    expect(events).toEqual([]);
    resolveListen();
    await start;
    expect(events).toEqual(["listen-resolved", "readiness"]);
  });

  it("uses the production JSON writer and preserves human logs with the actual port", async () => {
    const app = makeApplication();
    const processController = new FakeProcessController();
    const packageRoot = mkdtempSync(join(tmpdir(), "hosted-bootstrap-"));
    const logger = { log: jest.fn(), error: jest.fn() };
    const write = jest
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    try {
      const controller = await bootstrapHostedApplication({
        packageRoot,
        environment: { STARTUP_SECRET_CANARY: "never-print-me" },
        createApplication: jest.fn().mockResolvedValue(app),
        processController,
        logger,
        shutdownTimeoutMs: 100,
      });

      expect(write).toHaveBeenCalledWith(
        `${JSON.stringify(controller.readiness)}\n`,
      );
      expect(write.mock.calls.flat().join("")).not.toContain("never-print-me");
      expect(logger.log).toHaveBeenNthCalledWith(
        1,
        "Application is running on: http://127.0.0.1:43123",
      );
      expect(logger.log).toHaveBeenNthCalledWith(
        2,
        "GraphQL Playground: http://127.0.0.1:43123/graphql",
      );
      await controller.close();
    } finally {
      write.mockRestore();
      rmSync(packageRoot, { recursive: true, force: true });
    }
  });

  it.each([
    [null, "null"],
    ["/tmp/backend.sock", "string"],
  ])("rejects non-TCP readiness address %p", async (address) => {
    const app = makeApplication({
      getHttpServer: jest.fn().mockReturnValue({
        address: jest.fn().mockReturnValue(address),
      }),
    });

    await expect(
      startHostedApplication(app, runtime(), jest.fn()),
    ).rejects.toThrow("readiness");
  });

  it("surfaces application creation failures and removes signal handlers", async () => {
    const packageRoot = mkdtempSync(join(tmpdir(), "hosted-bootstrap-"));
    const processController = new FakeProcessController();

    try {
      await expect(
        bootstrapHostedApplication({
          packageRoot,
          environment: {},
          createApplication: jest
            .fn()
            .mockRejectedValue(new Error("create failed")),
          processController,
          reportReadiness: jest.fn(),
          shutdownTimeoutMs: 100,
        }),
      ).rejects.toThrow("create failed");
      expect(processController.listenerCount("SIGINT")).toBe(0);
      expect(processController.listenerCount("SIGTERM")).toBe(0);
      expect(processController.terminate).not.toHaveBeenCalled();
    } finally {
      rmSync(packageRoot, { recursive: true, force: true });
    }
  });

  it.each(["configure", "listen", "readiness"] as const)(
    "closes exactly once after a %s failure",
    async (failure) => {
      const app = makeApplication();
      if (failure === "configure") {
        (app.enableCors as jest.Mock).mockImplementation(() => {
          throw new Error("configure failed");
        });
      } else if (failure === "listen") {
        (app.listen as jest.Mock).mockRejectedValue(new Error("listen failed"));
      } else {
        (app.getHttpServer as jest.Mock).mockReturnValue({
          address: () => null,
        });
      }
      const packageRoot = mkdtempSync(join(tmpdir(), "hosted-bootstrap-"));
      const processController = new FakeProcessController();

      try {
        await expect(
          bootstrapHostedApplication({
            packageRoot,
            environment: {},
            createApplication: jest.fn().mockResolvedValue(app),
            processController,
            reportReadiness: jest.fn(),
            shutdownTimeoutMs: 100,
          }),
        ).rejects.toThrow();
        expect(app.close).toHaveBeenCalledTimes(1);
        expect(processController.listenerCount("SIGINT")).toBe(0);
        expect(processController.listenerCount("SIGTERM")).toBe(0);
      } finally {
        rmSync(packageRoot, { recursive: true, force: true });
      }
    },
  );

  it("retains both startup and cleanup failures", async () => {
    const app = makeApplication({
      listen: jest.fn().mockRejectedValue(new Error("primary failure")),
      close: jest.fn().mockRejectedValue(new Error("cleanup failure")),
    });
    const packageRoot = mkdtempSync(join(tmpdir(), "hosted-bootstrap-"));

    try {
      await expect(
        bootstrapHostedApplication({
          packageRoot,
          environment: {},
          createApplication: jest.fn().mockResolvedValue(app),
          processController: new FakeProcessController(),
          reportReadiness: jest.fn(),
          shutdownTimeoutMs: 100,
        }),
      ).rejects.toMatchObject({
        errors: expect.arrayContaining([
          expect.objectContaining({ message: "primary failure" }),
          expect.objectContaining({ message: "cleanup failure" }),
        ]),
      });
    } finally {
      rmSync(packageRoot, { recursive: true, force: true });
    }
  });

  it("closes when readiness reporting itself fails", async () => {
    const app = makeApplication();
    const packageRoot = mkdtempSync(join(tmpdir(), "hosted-bootstrap-"));

    try {
      await expect(
        bootstrapHostedApplication({
          packageRoot,
          environment: {},
          createApplication: jest.fn().mockResolvedValue(app),
          processController: new FakeProcessController(),
          reportReadiness: () => {
            throw new Error("report failed");
          },
          shutdownTimeoutMs: 100,
        }),
      ).rejects.toThrow("report failed");
      expect(app.close).toHaveBeenCalledTimes(1);
    } finally {
      rmSync(packageRoot, { recursive: true, force: true });
    }
  });

  it.each([
    ["SIGINT", 130],
    ["SIGTERM", 143],
  ] as const)(
    "handles ready %s with one close and exit %i",
    async (signal, code) => {
      const app = makeApplication();
      const processController = new FakeProcessController();
      const packageRoot = mkdtempSync(join(tmpdir(), "hosted-bootstrap-"));

      try {
        await bootstrapHostedApplication({
          packageRoot,
          environment: {},
          createApplication: jest.fn().mockResolvedValue(app),
          processController,
          reportReadiness: jest.fn(),
          shutdownTimeoutMs: 100,
        });

        processController.emit(signal);
        processController.emit(signal === "SIGINT" ? "SIGTERM" : "SIGINT");
        await flushAsyncWork();

        expect(app.close).toHaveBeenCalledTimes(1);
        expect(processController.terminate).toHaveBeenCalledTimes(1);
        expect(processController.terminate).toHaveBeenCalledWith(code);
        expect(processController.listenerCount("SIGINT")).toBe(0);
        expect(processController.listenerCount("SIGTERM")).toBe(0);
      } finally {
        rmSync(packageRoot, { recursive: true, force: true });
      }
    },
  );

  it.each([
    ["SIGINT", 130],
    ["SIGTERM", 143],
  ] as const)(
    "suppresses readiness and closes once when %s arrives during listen",
    async (signal, code) => {
      let resolveListen!: () => void;
      const app = makeApplication({
        listen: jest.fn(
          () =>
            new Promise<void>((resolve) => {
              resolveListen = resolve;
            }),
        ),
      });
      const processController = new FakeProcessController();
      const reportReadiness = jest.fn();
      const packageRoot = mkdtempSync(join(tmpdir(), "hosted-bootstrap-"));

      try {
        const boot = bootstrapHostedApplication({
          packageRoot,
          environment: {},
          createApplication: jest.fn().mockResolvedValue(app),
          processController,
          reportReadiness,
          shutdownTimeoutMs: 100,
        });
        await flushAsyncWork();
        processController.emit(signal);
        resolveListen();

        await expect(boot).rejects.toThrow("interrupted");
        await flushAsyncWork();
        expect(reportReadiness).not.toHaveBeenCalled();
        expect(app.close).toHaveBeenCalledTimes(1);
        expect(processController.terminate).toHaveBeenCalledWith(code);
      } finally {
        rmSync(packageRoot, { recursive: true, force: true });
      }
    },
  );

  it.each([
    ["SIGINT", 130],
    ["SIGTERM", 143],
  ] as const)(
    "closes the application when %s arrives before create resolves",
    async (signal, code) => {
      let resolveCreate!: (app: HostedApplication) => void;
      const app = makeApplication();
      const processController = new FakeProcessController();
      const reportReadiness = jest.fn();
      const packageRoot = mkdtempSync(join(tmpdir(), "hosted-bootstrap-"));

      try {
        const boot = bootstrapHostedApplication({
          packageRoot,
          environment: {},
          createApplication: jest.fn(
            () =>
              new Promise<HostedApplication>((resolve) => {
                resolveCreate = resolve;
              }),
          ),
          processController,
          reportReadiness,
          shutdownTimeoutMs: 100,
        });
        await flushAsyncWork();
        processController.emit(signal);
        resolveCreate(app);

        await expect(boot).rejects.toThrow("interrupted");
        await flushAsyncWork();
        expect(app.close).toHaveBeenCalledTimes(1);
        expect(reportReadiness).not.toHaveBeenCalled();
        expect(processController.terminate).toHaveBeenCalledWith(code);
      } finally {
        rmSync(packageRoot, { recursive: true, force: true });
      }
    },
  );

  it("bounds cleanup when startup fails and close hangs", async () => {
    const app = makeApplication({
      listen: jest.fn().mockRejectedValue(new Error("listen failed")),
      close: jest.fn(() => new Promise<void>(() => undefined)),
    });
    const packageRoot = mkdtempSync(join(tmpdir(), "hosted-bootstrap-"));
    const startedAt = Date.now();

    try {
      await expect(
        bootstrapHostedApplication({
          packageRoot,
          environment: {},
          createApplication: jest.fn().mockResolvedValue(app),
          processController: new FakeProcessController(),
          reportReadiness: jest.fn(),
          shutdownTimeoutMs: 10,
        }),
      ).rejects.toThrow();
      expect(Date.now() - startedAt).toBeLessThan(250);
      expect(app.close).toHaveBeenCalledTimes(1);
    } finally {
      rmSync(packageRoot, { recursive: true, force: true });
    }
  });

  it("forces bounded termination when close never settles", async () => {
    const app = makeApplication({
      close: jest.fn(() => new Promise<void>(() => undefined)),
    });
    const processController = new FakeProcessController();
    const packageRoot = mkdtempSync(join(tmpdir(), "hosted-bootstrap-"));

    try {
      await bootstrapHostedApplication({
        packageRoot,
        environment: {},
        createApplication: jest.fn().mockResolvedValue(app),
        processController,
        reportReadiness: jest.fn(),
        shutdownTimeoutMs: 10,
      });
      processController.emit("SIGTERM");
      await new Promise((resolve) => setTimeout(resolve, 30));

      expect(app.close).toHaveBeenCalledTimes(1);
      expect(processController.terminate).toHaveBeenCalledWith(143);
    } finally {
      rmSync(packageRoot, { recursive: true, force: true });
    }
  });
});
