import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as path from "node:path";

it("qualifies the actual compiled OAuth/HTTPS/SQLite composition", async () => {
  try {
    await promisify(execFile)(
      process.execPath,
      [
        "--test",
        "--test-concurrency=1",
        path.join(__dirname, "oauth.test.cjs"),
        path.join(__dirname, "recovery.test.cjs"),
      ],
      {
        timeout: 120_000,
        maxBuffer: 2 * 1024 * 1024,
        env: { PATH: process.env.PATH, NODE_ENV: "test" },
      },
    );
  } catch (error: any) {
    // The native suite emits assertions/statuses only; never response/credential dumps.
    throw new Error(
      `OAuth qualification failed\n${error.stdout ?? ""}\n${error.stderr ?? ""}`,
    );
  }
}, 130_000);
