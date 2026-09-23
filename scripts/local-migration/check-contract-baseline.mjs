#!/usr/bin/env node

import { createRequire } from "node:module";
import { createHash, randomBytes } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
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
  return ast ? graphql.print(canonicalizeConstValueNode(ast)) : null;
}

const BUILT_IN_DIRECTIVE_NAMES = new Set([
  "skip",
  "include",
  "deprecated",
  "specifiedBy",
  "oneOf",
]);

function canonicalizeConstValueNode(node) {
  if (!node) return node;
  if (node.kind === graphql.Kind.OBJECT) {
    return {
      ...node,
      fields: [...node.fields]
        .sort((left, right) => left.name.value.localeCompare(right.name.value))
        .map((field) => ({
          ...field,
          value: canonicalizeConstValueNode(field.value),
        })),
    };
  }
  if (node.kind === graphql.Kind.LIST) {
    return {
      ...node,
      values: node.values.map(canonicalizeConstValueNode),
    };
  }
  return node;
}

function normalizeAppliedDirectives(...nodes) {
  return nodes
    .flatMap((node) => node?.directives ?? [])
    .filter(
      (directive) => !BUILT_IN_DIRECTIVE_NAMES.has(directive.name.value),
    )
    .map((directive) => ({
      name: directive.name.value,
      arguments: Object.fromEntries(
        [...(directive.arguments ?? [])]
          .sort((left, right) => left.name.value.localeCompare(right.name.value))
          .map((argument) => [
            argument.name.value,
            graphql.print(canonicalizeConstValueNode(argument.value)),
          ]),
      ),
    }));
}

function buildGraphqlDescriptionSnapshot(schema) {
  const types = {};
  for (const type of Object.values(schema.getTypeMap()).sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    if (type.name.startsWith("__") || !type.astNode) continue;
    const entry = { description: type.description ?? null };
    if (graphql.isObjectType(type) || graphql.isInterfaceType(type)) {
      entry.fields = Object.fromEntries(
        Object.values(type.getFields())
          .sort((left, right) => left.name.localeCompare(right.name))
          .map((field) => [
            field.name,
            {
              description: field.description ?? null,
              arguments: Object.fromEntries(
                [...field.args]
                  .sort((left, right) => left.name.localeCompare(right.name))
                  .map((argument) => [
                    argument.name,
                    argument.description ?? null,
                  ]),
              ),
            },
          ]),
      );
    } else if (graphql.isInputObjectType(type)) {
      entry.inputFields = Object.fromEntries(
        Object.values(type.getFields())
          .sort((left, right) => left.name.localeCompare(right.name))
          .map((field) => [field.name, field.description ?? null]),
      );
    } else if (graphql.isEnumType(type)) {
      entry.values = Object.fromEntries(
        type
          .getValues()
          .sort((left, right) => left.name.localeCompare(right.name))
          .map((value) => [value.name, value.description ?? null]),
      );
    }
    types[type.name] = entry;
  }
  const directives = Object.fromEntries(
    schema
      .getDirectives()
      .filter((directive) => directive.astNode)
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((directive) => [
        directive.name,
        {
          description: directive.description ?? null,
          arguments: Object.fromEntries(
            [...directive.args]
              .sort((left, right) => left.name.localeCompare(right.name))
              .map((argument) => [
                argument.name,
                argument.description ?? null,
              ]),
          ),
        },
      ]),
  );
  return {
    schema: schema.description ?? null,
    types,
    directives,
  };
}

function normalizeArgs(args) {
  return [...args]
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((argument) => ({
      name: argument.name,
      type: String(argument.type),
      hasDefault: argument.defaultValue !== undefined,
      defaultValue: printableDefault(argument.defaultValue, argument.type),
      deprecationReason: argument.deprecationReason ?? null,
      appliedDirectives: normalizeAppliedDirectives(argument.astNode),
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
          appliedDirectives: normalizeAppliedDirectives(field.astNode),
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
          appliedDirectives: normalizeAppliedDirectives(field.astNode),
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
        appliedDirectives: normalizeAppliedDirectives(
          type.astNode,
          ...(type.extensionASTNodes ?? []),
        ),
        interfaces: type
          .getInterfaces()
          .map((item) => item.name)
          .sort(),
        fields: normalizeOutputFields(type.getFields()),
      };
    } else if (graphql.isInputObjectType(type)) {
      types[type.name] = {
        kind: "INPUT_OBJECT",
        isOneOf: Boolean(type.isOneOf),
        appliedDirectives: normalizeAppliedDirectives(
          type.astNode,
          ...(type.extensionASTNodes ?? []),
        ),
        inputFields: normalizeInputFields(type.getFields()),
      };
    } else if (graphql.isEnumType(type)) {
      types[type.name] = {
        kind: "ENUM",
        appliedDirectives: normalizeAppliedDirectives(
          type.astNode,
          ...(type.extensionASTNodes ?? []),
        ),
        values: type
          .getValues()
          .map((value) => ({
            name: value.name,
            deprecationReason: value.deprecationReason ?? null,
            appliedDirectives: normalizeAppliedDirectives(value.astNode),
          }))
          .sort((left, right) => left.name.localeCompare(right.name)),
      };
    } else if (graphql.isUnionType(type)) {
      types[type.name] = {
        kind: "UNION",
        appliedDirectives: normalizeAppliedDirectives(
          type.astNode,
          ...(type.extensionASTNodes ?? []),
        ),
        members: type
          .getTypes()
          .map((item) => item.name)
          .sort(),
      };
    } else if (graphql.isScalarType(type)) {
      types[type.name] = {
        kind: "SCALAR",
        specifiedByURL: type.specifiedByURL ?? null,
        appliedDirectives: normalizeAppliedDirectives(
          type.astNode,
          ...(type.extensionASTNodes ?? []),
        ),
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
    schema: {
      appliedDirectives: normalizeAppliedDirectives(
        schema.astNode,
        ...(schema.extensionASTNodes ?? []),
      ),
    },
    descriptionFingerprint: contractFingerprint(
      buildGraphqlDescriptionSnapshot(schema),
    ),
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

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableValue(value[key])]),
    );
  }
  return value;
}

