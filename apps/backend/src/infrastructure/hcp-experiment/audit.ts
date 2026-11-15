import { categories, invalid, keys, privateId } from "./policy";
export function dateTime(value: any): string {
  if (typeof value !== "string") invalid();
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(
      value,
    );
  if (!match || !Number.isFinite(Date.parse(value))) invalid();
  const [, y, m, d, h, min, sec, zone] = match;
  if (
    +m < 1 ||
    +m > 12 ||
    +d < 1 ||
    +d > new Date(Date.UTC(+y, +m, 0)).getUTCDate() ||
    +h > 23 ||
    +min > 59 ||
    +sec > 59 ||
    (zone !== "Z" && (+zone.slice(1, 3) > 23 || +zone.slice(4) > 59))
  )
    invalid();
  return new Date(value).toISOString();
}
export function auditFilters(input: any): any {
  keys(input, [
    "client",
    "category",
    "eventType",
    "from",
    "to",
    "grantId",
    "entryId",
  ]);
  const result: any = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    if (["from", "to"].includes(key)) result[key] = dateTime(value);
    else {
      if (typeof value !== "string" || !value || value.length > 512) invalid();
      result[key] = value;
    }
  }
  if (result.category) categories([result.category]);
  if (result.entryId && !privateId(result.entryId)) invalid();
  if (result.grantId && !privateId(result.grantId)) invalid();
  if (result.from && result.to && result.from > result.to) invalid();
  return result;
}
export function grantFacts(events: any[]): Map<string, any> {
  const result = new Map<string, any>();
  for (const e of events) {
    if (e.eventType === "grant.issued")
      result.set(e.grantId, {
        client: e.data.client,
        categories: (e.data.access ?? []).flatMap(
          (d: any) => d.categories ?? [],
        ),
        status: "active",
        notification: "none",
      });
    const grant = result.get(e.grantId);
    if (!grant) continue;
    if (e.eventType === "grant.expired") grant.status = "expired";
    if (e.eventType === "grant.revoked") {
      grant.status = "revoked";
      grant.revokedAt = e.timestamp;
    }
    if (e.eventType === "revocation.notified") {
      grant.notification = e.data.outcome;
      if (e.data.outcome === "delivered") grant.deliveredAt = e.timestamp;
    }
  }
  return result;
}
export function matchesAudit(
  e: any,
  filter: any,
  grants: Map<string, any>,
): boolean {
  const policy = /^(rule|directive)\./.test(e.eventType),
    lifecycle = [
      "grant.issued",
      "grant.revoked",
      "grant.expired",
      "revocation.notified",
    ].includes(e.eventType);
  const recordedCategories = [
    ...(e.categories ?? []),
    ...(e.data.categoriesSearched ?? []),
    ...(e.disclosed ?? []).flatMap((d: any) => d.categories ?? []),
    ...(policy ? (e.data.categories ?? []) : []),
    ...(lifecycle
      ? (grants.get(e.grantId)?.categories ??
        (e.data.access ?? []).flatMap((d: any) => d.categories ?? []))
      : []),
    ...(e.eventType === "context.shared"
      ? (e.data.possibleCategories ?? [])
      : []),
  ];
  return (
    (!filter.client ||
      (grants.get(e.grantId)?.client?.id ?? e.participants?.initiator?.id) ===
        filter.client) &&
    (!filter.grantId || e.grantId === filter.grantId) &&
    (!filter.entryId ||
      e.entryId === filter.entryId ||
      e.relatedEntryId === filter.entryId ||
      e.disclosed?.some((d: any) => d.entryId === filter.entryId) ||
      e.data.relatedTransitions?.some((t: any) => t.id === filter.entryId) ||
      (e.eventType === "context.shared" &&
        e.data.entries?.some((t: any) => t.id === filter.entryId))) &&
    (!filter.eventType || e.eventType === filter.eventType) &&
    (!filter.from || e.timestamp >= filter.from) &&
    (!filter.to || e.timestamp <= filter.to) &&
    (!filter.category ||
      (policy && e.data.categories === undefined) ||
      recordedCategories.includes(filter.category))
  );
}
export function disclosureSummary(events: any[], filter: any): any {
  filter = auditFilters(filter);
  const grants = grantFacts(events),
    rows = new Map<string, any>();
  for (const e of events) {
    if (
      !["context.read", "context.created", "context.revised"].includes(
        e.eventType,
      ) ||
      !Array.isArray(e.disclosed)
    )
      continue;
    const grant = grants.get(e.grantId);
    if (!grant?.client) continue;
    if (!matchesAudit(e, { ...filter, category: undefined }, grants)) continue;
    const copies = e.disclosed.filter(
      (d: any) => !filter.category || d.categories?.includes(filter.category),
    );
    if (filter.category && !copies.length) continue;
    const id = grant.client.id;
    const row = rows.get(id) ?? {
      client: grant.client,
      grants: new Map(),
      categories: new Set(),
      purposes: new Set(),
      entries: new Set(),
      retrievals: 0,
      firstAt: e.timestamp,
      lastAt: e.timestamp,
      usableUntil: null,
      notification: "none",
      latestRevocation: "",
    };
    rows.set(id, row);
    row.grants.set(e.grantId, { grantId: e.grantId, status: grant.status });
    if (e.eventType === "context.read") row.retrievals++;
    if (e.purpose) row.purposes.add(e.purpose);
    row.firstAt = row.firstAt < e.timestamp ? row.firstAt : e.timestamp;
    row.lastAt = row.lastAt > e.timestamp ? row.lastAt : e.timestamp;
    for (const copy of copies) {
      row.entries.add(copy.entryId);
      for (const category of copy.categories ?? [])
        row.categories.add(category);
      const until =
        grant.deliveredAt && grant.deliveredAt < copy.useUntil
          ? grant.deliveredAt
          : copy.useUntil;
      if (!row.usableUntil || until > row.usableUntil) row.usableUntil = until;
    }
    if (grant.revokedAt && grant.revokedAt >= row.latestRevocation) {
      row.latestRevocation = grant.revokedAt;
      row.notification = grant.notification;
    }
  }
  return {
    clients: [...rows.values()].map(({ latestRevocation, ...r }) => ({
      ...r,
      grants: [...r.grants.values()],
      categories: [...r.categories].sort(),
      purposes: [...r.purposes].sort(),
      entries: r.entries.size,
      ...(r.client.legalRetention
        ? { legalRetention: r.client.legalRetention }
        : {}),
    })),
    notice:
      "Possible disclosures; receipt is unconfirmed. A notification acknowledgement is not evidence of erasure.",
  };
}
