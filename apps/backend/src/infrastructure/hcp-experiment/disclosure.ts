/** Pure, bounded read selection and public projection. No transport or authority issuance. */
import type { DatabaseSync } from "node:sqlite";
import {
  denied,
  deniedCategories,
  evaluateEntry,
  invalid,
  keys,
  matchesOperator,
  uri,
  validateAccess,
} from "./policy";
export interface ReadRequest {
  kind: "query" | "get";
  purpose: string;
  purposeDescription?: string;
  query?: string;
  categories?: string[];
  maxEntries?: number;
  ref?: string;
  version?: number;
}
export function readRequest(
  kind: "query" | "get",
  input: any,
  ref?: string,
): ReadRequest {
  keys(
    input,
    kind === "query"
      ? ["query", "purpose", "purposeDescription", "categories", "maxEntries"]
      : ["purpose", "purposeDescription", "version"],
  );
  if (
    !uri(input.purpose) ||
    (input.purposeDescription !== undefined &&
      (typeof input.purposeDescription !== "string" ||
        !input.purposeDescription.trim() ||
        input.purposeDescription.length > 2048))
  )
    invalid();
  if (kind === "query") {
    if (
      typeof input.query !== "string" ||
      !input.query.trim() ||
      input.query.length > 8192 ||
      (input.categories !== undefined &&
        (!Array.isArray(input.categories) ||
          input.categories.length > 100 ||
          input.categories.some(
            (v: any) => typeof v !== "string" || !v || v.length > 512,
          ))) ||
      (input.maxEntries !== undefined &&
        (!Number.isSafeInteger(input.maxEntries) || input.maxEntries < 1))
    )
      invalid();
    return {
      ...input,
      kind,
      maxEntries: Math.min(input.maxEntries ?? 5, 20),
      ...(input.categories === undefined
        ? {}
        : { categories: [...new Set<string>(input.categories)] }),
    };
  }
  if (
    input.version !== undefined &&
    (!Number.isSafeInteger(input.version) || input.version < 1)
  )
    invalid();
  return { ...input, kind, ref };
}
const tokens = (s: string): Set<string> =>
  new Set(
    s
      .normalize("NFKC")
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu) ?? [],
  );
function leaves(value: any): string[] {
  if (Array.isArray(value)) return value.flatMap(leaves);
  if (value !== null && typeof value === "object")
    return Object.keys(value)
      .sort()
      .flatMap((k) => leaves(value[k]));
  return [String(value)];
}
export function selectRead(
  db: DatabaseSync,
  grant: any,
  request: ReadRequest,
  rules: any[],
  now: number,
): { entries: any[]; categories: string[] } {
  const access = grant.access.filter((d: any) => {
    try {
      validateAccess([d]);
      return d.purposes.some((p: any) => p.code === request.purpose);
    } catch {
      return false;
    }
  });
  if (!access.length) denied();
  const permitted = [
    ...new Set<string>(access.flatMap((d: any) => d.categories)),
  ];
  const searched = request.categories ?? permitted;
  if (
    request.kind === "query" &&
    (searched.some((c) => !permitted.includes(c)) ||
      deniedCategories(grant.client, searched, rules).length)
  )
    denied();
  let rows: any[];
  if (request.kind === "get") {
    const row: any = db
      .prepare("SELECT entry_id FROM grant_refs WHERE grant_id=? AND ref=?")
      .get(grant.grantId, request.ref);
    if (!row) denied();
    rows = db.prepare("SELECT * FROM entries WHERE id=?").all(row.entry_id);
  } else rows = db.prepare("SELECT * FROM entries ORDER BY id").all();
  const selected: any[] = [];
  for (const row of rows) {
    const current = JSON.parse(
      String(
        db
          .prepare(
            "SELECT document FROM entry_versions WHERE entry_id=? AND version=?",
          )
          .get(row.id, row.current_version).document,
      ),
    );
    const classification = JSON.parse(row.classification);
    const currentEntry = {
      ...current,
      classification,
      record: { ...current.record, status: row.status },
    };
    if (!evaluateEntry(grant, currentEntry, request.purpose, rules, now))
      continue;
    if (
      request.kind === "query" &&
      !classification.categories.some((c: string) => searched.includes(c))
    )
      continue;
    const version: any = db
      .prepare(
        "SELECT document FROM entry_versions WHERE entry_id=? AND version=?",
      )
      .get(row.id, request.version ?? row.current_version);
    if (!version) continue;
    const document = JSON.parse(version.document);
    const entry = {
      ...document,
      classification,
      record: { ...document.record, status: row.status },
    };
    if (!evaluateEntry(grant, entry, request.purpose, rules, now)) continue;
    // Category disclosure requires a detail that actually reaches this entry.
    const covered = new Set<string>(
      access
        .filter(
          (d: any) => !d.narrowedTo || d.narrowedTo.entryIds.includes(row.id),
        )
        .flatMap((d: any) => d.categories),
    );
    if (
      request.kind === "query" &&
      !classification.categories.some(
        (c: string) => searched.includes(c) && covered.has(c),
      )
    )
      continue;
    selected.push({
      entry,
      current: currentEntry,
      categories: classification.categories.filter((c: string) =>
        covered.has(c),
      ),
    });
  }
  if (request.kind === "get") {
    if (selected.length !== 1) denied();
    return { entries: selected, categories: selected[0].categories };
  }
  const words = tokens(request.query!);
  const ranked = selected
    .map((item) => {
      const indexed = tokens(leaves(item.entry.content.value).join(" "));
      return { item, score: [...words].filter((w) => indexed.has(w)).length };
    })
    .filter((r) => r.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score || a.item.entry.id.localeCompare(b.item.entry.id),
    );
  return {
    entries: ranked.slice(0, request.maxEntries).map((r) => r.item),
    categories: searched,
  };
}
export function readDirectives(
  grant: any,
  entries: any[],
  directives: any[],
): any[] {
  const actual = new Set(
    entries.flatMap((e) => e.entry.classification.categories),
  );
  return directives.filter(
    (d) =>
      matchesOperator(grant.client.operator.id, d.operators) &&
      (!d.categories || d.categories.some((c: string) => actual.has(c))),
  );
}
export function validity(item: any): number {
  return Math.min(
    ...[item.entry, item.current].map((e) =>
      e.assertion.validUntil == null
        ? Infinity
        : Date.parse(e.assertion.validUntil),
    ),
  );
}
export function project(
  item: any,
  refs: Map<string, string>,
  useUntil: number,
): any {
  const e = item.entry,
    classification: any = { categories: item.categories };
  for (const field of ["dimension", "permittedPurposes"])
    if (e.classification[field] !== undefined)
      classification[field] = e.classification[field];
  return {
    ref: refs.get(e.id),
    version: e.record.version,
    content: e.content,
    assertion: e.assertion,
    evidence: e.evidence,
    classification,
    standing: {
      assurance: e.record.provenance.assertedBy.assurance,
      confirmed: e.record.provenance.confirmations.length > 0,
    },
    useUntil: new Date(useUntil).toISOString(),
    relationships: e.record.relationships
      .filter((r: any) => refs.has(r.target))
      .map((r: any) => ({ type: r.type, target: refs.get(r.target) })),
  };
}
