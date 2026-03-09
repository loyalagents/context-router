import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  expectedPackTarballName,
  findPackedTarballPath,
} from "../scripts/tarball.mjs";

const tempDirs = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("pack tarball resolution", () => {
  it("derives the exact tarball name for the current scoped package", () => {
    expect(
      expectedPackTarballName({
        name: "@loyalagents/context-router-workshop-client",
        version: "0.1.0",
      }),
    ).toBe("loyalagents-context-router-workshop-client-0.1.0.tgz");
  });

  it("selects the tarball that matches the current package version", () => {
    const tarballDir = mkdtempSync(path.join(tmpdir(), "workshop-client-tarballs-"));
    tempDirs.push(tarballDir);

    writeFileSync(
      path.join(
        tarballDir,
        "loyalagents-context-router-workshop-client-0.9.0.tgz",
      ),
      "old",
    );
    writeFileSync(
      path.join(
        tarballDir,
        "loyalagents-context-router-workshop-client-0.10.0.tgz",
      ),
      "current",
    );

    expect(
      findPackedTarballPath(tarballDir, {
        name: "@loyalagents/context-router-workshop-client",
        version: "0.10.0",
      }),
    ).toBe(
      path.join(
        tarballDir,
        "loyalagents-context-router-workshop-client-0.10.0.tgz",
      ),
    );
  });

  it("throws a helpful error when the current tarball is missing", () => {
    const tarballDir = mkdtempSync(path.join(tmpdir(), "workshop-client-tarballs-"));
    tempDirs.push(tarballDir);

    writeFileSync(
      path.join(
        tarballDir,
        "loyalagents-context-router-workshop-client-0.9.0.tgz",
      ),
      "old",
    );

    expect(() =>
      findPackedTarballPath(tarballDir, {
        name: "@loyalagents/context-router-workshop-client",
        version: "0.10.0",
      }),
    ).toThrowError(
      /Expected tarball loyalagents-context-router-workshop-client-0\.10\.0\.tgz/,
    );
  });
});
