#!/usr/bin/env node

import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);

export const EXPECTED_NODE_VERSION = "24.21.0";
export const EXPECTED_PNPM_VERSION = "10.25.0";
export const TOOLCHAIN_ERROR_MESSAGE =
  'Unsupported toolchain. Use Node.js 24.21.0 and pnpm 10.25.0; run "nvm install 24.21.0 && nvm use 24.21.0 && corepack enable && corepack prepare pnpm@10.25.0 --activate".';

export function assertSupportedToolchain({ nodeVersion, pnpmVersion }) {
  if (
    nodeVersion !== EXPECTED_NODE_VERSION ||
    pnpmVersion !== EXPECTED_PNPM_VERSION
  ) {
    throw new Error(TOOLCHAIN_ERROR_MESSAGE);
  }
}

function buildProbeEnvironment(environment) {
  const allowed = [
    "PATH",
    "Path",
    "HOME",
    "USERPROFILE",
    "LOCALAPPDATA",
    "APPDATA",
    "COREPACK_HOME",
    "XDG_CACHE_HOME",
    "TMPDIR",
    "TMP",
    "TEMP",
    "SystemRoot",
    "ComSpec",
    "PATHEXT",
    "LANG",
    "LC_ALL",
  ];
  const result = {};
  for (const name of allowed) {
    if (environment[name] !== undefined) result[name] = environment[name];
  }
  result.COREPACK_ENABLE_DOWNLOAD_PROMPT = "0";
  result.COREPACK_ENABLE_NETWORK = "0";
  return result;
}

export async function readCurrentToolchain({ run } = {}) {
  let pnpmVersion;
  try {
    const options = {
      encoding: "utf8",
      env: buildProbeEnvironment(process.env),
      maxBuffer: 16 * 1024,
      timeout: 10_000,
    };
    const result = run
      ? await run("pnpm", ["--version"], options)
      : await execFileAsync("pnpm", ["--version"], options);
    pnpmVersion = result.stdout.trim();
  } catch {
    throw new Error(TOOLCHAIN_ERROR_MESSAGE);
  }

  return {
    nodeVersion: process.versions.node,
    pnpmVersion,
  };
}

export async function checkCurrentToolchain(options) {
  assertSupportedToolchain(await readCurrentToolchain(options));
}

async function main() {
  try {
    await checkCurrentToolchain();
  } catch {
    console.error(TOOLCHAIN_ERROR_MESSAGE);
    process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main();
}
