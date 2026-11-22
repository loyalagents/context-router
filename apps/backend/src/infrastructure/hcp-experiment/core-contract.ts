/** Pure offline pinned Core validation and bounded read contracts, shared by both bindings. */
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import core from "./mcp-core-schemas.json";

const documents: Record<string, any> = core.schemas;
const base = "https://hcp.example/schemas/2.0-draft-3/";
const copy = (name: string): any => structuredClone(documents[name]);

/** Retain source IDs as comments while making every reference document-local. */
function bundle(
  root: any,
  source: string,
  overrides: Record<string, any> = {},
): any {
  const defs: Record<string, any> = {};
  const walk = (value: any, origin: string): any => {
    if (Array.isArray(value)) return value.map((v) => walk(v, origin));
    if (value === null || typeof value !== "object") return value;
    const result: any = {};
    for (const [key, item] of Object.entries(value)) {
      if (key === "$schema") continue;
      if (key === "$id") {
        result.$comment = `Source: ${item}; pin ${core.sourceRevision}. ${value.$comment ?? ""}`;
      } else if (key === "$comment" && value.$id) continue;
      else if (key === "$ref") {
        const url = new URL(String(item), origin),
          fragment = url.hash.slice(1);
        url.hash = "";
        if (!url.href.startsWith(base)) throw new Error("Unbundled HCP schema");
        const name = url.href.slice(base.length),
          id = name.replace(/[^a-zA-Z0-9_-]/g, "_");
        if (!Object.prototype.hasOwnProperty.call(defs, id)) {
          defs[id] = {}; // Mark before recursion.
          defs[id] = walk(overrides[name] ?? documents[name], url.href);
          if (!defs[id]) throw new Error("Missing HCP schema");
        }
        result.$ref = `#/$defs/${id}${fragment}`;
      } else result[key] = walk(item, origin);
    }
    return result;
  };
  return { ...walk(root, source), $defs: defs };
}

function input(kind: "query" | "get-entry"): any {
  const source = `operations/${kind}-request.json`,
    schema = copy(source);
  schema.additionalProperties = false;
  schema.properties.purpose = { ...schema.properties.purpose, maxLength: 512 };
  schema.properties.purposeDescription = {
    type: "string",
    minLength: 1,
    maxLength: 2048,
    pattern: "\\S",
  };
  if (kind === "query") {
    schema.properties.query = {
      type: "string",
      minLength: 1,
      maxLength: 8192,
      pattern: "\\S",
    };
    schema.properties.categories = {
      type: "array",
      maxItems: 100,
      items: {
        ...schema.properties.categories.items,
        minLength: 1,
        maxLength: 512,
      },
    };
    schema.properties.maxEntries.maximum = Number.MAX_SAFE_INTEGER;
    schema.properties.maxEntries.description =
      "Positive integer; values above 20 are capped at 20.";
  } else {
    delete schema.properties.entryId;
    schema.properties.ref = { type: "string", minLength: 1 };
    schema.properties.version.maximum = Number.MAX_SAFE_INTEGER;
    schema.required.push("ref");
  }
  return { $schema: schema.$schema, ...bundle(schema, base + source) };
}

function output(kind: "query" | "get-entry"): any {
  const source = `operations/${kind}-result.json`,
    success = copy(source),
    error = copy("error.json"),
    disclosure = copy("disclosure.json");
  success.additionalProperties = false;
  success.required.push("directives");
  success.properties.minimization = {
    type: "object",
    properties: { method: { const: kind === "query" ? "lexical" : "none" } },
    required: ["method"],
    additionalProperties: false,
  };
  if (kind === "query")
    success.properties.entries.items = { $ref: "../disclosure.json" };
  else success.properties.entry = { $ref: "../disclosure.json" };
  disclosure.additionalProperties = false;
  // This slice issues neither provenance nor onward-sharing permissions.
  delete disclosure.properties.provenance;
  delete disclosure.properties.onwardSharing;
  disclosure.properties.standing.additionalProperties = false;
  disclosure.properties.relationships.items.additionalProperties = false;
  disclosure.properties.classification = structuredClone(
    documents["common.json"].$defs.classification,
  );
  disclosure.properties.classification.additionalProperties = false;
  // classification's internal refs originally belong to common.json.
  for (const property of Object.values(
    disclosure.properties.classification.properties,
  ) as any[])
    if (property.items?.$ref?.startsWith("#"))
      property.items.$ref = "common.json" + property.items.$ref;
  error.additionalProperties = false;
  const result = bundle(success, base + source, {
    "disclosure.json": disclosure,
  });
  const errorSchema = bundle(error, base + "error.json");
  const { $defs, ...successSchema } = result;
  return {
    type: "object",
    $schema: success.$schema,
    $defs,
    anyOf: [successSchema, errorSchema],
  };
}

export const READ_SCHEMAS = {
  query: { input: input("query"), output: output("query") },
  get: { input: input("get-entry"), output: output("get-entry") },
};
const ajv = new Ajv2020({
  strict: false,
  allErrors: false,
  validateFormats: true,
});
addFormats(ajv);
for (const document of Object.values(documents)) ajv.addSchema(document);
export const validCore = (schema: string, value: unknown): boolean =>
  !!ajv.getSchema(base + schema)!(value);
const directiveInput = copy("directive.json");
delete directiveInput.$id;
directiveInput.required = ["action", "effect", "text"];
// Keep the original reference base without assigning a duplicate schema identity.
for (const property of Object.values(directiveInput.properties) as any[]) {
  if (property.$ref) property.$ref = new URL(property.$ref, base).href;
  if (property.items?.$ref)
    property.items.$ref = new URL(property.items.$ref, base).href;
}
const directiveValidator = ajv.compile(directiveInput);
export const validDirectiveInput = (value: unknown): boolean =>
  !!directiveValidator(value);
const readValidators = {
  query: ajv.compile(READ_SCHEMAS.query.output),
  get: ajv.compile(READ_SCHEMAS.get.output),
};
/** Expected rejection of an otherwise admitted read; no storage failure implied. */
export class ReadResultError extends Error {
  constructor() {
    super("Invalid HCP read result");
  }
}
export function assertReadResult(
  kind: "query" | "get",
  value: unknown,
  isError = false,
): void {
  if (
    !readValidators[kind](value) ||
    !validCore(
      isError
        ? "error.json"
        : `operations/${kind === "query" ? "query" : "get-entry"}-result.json`,
      value,
    )
  )
    throw new ReadResultError();
}
