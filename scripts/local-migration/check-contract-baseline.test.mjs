import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildGraphqlSignature,
  collectContractReferences,
  contractFingerprint,
  collectGraphqlOperations,
  collectOutboundSinkInventory,
  diffCatalogContracts,
  diffGraphqlSignatures,
  diffHttpContracts,
  diffJsonValues,
  diffMcpContracts,
  normalizeCatalog,
  protectedRegistrySnapshot,
  resolveBaseComparisonMode,
  validateBaselineDocument,
  validateConsumerMap,
  validateContractReferenceMap,
  validateDynamicConsumer,
  validateExternalConsumerCoverage,
  validateFingerprintConsumers,
  validateHttpContract,
  validateHttpRuntimeEvidence,
  validateManifestCompatibility,
  validateManifestVersionedPaths,
  validateMcpContract,
  validateOutboundSourceFingerprints,
  validateOutboundSinkInventory,
  validateBootstrapCompatibility,
  validateContractEvolution,
  validateReferencedPaths,
  validateRegistryMode,
  resolveRepositoryPath,
  verifyBaseArtifactBundle,
  writeRepositoryJson,
} from "./check-contract-baseline.mjs";

test("buildGraphqlSignature captures arguments, wrappers, enums, and deprecations semantically", () => {
  const signature = buildGraphqlSignature(`
    enum Mode { OLD @deprecated(reason: "use NEW") NEW }
    input SearchInput { query: String! limit: Int = 5 }
    type Result { value: String! }
    type Query { search(input: SearchInput!, mode: Mode = NEW): [Result!]! }
  `);

  assert.deepEqual(signature.types.Mode.values, [
    { name: "NEW", deprecationReason: null, appliedDirectives: [] },
    {
      name: "OLD",
      deprecationReason: "use NEW",
      appliedDirectives: [],
    },
  ]);
  assert.equal(signature.types.Query.fields.search.type, "[Result!]!");
  assert.deepEqual(signature.types.Query.fields.search.args, [
    {
      name: "input",
      type: "SearchInput!",
      hasDefault: false,
      defaultValue: null,
      deprecationReason: null,
      appliedDirectives: [],
    },
    {
      name: "mode",
      type: "Mode",
      hasDefault: true,
      defaultValue: "NEW",
      deprecationReason: null,
      appliedDirectives: [],
    },
  ]);
  assert.equal(signature.types.SearchInput.inputFields.limit.defaultValue, "5");
  assert.equal(signature.types.SearchInput.inputFields.limit.hasDefault, true);
});

test("diffGraphqlSignatures classifies additive and breaking changes", () => {
  const before = buildGraphqlSignature("type Query { one: String! }");
  const additive = buildGraphqlSignature(
    "type Query { one: String! two(optional: String): String }",
  );
  const breaking = buildGraphqlSignature("type Query { one: String }");

  assert.deepEqual(diffGraphqlSignatures(before, additive).breaking, []);
  assert.deepEqual(diffGraphqlSignatures(before, additive).additive, [
    "Query.two",
  ]);
  assert.match(
    diffGraphqlSignatures(before, breaking).breaking[0],
    /Query\.one/,
  );
});

test("GraphQL output-domain and possible-type widenings require review", () => {
  const before = buildGraphqlSignature(`
    interface Node { id: ID! }
    type User implements Node { id: ID! }
    type Existing { id: ID! }
    enum Status { A }
    union SearchResult = User
    type Query { node: Node result: SearchResult status: Status }
  `);
  const after = buildGraphqlSignature(`
    interface Node { id: ID! }
    type User implements Node { id: ID! }
    type Existing implements Node { id: ID! }
    type Added implements Node { id: ID! }
    enum Status { A B }
    union SearchResult = User | Existing
    type Query { node: Node result: SearchResult status: Status }
  `);

  const diff = diffGraphqlSignatures(before, after);
  for (const change of [
    "added enum value Status.B",
    "added union member SearchResult.Existing",
    "Existing added implementation of Node",
    "Added added implementation of existing interface Node",
  ]) {
    assert.ok(diff.breaking.includes(change), change);
  }
  assert.ok(diff.additive.includes("Added"));
});

test("diffGraphqlSignatures classifies every field and enum deprecation transition", () => {
  const plain = buildGraphqlSignature(`
    enum Mode { ONE }
    type Query { value: String mode: Mode }
  `);
  const deprecated = buildGraphqlSignature(`
    enum Mode { ONE @deprecated(reason: "old enum") }
    type Query { value: String @deprecated(reason: "old field") mode: Mode }
  `);
  const changedReason = buildGraphqlSignature(`
    enum Mode { ONE @deprecated(reason: "new enum") }
    type Query { value: String @deprecated(reason: "new field") mode: Mode }
  `);

  assert.deepEqual(diffGraphqlSignatures(plain, deprecated).breaking, []);
  assert.ok(
    diffGraphqlSignatures(plain, deprecated).additive.includes(
      "deprecated Query.value",
    ),
  );
  assert.ok(
    diffGraphqlSignatures(plain, deprecated).additive.includes(
      "deprecated Mode.ONE",
    ),
  );
  assert.ok(
    diffGraphqlSignatures(deprecated, plain).breaking.includes(
      "removed deprecation Query.value",
    ),
  );
  assert.ok(
    diffGraphqlSignatures(deprecated, plain).breaking.includes(
      "removed deprecation Mode.ONE",
    ),
  );
  assert.ok(
    diffGraphqlSignatures(deprecated, changedReason).breaking.includes(
      "changed deprecation reason Query.value",
    ),
  );
  assert.ok(
    diffGraphqlSignatures(deprecated, changedReason).breaking.includes(
      "changed deprecation reason Mode.ONE",
    ),
  );
});

test("GraphQL signatures protect input oneOf and field/directive argument deprecations", () => {
  const plain = buildGraphqlSignature(`
    directive @policy(level: Int) on FIELD_DEFINITION
    input Selector { id: ID name: String legacy: String }
    type Query { item(selector: Selector, legacy: String): String }
  `);
  const constrained = buildGraphqlSignature(`
    directive @policy(level: Int @deprecated(reason: "use scope")) on FIELD_DEFINITION
    input Selector @oneOf { id: ID name: String legacy: String @deprecated(reason: "use id") }
    type Query { item(selector: Selector, legacy: String @deprecated(reason: "use selector")): String }
  `);
  const changedReason = buildGraphqlSignature(`
    directive @policy(level: Int @deprecated(reason: "new directive reason")) on FIELD_DEFINITION
    input Selector @oneOf { id: ID name: String legacy: String @deprecated(reason: "new input reason") }
    type Query { item(selector: Selector, legacy: String @deprecated(reason: "new field reason")): String }
  `);

  assert.equal(plain.types.Selector.isOneOf, false);
  assert.equal(constrained.types.Selector.isOneOf, true);
  const constrainedDiff = diffGraphqlSignatures(plain, constrained);
  assert.ok(
    constrainedDiff.breaking.includes("Selector enabled @oneOf input semantics"),
  );
  assert.ok(
    constrainedDiff.additive.includes("deprecated Query.item(legacy:)"),
  );
  assert.ok(
    constrainedDiff.additive.includes("deprecated directive @policy(level:)"),
  );
  assert.ok(
    constrainedDiff.additive.includes("deprecated Selector.legacy"),
  );
  const reasonDiff = diffGraphqlSignatures(constrained, changedReason);
  assert.ok(
    reasonDiff.breaking.includes(
      "changed deprecation reason Query.item(legacy:)",
    ),
  );
  assert.ok(
    reasonDiff.breaking.includes(
      "changed deprecation reason directive @policy(level:)",
    ),
  );
  assert.ok(
    reasonDiff.breaking.includes(
      "changed deprecation reason Selector.legacy",
    ),
  );
  assert.ok(
    diffGraphqlSignatures(constrained, plain).breaking.includes(
      "removed deprecation Query.item(legacy:)",
    ),
  );
});

test("GraphQL signatures protect applied custom directives and track descriptions as copy", () => {
  const withPolicy = buildGraphqlSignature(`
    "Schema copy"
    schema { query: Query }
    directive @policy(level: Int!) repeatable on OBJECT | FIELD_DEFINITION
    "Query copy"
    type Query @policy(level: 1) {
      "Field copy"
      item: String @policy(level: 2)
    }
  `);
  const withoutFieldPolicy = buildGraphqlSignature(`
    "Updated schema copy"
    schema { query: Query }
    directive @policy(level: Int!) repeatable on OBJECT | FIELD_DEFINITION
    "Updated query copy"
    type Query @policy(level: 1) {
      "Updated field copy"
      item: String
    }
  `);
  assert.notEqual(
    withPolicy.descriptionFingerprint,
    withoutFieldPolicy.descriptionFingerprint,
  );
  assert.deepEqual(withPolicy.types.Query.appliedDirectives, [
    { name: "policy", arguments: { level: "1" } },
  ]);
  assert.deepEqual(withPolicy.types.Query.fields.item.appliedDirectives, [
    { name: "policy", arguments: { level: "2" } },
  ]);
  assert.ok(
    diffGraphqlSignatures(withPolicy, withoutFieldPolicy).breaking.includes(
      "changed applied directives Query.item",
    ),
  );

  const ordered = buildGraphqlSignature(`
    input PolicyOptions { first: Int second: Int }
    directive @policy(level: Int!, options: PolicyOptions) repeatable on FIELD_DEFINITION
    type Query {
      item: String @policy(level: 1, options: { second: 2, first: 1 }) @policy(level: 2)
    }
  `);
  const equivalentObjectOrder = buildGraphqlSignature(`
    input PolicyOptions { first: Int second: Int }
    directive @policy(level: Int!, options: PolicyOptions) repeatable on FIELD_DEFINITION
    type Query {
      item: String @policy(options: { first: 1, second: 2 }, level: 1) @policy(level: 2)
    }
  `);
  const reversed = buildGraphqlSignature(`
    input PolicyOptions { first: Int second: Int }
    directive @policy(level: Int!, options: PolicyOptions) repeatable on FIELD_DEFINITION
    type Query {
      item: String @policy(level: 2) @policy(level: 1, options: { first: 1, second: 2 })
    }
  `);
  assert.deepEqual(
    ordered.types.Query.fields.item.appliedDirectives,
    equivalentObjectOrder.types.Query.fields.item.appliedDirectives,
  );
  assert.ok(
    diffGraphqlSignatures(ordered, reversed).breaking.includes(
      "changed applied directives Query.item",
    ),
  );
});

test("adding the first GraphQL operation root is additive while removal remains breaking", () => {
  const queryOnly = buildGraphqlSignature("type Query { ok: Boolean! }");
  const withMutation = buildGraphqlSignature(
    "type Query { ok: Boolean! } type Mutation { save: Boolean! }",
  );
  assert.ok(
    diffGraphqlSignatures(queryOnly, withMutation).additive.includes(
      "added mutation root Mutation",
    ),
  );
  assert.ok(
    diffGraphqlSignatures(withMutation, queryOnly).breaking.includes(
      "removed mutation root Mutation",
    ),
  );
});

test("GraphQL input-object defaults ignore declaration and object-field order", () => {
  const first = buildGraphqlSignature(`
    input Options { a: Int b: Int }
    type Query { item(options: Options = { a: 1, b: 2 }): String }
  `);
  const reordered = buildGraphqlSignature(`
    input Options { b: Int a: Int }
    type Query { item(options: Options = { b: 2, a: 1 }): String }
  `);
  assert.equal(
    first.types.Query.fields.item.args[0].defaultValue,
    reordered.types.Query.fields.item.args[0].defaultValue,
  );
  assert.deepEqual(diffGraphqlSignatures(first, reordered).breaking, []);
});

