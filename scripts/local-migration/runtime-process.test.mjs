import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const fixturePath = path.join(
  repositoryRoot,
  "scripts/local-migration/test/runtime-process-child.cjs",
);
const deadlineMs = 5_000;

function startFixture({ packageRoot, cwd, mode = "ready", environment = {} }) {
  const child = spawn(process.execPath, [fixturePath], {
    cwd,
    env: {
      PATH: process.env.PATH,
      NODE_ENV: "test",
      APP_PORT: "ignored-app-port-canary",
      RUNTIME_FIXTURE_MODE: mode,
      RUNTIME_PACKAGE_ROOT: packageRoot,
      RUNTIME_SHUTDOWN_TIMEOUT_MS: "75",
      ...environment,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  let stdout = "";
  let stderr = "";
  let pendingStdout = "";
  let closeResult;
  let resolveClose;
  const closePromise = new Promise((resolve) => {
    resolveClose = resolve;
  });
  const records = [];
  const waiters = new Set();

  const notify = () => {
    for (const waiter of waiters) waiter();
  };
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
    pendingStdout += chunk;
    const lines = pendingStdout.split("\n");
    pendingStdout = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        records.push({ ...JSON.parse(line), __line: line });
      } catch {
        records.push({ type: "fixture.unparsed", value: line, __line: line });
      }
    }
    notify();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
    notify();
  });
  child.on("close", (code, signal) => {
    closeResult = { code, signal };
    resolveClose(closeResult);
    notify();
  });

  async function waitForRecord(predicate, timeoutMs = deadlineMs) {
    const existing = records.find(predicate);
    if (existing) return existing;
    return await new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        waiters.delete(check);
        reject(new Error(`fixture record timed out; exit=${child.exitCode}`));
      }, timeoutMs);
      const check = () => {
        if (settled) return;
        const record = records.find(predicate);
        if (record) {
          settled = true;
          clearTimeout(timer);
          waiters.delete(check);
          resolve(record);
        } else if (closeResult) {
          settled = true;
          clearTimeout(timer);
          waiters.delete(check);
          reject(
            new Error(`fixture closed before record; exit=${closeResult.code}`),
          );
        }
      };
      waiters.add(check);
      check();
    });
  }

  async function waitForExit(timeoutMs = deadlineMs) {
    if (closeResult) return closeResult;
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () =>
          reject(new Error(`fixture exit timed out; exit=${child.exitCode}`)),
        timeoutMs,
      );
      closePromise.then((result) => {
        clearTimeout(timer);
        resolve(result);
      });
    });
  }

  return {
    child,
    records,
    output: () => `${stdout}\n${stderr}`,
    waitForRecord,
    waitForExit,
  };
}

async function canConnect(address, port) {
  await new Promise((resolve, reject) => {
    const socket = net.connect({ host: address, port });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("loopback connection timed out"));
    }, 1_000);
    socket.once("connect", () => {
      clearTimeout(timer);
      socket.destroy();
      resolve();
    });
    socket.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function writePrivateFile(filePath, content) {
  writeFileSync(filePath, content, { encoding: "utf8", mode: 0o600 });
}

function createRuntimeRoots() {
  const packageRoot = mkdtempSync(path.join(os.tmpdir(), "runtime-package-"));
  const hostileCwd = mkdtempSync(path.join(os.tmpdir(), "runtime-cwd-"));
  chmodSync(packageRoot, 0o700);
  chmodSync(hostileCwd, 0o700);
  writePrivateFile(
    path.join(packageRoot, ".env"),
    "PORT=0\nCORS_ORIGIN=http://localhost:3002\n",
  );
  writePrivateFile(
    path.join(packageRoot, ".env.local"),
    "APP_HOST=127.0.0.1\n",
  );
  writePrivateFile(
    path.join(hostileCwd, ".env"),
    "PORT=not-a-port-caller-canary\nCALLER_SECRET=caller-secret-canary\n",
  );
  return { packageRoot, hostileCwd };
}

