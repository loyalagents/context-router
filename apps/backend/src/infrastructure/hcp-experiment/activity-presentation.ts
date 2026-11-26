// Pure, allowlisted presentation of admitted audit snapshots. No current-state
// lookups, raw payload dumps or authority decisions belong in this module.
import type { AuditAssociation, AuditGrant } from "./audit";
import { escape } from "./management-presentation";

const titles: Record<string, string> = {
  "grant.issued": "Permission granted",
  "grant.revoked": "Permission revoked",
  "grant.expired": "Permission expired",
  "rule.set": "Access rule added",
  "rule.removed": "Access rule removed",
  "directive.set": "Use directive added",
  "directive.removed": "Use directive removed",
  "context.created": "Memory created",
  "context.revised": "Memory revised",
  "context.read": "Read attempt recorded",
  "context.recategorized": "Memory categories changed",
  "context.restricted": "Memory purposes changed",
  "context.withdrawn": "Memory withdrawn",
  "context.confirmed": "Memory confirmation recorded",
  "context.expired": "Memory expired",
  "context.exported": "Export attempt recorded",
  "context.imported": "Import completed",
  "context.shared": "Client sharing report recorded",
  "conflict.detected": "Memory conflict detected",
  "conflict.proposed": "Conflict resolution proposed",
  "conflict.resolved": "Memory conflict resolved",
  "revocation.notified": "Revocation notification recorded",
};
const roles: Record<string, string> = {
  "management-client": "Management client",
  "context-client": "Context client",
  "authorization-service": "Authorization service",
  "hcp-provider": "HCP provider",
};
const text = (value: unknown, fallback = "Not recorded") =>
  typeof value === "string" || typeof value === "number"
    ? String(value)
    : fallback;
const list = (value: unknown, empty = "None") =>
  Array.isArray(value) && value.every((s) => typeof s === "string")
    ? value.length
      ? value.join(", ")
      : empty
    : "Not recorded";
const field = (label: string, value: unknown) =>
  `<dt>${escape(label)}</dt><dd>${escape(text(value))}</dd>`;
const link = (url: string, label: string) =>
  `<a href="${escape(url)}">${escape(label)}</a>`;
const eventUrl = (id: string) =>
  `/manage/audit?${new URLSearchParams({ eventId: id })}`;
const grantUrl = (id: string) =>
  `/manage?${new URLSearchParams({ grantId: id })}`;
const clientLabel = (grant: AuditGrant) =>
  `${text(grant.client?.name, "Unnamed client")} (${text(grant.client?.id)})`;
