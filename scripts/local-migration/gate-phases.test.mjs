import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";

import {
  validateApprovedPhaseCommands,
  validatePhaseManifest,
} from "./gate-runner.mjs";
import {
  buildAdministrationCanaries,
  RESTART_SMOKE_TERMINATION_GRACE_MS,
  formatPreflightEvidence,
  terminationGraceForPhase,
} from "./migration-gate.mjs";
import { RESTART_SMOKE_BOUNDED_CLEANUP_BUDGET_MS } from "./restart-smoke.mjs";

const manifest = JSON.parse(
  await readFile(new URL("./gate-phases.json", import.meta.url), "utf8"),
);
const require = createRequire(new URL("../../package.json", import.meta.url));
const Ajv2020 = require("ajv/dist/2020").default;
const schema = JSON.parse(
  await readFile(new URL("./gate-phases.schema.json", import.meta.url), "utf8"),
);

test("administration redaction canaries include encoded and decoded credentials", () => {
  assert.deepEqual(
    buildAdministrationCanaries(
      "postgresql://gate-user:p%40ss@127.0.0.1:5433/postgres",
      ["synthetic-extra"],
    ),
    ["synthetic-extra", "p%40ss", "p@ss"],
  );
});

test("checked-in gate manifest contains the complete approved lifecycle in order", () => {
  const validate = new Ajv2020({ strict: true, allErrors: true }).compile(schema);
  assert.equal(validate(manifest), true, JSON.stringify(validate.errors));
  assert.deepEqual(validatePhaseManifest(manifest), []);
  assert.deepEqual(validateApprovedPhaseCommands(manifest), []);
  assert.deepEqual(
    manifest.phases.map(({ id }) => id),
    [
      "contract-baseline",
      "documentation",
      "backend-unit-build",
      "backend-database",
      "local-orchestrator",
      "eval-fixtures",
      "eval-deterministic-scenarios",
      "web-production-build",
      "harbor-static",
      "restart-smoke",
      "repository-integrity",
    ],
  );
  assert.equal(manifest.phases[9].kind, "restart-smoke");
  assert.deepEqual(manifest.supportedModes, [
    {
      id: "hosted-baseline",
      status: "active",
      successorModes: [],
      requiredEvidenceClasses: ["contract", "build", "state", "restart", "integrity"],
    },
  ]);
  assert.deepEqual(
    manifest.phases.map((phase) => phase.commands.map((command) => command.argv)),
    [
      [
        [
          "node",
          "--test",
          "scripts/local-migration/check-contract-baseline.test.mjs",
          "scripts/local-migration/gate-runner.test.mjs",
          "scripts/local-migration/gate-phases.test.mjs",
          "scripts/local-migration/restart-smoke.test.mjs",
          "scripts/local-migration/test-database.test.mjs",
          "scripts/local-migration/web-support-smoke.test.mjs",
        ],
        ["node", "scripts/local-migration/check-contract-baseline.mjs"],
      ],
      [
        ["node", "--test", "scripts/check-markdown-links.test.mjs"],
        ["node", "scripts/check-markdown-links.mjs"],
      ],
      [
        ["pnpm", "--filter", "backend", "prisma:generate"],
        ["pnpm", "--filter", "backend", "typecheck:seed"],
        ["pnpm", "--filter", "backend", "build"],
        ["pnpm", "--filter", "backend", "test:unit"],
      ],
      [
        ["pnpm", "--filter", "backend", "exec", "prisma", "migrate", "deploy"],
        ["pnpm", "--filter", "backend", "test:integration"],
        ["pnpm", "--filter", "backend", "test:e2e:tests-only"],
      ],
      [
        ["pnpm", "--filter", "local-orchestrator", "test"],
        ["pnpm", "--filter", "local-orchestrator", "lint"],
        ["pnpm", "--filter", "local-orchestrator", "build"],
      ],
      [["pnpm", "eval:verify"]],
      [
        ["pnpm", "eval:run", "--scenario", "samir-desai-i9-template-smoke"],
        ["pnpm", "eval:run", "--scenario", "elena-marquez-i9-template-smoke"],
      ],
      [["pnpm", "--filter", "web", "build"]],
      [["bash", "examples/eval-harbor/scripts/check_static.sh"]],
      [["node", "scripts/local-migration/restart-smoke.mjs"]],
      [["node", "scripts/local-migration/check-generated-integrity.mjs"]],
    ],
  );
});

test("dedicated CI seeds the offline pnpm 9 Corepack cache before invoking the gate", async () => {
  const workflow = await readFile(
    new URL("../../.github/workflows/local-migration-baseline.yml", import.meta.url),
    "utf8",
  );
  const seed = workflow.indexOf("corepack prepare pnpm@9 --activate");
  const gate = workflow.indexOf("run: pnpm migration:gate");
  assert.ok(seed >= 0, "workflow must seed the pnpm 9 Corepack cache");
  assert.ok(gate > seed, "workflow must seed Corepack before running the gate");
});