function assertSecretSafeOutput(fixture, roots) {
  const output = fixture.output();
  for (const forbidden of [
    "caller-secret-canary",
    "not-a-port-caller-canary",
    "ignored-app-port-canary",
    roots.packageRoot,
    roots.hostileCwd,
    repositoryRoot,
  ]) {
    assert.equal(
      output.includes(forbidden),
      false,
      `output leaked ${forbidden}`,
    );
  }
}

function cleanupFixture(fixture, roots) {
  if (fixture?.child.exitCode === null) fixture.child.kill("SIGKILL");
  rmSync(roots.packageRoot, { recursive: true, force: true });
  rmSync(roots.hostileCwd, { recursive: true, force: true });
}

test("PORT=0 emits one secret-safe actual readiness record from a hostile cwd", async () => {
  const roots = createRuntimeRoots();
  const fixture = startFixture({ ...roots });
  try {
    const ready = await fixture.waitForRecord(
      (record) => record.type === "context-router.backend.ready",
    );
    assert.deepEqual(
      Object.keys(ready).filter((key) => key !== "__line"),
      ["type", "version", "address", "port"],
    );
    assert.equal(ready.version, 1);
    assert.equal(ready.address, "127.0.0.1");
    assert.ok(Number.isInteger(ready.port) && ready.port > 0);
    await canConnect(ready.address, ready.port);

    fixture.child.kill("SIGTERM");
    assert.deepEqual(await fixture.waitForExit(), { code: 143, signal: null });
    assert.equal(
      fixture.records.filter((record) => record.type === "fixture.close")
        .length,
      1,
    );
    assertSecretSafeOutput(fixture, roots);
  } finally {
    cleanupFixture(fixture, roots);
  }
});

for (const [signal, code] of [
  ["SIGINT", 130],
  ["SIGTERM", 143],
]) {
  test(`ready ${signal} closes once and exits ${code}`, async () => {
    const roots = createRuntimeRoots();
    const fixture = startFixture({ ...roots });
    try {
      await fixture.waitForRecord(
        (record) => record.type === "context-router.backend.ready",
      );
      fixture.child.kill(signal);
      assert.deepEqual(await fixture.waitForExit(), { code, signal: null });
      assert.equal(
        fixture.records.filter((record) => record.type === "fixture.close")
          .length,
        1,
      );
    } finally {
      cleanupFixture(fixture, roots);
    }
  });

  test(`during-listen ${signal} suppresses readiness and exits ${code}`, async () => {
    const roots = createRuntimeRoots();
    const fixture = startFixture({ ...roots, mode: "during-start" });
    try {
      await fixture.waitForRecord(
        (record) => record.type === "fixture.listening",
      );
      fixture.child.kill(signal);
      assert.deepEqual(await fixture.waitForExit(), { code, signal: null });
      assert.equal(
        fixture.records.filter(
          (record) => record.type === "context-router.backend.ready",
        ).length,
        0,
      );
      assert.equal(
        fixture.records.filter((record) => record.type === "fixture.close")
          .length,
        1,
      );
    } finally {
      cleanupFixture(fixture, roots);
    }
  });
}

test("a signal before create resolves terminates within the shutdown deadline", async () => {
  const roots = createRuntimeRoots();
  const fixture = startFixture({ ...roots, mode: "stuck-create" });
  try {
    await fixture.waitForRecord((record) => record.type === "fixture.creating");
    const startedAt = Date.now();
    fixture.child.kill("SIGTERM");
    assert.deepEqual(await fixture.waitForExit(), { code: 143, signal: null });
    assert.ok(Date.now() - startedAt < 1_500);
    assert.equal(
      fixture.records.filter(
        (record) => record.type === "context-router.backend.ready",
      ).length,
      0,
    );
  } finally {
    cleanupFixture(fixture, roots);
  }
});

