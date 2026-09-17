const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");

const repositoryRoot = path.resolve(__dirname, "../../..");
process.env.TS_NODE_PROJECT = path.join(
  repositoryRoot,
  "apps/backend/tsconfig.json",
);
require(
  path.join(
    repositoryRoot,
    "apps/backend/node_modules/ts-node/register/transpile-only",
  ),
);
require(
  path.join(
    repositoryRoot,
    "apps/backend/node_modules/tsconfig-paths/register",
  ),
);

const { bootstrapHostedApplication } = require(
  path.join(repositoryRoot, "apps/backend/src/bootstrap/hosted-bootstrap.ts"),
);

const mode = process.env.RUNTIME_FIXTURE_MODE || "ready";
const packageRoot = process.env.RUNTIME_PACKAGE_ROOT;
let createCount = 0;
let closeCount = 0;
let server;
let rejectPendingListen;

function write(record) {
  fs.writeSync(1, `${JSON.stringify(record)}\n`);
}

function createApplication() {
  createCount += 1;
  if (mode === "stuck-create") {
    setInterval(() => undefined, 1_000);
    write({ type: "fixture.creating" });
    return new Promise(() => undefined);
  }

  return Promise.resolve({
    useGlobalPipes() {},
    enableCors() {},
    listen(port, host) {
      if (mode === "listen-failure-stuck-close") {
        return Promise.reject(new Error("synthetic listen failure"));
      }
      server = net.createServer();
      return new Promise((resolve, reject) => {
        rejectPendingListen = reject;
        server.once("error", reject);
        server.listen(port, host, () => {
          server.off("error", reject);
          if (mode === "during-start" || mode.startsWith("invalid-readiness")) {
            const address = server.address();
            write({
              type: "fixture.listening",
              address: address.address,
              port: address.port,
            });
          }
          if (mode === "during-start") return;
          resolve();
        });
      });
    },
    getHttpServer() {
      if (mode.startsWith("invalid-readiness")) {
        return { address: () => null };
      }
      return server;
    },
    async close() {
      closeCount += 1;
      write({ type: "fixture.close", count: closeCount });
      if (mode.includes("stuck-close")) return new Promise(() => undefined);
      if (rejectPendingListen) {
        rejectPendingListen(new Error("listen interrupted"));
        rejectPendingListen = undefined;
      }
      if (server?.listening) {
        await new Promise((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      }
    },
  });
}

bootstrapHostedApplication({
  packageRoot,
  createApplication,
  shutdownTimeoutMs: Number(process.env.RUNTIME_SHUTDOWN_TIMEOUT_MS || "250"),
  logger: { log() {}, error() {} },
}).catch(() => {
  write({ type: "fixture.failure", created: createCount, closed: closeCount });
  process.exit(1);
});