function grantScope(grant: AuditGrant): string {
  return (grant.access ?? [])
    .map(
      (a) =>
        `<p><strong>${escape(list(a.actions))}</strong> in ${escape(list(a.categories))}.</p><p>Purposes: ${escape(list(a.purposes?.map((p: any) => p.code)))}.</p>${a.narrowedTo ? `<p>Selected entries: ${escape(list(a.narrowedTo.entryIds))}. Creating new entries is not permitted.</p>` : ""}`,
    )
    .join("");
}
function policyScope(data: any, kind: string): string {
  return `<dl>${field("Categories", data.categories === undefined ? "All categories" : list(data.categories, "No categories"))}${field("Operator selectors", data.operators === undefined ? "All operators" : list(data.operators, "No operators"))}${kind !== "rule" || data.requires === undefined ? "" : field("Required client claims", list(data.requires, "No required claims"))}${kind !== "directive" || data.action === undefined ? "" : field("Action", data.action)}${field("Effect", data.effect)}</dl>`;
}
function changes(label: string, before: string, after: string): string {
  return `<section data-activity-change><h3>${escape(label)}</h3><dl>${field("Before", before)}${field("After", after)}</dl></section>`;
}
function row(event: any, association: AuditAssociation = {}): string {
  const d = event.data ?? {},
    grant = association.grant,
    initiator = event.participants?.initiator,
    actor = `${roles[initiator?.role] ?? "Recorded initiator"} (${text(initiator?.id)})`,
    title = titles[event.eventType] ?? "Recorded event";
  let summary = "",
    details = "";
  if (event.eventType === "grant.issued") {
    summary = `<p>This grant approved access; it does not show that the client used it.</p>`;
  } else if (event.eventType === "grant.revoked") {
    const deadlineReached =
      grant?.expiresAt != null &&
      Date.parse(grant.expiresAt) <= Date.parse(event.timestamp);
    summary = `<p>${deadlineReached ? "The approved deadline had already been reached when revocation was recorded." : "Revocation was recorded for this grant."} This does not prove remote copies were erased.</p>`;
  } else if (event.eventType === "grant.expired") {
    summary = `<p>This grant ended automatically at its recorded deadline. The event time records when expiry was recorded.</p>`;
  }
  if (event.eventType.startsWith("grant.")) {
    if (grant)
      summary += `<section><h3>Approved scope at issuance</h3>${grantScope(grant)}<dl>${field("Issued at", grant.issuedAt)}${field("Grant type", grant.grantType)}${field("Approved deadline", grant.expiresAt === null ? "Persistent; no automatic expiry" : grant.expiresAt)}</dl></section>`;
  }
  if (
    event.eventType === "context.read" ||
    (["context.created", "context.revised"].includes(event.eventType) &&
      Array.isArray(event.disclosed))
  ) {
    const copies = Array.isArray(event.disclosed) ? event.disclosed : [];
    summary += `<p>Recorded disclosure attempt${event.eventType === "context.read" ? "" : " of the write result"}. Receipt is unconfirmed; this does not prove the client received or erased a copy.</p><p>${copies.length ? `${copies.length} possible ${copies.length === 1 ? "copy" : "copies"}.` : "No entries in this recorded attempt."}</p>`;
    details += `<dl>${field("Purpose", event.purpose)}${d.categoriesSearched === undefined ? "" : field("Categories searched", list(d.categoriesSearched, "No categories"))}${d.maxEntries === undefined ? "" : field("Result limit", d.maxEntries)}${field("Recorded directive IDs", list(d.directives))}</dl>`;
    details += copies
      .map(
        (copy: any) =>
          `<section><h3>Possible copy</h3><dl>${field("Entry", copy.entryId)}${field("Version", copy.version)}${field("Categories at disclosure", list(copy.categories))}${field("Use until", copy.useUntil)}</dl></section>`,
      )
      .join("");
  }
  if (/^(rule|directive)\.(set|removed)$/.test(event.eventType)) {
    const kind = event.eventType.startsWith("rule.") ? "rule" : "directive";
    summary += `<p>${event.eventType.endsWith(".set") ? "Added" : "Removed"} the following recorded ${kind}. ${kind === "directive" ? "This does not show that a client followed or received it." : "Other rules and entry restrictions may also apply."}</p>${policyScope(d, kind)}`;
    details += `<dl>${field(`${kind === "rule" ? "Rule" : "Directive"} ID`, kind === "rule" ? d.ruleId : d.directiveId)}${field("Set by", d.setBy)}</dl><h3>Recorded grants matching this policy scope</h3>`;
    details += association.policyGrants?.length
      ? `<ul>${association.policyGrants.map((g) => `<li>${escape(clientLabel(g))} · ${link(grantUrl(g.grantId), g.grantId)}</li>`).join("")}</ul>`
      : `<p>No matching grant can be established from the recorded facts.</p>`;
    details += `<p>These are selector matches against grants recorded at that point, not proof of effective access, use or delivery.</p>`;
    summary += `<p>${link("/manage/policy", "Inspect current rules and directives")}</p>`;
  }
  if (event.eventType === "context.recategorized")
    summary += changes(
      "Categories",
      list(d.from, "No categories"),
      list(d.to, "No categories"),
    );
  if (event.eventType === "context.restricted") {
    const purposes = (v: any) =>
      v === null
        ? "No principal purpose restriction"
        : list(v, "No permitted purposes");
    summary += changes(
      "Principal purpose restrictions",
      purposes(d.from),
      purposes(d.to),
    );
  }
  if (event.eventType === "context.withdrawn")
    summary +=
      "<p>The memory was withdrawn. Its retained history is not erased.</p>";
  if (event.eventType === "context.shared")
    summary += `<p>Client-reported sharing; not independently confirmed. ${d.permitted === false ? "The reported sharing was not permitted." : "No additional permission is established by this report."}</p>`;
  if (event.eventType === "context.exported")
    summary += "<p>Export attempt recorded. Receipt is unconfirmed.</p>";
  if (event.eventType === "context.imported") {
    const outcomes = Array.isArray(d.outcomes) ? d.outcomes : [];
    summary += `<p>${["imported", "skipped", "rejected"].map((outcome) => `${outcomes.filter((item: any) => item?.outcome === outcome).length} ${outcome}`).join("; ")}. Counts describe the recorded entry outcomes.</p>`;
  }
  if (event.eventType === "revocation.notified")
    summary += `<p>${d.outcome === "delivered" ? "The notification endpoint acknowledged delivery." : d.outcome === "abandoned" ? "Notification attempts stopped without a delivery acknowledgement; client receipt is unknown." : "Notification outcome is not recorded."} This is not evidence of remote erasure.</p><dl>${field("Attempts", d.attempts)}${field("Last possible copy use-until", d.lastUseUntil)}</dl>`;
  if (titles[event.eventType]) {
    details += `<dl>${!["context.created", "context.revised", "context.expired", "context.confirmed"].includes(event.eventType) || d.version === undefined ? "" : field("Version", d.version)}${!["context.expired", "grant.expired"].includes(event.eventType) || d.effectiveAt === undefined ? "" : field("Effective at", d.effectiveAt)}${event.categories === undefined ? "" : field("Recorded categories", list(event.categories))}${event.eventType !== "context.confirmed" || d.disposition === undefined ? "" : field("Disposition", d.disposition)}${event.eventType !== "conflict.resolved" || d.transition === undefined ? "" : field("Transition", d.transition)}</dl>`;
  }
  details += `<dl>${field("Event ID", event.eventId)}${field("Event type", event.eventType)}${field("Actor", actor)}${field("Provider", event.participants?.provider?.id)}${event.participants?.authorizingPrincipal ? field("Authorizing principal", event.participants.authorizingPrincipal.id) : ""}${event.participants?.retrievalId ? field("Retrieval ID", event.participants.retrievalId) : ""}</dl>`;
  if (event.entryId)
    details += `<p>${link(`/manage/entries/${encodeURIComponent(event.entryId)}`, "Inspect current memory and versions")} · ${escape(event.entryId)}</p>`;
  if (grant)
    details += `<dl>${field("Affected client", clientLabel(grant))}${field("Client operator at issuance", grant.client?.operator?.id)}</dl>`;
  if (event.grantId)
    details += `<p>Recorded grant: ${escape(event.grantId)} · ${link(grantUrl(event.grantId), "Inspect current grant")}</p>${grant ? "" : "<p>Grant issuance facts unavailable.</p>"}`;
  return `<article data-activity-event="${escape(event.eventId)}" data-event-type="${escape(event.eventType)}"><div class="metadata"><time datetime="${escape(event.timestamp)}">${escape(event.timestamp)}</time><span>${escape(event.eventType)}</span></div><h2>${escape(title)}</h2><p>Actor: ${escape(roles[initiator?.role] ?? "Recorded initiator")}${grant ? `<br>Affected client: ${escape(text(grant.client?.name, text(grant.client?.id)))}` : ""}</p>${summary}<details><summary>Recorded details</summary>${details}<p>Only supported recorded fields are presented here. Additional fields and free-text descriptions are not interpreted.</p></details><p>${link(eventUrl(event.eventId), "Link to this event")}</p></article>`;
}

