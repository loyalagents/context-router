import assert from "node:assert/strict";
import test from "node:test";

import {
  buildGraphqlSignature,
  collectGraphqlOperations,
  diffGraphqlSignatures,
  normalizeCatalog,
  validateBaselineDocument,
  validateConsumerMap,
  validateHttpContract,
  validateManifestCompatibility,
  validateMcpContract,
} from "./check-contract-baseline.mjs";

test("buildGraphqlSignature captures arguments, wrappers, enums, and deprecations semantically", () => {
  const signature = buildGraphqlSignature(`
    enum Mode { OLD @deprecated(reason: "use NEW") NEW }
    input SearchInput { query: String! limit: Int = 5 }
    type Result { value: String! }
    type Query { search(input: SearchInput!, mode: Mode = NEW): [Result!]! }
  `);

  assert.deepEqual(signature.types.Mode.values, [
    { name: "NEW", deprecationReason: null },
    { name: "OLD", deprecationReason: "use NEW" },
  ]);
  assert.equal(signature.types.Query.fields.search.type, "[Result!]!");
  assert.deepEqual(signature.types.Query.fields.search.args, [
    {
      name: "input",
      type: "SearchInput!",
      hasDefault: false,
      defaultValue: null,
    },
    { name: "mode", type: "Mode", hasDefault: true, defaultValue: "NEW" },
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
      { id: "same", disposition: "RETAIN", ownerSteps: ["04"] },
      { id: "same", disposition: "DEFER", ownerSteps: [] },
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

test("validateManifestCompatibility requires a version bump for a schema change", () => {
  assert.deepEqual(
    validateManifestCompatibility({
      previousVersion: 3,
      currentVersion: 3,
      previousSchema: { type: "object", required: ["version"] },
      currentSchema: { type: "object", required: ["version", "summary"] },
    }),
    ["manifest schema changed without bumping version 3"],
  );
  assert.deepEqual(
    validateManifestCompatibility({
      previousVersion: 3,
      currentVersion: 4,
      previousSchema: { type: "object", required: ["version"] },
      currentSchema: { type: "object", required: ["version", "summary"] },
    }),
    [],
  );
});
