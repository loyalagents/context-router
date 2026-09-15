#!/usr/bin/env node

import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "../..");
const require = createRequire(
  path.join(repositoryRoot, "apps/backend/package.json"),
);
const graphql = require("graphql");
const Ajv2020 = require("ajv/dist/2020").default;

const EXPECTED_PACKAGES = new Map([
  ["apps/backend", "hosted-product"],
  ["apps/web", "hosted-product"],
  ["apps/local-orchestrator", "temporary-developer-tooling"],
  ["examples/eval", "developer-evaluation-tooling"],
  ["examples/eval-harbor", "research-tooling"],
]);

const EXPECTED_MCP_TOOLS = [
  "consolidateSchema",
  "listPermissionGrants",
  "listPreferenceSlugs",
  "mutatePreferences",
  "searchPreferences",
  "smartSearchPreferences",
];

const EXPECTED_MCP_READ_TOOLS = EXPECTED_MCP_TOOLS.filter(
  (name) => name !== "mutatePreferences",
);

const EXPECTED_MUTATION_OPERATIONS = [
  "SUGGEST_PREFERENCE",
  "SET_PREFERENCE",
  "CREATE_DEFINITION",
  "UPDATE_DEFINITION",
  "ARCHIVE_DEFINITION",
  "DELETE_PREFERENCE",
];

function printableDefault(value, type) {
  if (value === undefined) return null;
  const ast = graphql.astFromValue(value, type);
  return ast ? graphql.print(ast) : null;
}

function normalizeArgs(args) {
  return [...args]
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((argument) => ({
      name: argument.name,
      type: String(argument.type),
      hasDefault: argument.defaultValue !== undefined,
      defaultValue: printableDefault(argument.defaultValue, argument.type),
    }));
}

function normalizeOutputFields(fields) {
  return Object.fromEntries(
    Object.values(fields)
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((field) => [
        field.name,
        {
          type: String(field.type),
          args: normalizeArgs(field.args),
          deprecationReason: field.deprecationReason ?? null,
        },
      ]),
  );
}

function normalizeInputFields(fields) {
  return Object.fromEntries(
    Object.values(fields)
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((field) => [
        field.name,
        {
          type: String(field.type),
          hasDefault: field.defaultValue !== undefined,
          defaultValue: printableDefault(field.defaultValue, field.type),
          deprecationReason: field.deprecationReason ?? null,
        },
      ]),
  );
}

export function buildGraphqlSignature(sdl) {
  const schema = graphql.buildSchema(sdl);
  const types = {};

  for (const type of Object.values(schema.getTypeMap()).sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    if (type.name.startsWith("__")) continue;

    if (graphql.isObjectType(type) || graphql.isInterfaceType(type)) {
      types[type.name] = {
        kind: graphql.isObjectType(type) ? "OBJECT" : "INTERFACE",
        interfaces: type
          .getInterfaces()
          .map((item) => item.name)
          .sort(),
        fields: normalizeOutputFields(type.getFields()),
      };
    } else if (graphql.isInputObjectType(type)) {
      types[type.name] = {
        kind: "INPUT_OBJECT",
        inputFields: normalizeInputFields(type.getFields()),
      };
    } else if (graphql.isEnumType(type)) {
      types[type.name] = {
        kind: "ENUM",
        values: type
          .getValues()
          .map((value) => ({
            name: value.name,
            deprecationReason: value.deprecationReason ?? null,
          }))
          .sort((left, right) => left.name.localeCompare(right.name)),
      };
    } else if (graphql.isUnionType(type)) {
      types[type.name] = {
        kind: "UNION",
        members: type
          .getTypes()
          .map((item) => item.name)
          .sort(),
      };
    } else if (graphql.isScalarType(type)) {
      types[type.name] = {
        kind: "SCALAR",
        specifiedByURL: type.specifiedByURL ?? null,
      };
    }
  }

  const directives = Object.fromEntries(
    schema
      .getDirectives()
      .filter((directive) => !graphql.specifiedDirectives.includes(directive))
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((directive) => [
        directive.name,
        {
          locations: [...directive.locations].sort(),
          repeatable: directive.isRepeatable,
          args: normalizeArgs(directive.args),
        },
      ]),
  );

  return {
    roots: {
      query: schema.getQueryType()?.name ?? null,
      mutation: schema.getMutationType()?.name ?? null,
      subscription: schema.getSubscriptionType()?.name ?? null,
    },
    types,
    directives,
  };
}

function jsonEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function diffGraphqlSignatures(previous, current) {
  const breaking = [];
  const additive = [];
  const previousTypes = previous.types ?? {};
  const currentTypes = current.types ?? {};

  for (const [name, priorType] of Object.entries(previousTypes)) {
    const nextType = currentTypes[name];
    if (!nextType) {
      breaking.push(`removed type ${name}`);
      continue;
    }
    if (priorType.kind !== nextType.kind) {
      breaking.push(
        `${name} changed kind from ${priorType.kind} to ${nextType.kind}`,
      );
      continue;
    }

    if (priorType.fields) {
      for (const [fieldName, priorField] of Object.entries(priorType.fields)) {
        const fieldPath = `${name}.${fieldName}`;
        const nextField = nextType.fields?.[fieldName];
        if (!nextField) {
          breaking.push(`removed field ${fieldPath}`);
          continue;
        }
        if (priorField.type !== nextField.type) {
          breaking.push(
            `${fieldPath} changed type from ${priorField.type} to ${nextField.type}`,
          );
        }
        const priorArgs = Object.fromEntries(
          priorField.args.map((arg) => [arg.name, arg]),
        );
        const nextArgs = Object.fromEntries(
          nextField.args.map((arg) => [arg.name, arg]),
        );
        for (const [argName, priorArg] of Object.entries(priorArgs)) {
          if (!nextArgs[argName]) {
            breaking.push(`removed argument ${fieldPath}(${argName}:)`);
          } else if (!jsonEqual(priorArg, nextArgs[argName])) {
            breaking.push(`changed argument ${fieldPath}(${argName}:)`);
          }
        }
        for (const [argName, nextArg] of Object.entries(nextArgs)) {
          if (priorArgs[argName]) continue;
          if (nextArg.type.endsWith("!") && nextArg.defaultValue === null) {
            breaking.push(`added required argument ${fieldPath}(${argName}:)`);
          } else {
            additive.push(`${fieldPath}(${argName}:)`);
          }
        }
        if (
          priorField.deprecationReason === null &&
          nextField.deprecationReason !== null
        ) {
          additive.push(`deprecated ${fieldPath}`);
        }
      }
      for (const fieldName of Object.keys(nextType.fields ?? {})) {
        if (!priorType.fields[fieldName]) additive.push(`${name}.${fieldName}`);
      }
    } else if (priorType.inputFields) {
      for (const [fieldName, priorField] of Object.entries(
        priorType.inputFields,
      )) {
        const fieldPath = `${name}.${fieldName}`;
        const nextField = nextType.inputFields?.[fieldName];
        if (!nextField || !jsonEqual(priorField, nextField)) {
          breaking.push(`removed or changed input field ${fieldPath}`);
        }
      }
      for (const [fieldName, field] of Object.entries(
        nextType.inputFields ?? {},
      )) {
        if (priorType.inputFields[fieldName]) continue;
        if (field.type.endsWith("!") && field.defaultValue === null) {
          breaking.push(`added required input field ${name}.${fieldName}`);
        } else {
          additive.push(`${name}.${fieldName}`);
        }
      }
    } else if (priorType.values) {
      const priorValues = new Map(
        priorType.values.map((value) => [value.name, value]),
      );
      const nextValues = new Map(
        nextType.values.map((value) => [value.name, value]),
      );
      for (const [valueName, priorValue] of priorValues) {
        if (!nextValues.has(valueName))
          breaking.push(`removed enum value ${name}.${valueName}`);
        else if (!jsonEqual(priorValue, nextValues.get(valueName))) {
          additive.push(`changed enum deprecation ${name}.${valueName}`);
        }
      }
      for (const valueName of nextValues.keys()) {
        if (!priorValues.has(valueName)) additive.push(`${name}.${valueName}`);
      }
    } else if (
      priorType.members &&
      !jsonEqual(priorType.members, nextType.members)
    ) {
      const priorMembers = new Set(priorType.members);
      const nextMembers = new Set(nextType.members);
      for (const member of priorMembers) {
        if (!nextMembers.has(member))
          breaking.push(`removed union member ${name}.${member}`);
      }
      for (const member of nextMembers) {
        if (!priorMembers.has(member)) additive.push(`${name}.${member}`);
      }
    }
  }
  for (const name of Object.keys(currentTypes)) {
    if (!previousTypes[name]) additive.push(name);
  }

  for (const root of ["query", "mutation", "subscription"]) {
    if ((previous.roots?.[root] ?? null) !== (current.roots?.[root] ?? null)) {
      breaking.push(`${root} root changed`);
    }
  }

  return {
    breaking: [...new Set(breaking)].sort(),
    additive: [...new Set(additive)].sort(),
  };
}

