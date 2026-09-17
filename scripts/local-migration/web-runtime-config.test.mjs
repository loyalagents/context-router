import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const webRoot = path.join(repositoryRoot, "apps/web");
const runtimeConfigPath = "apps/web/lib/runtime-config.ts";

const graphqlConsumers = [
  "apps/web/lib/apollo-client.ts",
  "apps/web/lib/apollo-wrapper.tsx",
  "apps/web/app/dashboard/search-lab/SearchLabClient.tsx",
  "apps/web/app/dashboard/history/McpAccessHistoryTab.tsx",
  "apps/web/app/dashboard/profile/ProfileForm.tsx",
  "apps/web/app/dashboard/schema/SchemaClient.tsx",
  "apps/web/app/dashboard/permissions/PermissionsClient.tsx",
  "apps/web/app/dashboard/preferences/PreferencesClient.tsx",
  "apps/web/app/dashboard/preferences/components/AuditHistoryTab.tsx",
  "apps/web/app/dashboard/preferences/components/ManualPreferenceForm.tsx",
  "apps/web/app/dashboard/preferences/components/MemoryResetPanel.tsx",
  "apps/web/app/dashboard/preferences/components/PreferenceItem.tsx",
  "apps/web/app/dashboard/preferences/components/SuggestionInbox.tsx",
  "apps/web/app/dashboard/preferences/components/SuggestionsList.tsx",
];
const backendConsumers = [
  "apps/web/app/dashboard/form-fill/FormFillClient.tsx",
  "apps/web/app/dashboard/preferences/components/DocumentUpload.tsx",
];
const allConsumers = [...graphqlConsumers, ...backendConsumers];

function read(relativePath) {
  return readFileSync(path.join(repositoryRoot, relativePath), "utf8");
}

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return [".next", "node_modules"].includes(entry.name)
        ? []
        : sourceFiles(absolutePath);
    }
    return /\.[cm]?[jt]sx?$/.test(entry.name) ? [absolutePath] : [];
  });
}

test("one build-time module owns literal public backend endpoint reads and defaults", () => {
  const matches = sourceFiles(webRoot)
    .filter((file) =>
      /NEXT_PUBLIC_(?:GRAPHQL_URL|BACKEND_URL)/.test(
        readFileSync(file, "utf8"),
      ),
    )
    .map((file) => path.relative(repositoryRoot, file))
    .sort();

  assert.deepEqual(matches, [runtimeConfigPath]);
  const runtimeConfig = read(runtimeConfigPath);
  assert.match(runtimeConfig, /process\.env\.NEXT_PUBLIC_GRAPHQL_URL/);
  assert.match(runtimeConfig, /process\.env\.NEXT_PUBLIC_BACKEND_URL/);
  assert.match(
    runtimeConfig,
    /GRAPHQL_URL\s*=\s*process\.env\.NEXT_PUBLIC_GRAPHQL_URL\s*\|\|\s*['"]http:\/\/localhost:3000\/graphql['"]/,
  );
  assert.match(
    runtimeConfig,
    /BACKEND_URL\s*=\s*process\.env\.NEXT_PUBLIC_BACKEND_URL\s*\|\|\s*['"]http:\/\/localhost:3000['"]/,
  );
  assert.doesNotMatch(runtimeConfig, /process\.env\[/);
  assert.doesNotMatch(runtimeConfig, /APP_BASE_URL|AUTH0|server-only/);
});

test("the exact approved consumer set imports the centralized endpoints", () => {
  assert.equal(allConsumers.length, 16);
  const importers = sourceFiles(webRoot)
    .filter((file) =>
      /from ['"]@\/lib\/runtime-config['"]/.test(readFileSync(file, "utf8")),
    )
    .map((file) => path.relative(repositoryRoot, file))
    .sort();
  assert.deepEqual(importers, [...allConsumers].sort());
  for (const consumer of graphqlConsumers) {
    const source = read(consumer);
    assert.match(source, /from ['"]@\/lib\/runtime-config['"]/);
    assert.match(source, /GRAPHQL_URL/);
    assert.doesNotMatch(source, /NEXT_PUBLIC_|BACKEND_URL/);
  }
  for (const consumer of backendConsumers) {
    const source = read(consumer);
    assert.match(source, /from ['"]@\/lib\/runtime-config['"]/);
    assert.match(source, /BACKEND_URL/);
    assert.doesNotMatch(source, /NEXT_PUBLIC_|GRAPHQL_URL/);
  }
});

test("APP_BASE_URL remains the Auth0-only server-runtime origin", () => {
  const matches = sourceFiles(webRoot)
    .filter((file) => readFileSync(file, "utf8").includes("APP_BASE_URL"))
    .map((file) => path.relative(repositoryRoot, file))
    .sort();

  assert.deepEqual(matches, ["apps/web/lib/auth0.ts"]);
  assert.match(read("apps/web/lib/auth0.ts"), /process\.env\.APP_BASE_URL/);
});

test("operator docs distinguish build-time endpoints from the Auth0 runtime origin", () => {
  const rootReadme = read("README.md");

  assert.match(rootReadme, /NEXT_PUBLIC_GRAPHQL_URL/);
  assert.match(rootReadme, /NEXT_PUBLIC_BACKEND_URL/);
  assert.match(rootReadme, /captur(?:e|es) both public values at build time/i);
  assert.match(rootReadme, /APP_BASE_URL.*Auth0 server-runtime origin/);
});

test("the contract registry records centralized endpoint ownership", () => {
  const registry = JSON.parse(
    read("docs/current/local-migration-contract-baseline.json"),
  );
  const outbound = registry.outboundCalls.find(
    (entry) => entry.id === "web-backend",
  );
  assert.ok(outbound, "web-backend outbound inventory must exist");
  const sources = new Map(
    outbound.sources.map((source) => [source.path, source.fingerprints]),
  );

  assert.deepEqual([...sources.keys()].sort(), [...allConsumers].sort());
  assert.equal(sources.has(runtimeConfigPath), false);

  const movedGraphqlReferences = registry.contractReferences.filter(
    (reference) =>
      reference.reference === "/graphql" &&
      allConsumers.includes(reference.path),
  );
  assert.deepEqual(movedGraphqlReferences, []);
  assert.ok(
    registry.contractReferences.some(
      (reference) =>
        reference.path === runtimeConfigPath &&
        reference.reference === "/graphql",
    ),
  );
});
