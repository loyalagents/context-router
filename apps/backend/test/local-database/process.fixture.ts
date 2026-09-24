import * as path from "node:path";
import { fork, execFile, type ChildProcess } from "node:child_process";

export class OwnedIdentityProcesses {
  readonly children: Array<{
    child: ChildProcess;
    exit: Promise<void>;
    stderr(): string;
    stdout(): string;
  }> = [];
  start(
    databaseRoot: string,
    identityRoot: string,
    action: string,
    boundary = "none",
  ) {
    const child = fork(
      path.join(__dirname, "fixtures/identity-process.cjs"),
      [
        path.resolve(__dirname, "../../dist"),
        databaseRoot,
        identityRoot,
        action,
        boundary,
      ],
      {
        execPath: process.execPath,
        execArgv: ["--no-global-search-paths"],
        cwd: path.dirname(databaseRoot),
        env: {},
        stdio: ["ignore", "pipe", "pipe", "ipc"],
      },
    );
    let stderr = "",
      stdout = "";
    child.stderr!.on("data", (bytes) => {
      stderr += bytes;
    });
    child.stdout!.on("data", (bytes) => {
      stdout += bytes;
    });
    const exit = new Promise<void>((resolve) =>
      child.once("exit", () => resolve()),
    );
    this.children.push({
      child,
      exit,
      stderr: () => stderr,
      stdout: () => stdout,
    });
    const messages: any[] = [];
    let waiting:
      | {
          resolve(value: any): void;
          reject(error: Error): void;
          timer: ReturnType<typeof setTimeout>;
        }
      | undefined;
    child.on("message", (message) => {
      if (waiting) {
        const next = waiting;
        waiting = undefined;
        clearTimeout(next.timer);
        next.resolve(message);
      } else messages.push(message);
    });
    child.on("error", () => {
      if (waiting) {
        clearTimeout(waiting.timer);
        waiting.reject(new Error("Owned process failed"));
        waiting = undefined;
      }
    });
    const next = async () => {
      if (messages.length) return messages.shift();
      return new Promise<any>((resolve, reject) => {
        const timer = setTimeout(() => {
          waiting = undefined;
          reject(new Error("Owned process message deadline"));
        }, 5000);
        waiting = { resolve, reject, timer };
      });
    };
    return {
      child,
      next,
      reap: () => this.boundedExit(child, exit),
      terminate: async () => {
        if (child.exitCode === null && child.signalCode === null)
          child.kill("SIGKILL");
        await this.boundedExit(child, exit);
      },
    };
  }
  private async boundedExit(
    child: ChildProcess,
    exit: Promise<void>,
  ): Promise<void> {
    let timer: ReturnType<typeof setTimeout>;
    try {
      await Promise.race([
        exit,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () =>
              reject(new Error("Owned process exit uncertain; preserve files")),
            5000,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
    if (child.exitCode === null && child.signalCode === null)
      throw new Error("Owned process not reaped");
  }
  async command(databaseRoot: string, identityRoot: string, action: string) {
    const process = this.start(databaseRoot, identityRoot, action);
    const result = await process.next();
    await process.reap();
    expect(process.child.exitCode).toBe(result.kind === "done" ? 0 : 1);
    return result;
  }
  async dispose(): Promise<void> {
    const results = await Promise.allSettled(
      this.children.map(async ({ child, exit }) => {
        if (child.exitCode === null && child.signalCode === null)
          child.kill("SIGKILL");
        await this.boundedExit(child, exit);
      }),
    );
    if (results.some((result) => result.status === "rejected"))
      throw new Error("Owned process cleanup uncertain; preserve files");
    for (const child of this.children) {
      expect(child.stderr()).toBe("");
      expect(child.stdout()).toBe("");
    }
  }
}

/** Observe the exact owned PID's stopped OS state; sending SIGSTOP alone is not this witness. */
export async function waitForStopped(child: ChildProcess): Promise<void> {
  const deadline = performance.now() + 3000;
  while (performance.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null)
      throw new Error("Owned process exited before stop");
    const state = await new Promise<string>((resolve, reject) =>
      execFile(
        "/bin/ps",
        ["-o", "stat=", "-p", String(child.pid)],
        { timeout: 1000 },
        (error, stdout) =>
          error
            ? reject(new Error("Owned process state unavailable"))
            : resolve(stdout.trim()),
      ),
    );
    if (state.includes("T")) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Owned process did not enter stopped state");
}