export function collectGraphqlOperations(files) {
  const operations = [];
  for (const [filePath, content] of [...files.entries()].sort(
    ([left], [right]) => left.localeCompare(right),
  )) {
    const candidates = [];
    if (filePath.endsWith(".graphql") || filePath.endsWith(".gql"))
      candidates.push(content);
    for (const match of content.matchAll(/`([\s\S]*?)`/g))
      candidates.push(match[1]);

    for (const candidate of candidates) {
      if (!/\b(?:query|mutation|subscription|fragment)\b/.test(candidate))
        continue;
      let document;
      try {
        document = graphql.parse(candidate);
      } catch {
        continue;
      }
      for (const definition of document.definitions) {
        if (definition.kind !== graphql.Kind.OPERATION_DEFINITION) continue;
        operations.push({
          path: filePath,
          kind: definition.operation,
          operation: definition.name?.value ?? "<anonymous>",
          rootFields: definition.selectionSet.selections
            .filter((selection) => selection.kind === graphql.Kind.FIELD)
            .map((selection) => selection.name.value)
            .sort(),
        });
      }
    }
  }
  return operations.sort((left, right) =>
    `${left.path}\0${left.kind}\0${left.operation}`.localeCompare(
      `${right.path}\0${right.kind}\0${right.operation}`,
    ),
  );
}

export function normalizeCatalog(catalog) {
  const semantic = {};
  const copy = {};
  for (const slug of Object.keys(catalog).sort()) {
    const item = catalog[slug];
    semantic[slug] = {
      valueType: item.valueType,
      scope: item.scope,
      isSensitive: item.isSensitive ?? false,
      options: item.options ?? null,
      default: item.default ?? null,
      validation: item.validation ?? null,
    };
    copy[slug] = {
      category: item.category ?? null,
      displayName: item.displayName ?? null,
      description: item.description ?? null,
    };
  }
  return { semantic, copy };
}

export function catalogCopyFingerprint(catalog) {
  const copyRows = Object.keys(catalog)
    .sort()
    .map((slug) => ({
      slug,
      displayName: catalog[slug].displayName ?? null,
      category: catalog[slug].category ?? null,
      description: catalog[slug].description ?? null,
    }));
  return `sha256:${createHash("sha256").update(JSON.stringify(copyRows)).digest("hex")}`;
}

