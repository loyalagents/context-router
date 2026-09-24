import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import ts from "typescript";
import { storageDependencyViolations } from "./storage-dependency-check";

describe("storage dependency graph", () => {
  it.each([
    "import { DatabaseSync as Db } from 'node:sqlite';",
    "import type { DatabaseSync } from 'node:sqlite';",
    "export { DatabaseSync } from 'node:sqlite';",
    "export type { DatabaseSync } from 'node:sqlite';",
    "export * from 'node:sqlite';",
    "export * as sqlite from 'node:sqlite';",
    "import sqlite = require('node:sqlite');",
    "type Driver = import('node:sqlite').DatabaseSync;",
    "const sqlite = require('node:sqlite');",
    "const sqlite = module.require('node:sqlite');",
    "const sqlite = import('node:sqlite');",
  ])("rejects SQLite provider syntax %s", (source) => {
    expect(
      storageDependencyViolations(
        ["/src/application.ts"],
        () => source,
        () => undefined,
      ),
    ).toEqual(["/src/application.ts -> node:sqlite"]);
  });

  it.each([
    "process.getBuiltinModule('node:sqlite');",
    "process['getBuiltinModule']('node:sqlite');",
    "import { getBuiltinModule as load } from 'node:process'; load('node:sqlite');",
    "import * as runtime from 'node:process'; runtime.getBuiltinModule('node:sqlite');",
    "import runtime from 'process'; runtime['getBuiltinModule']('node:sqlite');",
    "import runtime = require('node:process'); runtime.getBuiltinModule('node:sqlite');",
    "const runtime = require('process'); runtime.getBuiltinModule('node:sqlite');",
    "const { getBuiltinModule: load } = process; load('node:sqlite');",
    "const { getBuiltinModule: load } = require('node:process'); load('node:sqlite');",
    "const load = (await import('node:process')).getBuiltinModule; load('node:sqlite');",
    "export { getBuiltinModule as load } from 'node:process';",
    "export * from 'node:process';",
    "export * as runtime from 'process';",
  ])("rejects builtin-loader capability syntax %s", (source) => {
    expect(
      storageDependencyViolations(
        ["/src/application.ts"],
        () => source,
        () => undefined,
      ),
    ).toEqual(["/src/application.ts -> getBuiltinModule capability"]);
  });

  it.each([
    ["export type { DatabaseSync } from 'node:sqlite';", "node:sqlite"],
    [
      "export * from '@infrastructure/storage/sqlite/sqlite-database';",
      "@infrastructure/storage/sqlite/sqlite-database",
    ],
  ])(
    "traces configured alias to SQLite provider through %s",
    (barrel, provider) => {
      const files = {
        "/src/application.ts": "import type { Hidden } from '@config/barrel';",
        "/src/config/barrel.ts": barrel,
      };
      expect(
        storageDependencyViolations(
          ["/src/application.ts"],
          (file) => files[file],
          (specifier) =>
            specifier === "@config/barrel"
              ? "/src/config/barrel.ts"
              : specifier.startsWith("@infrastructure/")
                ? "/src/infrastructure/storage/sqlite/sqlite-database.ts"
                : undefined,
          ["@config/*", "@infrastructure/*"],
        ),
      ).toEqual([
        `/src/application.ts -> /src/config/barrel.ts -> ${provider}`,
      ]);
    },
  );

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
    "import { platform } from 'node:process'; platform;",
    "import * as runtime from 'node:process'; runtime.env;",
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