test("diffGraphqlSignatures protects interfaces, scalar metadata, and custom directives", () => {
  const before = buildGraphqlSignature(`
    directive @policy(level: Int = 1) repeatable on FIELD_DEFINITION | OBJECT
    scalar Locator @specifiedBy(url: "https://example.test/locator-v1")
    interface Node { id: ID! }
    type Item implements Node @policy { id: ID! locator: Locator }
    type Query { item: Item }
  `);
  const additive = buildGraphqlSignature(`
    directive @policy(level: Int = 1, note: String) repeatable on FIELD_DEFINITION | OBJECT | INTERFACE
    scalar Locator @specifiedBy(url: "https://example.test/locator-v1")
    interface Node { id: ID! }
    interface Named { name: String }
    type Item implements Node & Named @policy { id: ID! locator: Locator name: String }
    type Query { item: Item }
  `);
  const breaking = buildGraphqlSignature(`
    directive @policy(level: Int!) on FIELD_DEFINITION
    scalar Locator @specifiedBy(url: "https://example.test/locator-v2")
    interface Node { id: ID! }
    type Item { id: ID! locator: Locator }
    type Query { item: Item }
  `);

  const additiveDiff = diffGraphqlSignatures(before, additive);
  assert.equal(additiveDiff.breaking.length, 0);
  assert.ok(additiveDiff.additive.some((change) => change.includes("Item implements Named")));
  assert.ok(additiveDiff.additive.some((change) => change.includes("directive @policy location INTERFACE")));
  assert.ok(additiveDiff.additive.some((change) => change.includes("directive @policy(note:)")));

  const breakingDiff = diffGraphqlSignatures(before, breaking);
  assert.ok(breakingDiff.breaking.some((change) => change.includes("Item no longer implements Node")));
  assert.ok(breakingDiff.breaking.some((change) => change.includes("Locator specifiedByURL changed")));
  assert.ok(breakingDiff.breaking.some((change) => change.includes("directive @policy is no longer repeatable")));
  assert.ok(breakingDiff.breaking.some((change) => change.includes("directive @policy location OBJECT")));
  assert.ok(breakingDiff.breaking.some((change) => change.includes("directive @policy(level:)")));
});

test("collectGraphqlOperations ignores prose and returns named documents by path", () => {
  const operations = collectGraphqlOperations(
    new Map([
      [
        "client.ts",
        "const doc = `query CurrentUser { me { userId } }`; // query is validated",
      ],
      [
        "mutation.ts",
        "const doc = `mutation Save($id: ID!) { deletePreference(id: $id) }`;",
      ],
    ]),
  );

  assert.deepEqual(operations, [
    {
      path: "client.ts",
      kind: "query",
      operation: "CurrentUser",
      rootFields: ["me"],
    },
    {
      path: "mutation.ts",
      kind: "mutation",
      operation: "Save",
      rootFields: ["deletePreference"],
    },
  ]);
});

test("GraphQL consumer metadata resolves root fields through fragments", () => {
  const document = `
    query CatalogViaFragment {
      ...CatalogRoot
      ... on Query { me }
    }
    fragment CatalogRoot on Query {
      preferenceCatalog { slug }
    }
  `;
  assert.deepEqual(
    collectGraphqlOperations(new Map([["fragment-client.ts", `const doc = \`${document}\`;`]])),
    [
      {
        path: "fragment-client.ts",
        kind: "query",
        operation: "CatalogViaFragment",
        rootFields: ["me", "preferenceCatalog"],
      },
    ],
  );
  const cyclicDocument = `
    query CatalogViaFragment { ...CatalogRoot ... on Query { me } }
    fragment CatalogRoot on Query {
      preferenceCatalog { slug }
      ...RecursiveRoot
    }
    fragment RecursiveRoot on Query { ...CatalogRoot }
  `;
  assert.deepEqual(
    collectGraphqlOperations(
      new Map([["cyclic-fragment-client.ts", `const doc = \`${cyclicDocument}\`;`]]),
    )[0].rootFields,
    ["me", "preferenceCatalog"],
  );

  const consumer = {
    path: "fragment-client.ts",
    kind: "query",
    operation: "CatalogViaFragment",
    rootFields: ["me", "preferenceCatalog"],
    document,
    sourceFingerprints: ["...CatalogRoot"],
  };
  assert.deepEqual(
    validateDynamicConsumer(
      consumer,
      document,
      "type CatalogEntry { slug: String! } type Query { me: String preferenceCatalog: [CatalogEntry!]! }",
    ),
    [],
  );
  assert.ok(
    validateDynamicConsumer(
      { ...consumer, rootFields: [] },
      document,
      "type CatalogEntry { slug: String! } type Query { me: String preferenceCatalog: [CatalogEntry!]! }",
    ).some((error) => error.includes("root-field metadata is stale")),
  );
});

test("restart smoke GraphQL probes are named consumers required by migration evidence", async () => {
  const smokePath = "scripts/local-migration/restart-smoke.mjs";
  const smokeSource = await readFile(
    new URL("./restart-smoke.mjs", import.meta.url),
    "utf8",
  );
  const consumers = collectGraphqlOperations(
    new Map([[smokePath, smokeSource]]),
  );
  assert.deepEqual(consumers, [
    {
      path: smokePath,
      kind: "query",
      operation: "HostedBaselineCatalog",
      rootFields: ["preferenceCatalog"],
    },
    {
      path: smokePath,
      kind: "query",
      operation: "HostedBaselineGuardedCatalog",
      rootFields: ["preferenceCatalog"],
    },
    {
      path: smokePath,
      kind: "query",
      operation: "HostedBaselinePrincipal",
      rootFields: ["me"],
    },
    {
      path: smokePath,
      kind: "query",
      operation: "HostedBaselinePublic",
      rootFields: ["__typename"],
    },
  ]);

  const previousGraphql = buildGraphqlSignature(
    "type Query { me: String preferenceCatalog: String legacy: String }",
  );
  const currentGraphql = buildGraphqlSignature(
    "type Query { me: String preferenceCatalog: String }",
  );
  const changes = diffGraphqlSignatures(
    previousGraphql,
    currentGraphql,
  ).breaking;
  const registry = {
    version: 1,
    capabilities: [],
    packages: [],
    outboundCalls: [],
    externalClients: [],
    consumers,
    dynamicConsumers: [],
    fingerprintConsumers: [],
    contractReferences: [],
    migrationRecords: [],
  };
  const coveredConsumers = consumers.slice(0, -1).map((consumer) => ({
    path: consumer.path,
    consumerId: `graphql:${consumer.path}:${consumer.kind}:${consumer.operation}:${JSON.stringify(consumer.rootFields)}`,
    outcome: "migrated",
  }));
  const errors = validateContractEvolution({
    previousRegistry: registry,
    currentRegistry: {
      ...registry,
      migrationRecords: [
        reviewedRecord({
          contract: "graphql",
          previous: previousGraphql,
          current: currentGraphql,
          changes,
          consumerEvidence: coveredConsumers,
        }),
      ],
    },
    previousGraphql,
    currentGraphql,
    graphqlBreaking: changes,
  });
  assert.ok(
    errors.some((error) =>
      error.includes(
        'graphql:scripts/local-migration/restart-smoke.mjs:query:HostedBaselinePublic:["__typename"]',
      ),
    ),
  );
});

test("packaging smoke has exact derived consumers, references, sinks, and curated probes", async () => {
  const repositoryRoot = path.resolve(import.meta.dirname, "../..");
  const packagingPath = "scripts/local-migration/packaging-smoke.mjs";
  const packagingSource = await readFile(
    path.join(repositoryRoot, packagingPath),
    "utf8",
  );
  const expectedConsumers = [
    {
      path: packagingPath,
      kind: "mutation",
      operation: "PackagingSmokeWrite",
      rootFields: ["setPreference"],
    },
    {
      path: packagingPath,
      kind: "query",
      operation: "PackagingSmokeCatalog",
      rootFields: ["activePreferences", "preferenceCatalog"],
    },
    {
      path: packagingPath,
      kind: "query",
      operation: "PackagingSmokeCors",
      rootFields: ["__typename"],
    },
    {
      path: packagingPath,
      kind: "query",
      operation: "PackagingSmokePrincipal",
      rootFields: ["me"],
    },
  ];
  assert.deepEqual(
    collectGraphqlOperations(new Map([[packagingPath, packagingSource]])),
    expectedConsumers,
  );

  const registry = JSON.parse(
    await readFile(
      path.join(
        repositoryRoot,
        "docs/current/local-migration-contract-baseline.json",
      ),
      "utf8",
    ),
  );
  assert.deepEqual(
    registry.consumers.filter(({ path: sourcePath }) => sourcePath === packagingPath),
    expectedConsumers,
  );
  assert.deepEqual(
    registry.contractReferences
      .filter(({ path: sourcePath }) => sourcePath === packagingPath)
      .map(({ reference }) => reference)
      .sort(),
    [
      "/.well-known/oauth-protected-resource/mcp",
      "/api/chat",
      "/api/debug/token",
      "/graphql",
      "/health",
      "/mcp",
      "schema://graphql",
    ].sort(),
  );

  const outbound = registry.outboundCalls.find(
    ({ id }) => id === "migration-gate-loopback-probes",
  );
  assert.deepEqual(outbound.ownerSteps, ["01", "02", "03"]);
  const packagingOutbound = outbound.sources.find(
    ({ path: sourcePath }) => sourcePath === packagingPath,
  );
  assert.ok(packagingOutbound);
  assert.deepEqual(
    validateOutboundSourceFingerprints(
      [{ ...outbound, sources: [packagingOutbound] }],
      new Map([[packagingPath, packagingSource]]),
    ),
    [],
  );
  const liveSinks = collectOutboundSinkInventory(
    new Map([[packagingPath, packagingSource]]),
  );
  assert.deepEqual(liveSinks, [
    {
      path: packagingPath,
      sinks: {
        "exec-file": 2,
        fetch: 3,
        "http-client": 1,
        "net-connect": 2,
        spawn: 2,
        "subprocess-wrapper": 8,
      },
    },
  ]);
  assert.deepEqual(
    registry.outboundSinkInventory.find(
      ({ path: sourcePath }) => sourcePath === packagingPath,
    ),
    liveSinks[0],
  );

  const curated = registry.fingerprintConsumers.filter(({ id }) =>
    id.startsWith("packaging-smoke-"),
  );
  assert.deepEqual(
    curated.map(({ id }) => id),
    [
      "packaging-smoke-web-chat-support-route",
      "packaging-smoke-web-debug-token-support-route",
      "packaging-smoke-mcp-graphql-schema-resource",
    ],
  );
  const [httpContract, mcpContract] = await Promise.all(
    [registry.contracts.http.fixture, registry.contracts.mcp.fixture].map(
      async (fixture) =>
        JSON.parse(await readFile(path.join(repositoryRoot, fixture), "utf8")),
    ),
  );
  assert.deepEqual(
    validateFingerprintConsumers(
      curated,
      new Map([[packagingPath, packagingSource]]),
      { httpContract, mcpContract },
    ),
    [],
  );
});

test("normalizeCatalog pins all semantic fields while separating copy", () => {
  const normalized = normalizeCatalog({
    "profile.email": {
      category: "profile",
      displayName: "Contact Email",
      description: "Where to contact the user.",
      valueType: "string",
      scope: "global",
      isSensitive: true,
    },
    "system.response_tone": {
      category: "system",
      description: "Tone.",
      valueType: "enum",
      scope: "global",
      options: ["brief", "warm"],
    },
  });

  assert.deepEqual(normalized.semantic["profile.email"], {
    valueType: "string",
    scope: "global",
    isSensitive: true,
    options: null,
    default: null,
    validation: null,
  });
  assert.equal(normalized.semantic["system.response_tone"].isSensitive, false);
  assert.deepEqual(normalized.copy["profile.email"], {
    category: "profile",
    displayName: "Contact Email",
    description: "Where to contact the user.",
  });
});

