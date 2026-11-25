// Target-Mac C7b process boundary. No login, credential discovery or live endpoint.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";

export const HOST_SHA256 =
  "ba5ab7b8c195fa03ab8d5bf3915c76153b576a2c40e79a5c46e265e7ed9744b3";
export const TOOLS = ["mcp__c7b__hcp_queryContext", "mcp__c7b__hcp_getEntry"];
export function checkRetainedHostFiles(root, secrets) {
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile() && fs.statSync(file).size <= 2 ** 22) {
        const bytes = fs.readFileSync(file);
        if (secrets.some((value) => value && bytes.includes(value)))
          throw new Error("Credential in retained host file");
      } else throw new Error("Uninspectable retained host file");
    }
  };
  for (const name of ["profile", "cwd", "tmp"]) visit(path.join(root, name));
}
export function verifyHost(binary) {
  if (
    process.platform !== "darwin" ||
    !path.isAbsolute(binary) ||
    createHash("sha256").update(fs.readFileSync(binary)).digest("hex") !==
      HOST_SHA256
  )
    throw new Error(
      "C7b requires the pinned Mac Claude Code 2.1.299 executable",
    );
}
export function verifyUnmanagedHost(root) {
  const refuse = () => {
    throw new Error(
      "C7b cannot establish an unmanaged empty host context; no policy override attempted",
    );
  };
  const absent = (file) => {
    try {
      fs.lstatSync(file);
      refuse();
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
  };
  for (const name of [
    "managed-settings.json",
    "managed-settings.d",
    "managed-mcp.json",
    "CLAUDE.md",
  ])
    absent(path.join("/Library/Application Support/ClaudeCode", name));
  // Query the effective domain before confinement; a denied lookup is not absence.
  const managed = spawnSync(
    "/usr/bin/defaults",
    ["read", "com.anthropic.claudecode"],
    {
      encoding: "utf8",
      timeout: 5000,
      maxBuffer: 65536,
      env: { PATH: "/usr/bin:/bin", LANG: "en_US.UTF-8" },
    },
  );
  if (
    managed.error ||
    managed.status !== 1 ||
    managed.stdout !== "" ||
    !/Domain com\.anthropic\.claudecode does not exist/.test(managed.stderr)
  )
    refuse();
  for (let dir = root; ; dir = path.dirname(dir)) {
    absent(path.join(dir, "CLAUDE.md"));
    absent(path.join(dir, ".claude"));
    if (dir === path.dirname(dir)) break;
  }
}
export function sandboxPolicy({
  binary,
  ports,
  protectedRoot,
  caFile,
  subscriptionSetup = false,
}) {
  if (!ports.every((p) => Number.isInteger(p) && p > 1023 && p <= 65535))
    throw new Error("Invalid local ports");
  const quote = JSON.stringify;
  return `(version 1)
(allow default)
(deny network*)
${subscriptionSetup ? '(allow network-outbound (remote tcp "*:443"))\n(allow network-outbound (literal "/private/var/run/mDNSResponder"))' : ports.length ? `(allow network-outbound ${ports.map((p) => `(remote tcp "localhost:${p}")`).join(" ")})` : ""}
${subscriptionSetup ? '(allow network-inbound (local tcp4 "localhost:*"))\n' : ""}(deny process-exec)
(allow process-exec (literal ${quote(binary)}))
(deny file-read* file-write* (subpath ${quote(os.homedir())}))
(allow file-read* (literal ${quote(binary)}))
(deny file-read* file-write* (subpath ${quote(protectedRoot)}))
(allow file-read* (literal ${quote(caFile)}))
(deny mach-lookup (global-name "com.apple.SecurityServer") (global-name "com.apple.securityd.xpc") (global-name "com.apple.securityd.general") (global-name "com.apple.securityd.systemkeychain"))`;
}
// Seatbelt's local "localhost" filter includes assigned interface addresses.
// This is detection, not a kernel prevention guarantee. Only the pinned setup
// command may use the exception; inspect its actual listener from the parent.
export function setupListenerSnapshot(pid, result) {
  const refuse = () => {
    throw new Error("Unexpected or uninspectable setup listener");
  };
  if (
    !Number.isInteger(pid) ||
    pid <= 0 ||
    result.error ||
    result.signal ||
    result.stderr !== ""
  )
    refuse();
  if (result.status === 1 && result.stdout === "") return false;
  if (result.status !== 0 || typeof result.stdout !== "string") refuse();
  const lines = result.stdout.trim().split("\n");
  if (
    lines[0] !== `p${pid}` ||
    lines.slice(1).some((line) => !/^(?:f\d+|n127\.0\.0\.1:\d+)$/.test(line))
  )
    refuse();
  const names = lines.filter((line) => line.startsWith("n"));
  if (names.length !== 1) refuse();
  const port = Number(names[0].slice(names[0].lastIndexOf(":") + 1));
  if (port < 1024 || port > 65535) refuse();
  return true;
}
export function inspectSetupListener(pid) {
  if (!Number.isInteger(pid) || pid <= 0)
    throw new Error("Missing setup process");
  // No helper/descendant is part of the pinned setup flow. Reject even a child
  // with no socket, so descendants cannot escape the single-process inspection.
  const children = spawnSync("/usr/bin/pgrep", ["-P", String(pid)], {
    encoding: "utf8",
    timeout: 1500,
    maxBuffer: 16384,
    env: { PATH: "/usr/bin:/bin", LANG: "en_US.UTF-8" },
  });
  if (
    children.error ||
    children.signal ||
    children.status !== 1 ||
    children.stdout !== "" ||
    children.stderr !== ""
  )
    throw new Error("Unexpected or uninspectable setup descendant");
  return setupListenerSnapshot(
    pid,
    spawnSync(
      "/usr/sbin/lsof",
      ["-nP", "-a", "-p", String(pid), "-iTCP", "-sTCP:LISTEN", "-Fn"],
      {
        encoding: "utf8",
        timeout: 1500,
        maxBuffer: 16384,
        env: { PATH: "/usr/bin:/bin", LANG: "en_US.UTF-8" },
      },
    ),
  );
}
export function watchSetupListener(
  child,
  {
    stop,
    onVerified,
    inspect = inspectSetupListener,
    intervalMs = 500,
    startupMs = 30_000,
  },
) {
  let seen = false,
    failed = false;
  const started = Date.now();
  const timer = setInterval(() => {
    try {
      const listening = inspect(child.pid);
      if (listening && !seen) {
        seen = true;
        onVerified();
      }
      if (!seen && Date.now() - started >= startupMs)
        throw new Error("Setup listener timeout");
    } catch {
      failed = true;
      clearInterval(timer);
      stop();
    }
  }, intervalMs);
  const close = () => clearInterval(timer);
  child.once("close", close);
  return {
    close,
    assertComplete() {
      if (failed || !seen) throw new Error("Setup listener not verified");
    },
  };
}
export function hostInvocation({
  binary,
  root,
  providerRoot,
  issuer,
  modelPort,
  subscription,
  hcpToken,
  trust = true,
  prompt = "Offline synthetic probe.",
  streaming = false,
}) {
  const provider = new URL(issuer);
  if (
    provider.protocol !== "https:" ||
    provider.hostname !== "localhost" ||
    provider.origin !== issuer ||
    !provider.port
  )
    throw new Error("Invalid provider identity");
  const caFile = path.join(providerRoot, "tls/ca.pem");
  const policy = sandboxPolicy({
    binary,
    ports: [modelPort, Number(provider.port)],
    protectedRoot: providerRoot,
    caFile,
  });
  return {
    args: [
      "-p",
      policy,
      binary,
      "--restricted",
      "--tools",
      "",
      "--disable-slash-commands",
      "--setting-sources",
      "",
      "--strict-mcp-config",
      "--mcp-config",
      JSON.stringify({
        mcpServers: {
          c7b: {
            type: "http",
            url: issuer + "/v2/mcp",
            headers: { Authorization: "Bearer ${HCP_C7B_TOKEN}" },
          },
        },
      }),
      "--allowedTools",
      TOOLS.join(","),
      "--settings",
      '{"disableAllHooks":true,"autoMemoryEnabled":false,"enabledPlugins":{}}',
      "--system-prompt",
      "You are executing an isolated synthetic interoperability test.",
      "--no-session-persistence",
      "--model",
      "claude-sonnet-4-6",
      "--output-format",
      "stream-json",
      "--verbose",
      ...(streaming ? ["--input-format", "stream-json", "-p"] : ["-p", prompt]),
    ],
    options: {
      cwd: path.join(root, "cwd"),
      env: {
        PATH: "/usr/bin:/bin",
        TMPDIR: path.join(root, "tmp"),
        LANG: "en_US.UTF-8",
        CLAUDE_CONFIG_DIR: path.join(root, "profile"),
        ...(subscription ? { CLAUDE_CODE_OAUTH_TOKEN: subscription } : {}),
        ANTHROPIC_BASE_URL: `http://127.0.0.1:${modelPort}`,
        HCP_C7B_TOKEN: hcpToken,
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
        DISABLE_AUTOUPDATER: "1",
        DISABLE_TELEMETRY: "1",
        CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
        ENABLE_TOOL_SEARCH: "false",
        ...(trust ? { NODE_EXTRA_CA_CERTS: caFile } : {}),
        MCP_SDK_GENERATION: "v2",
        MCP_PROTOCOL_NEGOTIATION: "auto",
      },
      stdio: [streaming ? "pipe" : "ignore", "pipe", "pipe"],
      detached: true,
    },
  };
}
export function boundedChildStop(child, { signal, timeoutMs, group = false }) {
  let reaped = false,
    stopping = false,
    hard;
  const kill = (how) => {
    if (!reaped && child.pid) {
      try {
        if (group) process.kill(-child.pid, how);
        else child.kill(how);
      } catch (e) {
        if (e.code !== "ESRCH") throw e;
      }
    }
  };
  const stop = () => {
    if (reaped || stopping) return;
    stopping = true;
    kill("SIGTERM");
    hard = setTimeout(() => kill("SIGKILL"), 5000);
  };
  const timeout = setTimeout(stop, timeoutMs);
  signal?.addEventListener("abort", stop, { once: true });
  const closed = new Promise((resolve, reject) => {
    child.once("error", () =>
      reject(new Error("Owned process could not start")),
    );
    child.once("close", (code, term) => resolve([code, term]));
  }).finally(() => {
    reaped = true;
    clearTimeout(timeout);
    clearTimeout(hard);
    signal?.removeEventListener("abort", stop);
  });
  if (signal?.aborted) stop();
  return { stop, kill, closed };
}
export async function runOwnedHost(
  invocation,
  { signal, timeoutMs = 30_000, prompts, onResult = () => {} } = {},
) {
  signal?.throwIfAborted();
  verifyUnmanagedHost(invocation.options.cwd);
  signal?.throwIfAborted();
  let output = "",
    errors = "",
    limited = false,
    lines = "";
  const child = spawn(
    "/usr/bin/sandbox-exec",
    invocation.args,
    invocation.options,
  );
  const lifecycle = boundedChildStop(child, { signal, timeoutMs, group: true });
  const kill = lifecycle.kill,
    abort = lifecycle.stop;
  child.stdout.on("data", (b) => {
    if (output.length + errors.length + b.length > 2 ** 22) {
      limited = true;
      kill("SIGKILL");
      return;
    }
    output += b;
    lines += b;
    let at;
    while ((at = lines.indexOf("\n")) >= 0) {
      const line = lines.slice(0, at);
      lines = lines.slice(at + 1);
      try {
        const event = JSON.parse(line);
        if (event.type === "result") onResult(event);
      } catch {
        limited = true;
        kill("SIGKILL");
      }
    }
  });
  child.stderr.on("data", (b) => {
    if (output.length + errors.length + b.length > 2 ** 22) {
      limited = true;
      kill("SIGKILL");
    } else errors += b;
  });
  // Caller controls each user turn. Pending prompts never authorize retries.
  if (prompts)
    void (async () => {
      try {
        for await (const content of prompts) {
          if (
            signal?.aborted ||
            child.exitCode !== null ||
            child.signalCode !== null
          )
            break;
          await new Promise((resolve, reject) =>
            child.stdin.write(
              JSON.stringify({
                type: "user",
                message: { role: "user", content },
              }) + "\n",
              (e) => (e ? reject(e) : resolve()),
            ),
          );
        }
        child.stdin.end();
      } catch {
        abort();
      }
    })();
  child.stdin?.on("error", abort);
  const exit = await lifecycle.closed;
  if (limited) throw new Error("Owned host output limit exceeded");
  return { exit, output, errors };
}
