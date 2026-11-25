// Explicit human-operated trial, only after the brief's reviewed live approval.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";
import {
  verifyHost,
  verifyUnmanagedHost,
  hostInvocation,
  runOwnedHost,
  checkRetainedHostFiles,
} from "./host-boundary.mjs";
import { TRIAL_PROMPTS, assertNoSecrets } from "./trial-protocol.mjs";
import { openAuthorization, sourceJson } from "./authorize-host.mjs";
import { startModelRelay } from "./model-relay.mjs";
import { observeMcp, createTrialEvidence } from "./mcp-observer.mjs";
const require = createRequire(import.meta.url);
const {
  readSource,
  serveSource,
} = require("../../apps/backend/dist/infrastructure/hcp-experiment/source.js");
const { openSourceBrowser } = require("../../apps/web/hcp-source-browser.mjs");

export function bindTerminalStop(input, stop) {
  input.on("SIGINT", stop);
  input.once("close", stop);
}
export async function* stopOnPromptFailure(prompts, stop) {
  try {
    yield* prompts;
  } catch (error) {
    stop();
    throw error;
  }
}
export async function startHumanAuthorization({
  source,
  sandbox,
  abort,
  serve = serveSource,
  authorize = openAuthorization,
  browse = openSourceBrowser,
}) {
  const { signal } = abort;
  let provider, flow, browser;
  const stopFlow = () => {
    void flow?.close().catch(() => {});
  };
  try {
    signal.throwIfAborted();
    provider = await serve(sandbox);
    signal.throwIfAborted();
    flow = await authorize(source);
    signal.throwIfAborted();
    signal.addEventListener("abort", stopFlow, { once: true });
    browser = await browse(sandbox);
    signal.throwIfAborted();
    browser.context.once("close", () => abort.abort());
    await browser.page.goto(flow.url);
    signal.throwIfAborted();
    const auth = await flow.wait;
    signal.throwIfAborted();
    await flow.close();
    signal.throwIfAborted();
    return { provider, browser, auth };
  } catch (error) {
    const closed = await Promise.allSettled([
      flow?.close(),
      browser?.close(),
      provider?.close(),
    ]);
    if (closed.some((result) => result.status === "rejected"))
      throw new Error("Owned startup cleanup unconfirmed");
    throw error;
  } finally {
    signal.removeEventListener("abort", stopFlow);
  }
}