export interface ActivityPage {
  events: any[];
  associations: AuditAssociation[];
  filters: Record<string, string>;
  nextCursor: string | null;
}
export function activityPage(page: ActivityPage, limit: number): string {
  const filters = page.filters,
    exact = filters.eventId;
  const control = (name: string, label: string) =>
    `<label>${escape(label)} <input name="${name}" value="${escape(filters[name] ?? "")}" maxlength="512"></label>`;
  const active = Object.keys(filters).length > 0;
  return `<p class="intro">Permission changes, memory changes and recorded use of context. History is retained across restart. Disclosure events record attempts; they cannot confirm remote receipt or erasure.</p><p>${link("/manage", "Inspect current access")} · ${link("/manage/policy", "Inspect current rules and directives")} · ${link("/manage/disclosures", "Possible disclosure summary")}</p>
  ${exact ? `<p>${link("/manage/audit", "All activity")} · Exact recorded event</p>` : `<form method="get" action="/manage/audit" aria-label="Activity filters"><div class="activity-filters">${control("client", "Client ID")}${control("category", "Category")}${control("eventType", "Event type")}${control("from", "From (RFC3339, inclusive)")}${control("to", "To (RFC3339, inclusive)")}${filters.grantId ? control("grantId", "Grant ID") : ""}${filters.entryId ? control("entryId", "Entry ID") : ""}</div><button>Apply filters</button> ${link("/manage/audit", "Reset filters")}</form><p class="muted">Oldest first, in recorded append order. Next pages retain this snapshot for ten minutes. Open Activity again for newly recorded events.</p><p class="muted">Client filters include the recorded grant beneficiary or initiator, and grants matching a policy's recorded scope. They do not prove that a policy changed effective access or was used.</p>`}
  ${page.events.length ? page.events.map((e, i) => row(e, page.associations[i])).join("") : `<section><h2>${exact ? "Recorded event unavailable" : active ? "No events match these filters" : "No recorded activity"}</h2><p>${exact ? "No event with this identifier is available in this workspace." : "This view contains no recorded events."} ${link("/manage/audit", "Start a fresh activity view")}</p></section>`}
  ${page.nextCursor ? `<p>${link(`/manage/audit?${new URLSearchParams({ ...filters, limit: String(limit), cursor: page.nextCursor })}`, "Next activity page (newer events)")}</p>` : ""}`;
}
