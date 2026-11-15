import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as path from "node:path";

it("qualifies C4 writes through actual OAuth and TLS", async () => {
  try {
    await promisify(execFile)(
      process.execPath,
      [
        "--test",
        "--test-concurrency=1",
        path.join(__dirname, "writes.test.cjs"),
      ],
      {
        timeout: 120_000,
        maxBuffer: 2 * 1024 * 1024,
        env: { PATH: process.env.PATH, NODE_ENV: "test" },
      },
    );
  } catch (e: any) {
    throw new Error(`C4 HTTPS failed\n${e.stdout ?? ""}\n${e.stderr ?? ""}`);
  }
}, 130_000);
