/** Synchronous C4 mutation primitives. The authority repository owns transactions and release. */
import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { withConfirmations } from "./entry-state";
import {
  AuthorityError,
  categories,
  denied,
  deniedCategories,
  evaluateEntry,
  invalid,
  object,
  strings,
  uri,
  validateAccess,
} from "./policy";

export type WriteOperation = "create" | "revise" | "withdraw";
export class WriteConflict extends AuthorityError {
  constructor(readonly conflict: "version-conflict" | "idempotency-conflict") {
    super("invalid");
    this.message = conflict;
  }
}
export const COMPLETION_ONLY =
  '{"outcome":"committed","representation":"not-included"}';
export function canDiscloseMutation(
  grant: any,
  entry: any,
  purpose: string,
  rules: any[],
  now: number,
  operation: WriteOperation,
  ownQuarantine = false,
): boolean {
  const metadataOnly = operation === "withdraw";
  const visible =
    metadataOnly || (ownQuarantine && entry.record.status === "conflicted")
      ? {
          ...entry,
          assertion: metadataOnly
            ? { ...entry.assertion, validUntil: null }
            : entry.assertion,
          record: { ...entry.record, status: "active" },
        }
      : entry;
  return evaluateEntry(grant, visible, purpose, rules, now);
}
export const permissionRevision = (db: DatabaseSync, grantId: string): number =>
  Number(
    db
      .prepare("SELECT revision FROM grant_permissions WHERE grant_id=?")
      .get(grantId)?.revision ?? 0,
  );
export function invalidateResponses(db: DatabaseSync, grantId: string): void {
  db.prepare(
    `INSERT INTO grant_permissions VALUES(?,1) ON CONFLICT(grant_id)
    DO UPDATE SET revision=revision+1`,
  ).run(grantId);
  db.prepare(
    "UPDATE mutation_receipts SET response=NULL,invalidated=1 WHERE grant_id=? AND invalidated=0",
  ).run(grantId);
}
export function storedEntry(
  db: DatabaseSync,
  id: string,
  version?: number,
): any | undefined {
  const row: any = db
    .prepare(
      `SELECT e.*,v.document FROM entries e JOIN entry_versions v
    ON v.entry_id=e.id AND v.version=coalesce(?,e.current_version) WHERE e.id=?`,
    )
    .get(version ?? null, id);
  if (!row) return undefined;
  const document = JSON.parse(row.document);
  return withConfirmations(db, {
    ...document,
    subject: JSON.parse(row.subject),
    classification: JSON.parse(row.classification),
    record: { ...document.record, status: row.status },
  });
}
const permitsPurpose = (entry: any, purpose: string): boolean =>
  [
    entry?.assertion?.permittedPurposes,
    entry?.classification?.permittedPurposes,
  ].every((p) => p === undefined || (strings(p, 0) && p.includes(purpose)));

/** All category/action/reach checks use this grant. Lifecycle and old validity are
 * intentionally separate: revising an expired/deprecated version may be valid. */