export function contractFingerprint(value) {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(stableValue(value)))
    .digest("hex")}`;
}

function printableJsonValue(value) {
  return value === undefined ? "<missing>" : JSON.stringify(value);
}

export function diffJsonValues(previous, current, location = "$") {
  if (jsonEqual(previous, current)) return [];
  if (Array.isArray(previous) && Array.isArray(current)) {
    const changes = [];
    const sharedLength = Math.min(previous.length, current.length);
    for (let index = 0; index < sharedLength; index += 1) {
      changes.push(
        ...diffJsonValues(previous[index], current[index], `${location}[${index}]`),
      );
    }
    for (let index = sharedLength; index < previous.length; index += 1) {
      changes.push(
        `removed ${location}[${index}] = ${printableJsonValue(previous[index])}`,
      );
    }
    for (let index = sharedLength; index < current.length; index += 1) {
      changes.push(
        `added ${location}[${index}] = ${printableJsonValue(current[index])}`,
      );
    }
    return changes;
  }
  if (
    previous &&
    current &&
    typeof previous === "object" &&
    typeof current === "object" &&
    !Array.isArray(previous) &&
    !Array.isArray(current)
  ) {
    const changes = [];
    const keys = [...new Set([...Object.keys(previous), ...Object.keys(current)])].sort();
    for (const key of keys) {
      const child = `${location}.${key}`;
      if (!(key in current)) {
        changes.push(`removed ${child} = ${printableJsonValue(previous[key])}`);
      } else if (!(key in previous)) {
        changes.push(`added ${child} = ${printableJsonValue(current[key])}`);
      } else {
        changes.push(...diffJsonValues(previous[key], current[key], child));
      }
    }
    return changes;
  }
  return [
    `changed ${location} from ${printableJsonValue(previous)} to ${printableJsonValue(current)}`,
  ];
}

function contractArrayIdentity(contract, location, value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (contract === "http" && location === "$.supportRoutes") {
    return typeof value.method === "string" && typeof value.path === "string"
      ? `${value.method} ${value.path}`
      : null;
  }
  if (contract !== "mcp") return null;
  if (location === "$.tools") return value.descriptor?.name ?? null;
  if (location === "$.resources") return value.descriptor?.uri ?? null;
  if (location === "$.clients") return value.key ?? null;
  return null;
}

function isRequiredInputArray(contract, location) {
  if (contract === "http") {
    return /^\$\.routes\.[^.]+\.(?:request|multipart)\.required$/.test(
      location,
    );
  }
  return (
    contract === "mcp" &&
    location.includes(".inputSchema") &&
    location.endsWith(".required")
  );
}

function isHttpResponseDomain(location) {
  return /^\$\.routes\.[^.]+\.(?:success|applicationError|errors|response|disabled)(?:\.|$)/.test(
    location,
  );
}

function arrayMutationRequiresReview(contract, location) {
  if (contract === "http") {
    return (
      isHttpResponseDomain(location) ||
      /^\$\.routes\.[^.]+\.allowedMimeTypes$/.test(location) ||
      /\.statuses$/.test(location)
    );
  }
  if (contract !== "mcp") return false;
  if (
    /^(?:\$\.oauth|\$\.dcr|\$\.challenges)(?:\.|$)/.test(location) ||
    /^\$\.clients\[key=.*\]\.(?:capabilities|targetRules|oauth\.redirectUris)(?:\.|$)/.test(
      location,
    ) ||
    /^\$\.visibility\.[^.]+\.(?:tools|resources)$/.test(location) ||
    /^\$\.(?:tools|resources)\[key=.*\]\.requiredAccess(?:\.|$)/.test(
      location,
    ) ||
    /^\$\.tools\[key=.*\]\.descriptor\.execution(?:\.|$)/.test(location)
  ) {
    return true;
  }
  if (location.includes(".outputSchema")) {
    return !location.endsWith(".examples");
  }
  if (!location.includes(".inputSchema")) return false;
  if (location.endsWith(".required")) return false;
  return !/\.(?:enum|type|anyOf|examples)$/.test(location);
}

function addedContractKeyIsBreaking(contract, location, key, value) {
  if (contract === "http") {
    if (isHttpResponseDomain(location)) return true;
    if (
      /^\$\.routes\.[^.]+$/.test(location) &&
      new Set([
        "success",
        "applicationError",
        "errors",
        "response",
        "disabled",
      ]).has(key)
    ) {
      return true;
    }
    if (/^\$\.routes\.[^.]+$/.test(location)) {
      if (new Set(["request", "multipart"]).has(key)) {
        return (
          !value ||
          typeof value !== "object" ||
          !Array.isArray(value.required) ||
          value.required.length > 0 ||
          Object.keys(value).some(
            (inputKey) => !new Set(["required", "optional"]).has(inputKey),
          )
        );
      }
      return true;
    }
    if (
      /^\$\.routes\.[^.]+\.(?:request|multipart)(?:\.|$)/.test(location)
    ) {
      if (key === "optional") return false;
      if (key === "required" && Array.isArray(value) && value.length === 0) {
        return false;
      }
      return true;
    }
  }
  if (
    contract === "mcp" &&
    (/^\$\.clients\[key=.*\]\.oauth(?:\.|$)/.test(location) ||
      (/^\$\.clients\[key=.*\]$/.test(location) &&
        new Set(["capabilities", "targetRules", "oauth"]).has(key)))
  ) {
    return true;
  }
  if (contract === "mcp" && location.includes(".inputSchema")) {
    if (location.endsWith(".properties")) return false;
    if (new Set(["description", "title", "default", "examples"]).has(key)) {
      return false;
    }
    return key !== "required" || (Array.isArray(value) && value.length > 0);
  }
  if (
    contract === "mcp" &&
    (/^(?:\$\.oauth|\$\.dcr|\$\.challenges)(?:\.|$)/.test(location) ||
      (location === "$" &&
        new Set(["oauth", "dcr", "challenges"]).has(key)))
  ) {
    return true;
  }
  if (
    contract === "mcp" &&
    ((location === "$" && new Set(["clients", "visibility"]).has(key)) ||
      location === "$.visibility")
  ) {
    return true;
  }
  if (
    contract === "mcp" &&
    /^\$\.(?:tools|resources)\[key=.*\]$/.test(location) &&
    new Set(["requiresAuth", "requiredAccess"]).has(key)
  ) {
    return true;
  }
  if (
    contract === "mcp" &&
    (/^\$\.(?:tools|resources)\[key=.*\]\.requiredAccess(?:\.|$)/.test(
      location,
    ) ||
      (/^\$\.tools\[key=.*\]\.descriptor$/.test(location) &&
        key === "execution") ||
      /^\$\.tools\[key=.*\]\.descriptor\.execution(?:\.|$)/.test(location))
  ) {
    return true;
  }
  return false;
}

function classifyContractValues(
  previous,
  current,
  contract,
  location,
  result,
) {
  if (jsonEqual(previous, current)) return;
  if (Array.isArray(previous) && Array.isArray(current)) {
    const previousIdentities = previous.map((value) =>
      contractArrayIdentity(contract, location, value),
    );
    const currentIdentities = current.map((value) =>
      contractArrayIdentity(contract, location, value),
    );
    const keyed =
      previousIdentities.every(Boolean) &&
      currentIdentities.every(Boolean) &&
      new Set(previousIdentities).size === previousIdentities.length &&
      new Set(currentIdentities).size === currentIdentities.length;
    if (keyed) {
      const previousByIdentity = new Map(
        previous.map((value, index) => [previousIdentities[index], value]),
      );
      const currentByIdentity = new Map(
        current.map((value, index) => [currentIdentities[index], value]),
      );
      for (const [identity, value] of previousByIdentity) {
        const itemLocation = `${location}[key=${JSON.stringify(identity)}]`;
        if (!currentByIdentity.has(identity)) {
          result.breaking.push(
            `removed ${itemLocation} = ${printableJsonValue(value)}`,
          );
        } else {
          classifyContractValues(
            value,
            currentByIdentity.get(identity),
            contract,
            itemLocation,
            result,
          );
        }
      }
      for (const [identity, value] of currentByIdentity) {
        if (!previousByIdentity.has(identity)) {
          const target =
            contract === "mcp" && location === "$.clients"
              ? result.breaking
              : result.additive;
          target.push(
            `added ${location}[key=${JSON.stringify(identity)}] = ${printableJsonValue(value)}`,
          );
        }
      }
      return;
    }

    const previousValues = new Map(
      previous.map((value) => [JSON.stringify(stableValue(value)), value]),
    );
    const currentValues = new Map(
      current.map((value) => [JSON.stringify(stableValue(value)), value]),
    );
    const requiredInput = isRequiredInputArray(contract, location);
    const requiresReview = arrayMutationRequiresReview(contract, location);
    for (const [fingerprint, value] of previousValues) {
      if (currentValues.has(fingerprint)) continue;
      (requiredInput && !requiresReview ? result.additive : result.breaking).push(
        `removed ${location} value = ${printableJsonValue(value)}`,
      );
    }
    for (const [fingerprint, value] of currentValues) {
      if (previousValues.has(fingerprint)) continue;
      (requiredInput || requiresReview ? result.breaking : result.additive).push(
        `${requiredInput ? "added required input" : "added"} ${location} value = ${printableJsonValue(value)}`,
      );
    }
    return;
  }
  if (
    previous &&
    current &&
    typeof previous === "object" &&
    typeof current === "object" &&
    !Array.isArray(previous) &&
    !Array.isArray(current)
  ) {
    for (const key of Object.keys(previous).sort()) {
      const child = `${location}.${key}`;
      if (!(key in current)) {
        result.breaking.push(
          `removed ${child} = ${printableJsonValue(previous[key])}`,
        );
      } else {
        classifyContractValues(
          previous[key],
          current[key],
          contract,
          child,
          result,
        );
      }
    }
    for (const key of Object.keys(current).sort()) {
      if (key in previous) continue;
      const child = `${location}.${key}`;
      const target = addedContractKeyIsBreaking(
        contract,
        location,
        key,
        current[key],
      )
        ? result.breaking
        : result.additive;
      target.push(`added ${child} = ${printableJsonValue(current[key])}`);
    }
    return;
  }
  result.breaking.push(
    `changed ${location} from ${printableJsonValue(previous)} to ${printableJsonValue(current)}`,
  );
}

function diffStructuredContract(previous, current, contract) {
  const result = { breaking: [], additive: [] };
  classifyContractValues(previous, current, contract, "$", result);
  return {
    breaking: [...new Set(result.breaking)].sort(),
    additive: [...new Set(result.additive)].sort(),
  };
}

export function diffHttpContracts(previous, current) {
  const withoutEvidence = (contract) => {
    const normalized = structuredClone(contract ?? {});
    delete normalized.runtimeEvidence;
    return normalized;
  };
  return diffStructuredContract(
    withoutEvidence(previous),
    withoutEvidence(current),
    "http",
  );
}

export function diffMcpContracts(previous, current) {
  const withoutEvidence = (contract) => {
    const normalized = structuredClone(contract ?? {});
    delete normalized.runtimeEvidence;
    delete normalized.configurationShapedNonCapabilities;
    return normalized;
  };
  return diffStructuredContract(
    withoutEvidence(previous),
    withoutEvidence(current),
    "mcp",
  );
}

function classifyDeprecationTransition(
  pathLabel,
  previousReason,
  currentReason,
  { breaking, additive },
) {
  if (previousReason === currentReason) return;
  if (previousReason === null && currentReason !== null) {
    additive.push(`deprecated ${pathLabel}`);
  } else if (previousReason !== null && currentReason === null) {
    breaking.push(`removed deprecation ${pathLabel}`);
  } else {
    breaking.push(`changed deprecation reason ${pathLabel}`);
  }
}

export function diffGraphqlSignatures(previous, current) {
  const breaking = [];
  const additive = [];
  if (
    !jsonEqual(
      previous.schema?.appliedDirectives ?? [],
      current.schema?.appliedDirectives ?? [],
    )
  ) {
    breaking.push("changed applied directives on schema");
  }
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
    if (
      !jsonEqual(
        priorType.appliedDirectives ?? [],
        nextType.appliedDirectives ?? [],
      )
    ) {
      breaking.push(`changed applied directives ${name}`);
    }

    const priorInterfaces = new Set(priorType.interfaces ?? []);
    const nextInterfaces = new Set(nextType.interfaces ?? []);
    for (const interfaceName of priorInterfaces) {
      if (!nextInterfaces.has(interfaceName)) {
        breaking.push(`${name} no longer implements ${interfaceName}`);
      }
    }
    for (const interfaceName of nextInterfaces) {
      if (!priorInterfaces.has(interfaceName)) {
        const target =
          previousTypes[interfaceName]?.kind === "INTERFACE"
            ? breaking
            : additive;
        target.push(
          previousTypes[interfaceName]?.kind === "INTERFACE"
            ? `${name} added implementation of ${interfaceName}`
            : `${name} implements ${interfaceName}`,
        );
      }
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
        if (
          !jsonEqual(
            priorField.appliedDirectives ?? [],
            nextField.appliedDirectives ?? [],
          )
        ) {
          breaking.push(`changed applied directives ${fieldPath}`);
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
          } else {
            const nextArg = nextArgs[argName];
            const priorShape = {
              type: priorArg.type,
              hasDefault: priorArg.hasDefault,
              defaultValue: priorArg.defaultValue,
              appliedDirectives: priorArg.appliedDirectives ?? [],
            };
            const nextShape = {
              type: nextArg.type,
              hasDefault: nextArg.hasDefault,
              defaultValue: nextArg.defaultValue,
              appliedDirectives: nextArg.appliedDirectives ?? [],
            };
            if (!jsonEqual(priorShape, nextShape)) {
              breaking.push(`changed argument ${fieldPath}(${argName}:)`);
            }
            classifyDeprecationTransition(
              `${fieldPath}(${argName}:)`,
              priorArg.deprecationReason ?? null,
              nextArg.deprecationReason ?? null,
              { breaking, additive },
            );
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
        classifyDeprecationTransition(
          fieldPath,
          priorField.deprecationReason,
          nextField.deprecationReason,
          { breaking, additive },
        );
      }
      for (const fieldName of Object.keys(nextType.fields ?? {})) {
        if (!priorType.fields[fieldName]) additive.push(`${name}.${fieldName}`);
      }
    } else if (priorType.inputFields) {
      const priorIsOneOf = Boolean(priorType.isOneOf);
      const nextIsOneOf = Boolean(nextType.isOneOf);
      if (!priorIsOneOf && nextIsOneOf) {
        breaking.push(`${name} enabled @oneOf input semantics`);
      } else if (priorIsOneOf && !nextIsOneOf) {
        additive.push(`${name} relaxed @oneOf input semantics`);
      }
      for (const [fieldName, priorField] of Object.entries(
        priorType.inputFields,
      )) {
        const fieldPath = `${name}.${fieldName}`;
        const nextField = nextType.inputFields?.[fieldName];
        if (!nextField) {
          breaking.push(`removed input field ${fieldPath}`);
          continue;
        }
        const priorShape = {
          type: priorField.type,
          hasDefault: priorField.hasDefault,
          defaultValue: priorField.defaultValue,
          appliedDirectives: priorField.appliedDirectives ?? [],
        };
        const nextShape = {
          type: nextField.type,
          hasDefault: nextField.hasDefault,
          defaultValue: nextField.defaultValue,
          appliedDirectives: nextField.appliedDirectives ?? [],
        };
        if (!jsonEqual(priorShape, nextShape)) {
          breaking.push(`changed input field ${fieldPath}`);
        }
        classifyDeprecationTransition(
          fieldPath,
          priorField.deprecationReason ?? null,
          nextField.deprecationReason ?? null,
          { breaking, additive },
        );
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
        else {
          if (
            !jsonEqual(
              priorValue.appliedDirectives ?? [],
              nextValues.get(valueName).appliedDirectives ?? [],
            )
          ) {
            breaking.push(`changed applied directives ${name}.${valueName}`);
          }
          classifyDeprecationTransition(
            `${name}.${valueName}`,
            priorValue.deprecationReason,
            nextValues.get(valueName).deprecationReason,
            { breaking, additive },
          );
        }
      }
      for (const valueName of nextValues.keys()) {
        if (!priorValues.has(valueName)) {
          breaking.push(`added enum value ${name}.${valueName}`);
        }
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
        if (!priorMembers.has(member)) {
          breaking.push(`added union member ${name}.${member}`);
        }
      }
    } else if (
      priorType.kind === "SCALAR" &&
      priorType.specifiedByURL !== nextType.specifiedByURL
    ) {
      breaking.push(`${name} specifiedByURL changed`);
    }
  }
  for (const name of Object.keys(currentTypes)) {
    if (previousTypes[name]) continue;
    additive.push(name);
    for (const interfaceName of currentTypes[name].interfaces ?? []) {
      if (previousTypes[interfaceName]?.kind === "INTERFACE") {
        breaking.push(
          `${name} added implementation of existing interface ${interfaceName}`,
        );
      }
    }
  }

  for (const root of ["query", "mutation", "subscription"]) {
    const priorRoot = previous.roots?.[root] ?? null;
    const nextRoot = current.roots?.[root] ?? null;
    if (priorRoot === nextRoot) continue;
    if (priorRoot === null && nextRoot !== null) {
      additive.push(`added ${root} root ${nextRoot}`);
    } else if (priorRoot !== null && nextRoot === null) {
      breaking.push(`removed ${root} root ${priorRoot}`);
    } else {
      breaking.push(`${root} root changed from ${priorRoot} to ${nextRoot}`);
    }
  }

  const previousDirectives = previous.directives ?? {};
  const currentDirectives = current.directives ?? {};
  for (const [name, priorDirective] of Object.entries(previousDirectives)) {
    const nextDirective = currentDirectives[name];
    if (!nextDirective) {
      breaking.push(`removed directive @${name}`);
      continue;
    }
    if (priorDirective.repeatable && !nextDirective.repeatable) {
      breaking.push(`directive @${name} is no longer repeatable`);
    } else if (!priorDirective.repeatable && nextDirective.repeatable) {
      additive.push(`directive @${name} is repeatable`);
    }
    const priorLocations = new Set(priorDirective.locations ?? []);
    const nextLocations = new Set(nextDirective.locations ?? []);
    for (const location of priorLocations) {
      if (!nextLocations.has(location)) {
        breaking.push(`removed directive @${name} location ${location}`);
      }
    }
    for (const location of nextLocations) {
      if (!priorLocations.has(location)) {
        additive.push(`directive @${name} location ${location}`);
      }
    }
    const priorArgs = new Map(
      (priorDirective.args ?? []).map((argument) => [argument.name, argument]),
    );
    const nextArgs = new Map(
      (nextDirective.args ?? []).map((argument) => [argument.name, argument]),
    );
    for (const [argName, priorArg] of priorArgs) {
      if (!nextArgs.has(argName)) {
        breaking.push(`removed directive @${name}(${argName}:)`);
      } else {
        const nextArg = nextArgs.get(argName);
        const priorShape = {
          type: priorArg.type,
          hasDefault: priorArg.hasDefault,
          defaultValue: priorArg.defaultValue,
          appliedDirectives: priorArg.appliedDirectives ?? [],
        };
        const nextShape = {
          type: nextArg.type,
          hasDefault: nextArg.hasDefault,
          defaultValue: nextArg.defaultValue,
          appliedDirectives: nextArg.appliedDirectives ?? [],
        };
        if (!jsonEqual(priorShape, nextShape)) {
          breaking.push(`changed directive @${name}(${argName}:)`);
        }
        classifyDeprecationTransition(
          `directive @${name}(${argName}:)`,
          priorArg.deprecationReason ?? null,
          nextArg.deprecationReason ?? null,
          { breaking, additive },
        );
      }
    }
    for (const [argName, nextArg] of nextArgs) {
      if (priorArgs.has(argName)) continue;
      if (nextArg.type.endsWith("!") && nextArg.defaultValue === null) {
        breaking.push(`added required directive @${name}(${argName}:)`);
      } else {
        additive.push(`directive @${name}(${argName}:)`);
      }
    }
  }
  for (const name of Object.keys(currentDirectives)) {
    if (!previousDirectives[name]) additive.push(`directive @${name}`);
  }

  return {
    breaking: [...new Set(breaking)].sort(),
    additive: [...new Set(additive)].sort(),
  };
}

function collectOperationRootFields(document, operation) {
  const fields = new Set();
  const fragments = new Map(
    document.definitions
      .filter((definition) => definition.kind === graphql.Kind.FRAGMENT_DEFINITION)
      .map((definition) => [definition.name.value, definition]),
  );
  const visitedFragments = new Set();
  const visit = (selectionSet) => {
    for (const selection of selectionSet?.selections ?? []) {
      if (selection.kind === graphql.Kind.FIELD) {
        fields.add(selection.name.value);
      } else if (selection.kind === graphql.Kind.INLINE_FRAGMENT) {
        visit(selection.selectionSet);
      } else if (selection.kind === graphql.Kind.FRAGMENT_SPREAD) {
        const name = selection.name.value;
        if (visitedFragments.has(name)) continue;
        visitedFragments.add(name);
        visit(fragments.get(name)?.selectionSet);
      }
    }
  };
  visit(operation?.selectionSet);
  return [...fields].sort();
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
          rootFields: collectOperationRootFields(document, definition),
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

function contractReferenceKey(reference) {
  return `${reference.path}\0${reference.contract}\0${reference.kind}\0${reference.reference}`;
}

function containsNamedReference(content, reference) {
  const escaped = reference.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^A-Za-z0-9_])${escaped}([^A-Za-z0-9_]|$)`).test(
    content,
  );
}