test("validateBaselineDocument rejects unowned defers and duplicate ids", () => {
  const errors = validateBaselineDocument({
    version: 1,
    capabilities: [
      {
        id: "same",
        label: "First capability",
        evidence: ["apps/example/first.ts"],
        disposition: "RETAIN",
        ownerSteps: ["04"],
      },
      {
        id: "same",
        label: "Second capability",
        evidence: ["apps/example/second.ts"],
        disposition: "DEFER",
        ownerSteps: [],
      },
    ],
    contracts: {},
    outboundCalls: [],
    consumers: [],
  });

  assert.ok(errors.some((error) => error.includes("duplicate capability id")));
  assert.ok(errors.some((error) => error.includes("DEFER")));
  assert.ok(
    errors.some((error) => error.includes("missing package classification")),
  );
});

test("registry mode declarations are versioned, exclusive, and unique", () => {
  const minimal = {
    capabilities: [],
    contracts: {},
    outboundCalls: [],
    packages: [],
    consumers: [],
    dynamicConsumers: [],
    fingerprintConsumers: [],
    externalClients: [],
    contractReferences: [],
    outboundSinkInventory: [],
    migrationRecords: [],
  };
  assert.ok(
    validateBaselineDocument({
      ...minimal,
      version: 1,
      supportedMode: "hosted-baseline",
      supportedModes: ["hosted-baseline"],
    }).some((error) => error.includes("version-one registry must not use supportedModes")),
  );
  assert.ok(
    validateBaselineDocument({
      ...minimal,
      version: 2,
      supportedMode: "hosted-baseline",
      supportedModes: ["hosted-baseline", "local-identity-preview"],
    }).some((error) => error.includes("not supportedMode")),
  );
  assert.ok(
    validateBaselineDocument({
      ...minimal,
      version: 2,
      supportedModes: ["hosted-baseline", "hosted-baseline"],
    }).some((error) => error.includes("unique strings")),
  );
});

test("capability classifications require a name, label, and strongest evidence", () => {
  const errors = validateBaselineDocument({
    version: 1,
    capabilities: [
      {
        id: "",
        label: "",
        evidence: [],
        disposition: "RETAIN",
        contractClass: "preserved-contract",
        ownerSteps: ["04"],
      },
    ],
    contracts: {},
    outboundCalls: [],
    packages: [],
    consumers: [],
    dynamicConsumers: [],
    fingerprintConsumers: [],
    migrationRecords: [],
  });
  assert.ok(errors.some((error) => error.includes("missing id")));
  assert.ok(errors.some((error) => error.includes("missing label")));
  assert.ok(errors.some((error) => error.includes("evidence path")));
});

test("version-one bootstrap still requires unchanged base GraphQL and catalog producers", () => {
  const sdl = "type Query { ok: Boolean! }";
  const catalog = {
    "profile.email": {
      category: "profile",
      description: "Email",
      valueType: "string",
      scope: "global",
      isSensitive: true,
    },
  };
  assert.deepEqual(
    validateBootstrapCompatibility({
      currentVersion: 1,
      baseRegistryPresent: false,
      baseSdl: sdl,
      currentSdl: sdl,
      baseCatalog: catalog,
      currentCatalog: catalog,
    }),
    [],
  );
  assert.ok(
    validateBootstrapCompatibility({
      currentVersion: 2,
      baseRegistryPresent: false,
      baseSdl: sdl,
      currentSdl: sdl,
      baseCatalog: catalog,
      currentCatalog: catalog,
    }).some((error) => error.includes("version 1")),
  );
  assert.ok(
    validateBootstrapCompatibility({
      currentVersion: 1,
      baseRegistryPresent: false,
      baseSdl: sdl,
      currentSdl: "type Query { changed: Boolean! }",
      baseCatalog: catalog,
      currentCatalog: catalog,
    }).some((error) => error.includes("GraphQL producer")),
  );
});

function reviewedRecord({
  contract,
  previous,
  current,
  changes,
  consumerPaths = [],
  consumerIds = [],
  consumerEvidence,
}) {
  return {
    id: `${contract}-transition`,
    contract,
    fromFingerprint: contractFingerprint(previous),
    toFingerprint: contractFingerprint(current),
    breakingChanges: changes,
    additiveReplacement: {
      description: "Introduce and validate the additive replacement before removal.",
      evidencePath: "apps/example/replacement.test.ts",
    },
    compatibilityWindow: "two tagged releases",
    migrationGuidance: "Migrate every named consumer to the additive replacement first.",
    rollback: "Re-enable the prior adapter and rerun the aggregate gate.",
    consumerEvidence:
      consumerEvidence ??
      consumerPaths.map((consumerPath, index) => ({
        path: consumerPath,
        consumerId: consumerIds[index] ?? `fp:${consumerPath}`,
        outcome: "migrated",
      })),
    approval: "reviewed",
  };
}

test("contract drift requires an exact one-use reviewed migration transition", () => {
  const base = {
    version: 1,
    migrationRecords: [],
    contracts: { http: {}, mcp: {} },
  };
  const previousHttp = { route: "/old" };
  const currentHttp = { route: "/new" };
  const previousMcp = { tools: ["one", "two"] };
  const currentMcp = { tools: ["one"] };
  const current = {
    ...base,
    fingerprintConsumers: [
      {
        id: "http-client",
        contract: "http",
        kind: "http-route",
        path: "apps/example/http-client.ts",
        method: "POST",
        route: "/new",
        fingerprints: ["/new"],
      },
      {
        id: "mcp-client",
        contract: "mcp",
        kind: "mcp-transport",
        path: "apps/example/mcp-client.ts",
        method: "POST",
        route: "/mcp",
        fingerprints: ["/mcp"],
      },
    ],
    migrationRecords: [],
  };
  const errors = validateContractEvolution({
    previousRegistry: base,
    currentRegistry: current,
    previousHttp,
    currentHttp,
    previousMcp,
    currentMcp,
  });
  assert.ok(errors.some((error) => error.includes("HTTP") && error.includes("migration record")));
  assert.ok(errors.some((error) => error.includes("MCP") && error.includes("migration record")));

  const httpChanges = diffHttpContracts(previousHttp, currentHttp).breaking;
  const mcpChanges = diffMcpContracts(previousMcp, currentMcp).breaking;
  current.migrationRecords = [
    reviewedRecord({
      contract: "http",
      previous: previousHttp,
      current: currentHttp,
      changes: httpChanges,
      consumerPaths: ["apps/example/http-client.ts"],
      consumerIds: ["fp:http-client"],
    }),
    reviewedRecord({
      contract: "mcp",
      previous: previousMcp,
      current: currentMcp,
      changes: mcpChanges,
      consumerPaths: ["apps/example/mcp-client.ts"],
      consumerIds: ["fp:mcp-client"],
    }),
  ];
  assert.deepEqual(
    validateContractEvolution({
      previousRegistry: base,
      currentRegistry: current,
      previousHttp,
      currentHttp,
      previousMcp,
      currentMcp,
    }),
    [],
  );

  const laterHttp = { route: "/later" };
  assert.ok(
    validateContractEvolution({
      previousRegistry: current,
      currentRegistry: current,
      previousHttp: currentHttp,
      currentHttp: laterHttp,
      previousMcp: currentMcp,
      currentMcp,
    }).some((error) => error.includes("HTTP") && error.includes("exact transition")),
    "a stale reviewed record must not authorize a later transition",
  );
});

test("oneOf GraphQL changes require exact evidence for consumers with distinct root selections", () => {
  const previousGraphql = buildGraphqlSignature(`
    input Selector { id: ID name: String }
    type Query { one(selector: Selector): String two(selector: Selector): String }
  `);
  const currentGraphql = buildGraphqlSignature(`
    input Selector @oneOf { id: ID name: String }
    type Query { one(selector: Selector): String two(selector: Selector): String }
  `);
  const changes = diffGraphqlSignatures(
    previousGraphql,
    currentGraphql,
  ).breaking;
  const registry = {
    version: 1,
    capabilities: [],
    packages: [],
    outboundCalls: [],
    externalClients: [],
    consumers: [
      {
        path: "clients.ts",
        kind: "query",
        operation: "Shared",
        rootFields: ["one"],
      },
      {
        path: "clients.ts",
        kind: "query",
        operation: "Shared",
        rootFields: ["two"],
      },
    ],
    dynamicConsumers: [],
    fingerprintConsumers: [],
    contractReferences: [],
    migrationRecords: [],
  };
  const record = (consumerEvidence) =>
    reviewedRecord({
      contract: "graphql",
      previous: previousGraphql,
      current: currentGraphql,
      changes,
      consumerEvidence,
    });
  const first = {
    path: "clients.ts",
    consumerId: 'graphql:clients.ts:query:Shared:["one"]',
    outcome: "migrated",
  };
  const second = {
    path: "clients.ts",
    consumerId: 'graphql:clients.ts:query:Shared:["two"]',
    outcome: "migrated",
  };

  const incompleteEvidence = validateContractEvolution({
    previousRegistry: registry,
    currentRegistry: { ...registry, migrationRecords: [record([first])] },
    previousGraphql,
    currentGraphql,
    graphqlBreaking: changes,
  });
  assert.ok(
    incompleteEvidence.some((error) =>
      error.includes("affected-consumer evidence"),
    ),
  );
  assert.ok(
    incompleteEvidence.some((error) =>
      error.includes('graphql:clients.ts:query:Shared:["two"] @ clients.ts'),
    ),
  );
  assert.deepEqual(
    validateContractEvolution({
      previousRegistry: registry,
      currentRegistry: {
        ...registry,
        migrationRecords: [record([first, second])],
      },
      previousGraphql,
      currentGraphql,
      graphqlBreaking: changes,
    }),
    [],
  );
});

