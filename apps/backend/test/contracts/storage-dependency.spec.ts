import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import ts from "typescript";
import { storageDependencyViolations } from "./storage-dependency-check";

describe("storage dependency graph", () => {
  it.each([
    "import type { Client } from 'pg';",
    "export { PrismaClient } from '@prisma/client';",
    "export type { Row } from './generated/prisma/client';",
    "const driver = require('pg');",
    "const driver = import('@prisma/adapter-pg');",
    "type Driver = import('pg').Client;",
    "import { Hidden } from '@alias/barrel';",
  ])("rejects provider leakage through %s", (source) => {
    const files = {
      "/src/application.ts": source,
      "/src/barrel.ts":
        "export * from './infrastructure/storage/postgres/adapter';",
    };
    const failures = storageDependencyViolations(
      ["/src/application.ts"],
      (file) => files[file],
      (name, from) =>
        name === "@alias/barrel"
          ? "/src/barrel.ts"
          : name.startsWith(".")
            ? resolve(dirname(from), name)
            : undefined,
    );
    expect(failures).toHaveLength(1);
  });

  it("keeps owned data and mutation ports independent through every imported type", () => {
    const backend = resolve(__dirname, "../..");
    const configFile = ts.readConfigFile(
      resolve(backend, "tsconfig.json"),
      ts.sys.readFile,
    );
    const config = ts.parseJsonConfigFileContent(
      configFile.config,
      ts.sys,
      backend,
    );
    const roots = [
      "domains/shared/storage/storage-types.ts",
      "domains/shared/storage/storage-unit-of-work.ts",
      "domains/shared/storage/storage-errors.ts",
      "modules/preferences/preference/preference.repository.ts",
      "modules/preferences/preference-definition/preference-definition.repository.ts",
      "modules/preferences/audit/preference-audit.service.ts",
      "modules/preferences/audit/snapshot-builders.ts",
    ].map((file) => resolve(backend, "src", file));
    expect(
      storageDependencyViolations(
        roots,
        (file) => readFileSync(file, "utf8"),
        (name, from) =>
          ts.resolveModuleName(name, from, config.options, ts.sys)
            .resolvedModule?.resolvedFileName,
      ),
    ).toEqual([]);
  });
});