function containsRouteReference(content, reference) {
  const wildcard = reference.endsWith("/*");
  const route = wildcard ? reference.slice(0, -1) : reference;
  const escaped = route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const trailingBoundary = wildcard ? "" : "(?![A-Za-z0-9_/-])";
  const directPath = new RegExp(
    `(?:^|[\\s\"'\\x60(=,:\\[])${escaped}${trailingBoundary}`,
  );
  const absoluteUrl = new RegExp(
    `https?:\\/\\/[^/\\s\"'\\x60?#]+${escaped}${trailingBoundary}`,
  );
  const variableBase = new RegExp(
    `(?:\\}|\\$[A-Za-z_][A-Za-z0-9_]*)${escaped}${trailingBoundary}`,
  );
  return (
    directPath.test(content) ||
    absoluteUrl.test(content) ||
    variableBase.test(content)
  );
}

export function collectContractReferences(
  files,
  { httpContract = {}, mcpContract = {} } = {},
) {
  const references = new Map();
  const routeSurfaces = [];
  for (const route of Object.values(httpContract.routes ?? {})) {
    for (const routePath of [
      ...(typeof route?.path === "string" ? [route.path] : []),
      ...(Array.isArray(route?.paths) ? route.paths : []),
    ]) {
      routeSurfaces.push({
        contract: routePath === "/mcp" ? "mcp" : "http",
        kind: "route",
        reference: routePath,
      });
    }
  }
  for (const route of httpContract.supportRoutes ?? []) {
    routeSurfaces.push({
      contract: "http",
      kind: "route",
      reference: route.path,
    });
  }
  const uniqueRoutes = new Map(
    routeSurfaces.map((surface) => [
      `${surface.contract}\0${surface.reference}`,
      surface,
    ]),
  );
  const tools = (mcpContract.tools ?? [])
    .map((tool) => tool.descriptor?.name)
    .filter(Boolean);
  const resources = (mcpContract.resources ?? [])
    .map((resource) => resource.descriptor?.uri)
    .filter(Boolean);

  for (const [filePath, content] of files) {
    for (const surface of uniqueRoutes.values()) {
      const found = containsRouteReference(content, surface.reference);
      if (!found) continue;
      const item = { path: filePath, ...surface };
      references.set(contractReferenceKey(item), item);
    }
    for (const tool of tools) {
      if (!containsNamedReference(content, tool)) continue;
      const item = {
        path: filePath,
        contract: "mcp",
        kind: "tool",
        reference: tool,
      };
      references.set(contractReferenceKey(item), item);
    }
    for (const resource of resources) {
      if (!content.includes(resource)) continue;
      const item = {
        path: filePath,
        contract: "mcp",
        kind: "resource",
        reference: resource,
      };
      references.set(contractReferenceKey(item), item);
    }
  }
  return [...references.values()].sort((left, right) =>
    contractReferenceKey(left).localeCompare(contractReferenceKey(right)),
  );
}

export function validateContractReferenceMap(discovered, declared) {
  const errors = [];
  const discoveredByKey = new Map(
    (discovered ?? []).map((item) => [contractReferenceKey(item), item]),
  );
  const declaredByKey = new Map();
  for (const item of declared ?? []) {
    const key = contractReferenceKey(item);
    if (declaredByKey.has(key)) {
      errors.push(
        `duplicate contract reference ${item.path} ${item.reference}`,
      );
    }
    declaredByKey.set(key, item);
  }
  for (const [key, item] of discoveredByKey) {
    if (!declaredByKey.has(key)) {
      errors.push(`missing contract reference ${item.path} ${item.reference}`);
    }
  }
  for (const [key, item] of declaredByKey) {
    if (!discoveredByKey.has(key)) {
      errors.push(`stale contract reference ${item.path} ${item.reference}`);
    }
  }
  return errors;
}