test("HTTP and MCP evolution allows additions while protecting removals and required inputs", () => {
  const previousHttp = {
    routes: {
      search: {
        method: "POST",
        path: "/search",
        request: { required: [], optional: ["query"] },
      },
    },
    supportRoutes: [],
  };
  const additiveHttp = structuredClone(previousHttp);
  additiveHttp.routes.search.request.optional.push("limit");
  additiveHttp.routes.health = { method: "GET", path: "/health" };
  additiveHttp.supportRoutes.push({
    method: "GET",
    path: "/support",
    class: "observed-not-promised",
  });
  assert.deepEqual(diffHttpContracts(previousHttp, additiveHttp).breaking, []);

  const requiredHttp = structuredClone(previousHttp);
  requiredHttp.routes.search.request.required.push("accountId");
  assert.ok(
    diffHttpContracts(previousHttp, requiredHttp).breaking.some((change) =>
      change.includes("added required input"),
    ),
  );
  for (const mutate of [
    (contract) => {
      contract.routes.search.allowedMimeTypes = ["text/plain"];
    },
    (contract) => {
      contract.routes.search.minFileSizeBytes = 1;
    },
    (contract) => {
      contract.routes.search.request.minLength = 1;
    },
  ]) {
    const constrainedHttp = structuredClone(previousHttp);
    mutate(constrainedHttp);
    assert.ok(
      diffHttpContracts(previousHttp, constrainedHttp).breaking.length > 0,
    );
  }
  const removedHttp = structuredClone(previousHttp);
  delete removedHttp.routes.search;
  assert.ok(
    diffHttpContracts(previousHttp, removedHttp).breaking.some((change) =>
      change.includes("removed $.routes.search"),
    ),
  );

  const previousMcp = {
    tools: [
      {
        descriptor: {
          name: "search",
          inputSchema: {
            type: "object",
            properties: { query: { type: "string" } },
          },
        },
        requiredAccess: { resource: "preferences", action: "read" },
      },
    ],
  };
  const additiveMcp = structuredClone(previousMcp);
  additiveMcp.tools[0].descriptor.inputSchema.properties.limit = {
    type: "integer",
  };
  additiveMcp.tools.push({
    descriptor: {
      name: "list",
      inputSchema: { type: "object", properties: {} },
    },
    requiredAccess: { resource: "preferences", action: "read" },
  });
  assert.deepEqual(diffMcpContracts(previousMcp, additiveMcp).breaking, []);

  const requiredMcp = structuredClone(previousMcp);
  requiredMcp.tools[0].descriptor.inputSchema.required = ["accountId"];
  assert.ok(
    diffMcpContracts(previousMcp, requiredMcp).breaking.some((change) =>
      change.includes("inputSchema.required"),
    ),
  );
  const removedMcp = { tools: [] };
  assert.ok(
    diffMcpContracts(previousMcp, removedMcp).breaking.some((change) =>
      change.includes("removed $.tools"),
    ),
  );

  const previousHttpOutput = {
    routes: {
      upload: {
        method: "POST",
        path: "/upload",
        success: { statuses: ["ok"] },
      },
    },
  };
  const widenedHttpOutput = structuredClone(previousHttpOutput);
  widenedHttpOutput.routes.upload.success.statuses.push("partial");
  assert.ok(
    diffHttpContracts(previousHttpOutput, widenedHttpOutput).breaking.some(
      (change) => change.includes("statuses") && change.includes("partial"),
    ),
  );
  const addedHttpError = structuredClone(previousHttpOutput);
  addedHttpError.routes.upload.errors = {
    rateLimit: { status: 429, body: { error: "too_many_requests" } },
  };
  assert.ok(
    diffHttpContracts(previousHttpOutput, addedHttpError).breaking.some(
      (change) => change.includes("errors"),
    ),
  );

  const previousMcpOutput = {
    tools: [
      {
        descriptor: {
          name: "search",
          inputSchema: { type: "object", properties: {} },
          outputSchema: {
            type: "object",
            properties: { value: { anyOf: [{ type: "string" }] } },
          },
        },
      },
    ],
  };
  const widenedMcpOutput = structuredClone(previousMcpOutput);
  widenedMcpOutput.tools[0].descriptor.outputSchema.properties.value.anyOf.push(
    { type: "number" },
  );
  assert.ok(
    diffMcpContracts(previousMcpOutput, widenedMcpOutput).breaking.some(
      (change) => change.includes("outputSchema") && change.includes("number"),
    ),
  );

  const constrainedMcpInput = structuredClone(previousMcp);
  constrainedMcpInput.tools[0].descriptor.inputSchema.allOf = [];
  const tightenedMcpInput = structuredClone(constrainedMcpInput);
  tightenedMcpInput.tools[0].descriptor.inputSchema.allOf.push({
    required: ["query"],
  });
  assert.ok(
    diffMcpContracts(constrainedMcpInput, tightenedMcpInput).breaking.some(
      (change) => change.includes("inputSchema.allOf"),
    ),
  );
  const nestedRequiredBefore = structuredClone(previousMcp);
  nestedRequiredBefore.tools[0].descriptor.inputSchema.properties.filter = {
    type: "object",
    properties: { term: { type: "string" } },
    required: [],
  };
  const nestedRequiredAfter = structuredClone(nestedRequiredBefore);
  nestedRequiredAfter.tools[0].descriptor.inputSchema.properties.filter.required.push(
    "term",
  );
  assert.ok(
    diffMcpContracts(nestedRequiredBefore, nestedRequiredAfter).breaking.some(
      (change) => change.includes("added required input") && change.includes("term"),
    ),
  );
  const oneOfBefore = structuredClone(previousMcp);
  oneOfBefore.tools[0].descriptor.inputSchema.oneOf = [
    { required: ["query"] },
  ];
  const oneOfAfter = structuredClone(oneOfBefore);
  oneOfAfter.tools[0].descriptor.inputSchema.oneOf.push({
    properties: { query: { minLength: 1 } },
  });
  assert.ok(
    diffMcpContracts(oneOfBefore, oneOfAfter).breaking.some((change) =>
      change.includes("inputSchema.oneOf"),
    ),
  );
  const prefixItemsBefore = structuredClone(previousMcp);
  prefixItemsBefore.tools[0].descriptor.inputSchema.properties.query = {
    type: "array",
    prefixItems: [{ type: "string" }],
  };
  const prefixItemsAfter = structuredClone(prefixItemsBefore);
  prefixItemsAfter.tools[0].descriptor.inputSchema.properties.query.prefixItems.push(
    { type: "integer" },
  );
  assert.ok(
    diffMcpContracts(prefixItemsBefore, prefixItemsAfter).breaking.some(
      (change) => change.includes("inputSchema") && change.includes("prefixItems"),
    ),
  );
  const inputConstBefore = structuredClone(previousMcp);
  inputConstBefore.tools[0].descriptor.inputSchema.properties.query = {
    const: ["one"],
  };
  const inputConstAfter = structuredClone(inputConstBefore);
  inputConstAfter.tools[0].descriptor.inputSchema.properties.query.const.push(
    "two",
  );
  assert.ok(
    diffMcpContracts(inputConstBefore, inputConstAfter).breaking.some(
      (change) => change.includes("inputSchema") && change.includes("const"),
    ),
  );
  const outputConstBefore = structuredClone(previousMcpOutput);
  outputConstBefore.tools[0].descriptor.outputSchema.properties.value = {
    const: ["one"],
  };
  const outputConstAfter = structuredClone(outputConstBefore);
  outputConstAfter.tools[0].descriptor.outputSchema.properties.value.const.push(
    "two",
  );
  assert.ok(
    diffMcpContracts(outputConstBefore, outputConstAfter).breaking.some(
      (change) => change.includes("outputSchema") && change.includes("const"),
    ),
  );

  const previousMcpClients = {
    clients: [
      {
        key: "fallback",
        capabilities: ["preferences:read"],
        targetRules: [],
        oauth: { redirectUris: ["https://client.invalid/callback"] },
      },
    ],
    visibility: {
      fallback: {
        tools: ["listPreferenceSlugs"],
        resources: ["schema://graphql"],
      },
    },
  };
  for (const effect of ["allow", "deny"]) {
    const changedMcpClients = structuredClone(previousMcpClients);
    changedMcpClients.clients[0].targetRules.push({
      effect,
      capability: "preferences:read",
      matcher: { namespace: "profile" },
    });
    assert.ok(
      diffMcpContracts(previousMcpClients, changedMcpClients).breaking.some(
        (change) => change.includes("targetRules") && change.includes(effect),
      ),
    );
  }
  for (const mutate of [
    (contract) => {
      contract.clients[0].capabilities.push("preferences:write");
    },
    (contract) => {
      contract.clients[0].oauth.redirectUris.push(
        "https://attacker.invalid/callback",
      );
    },
    (contract) => {
      contract.clients[0].oauth.postLogoutRedirectUris = [
        "https://attacker.invalid/logout",
      ];
    },
    (contract) => {
      contract.visibility.fallback.tools.push("mutatePreferences");
    },
    (contract) => {
      contract.visibility.fallback.resources.push("secret://preferences");
    },
  ]) {
    const expandedAuthority = structuredClone(previousMcpClients);
    mutate(expandedAuthority);
    assert.ok(
      diffMcpContracts(previousMcpClients, expandedAuthority).breaking.length > 0,
    );
  }
  const addedPrivilegedClient = structuredClone(previousMcpClients);
  addedPrivilegedClient.clients.push({
    key: "privileged",
    capabilities: ["preferences:write"],
    targetRules: [],
  });
  assert.ok(
    diffMcpContracts(previousMcpClients, addedPrivilegedClient).breaking.some(
      (change) => change.includes("clients") && change.includes("privileged"),
    ),
  );
  const addedVisibilityBucket = structuredClone(previousMcpClients);
  addedVisibilityBucket.visibility.privileged = {
    tools: ["mutatePreferences"],
    resources: [],
  };
  assert.ok(
    diffMcpContracts(previousMcpClients, addedVisibilityBucket).breaking.some(
      (change) => change.includes("visibility.privileged"),
    ),
  );

  assert.deepEqual(
    diffHttpContracts(
      { ...previousHttp, runtimeEvidence: [{ cases: ["old test"] }] },
      { ...previousHttp, runtimeEvidence: [{ cases: ["renamed test"] }] },
    ).breaking,
    [],
  );
  assert.deepEqual(
    diffMcpContracts(
      {
        ...previousMcp,
        configurationShapedNonCapabilities: ["MCP_HTTP_PATH"],
      },
      {
        ...previousMcp,
        configurationShapedNonCapabilities: ["MCP_STDIO_ENABLED=true"],
      },
    ).breaking,
    [],
  );

  const registry = {
    version: 1,
    capabilities: [],
    packages: [],
    outboundCalls: [],
    fingerprintConsumers: [],
    migrationRecords: [],
  };
  assert.deepEqual(
    validateContractEvolution({
      previousRegistry: registry,
      currentRegistry: registry,
      previousHttp,
      currentHttp: additiveHttp,
      previousMcp,
      currentMcp: additiveMcp,
    }),
    [],
  );
});

