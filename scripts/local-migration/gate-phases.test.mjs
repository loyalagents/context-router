import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";

import { validatePhaseManifest } from "./gate-runner.mjs";

const manifest = JSON.parse(
  await readFile(new URL("./gate-phases.json", import.meta.url), "utf8"),
);
const require = createRequire(new URL("../../package.json", import.meta.url));
const Ajv2020 = require("ajv/dist/2020").default;
const schema = JSON.parse(
  await readFile(new URL("./gate-phases.schema.json", import.meta.url), "utf8"),
);

test("checked-in gate manifest contains the complete approved lifecycle in order", () => {
  const validate = new Ajv2020({ strict: true, allErrors: true }).compile(schema);
  assert.equal(validate(manifest), true, JSON.stringify(validate.errors));
  assert.deepEqual(validatePhaseManifest(manifest), []);
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
