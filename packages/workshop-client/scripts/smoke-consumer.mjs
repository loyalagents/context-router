import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(packageDir, "..", "..");
const tarballPath = findLatestTarball(path.join(repoRoot, "dist", "workshop-client"));
const tempDir = mkdtempSync(path.join(tmpdir(), "workshop-client-consumer-"));
const storeDir = path.join(tempDir, "pnpm-store");

async function main() {
  writePackageJson();
  writeConsumerScript();

  run("pnpm", ["add", "--store-dir", storeDir, tarballPath], tempDir);
  run(process.execPath, ["consumer-smoke.mjs"], tempDir, process.env);

  console.log(
    JSON.stringify(
      {
        tarballPath,
        tempDir,
      },
      null,
      2,
    ),
  );
}

function writePackageJson() {
  writeFileSync(
    path.join(tempDir, "package.json"),
    JSON.stringify(
      {
        name: "workshop-client-consumer-smoke",
        private: true,
        type: "module",
      },
      null,
      2,
    ),
  );
}

function writeConsumerScript() {
  writeFileSync(
    path.join(tempDir, "consumer-smoke.mjs"),
    `import { createWorkshopClient } from "@loyalagents/context-router-workshop-client";

const baseUrl = requireEnv("WORKSHOP_CLIENT_SMOKE_BASE_URL");
const apiKey = requireEnv("WORKSHOP_CLIENT_SMOKE_API_KEY");
const explicitUserId = process.env.WORKSHOP_CLIENT_SMOKE_USER_ID;

const base = createWorkshopClient({ baseUrl, apiKey });
const users = await base.users();
if (users.length === 0) {
  throw new Error("Consumer smoke failed: users() returned no users");
}

const userId = explicitUserId ?? users[0]?.userId;
if (!userId) {
  throw new Error("Consumer smoke failed: could not choose a user");
}

const client = base.withUser(userId);
const catalog = await client.catalog();
const chosen = [...catalog]
  .sort((left, right) => left.slug.localeCompare(right.slug))
  .find(
    (entry) =>
      entry.valueType !== "ENUM" ||
      (Array.isArray(entry.options) && entry.options.length > 0),
  );

if (!chosen) {
  throw new Error("Consumer smoke failed: no writable catalog entry found");
}

const me = await client.me();
const preference = await client.setPreference({
  slug: chosen.slug,
  value:
    chosen.valueType === "BOOLEAN"
      ? true
      : chosen.valueType === "ARRAY"
        ? ["workshop-consumer-smoke"]
        : chosen.valueType === "ENUM"
          ? chosen.options[0]
          : "workshop-consumer-smoke",
});

console.log(
  JSON.stringify(
    {
      installedUserCount: users.length,
      selectedUserId: userId,
      me,
      chosenSlug: chosen.slug,
      preferenceId: preference.id,
    },
    null,
    2,
  ),
);

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(\`\${name} is required\`);
  }
  return value;
}
`,
  );
}

function findLatestTarball(tarballDir) {
  if (!existsSync(tarballDir)) {
    throw new Error(`Tarball directory not found: ${tarballDir}`);
  }

  const tarballs = readdirSync(tarballDir)
    .filter((entry) => entry.endsWith(".tgz"))
    .sort((left, right) => right.localeCompare(left));
  const tarball = tarballs[0];

  if (!tarball) {
    throw new Error(
      `No workshop-client tarball found in ${tarballDir}. Run pnpm pack:workshop-client first.`,
    );
  }

  return path.join(tarballDir, tarball);
}

function run(command, args, cwd, env = process.env) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: "utf8",
    stdio: "inherit",
  });

  if (result.status !== 0) {
    throw new Error(
      `Command failed (${command} ${args.join(" ")}) in ${cwd} with exit code ${result.status}`,
    );
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
