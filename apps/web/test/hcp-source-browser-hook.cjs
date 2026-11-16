// Test-only preload for the real source CLI. No production fault injection.
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const launch = chromium.launchPersistentContext.bind(chromium);
const mode = process.env.HCP_SOURCE_BROWSER_TEST;
const send = (message) => process.send?.(message);
let context,
  browserPid,
  holdProbe = false,
  launches = 0;
const kill = process.kill.bind(process);
process.kill = (pid, signal) => {
  if (holdProbe && pid === browserPid) {
    if (signal !== 0) throw new Error("Test forbids signalling a recorded PID");
    return true; // A still-live or reused PID must never count as stopped.
  }
  return kill(pid, signal);
};
const lstat = fs.lstatSync;
fs.lstatSync = (file, ...args) => {
  if (String(file).endsWith("/Default/ServerCertificate"))
    send({ trustAccess: true });
  return lstat(file, ...args);
};
chromium.launchPersistentContext = async (...args) => {
  launches += 1;
  send({ launch: true });
  if (mode?.startsWith("signal-start:") && launches === 1) {
    const signal = mode.split(":")[1];
    // Two signals while the first real launch is still pending: a once handler
    // would let the second signal restore Node's default termination behavior.
    for (const ms of [0, 10])
      setTimeout(() => {
        send({ startupSignal: signal });
        kill(process.pid, signal);
      }, ms);
  }
  if (mode === "reject-launch")
    throw new Error("Synthetic launch rejected before returning a context");
  context = await launch(...args);
  browserPid = Number(
    fs.readlinkSync(path.join(args[0], "SingletonLock")).split("-").at(-1),
  );
  send({ browserPid });
  return context;
};
process.on("message", async (message) => {
  if (!message.closeBrowser) return;
  try {
    const session = await context.newCDPSession(context.pages()[0]);
    holdProbe = mode === "hold-exit-probe";
    send({ closingBrowser: true });
    await session.send("Browser.close");
  } catch {
    // Browser.close can disconnect CDP before its command reply arrives.
  }
});
process.channel?.unref();