export function mutationPurpose(
  grant: any,
  classification: any,
  rules: any[],
  target?: any,
): string {
  const requested = classification?.categories;
  if (
    !strings(requested) ||
    deniedCategories(grant.client, requested, rules).length
  )
    denied();
  let access: any[];
  try {
    access = validateAccess(grant.access);
  } catch {
    denied();
  }
  const write = access!.filter(
    (d) =>
      d.actions.includes("write") &&
      (d.narrowedTo === undefined ||
        (target && d.narrowedTo.entryIds.includes(target.id))),
  );
  if (!write.length) denied();
  const purpose = write[0].purposes[0].code;
  if (
    requested.some((c: string) => !write.some((d) => d.categories.includes(c)))
  )
    denied();
  if (target && !permitsPurpose(target, purpose)) denied();
  return purpose;
}
function reason(input: any): void {
  if (
    typeof input.reason !== "string" ||
    !input.reason.trim() ||
    input.reason.length > 2048
  )
    invalid();
}
function noOwned(input: any, names: string[]): void {
  if (
    !object(input) ||
    names.some((n) => Object.prototype.hasOwnProperty.call(input, n))
  )
    invalid();
}
function timestamp(input: any, fallback: string): string {
  if (input === undefined) return fallback;
  if (
    typeof input !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
      input,
    ) ||
    !Number.isFinite(Date.parse(input))
  )
    invalid();
  return input;
}
export function mutationDocument(
  db: DatabaseSync,
  grant: any,
  operation: WriteOperation,
  input: any,
  now: number,
  current?: any,
  management = false,
): any {
  if (!object(input)) invalid();
  if (operation === "withdraw") {
    reason(input);
    return undefined;
  }
  noOwned(input, ["id", "ref", "entryId"]);
  if (operation === "create") {
    if (
      input.schema !== "https://hcp.example/spec/entry/2.0" ||
      !object(input.subject) ||
      input.subject.id !== grant.subject.id ||
      input.subject.relationship != null
    )
      invalid();
    if (!object(input.classification)) invalid();
    if (
      Object.prototype.hasOwnProperty.call(
        input.classification,
        "permittedPurposes",
      )
    )
      invalid();
    categories(input.classification.categories);
  } else {
    if (
      !current ||
      input.subject !== undefined ||
      input.classification !== undefined ||
      input.schema !== undefined
    )
      invalid();
    if (
      !Number.isSafeInteger(input.expectedVersion) ||
      input.expectedVersion < 1
    )
      invalid();
    reason(input);
  }
  if (
    !object(input.content) ||
    input.content.profile !==
      "https://hcp.example/spec/profiles/general-context/2.0" ||
    !(typeof input.content.value === "string" || object(input.content.value))
  )
    invalid();
  const assertion = structuredClone(input.assertion ?? {});
  if (!object(assertion)) invalid();
  assertion.declarationType ??= current?.assertion.declarationType;
  const model = assertion.declarationType === "model-inferred";
  if (
    (!model && assertion.declarationType !== "person-declared") ||
    (model && management)
  )
    denied();
  if (
    model
      ? !["high", "medium", "low"].includes(assertion.confidence)
      : assertion.confidence != null
  )
    invalid();
  if (assertion.validUntil != null) {
    timestamp(assertion.validUntil, "");
    if (Date.parse(assertion.validUntil) <= now) invalid();
  }
  const classification = structuredClone(
    current?.classification ?? input.classification,
  );
  for (const item of [assertion, classification])
    if (
      item.permittedPurposes !== undefined &&
      (!strings(item.permittedPurposes, 0) ||
        !item.permittedPurposes.every(uri))
    )
      invalid();
  if (classification.dimension != null) {
    if (
      typeof classification.dimension !== "string" ||
      !classification.dimension.trim() ||
      classification.dimension.length > 512
    )
      invalid();
    if (!uri(classification.dimension))
      classification.dimension = classification.dimension
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "_");
  }
  const record = input.record;
  noOwned(record, ["status", "version", "conversion"]);
  const provenance = record.provenance;
  noOwned(provenance, [
    "submittedByClient",
    "authorizedUnder",
    "recordedByProvider",
    "recordedAt",
    "confirmations",
  ]);
  if (provenance.assertedBy !== undefined) {
    noOwned(provenance.assertedBy, ["assurance", "via"]);
    if (
      model
        ? !uri(provenance.assertedBy.id)
        : provenance.assertedBy.id !== grant.subject.id
    )
      invalid();
  }
  if (model && !provenance.assertedBy) invalid();
  if (
    typeof provenance.source !== "string" ||
    !provenance.source.trim() ||
    provenance.source.length > 2048
  )
    invalid();
  if (
    record.relationships !== undefined &&
    (!Array.isArray(record.relationships) || record.relationships.length > 100)
  )
    invalid();
  const evidence = input.evidence ?? [];
  if (
    !Array.isArray(evidence) ||
    evidence.length > 100 ||
    evidence.some(
      (e) => !object(e) || e.verification !== undefined || e.role === "content",
    )
  )
    invalid();
  const meta = db.prepare("SELECT * FROM store_metadata").get();
  const at = new Date(now).toISOString(),
    version = current ? current.record.version + 1 : 1;
  const { expectedVersion: _expected, reason: _reason, ...extensions } = input;
  return {
    ...structuredClone(extensions),
    "@context": input["@context"] ?? ["https://hcp.example/contexts/v2"],
    schema: "https://hcp.example/spec/entry/2.0",
    type: ["ContextEntry"],
    id: current?.id ?? `urn:uuid:${randomUUID()}`,
    subject: { id: meta.subject_id, relationship: null },
    content: structuredClone(input.content),
    assertion,
    evidence: structuredClone(evidence),
    classification,
    record: {
      ...structuredClone(record),
      version,
      status: "active",
      relationships: [],
      provenance: {
        ...structuredClone(provenance),
        assertedBy: {
          id: model ? provenance.assertedBy.id : meta.subject_id,
          assurance: management ? "authenticated" : "unverified",
        },
        assertedAt: timestamp(provenance.assertedAt, at),
        source: provenance.source,
        submittedByClient: grant.client,
        authorizedUnder: grant.grantId,
        recordedByProvider: meta.provider_id,
        recordedAt: at,
        confirmations: [],
      },
    },
  };
}
export function assertNewPurpose(document: any, purpose: string): void {
  if (document && !permitsPurpose(document, purpose)) denied();
}
export function applyMutation(
  db: DatabaseSync,
  operation: WriteOperation,
  document: any,
  current?: any,
): void {
  if (operation === "withdraw") {
    db.prepare("UPDATE entries SET status='deleted' WHERE id=?").run(
      current.id,
    );
    return;
  }
  if (operation === "create")
    db.prepare("INSERT INTO entries VALUES(?,?,?,?,?)").run(
      document.id,
      JSON.stringify(document.subject),
      1,
      JSON.stringify(document.classification),
      "active",
    );
  else
    db.prepare(
      "UPDATE entries SET current_version=?,status='active' WHERE id=?",
    ).run(document.record.version, document.id);
  const { classification: _classification, ...version } = document;
  db.prepare("INSERT INTO entry_versions VALUES(?,?,?,?)").run(
    document.id,
    document.record.version,
    JSON.stringify(version),
    document.assertion.validUntil == null
      ? null
      : Date.parse(document.assertion.validUntil),
  );
}
