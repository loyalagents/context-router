import { EventEmitter } from "node:events";

import { ValidationPipe } from "@nestjs/common";

import {
  LOCAL_IDENTITY_PREVIEW_READINESS,
  configureLocalIdentityPreview,
  runLocalIdentityPreview,
  type LocalIdentityPreviewApplication,
  type LocalIdentityPreviewProcessController,
} from "./local-identity-preview";

class FakeProcessController
  extends EventEmitter
  implements LocalIdentityPreviewProcessController
{
  readonly terminate = jest.fn();

  override on(event: "SIGINT" | "SIGTERM", listener: () => void): this {
    return super.on(event, listener);
  }

  off(event: "SIGINT" | "SIGTERM", listener: () => void): this {
    return super.off(event, listener);
  }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function makeApplication(
  overrides: Partial<LocalIdentityPreviewApplication> = {},
): LocalIdentityPreviewApplication & { listen: jest.Mock } {
  return {
    useGlobalPipes: jest.fn(),
    init: jest.fn().mockResolvedValue(undefined),
    close: jest.fn().mockResolvedValue(undefined),
    listen: jest.fn(),
    ...overrides,
  };
}

async function flushAsyncWork(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
  await new Promise<void>((resolve) => setImmediate(resolve));
}

const configuration = {
  stateRoot: "/private/state-canary",
  databaseTargetId: "target-canary",
  database: {},
  clientConfig: {},
  poolConfig: {},
} as never;

describe("local identity preview", () => {
  it("configures validation without configuring a listener", () => {
    const application = makeApplication();

    configureLocalIdentityPreview(application);

    expect(application.useGlobalPipes).toHaveBeenCalledTimes(1);
    const pipe = (application.useGlobalPipes as jest.Mock).mock.calls[0][0];
    expect(pipe).toBeInstanceOf(ValidationPipe);
    expect(pipe.validatorOptions).toMatchObject({
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    expect(application.listen).not.toHaveBeenCalled();
  });

  it.each([
    ["SIGINT", 130],
    ["SIGTERM", 143],
  ] as const)(
    "verifies twice, emits fixed readiness, and closes once on %s",
    async (signal, expectedCode) => {
      const events: string[] = [];
      const application = makeApplication({
        useGlobalPipes: jest.fn(() => events.push("configure")),
        init: jest.fn(async () => {
          events.push("init");
        }),
        close: jest.fn(async () => {
          events.push("close");
        }),
      });
      const processController = new FakeProcessController();
      const verifyReadyState = jest.fn(async () => {
        events.push(`verify-${verifyReadyState.mock.calls.length}`);
        return {} as never;
      });
      const createApplication = jest.fn(async () => {
        events.push("create");
        return application;
      });
      const readiness: string[] = [];
      let settled = false;

      const run = runLocalIdentityPreview({
        configuration,
        verifyReadyState,
        createApplication,
        processController,
        reportReadiness: (value) => {
          events.push("readiness");
          readiness.push(value);
        },
        shutdownTimeoutMs: 100,
      }).then((code) => {
        settled = true;
        return code;
      });

      await flushAsyncWork();
      expect(settled).toBe(false);
      expect(events).toEqual([
        "verify-1",
        "create",
        "configure",
        "init",
        "verify-2",
        "readiness",
      ]);
      expect(readiness).toEqual([LOCAL_IDENTITY_PREVIEW_READINESS]);
      expect(readiness.join("")).not.toMatch(
        /state-canary|target-canary|credential|principal|password/,
      );
      expect(application.listen).not.toHaveBeenCalled();

      processController.emit(signal);
      processController.emit(signal === "SIGINT" ? "SIGTERM" : "SIGINT");

      await expect(run).resolves.toBe(expectedCode);
      expect(application.close).toHaveBeenCalledTimes(1);
      expect(processController.terminate).toHaveBeenCalledWith(expectedCode);
      expect(processController.listenerCount("SIGINT")).toBe(0);
      expect(processController.listenerCount("SIGTERM")).toBe(0);
    },
  );

  it("does not create an application when the first verification fails", async () => {
    const processController = new FakeProcessController();
    const createApplication = jest.fn();

    await expect(
      runLocalIdentityPreview({
        configuration,
        verifyReadyState: jest
          .fn()
          .mockRejectedValue(new Error("credential-canary")),
        createApplication,
        processController,
        reportReadiness: jest.fn(),
      }),
    ).rejects.toThrow("credential-canary");

    expect(createApplication).not.toHaveBeenCalled();
    expect(processController.listenerCount("SIGINT")).toBe(0);
    expect(processController.listenerCount("SIGTERM")).toBe(0);
  });

  it.each(["init", "second verification", "readiness"] as const)(
    "closes once and suppresses readiness after a %s failure",
    async (failure) => {
      const application = makeApplication();
      if (failure === "init") {
        (application.init as jest.Mock).mockRejectedValue(
          new Error("init-canary"),
        );
      }
      const verifyReadyState = jest
        .fn()
        .mockResolvedValueOnce({})
        .mockImplementationOnce(async () => {
          if (failure === "second verification") {
            throw new Error("verification-canary");
          }
          return {};
        });
      const reportReadiness = jest.fn(() => {
        if (failure === "readiness") throw new Error("readiness-canary");
      });

      await expect(
        runLocalIdentityPreview({
          configuration,
          verifyReadyState,
          createApplication: jest.fn().mockResolvedValue(application),
          processController: new FakeProcessController(),
          reportReadiness,
          shutdownTimeoutMs: 100,
        }),
      ).rejects.toThrow();

      expect(application.close).toHaveBeenCalledTimes(1);
      if (failure !== "readiness") {
        expect(reportReadiness).not.toHaveBeenCalled();
      }
    },
  );

  it("closes an application that becomes owned after a startup signal", async () => {
    const pendingApplication = deferred<LocalIdentityPreviewApplication>();
    const application = makeApplication();
    const processController = new FakeProcessController();
    const reportReadiness = jest.fn();
    const run = runLocalIdentityPreview({
      configuration,
      verifyReadyState: jest.fn().mockResolvedValue({}),
      createApplication: jest.fn(() => pendingApplication.promise),
      processController,
      reportReadiness,
      shutdownTimeoutMs: 100,
    });

    await flushAsyncWork();
    processController.emit("SIGTERM");
    pendingApplication.resolve(application);

    await expect(run).resolves.toBe(143);
    expect(application.init).not.toHaveBeenCalled();
    expect(application.close).toHaveBeenCalledTimes(1);
    expect(reportReadiness).not.toHaveBeenCalled();
    expect(processController.terminate).toHaveBeenCalledWith(143);
  });

  it("waits for pending initialization before closing after a signal", async () => {
    const pendingInit = deferred<void>();
    const application = makeApplication({
      init: jest.fn(() => pendingInit.promise),
    });
    const processController = new FakeProcessController();
    const reportReadiness = jest.fn();
    let settled = false;
    const run = runLocalIdentityPreview({
      configuration,
      verifyReadyState: jest.fn().mockResolvedValue({}),
      createApplication: jest.fn().mockResolvedValue(application),
      processController,
      reportReadiness,
      shutdownTimeoutMs: 100,
    }).then((code) => {
      settled = true;
      return code;
    });

    await flushAsyncWork();
    processController.emit("SIGINT");
    await flushAsyncWork();

    expect(settled).toBe(false);
    expect(application.close).not.toHaveBeenCalled();
    expect(reportReadiness).not.toHaveBeenCalled();
    pendingInit.resolve();

    await expect(run).resolves.toBe(130);
    expect(application.close).toHaveBeenCalledTimes(1);
    expect(processController.terminate).toHaveBeenCalledWith(130);
  });

  it("bounds pending initialization without closing concurrently", async () => {
    const application = makeApplication({
      init: jest.fn(() => new Promise<void>(() => undefined)),
    });
    const processController = new FakeProcessController();
    const failures: string[] = [];
    const run = runLocalIdentityPreview({
      configuration,
      verifyReadyState: jest.fn().mockResolvedValue({}),
      createApplication: jest.fn().mockResolvedValue(application),
      processController,
      reportReadiness: jest.fn(),
      reportShutdownFailure: (value) => failures.push(value),
      shutdownTimeoutMs: 10,
    });

    await flushAsyncWork();
    processController.emit("SIGTERM");

    await expect(run).resolves.toBe(143);
    expect(failures).toEqual(["Local identity preview shutdown failed\n"]);
    expect(application.close).not.toHaveBeenCalled();
    expect(processController.terminate).toHaveBeenCalledWith(143);
  });

  it("bounds a hanging close and emits only one fixed shutdown diagnostic", async () => {
    const application = makeApplication({
      close: jest.fn(() => new Promise<void>(() => undefined)),
    });
    const processController = new FakeProcessController();
    const failures: string[] = [];
    const run = runLocalIdentityPreview({
      configuration,
      verifyReadyState: jest.fn().mockResolvedValue({}),
      createApplication: jest.fn().mockResolvedValue(application),
      processController,
      reportReadiness: jest.fn(),
      reportShutdownFailure: (value) => failures.push(value),
      shutdownTimeoutMs: 10,
    });

    await flushAsyncWork();
    processController.emit("SIGTERM");

    await expect(run).resolves.toBe(143);
    expect(failures).toEqual(["Local identity preview shutdown failed\n"]);
    expect(failures.join("")).not.toMatch(
      /state-canary|target-canary|credential|principal|password/,
    );
    expect(application.close).toHaveBeenCalledTimes(1);
    expect(processController.terminate).toHaveBeenCalledWith(143);
  });

  it("forces termination when startup-failure cleanup exceeds its deadline", async () => {
    const application = makeApplication({
      init: jest.fn().mockRejectedValue(new Error("init-canary")),
      close: jest.fn(() => new Promise<void>(() => undefined)),
    });
    const processController = new FakeProcessController();
    const failures: string[] = [];

    await expect(
      runLocalIdentityPreview({
        configuration,
        verifyReadyState: jest.fn().mockResolvedValue({}),
        createApplication: jest.fn().mockResolvedValue(application),
        processController,
        reportReadiness: jest.fn(),
        reportShutdownFailure: (value) => failures.push(value),
        shutdownTimeoutMs: 10,
      }),
    ).rejects.toThrow("Local identity preview startup failed during cleanup");

    expect(failures).toEqual(["Local identity preview shutdown failed\n"]);
    expect(processController.terminate).toHaveBeenCalledWith(1);
  });
});
