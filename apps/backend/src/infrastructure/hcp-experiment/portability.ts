import type { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { dateTime } from "./audit";
import { authoritative, withConfirmations } from "./entry-state";
import { conflictEffects, contradicts } from "./conflicts";
import {
  CATEGORIES,
  categories,
  deniedCategories,
  matchingDirectives,
  invalid,
  keys,
  object,
  privateId,
  strings,
  uri,
  validatePolicy,
} from "./policy";
import { storedEntry } from "./writes";
const parse = (v: any) => JSON.parse(String(v));
export const canonical = (v: any): string =>
  JSON.stringify(v, function (_key, value) {
    return object(value)
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, value[key]]),
        )
      : value;
  });
export const digest = (v: any) =>
  createHash("sha256").update(canonical(v)).digest("hex");
// Optional empty collections have identical protocol meaning; raw source bytes remain retained.
const entryCanonical = (e: any) =>
  canonical({
    ...e,
    evidence: e.evidence ?? [],
    record: {
      ...e.record,
      relationships: e.record.relationships ?? [],
      provenance: {
        ...e.record.provenance,
        confirmations: e.record.provenance.confirmations ?? [],
      },
    },
  });
const effectiveEntry = (e: any, now: number) => ({
  ...e,
  record: {
    ...e.record,
    status:
      e.assertion.validUntil != null &&
      Date.parse(e.assertion.validUntil) <= now &&
      !["deleted", "revoked", "expired"].includes(e.record.status)
        ? "expired"
        : e.record.status,
  },
});
export function exportOptions(input: any): any {
  keys(input, ["include", "exclude"]);
  const values = (key: string, allowed: string[]) => {
    if (input[key] === undefined) return [];
    if (typeof input[key] !== "string") invalid();
    const list = input[key].split(",");
    if (!strings(list) || list.some((v: string) => !allowed.includes(v)))
      invalid();
    return list;
  };
  const include = values("include", ["versions", "audit"]),
    exclude = values("exclude", ["deleted"]);
  return {
    includeVersions: include.includes("versions"),
    includeAudit: include.includes("audit"),
    excludeDeleted: exclude.includes("deleted"),
  };
}
export function exportDocument(
  db: DatabaseSync,
  options: any,
  now: number,
): any {
  const meta = db.prepare("SELECT * FROM store_metadata").get();
  const entries = db
    .prepare(
      "SELECT id FROM entries WHERE ?=0 OR status<>'deleted' ORDER BY id",
    )
    .all(options.excludeDeleted ? 1 : 0)
    .map((row) => storedEntry(db, String(row.id)));
  return {
    "@context": ["https://hcp.example/contexts/v2"],
    type: "ContextExport",
    schema: "https://hcp.example/spec/export/2.0",
    subject: { id: meta.subject_id },
    exportedBy: meta.provider_id,
    exportedAt: new Date(now).toISOString(),
    options,
    entries,
    ...(options.includeVersions
      ? {
          versions: entries.flatMap((entry) =>
            db
              .prepare(
                "SELECT version FROM entry_versions WHERE entry_id=? AND version<? ORDER BY version",
              )
              .all(entry.id, entry.record.version)
              .map((row) => storedEntry(db, entry.id, Number(row.version))),
          ),
        }
      : {}),
    rules: db
      .prepare("SELECT document FROM policies WHERE kind='rules' ORDER BY id")
      .all()
      .map((row) => parse(row.document)),
    directives: db
      .prepare(
        "SELECT document FROM policies WHERE kind='directives' ORDER BY id",
      )
      .all()
      .map((row) => parse(row.document)),
    delegations: [],
    ...(options.includeAudit
      ? {
          audit: db
            .prepare("SELECT event FROM audit_events ORDER BY sequence")
            .all()
            .map((row) => parse(row.event)),
        }
      : {}),
  };
}
function validateEntry(entry: any): void {
  if (
    !object(entry) ||
    entry.schema !== "https://hcp.example/spec/entry/2.0" ||
    !privateId(entry.id) ||
    !uri(entry.subject?.id) ||
    entry.subject.relationship != null ||
    !object(entry.content) ||
    entry.content.profile !==
      "https://hcp.example/spec/profiles/general-context/2.0" ||
    !(typeof entry.content.value === "string" || object(entry.content.value)) ||
    !object(entry.assertion) ||
    !object(entry.classification) ||
    !object(entry.record)
  )
    throw new Error("unsupported v2 General Context entry");
  if (
    !["person-declared", "model-inferred"].includes(
      entry.assertion.declarationType,
    )
  )
    throw new Error("unsupported declaration type");
  if (
    entry.assertion.declarationType === "model-inferred"
      ? !["low", "medium", "high"].includes(entry.assertion.confidence)
      : entry.assertion.confidence != null
  )
    throw new Error("invalid confidence");
  if (
    !strings(entry.classification.categories) ||
    !entry.classification.categories.every(
      (c: string) => c in CATEGORIES || uri(c),
    )
  )
    throw new Error("invalid categories");
  for (const source of [entry.assertion, entry.classification])
    if (
      source.permittedPurposes !== undefined &&
      (!strings(source.permittedPurposes, 0) ||
        !source.permittedPurposes.every(uri))
    )
      throw new Error("invalid permitted purposes");
  if (entry.assertion.validUntil != null) dateTime(entry.assertion.validUntil);
  if (
    !Number.isSafeInteger(entry.record.version) ||
    entry.record.version < 1 ||
    ![
      "active",
      "deprecated",
      "conflicted",
      "expired",
      "revoked",
      "suspended",
      "deleted",
    ].includes(entry.record.status)
  )
    throw new Error("invalid record state");
  const p = entry.record.provenance;
  if (
    !object(p) ||
    !uri(p.assertedBy?.id) ||
    !["unverified", "authenticated", "cryptographically-verified"].includes(
      p.assertedBy.assurance,
    ) ||
    !uri(p.recordedByProvider) ||
    !uri(p.authorizedUnder) ||
    typeof p.source !== "string" ||
    !p.source ||
    typeof p.submittedByClient?.id !== "string" ||
    (p.confirmations !== undefined && !Array.isArray(p.confirmations))
  )
    throw new Error("invalid source provenance");
  dateTime(p.recordedAt);
  dateTime(p.assertedAt);
  for (const c of p.confirmations ?? []) {
    if (
      !object(c) ||
      !["confirmed", "rejected"].includes(c.disposition) ||
      !uri(c.confirmedBy?.id)
    )
      throw new Error("invalid source confirmation");
    dateTime(c.confirmedAt);
  }
  if (
    entry.record.relationships !== undefined &&
    (!Array.isArray(entry.record.relationships) ||
      entry.record.relationships.length)
  )
    throw new Error("foreign relationships are unsupported");
  if (
    entry.evidence !== undefined &&
    (!Array.isArray(entry.evidence) ||
      entry.evidence.some(
        (e: any) =>
          !object(e) ||
          e.role !== "supports" ||
          e.type === "verifiable-credential" ||
          e.verification !== undefined,
      ))
  )
    throw new Error("credential evidence is unsupported");
}
/** Read-only interpretation. Source ordering is never treated as local authority. */
export function interpretImport(
  db: DatabaseSync,
  request: any,
  now: number,
): any {
  keys(request, ["export", "categoryMap"]);
  let bundle = request.export;
  if (typeof bundle === "string") {
    if (Buffer.byteLength(bundle) > 1_048_576) invalid();
    try {
      bundle = JSON.parse(bundle);
    } catch {
      invalid();
    }
  }
  if (
    !object(bundle) ||
    bundle.schema !== "https://hcp.example/spec/export/2.0" ||
    bundle.type !== "ContextExport" ||
    !uri(bundle.subject?.id) ||
    !uri(bundle.exportedBy) ||
    !Array.isArray(bundle.entries) ||
    bundle.entries.length > 1000 ||
    !Array.isArray(bundle.rules) ||
    !Array.isArray(bundle.directives) ||
    !Array.isArray(bundle.delegations)
  )
    invalid();
  dateTime(bundle.exportedAt);
  const blockers: string[] = [],
    outcomes: any[] = [],
    accepted: any[] = [],
    policyAdditions: any[] = [],
    subjects = new Set<string>([bundle.subject.id]);
  if (
    bundle.audit !== undefined &&
    (!Array.isArray(bundle.audit) || bundle.audit.length)
  )
    blockers.push("source audit is unsupported");
  if (bundle.delegations.length)
    blockers.push("source delegations are unsupported");
  if (bundle.versions !== undefined && !Array.isArray(bundle.versions))
    invalid();
  const versions: any[] = bundle.versions ?? [];
  if (versions.length > 5000) invalid();
  for (const e of [...bundle.entries, ...versions]) {
    if (!uri(e?.subject?.id)) blockers.push("invalid subject URI");
    else subjects.add(e.subject.id);
  }
  const mapping = request.categoryMap ?? {};
  if (!object(mapping)) invalid();
  const destinations = new Set<string>();
  for (const [from, to] of Object.entries(mapping)) {
    if (from in CATEGORIES || !uri(from)) invalid();
    categories([to]);
    if (destinations.has(String(to)))
      blockers.push("ambiguous category mapping");
    destinations.add(String(to));
  }
  const mapCategories = (source: string[]) => {
    const mapped = source.map((c) =>
      c in CATEGORIES
        ? c
        : Object.prototype.hasOwnProperty.call(mapping, c)
          ? mapping[c]
          : c,
    );
    categories(mapped);
    return mapped;
  };
  const seenPolicies = new Set<string>();
  for (const kind of ["rules", "directives"]) {
    if (bundle[kind].length > 100) invalid();
    for (const source of bundle[kind]) {
      try {
        const item = structuredClone(source),
          id = item[kind === "rules" ? "ruleId" : "directiveId"];
        if (
          !privateId(id) ||
          seenPolicies.has(id) ||
          item.setBy !== "context-subject" ||
          (kind === "rules" && item.effect !== "deny")
        )
          throw new Error("unsupported policy record");
        seenPolicies.add(id);
        dateTime(item.createdAt);
        if (item.categories) item.categories = mapCategories(item.categories);
        const fields =
          kind === "rules"
            ? ["operators", "requires", "categories"]
            : ["action", "effect", "text", "categories", "operators"];
        const body = Object.fromEntries(
          fields.filter((k) => item[k] !== undefined).map((k) => [k, item[k]]),
        );
        validatePolicy({
          rules: kind === "rules" ? [body] : [],
          directives: kind === "directives" ? [body] : [],
        });
        const held = db
          .prepare("SELECT kind,document FROM policies WHERE id=?")
          .get(id);
        if (
          held &&
          (held.kind !== kind ||
            canonical(parse(held.document)) !== canonical(item))
        )
          throw new Error("nonidentical policy ID collision");
        if (!held) policyAdditions.push({ id, kind, item });
      } catch {
        blockers.push("unsupported or ambiguous policy mapping/ID collision");
      }
    }
  }
  const sourceIds = new Set<string>();
  if (new Set(bundle.entries.map((e) => e?.id)).size !== bundle.entries.length)
    blockers.push("duplicate current entry ID");
  for (const source of bundle.entries) {
    const id = source?.id;
    try {
      validateEntry(source);
      if (
        source.record.provenance.confirmations?.at(-1)?.disposition ===
          "rejected" &&
        source.record.status !== "deleted"
      )
        throw new Error("current rejection requires deleted lifecycle state");
      if (sourceIds.has(id)) throw new Error("duplicate entry ID in bundle");
      sourceIds.add(id);
      if (["conflicted", "revoked", "suspended"].includes(source.record.status))
        throw new Error(
          "source lifecycle state is unsupported for this import profile",
        );
      const history = versions
        .filter((v) => v?.id === id)
        .sort((a, b) => a.record?.version - b.record?.version);
      if (history.length) {
        if (history.length !== source.record.version - 1)
          throw new Error("incomplete history");
        for (let n = 0; n < history.length; n++) {
          validateEntry(history[n]);
          if (
            history[n].record.version !== n + 1 ||
            canonical(history[n].subject) !== canonical(source.subject)
          )
            throw new Error("divergent history");
        }
      }
      const entry = structuredClone(source);
      entry.classification.categories = mapCategories(
        entry.classification.categories,
      );
      const held = storedEntry(db, id);
      if (held) {
        if (
          entryCanonical(effectiveEntry(held, now)) !==
          entryCanonical(effectiveEntry(entry, now))
        )
          throw new Error("id held with different record");
        for (const prior of history) {
          const row = db
            .prepare(
              "SELECT document FROM entry_versions WHERE entry_id=? AND version=?",
            )
            .get(id, prior.record.version);
          const withCurrentStatus = (value: any) => ({
            ...value,
            record: {
              ...value.record,
              status: effectiveEntry(held, now).record.status,
            },
          });
          // Retained source history may have a different classification from
          // today's export overlay, including unmapped historical categories.
          if (
            row &&
            entryCanonical(withCurrentStatus(parse(row.document))) ===
              entryCanonical(withCurrentStatus(prior))
          )
            continue;
          let priorCategories: string[];
          try {
            priorCategories = mapCategories(prior.classification.categories);
          } catch {
            throw new Error("nonidentical held history");
          }
          const comparable = {
            ...prior,
            classification: {
              ...prior.classification,
              categories: priorCategories,
            },
            record: {
              ...prior.record,
              status: effectiveEntry(entry, now).record.status,
            },
          };
          const retained = row && storedEntry(db, id, prior.record.version);
          // A re-export uses the current classification for every version.
          if (
            !retained ||
            entryCanonical(withCurrentStatus(retained)) !==
              entryCanonical(comparable)
          )
            throw new Error("nonidentical held history");
        }
        outcomes.push({ id, outcome: "skipped", reason: "exact duplicate" });
        continue;
      }
      const current = effectiveEntry(structuredClone(entry), now);
      outcomes.push({ id, outcome: "imported" });
      accepted.push({ source, entry, current, history });
    } catch (e) {
      outcomes.push({
        id: typeof id === "string" ? id : null,
        outcome: "rejected",
        reason: e instanceof Error ? e.message : "invalid entry",
      });
    }
  }
  if (versions.some((v) => !sourceIds.has(v?.id)))
    blockers.push("history has no current entry");
  const local = db
    .prepare(
      "SELECT id FROM entries WHERE status IN ('active','conflicted') ORDER BY id",
    )
    .all()
    .map((r) => storedEntry(db, String(r.id)))
    .filter(
      (e) =>
        e.assertion.validUntil == null ||
        Date.parse(e.assertion.validUntil) > now,
    );
  const ambiguous = new Set<string>();
  const all = [...local, ...accepted.map((a) => a.current)];
  for (const candidate of accepted)
    for (const other of all) {
      const e = candidate.current;
      if (
        e.id === other.id ||
        !contradicts(e, other) ||
        ![e, other].every((x) =>
          ["active", "conflicted"].includes(x.record.status),
        )
      )
        continue;
      if (
        [e, other].every(
          (x) =>
            x.assertion.declarationType === "model-inferred" &&
            !authoritative(x),
        ) &&
        e.record.provenance.assertedBy.id ===
          other.record.provenance.assertedBy.id
      ) {
        ambiguous.add(e.id);
        if (accepted.some((a) => a.entry.id === other.id))
          ambiguous.add(other.id);
      }
    }
  for (const outcome of outcomes)
    if (ambiguous.has(outcome.id)) {
      outcome.outcome = "rejected";
      outcome.reason = "ambiguous same-asserter chronology";
    }
  const admitted = accepted.filter((a) => !ambiguous.has(a.entry.id)),
    effects: any[] = [];
  const candidates = [...local, ...admitted.map((a) => a.current)];
  for (const item of admitted)
    for (const other of candidates)
      if (
        item.current.id !== other.id &&
        contradicts(item.current, other) &&
        [item.current, other].every((e) =>
          ["active", "conflicted"].includes(e.record.status),
        )
      ) {
        const pair = [item.current.id, other.id].sort();
        if (effects.some((e) => canonical(e.entries) === canonical(pair)))
          continue;
        effects.push({
          entries: pair,
          ...conflictEffects(item.current, other, item.current.id),
        });
      }
  const heldPolicies = (kind: string) =>
    db
      .prepare("SELECT document FROM policies WHERE kind=? ORDER BY id")
      .all(kind)
      .map((r) => parse(r.document));
  const rules = heldPolicies("rules"),
    directives = heldPolicies("directives"),
    proposedRules = [
      ...rules,
      ...policyAdditions.filter((p) => p.kind === "rules").map((p) => p.item),
    ],
    proposedDirectives = [
      ...directives,
      ...policyAdditions
        .filter((p) => p.kind === "directives")
        .map((p) => p.item),
    ];
  const grantEffects = db
    .prepare(
      "SELECT document FROM grants WHERE status='active' AND (expires_at IS NULL OR expires_at>?) ORDER BY id",
    )
    .all(now)
    .flatMap((row) => {
      const grant = parse(row.document);
      if (grant.client.id === "urn:context-router:synthetic-management")
        return [];
      const reached = [
          ...new Set<string>(grant.access.flatMap((d: any) => d.categories)),
        ],
        deniedBefore = deniedCategories(grant.client, reached, rules),
        deniedAfter = deniedCategories(grant.client, reached, proposedRules),
        before = matchingDirectives(grant, directives),
        after = matchingDirectives(grant, proposedDirectives);
      return canonical([deniedBefore, before]) ===
        canonical([deniedAfter, after])
        ? []
        : [
            {
              grantId: grant.grantId,
              outcome:
                deniedAfter.length === reached.length
                  ? "revoked"
                  : "permission-changed",
              deniedCategories: deniedAfter,
              directives: after,
            },
          ];
    });
  return {
    outcomes,
    blockers: [...new Set(blockers)],
    subjects: [...subjects].sort(),
    destination: db.prepare("SELECT subject_id FROM store_metadata").get()
      .subject_id,
    sourceProvider: bundle.exportedBy,
    grantEffects,
    accepted: admitted,
    policyAdditions,
    effects: effects.sort((a, b) =>
      canonical(a.entries).localeCompare(canonical(b.entries)),
    ),
    generation: Number(
      db.prepare("SELECT policy_revision FROM authorization_settings").get()
        .policy_revision,
    ),
    digest: digest(request),
  };
}
export const importPreview = ({ accepted, ...result }: any) => ({
  ...result,
  policyAdditions: result.policyAdditions.map((p: any) => ({
    kind: p.kind,
    policy: p.item,
  })),
  entries: accepted.map((a: any) => ({
    id: a.entry.id,
    status: a.current.record.status,
    sourceProvider: a.entry.record.provenance.recordedByProvider,
    assurance: a.entry.record.provenance.assertedBy.assurance,
  })),
  notice:
    "Attest only that every displayed subject URI refers to you. This does not authenticate the source or confirm the assertions.",
});
