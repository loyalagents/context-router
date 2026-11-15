// Test-only owned child. Secrets arrive over private IPC, never argv/env/stdout.
const fs = require("node:fs");
const realNow = Date.now;
let fixedTime, armed, phase, resumeRead;
Date.now = () => fixedTime ?? realNow();
const {
  AuthorizationRepository,
} = require("../../../dist/infrastructure/hcp-experiment/authority.js");
for (const name of [
  "approve",
  "revoke",
  "replacePolicy",
  "protocolUpsert",
  "protocolConsume",
  "protocolFind",
  "ownGrant",
  "releaseRead",
  "commitWrite",
]) {
  const original = AuthorizationRepository.prototype[name];
  AuthorizationRepository.prototype[name] = function (...args) {
    const previous = phase;
    phase =
      name +
      (["protocolUpsert", "protocolFind"].includes(name) ? ":" + args[0] : "");
    try {
      const result = original.apply(this, args);
      fault("after-operation");
      return result;
    } finally {
      phase = previous;
    }
  };
}
const prepareRead = AuthorizationRepository.prototype.prepareRead;
AuthorizationRepository.prototype.prepareRead = function (...args) {
  const ticket = prepareRead.apply(this, args);
  if (armed?.point === "after-preparation" && armed.action === "yield") {
    armed = undefined;
    fs.writeSync(1, JSON.stringify({ boundary: "after-preparation" }) + "\n");
    return new Promise((resolve) => {
      resumeRead = () => resolve(ticket);
    });
  }
  return ticket;
};
const commitWrite = AuthorizationRepository.prototype.commitWrite;
AuthorizationRepository.prototype.commitWrite = function (...args) {
  const ticket = commitWrite.apply(this, args);
  if (armed?.point === "after-write-preparation" && armed.action === "yield") {
    armed = undefined;
    fs.writeSync(
      1,
      JSON.stringify({ boundary: "after-write-preparation" }) + "\n",
    );
    return new Promise((resolve) => {
      resumeRead = () => resolve(ticket);
    });
  }
  return ticket;
};
const {
  createSyntheticAuthorization,
} = require("../../../dist/composition/hcp-authorization.js");
let server;
function fault(point) {
  if (
    !armed ||
    armed.point !== point ||
    (armed.operation && armed.operation !== phase)
  )
    return;
  const action = armed;
  armed = undefined;
  if (action.action === "advance") {
    fixedTime = action.now;
    return;
  }
  if (action.action === "throw")
    throw new Error("Injected C2 persistence failure");
  fs.writeSync(1, JSON.stringify({ boundary: point }) + "\n");
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
}
process.on("message", async ({ id, command, value }) => {
  try {
    let result = {};
    if (command === "start") {
      fixedTime = value.now;
      armed = value.barrier;
      server = await createSyntheticAuthorization(value.paths, {
        ...value.options,
        ...(value.options.approveFixtures
          ? {
              initialize: (bootstrap) => {
                const reviewed = bootstrap.review(
                  value.options.humanCredential,
                );
                if (
                  !reviewed.fixtures.length ||
                  !reviewed.notice.includes("synthetic")
                )
                  throw new Error("Unreviewed fixtures");
                bootstrap.approve(
                  value.options.humanCredential,
                  reviewed.reviewId,
                  reviewed.digest,
                );
              },
            }
          : {}),
        clock: Date.now,
        fault,
      });
      result = { issuer: server.issuer };
    } else if (command === "arm") armed = value;
    else if (command === "resume") {
      const resume = resumeRead;
      resumeRead = undefined;
      if (!resume) throw new Error("No paused read");
      resume();
    } else if (command === "clock") fixedTime = value;
    else if (command === "close") await server.close();
    else throw new Error("Unknown fixture command");
    process.send({ id, ok: true, result }, () => {
      if (command === "close") process.disconnect();
    });
  } catch {
    process.send({ id, ok: false });
  }
});
