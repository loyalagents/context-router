import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as path from "node:path";

it.each([
  "source",
  "source-host",
  "host-helper",
  "mcp-observer",
  "dashboard",
  "activity",
])(
  "qualifies C6 %s in owned processes",
  async (suite) => {
    try {
      await promisify(execFile)(
        process.execPath,
        [
          "--test",
          "--test-concurrency=1",
          path.join(__dirname, `${suite}.test.cjs`),
        ],
        {
          timeout: 180_000,
          maxBuffer: 3 * 1024 * 1024,
          env: { PATH: process.env.PATH, NODE_ENV: "test" },
        },
      );
    } catch (e: any) {
      throw new Error(`C6 failed\n${e.stdout ?? ""}\n${e.stderr ?? ""}`);
    }
  },
  190_000,
);
