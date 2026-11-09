/** Deliberately simulated storage history; not consent, live grants or a production write API. */
export type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };
export type EntryStatus =
  | "active"
  | "deprecated"
  | "conflicted"
  | "expired"
  | "revoked"
  | "suspended"
  | "deleted";
export interface SyntheticVersion {
  content: JsonObject;
  assertion: JsonObject;
  evidence: JsonObject[];
  extensions?: JsonObject;
  recordExtensions?: JsonObject;
}
export interface SyntheticFixture {
  status: EntryStatus;
  classification: JsonObject;
  versions: SyntheticVersion[];
}
export const GENERAL_PROFILE =
  "https://hcp.example/spec/profiles/general-context/2.0";
export function syntheticFixtures(): SyntheticFixture[] {
  return (
    [
      "active",
      "active",
      "deprecated",
      "conflicted",
      "suspended",
      "deleted",
      "revoked",
    ] as EntryStatus[]
  ).map((status, index) => ({
    status,
    classification: {
      categories: [index % 2 ? "work_context" : "general_preferences"],
      dimension: "synthetic-preference",
      permittedPurposes: ["https://example.test/purpose/synthetic-review"],
    },
    versions: Array.from({ length: index === 0 ? 2 : 1 }, (_, n) => ({
      content: {
        profile: GENERAL_PROFILE,
        value:
          n === 0
            ? "Synthetic person prefers written notes."
            : {
                preference: "written notes",
                location: { room: "test-room" },
                days: ["Monday", null],
                enabled: true,
              },
        language: "en",
        extension: { nested: [false, null, { number: 1.5 }] },
      },
      assertion: {
        declarationType: "person-declared",
        confidence: null,
        validUntil: null,
        permittedPurposes: ["https://example.test/purpose/synthetic-review"],
        extension: { keep: [true, 5, null] },
      },
      evidence: [
        {
          role: "supports",
          type: "https://example.test/evidence/synthetic",
          credential: { simulated: true, opaque: [null, false, 3] },
        },
      ],
      extensions: {
        extension: { nested: [null, true, 7, "7", { unknown: ["value"] }] },
      },
      recordExtensions: {
        metadata: {
          authority: { role: "management-client", grant: true },
          explanation: "Opaque metadata confers no authority",
        },
        extension: { nested: [1, false, null] },
      },
    })),
  }));
}

function jsonValue(value: unknown): void {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (Array.isArray(value)) {
    for (const v of value) jsonValue(v);
    return;
  }
  if (
    typeof value === "object" &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    for (const v of Object.values(value)) jsonValue(v);
    return;
  }
  throw new Error("Only JSON fixture values are accepted");
}
const object = (v: unknown): v is JsonObject =>
  !!v && typeof v === "object" && !Array.isArray(v);
export function validateFixtures(
  input: SyntheticFixture[],
): SyntheticFixture[] {
  jsonValue(input);
  if (!Array.isArray(input) || input.length === 0)
    throw new Error("Synthetic fixtures required");
  for (const f of input) {
    if (
      Object.keys(f).sort().join() !== "classification,status,versions" ||
      ![
        "active",
        "deprecated",
        "conflicted",
        "suspended",
        "deleted",
        "revoked",
      ].includes(f.status) ||
      !object(f.classification) ||
      !Array.isArray(f.versions) ||
      ![1, 2].includes(f.versions.length)
    )
      throw new Error("Invalid synthetic fixture");
    const categories = f.classification.categories;
    if (
      !Array.isArray(categories) ||
      categories.length === 0 ||
      new Set(categories).size !== categories.length ||
      categories.some(
        (c) => !["general_preferences", "work_context"].includes(String(c)),
      )
    )
      throw new Error("Unsupported fixture category");
    for (const v of f.versions) {
      if (
        Object.keys(v).some(
          (k) =>
            ![
              "content",
              "assertion",
              "evidence",
              "extensions",
              "recordExtensions",
            ].includes(k),
        ) ||
        !object(v.content) ||
        v.content.profile !== GENERAL_PROFILE ||
        !(typeof v.content.value === "string" || object(v.content.value)) ||
        !object(v.assertion) ||
        v.assertion.declarationType !== "person-declared" ||
        (v.assertion.confidence !== undefined &&
          v.assertion.confidence !== null) ||
        !Array.isArray(v.evidence)
      )
        throw new Error("Unsupported fixture version");
      const until = v.assertion.validUntil;
      if (
        until !== undefined &&
        until !== null &&
        (typeof until !== "string" ||
          !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(until) ||
          !Number.isFinite(Date.parse(until)))
      )
        throw new Error("Invalid fixture validity");
      for (const e of v.evidence)
        if (
          !object(e) ||
          e.role !== "supports" ||
          e.type === "verifiable-credential" ||
          "verification" in e
        )
          throw new Error("Unsupported fixture evidence");
      if (
        v.extensions !== undefined &&
        (!object(v.extensions) ||
          Object.keys(v.extensions).some((k) =>
            [
              "@context",
              "schema",
              "id",
              "type",
              "subject",
              "content",
              "assertion",
              "classification",
              "evidence",
              "record",
            ].includes(k),
          ))
      )
        throw new Error("Provider fields cannot be overridden");
      if (
        v.recordExtensions !== undefined &&
        (!object(v.recordExtensions) ||
          Object.keys(v.recordExtensions).some((k) =>
            [
              "status",
              "version",
              "provenance",
              "relationships",
              "conversion",
            ].includes(k),
          ))
      )
        throw new Error("Provider fields cannot be overridden");
    }
  }
  return JSON.parse(JSON.stringify(input));
}
