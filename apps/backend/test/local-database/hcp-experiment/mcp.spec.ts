import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as path from "node:path";

it("qualifies the bounded C7 MCP binding, official peer, HTTP parity and durable release", async () => {
  try {
    await promisify(execFile)(
      process.execPath,
      [
        "--test",
        "--test-concurrency=1",
        ...[
          "query-json.test.cjs",
          "read-wire.test.cjs",
          "mcp.test.cjs",
          "mcp-parity.test.cjs",
          "mcp-release.test.cjs",
        ].map((file) => path.join(__dirname, file)),
      ],
      {
        timeout: 180_000,
        maxBuffer: 4 * 1024 * 1024,
        env: { PATH: process.env.PATH, NODE_ENV: "test" },
      },
    );
  } catch (error: any) {
    throw new Error(
      `C7 qualification failed\n${error.stdout ?? ""}\n${error.stderr ?? ""}`,
    );
  }
}, 190_000);
