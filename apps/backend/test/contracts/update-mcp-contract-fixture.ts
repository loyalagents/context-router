import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { collectMcpContractBaseline } from "./mcp-contract-collector";

async function main() {
  const output = path.resolve(__dirname, "fixtures/mcp-contract-baseline.json");
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(
    output,
    `${JSON.stringify(collectMcpContractBaseline(), null, 2)}\n`,
    "utf8",
  );
  console.log(`updated ${path.relative(process.cwd(), output)}`);
}

void main();
