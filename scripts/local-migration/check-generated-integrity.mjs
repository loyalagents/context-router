#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertCallerIntegrity,
  captureCallerIntegrity,
  runCommand,
} from "./gate-runner.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "../..");
const diagnosticsDirectory =
  process.env.MIGRATION_GATE_DIAGNOSTICS_DIR ?? scriptDirectory;
const schemaPath = path.join(repositoryRoot, "apps/backend/src/schema.gql");
const generatedPaths = [
  path.join(repositoryRoot, "apps/backend/src/generated/prisma"),
  path.join(repositoryRoot, "apps/web/lib/generated"),
];

async function sha256(filePath) {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

async function main() {
  const expectedSchemaHash = process.env.MIGRATION_GATE_TRACKED_SDL_SHA256;
  if (!expectedSchemaHash || !/^[a-f0-9]{64}$/.test(expectedSchemaHash)) {
    throw new Error("MIGRATION_GATE_TRACKED_SDL_SHA256 is missing or invalid");
  }
  if ((await sha256(schemaPath)) !== expectedSchemaHash) {
    throw new Error("tracked GraphQL SDL changed before determinism verification");
  }
  const generatedBefore = await captureCallerIntegrity(generatedPaths);
  await runCommand(["pnpm", "--filter", "backend", "prisma:generate"], {
    cwd: repositoryRoot,
    env: process.env,
    timeoutMs: 180_000,
    logPath: path.join(diagnosticsDirectory, "integrity-prisma-regenerate.log"),
  });
  await runCommand(["pnpm", "--filter", "web", "codegen"], {
    cwd: repositoryRoot,
    env: process.env,
    timeoutMs: 180_000,
    logPath: path.join(diagnosticsDirectory, "integrity-web-regenerate.log"),
  });
  await assertCallerIntegrity(generatedBefore);
  if ((await sha256(schemaPath)) !== expectedSchemaHash) {
    throw new Error("tracked GraphQL SDL changed during repeated generation");
  }
  await runCommand(["git", "diff", "--check"], {
    cwd: repositoryRoot,
    timeoutMs: 30_000,
    logPath: path.join(diagnosticsDirectory, "integrity-worktree-whitespace.log"),
  });
  await runCommand(["git", "diff", "--cached", "--check"], {
    cwd: repositoryRoot,
    timeoutMs: 30_000,
    logPath: path.join(diagnosticsDirectory, "integrity-index-whitespace.log"),
  });
  console.log("generated-integrity: ok; tracked SDL stable and ignored clients deterministic");
}

try {
  await main();
} catch (error) {
  console.error(`generated-integrity: ${error.message}`);
  process.exitCode = 1;
}
