import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, copyFile, writeFile, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

test("actual maintenance runtime forwards rename after admission and rejects unknown operations", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cr-maintenance-forward-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await copyFile(
    new URL("../runtime/maintenance.mjs", import.meta.url),
    path.join(root, "maintenance.mjs"),
  );
  await writeFile(
    path.join(root, "managed.mjs"),
    `
export const authority={revokeManagedAdmission(){}};
export const nativeOwners={async waitForNativeOwners(){}};
export async function admit(role){if(role!=='maintenance')throw new Error();return {cap:{operation:'admin'},configuration:{databaseRoot:'synthetic-data',stateRoot:'synthetic-identity'},control:{signal:new AbortController().signal,assertActive(){},async send(type,body){if(type!=='maintenance-complete')throw new Error();},async close(){}}};}
export function backend(entry){if(entry!=='backend/dist/local-mcp.js')throw new Error();return {async runLocalMcp(args){process.stdout.write(JSON.stringify({args,data:process.env.LOCAL_DATABASE_ROOT,identity:process.env.LOCAL_IDENTITY_STATE_ROOT}));return 0;}};}
`,
  );
  const args = [
    "rename",
    "--id",
    "--" + "A".repeat(20),
    "--label",
    "My laptop",
  ];
  const run = spawnSync(
    process.execPath,
    [path.join(root, "maintenance.mjs"), "mcp", ...args],
    { env: {}, encoding: "utf8" },
  );
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(JSON.parse(run.stdout), {
    args,
    data: "synthetic-data",
    identity: "synthetic-identity",
  });
  const bad = spawnSync(
    process.execPath,
    [path.join(root, "maintenance.mjs"), "mcp", "renam"],
    { env: {}, encoding: "utf8" },
  );
  assert.equal(bad.status, 2);
  assert.equal(bad.stdout, "");
});