test("backend build and seed configs pin production and smoke entrypoints", async () => {
  const [backendTsconfig, seedTsconfig] = await Promise.all(
    ["../../apps/backend/tsconfig.json", "../../apps/backend/tsconfig.seed.json"].map(
      async (relativePath) =>
        JSON.parse(await readFile(new URL(relativePath, import.meta.url), "utf8")),
    ),
  );
  assert.equal(backendTsconfig.compilerOptions.rootDir, "./src");
  assert.equal(backendTsconfig.compilerOptions.outDir, "./dist");
  assert.equal(
    backendTsconfig.compilerOptions.tsBuildInfoFile,
    "./dist/tsconfig.tsbuildinfo",
  );
  assert.equal(
    backendTsconfig.compilerOptions.tsBuildInfoFile.startsWith(
      `${backendTsconfig.compilerOptions.outDir}/`,
    ),
    true,
  );
  assert.deepEqual(seedTsconfig.include, [
    "prisma/seed.ts",
    "prisma/seed-catalog-smoke.ts",
  ]);
  assert.equal(seedTsconfig.compilerOptions.rootDir, ".");
  const backendJest = require("./apps/backend/jest.config.js");
  const unit = backendJest.projects.find(
    (project) => project.displayName === "unit",
  );
  assert.ok(unit.testMatch.includes("<rootDir>/test/contracts/**/*.spec.ts"));
});

test("approved command policy rejects substitution, removal, unknown commands, and eval indirection", () => {
  for (const mutate of [
    (candidate) => {
      candidate.phases[0].commands[0].argv = ["true"];
    },
    (candidate) => {
      candidate.phases[2].commands.pop();
    },
    (candidate) => {
      candidate.phases[4].commands.push({ argv: ["curl", "https://example.test"] });
    },
    (candidate) => {
      candidate.phases[8].commands[0].argv = ["bash", "-c", "true"];
    },
    (candidate) => {
      candidate.phases[10].commands[0].argv = ["node", "-e", "process.exit(0)"];
    },
  ]) {
    const candidate = structuredClone(manifest);
    mutate(candidate);
    assert.ok(validateApprovedPhaseCommands(candidate).length > 0);
  }
});

test("phase manifest schema rejects unknown fields and incomplete lifecycle records", () => {
  const validate = new Ajv2020({ strict: true, allErrors: true }).compile(schema);
  const invalid = structuredClone(manifest);
  invalid.phases[0].unexpected = true;
  delete invalid.phases[0].timeoutMs;
  assert.equal(validate(invalid), false);
  assert.ok(validate.errors.some((error) => error.keyword === "additionalProperties"));
  assert.ok(validate.errors.some((error) => error.keyword === "required"));
});

test("every phase has explicit transition metadata and no live-provider dependency", () => {
  for (const phase of manifest.phases) {
    assert.equal(phase.ownerStep, "01");
    assert.equal(phase.status, "active");
    assert.ok(Number.isInteger(phase.timeoutMs) && phase.timeoutMs > 0);
    assert.ok(phase.retirementCondition.length > 20);
    assert.ok(Array.isArray(phase.replacementEvidence));
    assert.ok(phase.modes.includes("hosted-baseline"));
    assert.ok(phase.evidenceClasses.length > 0);
  }
  const commands = JSON.stringify(manifest.phases.flatMap((phase) => phase.commands));
  for (const prohibited of [
    "AUTH0_CLIENT_SECRET",
    "GOOGLE_APPLICATION_CREDENTIALS",
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "eval-harbor:smoke",
    "pnpm install",
    "docker pull",
  ]) {
    assert.equal(commands.includes(prohibited), false, prohibited);
  }
});

test("the outer gate grants restart smoke more time than its cumulative cleanup budget", () => {
  assert.ok(
    RESTART_SMOKE_TERMINATION_GRACE_MS >
      RESTART_SMOKE_BOUNDED_CLEANUP_BUDGET_MS,
  );
  assert.equal(
    terminationGraceForPhase({ kind: "restart-smoke" }),
    RESTART_SMOKE_TERMINATION_GRACE_MS,
  );
  assert.equal(terminationGraceForPhase({ kind: "command" }), 5_000);
});

test("successful preflight evidence is exact, single-line, and contains no administration URL", () => {
  assert.equal(
    formatPreflightEvidence({
      baseSha: "a".repeat(40),
      versions: {
        node: "v20.19.5",
        pnpm: "10.25.0",
        python: "3.12.14",
        postgres: "15.15",
      },
      administrationSource: "supplied-loopback-administration-url",
    }),
    `migration-gate: preflight base=${"a".repeat(40)} node=v20.19.5 pnpm=10.25.0 python=3.12.14 postgres=15.15 administration=supplied-loopback-administration-url`,
  );
});

test("disposable-workspace documentation checks cannot discover the private Corepack cache", async () => {
  const source = await readFile(new URL("./migration-gate.mjs", import.meta.url), "utf8");
  assert.match(
    source,
    /path\.join\(diagnosticsDirectory, "corepack-home"\)/,
  );
  assert.doesNotMatch(source, /path\.join\(workspace, "\.lmbg-corepack"\)/);
});

test("replacement evidence is typed, resolvable, and cannot be a free-form completion claim", () => {
  const validate = new Ajv2020({ strict: true, allErrors: true }).compile(schema);
  const invalid = structuredClone(manifest);
  invalid.phases[0].status = "retired";
  invalid.phases[0].replacementEvidence = ["done"];
  assert.equal(validate(invalid), false);

  const dangling = structuredClone(manifest);
  dangling.phases[0].status = "retired";
  dangling.phases[0].replacementEvidence = [
    {
      kind: "phase",
      phaseId: "missing-successor",
      coveredModes: ["hosted-baseline"],
      evidenceClasses: ["contract"],
    },
  ];
  assert.ok(
    validatePhaseManifest(dangling).some((error) =>
      error.includes("replacement evidence"),
    ),
  );
});
