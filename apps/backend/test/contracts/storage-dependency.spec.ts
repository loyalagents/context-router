import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import ts from "typescript";
import { storageDependencyViolations } from "./storage-dependency-check";

describe("storage dependency graph", () => {
  it.each([
    "import type { Client } from 'pg';",
    "export { PrismaClient } from '@prisma/client';",
    "export type { Row } from './generated/prisma/client';",
    "const driver = require('pg');",
    "const driver = module.require('pg');",
    "const driver = require('p' + 'g');",
    "const driver = import(providerName);",
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

  it.each([
    "/repo/node_modules/pg/lib/index.js",
    "/repo/node_modules/@types/pg/index.d.ts",
    "/repo/node_modules/@prisma/client/index.d.ts",
  ])("classifies an aliased external provider before pruning %s", (target) => {
    expect(
      storageDependencyViolations(
        ["/src/application.ts"],
        () => "import type { Hidden } from '@alias/provider';",
        () => target,
      ),
    ).toHaveLength(1);
  });

  it("keeps all production application, domain and transport code independent through every imported type", () => {
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
    const applicationRoots = ["common", "domains", "mcp", "modules"];
    // This operational entrypoint is the explicit local administration composition root.
    const compositionEntrypoints = new Set([
      resolve(backend, "src/modules/auth/local-identity-admin.cli.ts"),
    ]);
    const collect = (directory: string): string[] =>
      readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const file = resolve(directory, entry.name);
        if (entry.isDirectory()) return collect(file);
        return file.endsWith(".ts") &&
          !file.endsWith(".spec.ts") &&
          !compositionEntrypoints.has(file)
          ? [file]
          : [];
      });
    const roots = applicationRoots.flatMap((directory) =>
      collect(resolve(backend, "src", directory)),
    );
    expect(roots.length).toBeGreaterThan(100);
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
