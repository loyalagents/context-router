/** Explicit source command. It never reads installed application configuration. */
import { createInterface } from "node:readline/promises";
import * as path from "node:path";
import {
  initializeSource,
  serveSource,
  SourceRefusal,
} from "./infrastructure/hcp-experiment/source";

class UsageError extends Error {}
const USAGE =
  "Usage: hcp-source initialize --sandbox <absolute-private-empty-directory> --port <1024-65535> [--profile claude-code --callback-port <1024-65535>] | serve --sandbox <absolute-directory> | open --sandbox <absolute-directory> [--headless true]";
function reportFailure(error: unknown) {
  // Refusal never prints private values, fixture contents from errors, or child diagnostics.
  process.stderr.write(
    (error instanceof UsageError
      ? USAGE
      : error instanceof SourceRefusal
        ? error.message
        : error &&
            typeof error === "object" &&
            "code" in error &&
            error.code === "EADDRINUSE"
          ? "The configured source port is busy. No alternate origin was selected."
          : "HCP source command refused. Preserve the sandbox; consult docs/useful/HCP_SOURCE.md.") +
      "\n",
  );
  process.exitCode = 1;
}

async function main() {
  process.umask(0o077);
  const [command, ...args] = process.argv.slice(2),
    values: Record<string, string> = {};
  if (!["initialize", "serve", "open"].includes(command) || args.length % 2)
    throw new UsageError();
  for (let i = 0; i < args.length; i += 2) {
    if (
      ![
        "--sandbox",
        ...(command === "initialize"
          ? ["--port", "--profile", "--callback-port"]
          : []),
        ...(command === "open" ? ["--headless"] : []),
      ].includes(args[i]) ||
      values[args[i]] !== undefined
    )
      throw new UsageError();
    values[args[i]] = args[i + 1];
  }
  if (!values["--sandbox"]) throw new UsageError();
  if (
    command === "initialize" &&
    (!/^\d+$/.test(values["--port"] ?? "") ||
      !Number.isSafeInteger(Number(values["--port"])) ||
      Number(values["--port"]) < 1024 ||
      Number(values["--port"]) > 65535)
  )
    throw new UsageError();
  if (values["--headless"] !== undefined && values["--headless"] !== "true")
    throw new UsageError();
  if (
    (values["--profile"] !== undefined ||
      values["--callback-port"] !== undefined) &&
    (values["--profile"] !== "claude-code" ||
      !/^\d+$/.test(values["--callback-port"] ?? "") ||
      Number(values["--callback-port"]) < 1024 ||
      Number(values["--callback-port"]) > 65535 ||
      Number(values["--callback-port"]) === Number(values["--port"]))
  )
    throw new UsageError();
  if (command === "initialize") {
    const result = await initializeSource(
      values["--sandbox"],
      Number(values["--port"]),
      async (review) => {
        process.stdout.write(
          `${review.notice}\n${JSON.stringify(review.fixtures, null, 2)}\nActing as the Synthetic context subject, review this exact bundle. Type approve ${review.digest} to approve within five minutes, or anything else to cancel.\n`,
        );
        const input = createInterface({
          input: process.stdin,
          output: process.stdout,
        });
        const deadline = setTimeout(() => input.close(), 300_000);
        try {
          process.stdout.write("> ");
          for await (const line of input) return line;
          return "";
        } finally {
          clearTimeout(deadline);
          input.close();
        }
      },
      values["--profile"]
        ? {
            profile: "claude-code",
            callbackPort: Number(values["--callback-port"]),
          }
        : {},
    );
    process.stdout.write(
      `Initialized ${result.issuer}\nHuman credential file: ${result.credentialFile}\n`,
    );
  } else if (command === "serve") {
    const server = await serveSource(values["--sandbox"]);
    let closing = false;
    const close = () => {
      if (closing) return;
      closing = true;
      void server.close().catch(reportFailure);
    };
    process.on("SIGINT", close);
    process.on("SIGTERM", close);
    process.stdout.write(
      `Serving ${server.issuer}/manage/entries\nStop with Ctrl-C. Browser close does not stop this provider.\n`,
    );
  } else {
    // Node 24 can load this existing workspace ESM helper; it boots no Next app.
    const { openSourceBrowser } = require(
      path.resolve(__dirname, "../../web/hcp-source-browser.mjs"),
    );
    let browser: Awaited<ReturnType<typeof openSourceBrowser>> | undefined,
      stopRequested = false,
      closing = false;
    const close = () => {
      stopRequested = true;
      if (!browser || closing) return;
      closing = true;
      void browser.close().catch(reportFailure);
    };
    // Keep repeated signals from abandoning a pending launch or its close proof.
    // A rejected launch still follows the helper's conservative refusal path.
    process.on("SIGINT", close);
    process.on("SIGTERM", close);
    browser = await openSourceBrowser(values["--sandbox"], {
      headless: values["--headless"] === "true",
    });
    browser.context.once("close", close);
    if (stopRequested) {
      close();
      return;
    }
    process.stdout.write(
      "Owned synthetic browser opened with a fresh entry-list GET. Close it or press Ctrl-C; the provider has its own lifetime.\n",
    );
  }
}
if (require.main === module) main().catch(reportFailure);