const OUTBOUND_SINK_PATTERNS = [
  ["fetch", /\b(?:fetch|fetchImpl)\s*\(/g],
  ["spawn", /\b(?:spawn|spawnProcess)\s*\(/g],
  ["subprocess-wrapper", /(?<!function\s)\b(?:runCommand|commandRunner)\s*\(/g],
  ["exec-file", /\bexecFile(?:Async)?\s*\(/g],
  ["dns-lookup", /\bdns\.lookup\s*\(/g],
  [
    "postgresql-client",
    /(?:new\s+\(pgFor\([^)]*\)\.Client\)\s*\(|new\s+Client\s*\(\s*configuration\s*\))/g,
  ],
  ["vertex-ai", /new\s+VertexAI\s*\(/g],
  ["auth0-management", /new\s+ManagementClient\s*\(/g],
  ["auth0-authentication", /new\s+AuthenticationClient\s*\(/g],
  ["auth0-jwks", /(?:new\s+JwksClient|passportJwtSecret)\s*\(/g],
  ["auth0-browser", /new\s+Auth0Client\s*\(/g],
  ["apollo-http-link", /new\s+HttpLink\s*\(/g],
  ["postgresql", /new\s+PrismaPg\s*\(new\s+Pool\s*\(/g],
  ["python-urlopen", /urllib\.request\.urlopen\s*\(/g],
  [
    "python-subprocess",
    /\bsubprocess\.(?:run|Popen|check_call|check_output)\s*\(/g,
  ],
  ["huggingface-download", /\bsnapshot_download\s*\(/g],
  ["http-client", /(?:https?\.(?:get|request)|axios\.(?:get|post|request))\s*\(/g],
  ["net-connect", /\bnet\.connect\s*\(/g],
  ["websocket", /new\s+(?:WebSocket|EventSource)\s*\(/g],
];

export function collectOutboundSinkInventory(files) {
  const inventory = [];
  for (const [filePath, content] of [...files.entries()].sort(
    ([left], [right]) => left.localeCompare(right),
  )) {
    const sinks = {};
    for (const [name, pattern] of OUTBOUND_SINK_PATTERNS) {
      pattern.lastIndex = 0;
      const count = [...content.matchAll(pattern)].length;
      if (count) sinks[name] = count;
    }
    if (filePath.endsWith(".sh")) {
      const executableLines = content
        .split(/\r?\n/)
        .filter((line) => {
          const trimmed = line.trim();
          return (
            trimmed &&
            !trimmed.startsWith("#") &&
            !trimmed.startsWith("echo")
          );
        });
      const curlCount = executableLines.filter((line) => /\bcurl\b/.test(line)).length;
      if (curlCount) sinks.curl = curlCount;
      const pipInstallCount = executableLines.filter((line) =>
        /\b(?:pip\s+install|-m\s+pip\s+install)\b/.test(line),
      ).length;
      if (pipInstallCount) sinks["pip-install"] = pipInstallCount;
      const dockerCount = executableLines.filter((line) =>
        /\bdocker\s+info\b/.test(line),
      ).length;
      if (dockerCount) sinks.docker = dockerCount;
      const harborCount = executableLines.filter((line) =>
        /(?:\$\{HARBOR_BIN\}|\bharbor)"?\s+run\b/.test(line),
      ).length;
      if (harborCount) sinks.harbor = harborCount;
    }
    if (Object.keys(sinks).length) {
      inventory.push({
        path: filePath,
        sinks: Object.fromEntries(
          Object.entries(sinks).sort(([left], [right]) =>
            left.localeCompare(right),
          ),
        ),
      });
    }
  }
  return inventory;
}

export function validateOutboundSinkInventory(
  discovered,
  declared,
  outboundCalls,
) {
  const errors = [];
  const discoveredByPath = new Map(
    (discovered ?? []).map((item) => [item.path, item]),
  );
  const declaredByPath = new Map();
  for (const item of declared ?? []) {
    if (!item?.path || declaredByPath.has(item.path)) {
      errors.push(`duplicate or missing outbound sink path ${item?.path ?? "<missing>"}`);
      continue;
    }
    if (
      !item.sinks ||
      typeof item.sinks !== "object" ||
      !Object.keys(item.sinks).length ||
      Object.values(item.sinks).some(
        (count) => !Number.isInteger(count) || count < 1,
      )
    ) {
      errors.push(`outbound sink ${item.path} has invalid counts`);
    }
    declaredByPath.set(item.path, item);
  }
  for (const [filePath, item] of discoveredByPath) {
    const expected = declaredByPath.get(filePath);
    if (!expected) {
      errors.push(`missing outbound sink inventory ${filePath}`);
    } else if (!jsonEqual(item.sinks, expected.sinks)) {
      errors.push(`outbound sink counts changed for ${filePath}`);
    }
  }
  for (const filePath of declaredByPath.keys()) {
    if (!discoveredByPath.has(filePath)) {
      errors.push(`stale outbound sink inventory ${filePath}`);
    }
  }
  const classifiedPaths = new Set(
    (outboundCalls ?? []).flatMap((outbound) =>
      (outbound.sources ?? []).map((source) => source.path),
    ),
  );
  for (const filePath of discoveredByPath.keys()) {
    if (!classifiedPaths.has(filePath)) {
      errors.push(`unclassified outbound sink ${filePath}`);
    }
  }
  return errors;
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

export function diffCatalogContracts(previous, current) {
  const breaking = [];
  const additive = [];
  const copyOnly = [];
  const previousSemantic = previous?.semantic ?? {};
  const currentSemantic = current?.semantic ?? {};
  const previousCopy = previous?.copy ?? {};
  const currentCopy = current?.copy ?? {};

  for (const slug of Object.keys(previousSemantic).sort()) {
    if (!(slug in currentSemantic)) {
      breaking.push(`removed catalog semantic ${slug}`);
      continue;
    }
    for (const change of diffJsonValues(
      previousSemantic[slug],
      currentSemantic[slug],
      `catalog semantic ${slug}`,
    )) {
      breaking.push(change.replace(/^changed catalog semantic /, "changed catalog semantic "));
    }
  }
  for (const slug of Object.keys(currentSemantic).sort()) {
    if (!(slug in previousSemantic)) {
      additive.push(`added catalog semantic ${slug}`);
    }
  }
  for (const slug of Object.keys(previousCopy).sort()) {
    if (!(slug in currentCopy) || !(slug in currentSemantic)) continue;
    copyOnly.push(
      ...diffJsonValues(
        previousCopy[slug],
        currentCopy[slug],
        `catalog copy ${slug}`,
      ),
    );
  }

  return { breaking, additive, copyOnly };
}

export function validateBaselineDocument(document) {
  const errors = [];
  if (!Number.isInteger(document.version) || document.version < 1) {
    errors.push("registry version must be a positive integer");
  }
  if (document.version === 1) {
    if (typeof document.supportedMode !== "string" || !document.supportedMode) {
      errors.push("version-one registry supportedMode must be a non-empty string");
    }
    if (Object.hasOwn(document, "supportedModes")) {
      errors.push("version-one registry must not use supportedModes");
    }
  } else {
    if (
      !Array.isArray(document.supportedModes) ||
      !document.supportedModes.length ||
      document.supportedModes.some(
        (mode) => typeof mode !== "string" || !mode.trim(),
      ) ||
      new Set(document.supportedModes).size !== document.supportedModes.length
    ) {
      errors.push(
        "registry supportedModes must be a non-empty array of unique strings",
      );
    }
    if (Object.hasOwn(document, "supportedMode")) {
      errors.push("version-two registry must use supportedModes, not supportedMode");
    }
  }
  if (!Array.isArray(document.capabilities))
    errors.push("capabilities must be an array");
  if (!document.contracts || typeof document.contracts !== "object") {
    errors.push("contracts must be an object");
  }
  if (!Array.isArray(document.outboundCalls))
    errors.push("outboundCalls must be an array");
  if (!Array.isArray(document.packages))
    errors.push("packages must be an array");
  if (!Array.isArray(document.consumers))
    errors.push("consumers must be an array");
  if (!Array.isArray(document.dynamicConsumers))
    errors.push("dynamicConsumers must be an array");
  if (!Array.isArray(document.fingerprintConsumers))
    errors.push("fingerprintConsumers must be an array");
  if (!Array.isArray(document.externalClients))
    errors.push("externalClients must be an array");
  if (!Array.isArray(document.contractReferences))
    errors.push("contractReferences must be an array");
  if (!Array.isArray(document.outboundSinkInventory))
    errors.push("outboundSinkInventory must be an array");
  if (!Array.isArray(document.migrationRecords))
    errors.push("migrationRecords must be an array");

  const ids = new Set();
  const validOwnerStep = /^(?:0[1-9]|1[01])$/;
  for (const capability of document.capabilities ?? []) {
    if (typeof capability.id !== "string" || !capability.id.trim()) {
      errors.push("capability has a missing id");
    } else if (ids.has(capability.id)) {
      errors.push(`duplicate capability id ${capability.id}`);
    } else {
      ids.add(capability.id);
    }
    if (typeof capability.label !== "string" || !capability.label.trim()) {
      errors.push(`capability ${capability.id || "<unnamed>"} has a missing label`);
    }
    if (
      !Array.isArray(capability.evidence) ||
      !capability.evidence.length ||
      capability.evidence.some(
        (evidencePath) =>
          typeof evidencePath !== "string" || !evidencePath.trim(),
      )
    ) {
      errors.push(
        `capability ${capability.id || "<unnamed>"} requires at least one evidence path`,
      );
    }
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
    for (const owner of capability.ownerSteps ?? []) {
      if (!validOwnerStep.test(owner)) {
        errors.push(`capability ${capability.id} has invalid owner step ${owner}`);
      }
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

  const packages = new Map();
  for (const item of document.packages ?? []) {
    if (!item?.path || packages.has(item.path)) {
      errors.push(`duplicate or missing package path ${item?.path ?? "<missing>"}`);
      continue;
    }
    packages.set(item.path, item.role);
    if (!/^(?:all|(?:0[1-9]|1[01])(?:-(?:0[1-9]|1[01]))?)$/.test(item.migrationOwner ?? "")) {
      errors.push(`package ${item.path} has invalid migration owner`);
    }
  }
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
  const externalClientBuckets = new Set();
  for (const client of document.externalClients ?? []) {
    const bucket = client?.bucket ?? "<missing>";
    if (
      typeof client?.bucket !== "string" ||
      !client.bucket.trim() ||
      externalClientBuckets.has(client.bucket)
    ) {
      errors.push(`duplicate or missing external client bucket ${bucket}`);
    }
    externalClientBuckets.add(client?.bucket);
    if (!Array.isArray(client?.callbacks)) {
      errors.push(`external client bucket ${bucket} callbacks must be an array`);
      continue;
    }
    const callbacks = new Set();
    for (const callback of client.callbacks) {
      if (
        typeof callback !== "string" ||
        !callback.trim() ||
        callbacks.has(callback)
      ) {
        errors.push(`external client bucket ${bucket} has a duplicate or invalid callback`);
      }
      callbacks.add(callback);
    }
  }
  const outboundIds = new Set();
  for (const outbound of document.outboundCalls ?? []) {
    if (!outbound?.id || outboundIds.has(outbound.id)) {
      errors.push(`duplicate or missing outbound call id ${outbound?.id ?? "<missing>"}`);
    }
    outboundIds.add(outbound?.id);
    for (const field of ["destination", "payload"]) {
      if (typeof outbound?.[field] !== "string" || !outbound[field].trim()) {
        errors.push(`outbound call ${outbound?.id ?? "<unnamed>"} lacks ${field}`);
      }
    }
    if (!Array.isArray(outbound?.sources) || !outbound.sources.length) {
      errors.push(`outbound call ${outbound?.id ?? "<unnamed>"} has no sources`);
    }
    const sourcePaths = new Set();
    for (const source of outbound?.sources ?? []) {
      if (!source?.path || sourcePaths.has(source.path)) {
        errors.push(`outbound call ${outbound?.id ?? "<unnamed>"} has a duplicate or missing source path`);
      }
      sourcePaths.add(source?.path);
      if (
        !Array.isArray(source?.fingerprints) ||
        !source.fingerprints.length ||
        source.fingerprints.some(
          (fingerprint) => typeof fingerprint !== "string" || !fingerprint,
        )
      ) {
        errors.push(`outbound call ${outbound?.id ?? "<unnamed>"} source ${source?.path ?? "<missing>"} lacks fingerprints`);
      }
    }
    if (typeof outbound?.defaultRuntime !== "boolean") {
      errors.push(`outbound call ${outbound?.id ?? "<unnamed>"} lacks defaultRuntime`);
    }
    if (!["RETAIN", "REPLACE", "REMOVE", "DEFER"].includes(outbound?.disposition)) {
      errors.push(`outbound call ${outbound?.id ?? "<unnamed>"} has invalid disposition`);
    }
    if (!Array.isArray(outbound?.ownerSteps) || !outbound.ownerSteps.length) {
      errors.push(`outbound call ${outbound?.id ?? "<unnamed>"} has no owner step`);
    }
    for (const owner of outbound?.ownerSteps ?? []) {
      if (!validOwnerStep.test(owner)) {
        errors.push(`outbound call ${outbound?.id ?? "<unnamed>"} has invalid owner step ${owner}`);
      }
    }
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
      "fromFingerprint",
      "toFingerprint",
    ]) {
      if (typeof record[field] !== "string" || !record[field].trim()) {
        errors.push(`migration record ${record.id ?? "<unnamed>"} lacks ${field}`);
      }
    }
    if (!/^sha256:[a-f0-9]{64}$/.test(record.fromFingerprint ?? "")) {
      errors.push(`migration record ${record.id ?? "<unnamed>"} has invalid fromFingerprint`);
    }
    if (!/^sha256:[a-f0-9]{64}$/.test(record.toFingerprint ?? "")) {
      errors.push(`migration record ${record.id ?? "<unnamed>"} has invalid toFingerprint`);
    }
    if (!Array.isArray(record.breakingChanges) || !record.breakingChanges.length) {
      errors.push(`migration record ${record.id ?? "<unnamed>"} lacks exact breaking changes`);
    }
    if (
      record.additiveReplacement?.description?.trim().length < 10 ||
      typeof record.additiveReplacement?.evidencePath !== "string"
    ) {
      errors.push(`migration record ${record.id ?? "<unnamed>"} lacks additive replacement evidence`);
    }
    if (!Array.isArray(record.consumerEvidence) || !record.consumerEvidence.length) {
      errors.push(`migration record ${record.id ?? "<unnamed>"} lacks consumer evidence`);
    }
    const consumerIds = new Set();
    for (const evidence of record.consumerEvidence ?? []) {
      if (
        typeof evidence?.path !== "string" ||
        !evidence.path.trim() ||
        typeof evidence?.consumerId !== "string" ||
        !evidence.consumerId.trim() ||
        !["migrated", "verified-unaffected"].includes(evidence.outcome)
      ) {
        errors.push(`migration record ${record.id ?? "<unnamed>"} has invalid consumer evidence`);
      }
      if (consumerIds.has(evidence?.consumerId)) {
        errors.push(
          `migration record ${record.id ?? "<unnamed>"} has duplicate consumer evidence ${evidence.consumerId}`,
        );
      }
      consumerIds.add(evidence?.consumerId);
    }
  }
  return errors;
}

export function validateRegistryMode(registry, gateManifest) {
  const activeModes = (gateManifest.supportedModes ?? [])
      .filter((mode) => mode?.status === "active")
      .map((mode) => mode.id);
  if (registry.version === 1) {
    return activeModes.includes(registry.supportedMode)
      ? []
      : [
          `registry supportedMode ${JSON.stringify(registry.supportedMode)} must name an active gate mode`,
        ];
  }
  return jsonEqual(registry.supportedModes, activeModes)
    ? []
    : [
        `registry supportedModes ${JSON.stringify(registry.supportedModes)} must exactly name the active gate modes ${JSON.stringify(activeModes)}`,
      ];
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

function indexProtectedRows(rows, key, fields) {
  return Object.fromEntries(
    [...rows]
      .filter((row) => typeof row?.[key] === "string" && row[key])
      .sort((left, right) => left[key].localeCompare(right[key]))
      .map((row) => [
        row[key],
        Object.fromEntries(fields.map((field) => [field, row[field] ?? null])),
      ]),
  );
}

function protectedStringSet(values = []) {
  return Object.fromEntries(
    [...new Set(values.filter((value) => typeof value === "string" && value))]
      .sort()
      .map((value) => [value, true]),
  );
}

function protectedExternalClients(rows = []) {
  return Object.fromEntries(
    [...rows]
      .filter((row) => typeof row?.bucket === "string" && row.bucket)
      .sort((left, right) => left.bucket.localeCompare(right.bucket))
      .map((row) => [
        row.bucket,
        { callbacks: protectedStringSet(row.callbacks) },
      ]),
  );
}

function protectedExternalConsumers(rows = []) {
  return Object.fromEntries(
    rows
      .filter(
        (row) =>
          ["external-unknown", "mcp-auth"].includes(row?.kind) &&
          typeof row?.id === "string" &&
          row.id,
      )
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((row) => [
        row.id,
        {
          contract: row.contract ?? null,
          kind: row.kind,
          clientClass: row.clientClass ?? null,
          access: row.access ?? null,
          method: row.method ?? null,
          route: row.route ?? null,
          tool: row.tool ?? null,
          resource: row.resource ?? null,
          surfaces: protectedStringSet(row.surfaces),
          affectedContracts: protectedStringSet(row.affectedContracts),
        },
      ]),
  );
}

export function protectedRegistrySnapshot(registry) {
  return stableValue({
    capabilities: indexProtectedRows(registry.capabilities ?? [], "id", [
      "disposition",
      "contractClass",
      "ownerSteps",
    ]),
    packages: indexProtectedRows(registry.packages ?? [], "path", [
      "role",
      "migrationOwner",
    ]),
    outboundCalls: indexProtectedRows(registry.outboundCalls ?? [], "id", [
      "disposition",
      "contractClass",
      "ownerSteps",
      "defaultRuntime",
    ]),
    externalClients: protectedExternalClients(registry.externalClients),
    externalConsumers: protectedExternalConsumers(
      registry.fingerprintConsumers,
    ),
  });
}

function graphqlConsumerId(consumer) {
  return `graphql:${consumer.path}:${consumer.kind}:${consumer.operation}:${JSON.stringify(
    [...(consumer.rootFields ?? [])].sort(),
  )}`;
}

function fingerprintConsumerAffectsContract(consumer, contract) {
  if (Array.isArray(consumer.affectedContracts)) {
    return (consumer.affectedContracts ?? []).includes(contract);
  }
  if (contract === "graphql") {
    return (
      consumer.access === "graphql-schema-dependent" ||
      (consumer.contract === "mcp" &&
        consumer.resource === "schema://graphql")
    );
  }
  if (contract === "catalog") {
    return (
      (consumer.contract === "mcp" &&
        consumer.tool === "listPreferenceSlugs")
    );
  }
  return consumer.contract === contract;
}

function contractReferenceAffectsContract(reference, contract) {
  if (contract === "graphql") {
    return (
      reference.contract === "mcp" &&
      reference.kind === "resource" &&
      reference.reference === "schema://graphql"
    );
  }
  if (contract === "catalog") {
    return (
      reference.contract === "mcp" &&
      reference.reference === "listPreferenceSlugs"
    );
  }
  return reference.contract === contract;
}

function expectedConsumerEvidence(registry = {}, contract) {
  const expected = new Map();
  const add = (consumerId, consumerPath) => {
    if (
      typeof consumerId === "string" &&
      consumerId &&
      typeof consumerPath === "string" &&
      consumerPath
    ) {
      expected.set(consumerId, consumerPath);
    }
  };
  if (["graphql", "catalog"].includes(contract)) {
    for (const consumer of [
      ...(registry.consumers ?? []),
      ...(registry.dynamicConsumers ?? []),
    ]) {
      if (
        contract === "graphql" ||
        (consumer.rootFields ?? []).includes("preferenceCatalog")
      ) {
        add(graphqlConsumerId(consumer), consumer.path);
      }
    }
  }
  for (const consumer of registry.fingerprintConsumers ?? []) {
    if (fingerprintConsumerAffectsContract(consumer, contract)) {
      add(`fp:${consumer.id}`, consumer.path);
    }
  }
  for (const reference of registry.contractReferences ?? []) {
    if (contractReferenceAffectsContract(reference, contract)) {
      add(
        `ref:${reference.path}:${reference.contract}:${reference.kind}:${reference.reference}`,
        reference.path,
      );
    }
  }
  return expected;
}

function migrationRecordStatus(
  previousRegistry,
  currentRegistry,
  contract,
  previous,
  current,
  changes,
) {
  const records = (currentRegistry.migrationRecords ?? []).filter(
    (record) => record.contract === contract,
  );
  const exact = records.find(
    (record) =>
      record.fromFingerprint === contractFingerprint(previous) &&
      record.toFingerprint === contractFingerprint(current) &&
      jsonEqual([...(record.breakingChanges ?? [])].sort(), [...changes].sort()),
  );
  if (!exact) {
    return {
      status: records.length ? "stale" : "missing",
      missingConsumers: [],
    };
  }
  const evidenceById = new Map(
    (exact.consumerEvidence ?? []).map((item) => [item?.consumerId, item]),
  );
  const expectedConsumers = expectedConsumerEvidence(previousRegistry, contract);
  for (const [consumerId, consumerPath] of expectedConsumerEvidence(
    currentRegistry,
    contract,
  )) {
    expectedConsumers.set(consumerId, consumerPath);
  }
  const missingConsumers = [...expectedConsumers]
    .filter(
      ([consumerId, consumerPath]) =>
        evidenceById.get(consumerId)?.path !== consumerPath,
    )
    .map(([consumerId, consumerPath]) => ({ consumerId, path: consumerPath }));
  const consumersCovered = missingConsumers.length === 0;
  const complete =
    exact.approval === "reviewed" &&
    typeof exact.compatibilityWindow === "string" &&
    exact.compatibilityWindow.length > 0 &&
    typeof exact.migrationGuidance === "string" &&
    exact.migrationGuidance.length > 0 &&
    typeof exact.rollback === "string" &&
    exact.rollback.length > 0 &&
    exact.additiveReplacement?.description?.length > 0 &&
    exact.additiveReplacement?.evidencePath?.length > 0 &&
    Array.isArray(exact.consumerEvidence) &&
    exact.consumerEvidence.length > 0 &&
    consumersCovered;
  return {
    status: complete ? "complete" : "incomplete",
    missingConsumers,
  };
}

function requireMigrationRecord(
  errors,
  previousRegistry,
  currentRegistry,
  label,
  contract,
  previous,
  current,
  changes,
) {
  if (!changes.length) return;
  const { status, missingConsumers } = migrationRecordStatus(
    previousRegistry,
    currentRegistry,
    contract,
    previous,
    current,
    changes,
  );
  if (status === "complete") return;
  if (status === "stale") {
    errors.push(`${label} contract changed but no reviewed migration record matches the exact transition`);
  } else if (status === "incomplete") {
    const missing = missingConsumers.length
      ? `; missing or path-mismatched consumers: ${missingConsumers
          .map(({ consumerId, path }) => `${consumerId} @ ${path}`)
          .join(", ")}`
      : "";
    errors.push(
      `${label} contract changed without complete replacement and affected-consumer evidence${missing}`,
    );
  } else {
    errors.push(`${label} contract changed without a complete reviewed migration record`);
  }
}

export function validateContractEvolution({
  previousRegistry,
  currentRegistry,
  previousGraphql,
  currentGraphql,
  previousHttp,
  currentHttp,
  previousMcp,
  currentMcp,
  previousCatalog,
  currentCatalog,
  graphqlBreaking = [],
}) {
  const errors = [];
  for (const [label, contract, previous, current, diff] of [
    ["HTTP", "http", previousHttp, currentHttp, diffHttpContracts],
    ["MCP", "mcp", previousMcp, currentMcp, diffMcpContracts],
  ]) {
    if (previous === undefined || current === undefined) continue;
    requireMigrationRecord(
      errors,
      previousRegistry,
      currentRegistry,
      label,
      contract,
      previous,
      current,
      diff(previous, current).breaking,
    );
  }
  if (previousCatalog !== undefined && currentCatalog !== undefined) {
    requireMigrationRecord(
      errors,
      previousRegistry,
      currentRegistry,
      "catalog",
      "catalog",
      previousCatalog,
      currentCatalog,
      diffCatalogContracts(previousCatalog, currentCatalog).breaking,
    );
  }
  if (graphqlBreaking.length) {
    const beforeCount = errors.length;
    requireMigrationRecord(
      errors,
      previousRegistry,
      currentRegistry,
      "GraphQL",
      "graphql",
      previousGraphql ?? { unavailable: "previous GraphQL signature" },
      currentGraphql ?? { breakingChanges: [...graphqlBreaking].sort() },
      graphqlBreaking,
    );
    if (errors.length > beforeCount) {
      errors.push(...graphqlBreaking.map((change) => `breaking GraphQL change: ${change}`));
    }
  }
  if (previousRegistry) {
    const previousProtected = protectedRegistrySnapshot(previousRegistry);
    const currentProtected = protectedRegistrySnapshot(currentRegistry);
    const registryBreaking = diffJsonValues(previousProtected, currentProtected)
      .filter((change) => !change.startsWith("added "));
    if (registryBreaking.length && currentRegistry.version <= previousRegistry.version) {
      errors.push("protected registry changed without increasing the registry version");
    }
    requireMigrationRecord(
      errors,
      previousRegistry,
      currentRegistry,
      "registry",
      "registry",
      previousProtected,
      currentProtected,
      registryBreaking,
    );
  }
  return errors;
}

export function validateHttpContract(contract) {
  const errors = [];
  const supportRouteKeys = new Set();
  for (const route of contract.supportRoutes ?? []) {
    const key = `${route?.method} ${route?.path}`;
    if (supportRouteKeys.has(key)) {
      errors.push(`duplicate support route ${key}`);
    }
    supportRouteKeys.add(key);
  }
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
  if (
    !jsonEqual(contract.routes?.mcpPost?.disabled, {
      status: 503,
      body: { error: "MCP HTTP transport is disabled" },
    })
  ) {
    errors.push("disabled POST /mcp contract mismatch");
  }
  if (
    !jsonEqual(contract.routes?.dcr?.success?.constants, {
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    }) ||
    !["emptyRedirect", "invalidRedirect", "mixedRedirect"].every(
      (name) =>
        contract.routes?.dcr?.errors?.[name]?.status === 400 &&
        contract.routes.dcr.errors[name].body?.error === "invalid_redirect_uri" &&
        typeof contract.routes.dcr.errors[name].body?.error_description === "string",
    )
  ) {
    errors.push("DCR success or redirect-error contract mismatch");
  }
  if (
    !jsonEqual(contract.routes?.dcr?.errors?.missingConfiguredClientId, {
      status: 500,
      body: {
        error: "server_error",
        error_description: "OAuth client registration is not configured",
      },
    }) ||
    !jsonEqual(contract.routes?.dcr?.errors?.rateLimit, {
      status: 429,
      windowMs: 60_000,
      maxRequests: 30,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": null,
        "Access-Control-Allow-Methods": null,
        "Access-Control-Allow-Headers": null,
        "Cache-Control": null,
      },
      body: {
        error: "too_many_requests",
        error_description: "Rate limit exceeded. Try again in 60 seconds.",
      },
    })
  ) {
    errors.push("DCR configuration or rate-limit error contract mismatch");
  }
  if (
    !jsonEqual(contract.routes?.dcr?.headers, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Cache-Control": "no-store",
    })
  ) {
    errors.push("DCR header contract mismatch");
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
  const runtimeEvidence = new Map(
    (contract.runtimeEvidence ?? []).map((item) => [item?.surface, item]),
  );
  for (const surface of [
    "backend-http-e2e",
    "web-support-runtime",
    "web-support-build",
  ]) {
    const evidence = runtimeEvidence.get(surface);
    if (
      typeof evidence?.path !== "string" ||
      !evidence.path ||
      !Array.isArray(evidence.cases) ||
      !evidence.cases.length
    ) {
      errors.push(`HTTP fixture lacks ${surface} runtime evidence`);
    }
  }
  return errors;
}

export function validateRuntimeEvidence(contract, files, label) {
  const errors = [];
  for (const evidence of contract.runtimeEvidence ?? []) {
    const content = files.get(evidence.path);
    if (content === undefined) {
      errors.push(`${label} runtime evidence path does not exist: ${evidence.path}`);
      continue;
    }
    for (const caseName of evidence.cases ?? []) {
      if (!content.includes(caseName)) {
        errors.push(
          `${label} runtime evidence ${evidence.surface} no longer contains ${JSON.stringify(caseName)}`,
        );
      }
    }
  }
  return errors;
}

export function validateHttpRuntimeEvidence(contract, files) {
  return validateRuntimeEvidence(contract, files, "HTTP");
}

export function validateMcpRuntimeEvidence(contract, files) {
  return validateRuntimeEvidence(contract, files, "MCP");
}

export function validateMcpContract(contract, externalClients = []) {
  const errors = [];
  const toolKeys = new Set();
  for (const tool of contract.tools ?? []) {
    const name = tool?.descriptor?.name;
    if (toolKeys.has(name)) errors.push(`duplicate MCP tool ${name}`);
    toolKeys.add(name);
  }
  const resourceKeys = new Set();
  for (const resource of contract.resources ?? []) {
    const uri = resource?.descriptor?.uri;
    if (resourceKeys.has(uri)) errors.push(`duplicate MCP resource ${uri}`);
    resourceKeys.add(uri);
  }
  const clientKeys = new Set();
  for (const client of contract.clients ?? []) {
    if (clientKeys.has(client?.key)) {
      errors.push(`duplicate MCP client ${client?.key}`);
    }
    clientKeys.add(client?.key);
  }
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
    !jsonEqual(contract.server?.transport?.disabledPost, {
      status: 503,
      body: { error: "MCP HTTP transport is disabled" },
    })
  ) {
    errors.push("MCP disabled POST transport contract mismatch");
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
  const contractClients = new Map(
    (contract.clients ?? []).map((client) => [client.key, client]),
  );
  const expectedBuckets = [...new Set([...contractClients.keys(), "unknown"])]
    .sort();
  const declaredBuckets = externalClients
    .map((client) => client?.bucket)
    .filter((bucket) => typeof bucket === "string")
    .sort();
  if (!jsonEqual(declaredBuckets, expectedBuckets)) {
    errors.push("MCP external client bucket set mismatch");
  }
  const externalByBucket = new Map();
  for (const client of externalClients) {
    if (externalByBucket.has(client?.bucket)) {
      errors.push(`MCP duplicate external client bucket ${client?.bucket}`);
    }
    externalByBucket.set(client?.bucket, client);
    if (
      Array.isArray(client?.callbacks) &&
      new Set(client.callbacks).size !== client.callbacks.length
    ) {
      errors.push(`MCP duplicate callback in external client bucket ${client.bucket}`);
    }
  }
  for (const bucket of expectedBuckets) {
    const expectedCallbacks = [
      ...(contractClients.get(bucket)?.oauth?.redirectUris ?? []),
    ].sort();
    const actualCallbacks = [
      ...(externalByBucket.get(bucket)?.callbacks ?? []),
    ].sort();
    if (!jsonEqual(expectedCallbacks, actualCallbacks)) {
      errors.push(`MCP callback set mismatch for ${bucket}`);
    }
  }
  if (
    contract.challenges?.missingToken?.status !== 401 ||
    contract.challenges?.insufficientWriteScope?.status !== 403
  ) {
    errors.push("MCP OAuth challenge status mismatch");
  }
  if (
    !jsonEqual(contract.dcr?.cases?.missingConfiguredClientId, {
      status: 500,
      body: {
        error: "server_error",
        error_description: "OAuth client registration is not configured",
      },
    }) ||
    !jsonEqual(contract.dcr?.cases?.rateLimit, {
      status: 429,
      body: {
        error: "too_many_requests",
        error_description: "Rate limit exceeded. Try again in 60 seconds.",
      },
    }) ||
    !jsonEqual(contract.dcr?.rateLimit, {
      windowMs: 60_000,
      maxRequests: 30,
    })
  ) {
    errors.push("MCP DCR configuration or rate-limit contract mismatch");
  }
  const runtimeEvidence = new Map(
    (contract.runtimeEvidence ?? []).map((item) => [item?.surface, item]),
  );
  const mcpEvidence = runtimeEvidence.get("backend-mcp-e2e");
  if (
    typeof mcpEvidence?.path !== "string" ||
    !mcpEvidence.path ||
    !Array.isArray(mcpEvidence.cases) ||
    !mcpEvidence.cases.length
  ) {
    errors.push("MCP fixture lacks backend-mcp-e2e runtime evidence");
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

const FINGERPRINT_CONSUMER_KINDS = new Set([
  "http-route",
  "mcp-transport",
  "mcp-tool",
  "mcp-resource",
  "mcp-auth",
  "web-support-route",
  "external-unknown",
]);

export function validateFingerprintConsumers(
  consumers,
  files,
  { httpContract, mcpContract } = {},
) {
  const errors = [];
  const ids = new Set();
  const httpRoutes = new Set(
    Object.values(httpContract?.routes ?? {})
      .filter((route) => typeof route?.path === "string")
      .map((route) => `${route.method} ${route.path}`),
  );
  const supportRoutes = new Set(
    (httpContract?.supportRoutes ?? []).map(
      (route) => `${route.method} ${route.path}`,
    ),
  );
  const mcpTools = new Set(
    (mcpContract?.tools ?? []).map((tool) => tool.descriptor?.name),
  );
  const mcpResources = new Set(
    (mcpContract?.resources ?? []).map((resource) => resource.descriptor?.uri),
  );
  const mcpClientClasses = new Set([
    ...(mcpContract?.clients ?? []).map((client) => client.key),
    ...Object.keys(mcpContract?.visibility ?? {}),
  ]);
  for (const consumer of consumers ?? []) {
    const label = consumer?.id ?? "<unnamed>";
    if (!consumer?.id || ids.has(consumer.id)) {
      errors.push(`duplicate or missing fingerprint consumer id ${label}`);
    }
    ids.add(consumer?.id);
    if (!["http", "mcp"].includes(consumer?.contract)) {
      errors.push(`fingerprint consumer ${label} has invalid contract`);
    }
    if (!FINGERPRINT_CONSUMER_KINDS.has(consumer?.kind)) {
      errors.push(`fingerprint consumer ${label} has invalid kind`);
    }
    if (
      ["http-route", "web-support-route"].includes(consumer?.kind) &&
      consumer.contract !== "http"
    ) {
      errors.push(`fingerprint consumer ${label} kind ${consumer.kind} requires contract http`);
    }
    if (
      ["mcp-transport", "mcp-tool", "mcp-resource", "mcp-auth"].includes(
        consumer?.kind,
      ) &&
      consumer.contract !== "mcp"
    ) {
      errors.push(`fingerprint consumer ${label} kind ${consumer.kind} requires contract mcp`);
    }
    if (typeof consumer?.path !== "string" || !consumer.path.trim()) {
      errors.push(`fingerprint consumer ${label} lacks path`);
      continue;
    }
    if (
      ["http-route", "mcp-transport", "web-support-route"].includes(
        consumer.kind,
      )
    ) {
      if (!new Set(["GET", "POST", "OPTIONS"]).has(consumer.method)) {
        errors.push(`fingerprint consumer ${label} lacks a valid method`);
      }
      if (typeof consumer.route !== "string" || !consumer.route.startsWith("/")) {
        errors.push(`fingerprint consumer ${label} lacks a valid route`);
      }
    }
    if (consumer.kind === "mcp-tool" && !consumer.tool) {
      errors.push(`fingerprint consumer ${label} lacks an MCP tool`);
    }
    if (consumer.kind === "mcp-resource" && !consumer.resource) {
      errors.push(`fingerprint consumer ${label} lacks an MCP resource`);
    }
    if (
      consumer.kind === "mcp-auth" &&
      (!consumer.clientClass || !consumer.access)
    ) {
      errors.push(`fingerprint consumer ${label} lacks MCP auth classification`);
    }
    if (
      consumer.kind === "external-unknown" &&
      (!consumer.clientClass || !consumer.access)
    ) {
      errors.push(`fingerprint consumer ${label} lacks external classification`);
    }
    if (
      consumer.kind === "external-unknown" &&
      (!Array.isArray(consumer.affectedContracts) ||
        !consumer.affectedContracts.length ||
        consumer.affectedContracts.some(
          (contract) =>
            !new Set(["http", "graphql", "mcp", "catalog", "registry"]).has(
              contract,
            ),
        ) ||
        !consumer.affectedContracts.includes(consumer.contract) ||
        !consumer.affectedContracts.includes("registry"))
    ) {
      errors.push(
        `fingerprint consumer ${label} lacks explicit affected contracts`,
      );
    }
    if (
      consumer.kind === "external-unknown" &&
      consumer.contract === "http"
    ) {
      if (!new Set(["GET", "POST", "OPTIONS"]).has(consumer.method)) {
        errors.push(`fingerprint consumer ${label} lacks a valid method`);
      }
      if (typeof consumer.route !== "string" || !consumer.route.startsWith("/")) {
        errors.push(`fingerprint consumer ${label} lacks a valid route`);
      } else if (
        httpContract &&
        !httpRoutes.has(`${consumer.method} ${consumer.route}`)
      ) {
        errors.push(`fingerprint consumer ${label} does not match the HTTP fixture`);
      }
    }
    if (
      httpContract &&
      consumer.kind === "http-route" &&
      !httpRoutes.has(`${consumer.method} ${consumer.route}`)
    ) {
      errors.push(`fingerprint consumer ${label} does not match the HTTP fixture`);
    }
    if (
      httpContract &&
      consumer.kind === "web-support-route" &&
      !supportRoutes.has(`${consumer.method} ${consumer.route}`)
    ) {
      errors.push(`fingerprint consumer ${label} does not match a web support route fixture`);
    }
    if (
      httpContract &&
      consumer.kind === "mcp-transport" &&
      !httpRoutes.has(`${consumer.method} ${consumer.route}`)
    ) {
      errors.push(`fingerprint consumer ${label} does not match the MCP HTTP fixture`);
    }
    if (
      mcpContract &&
      consumer.kind === "mcp-tool" &&
      !mcpTools.has(consumer.tool)
    ) {
      errors.push(`fingerprint consumer ${label} does not match an MCP tool fixture`);
    }
    if (
      mcpContract &&
      consumer.kind === "mcp-resource" &&
      !mcpResources.has(consumer.resource)
    ) {
      errors.push(`fingerprint consumer ${label} does not match an MCP resource fixture`);
    }
    if (
      mcpContract &&
      consumer.kind === "mcp-auth" &&
      !mcpClientClasses.has(consumer.clientClass)
    ) {
      errors.push(`fingerprint consumer ${label} does not match an MCP auth class fixture`);
    }
    if (mcpContract && consumer.kind === "mcp-auth") {
      const visibility = mcpContract.visibility?.[consumer.clientClass];
      const expectedAffectedContracts = new Set(["mcp", "registry"]);
      if (visibility?.resources?.includes("schema://graphql")) {
        expectedAffectedContracts.add("graphql");
      }
      if (visibility?.tools?.includes("listPreferenceSlugs")) {
        expectedAffectedContracts.add("catalog");
      }
      if (
        !jsonEqual(
          protectedStringSet(consumer.affectedContracts),
          protectedStringSet([...expectedAffectedContracts]),
        )
      ) {
        errors.push(
          `fingerprint consumer ${label} affected contracts do not match MCP visibility`,
        );
      }
    }
    if (
      !Array.isArray(consumer.fingerprints) ||
      !consumer.fingerprints.length ||
      consumer.fingerprints.some(
        (fingerprint) => typeof fingerprint !== "string" || !fingerprint,
      )
    ) {
      errors.push(`fingerprint consumer ${label} lacks source fingerprints`);
      continue;
    }
    const content = files.get(consumer.path);
    if (content === undefined) {
      errors.push(`fingerprint consumer path does not exist: ${consumer.path}`);
      continue;
    }
    for (const fingerprint of consumer.fingerprints) {
      if (!content.includes(fingerprint)) {
        errors.push(
          `fingerprint consumer ${label} no longer contains ${JSON.stringify(fingerprint)}`,
        );
      }
    }
  }
  return errors;
}

export function validateExternalConsumerCoverage(consumers, httpContract) {
  const errors = [];
  const requiredRouteNames = [
    "health",
    "graphql",
    "documentAnalysis",
    "formFill",
  ];
  const declared = new Set(
    (consumers ?? [])
      .filter(
        (consumer) =>
          consumer?.kind === "external-unknown" &&
          consumer.contract === "http",
      )
      .map((consumer) => `${consumer.method} ${consumer.route}`),
  );
  for (const routeName of requiredRouteNames) {
    const route = httpContract?.routes?.[routeName];
    if (!route?.method || !route?.path) continue;
    const surface = `${route.method} ${route.path}`;
    if (!declared.has(surface)) {
      errors.push(`missing external HTTP consumer declaration for ${surface}`);
    }
  }
  return errors;
}

export function validateOutboundSourceFingerprints(outboundCalls, files) {
  const errors = [];
  for (const outbound of outboundCalls ?? []) {
    for (const source of outbound.sources ?? []) {
      const content = files.get(source.path);
      if (content === undefined) {
        errors.push(`outbound source path does not exist: ${source.path}`);
        continue;
      }
      for (const fingerprint of source.fingerprints ?? []) {
        if (!content.includes(fingerprint)) {
          errors.push(
            `outbound source ${outbound.id}/${source.path} no longer contains ${JSON.stringify(fingerprint)}`,
          );
        }
      }
    }
  }
  return errors;
}

export function validateManifestCompatibility({
  previousVersion,
  currentVersion,
  previousSchema,
  currentSchema,
  previousSchemaPath,
  currentSchemaPath,
  previousFixturePath,
  currentFixturePath,
}) {
  const errors = validateManifestVersionedPaths({
    version: currentVersion,
    schemaPath: currentSchemaPath,
    fixturePath: currentFixturePath,
  });
  errors.push(
    ...validateManifestVersionedPaths({
      version: previousVersion,
      schemaPath: previousSchemaPath,
      fixturePath: previousFixturePath,
      label: "previous manifest",
    }),
  );
  const schemaChanged = !jsonEqual(previousSchema, currentSchema);
  const versionChanged = currentVersion !== previousVersion;
  if (currentVersion < previousVersion) {
    errors.push("manifest version must not decrease");
  }
  if (schemaChanged && currentVersion <= previousVersion) {
    errors.push(`manifest schema changed without bumping version ${currentVersion}`);
  }
  if (
    versionChanged &&
    currentSchemaPath === previousSchemaPath
  ) {
    errors.push("manifest transition did not bump the versioned schema filename");
  }
  if (
    versionChanged &&
    currentFixturePath === previousFixturePath
  ) {
    errors.push("manifest transition did not bump the versioned fixture filename");
  }
  return [...new Set(errors)];
}

export function validateManifestVersionedPaths({
  version,
  schemaPath,
  fixturePath,
  label = "manifest",
}) {
  const errors = [];
  if (!Number.isInteger(version) || version < 1) {
    errors.push(`${label} version must be a positive integer`);
    return errors;
  }
  if (
    typeof schemaPath !== "string" ||
    path.posix.basename(schemaPath) !== `run-manifest-v${version}.schema.json`
  ) {
    errors.push(`${label} schema filename does not match version ${version}`);
  }
  const fixtureName =
    typeof fixturePath === "string" ? path.posix.basename(fixturePath) : "";
  if (
    !fixtureName.startsWith(`run-manifest-v${version}.`) ||
    !fixtureName.endsWith(".json")
  ) {
    errors.push(`${label} fixture filename does not match version ${version}`);
  }
  return errors;
}

async function collectSourceFiles(
  relativeRoots,
  {
    filePattern = /\.(?:ts|tsx|js|mjs|graphql|gql)$/,
    excludePattern,
  } = {},
) {
  const files = new Map();
  async function visit(relativePath) {
    if (excludePattern?.test(relativePath)) return;
    const absolutePath = path.join(repositoryRoot, relativePath);
    const info = await stat(absolutePath);
    if (info.isDirectory()) {
      for (const entry of (await readdir(absolutePath)).sort()) {
        if (["node_modules", ".next", "dist", "generated"].includes(entry))
          continue;
        await visit(path.join(relativePath, entry));
      }
    } else if (filePattern.test(relativePath)) {
      files.set(relativePath, await readFile(absolutePath, "utf8"));
    }
  }
  for (const root of relativeRoots) await visit(root);
  return files;
}

const GRAPHQL_CONSUMER_ROOTS = [
  "apps/web",
  "apps/local-orchestrator/src",
  "examples/eval",
  "scripts/local-migration/packaging-smoke.mjs",
  "scripts/local-migration/restart-smoke.mjs",
];
const CONTRACT_REFERENCE_ROOTS = [
  "README.md",
  "apps/web",
  "apps/web/.env.example",
  "apps/backend/.env.example",
  "apps/local-orchestrator/src",
  "apps/local-orchestrator/scripts",
  "apps/local-orchestrator/README.md",
  "cloudrun.env.example",
  "examples/eval/README.md",
  "examples/eval/scripts",
  "examples/eval-harbor/README.md",
  "examples/eval-harbor/modes",
  "examples/eval-harbor/scripts",
  "examples/simple-eval-example-1",
  "docs/current",
  "docs/IMPORTANT",
  "docs/plans/active/local-migration/README.md",
  "docs/plans/active/local-migration/decision-log.md",
  "docs/plans/active/local-migration/orchestration.md",
  "docs/plans/active/local-migration/step-template.md",
  "docs/plans/active/local-migration/tracks",
  "docs/useful",
  "test-auth.sh",
  "test-document-upload.sh",
  "test-graphql.sh",
  "test-vertex-ai.sh",
  "scripts/local-migration/packaging-smoke.mjs",
  "scripts/local-migration/restart-smoke.mjs",
  "scripts/local-migration/web-support-smoke.mjs",
];
const OUTBOUND_SINK_ROOTS = [
  "apps/backend/src",
  "apps/web",
  "apps/local-orchestrator/src",
  "apps/local-orchestrator/scripts",
  "examples/eval/scripts",
  "examples/eval-harbor/scripts",
  "test-auth.sh",
  "test-document-upload.sh",
  "test-graphql.sh",
  "test-vertex-ai.sh",
  "scripts/check-toolchain.mjs",
  "scripts/local-migration",
];
const DERIVED_SOURCE_EXCLUSIONS =
  /(?:^|\/)(?:__tests__|test|tests)(?:\/|$)|\.(?:spec|test)\.[^/]+$/;

async function collectContractReferenceFiles() {
  return collectSourceFiles(CONTRACT_REFERENCE_ROOTS, {
    filePattern: /\.(?:ts|tsx|js|mjs|md|sh|py|example)$/,
    excludePattern: DERIVED_SOURCE_EXCLUSIONS,
  });
}

async function collectOutboundSinkFiles() {
  const files = await collectSourceFiles(OUTBOUND_SINK_ROOTS, {
    filePattern: /\.(?:ts|tsx|js|mjs|sh|py)$/,
    excludePattern: DERIVED_SOURCE_EXCLUSIONS,
  });
  const scoringFiles = await collectSourceFiles(
    [
      "examples/eval-harbor/tasks/dynamicmem-user001-cp00-02-memory-final-v1/tests/score_dynamicmem_prediction.py",
    ],
    { filePattern: /\.py$/ },
  );
  return new Map([...files, ...scoringFiles]);
}

function isSafeRepositoryRelativePath(relativePath) {
  if (
    typeof relativePath !== "string" ||
    !relativePath ||
    relativePath.includes("\0") ||
    path.isAbsolute(relativePath) ||
    path.win32.isAbsolute(relativePath)
  ) {
    return false;
  }
  const parts = relativePath.split(/[\\/]/);
  return !parts.includes("..") && !parts.includes("") && relativePath !== ".";
}

function pathWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export async function resolveRepositoryPath(
  relativePath,
  { root = repositoryRoot, mustExist = true } = {},
) {
  if (!isSafeRepositoryRelativePath(relativePath)) {
    throw new Error(`unsafe repository path: ${relativePath}`);
  }
  const rootReal = await realpath(root);
  const candidate = path.join(rootReal, relativePath);
  if (!pathWithin(rootReal, candidate)) {
    throw new Error(`unsafe repository path: ${relativePath}`);
  }
  if (mustExist) {
    const candidateReal = await realpath(candidate);
    if (!pathWithin(rootReal, candidateReal)) {
      throw new Error(`repository path escapes repository: ${relativePath}`);
    }
    return candidateReal;
  }
  const parentReal = await realpath(path.dirname(candidate));
  if (!pathWithin(rootReal, parentReal)) {
    throw new Error(`repository path escapes repository: ${relativePath}`);
  }
  const existing = await lstat(candidate).catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (existing?.isSymbolicLink() || (existing && !existing.isFile())) {
    throw new Error(
      `repository write target must be a regular file or absent: ${relativePath}`,
    );
  }
  return candidate;
}

export async function verifyBaseArtifactBundle({
  baseDirectory,
  expectedManifestSha256,
  expectedBaseSha,
}) {
  if (!/^[a-f0-9]{64}$/.test(expectedManifestSha256 ?? "")) {
    throw new Error("merge-base artifact manifest fingerprint is missing or invalid");
  }
  const manifestPath = await resolveRepositoryPath("artifact-hashes.json", {
    root: baseDirectory,
  });
  const manifestBytes = await readFile(manifestPath);
  const actualManifestSha256 = createHash("sha256")
    .update(manifestBytes)
    .digest("hex");
  if (actualManifestSha256 !== expectedManifestSha256) {
    throw new Error("merge-base artifact manifest hash mismatch");
  }
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  if (manifest.baseSha !== expectedBaseSha) {
    throw new Error("merge-base artifact manifest base SHA mismatch");
  }
  const artifacts = new Map();
  for (const artifact of manifest.artifacts ?? []) {
    const artifactPath = await resolveRepositoryPath(artifact.path, {
      root: baseDirectory,
    });
    const bytes = await readFile(artifactPath);
    const actual = createHash("sha256").update(bytes).digest("hex");
    if (actual !== artifact.sha256) {
      throw new Error(`merge-base artifact hash mismatch: ${artifact.path}`);
    }
    if (artifacts.has(artifact.path)) {
      throw new Error(`duplicate merge-base artifact: ${artifact.path}`);
    }
    artifacts.set(artifact.path, bytes);
  }
  return artifacts;
}

async function readJson(relativePath) {
  return JSON.parse(await readFile(await resolveRepositoryPath(relativePath), "utf8"));
}

export async function validateReferencedPaths(
  registry,
  {
    pathExists = async (relativePath) => {
      try {
        await resolveRepositoryPath(relativePath);
        return true;
      } catch {
        return false;
      }
    },
  } = {},
) {
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
  for (const contractName of ["http", "mcp"]) {
    const fixturePath = registry.contracts?.[contractName]?.fixture;
    if (!fixturePath) continue;
    try {
      const contract = await readJson(fixturePath);
      for (const evidence of contract.runtimeEvidence ?? []) {
        if (evidence?.path) referenced.add(evidence.path);
      }
    } catch {
      // The fixture path itself is reported below; contract parsing is reported
      // by the main checker without weakening the repository-path policy.
    }
  }
  for (const item of registry.packages ?? []) referenced.add(item.path);
  for (const item of registry.outboundCalls ?? []) {
    for (const source of item.sources ?? []) referenced.add(source.path);
  }
  for (const item of registry.fingerprintConsumers ?? []) referenced.add(item.path);
  for (const item of registry.contractReferences ?? []) referenced.add(item.path);
  for (const item of registry.outboundSinkInventory ?? []) referenced.add(item.path);
  for (const record of registry.migrationRecords ?? []) {
    if (record.additiveReplacement?.evidencePath) {
      referenced.add(record.additiveReplacement.evidencePath);
    }
    for (const evidence of record.consumerEvidence ?? []) {
      if (evidence?.path) referenced.add(evidence.path);
    }
  }
  for (const relativePath of [...referenced].sort()) {
    if (!isSafeRepositoryRelativePath(relativePath)) {
      errors.push(`unsafe referenced evidence path: ${relativePath}`);
      continue;
    }
    if (!(await pathExists(relativePath))) {
      errors.push(`referenced evidence path does not exist: ${relativePath}`);
    }
  }
  return errors;
}

function validateDynamicConsumerAgainstSchema(consumer, content, schema) {
  const errors = [];
  if (typeof consumer.document !== "string" || !consumer.document.trim()) {
    return [`dynamic consumer ${consumer.path} lacks a canonical document`];
  }
  let document;
  try {
    document = graphql.parse(consumer.document);
  } catch (error) {
    return [`dynamic consumer ${consumer.path} document does not parse: ${error.message}`];
  }
  for (const error of graphql.validate(schema, document)) {
    errors.push(`dynamic consumer ${consumer.path}: ${error.message}`);
  }
  const definitions = document.definitions.filter(
    (definition) => definition.kind === graphql.Kind.OPERATION_DEFINITION,
  );
  if (definitions.length !== 1 || !definitions[0].name) {
    errors.push(`dynamic consumer ${consumer.path} must declare one named operation`);
  }
  if (definitions[0]?.operation !== consumer.kind) {
    errors.push(`dynamic consumer ${consumer.path} operation kind is stale`);
  }
  if (definitions[0]?.name?.value !== consumer.operation) {
    errors.push(`dynamic consumer ${consumer.path} operation name is stale`);
  }
  const rootFields = definitions[0]
    ? collectOperationRootFields(document, definitions[0])
    : [];
  if (!jsonEqual(rootFields, [...(consumer.rootFields ?? [])].sort())) {
    errors.push(`dynamic consumer ${consumer.path} root-field metadata is stale`);
  }
  if (
    !Array.isArray(consumer.sourceFingerprints) ||
    !consumer.sourceFingerprints.length
  ) {
    errors.push(`dynamic consumer ${consumer.path} lacks source fingerprints`);
  }
  for (const fingerprint of consumer.sourceFingerprints ?? []) {
    if (!content.includes(fingerprint)) {
      errors.push(
        `dynamic consumer ${consumer.path} no longer contains ${JSON.stringify(fingerprint)}`,
      );
    }
  }
  return errors;
}

export function validateDynamicConsumer(consumer, content, schemaSdl) {
  return validateDynamicConsumerAgainstSchema(
    consumer,
    content,
    graphql.buildSchema(schemaSdl),
  );
}

async function validateDynamicConsumers(registry, schemaSdl) {
  const errors = [];
  const schema = graphql.buildSchema(schemaSdl);
  for (const consumer of registry.dynamicConsumers ?? []) {
    let content;
    try {
      content = await readFile(
        await resolveRepositoryPath(consumer.path),
        "utf8",
      );
    } catch {
      errors.push(`dynamic consumer path does not exist: ${consumer.path}`);
      continue;
    }
    errors.push(
      ...validateDynamicConsumerAgainstSchema(consumer, content, schema),
    );
  }
  return errors;
}

export async function writeRepositoryJson(
  relativePath,
  value,
  { root = repositoryRoot } = {},
) {
  if (!isSafeRepositoryRelativePath(relativePath)) {
    throw new Error(`unsafe repository path: ${relativePath}`);
  }
  const absolutePath = await resolveRepositoryPath(relativePath, {
    root,
    mustExist: false,
  });
  const temporaryPath = path.join(
    path.dirname(absolutePath),
    `.${path.basename(absolutePath)}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`,
  );
  try {
    await writeFile(
      temporaryPath,
      `${JSON.stringify(value, null, 2)}\n`,
      { encoding: "utf8", flag: "wx", mode: 0o600 },
    );
    await rename(temporaryPath, absolutePath);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
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
  const [sourceFiles, referenceFiles, outboundFiles, httpContract, mcpContract] =
    await Promise.all([
      collectSourceFiles(GRAPHQL_CONSUMER_ROOTS),
      collectContractReferenceFiles(),
      collectOutboundSinkFiles(),
      readJson(registry.contracts.http.fixture),
      readJson(registry.contracts.mcp.fixture),
    ]);

  await writeRepositoryJson(
    registry.contracts.graphql.fixture,
    buildGraphqlSignature(schema),
  );
  await writeRepositoryJson(
    registry.contracts.catalog.fixture,
    normalizeCatalog(catalog),
  );
  registry.consumers = collectGraphqlOperations(sourceFiles);
  registry.contractReferences = collectContractReferences(referenceFiles, {
    httpContract,
    mcpContract,
  });
  registry.outboundSinkInventory = collectOutboundSinkInventory(outboundFiles);
  await writeRepositoryJson(registryPath, registry);
  console.log(
    `contract-baseline: updated derived GraphQL, catalog, ${registry.consumers.length} GraphQL consumers, ` +
      `${registry.contractReferences.length} public-contract references, and ` +
      `${registry.outboundSinkInventory.length} outbound sink entries`,
  );
}

export function resolveBaseComparisonMode(environment = process.env) {
  const requirement = environment.MIGRATION_GATE_REQUIRE_BASE_COMPARISON;
  if (requirement !== undefined && !new Set(["0", "1"]).has(requirement)) {
    throw new Error(
      "MIGRATION_GATE_REQUIRE_BASE_COMPARISON must be 0 or 1",
    );
  }
  const required = requirement === "1";
  const baseDirectory = environment.MIGRATION_GATE_BASELINE_DIR;
  if (required && !baseDirectory) {
    throw new Error(
      "base comparison is required but MIGRATION_GATE_BASELINE_DIR is missing",
    );
  }
  return {
    baseDirectory,
    required,
    status: baseDirectory ? "performed" : "skipped",
  };
}

async function run() {
  const registryPath = "docs/current/local-migration-contract-baseline.json";
  const registry = await readJson(registryPath);
  const errors = validateBaselineDocument(registry);
  const gateManifest = await readJson("scripts/local-migration/gate-phases.json");
  errors.push(...validateRegistryMode(registry, gateManifest));
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
  const httpContract = await readJson(registry.contracts.http.fixture);
  const mcpContract = await readJson(registry.contracts.mcp.fixture);

  const [sourceFiles, referenceFiles, outboundFiles] = await Promise.all([
    collectSourceFiles(GRAPHQL_CONSUMER_ROOTS),
    collectContractReferenceFiles(),
    collectOutboundSinkFiles(),
  ]);
  const discoveredConsumers = collectGraphqlOperations(sourceFiles);
  errors.push(...validateConsumerMap(discoveredConsumers, registry.consumers));
  const discoveredReferences = collectContractReferences(referenceFiles, {
    httpContract,
    mcpContract,
  });
  errors.push(
    ...validateContractReferenceMap(
      discoveredReferences,
      registry.contractReferences,
    ),
  );
  const discoveredOutboundSinks = collectOutboundSinkInventory(outboundFiles);
  errors.push(
    ...validateOutboundSinkInventory(
      discoveredOutboundSinks,
      registry.outboundSinkInventory,
      registry.outboundCalls,
    ),
  );

  const fingerprintFiles = new Map();
  const fingerprintPaths = [
    ...(registry.fingerprintConsumers ?? []).map((consumer) => consumer.path),
    ...(registry.outboundCalls ?? []).flatMap((outbound) =>
      (outbound.sources ?? []).map((source) => source.path),
    ),
    ...(httpContract.runtimeEvidence ?? []).map((evidence) => evidence.path),
    ...(mcpContract.runtimeEvidence ?? []).map((evidence) => evidence.path),
  ];
  for (const fingerprintPath of fingerprintPaths) {
    if (fingerprintFiles.has(fingerprintPath)) continue;
    try {
      fingerprintFiles.set(
        fingerprintPath,
        await readFile(await resolveRepositoryPath(fingerprintPath), "utf8"),
      );
    } catch {
      // validateReferencedPaths and validateFingerprintConsumers both report the
      // missing declaration with contract-specific context.
    }
  }
  errors.push(
    ...validateFingerprintConsumers(
      registry.fingerprintConsumers,
      fingerprintFiles,
      { httpContract, mcpContract },
    ),
  );
  errors.push(
    ...validateExternalConsumerCoverage(
      registry.fingerprintConsumers,
      httpContract,
    ),
  );
  errors.push(
    ...validateOutboundSourceFingerprints(
      registry.outboundCalls,
      fingerprintFiles,
    ),
  );
  errors.push(...validateHttpRuntimeEvidence(httpContract, fingerprintFiles));
  errors.push(...validateMcpRuntimeEvidence(mcpContract, fingerprintFiles));

  errors.push(...validateGraphqlDocuments(sourceFiles, schema));
  errors.push(...(await validateDynamicConsumers(registry, schema)));

  errors.push(...validateHttpContract(httpContract));
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
  errors.push(
    ...validateManifestVersionedPaths({
      version: registry.contracts.manifest.version,
      schemaPath: registry.contracts.manifest.schema,
      fixturePath: registry.contracts.manifest.fixture,
    }),
  );

  let baseComparison = {
    baseDirectory: undefined,
    required: false,
    status: "skipped",
  };
  try {
    baseComparison = resolveBaseComparisonMode(process.env);
  } catch (error) {
    errors.push(error.message);
  }
  const { baseDirectory } = baseComparison;
  if (baseDirectory) {
    try {
      const bundleArguments = {
        baseDirectory,
        expectedManifestSha256:
          process.env.MIGRATION_GATE_BASELINE_MANIFEST_SHA256,
        expectedBaseSha: process.env.MIGRATION_GATE_BASE_SHA,
      };
      const baseArtifacts = await verifyBaseArtifactBundle(bundleArguments);
      const requireBase = (relativePath) => {
        const content = baseArtifacts.get(relativePath);
        if (!content) {
          throw new Error(`verified merge-base bundle lacks ${relativePath}`);
        }
        return content;
      };
      const readBaseJson = (relativePath) =>
        JSON.parse(requireBase(relativePath).toString("utf8"));
      const previousRegistry = baseArtifacts.has(registryPath)
        ? readBaseJson(registryPath)
        : undefined;
      if (!previousRegistry) {
        const bootstrapMarker = readBaseJson("bootstrap-v1.json");
        if (
          bootstrapMarker.registryAbsent !== true ||
          bootstrapMarker.baseSha !== process.env.MIGRATION_GATE_BASE_SHA
        ) {
          throw new Error("invalid version-one bootstrap marker");
        }
        const baseSdl = requireBase("apps/backend/src/schema.gql").toString("utf8");
        const baseCatalog = readBaseJson(
          "apps/backend/src/config/preferences.catalog.json",
        );
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
        const [
          previousGraphql,
          previousCatalog,
          previousManifestSchema,
          previousHttp,
          previousMcp,
        ] = [
          readBaseJson(previousRegistry.contracts.graphql.fixture),
          readBaseJson(previousRegistry.contracts.catalog.fixture),
          readBaseJson(previousRegistry.contracts.manifest.schema),
          readBaseJson(previousRegistry.contracts.http.fixture),
          readBaseJson(previousRegistry.contracts.mcp.fixture),
        ];
        const graphqlDiff = diffGraphqlSignatures(
          previousGraphql,
          graphqlSignature,
        );
        errors.push(
          ...validateContractEvolution({
            previousRegistry,
            currentRegistry: registry,
            previousGraphql,
            currentGraphql: graphqlSignature,
            previousHttp,
            currentHttp: httpContract,
            previousMcp,
            currentMcp: mcpContract,
            previousCatalog,
            currentCatalog: expectedCatalog,
            graphqlBreaking: graphqlDiff.breaking,
          }),
        );
        errors.push(
          ...validateManifestCompatibility({
            previousVersion: previousRegistry.contracts.manifest.version,
            currentVersion: registry.contracts.manifest.version,
            previousSchema: previousManifestSchema,
            currentSchema: manifestSchema,
            previousSchemaPath: previousRegistry.contracts.manifest.schema,
            currentSchemaPath: registry.contracts.manifest.schema,
            previousFixturePath: previousRegistry.contracts.manifest.fixture,
            currentFixturePath: registry.contracts.manifest.fixture,
          }),
        );
      }
      await verifyBaseArtifactBundle(bundleArguments);
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
      `consumers=${registry.consumers.length} catalog=${Object.keys(catalog).length} ` +
      `baseComparison=${baseComparison.status}`,
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
