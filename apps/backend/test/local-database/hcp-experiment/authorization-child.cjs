const path = require("node:path");
const { spawn } = require("node:child_process");

async function childServer(paths, options) {
  let child,
    exited,
    issuer,
    counter = 0;
  const replies = new Map(),
    boundaries = [],
    waiting = [];
  function rpc(command, value) {
    const id = ++counter;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        replies.delete(id);
        reject(new Error("C2 child command timed out: " + command));
      }, 15000);
      replies.set(id, {
        resolve: (result) => {
          clearTimeout(timer);
          resolve(result);
        },
        reject: () => {
          clearTimeout(timer);
          reject(new Error("C2 child command refused: " + command));
        },
      });
      child.send({ id, command, value });
    });
  }
  async function start(extra = {}) {
    child = spawn(
      process.execPath,
      [
        "--no-global-search-paths",
        path.join(__dirname, "authorization-process.cjs"),
      ],
      {
        env: { PATH: process.env.PATH, NODE_ENV: "test" },
        stdio: ["ignore", "pipe", "pipe", "ipc"],
        serialization: "advanced",
      },
    );
    exited = new Promise((resolve) =>
      child.once("exit", () => {
        for (const r of replies.values()) r.reject();
        replies.clear();
        resolve();
      }),
    );
    child.on("message", (m) => {
      const r = replies.get(m.id);
      if (r) {
        replies.delete(m.id);
        m.ok ? r.resolve(m.result) : r.reject();
      }
    });
    // Stdout has boundary labels only; stderr is deliberately never copied into diagnostics.
    let output = "";
    child.stdout.on("data", (b) => {
      output += b;
      while (output.includes("\n")) {
        const i = output.indexOf("\n"),
          m = JSON.parse(output.slice(0, i));
        output = output.slice(i + 1);
        const next = waiting.shift();
        if (next) next(m.boundary);
        else boundaries.push(m.boundary);
      }
    });
    child.stderr.resume();
    const result = await rpc("start", {
      paths,
      options: {
        ...options,
        ...(issuer ? { reopen: true, port: Number(new URL(issuer).port) } : {}),
      },
      ...extra,
    });
    issuer = result.issuer;
  }
  async function kill() {
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGKILL");
    await exited;
  }
  function boundary() {
    if (boundaries.length) return Promise.resolve(boundaries.shift());
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("C2 child barrier timed out")),
        15000,
      );
      waiting.push((value) => {
        clearTimeout(timer);
        resolve(value);
      });
    });
  }
  try {
    await start();
  } catch (error) {
    await kill();
    throw error;
  }
  return {
    issuer,
    arm: (v) => rpc("arm", v),
    resume: () => rpc("resume"),
    clock: (v) => rpc("clock", v),
    boundary,
    kill,
    async restart(extra) {
      await kill();
      await start(extra);
    },
    async close() {
      if (child.exitCode === null && child.signalCode === null) {
        try {
          await rpc("close");
        } finally {
          await kill();
        }
      }
    },
  };
}
module.exports = { childServer };
