import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

export function readPackageManifest(packageDir) {
  const manifestPath = path.join(packageDir, "package.json");
  return JSON.parse(readFileSync(manifestPath, "utf8"));
}

export function expectedPackTarballName(manifest) {
  if (!manifest?.name || !manifest?.version) {
    throw new Error("Package manifest must include name and version");
  }

  return `${String(manifest.name).replace(/^@/, "").replace(/\//g, "-")}-${manifest.version}.tgz`;
}

export function findPackedTarballPath(tarballDir, manifest) {
  if (!existsSync(tarballDir)) {
    throw new Error(`Tarball directory not found: ${tarballDir}`);
  }

  const expectedTarball = expectedPackTarballName(manifest);
  const expectedPath = path.join(tarballDir, expectedTarball);
  if (existsSync(expectedPath)) {
    return expectedPath;
  }

  const availableTarballs = readdirSync(tarballDir)
    .filter((entry) => entry.endsWith(".tgz"))
    .sort((left, right) => left.localeCompare(right));

  if (availableTarballs.length === 0) {
    throw new Error(
      `No workshop-client tarball found in ${tarballDir}. Run pnpm pack:workshop-client first.`,
    );
  }

  throw new Error(
    `Expected tarball ${expectedTarball} in ${tarballDir}, but found: ${availableTarballs.join(", ")}`,
  );
}