async function readSubscription() {
  if (!fs.fstatSync(3).isFIFO())
    throw new Error(
      "Supply the new subscription token through private pipe FD3",
    );
  const input = fs.createReadStream(null, { fd: 3, autoClose: true });
  const timer = setTimeout(
    () => input.destroy(new Error("Credential input expired")),
    30_000,
  );
  let token = "";
  try {
    for await (const chunk of input) {
      token += chunk;
      if (token.length > 8192) throw new Error("Credential input refused");
    }
    token = token.trim();
    if (!/^sk-ant-oat01-[A-Za-z0-9_-]+$/.test(token))
      throw new Error("Subscription token format refused");
    return token;
  } finally {
    clearTimeout(timer);
    input.destroy();
  }
}
async function main() {
  process.umask(0o077);
  if (!process.stdin.isTTY) {
    process.stderr.write(
      "C7b input refused: standard input is not a terminal. Use FD3 process substitution for the token; keep terminal input attached.\n",
    );
    throw new Error("Explicit private-terminal invocation required");
  }
  const [live, sandboxFlag, sandbox, hostFlag, binary, ...extra] =
    process.argv.slice(2);
  if (
    live !== "--live" ||
    sandboxFlag !== "--sandbox" ||
    hostFlag !== "--host" ||
    extra.length ||
    !path.isAbsolute(sandbox)
  )
    throw new Error("Explicit private-terminal invocation required");
  verifyHost(binary);
  const source = readSource(sandbox);
  if (
    source.descriptor.profile?.profile !== "claude-code" ||
    source.descriptor.configuration.issuer !== "https://localhost:19443" ||
    source.descriptor.configuration.clients[0].redirectUri !==
      "https://127.0.0.1:19444/callback"
  )
    throw new Error("Live packet identity does not match");
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "hcp-c7b-live-host-")),
  );
  for (const dir of ["profile", "cwd", "tmp"])
    fs.mkdirSync(path.join(root, dir));
  verifyUnmanagedHost(path.join(root, "cwd"));
  const subscription = await readSubscription();
  const localToken = "sk-ant-oat01-" + randomBytes(32).toString("base64url");
  const abort = new AbortController();
  let provider, browser, relay, host, auth, observer;
  const stop = () => {
    relay?.cancel(); // Latch upstream dispatch before the host's termination grace.
    abort.abort();
  };
  abort.signal.addEventListener("abort", () => relay?.cancel(), { once: true });
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  const input = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  bindTerminalStop(input, stop);
  let secrets = [subscription, localToken, source.humanCredential];
  const queue = [];
  let waiting;
  const nextResult = () =>
    queue.length
      ? Promise.resolve(queue.shift())
      : new Promise((resolve, reject) => {
          if (abort.signal.aborted) return reject(new Error("Trial stopped"));
          waiting = resolve;
          abort.signal.addEventListener(
            "abort",
            () => reject(new Error("Trial stopped")),
            { once: true },
          );
        });
  const onResult = (event) => {
    assertNoSecrets(event, secrets);
    if (waiting) {
      const resolve = waiting;
      waiting = undefined;
      resolve(event);
    } else queue.push(event);
  };
  const report = async () => {
    const event = await nextResult();
    if (event.is_error) throw new Error("Host result failed");
    process.stdout.write(
      String(event.result ?? "").replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "") +
        "\n",
    );
  };
  const confirm = async (word) => {
    if (
      (await input.question(
        `Type ${word} to continue, or anything else to stop: `,
        { signal: abort.signal },
      )) !== word
    )
      throw new Error("Human stopped");
  };
  try {
    process.stdout.write(
      `Host receipts will stay in ${root}.\nIn the owned browser, authenticate as the synthetic subject and choose 900 seconds, read only, general_preferences, synthetic-review purpose. Do not elect persistence.\n`,
    );
    ({ provider, browser, auth } = await startHumanAuthorization({
      source,
      sandbox,
      abort,
    }));
    abort.signal.throwIfAborted();
    secrets = [...secrets, ...auth.secrets];
    const evidence = createTrialEvidence(() => {
      stop();
      process.stderr.write(
        "C7b stopped: MCP result or reference checks failed; no retry attempted.\n",
      );
    });
    observer = observeMcp(provider.issuer, evidence.accept);
    relay = await startModelRelay({
      subscription,
      localToken,
      secrets,
      onStop: stop,
    });
    abort.signal.throwIfAborted();
    async function* prompts() {
      yield TRIAL_PROMPTS[0];
      await report();
      evidence.assertStage();
      await confirm("scope");
      evidence.advance();
      yield TRIAL_PROMPTS[1];
      await report();
      evidence.assertStage();
      await browser.page.goto(provider.issuer + "/manage/grants");
      process.stdout.write("Revoke this trial grant in the owned browser.\n");
      await confirm("revoked");
      const grants = await sourceJson(source, "/v2/grants?status=all", {
        token: source.humanCredential,
      });
      if (
        !grants.grants.some(
          (g) => g.grantId === auth.grantId && g.status === "revoked",
        )
      )
        throw new Error("Explicit revocation not observed");
      evidence.advance();
      yield TRIAL_PROMPTS[2];
    }
    host = await runOwnedHost(
      hostInvocation({
        binary,
        root,
        providerRoot: sandbox,
        issuer: provider.issuer,
        modelPort: Number(new URL(relay.origin).port),
        subscription: localToken,
        hcpToken: auth.token,
        streaming: true,
      }),
      {
        signal: abort.signal,
        timeoutMs: 900_000,
        prompts: stopOnPromptFailure(prompts(), stop),
        onResult,
      },
    );
    assertNoSecrets([host.output, host.errors, relay.receipt], secrets);
    checkRetainedHostFiles(root, secrets);
    fs.writeFileSync(
      path.join(root, "receipt.json"),
      JSON.stringify(
        { sandbox, binary, host, relay: relay.receipt, wire: observer.events },
        null,
        2,
      ),
      { flag: "wx", mode: 0o600 },
    );
    if (
      host.exit[0] !== 0 ||
      relay.receipt.latched ||
      queue.length !== 1 ||
      evidence.count !== 4 ||
      evidence.failed ||
      abort.signal.aborted
    )
      throw new Error("Trial incomplete");
    await report();
    process.stdout.write(
      `Trial stopped. Inspect ${root}/receipt.json and the retained provider audit before making any success claim.\n`,
    );
  } finally {
    stop();
    input.close();
    const closed = await Promise.allSettled([
      relay?.close(),
      browser?.close(),
      provider?.close(),
    ]);
    observer?.close();
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
    if (closed.some((result) => result.status === "rejected"))
      throw new Error("Owned cleanup unconfirmed");
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch(() => {
    process.stderr.write(
      "C7b trial refused or incomplete. Preserve its provider and host roots; no recovery or replay was attempted.\n",
    );
    process.exitCode = 1;
  });