test("MCP OAuth, DCR, and challenge security metadata fails closed", async () => {
  const fixture = JSON.parse(
    await readFile(
      new URL(
        "../../apps/backend/test/contracts/fixtures/mcp-contract-baseline.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  for (const mutate of [
    (contract) => {
      contract.oauth.authorizationServer.code_challenge_methods_supported.push(
        "plain",
      );
    },
    (contract) => {
      contract.oauth.authorizationServer.grant_types_supported.push("implicit");
    },
    (contract) => {
      contract.oauth.authorizationServer.scopes_supported.push(
        "preferences:admin",
      );
    },
    (contract) => {
      contract.dcr.cases.claude.redirect_uris.push(
        "https://attacker.invalid/callback",
      );
    },
    (contract) => {
      contract.challenges.optionalToken = {
        status: 200,
        body: { result: "anonymous" },
      };
    },
  ]) {
    const changed = structuredClone(fixture);
    mutate(changed);
    assert.ok(diffMcpContracts(fixture, changed).breaking.length > 0);
  }
});

test("tool authority, task execution, and upload media expansion fail closed", async () => {
  const [mcpFixture, httpFixture] = await Promise.all(
    [
      "../../apps/backend/test/contracts/fixtures/mcp-contract-baseline.json",
      "../../apps/backend/test/contracts/fixtures/http-contracts.v1.json",
    ].map(async (fixturePath) =>
      JSON.parse(await readFile(new URL(fixturePath, import.meta.url), "utf8")),
    ),
  );

  const accessAlternative = structuredClone(mcpFixture);
  accessAlternative.tools
    .find(({ descriptor }) => descriptor.name === "mutatePreferences")
    .requiredAccess.push({ resource: "preferences", action: "read" });
  assert.ok(
    diffMcpContracts(mcpFixture, accessAlternative).breaking.some((change) =>
      change.includes("requiredAccess"),
    ),
  );

  const nestedAccessKey = structuredClone(mcpFixture);
  nestedAccessKey.tools
    .find(({ descriptor }) => descriptor.name === "listPreferenceSlugs")
    .requiredAccess.scope = "global";
  assert.ok(
    diffMcpContracts(mcpFixture, nestedAccessKey).breaking.some((change) =>
      change.includes("requiredAccess.scope"),
    ),
  );

  const requiredTaskExecution = structuredClone(mcpFixture);
  requiredTaskExecution.tools.find(
    ({ descriptor }) => descriptor.name === "listPreferenceSlugs",
  ).descriptor.execution = { taskSupport: "required" };
  assert.ok(
    diffMcpContracts(mcpFixture, requiredTaskExecution).breaking.some((change) =>
      change.includes("descriptor.execution"),
    ),
  );

  const expandedUploadMedia = structuredClone(httpFixture);
  expandedUploadMedia.routes.documentAnalysis.allowedMimeTypes.push(
    "application/x-executable",
  );
  assert.ok(
    diffHttpContracts(httpFixture, expandedUploadMedia).breaking.some(
      (change) => change.includes("allowedMimeTypes"),
    ),
  );
});

test("breaking migration evidence covers consumers from both sides of the transition", () => {
  const previousHttp = { route: "/old" };
  const currentHttp = { route: "/new" };
  const changes = diffHttpContracts(previousHttp, currentHttp).breaking;
  const previousRegistry = {
    version: 1,
    capabilities: [],
    packages: [],
    outboundCalls: [],
    fingerprintConsumers: [
      {
        id: "removed-http-client",
        contract: "http",
        path: "apps/removed/old-client.ts",
      },
    ],
    migrationRecords: [],
  };
  const currentRegistry = {
    ...previousRegistry,
    fingerprintConsumers: [
      {
        id: "current-http-client",
        contract: "http",
        path: "apps/current/new-client.ts",
      },
    ],
    migrationRecords: [
      reviewedRecord({
        contract: "http",
        previous: previousHttp,
        current: currentHttp,
        changes,
        consumerPaths: ["apps/current/new-client.ts"],
        consumerIds: ["fp:current-http-client"],
      }),
    ],
  };

  const incompleteEvidence = validateContractEvolution({
    previousRegistry,
    currentRegistry,
    previousHttp,
    currentHttp,
    previousMcp: {},
    currentMcp: {},
  });
  assert.ok(
    incompleteEvidence.some((error) =>
      error.includes("affected-consumer evidence"),
    ),
  );
  assert.ok(
    incompleteEvidence.some((error) =>
      error.includes(
        "fp:removed-http-client @ apps/removed/old-client.ts",
      ),
    ),
  );

  currentRegistry.migrationRecords = [
    reviewedRecord({
      contract: "http",
      previous: previousHttp,
      current: currentHttp,
      changes,
      consumerPaths: [
        "apps/removed/old-client.ts",
        "apps/current/new-client.ts",
      ],
      consumerIds: [
        "fp:removed-http-client",
        "fp:current-http-client",
      ],
    }),
  ];
  assert.deepEqual(
    validateContractEvolution({
      previousRegistry,
      currentRegistry,
      previousHttp,
      currentHttp,
      previousMcp: {},
      currentMcp: {},
    }),
    [],
  );
});

test("catalog and protected registry evolution cannot bypass transition review", () => {
  const previousCatalog = normalizeCatalog({
    one: { valueType: "string", scope: "global", description: "one" },
  });
  const currentCatalog = normalizeCatalog({
    one: { valueType: "number", scope: "global", description: "one" },
  });
  const previousRegistry = {
    version: 1,
    capabilities: [{ id: "keep", disposition: "RETAIN" }],
    packages: [],
    outboundCalls: [],
    externalClients: [],
    consumers: [],
    dynamicConsumers: [],
    fingerprintConsumers: [],
    observedNotPromised: [],
    contracts: {},
    migrationRecords: [],
  };
  const currentRegistry = {
    ...previousRegistry,
    version: 2,
    capabilities: [],
  };
  const errors = validateContractEvolution({
    previousRegistry,
    currentRegistry,
    previousCatalog,
    currentCatalog,
    previousHttp: {},
    currentHttp: {},
    previousMcp: {},
    currentMcp: {},
  });
  assert.ok(errors.some((error) => error.includes("catalog") && error.includes("migration record")));
  assert.ok(errors.some((error) => error.includes("registry") && error.includes("migration record")));
});

test("protected external inventory permits additions but requires reviewed evolution for removal or change", () => {
  const previousRegistry = {
    version: 1,
    capabilities: [],
    packages: [],
    outboundCalls: [],
    fingerprintConsumers: [
      {
        id: "external-http",
        contract: "http",
        kind: "external-unknown",
        path: "docs/external.md",
        clientClass: "external-unknown",
        access: "public-health",
        surfaces: ["GET /health"],
        affectedContracts: ["http", "registry"],
      },
      {
        id: "known-mcp-auth",
        contract: "mcp",
        kind: "mcp-auth",
        path: "docs/external.md",
        clientClass: "claude",
        access: "all-tools-and-schema",
        affectedContracts: ["mcp", "graphql", "catalog", "registry"],
      },
    ],
    externalClients: [
      { bucket: "claude", callbacks: ["https://two.invalid", "https://one.invalid"] },
    ],
    migrationRecords: [],
  };
  const reorderedRegistry = structuredClone(previousRegistry);
  reorderedRegistry.externalClients[0].callbacks.reverse();
  assert.deepEqual(
    protectedRegistrySnapshot(reorderedRegistry),
    protectedRegistrySnapshot(previousRegistry),
  );

  const additiveRegistry = structuredClone(previousRegistry);
  additiveRegistry.fingerprintConsumers.push({
    id: "external-mcp",
    contract: "mcp",
    kind: "external-unknown",
    path: "docs/external.md",
    clientClass: "external-unknown",
    access: "zero-tools-zero-resources",
    surfaces: ["POST /mcp"],
    affectedContracts: ["mcp", "registry"],
  });
  additiveRegistry.externalClients.push({ bucket: "unknown", callbacks: [] });
  additiveRegistry.externalClients[0].callbacks.push("https://three.invalid");
  assert.deepEqual(
    validateContractEvolution({
      previousRegistry,
      currentRegistry: additiveRegistry,
      previousHttp: {},
      currentHttp: {},
      previousMcp: {},
      currentMcp: {},
    }),
    [],
  );

  const removedRegistry = structuredClone(previousRegistry);
  removedRegistry.fingerprintConsumers = [];
  assert.ok(
    validateContractEvolution({
      previousRegistry,
      currentRegistry: removedRegistry,
      previousHttp: {},
      currentHttp: {},
      previousMcp: {},
      currentMcp: {},
    }).some((error) => error.includes("protected registry changed")),
  );

  const removedKnownMcpRegistry = structuredClone(previousRegistry);
  removedKnownMcpRegistry.fingerprintConsumers =
    removedKnownMcpRegistry.fingerprintConsumers.filter(
      ({ id }) => id !== "known-mcp-auth",
    );
  assert.ok(
    validateContractEvolution({
      previousRegistry,
      currentRegistry: removedKnownMcpRegistry,
      previousHttp: {},
      currentHttp: {},
      previousMcp: {},
      currentMcp: {},
    }).some((error) => error.includes("protected registry changed")),
  );

  const changedRegistry = structuredClone(previousRegistry);
  changedRegistry.version = 2;
  changedRegistry.externalClients[0].callbacks = ["https://replacement.invalid"];
  assert.ok(
    validateContractEvolution({
      previousRegistry,
      currentRegistry: changedRegistry,
      previousHttp: {},
      currentHttp: {},
      previousMcp: {},
      currentMcp: {},
    }).some(
      (error) => error.includes("registry") && error.includes("migration record"),
    ),
  );
});

test("external migration evidence identifies every unknown consumer class sharing a path", () => {
  const previousHttp = { routes: { health: { method: "GET", path: "/health" } } };
  const currentHttp = { routes: {} };
  const changes = diffHttpContracts(previousHttp, currentHttp).breaking;
  const registry = {
    version: 1,
    capabilities: [],
    packages: [],
    outboundCalls: [],
    externalClients: [],
    fingerprintConsumers: [
      {
        id: "external-graphql",
        contract: "http",
        kind: "external-unknown",
        path: "docs/external.md",
        clientClass: "external-unknown",
        access: "graphql-schema-dependent",
        affectedContracts: ["http", "graphql", "catalog", "registry"],
      },
      {
        id: "external-health-monitor",
        contract: "http",
        kind: "external-unknown",
        path: "docs/external.md",
        clientClass: "external-monitor",
        access: "public-health",
        surfaces: ["GET /health"],
        affectedContracts: ["http", "registry"],
      },
    ],
    migrationRecords: [],
  };
  const record = (consumerEvidence) =>
    reviewedRecord({
      contract: "http",
      previous: previousHttp,
      current: currentHttp,
      changes,
      consumerEvidence,
    });

  assert.ok(
    validateContractEvolution({
      previousRegistry: registry,
      currentRegistry: {
        ...registry,
        migrationRecords: [
          record([
            {
              path: "docs/external.md",
              consumerId: "fp:external-graphql",
              outcome: "verified-unaffected",
            },
          ]),
        ],
      },
      previousHttp,
      currentHttp,
      previousMcp: {},
      currentMcp: {},
    }).some((error) => error.includes("affected-consumer evidence")),
  );

  assert.deepEqual(
    validateContractEvolution({
      previousRegistry: registry,
      currentRegistry: {
        ...registry,
        migrationRecords: [
          record([
            {
              path: "docs/external.md",
              consumerId: "fp:external-graphql",
              outcome: "verified-unaffected",
            },
            {
              path: "docs/external.md",
              consumerId: "fp:external-health-monitor",
              outcome: "migrated",
            },
          ]),
        ],
      },
      previousHttp,
      currentHttp,
      previousMcp: {},
      currentMcp: {},
    }),
    [],
  );
});

test("catalog evolution distinguishes additive definitions and copy-only edits from semantic breaks", () => {
  const previousCatalog = normalizeCatalog({
    one: {
      valueType: "string",
      scope: "global",
      description: "Original copy",
    },
  });
  const additiveCatalog = normalizeCatalog({
    one: {
      valueType: "string",
      scope: "global",
      description: "Revised copy",
    },
    two: {
      valueType: "number",
      scope: "global",
      description: "New preference",
    },
  });
  const breakingCatalog = normalizeCatalog({
    one: {
      valueType: "number",
      scope: "global",
      description: "Revised copy",
    },
  });

  assert.deepEqual(diffCatalogContracts(previousCatalog, additiveCatalog), {
    breaking: [],
    additive: ["added catalog semantic two"],
    copyOnly: ["changed catalog copy one.description from \"Original copy\" to \"Revised copy\""],
  });
  assert.ok(
    diffCatalogContracts(previousCatalog, breakingCatalog).breaking.some(
      (change) => change.includes("one.valueType"),
    ),
  );

  const registry = {
    version: 1,
    capabilities: [],
    packages: [],
    outboundCalls: [],
    migrationRecords: [],
  };
  assert.deepEqual(
    validateContractEvolution({
      previousRegistry: registry,
      currentRegistry: registry,
      previousCatalog,
      currentCatalog: additiveCatalog,
      previousHttp: {},
      currentHttp: {},
      previousMcp: {},
      currentMcp: {},
    }),
    [],
  );
});

test("catalog migration evidence covers GraphQL and MCP catalog consumers", () => {
  const previousCatalog = normalizeCatalog({
    one: { valueType: "string", scope: "global", description: "one" },
  });
  const currentCatalog = normalizeCatalog({
    one: { valueType: "number", scope: "global", description: "one" },
  });
  const registry = {
    version: 1,
    capabilities: [],
    packages: [],
    outboundCalls: [],
    consumers: [
      {
        path: "apps/web/catalog.ts",
        kind: "query",
        operation: "CatalogQuery",
        rootFields: ["preferenceCatalog"],
      },
    ],
    dynamicConsumers: [],
    contractReferences: [
      {
        path: "examples/eval-harbor/modes/cr-mcp.md",
        contract: "mcp",
        kind: "tool",
        reference: "listPreferenceSlugs",
      },
    ],
    fingerprintConsumers: [
      {
        id: "restart-catalog-reader",
        path: "scripts/local-migration/restart-smoke.mjs",
        contract: "mcp",
        tool: "listPreferenceSlugs",
      },
    ],
    migrationRecords: [],
  };
  const changes = diffCatalogContracts(previousCatalog, currentCatalog).breaking;
  const withRecord = (consumerEvidence) => ({
    ...registry,
    migrationRecords: [
      reviewedRecord({
        contract: "catalog",
        previous: previousCatalog,
        current: currentCatalog,
        changes,
        consumerEvidence,
      }),
    ],
  });
  const incomplete = validateContractEvolution({
    previousRegistry: registry,
    currentRegistry: withRecord([
      {
        path: "apps/web/catalog.ts",
        consumerId:
          'graphql:apps/web/catalog.ts:query:CatalogQuery:["preferenceCatalog"]',
        outcome: "migrated",
      },
    ]),
    previousCatalog,
    currentCatalog,
    previousHttp: {},
    currentHttp: {},
    previousMcp: {},
    currentMcp: {},
  });
  assert.ok(
    incomplete.some((error) => error.includes("affected-consumer evidence")),
  );
  assert.deepEqual(
    validateContractEvolution({
      previousRegistry: registry,
      currentRegistry: withRecord([
        {
          path: "apps/web/catalog.ts",
          consumerId:
            'graphql:apps/web/catalog.ts:query:CatalogQuery:["preferenceCatalog"]',
          outcome: "migrated",
        },
        {
          path: "examples/eval-harbor/modes/cr-mcp.md",
          consumerId:
            "ref:examples/eval-harbor/modes/cr-mcp.md:mcp:tool:listPreferenceSlugs",
          outcome: "migrated",
        },
        {
          path: "scripts/local-migration/restart-smoke.mjs",
          consumerId: "fp:restart-catalog-reader",
          outcome: "migrated",
        },
      ]),
      previousCatalog,
      currentCatalog,
      previousHttp: {},
      currentHttp: {},
      previousMcp: {},
      currentMcp: {},
    }),
    [],
  );
});

test("migration evidence retains disappeared external and MCP schema/catalog consumers", () => {
  const previousRegistry = {
    version: 1,
    capabilities: [],
    packages: [],
    outboundCalls: [],
    consumers: [],
    dynamicConsumers: [],
    fingerprintConsumers: [
      {
        id: "external-graphql",
        path: "docs/external-graphql.md",
        contract: "http",
        kind: "external-unknown",
        clientClass: "external-unknown",
        access: "graphql-schema-dependent",
        affectedContracts: ["http", "graphql", "catalog", "registry"],
      },
      {
        id: "schema-reader",
        path: "scripts/schema-reader.mjs",
        contract: "mcp",
        kind: "mcp-resource",
        resource: "schema://graphql",
      },
      {
        id: "known-mcp-schema-catalog-client",
        path: "docs/known-mcp-client.md",
        contract: "mcp",
        kind: "mcp-auth",
        clientClass: "claude",
        access: "all-tools-and-schema",
        affectedContracts: ["mcp", "graphql", "catalog", "registry"],
      },
      {
        id: "external-mcp",
        path: "docs/external-mcp.md",
        contract: "mcp",
        kind: "external-unknown",
        clientClass: "external-unknown",
        access: "zero-tools-zero-resources",
        affectedContracts: ["mcp", "registry"],
      },
      {
        id: "catalog-reader",
        path: "scripts/catalog-reader.mjs",
        contract: "mcp",
        kind: "mcp-tool",
        tool: "listPreferenceSlugs",
      },
    ],
    contractReferences: [
      {
        path: "docs/schema-runbook.md",
        contract: "mcp",
        kind: "resource",
        reference: "schema://graphql",
      },
      {
        path: "docs/catalog-runbook.md",
        contract: "mcp",
        kind: "tool",
        reference: "listPreferenceSlugs",
      },
    ],
    migrationRecords: [],
  };
  const currentRegistry = {
    ...previousRegistry,
    version: 2,
    fingerprintConsumers: [],
    contractReferences: [],
  };
  const registryChanges = diffJsonValues(
    protectedRegistrySnapshot(previousRegistry),
    protectedRegistrySnapshot(currentRegistry),
  ).filter((change) => !change.startsWith("added "));
  const registryRecord = reviewedRecord({
    contract: "registry",
    previous: protectedRegistrySnapshot(previousRegistry),
    current: protectedRegistrySnapshot(currentRegistry),
    changes: registryChanges,
    consumerEvidence: [
      {
        path: "docs/external-graphql.md",
        consumerId: "fp:external-graphql",
        outcome: "migrated",
      },
      {
        path: "docs/external-mcp.md",
        consumerId: "fp:external-mcp",
        outcome: "migrated",
      },
      {
        path: "docs/known-mcp-client.md",
        consumerId: "fp:known-mcp-schema-catalog-client",
        outcome: "migrated",
      },
    ],
  });
  const previousGraphql = { schema: "before" };
  const currentGraphql = { schema: "after" };
  const graphqlChanges = ["removed field Query.previous"];
  const graphqlRecord = (consumerEvidence) =>
    reviewedRecord({
      contract: "graphql",
      previous: previousGraphql,
      current: currentGraphql,
      changes: graphqlChanges,
      consumerEvidence,
    });
  const incompleteGraphqlEvidence = validateContractEvolution({
      previousRegistry,
      currentRegistry: {
        ...currentRegistry,
        migrationRecords: [
          graphqlRecord([
            {
              path: "docs/external-graphql.md",
              consumerId: "fp:external-graphql",
              outcome: "migrated",
            },
          ]),
          registryRecord,
        ],
      },
      previousGraphql,
      currentGraphql,
      graphqlBreaking: graphqlChanges,
    });
  assert.ok(
    incompleteGraphqlEvidence.some((error) =>
      error.includes("affected-consumer evidence"),
    ),
  );
  assert.ok(
    incompleteGraphqlEvidence.some((error) =>
      error.includes("fp:known-mcp-schema-catalog-client"),
    ),
  );
  assert.deepEqual(
    validateContractEvolution({
      previousRegistry,
      currentRegistry: {
        ...currentRegistry,
        migrationRecords: [
          graphqlRecord([
            {
              path: "docs/external-graphql.md",
              consumerId: "fp:external-graphql",
              outcome: "migrated",
            },
            {
              path: "scripts/schema-reader.mjs",
              consumerId: "fp:schema-reader",
              outcome: "migrated",
            },
            {
              path: "docs/known-mcp-client.md",
              consumerId: "fp:known-mcp-schema-catalog-client",
              outcome: "migrated",
            },
            {
              path: "docs/schema-runbook.md",
              consumerId:
                "ref:docs/schema-runbook.md:mcp:resource:schema://graphql",
              outcome: "migrated",
            },
          ]),
          registryRecord,
        ],
      },
      previousGraphql,
      currentGraphql,
      graphqlBreaking: graphqlChanges,
    }),
    [],
  );

  const previousCatalog = normalizeCatalog({
    one: { valueType: "string", scope: "global", description: "one" },
  });
  const currentCatalog = normalizeCatalog({
    one: { valueType: "number", scope: "global", description: "one" },
  });
  const catalogChanges = diffCatalogContracts(
    previousCatalog,
    currentCatalog,
  ).breaking;
  const catalogRecord = (consumerEvidence) =>
    reviewedRecord({
      contract: "catalog",
      previous: previousCatalog,
      current: currentCatalog,
      changes: catalogChanges,
      consumerEvidence,
    });
  const incompleteCatalogEvidence = validateContractEvolution({
      previousRegistry,
      currentRegistry: {
        ...currentRegistry,
        migrationRecords: [
          catalogRecord([
            {
              path: "scripts/catalog-reader.mjs",
              consumerId: "fp:catalog-reader",
              outcome: "migrated",
            },
          ]),
          registryRecord,
        ],
      },
      previousCatalog,
      currentCatalog,
    });
  assert.ok(
    incompleteCatalogEvidence.some((error) =>
      error.includes("affected-consumer evidence"),
    ),
  );
  assert.ok(
    incompleteCatalogEvidence.some((error) =>
      error.includes("fp:known-mcp-schema-catalog-client"),
    ),
  );
  assert.deepEqual(
    validateContractEvolution({
      previousRegistry,
      currentRegistry: {
        ...currentRegistry,
        migrationRecords: [
          catalogRecord([
            {
              path: "docs/external-graphql.md",
              consumerId: "fp:external-graphql",
              outcome: "migrated",
            },
            {
              path: "docs/external-mcp.md",
              consumerId: "fp:external-mcp",
              outcome: "migrated",
            },
            {
              path: "scripts/catalog-reader.mjs",
              consumerId: "fp:catalog-reader",
              outcome: "migrated",
            },
            {
              path: "docs/known-mcp-client.md",
              consumerId: "fp:known-mcp-schema-catalog-client",
              outcome: "migrated",
            },
            {
              path: "docs/catalog-runbook.md",
              consumerId:
                "ref:docs/catalog-runbook.md:mcp:tool:listPreferenceSlugs",
              outcome: "migrated",
            },
          ]),
          registryRecord,
        ],
      },
      previousCatalog,
      currentCatalog,
    }),
    [],
  );
});

test("protected registry permits additions but requires review for removals and protected-field changes", () => {
  const previousRegistry = {
    version: 1,
    capabilities: [
      {
        id: "existing",
        disposition: "RETAIN",
        contractClass: "preserved-contract",
        ownerSteps: ["04"],
      },
    ],
    packages: [
      { path: "apps/example", role: "runtime", migrationOwner: "04" },
    ],
    outboundCalls: [
      {
        id: "existing-call",
        disposition: "RETAIN",
        ownerSteps: ["04"],
        defaultRuntime: true,
      },
    ],
    migrationRecords: [],
  };
  const additiveRegistry = structuredClone(previousRegistry);
  additiveRegistry.capabilities.push({
    id: "new-capability",
    disposition: "RETAIN",
    contractClass: "preserved-contract",
    ownerSteps: ["05"],
  });
  additiveRegistry.packages.push({
    path: "apps/another",
    role: "runtime",
    migrationOwner: "05",
  });
  additiveRegistry.outboundCalls.push({
    id: "new-call",
    disposition: "RETAIN",
    ownerSteps: ["05"],
    defaultRuntime: false,
  });

  assert.deepEqual(
    validateContractEvolution({
      previousRegistry,
      currentRegistry: additiveRegistry,
      previousHttp: {},
      currentHttp: {},
      previousMcp: {},
      currentMcp: {},
    }),
    [],
  );

  const changedRegistry = structuredClone(previousRegistry);
  changedRegistry.version = 2;
  changedRegistry.capabilities[0].disposition = "REMOVE";
  assert.ok(
    validateContractEvolution({
      previousRegistry,
      currentRegistry: changedRegistry,
      previousHttp: {},
      currentHttp: {},
      previousMcp: {},
      currentMcp: {},
    }).some((error) => error.includes("registry") && error.includes("migration record")),
  );

  const removedRegistry = structuredClone(previousRegistry);
  removedRegistry.version = 2;
  removedRegistry.outboundCalls = [];
  assert.ok(
    validateContractEvolution({
      previousRegistry,
      currentRegistry: removedRegistry,
      previousHttp: {},
      currentHttp: {},
      previousMcp: {},
      currentMcp: {},
    }).some((error) => error.includes("registry") && error.includes("migration record")),
  );
});

test("static HTTP and MCP validators reject nested contract drift", () => {
  const httpErrors = validateHttpContract({
    routes: {
      health: {
        method: "POST",
        path: "/health",
        success: { required: ["status"] },
      },
    },
  });
  assert.ok(httpErrors.some((error) => error.includes("health method/path")));
  assert.ok(httpErrors.some((error) => error.includes("GET /mcp")));
  assert.ok(httpErrors.some((error) => error.includes("runtime evidence")));

  const mcpErrors = validateMcpContract(
    {
      server: { identity: { name: "wrong", version: "0" } },
      tools: [],
      resources: [],
      visibility: {},
      clients: [],
      challenges: {},
    },
    [],
  );
  assert.ok(mcpErrors.some((error) => error.includes("tool name set")));
  assert.ok(mcpErrors.some((error) => error.includes("server identity")));
  assert.ok(mcpErrors.some((error) => error.includes("resource descriptor")));
  assert.ok(
    mcpErrors.some((error) => error.includes("external client bucket set")),
  );
});

test("HTTP/MCP validators reject duplicate keyed records and stale external buckets", () => {
  const httpErrors = validateHttpContract({
    routes: {},
    supportRoutes: [
      { method: "GET", path: "/support" },
      { method: "GET", path: "/support" },
    ],
  });
  assert.ok(
    httpErrors.some((error) => error.includes("duplicate support route")),
  );

  const mcpContract = {
    server: {},
    tools: [
      { descriptor: { name: "duplicate" } },
      { descriptor: { name: "duplicate" } },
    ],
    resources: [
      { descriptor: { uri: "schema://duplicate" } },
      { descriptor: { uri: "schema://duplicate" } },
    ],
    clients: [
      { key: "claude", oauth: { redirectUris: ["https://one.invalid"] } },
      { key: "claude", oauth: { redirectUris: ["https://one.invalid"] } },
    ],
    visibility: { unknown: { tools: [], resources: [] } },
    challenges: {},
  };
  const mcpErrors = validateMcpContract(mcpContract, [
    {
      bucket: "claude",
      callbacks: ["https://one.invalid", "https://one.invalid"],
    },
    { bucket: "stale", callbacks: [] },
  ]);
  assert.ok(mcpErrors.some((error) => error.includes("duplicate MCP tool")));
  assert.ok(
    mcpErrors.some((error) => error.includes("duplicate MCP resource")),
  );
  assert.ok(mcpErrors.some((error) => error.includes("duplicate MCP client")));
  assert.ok(
    mcpErrors.some((error) => error.includes("external client bucket set")),
  );
  assert.ok(mcpErrors.some((error) => error.includes("duplicate callback")));

  const callbackContract = {
    ...mcpContract,
    tools: [],
    resources: [],
    clients: [
      {
        key: "claude",
        oauth: {
          redirectUris: ["https://one.invalid", "https://two.invalid"],
        },
      },
    ],
  };
  const orderOnlyErrors = validateMcpContract(callbackContract, [
    {
      bucket: "unknown",
      callbacks: [],
    },
    {
      bucket: "claude",
      callbacks: ["https://two.invalid", "https://one.invalid"],
    },
  ]).filter((error) => error.includes("callback set"));
  assert.deepEqual(orderOnlyErrors, []);
});

test("external HTTP coverage requires route-specific GraphQL, health, and upload declarations", () => {
  const httpContract = {
    routes: {
      health: { method: "GET", path: "/health" },
      graphql: { method: "POST", path: "/graphql" },
      documentAnalysis: {
        method: "POST",
        path: "/api/preferences/analysis",
      },
      formFill: { method: "POST", path: "/api/form-fill/pdf" },
    },
  };
  const external = [
    ["external-graphql", "POST", "/graphql"],
    ["external-health", "GET", "/health"],
    ["external-analysis", "POST", "/api/preferences/analysis"],
    ["external-form-fill", "POST", "/api/form-fill/pdf"],
  ].map(([id, method, route]) => ({
    id,
    contract: "http",
    kind: "external-unknown",
    path: "docs/external.md",
    clientClass: "external-unknown",
    access: "declared-public-contract",
    method,
    route,
    affectedContracts: ["http", "registry"],
  }));

  assert.deepEqual(
    validateExternalConsumerCoverage(external, httpContract),
    [],
  );
  for (const missing of external) {
    assert.ok(
      validateExternalConsumerCoverage(
        external.filter((consumer) => consumer !== missing),
        httpContract,
      ).some((error) =>
        error.includes(`${missing.method} ${missing.route}`),
      ),
    );
  }
});

test("HTTP runtime evidence case names are fingerprinted in executable sources", () => {
  const contract = {
    runtimeEvidence: [
      { surface: "backend-http-e2e", path: "e2e.ts", cases: ["pins 401"] },
    ],
  };
  assert.deepEqual(
    validateHttpRuntimeEvidence(contract, new Map([["e2e.ts", "it('pins 401')"]])),
    [],
  );
  assert.ok(
    validateHttpRuntimeEvidence(contract, new Map([["e2e.ts", "other test"]])).some(
      (error) => error.includes("pins 401"),
    ),
  );
});

test("validateConsumerMap reports both missing and stale entries", () => {
  const errors = validateConsumerMap(
    [
      { path: "a.ts", kind: "query", operation: "One" },
      { path: "b.ts", kind: "mutation", operation: "Two" },
    ],
    [
      { path: "a.ts", kind: "query", operation: "One" },
      { path: "stale.ts", kind: "query", operation: "Gone" },
    ],
  );

  assert.ok(errors.some((error) => error.includes("missing consumer b.ts")));
  assert.ok(errors.some((error) => error.includes("stale consumer stale.ts")));
});

test("fingerprinted consumers require typed interactions and exact source evidence", () => {
  const consumers = [
    {
      id: "upload",
      contract: "http",
      kind: "http-route",
      path: "upload.ts",
      method: "POST",
      route: "/api/preferences/analysis",
      auth: "bearer-user",
      fingerprints: ["fetch(endpoint", "method: 'POST'", "Authorization"],
    },
    {
      id: "unknown-client",
      contract: "mcp",
      kind: "mcp-auth",
      path: "registry.ts",
      clientClass: "external-unknown",
      access: "none",
      fingerprints: ["unknown", "tools: []"],
    },
  ];
  const files = new Map([
    ["upload.ts", "fetch(endpoint, { method: 'POST', headers: { Authorization: token } })"],
    ["registry.ts", "const unknown = { tools: [] };"],
  ]);
  assert.deepEqual(validateFingerprintConsumers(consumers, files), []);

  const stale = structuredClone(consumers);
  stale[0].fingerprints.push("removed-callsite");
  assert.ok(
    validateFingerprintConsumers(stale, files).some((error) =>
      error.includes("removed-callsite"),
    ),
  );
  const incomplete = structuredClone(consumers);
  delete incomplete[0].method;
  assert.ok(
    validateFingerprintConsumers(incomplete, files).some((error) =>
      error.includes("method"),
    ),
  );

  const crossed = structuredClone(consumers);
  crossed[0].contract = "mcp";
  assert.ok(
    validateFingerprintConsumers(crossed, files).some((error) =>
      error.includes("requires contract http"),
    ),
  );
  const unknownWithoutClassification = structuredClone(consumers);
  unknownWithoutClassification[1].kind = "external-unknown";
  delete unknownWithoutClassification[1].access;
  assert.ok(
    validateFingerprintConsumers(unknownWithoutClassification, files).some(
      (error) => error.includes("external classification"),
    ),
  );
});

test("fingerprinted consumers agree with loaded HTTP and MCP fixtures", () => {
  const files = new Map([
    ["route.ts", "fetch('/health')"],
    ["tool.md", "listPreferenceSlugs"],
    ["auth.md", "Claude config"],
  ]);
  const options = {
    httpContract: {
      routes: { health: { method: "GET", path: "/health" } },
      supportRoutes: [],
    },
    mcpContract: {
      tools: [{ descriptor: { name: "listPreferenceSlugs" } }],
      resources: [],
      clients: [],
      visibility: {
        claude: {
          tools: ["listPreferenceSlugs"],
          resources: ["schema://graphql"],
        },
      },
    },
  };
  assert.deepEqual(
    validateFingerprintConsumers(
      [
        {
          id: "health",
          contract: "http",
          kind: "http-route",
          path: "route.ts",
          method: "GET",
          route: "/health",
          fingerprints: ["/health"],
        },
        {
          id: "tool",
          contract: "mcp",
          kind: "mcp-tool",
          path: "tool.md",
          tool: "listPreferenceSlugs",
          fingerprints: ["listPreferenceSlugs"],
        },
      ],
      files,
      options,
    ),
    [],
  );
  assert.ok(
    validateFingerprintConsumers(
      [
        {
          id: "stale-route",
          contract: "http",
          kind: "http-route",
          path: "route.ts",
          method: "POST",
          route: "/health",
          fingerprints: ["/health"],
        },
      ],
      files,
      options,
    ).some((error) => error.includes("does not match the HTTP fixture")),
  );

  const knownMcpAuthConsumer = {
    id: "claude-auth",
    contract: "mcp",
    kind: "mcp-auth",
    path: "auth.md",
    clientClass: "claude",
    access: "catalog-and-schema",
    affectedContracts: ["mcp", "graphql", "catalog", "registry"],
    fingerprints: ["Claude config"],
  };
  assert.deepEqual(
    validateFingerprintConsumers([knownMcpAuthConsumer], files, options),
    [],
  );
  const incompleteMcpAuthConsumer = structuredClone(knownMcpAuthConsumer);
  incompleteMcpAuthConsumer.affectedContracts = ["mcp", "graphql", "registry"];
  assert.ok(
    validateFingerprintConsumers([incompleteMcpAuthConsumer], files, options).some(
      (error) => error.includes("affected contracts"),
    ),
  );
});

test("dynamic GraphQL metadata must match the canonical operation kind and name", () => {
  const schema = "type Query { me: String! }";
  const consumer = {
    path: "script.sh",
    kind: "mutation",
    operation: "WrongName",
    rootFields: ["me"],
    document: "query ActualName { me }",
    sourceFingerprints: ["me"],
  };
  const errors = validateDynamicConsumer(consumer, "curl me", schema);
  assert.ok(errors.some((error) => error.includes("operation kind is stale")));
  assert.ok(errors.some((error) => error.includes("operation name is stale")));
});

test("every planned-removal web support route has live source-fingerprint coverage", async () => {
  const repositoryRoot = path.resolve(import.meta.dirname, "../..");
  const httpContract = JSON.parse(
    await readFile(
      path.join(
        repositoryRoot,
        "apps/backend/test/contracts/fixtures/http-contracts.v1.json",
      ),
      "utf8",
    ),
  );
  const registry = JSON.parse(
    await readFile(
      path.join(
        repositoryRoot,
        "docs/current/local-migration-contract-baseline.json",
      ),
      "utf8",
    ),
  );
  const supportConsumers = (registry.fingerprintConsumers ?? []).filter(
    (consumer) => consumer.kind === "web-support-route",
  );
  const files = new Map();
  for (const consumer of supportConsumers) {
    files.set(
      consumer.path,
      await readFile(path.join(repositoryRoot, consumer.path), "utf8"),
    );
  }

  assert.deepEqual(
    [...new Set(supportConsumers.map((consumer) => consumer.route))].sort(),
    httpContract.supportRoutes.map((route) => route.path).sort(),
  );
  assert.deepEqual(validateFingerprintConsumers(supportConsumers, files), []);
});

test("referenced path validation covers outbound, package, and fingerprint consumer paths", async () => {
  const errors = await validateReferencedPaths(
    {
      capabilities: [{ evidence: ["present-capability.ts"] }],
      packages: [{ path: "present-package" }],
      outboundCalls: [
        {
          sources: [
            { path: "missing-outbound.ts", fingerprints: ["fetch("] },
          ],
        },
      ],
      fingerprintConsumers: [{ path: "missing-consumer.ts" }],
      contracts: { graphql: { fixture: "present-contract.json" } },
    },
    {
      pathExists: async (relativePath) =>
        new Set([
          "present-capability.ts",
          "present-package",
          "present-contract.json",
        ]).has(relativePath),
    },
  );
  assert.deepEqual(errors, [
    "referenced evidence path does not exist: missing-consumer.ts",
    "referenced evidence path does not exist: missing-outbound.ts",
  ]);
});

test("outbound inventory pins every independent callsite with source fingerprints", () => {
  const outboundCalls = [
    {
      id: "auth-jwks",
      sources: [
        { path: "jwt.ts", fingerprints: ["passportJwtSecret", "/.well-known/jwks.json"] },
        { path: "mcp.ts", fingerprints: ["new JwksClient", "jwksUri"] },
      ],
    },
  ];
  const complete = new Map([
    ["jwt.ts", "passportJwtSecret({ jwksUri: '/.well-known/jwks.json' })"],
    ["mcp.ts", "new JwksClient({ jwksUri })"],
  ]);
  assert.deepEqual(
    validateOutboundSourceFingerprints(outboundCalls, complete),
    [],
  );
  complete.delete("mcp.ts");
  assert.ok(
    validateOutboundSourceFingerprints(outboundCalls, complete).some((error) =>
      error.includes("mcp.ts"),
    ),
  );
});

test("automatic contract references fail closed for missing and stale consumers", () => {
  const discovered = collectContractReferences(
    new Map([
      ["client.ts", "fetch('/health'); listPreferenceSlugs();"],
      ["setup.md", "POST /mcp and read schema://graphql"],
      ["artifact.py", "open('artifacts/mcp/tool-calls.jsonl')"],
      ["auth.tsx", "href=\"/auth/login\"; href='/auth/logout'"],
      [
        "unrelated.md",
        "schema://graphql src/mcp/auth/auth.service.ts artifacts/mcp/log.jsonl",
      ],
    ]),
    {
      httpContract: {
        routes: {
          health: { path: "/health" },
          mcp: { path: "/mcp" },
          auth: { path: "/auth/*" },
        },
      },
      mcpContract: {
        tools: [{ descriptor: { name: "listPreferenceSlugs" } }],
        resources: [{ descriptor: { uri: "schema://graphql" } }],
      },
    },
  );
  assert.equal(
    discovered.some(
      (reference) =>
        reference.path === "artifact.py" && reference.reference === "/mcp",
    ),
    false,
  );
  assert.equal(
    discovered.some(
      (reference) =>
        reference.path === "auth.tsx" && reference.reference === "/auth/*",
    ),
    true,
  );
  assert.equal(
    discovered.some(
      (reference) =>
        reference.path === "unrelated.md" &&
        ["/graphql", "/mcp", "/auth/*"].includes(reference.reference),
    ),
    false,
  );
  assert.deepEqual(validateContractReferenceMap(discovered, discovered), []);
  assert.ok(
    validateContractReferenceMap(discovered, discovered.slice(1)).some(
      (error) => error.includes("missing contract reference"),
    ),
  );
  assert.ok(
    validateContractReferenceMap(discovered, [
      ...discovered,
      {
        path: "removed.ts",
        contract: "http",
        kind: "route",
        reference: "/health",
      },
    ]).some((error) => error.includes("stale contract reference")),
  );
});

test("derived references cover maintained root, eval, and configuration runbooks", async () => {
  const repositoryRoot = path.resolve(import.meta.dirname, "../..");
  const registry = JSON.parse(
    await readFile(
      path.join(
        repositoryRoot,
        "docs/current/local-migration-contract-baseline.json",
      ),
      "utf8",
    ),
  );
  const paths = new Set(
    registry.contractReferences.map((reference) => reference.path),
  );
  for (const expected of [
    "README.md",
    "apps/web/.env.example",
    "docs/IMPORTANT/CURRENT_STATE.md",
    "docs/plans/active/local-migration/orchestration.md",
    "examples/eval/README.md",
    "examples/simple-eval-example-1/intermediary-files/json-mime-smoke.md",
    "scripts/local-migration/packaging-smoke.mjs",
  ]) {
    assert.ok(paths.has(expected), `missing maintained contract runbook ${expected}`);
  }
});

test("registry supported modes must exactly name active executable gate modes", () => {
  const manifest = {
    supportedModes: [
      { id: "hosted-baseline", status: "active" },
      { id: "local-identity-preview", status: "active" },
      { id: "local-database-preview", status: "active" },
      { id: "legacy", status: "retired" },
    ],
  };
  assert.deepEqual(
    validateRegistryMode(
      {
        version: 2,
        supportedModes: ["hosted-baseline", "local-identity-preview", "local-database-preview"],
      },
      manifest,
    ),
    [],
  );
  for (const supportedModes of [
    ["hosted-baseline"],
    ["hosted-baseline", "local-identity-preview"],
    ["hosted-baseline", "legacy"],
    ["local-identity-preview", "hosted-baseline"],
    ["hosted-baseline", "local-identity-preview", "hosted"],
  ]) {
    assert.ok(
      validateRegistryMode({ version: 2, supportedModes }, manifest).some(
        (error) => error.includes("active gate modes"),
      ),
    );
  }
  assert.ok(
    validateRegistryMode(
      { version: 2, supportedMode: "hosted-baseline" },
      manifest,
    ).some((error) => error.includes("supportedModes")),
  );
});

test("automatic outbound inventory pins sink paths, kinds, counts, and classifications", () => {
  const discovered = collectOutboundSinkInventory(
    new Map([
      ["client.ts", "fetch('/one'); fetch('/two');"],
      ["runner.mjs", "spawn('provider', []);"],
      [
        "gate-orchestration.mjs",
        [
          "dns.lookup(hostname);",
          "await runCommand(['git', 'status']);",
          "await commandRunner(['docker', 'info']);",
          "await execFileAsync('git', ['status']);",
          "new (pgFor(root).Client)({});",
          "new Client(configuration);",
        ].join("\n"),
      ],
      ["python.py", "subprocess.run(command, check=True)"],
      [
        "shell-runner.sh",
        [
          "# curl https://comment.invalid",
          'echo "pip install is documented"',
          '"${PYTHON_BIN}" -m pip install --upgrade pip',
          '"${PYTHON_BIN}" -m pip install -r requirements.txt',
          "docker info >/dev/null",
          '"${HARBOR_BIN}" run',
        ].join("\n"),
      ],
    ]),
  );
  const outboundCalls = [
    {
      sources: [
        { path: "client.ts", fingerprints: ["fetch('/one')"] },
        { path: "runner.mjs", fingerprints: ["spawn('provider'"] },
        {
          path: "gate-orchestration.mjs",
          fingerprints: ["dns.lookup(hostname)"],
        },
        { path: "python.py", fingerprints: ["subprocess.run("] },
        { path: "shell-runner.sh", fingerprints: ["docker info"] },
      ],
    },
  ];
  assert.deepEqual(
    discovered.find((item) => item.path === "shell-runner.sh")?.sinks,
    { docker: 1, harbor: 1, "pip-install": 2 },
  );
  assert.deepEqual(
    discovered.find((item) => item.path === "python.py")?.sinks,
    { "python-subprocess": 1 },
  );
  assert.deepEqual(
    discovered.find((item) => item.path === "gate-orchestration.mjs")?.sinks,
    {
      "dns-lookup": 1,
      "exec-file": 1,
      "postgresql-client": 2,
      "subprocess-wrapper": 2,
    },
  );
  assert.deepEqual(
    validateOutboundSinkInventory(discovered, discovered, outboundCalls),
    [],
  );
  assert.ok(
    validateOutboundSinkInventory(discovered, discovered.slice(1), outboundCalls)
      .some((error) => error.includes("missing outbound sink inventory")),
  );
  const wrongCount = structuredClone(discovered);
  wrongCount[0].sinks.fetch = 1;
  assert.ok(
    validateOutboundSinkInventory(discovered, wrongCount, outboundCalls).some(
      (error) => error.includes("counts changed"),
    ),
  );
  assert.ok(
    validateOutboundSinkInventory(discovered, discovered, []).some((error) =>
      error.includes("unclassified outbound sink"),
    ),
  );
  assert.ok(
    validateOutboundSinkInventory(
      discovered.slice(1),
      discovered,
      outboundCalls,
    ).some((error) => error.includes("stale outbound sink inventory")),
  );
});

test("base comparison mode fails closed when the aggregate gate requires evidence", () => {
  assert.deepEqual(resolveBaseComparisonMode({}), {
    baseDirectory: undefined,
    required: false,
    status: "skipped",
  });
  assert.throws(
    () =>
      resolveBaseComparisonMode({
        MIGRATION_GATE_REQUIRE_BASE_COMPARISON: "1",
      }),
    /required.*MIGRATION_GATE_BASELINE_DIR/,
  );
  assert.deepEqual(
    resolveBaseComparisonMode({
      MIGRATION_GATE_REQUIRE_BASE_COMPARISON: "1",
      MIGRATION_GATE_BASELINE_DIR: "/tmp/base",
    }),
    { baseDirectory: "/tmp/base", required: true, status: "performed" },
  );
});

test("repository-controlled paths reject traversal, absolute paths, and escaping symlinks", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "contract-path-test-"));
  const repository = path.join(root, "repository");
  await mkdir(repository);
  await writeFile(path.join(repository, "inside.json"), "{}\n");
  await writeFile(path.join(root, "outside.json"), "{}\n");
  await symlink("../outside.json", path.join(repository, "escape.json"));
  try {
    assert.equal(
      await resolveRepositoryPath("inside.json", { root: repository }),
      await realpath(path.join(repository, "inside.json")),
    );
    for (const unsafe of ["../outside.json", path.join(root, "outside.json"), "escape.json"] ) {
      await assert.rejects(
        resolveRepositoryPath(unsafe, { root: repository }),
        /unsafe repository path|escapes repository/,
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("derived fixture writes never follow a repository symlink", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "contract-write-test-"));
  const repository = path.join(root, "repository");
  const outside = path.join(root, "outside.json");
  await mkdir(repository);
  await writeFile(outside, '{"outside":true}\n');
  await symlink("../outside.json", path.join(repository, "fixture.json"));
  try {
    await assert.rejects(
      writeRepositoryJson("fixture.json", { safe: true }, { root: repository }),
      /regular file or absent/,
    );
    assert.equal(await readFile(outside, "utf8"), '{"outside":true}\n');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("merge-base artifact bundle is hash-bound and detects replacement before use", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "contract-base-bundle-test-"));
  const baseSha = "a".repeat(40);
  const content = Buffer.from('{"version":1}\n');
  const artifactPath = "contracts/fixture.json";
  await mkdir(path.join(root, "contracts"));
  await writeFile(path.join(root, artifactPath), content);
  const manifest = Buffer.from(
    `${JSON.stringify({
      baseSha,
      artifacts: [
        {
          path: artifactPath,
          sha256: createHash("sha256").update(content).digest("hex"),
        },
      ],
    }, null, 2)}\n`,
  );
  await writeFile(path.join(root, "artifact-hashes.json"), manifest);
  const manifestSha256 = createHash("sha256").update(manifest).digest("hex");
  try {
    const verified = await verifyBaseArtifactBundle({
      baseDirectory: root,
      expectedManifestSha256: manifestSha256,
      expectedBaseSha: baseSha,
    });
    assert.equal(verified.get(artifactPath).toString("utf8"), content.toString("utf8"));
    await writeFile(path.join(root, artifactPath), '{"version":2}\n');
    await assert.rejects(
      verifyBaseArtifactBundle({
        baseDirectory: root,
        expectedManifestSha256: manifestSha256,
        expectedBaseSha: baseSha,
      }),
      /hash mismatch/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("validateManifestCompatibility requires a version bump for a schema change", () => {
  assert.deepEqual(
    validateManifestCompatibility({
      previousVersion: 3,
      currentVersion: 3,
      previousSchema: { type: "object", required: ["version"] },
      currentSchema: { type: "object", required: ["version", "summary"] },
      previousSchemaPath: "contracts/run-manifest-v3.schema.json",
      currentSchemaPath: "contracts/run-manifest-v3.schema.json",
      previousFixturePath: "fixtures/run-manifest-v3.valid-mixed.json",
      currentFixturePath: "fixtures/run-manifest-v3.valid-mixed.json",
    }),
    ["manifest schema changed without bumping version 3"],
  );
  assert.deepEqual(
    validateManifestCompatibility({
      previousVersion: 3,
      currentVersion: 4,
      previousSchema: { type: "object", required: ["version"] },
      currentSchema: { type: "object", required: ["version", "summary"] },
      previousSchemaPath: "contracts/run-manifest-v3.schema.json",
      currentSchemaPath: "contracts/run-manifest-v4.schema.json",
      previousFixturePath: "fixtures/run-manifest-v3.valid-mixed.json",
      currentFixturePath: "fixtures/run-manifest-v4.valid-mixed.json",
    }),
    [],
  );
  assert.deepEqual(
    validateManifestVersionedPaths({
      version: 4,
      schemaPath: "contracts/run-manifest-v3.schema.json",
      fixturePath: "fixtures/run-manifest-v3.valid-mixed.json",
    }),
    [
      "manifest schema filename does not match version 4",
      "manifest fixture filename does not match version 4",
    ],
  );
  const stalePaths = validateManifestCompatibility({
    previousVersion: 3,
    currentVersion: 4,
    previousSchema: { type: "object", required: ["version"] },
    currentSchema: { type: "object", required: ["version", "summary"] },
    previousSchemaPath: "contracts/run-manifest-v3.schema.json",
    currentSchemaPath: "contracts/run-manifest-v3.schema.json",
    previousFixturePath: "fixtures/run-manifest-v3.valid-mixed.json",
    currentFixturePath: "fixtures/run-manifest-v3.valid-mixed.json",
  });
  assert.ok(stalePaths.some((error) => error.includes("schema filename")));
  assert.ok(stalePaths.some((error) => error.includes("fixture filename")));
  assert.ok(stalePaths.some((error) => error.includes("transition did not bump")));
});