test("mixed repeated signals share one bounded stuck-close path", async () => {
  const roots = createRuntimeRoots();
  const fixture = startFixture({ ...roots, mode: "stuck-close" });
  try {
    await fixture.waitForRecord(
      (record) => record.type === "context-router.backend.ready",
    );
    const startedAt = Date.now();
    fixture.child.kill("SIGTERM");
    await fixture.waitForRecord((record) => record.type === "fixture.close");
    fixture.child.kill("SIGINT");
    assert.deepEqual(await fixture.waitForExit(), { code: 143, signal: null });
    assert.ok(Date.now() - startedAt < 1_500);
    assert.equal(
      fixture.records.filter((record) => record.type === "fixture.close")
        .length,
      1,
    );
  } finally {
    cleanupFixture(fixture, roots);
  }
});

test("invalid PORT fails before application creation without leaking the raw value", async () => {
  const roots = createRuntimeRoots();
  const rawPort = "invalid-port-secret-canary";
  const fixture = startFixture({
    ...roots,
    environment: { PORT: rawPort, APP_HOST: "127.0.0.1" },
  });
  try {
    const failure = await fixture.waitForRecord(
      (record) => record.type === "fixture.failure",
    );
    assert.equal(failure.created, 0);
    assert.equal(failure.closed, 0);
    assert.deepEqual(await fixture.waitForExit(), { code: 1, signal: null });
    assert.equal(fixture.output().includes(rawPort), false);
    assert.equal(
      fixture.records.filter(
        (record) => record.type === "context-router.backend.ready",
      ).length,
      0,
    );
  } finally {
    cleanupFixture(fixture, roots);
  }
});

test("an occupied port closes the partial app and leaves the blocker usable", async () => {
  const blocker = net.createServer();
  await new Promise((resolve) => blocker.listen(0, "127.0.0.1", resolve));
  const blockerAddress = blocker.address();
  assert.ok(blockerAddress && typeof blockerAddress !== "string");
  const roots = createRuntimeRoots();
  const fixture = startFixture({
    ...roots,
    environment: {
      PORT: String(blockerAddress.port),
      APP_HOST: "127.0.0.1",
    },
  });
  try {
    const failure = await fixture.waitForRecord(
      (record) => record.type === "fixture.failure",
    );
    assert.equal(failure.created, 1);
    assert.equal(failure.closed, 1);
    assert.deepEqual(await fixture.waitForExit(), { code: 1, signal: null });
    await canConnect("127.0.0.1", blockerAddress.port);
    assert.equal(
      fixture.records.filter(
        (record) => record.type === "context-router.backend.ready",
      ).length,
      0,
    );
  } finally {
    await new Promise((resolve) => blocker.close(resolve));
    cleanupFixture(fixture, roots);
  }
});

test("a post-bind readiness failure releases the acquired listener", async () => {
  const roots = createRuntimeRoots();
  const fixture = startFixture({ ...roots, mode: "invalid-readiness" });
  try {
    const listening = await fixture.waitForRecord(
      (record) => record.type === "fixture.listening",
    );
    const failure = await fixture.waitForRecord(
      (record) => record.type === "fixture.failure",
    );
    assert.equal(failure.created, 1);
    assert.equal(failure.closed, 1);
    assert.deepEqual(await fixture.waitForExit(), { code: 1, signal: null });
    await assert.rejects(canConnect(listening.address, listening.port));
    assert.equal(
      fixture.records.filter(
        (record) => record.type === "context-router.backend.ready",
      ).length,
      0,
    );
  } finally {
    cleanupFixture(fixture, roots);
  }
});

test("startup failure plus stuck cleanup rejects within the shutdown deadline", async () => {
  const roots = createRuntimeRoots();
  const fixture = startFixture({
    ...roots,
    mode: "invalid-readiness-stuck-close",
  });
  try {
    await fixture.waitForRecord((record) => record.type === "fixture.listening");
    const startedAt = Date.now();
    const failure = await fixture.waitForRecord(
      (record) => record.type === "fixture.failure",
    );
    assert.equal(failure.created, 1);
    assert.equal(failure.closed, 1);
    assert.deepEqual(await fixture.waitForExit(), { code: 1, signal: null });
    assert.ok(Date.now() - startedAt < 1_500);
  } finally {
    cleanupFixture(fixture, roots);
  }
});
