import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as path from "node:path";

it("qualifies compiled C3 HTTP reads and durable disclosure boundaries", async () => {
  try {
    await promisify(execFile)(
      process.execPath,
      [
        "--test",
        "--test-concurrency=1",
        path.join(__dirname, "read.test.cjs"),
        path.join(__dirname, "read-recovery.test.cjs"),
      ],
      {
        timeout: 120_000,
        maxBuffer: 2 * 1024 * 1024,
        env: { PATH: process.env.PATH, NODE_ENV: "test" },
      },
    );
  } catch (e: any) {
    throw new Error(
      `C3 qualification failed\n${e.stdout ?? ""}\n${e.stderr ?? ""}`,
    );
  }
}, 130_000);