export function validateBaselineDocument(document) {
  const errors = [];
  if (!Number.isInteger(document.version) || document.version < 1) {
    errors.push("registry version must be a positive integer");
  }
  if (!Array.isArray(document.capabilities))
    errors.push("capabilities must be an array");
  if (!document.contracts || typeof document.contracts !== "object") {
    errors.push("contracts must be an object");
  }
  if (!Array.isArray(document.outboundCalls))
    errors.push("outboundCalls must be an array");
  if (!Array.isArray(document.consumers))
    errors.push("consumers must be an array");
  if (!Array.isArray(document.migrationRecords))
    errors.push("migrationRecords must be an array");

  const ids = new Set();
  for (const capability of document.capabilities ?? []) {
    if (ids.has(capability.id))
      errors.push(`duplicate capability id ${capability.id}`);
    ids.add(capability.id);
    if (
      !["RETAIN", "REPLACE", "REMOVE", "DEFER"].includes(capability.disposition)
    ) {
      errors.push(`capability ${capability.id} has invalid disposition`);
    }
    if (
      !Array.isArray(capability.ownerSteps) ||
      capability.ownerSteps.length === 0
    ) {
      errors.push(
        `${capability.disposition} capability ${capability.id} has no owner step`,
      );
    }
    if (
      capability.disposition === "DEFER" &&
      (!capability.acceptanceQuestion || !capability.ownerSteps?.length)
    ) {
      errors.push(
        `DEFER capability ${capability.id} requires an owner and acceptance question`,
      );
    }
    if (
      ![
        "preserved-contract",
        "observed-not-promised",
        "planned-removal",
      ].includes(capability.contractClass)
    ) {
      errors.push(`capability ${capability.id} has invalid contractClass`);
    }
  }

  const packages = new Map(
    (document.packages ?? []).map((item) => [item.path, item.role]),
  );
  for (const [packagePath, expectedRole] of EXPECTED_PACKAGES) {
    if (!packages.has(packagePath))
      errors.push(`missing package classification ${packagePath}`);
    else if (packages.get(packagePath) !== expectedRole) {
      errors.push(`package ${packagePath} must have role ${expectedRole}`);
    }
  }
  for (const packagePath of packages.keys()) {
    if (!EXPECTED_PACKAGES.has(packagePath))
      errors.push(`unexpected package classification ${packagePath}`);
  }
  if (/https?:\/\/[^\s/"']+@/i.test(JSON.stringify(document))) {
    errors.push("registry must not contain URL userinfo");
  }
  for (const record of document.migrationRecords ?? []) {
    for (const field of [
      "id",
      "contract",
      "compatibilityWindow",
      "migrationGuidance",
      "rollback",
      "approval",
    ]) {
      if (typeof record[field] !== "string" || !record[field].trim()) {
        errors.push(`migration record ${record.id ?? "<unnamed>"} lacks ${field}`);
      }
    }
    if (!Array.isArray(record.consumerEvidence) || !record.consumerEvidence.length) {
      errors.push(`migration record ${record.id ?? "<unnamed>"} lacks consumer evidence`);
    }
  }
  return errors;
}

export function validateBootstrapCompatibility({
  currentVersion,
  baseRegistryPresent,
  baseSdl,
  currentSdl,
  baseCatalog,
  currentCatalog,
}) {
  const errors = [];
  if (baseRegistryPresent) return errors;
  if (currentVersion !== 1) {
    errors.push("an absent merge-base registry is permitted only for registry version 1 bootstrap");
  }
  if (
    !jsonEqual(buildGraphqlSignature(baseSdl), buildGraphqlSignature(currentSdl))
  ) {
    errors.push("version-one bootstrap GraphQL producer differs from the merge base");
  }
  if (!jsonEqual(normalizeCatalog(baseCatalog), normalizeCatalog(currentCatalog))) {
    errors.push("version-one bootstrap catalog producer differs from the merge base");
  }
  return errors;
}

function hasCompleteMigrationRecord(registry, contract) {
  return (registry.migrationRecords ?? []).some(
    (record) =>
      record.contract === contract &&
      record.approval === "reviewed" &&
      typeof record.compatibilityWindow === "string" &&
      record.compatibilityWindow.length > 0 &&
      typeof record.migrationGuidance === "string" &&
      record.migrationGuidance.length > 0 &&
      typeof record.rollback === "string" &&
      record.rollback.length > 0 &&
      Array.isArray(record.consumerEvidence) &&
      record.consumerEvidence.length > 0,
  );
}

export function validateContractEvolution({
  currentRegistry,
  previousHttp,
  currentHttp,
  previousMcp,
  currentMcp,
  graphqlBreaking = [],
}) {
  const errors = [];
  for (const [label, contract, previous, current] of [
    ["HTTP", "http", previousHttp, currentHttp],
    ["MCP", "mcp", previousMcp, currentMcp],
  ]) {
    if (
      previous !== undefined &&
      current !== undefined &&
      !jsonEqual(previous, current) &&
      !hasCompleteMigrationRecord(currentRegistry, contract)
    ) {
      errors.push(`${label} contract changed without a complete reviewed migration record`);
    }
  }
  if (
    graphqlBreaking.length &&
    !hasCompleteMigrationRecord(currentRegistry, "graphql")
  ) {
    for (const change of graphqlBreaking) {
      errors.push(
        `breaking GraphQL change without a complete reviewed migration record: ${change}`,
      );
    }
  }
  return errors;
}

export function validateHttpContract(contract) {
  const errors = [];
  const expected = {
    health: ["GET", "/health"],
    graphql: ["POST", "/graphql"],
    documentAnalysis: ["POST", "/api/preferences/analysis"],
    formFill: ["POST", "/api/form-fill/pdf"],
    mcpPost: ["POST", "/mcp"],
    mcpGet: ["GET", "/mcp"],
    dcr: ["POST", "/oauth/register"],
  };
  for (const [name, [method, routePath]] of Object.entries(expected)) {
    const route = contract.routes?.[name];
    if (!route) errors.push(`HTTP fixture missing ${name}`);
    else if (route.method !== method || route.path !== routePath) {
      errors.push(`HTTP fixture ${name} method/path mismatch`);
    }
  }
  if (contract.routes?.documentAnalysis?.maxFileSizeBytes !== 10485760) {
    errors.push("document analysis default size contract mismatch");
  }
  if (contract.routes?.formFill?.maxFileSizeBytes !== 10485760) {
    errors.push("form fill default size contract mismatch");
  }
  if (
    !jsonEqual(contract.routes?.mcpGet?.response, {
      status: 405,
      headers: { Allow: "POST" },
      body: { error: "Method Not Allowed" },
    })
  ) {
    errors.push("GET /mcp contract mismatch");
  }
  for (const routeName of [
    "health",
    "graphql",
    "documentAnalysis",
    "formFill",
  ]) {
    if (!contract.routes?.[routeName]?.success?.required?.length) {
      errors.push(`HTTP fixture ${routeName} lacks required success fields`);
    }
  }
  return errors;
}

export function validateMcpContract(contract, externalClients = []) {
  const errors = [];
  const tools = new Map(
    (contract.tools ?? []).map((item) => [item.descriptor?.name, item]),
  );
  const toolNames = [...tools.keys()].sort();
  if (!jsonEqual(toolNames, EXPECTED_MCP_TOOLS)) {
    errors.push("MCP tool name set mismatch");
  }
  for (const [name, tool] of tools) {
    if (!tool.descriptor?.description || !tool.descriptor?.inputSchema) {
      errors.push(`MCP tool ${name} lacks a complete descriptor`);
    }
    if (name === "mutatePreferences") {
      if (tool.descriptor.outputSchema !== undefined) {
        errors.push("mutatePreferences must remain without outputSchema");
      }
      if (
        !jsonEqual(
          tool.descriptor.inputSchema?.properties?.operation?.enum,
          EXPECTED_MUTATION_OPERATIONS,
        )
      ) {
        errors.push("mutatePreferences operation set mismatch");
      }
      if (tool.resultEnvelope !== "text-only")
        errors.push("mutatePreferences result envelope mismatch");
    } else {
      if (!tool.descriptor.outputSchema)
        errors.push(`read tool ${name} lacks outputSchema`);
      if (tool.resultEnvelope !== "structuredContent-and-matching-json-text") {
        errors.push(`read tool ${name} result envelope mismatch`);
      }
    }
  }
  if (
    contract.server?.identity?.name !== "context-router-mcp" ||
    contract.server?.identity?.version !== "2.0.1"
  ) {
    errors.push("MCP server identity mismatch");
  }
  if (
    !contract.server?.instructions ||
    !jsonEqual(contract.server.capabilities, { tools: {}, resources: {} })
  ) {
    errors.push("MCP server instructions/capabilities mismatch");
  }
  if (
    contract.resources?.length !== 1 ||
    contract.resources[0]?.descriptor?.uri !== "schema://graphql" ||
    contract.resources[0]?.descriptor?.mimeType !== "text/plain"
  ) {
    errors.push("MCP schema resource descriptor mismatch");
  }
  const visibility = contract.visibility ?? {};
  for (const profile of ["claude", "codex"]) {
    if (
      !jsonEqual(
        [...(visibility[profile]?.tools ?? [])].sort(),
        EXPECTED_MCP_TOOLS,
      )
    ) {
      errors.push(`MCP ${profile} visibility mismatch`);
    }
  }
  for (const profile of ["fallback", "claude-read-scope"]) {
    if (
      !jsonEqual(
        [...(visibility[profile]?.tools ?? [])].sort(),
        EXPECTED_MCP_READ_TOOLS,
      )
    ) {
      errors.push(`MCP ${profile} visibility mismatch`);
    }
  }
  if (
    (visibility.unknown?.tools ?? []).length ||
    (visibility.unknown?.resources ?? []).length
  ) {
    errors.push("MCP unknown visibility must be empty");
  }
  const expectedCallbacks = new Map(
    externalClients.map((item) => [item.bucket, item.callbacks]),
  );
  for (const client of contract.clients ?? []) {
    if (
      !jsonEqual(
        client.oauth?.redirectUris ?? [],
        expectedCallbacks.get(client.key) ?? [],
      )
    ) {
      errors.push(`MCP callback set mismatch for ${client.key}`);
    }
  }
  if (
    contract.challenges?.missingToken?.status !== 401 ||
    contract.challenges?.insufficientWriteScope?.status !== 403
  ) {
    errors.push("MCP OAuth challenge status mismatch");
  }
  return errors;
}

export function validateGraphqlDocuments(files, sdl) {
  const schema = graphql.buildSchema(sdl);
  const errors = [];
  for (const [filePath, content] of files) {
    const candidates = [];
    if (filePath.endsWith(".graphql") || filePath.endsWith(".gql"))
      candidates.push(content);
    for (const match of content.matchAll(/`([\s\S]*?)`/g))
      candidates.push(match[1]);
    for (const candidate of candidates) {
      if (!/\b(?:query|mutation|subscription|fragment)\b/.test(candidate))
        continue;
      let document;
      try {
        document = graphql.parse(candidate);
      } catch {
        continue;
      }
      for (const definition of document.definitions) {
        if (
          definition.kind === graphql.Kind.OPERATION_DEFINITION &&
          !definition.name
        ) {
          errors.push(`${filePath} contains an unnamed GraphQL operation`);
        }
      }
      for (const error of graphql.validate(schema, document)) {
        errors.push(`${filePath}: ${error.message}`);
      }
    }
  }
  return errors;
}

function consumerKey(consumer) {
  return `${consumer.path}\0${consumer.kind}\0${consumer.operation}\0${JSON.stringify(consumer.rootFields ?? [])}`;
}

export function validateConsumerMap(discovered, declared) {
  const errors = [];
  const discoveredByKey = new Map(
    discovered.map((item) => [consumerKey(item), item]),
  );
  const declaredByKey = new Map();
  for (const item of declared) {
    const key = consumerKey(item);
    if (declaredByKey.has(key))
      errors.push(`duplicate consumer ${item.path} ${item.operation}`);
    declaredByKey.set(key, item);
  }
  for (const [key, item] of discoveredByKey) {
    if (!declaredByKey.has(key))
      errors.push(`missing consumer ${item.path} ${item.operation}`);
  }
  for (const [key, item] of declaredByKey) {
    if (!discoveredByKey.has(key))
      errors.push(`stale consumer ${item.path} ${item.operation}`);
  }
  return errors;
}

export function validateManifestCompatibility({
  previousVersion,
  currentVersion,
  previousSchema,
  currentSchema,
}) {
  if (
    jsonEqual(previousSchema, currentSchema) ||
    currentVersion > previousVersion
  )
    return [];
  return [`manifest schema changed without bumping version ${currentVersion}`];
}

async function collectSourceFiles(relativeRoots) {
  const files = new Map();
  async function visit(relativePath) {
    const absolutePath = path.join(repositoryRoot, relativePath);
    const info = await stat(absolutePath);
    if (info.isDirectory()) {
      for (const entry of await readdir(absolutePath)) {
        if (["node_modules", ".next", "dist", "generated"].includes(entry))
          continue;
        await visit(path.join(relativePath, entry));
      }
    } else if (/\.(?:ts|tsx|js|mjs|graphql|gql)$/.test(relativePath)) {
      files.set(relativePath, await readFile(absolutePath, "utf8"));
    }
  }
  for (const root of relativeRoots) await visit(root);
  return files;
}

async function readJson(relativePath) {
  return JSON.parse(
    await readFile(path.join(repositoryRoot, relativePath), "utf8"),
  );
}

async function readJsonFromAbsolute(absolutePath) {
  return JSON.parse(await readFile(absolutePath, "utf8"));
}

async function validateReferencedPaths(registry) {
  const errors = [];
  const referenced = new Set();
  for (const capability of registry.capabilities ?? []) {
    for (const evidence of capability.evidence ?? []) referenced.add(evidence);
  }
  for (const contract of Object.values(registry.contracts ?? {})) {
    for (const key of ["fixture", "schema", "source"]) {
      if (contract[key]) referenced.add(contract[key]);
    }
  }
  for (const relativePath of referenced) {
    try {
      await stat(path.join(repositoryRoot, relativePath));
    } catch {
      errors.push(`referenced evidence path does not exist: ${relativePath}`);
    }
  }
  return errors;
}

async function validateDynamicConsumers(registry, graphqlSignature) {
  const errors = [];
  const queryFields = graphqlSignature.types?.Query?.fields ?? {};
  for (const consumer of registry.dynamicConsumers ?? []) {
    let content;
    try {
      content = await readFile(
        path.join(repositoryRoot, consumer.path),
        "utf8",
      );
    } catch {
      errors.push(`dynamic consumer path does not exist: ${consumer.path}`);
      continue;
    }
    for (const field of consumer.rootFields ?? []) {
      if (!queryFields[field])
        errors.push(
          `dynamic consumer ${consumer.path} references unknown Query.${field}`,
        );
      const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (!new RegExp(`\\b${escaped}\\b`).test(content)) {
        errors.push(
          `dynamic consumer ${consumer.path} no longer contains Query.${field}`,
        );
      }
    }
  }
  return errors;
}

async function writeJson(relativePath, value) {
  const absolutePath = path.join(repositoryRoot, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function updateDerivedFixtures() {
  const registryPath = "docs/current/local-migration-contract-baseline.json";
  const registry = await readJson(registryPath);
  const schema = await readFile(
    path.join(repositoryRoot, "apps/backend/src/schema.gql"),
    "utf8",
  );
  const catalog = await readJson(
    "apps/backend/src/config/preferences.catalog.json",
  );
  const sourceFiles = await collectSourceFiles([
    "apps/web",
    "apps/local-orchestrator/src",
    "examples/eval",
  ]);

  await writeJson(
    registry.contracts.graphql.fixture,
    buildGraphqlSignature(schema),
  );
  await writeJson(
    registry.contracts.catalog.fixture,
    normalizeCatalog(catalog),
  );
  registry.consumers = collectGraphqlOperations(sourceFiles);
  await writeJson(registryPath, registry);
  console.log(
    `contract-baseline: updated derived GraphQL, catalog, and ${registry.consumers.length} consumer entries`,
  );
}

async function run() {
  const registryPath = "docs/current/local-migration-contract-baseline.json";
  const registry = await readJson(registryPath);
  const errors = validateBaselineDocument(registry);
  errors.push(...(await validateReferencedPaths(registry)));

  const schema = await readFile(
    path.join(repositoryRoot, "apps/backend/src/schema.gql"),
    "utf8",
  );
  const graphqlSignature = buildGraphqlSignature(schema);
  const expectedGraphql = await readJson(registry.contracts.graphql.fixture);
  if (!jsonEqual(graphqlSignature, expectedGraphql)) {
    errors.push("GraphQL semantic signature differs from the baseline fixture");
  }
  const queryFields = Object.keys(graphqlSignature.types.Query?.fields ?? {});
  const mutationFields = Object.keys(
    graphqlSignature.types.Mutation?.fields ?? {},
  );
  if (
    queryFields.length !== 15 ||
    mutationFields.length !== 15 ||
    graphqlSignature.roots.subscription !== null
  ) {
    errors.push(
      `GraphQL roots must contain 15 queries, 15 mutations, and no subscription; found ${queryFields.length}/${mutationFields.length}/${graphqlSignature.roots.subscription ?? "none"}`,
    );
  }

  const catalog = await readJson(
    "apps/backend/src/config/preferences.catalog.json",
  );
  const expectedCatalog = await readJson(registry.contracts.catalog.fixture);
  if (!jsonEqual(normalizeCatalog(catalog), expectedCatalog)) {
    errors.push("catalog semantics or copy differ from the baseline fixture");
  }
  if (Object.keys(catalog).length !== 19) {
    errors.push(
      `catalog must contain exactly 19 definitions, found ${Object.keys(catalog).length}`,
    );
  }
  if (
    catalogCopyFingerprint(catalog) !==
    registry.contracts.catalog.copyFingerprint
  ) {
    errors.push(
      "catalog copy-only fingerprint differs from the recorded baseline",
    );
  }

  const sourceFiles = await collectSourceFiles([
    "apps/web",
    "apps/local-orchestrator/src",
    "examples/eval",
  ]);
  const discoveredConsumers = collectGraphqlOperations(sourceFiles);
  errors.push(...validateConsumerMap(discoveredConsumers, registry.consumers));

  errors.push(...validateGraphqlDocuments(sourceFiles, schema));
  errors.push(...(await validateDynamicConsumers(registry, graphqlSignature)));

  const httpContract = await readJson(registry.contracts.http.fixture);
  errors.push(...validateHttpContract(httpContract));
  const mcpContract = await readJson(registry.contracts.mcp.fixture);
  errors.push(...validateMcpContract(mcpContract, registry.externalClients));
  const manifestFixture = await readJson(registry.contracts.manifest.fixture);
  const manifestSchema = await readJson(registry.contracts.manifest.schema);
  const validateManifest = new Ajv2020({ strict: false }).compile(
    manifestSchema,
  );
  if (!validateManifest(manifestFixture)) {
    errors.push(
      `manifest baseline fixture violates schema: ${JSON.stringify(validateManifest.errors)}`,
    );
  }
  if (
    manifestSchema.properties?.version?.const !==
      registry.contracts.manifest.version ||
    !manifestSchema.$id?.endsWith(
      `run-manifest-v${registry.contracts.manifest.version}.schema.json`,
    )
  ) {
    errors.push("manifest schema id/const and registry version disagree");
  }

  const baseDirectory = process.env.MIGRATION_GATE_BASELINE_DIR;
  if (baseDirectory) {
    try {
      let previousRegistry;
      try {
        previousRegistry = JSON.parse(
          await readFile(path.join(baseDirectory, registryPath), "utf8"),
        );
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      if (!previousRegistry) {
        const bootstrapMarker = JSON.parse(
          await readFile(path.join(baseDirectory, "bootstrap-v1.json"), "utf8"),
        );
        if (
          bootstrapMarker.registryAbsent !== true ||
          bootstrapMarker.baseSha !== process.env.MIGRATION_GATE_BASE_SHA
        ) {
          throw new Error("invalid version-one bootstrap marker");
        }
        const [baseSdl, baseCatalog] = await Promise.all([
          readFile(
            path.join(baseDirectory, "apps/backend/src/schema.gql"),
            "utf8",
          ),
          readJsonFromAbsolute(
            path.join(
              baseDirectory,
              "apps/backend/src/config/preferences.catalog.json",
            ),
          ),
        ]);
        errors.push(
          ...validateBootstrapCompatibility({
            currentVersion: registry.version,
            baseRegistryPresent: false,
            baseSdl,
            currentSdl: schema,
            baseCatalog,
            currentCatalog: catalog,
          }),
        );
      } else {
        const [previousGraphql, previousManifestSchema, previousHttp, previousMcp] =
          await Promise.all([
            readJsonFromAbsolute(
              path.join(
                baseDirectory,
                previousRegistry.contracts.graphql.fixture,
              ),
            ),
            readJsonFromAbsolute(
              path.join(
                baseDirectory,
                previousRegistry.contracts.manifest.schema,
              ),
            ),
            readJsonFromAbsolute(
              path.join(baseDirectory, previousRegistry.contracts.http.fixture),
            ),
            readJsonFromAbsolute(
              path.join(baseDirectory, previousRegistry.contracts.mcp.fixture),
            ),
          ]);
        const graphqlDiff = diffGraphqlSignatures(
          previousGraphql,
          graphqlSignature,
        );
        errors.push(
          ...validateContractEvolution({
            previousRegistry,
            currentRegistry: registry,
            previousHttp,
            currentHttp: httpContract,
            previousMcp,
            currentMcp: mcpContract,
            graphqlBreaking: graphqlDiff.breaking,
          }),
        );
        errors.push(
          ...validateManifestCompatibility({
            previousVersion: previousRegistry.contracts.manifest.version,
            currentVersion: registry.contracts.manifest.version,
            previousSchema: previousManifestSchema,
            currentSchema: manifestSchema,
          }),
        );
      }
    } catch (error) {
      errors.push(`unable to validate merge-base contracts: ${error.message}`);
    }
  }

  if (errors.length) {
    for (const error of errors) console.error(`contract-baseline: ${error}`);
    process.exitCode = 1;
    return;
  }

  const dispositions = Object.fromEntries(
    ["RETAIN", "REPLACE", "REMOVE", "DEFER"].map((value) => [
      value,
      registry.capabilities.filter((item) => item.disposition === value).length,
    ]),
  );
  console.log(
    `contract-baseline: ok; capabilities=${registry.capabilities.length} ` +
      `graphqlTypes=${Object.keys(graphqlSignature.types).length} ` +
      `consumers=${registry.consumers.length} catalog=${Object.keys(catalog).length}`,
  );
  console.log(
    `contract-baseline: dispositions=${JSON.stringify(dispositions)}`,
  );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    if (process.argv.includes("--update-derived-fixtures"))
      await updateDerivedFixtures();
    else await run();
  } catch (error) {
    console.error(`contract-baseline: ${error.message}`);
    process.exitCode = 1;
  }
}
