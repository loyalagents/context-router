import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const repositoryRoot = path.resolve(__dirname, "../../..");
const requireFromRoot = createRequire(
  path.join(repositoryRoot, "package.json"),
);
const Ajv = requireFromRoot("ajv/dist/2020").default;

async function readJson(relativePath: string) {
  return JSON.parse(
    await readFile(path.join(repositoryRoot, relativePath), "utf8"),
  );
}

test("manifest v3 JSON Schema accepts the exact valid fixtures", async () => {
  const schema = await readJson(
    "apps/local-orchestrator/contracts/run-manifest-v3.schema.json",
  );
  const validate = new Ajv({ strict: false }).compile(schema);
  for (const fixture of [
    "run-manifest-v3.valid-empty.json",
    "run-manifest-v3.valid-mixed.json",
  ]) {
    const value = await readJson(
      `apps/local-orchestrator/test/fixtures/${fixture}`,
    );
    assert.equal(
      validate(value),
      true,
      `${fixture}: ${JSON.stringify(validate.errors)}`,
    );
  }
});

test("manifest v3 JSON Schema rejects focused invalid and permissive-client examples", async () => {
  const schema = await readJson(
    "apps/local-orchestrator/contracts/run-manifest-v3.schema.json",
  );
  const validate = new Ajv({ strict: false }).compile(schema);
  for (const fixture of [
    "run-manifest-v3.invalid-wrong-version.json",
    "run-manifest-v3.invalid-success-missing-id.json",
    "run-manifest-v3.invalid-request-error-missing-error.json",
    "run-manifest-v3.invalid-apply-and-extra.json",
  ]) {
    const value = await readJson(
      `apps/local-orchestrator/test/fixtures/${fixture}`,
    );
    assert.equal(validate(value), false, `${fixture} unexpectedly passed`);
  }
});

test("mixed fixture preserves correlation and complete partial reconciliation", async () => {
  const manifest = await readJson(
    "apps/local-orchestrator/test/fixtures/run-manifest-v3.valid-mixed.json",
  );
  const applied = manifest.files[0];
  assert.equal(applied.analysis.analysisId, applied.apply.analysisId);
  assert.equal(
    applied.apply.requestedCount,
    applied.apply.matchedSuggestionIds.length +
      applied.apply.unmatchedSuggestionIds.length +
      applied.apply.ambiguousSuggestionIds.length,
  );
  assert.equal(
    applied.apply.appliedCount,
    applied.apply.appliedPreferences.length,
  );
  assert.equal(manifest.summary.hasFailures, true);
});

test("schema id, registry, fixtures, and TypeScript runtime agree on literal version 3", async () => {
  const schema = await readJson(
    "apps/local-orchestrator/contracts/run-manifest-v3.schema.json",
  );
  const registry = await readJson(
    "docs/current/local-migration-contract-baseline.json",
  );
  const source = await readFile(
    path.join(repositoryRoot, "apps/local-orchestrator/src/types.ts"),
    "utf8",
  );
  assert.match(schema.$id, /run-manifest-v3\.schema\.json$/);
  assert.equal(schema.properties.version.const, 3);
  assert.equal(registry.contracts.manifest.version, 3);
  assert.match(
    registry.contracts.manifest.fixture,
    /run-manifest-v3\.valid-mixed\.json$/,
  );
  assert.match(source, /interface RunManifest[\s\S]*?version:\s*3;/);
});
