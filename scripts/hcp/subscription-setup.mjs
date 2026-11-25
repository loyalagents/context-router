// Run only in the human's private terminal after explicit login authorization.
// The subscription token is intentionally never captured by this program.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  verifyHost,
  verifyUnmanagedHost,
  sandboxPolicy,
  boundedChildStop,
  watchSetupListener,
} from "./host-boundary.mjs";
async function main() {
  if (
    process.argv.length !== 3 ||
    !process.stdin.isTTY ||
    !process.stdout.isTTY
  )
    throw new Error("Private human terminal required");
  const binary = process.argv[2];
  verifyHost(binary);
  process.umask(0o077);
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "hcp-c7b-subscription-")),
  );
  for (const dir of ["profile", "cwd", "tmp", "protected"])
    fs.mkdirSync(path.join(root, dir));
  verifyUnmanagedHost(path.join(root, "cwd"));
  // Setup needs HTTPS and macOS resolver IPC, unlike the model host's policy.
  // Its native callback binds 127.0.0.1, verified offline with this hash.
  // Seatbelt cannot enforce that address: the parent also checks live listeners.
  // No external program may run; manually open the printed login URL.
  const policy = sandboxPolicy({
    binary,
    ports: [],
    protectedRoot: path.join(root, "protected"),
    caFile: path.join(root, "protected/absent-ca"),
    subscriptionSetup: true,
  });
  process.stdout.write(
    `Subscription setup uses ${root}. Wait for "Callback verified" before manually opening the printed authorization URL. The new token will appear ONLY in this private terminal; keep it out of chat and logs.\n`,
  );
  const child = spawn(
    "/usr/bin/sandbox-exec",
    ["-p", policy, binary, "setup-token"],
    {
      cwd: path.join(root, "cwd"),
      env: {
        PATH: "/usr/bin:/bin",
        LANG: "en_US.UTF-8",
        TMPDIR: path.join(root, "tmp"),
        CLAUDE_CONFIG_DIR: path.join(root, "profile"),
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
        DISABLE_TELEMETRY: "1",
        DISABLE_AUTOUPDATER: "1",
      },
      stdio: "inherit",
      detached: true,
    },
  );
  const lifecycle = boundedChildStop(child, {
    timeoutMs: 600_000,
    group: true,
  });
  const stop = lifecycle.stop;
  const listenerCheck = watchSetupListener(child, {
    stop,
    onVerified: () =>
      process.stdout.write(
        "\nCallback verified on 127.0.0.1. You may open the authorization URL now.\n",
      ),
  });
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  try {
    const [code] = await lifecycle.closed;
    if (code !== 0) throw new Error("Setup incomplete");
    listenerCheck.assertComplete();
  } finally {
    listenerCheck.close();
    // Reap any surviving owned group member even when the parent exits before
    // the bounded stop's grace timer. The wrapper never targets another group.
    if (child.pid) {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch (error) {
        if (error.code !== "ESRCH") throw error;
      }
    }
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
  }
}
main().catch(() => {
  process.stderr.write(
    "Subscription setup refused/incomplete. Preserve its private root. No alternate credential or less restricted mode was selected.\n",
  );
  process.exitCode = 1;
});
