import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import ts from "typescript";
import { storageDependencyViolations } from "./storage-dependency-check";

describe("storage dependency graph", () => {
  it.each([
    "import { createRequire } from 'node:module'; const load = createRequire(__filename); load('pg');",
    "import { createRequire as makeLoader } from 'module'; const load = makeLoader(__filename); load('pg');",
    "import * as moduleApi from 'node:module'; const load = moduleApi.createRequire(__filename); load('pg');",
    "import * as moduleApi from 'module'; const load = (moduleApi)['createRequire'](__filename); load('pg');",
    "import moduleApi from 'module'; const load = moduleApi['createRequire'](__filename); load('pg');",
    "import moduleApi = require('module'); const load = moduleApi.createRequire(__filename); load('pg');",
    "const { createRequire: makeLoader } = require('node:module'); const load = makeLoader(__filename); load('pg');",
    "const moduleApi = require('module'); const load = moduleApi.createRequire(__filename); load('pg');",
    "const moduleApi = module.require('node:module'); const { createRequire } = moduleApi; const load = createRequire(__filename); load('pg');",
    "const makeLoader = require('node:module')['createRequire']; const load = makeLoader(__filename); load('pg');",
    "const load = require('module').createRequire(__filename); load('pg');",
    "const { createRequire } = await import('node:module'); const load = createRequire(__filename); load('pg');",
    "const load = (await import('module')).createRequire(__filename); load('pg');",
    "export { createRequire as makeLoader } from 'node:module';",
    "export * from 'module';",
    "export * as moduleApi from 'node:module';",
  ])(
    "rejects obtaining or exporting a createRequire loader through %s",
    (source) => {
      expect(
        storageDependencyViolations(
          ["/src/application.ts"],
          () => source,
          () => undefined,
        ),
      ).toEqual(["/src/application.ts -> createRequire capability"]);
    },
  );

  it.each([
    "import type { Missing } from './does-not-exist';",
    "export { Missing } from '../does-not-exist';",
    "type Missing = import('./does-not-exist').Missing;",
    "const missing = require('./does-not-exist');",
    "const missing = module.require('../does-not-exist');",
    "const missing = import('/src/does-not-exist');",
    "import type { Missing } from '@configured/missing';",
    "export type { Missing } from '@exact';",
    "import Missing = require('@feature/missing/model');",
    "const missing = import('@configured/missing');",
  ])("rejects unresolved internal edges through %s", (source) => {
    expect(
      storageDependencyViolations(
        ["/src/application.ts"],
        () => source,
        () => undefined,
        ["@configured/*", "@exact", "@feature/*/model"],
      ),
    ).toEqual([expect.stringContaining("unresolved internal import:")]);
  });

  it.each([
    "import { isBuiltin } from 'node:module'; isBuiltin('fs');",
    "import * as moduleApi from 'module'; moduleApi.isBuiltin('fs');",
    "const { isBuiltin } = require('node:module'); isBuiltin('fs');",
    "export { isBuiltin as checkBuiltin } from 'module';",
    "export * from 'node:fs';",
    "import { readFile } from 'node:fs/promises';",
    "import { Injectable } from '@nestjs/common';",
    "import { unrelated } from '@exact/package';",
    "import { unrelated } from '@feature/package/other';",
    "import { unrelated } from '@feature/model';",
  ])("retains ordinary external and builtin edges through %s", (source) => {
    expect(
      storageDependencyViolations(
        ["/src/application.ts"],
        () => source,
        () => undefined,
        ["@configured/*", "@exact", "@feature/*/model"],
      ),
    ).toEqual([]);
  });

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
        Object.keys(config.options.paths ?? {}),
      ),
    ).toEqual([]);
  });
});
