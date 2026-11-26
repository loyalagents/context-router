// Pure presentation for the synthetic management surface. Inputs are admitted
// snapshots, never credentials or service handles. HTTP owns every authority check.
export interface EntryView {
  id: string;
  content: { profile: string; value: unknown; [key: string]: unknown };
  classification: { categories: string[]; permittedPurposes?: string[] };
  assertion: {
    declarationType: string;
    basis?: unknown;
    permittedPurposes?: string[];
    [key: string]: unknown;
  };
  evidence?: unknown[];
  record: {
    version: number;
    status: string;
    provenance: {
      assertedBy: { id: string; assurance: string };
      confirmations: { disposition: string }[];
      source: unknown;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
}
export interface HistoryPage {
  events: {
    eventType: string;
    timestamp: string;
    data?: { version?: unknown; reason?: unknown };
    [key: string]: unknown;
  }[];
  nextCursor: string | null;
}
export interface EntryDetailView {
  entry: EntryView;
  currentVersion: number;
  versions: number[];
  historyLabel: string;
  conflicts: {
    id: string;
    peer: EntryView;
    quarantined: unknown[];
    canKeepBoth: boolean;
  }[];
}
export interface PersonReviewView {
  operation: string;
  access: { categories: string[] }[];
  purpose: { description: string; code: string };
  expiresAt: string;
  request: { content: { value: unknown }; [key: string]: unknown };
  reviewId: string;
  csrf: string;
}
export interface GrantView {
  grantId: string;
  status: string;
  grantType: string;
  expiresAt: string | null;
  client: {
    name: string;
    operator: { name?: string; id: string };
    notificationEndpoint?: string;
    legalRetention?: { record: string; obligation: string; period: string };
  };
  access: {
    actions: string[];
    categories: string[];
    purposes?: { description: string; code: string }[];
    narrowedTo?: { entryIds: string[] };
  }[];
}
export const escape = (s: unknown) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export const hidden = (name: string, value: string) =>
  `<input type="hidden" name="${escape(name)}" value="${escape(value)}">`;
export const viewOnly =
  "View only in this text editor. Structured content, unsupported declarations/profiles and deleted, suspended or revoked entries cannot be corrected here.";
function entryFacts(entry: EntryView): string {
  const provenance = entry.record.provenance;
  return `<section data-entry-facts><h2>Recorded provenance and current state</h2>
    <p>Version ${entry.record.version} · ${escape(entry.record.status)} · ${escape(entry.assertion.declarationType)}</p>
    <p>Current categories: ${escape(entry.classification.categories.join(", "))}. Principal purpose restrictions: ${escape(JSON.stringify(entry.classification.permittedPurposes ?? "not restricted"))}.</p>
    <p>Asserter identifier: ${escape(provenance.assertedBy.id)}. Assurance: ${escape(provenance.assertedBy.assurance)}.
    Latest confirmation: ${escape(provenance.confirmations.at(-1)?.disposition ?? "none")}.</p>
    <p>Assertion content, reported source and additional document members may be submitted claims. The recorded assurance and confirmations determine their standing.</p></section>`;
}
export function reviewEntry(entry: EntryView): string {
  const provenance = entry.record.provenance;
  return `<article>${statement(entry.content.value)}
    <p>Version ${entry.record.version} · ${escape(entry.record.status)} · ${escape(entry.assertion.declarationType)}</p>
    <p>Asserter: ${escape(provenance.assertedBy.id)}. Assurance: ${escape(provenance.assertedBy.assurance)}.
    Latest confirmation: ${escape(provenance.confirmations.at(-1)?.disposition ?? "none")}.</p>
    <p>Reported basis: ${escape(JSON.stringify(entry.assertion.basis ?? "not recorded"))}. Reported source: ${escape(provenance.source)}.</p>
    <p>Permitted purposes: ${escape(JSON.stringify({ assertion: entry.assertion.permittedPurposes ?? "not restricted", principal: entry.classification.permittedPurposes ?? "not restricted" }))}.</p></article>`;
}
export function personReview(
  current: EntryView | undefined,
  review: PersonReviewView,
  subjectId: string,
  csrf: string,
  operationKey: string,
): string {
  return `<p>Approving records this wording as your own authenticated statement. A revised version starts without prior confirmations.</p>
          ${current ? `<p>Target: ${escape(current.id)} · current version ${current.record.version} → new version ${current.record.version + 1}.</p><h2>Previous assertion</h2>${reviewEntry(current)}<details><summary>Previous assertion and evidence, whole</summary><pre>${escape(JSON.stringify({ assertion: current.assertion, evidence: current.evidence }, null, 2))}</pre></details><p>Evidence items removed: ${current.evidence?.length ?? 0}. Prior basis, assertion-purpose restrictions, validity deadline and confirmations are not inherited. The assertion is replaced whole.</p><p>Principal purpose restrictions remain: ${escape(JSON.stringify(current.classification.permittedPurposes ?? "not restricted"))}. Categories remain: ${escape(current.classification.categories.join(", "))}.</p>` : ""}
          <h2>Proposed assertion</h2>${statement(review.request.content.value)}<p>New person-declared assertion by the Synthetic context subject (${escape(subjectId)}), authenticated by this provider; source person-input. No evidence, basis, assertion-purpose restriction, validity deadline or confirmations are inherited. Unknown content members are preserved; they do not establish assurance.</p>
          <section data-person-authority><p>This authorizes the Synthetic person editor to ${review.operation === "create" ? "create this statement" : "revise this selected statement"} in ${escape(review.access[0].categories.join(", "))} for: ${escape(review.purpose.description)} (${escape(review.purpose.code)}). This permission expires at ${escape(review.expiresAt)}.</p></section>
          <details><summary>Exact replacement document</summary><pre>${escape(JSON.stringify(review.request, null, 2))}</pre></details>
          <form method="post" action="/manage/person/approve">${hidden("csrf", csrf)}${hidden("reviewId", review.reviewId)}${hidden("reviewCsrf", review.csrf)}${hidden("operationKey", operationKey)}<button>Approve and save my statement</button></form><a href="/manage/entries">Cancel without saving</a>`;
}

export function personEditor(
  current: EntryView | undefined,
  csrf: string,
  categories: string[],
): string {
  return `<p>Synthetic data only. This is an explicit person statement. Review the exact wording and replacement effects before saving. Login alone gives no write authority.</p><form method="post" action="/manage/person/review">${hidden("csrf", csrf)}
          ${
            current
              ? hidden("entryId", current.id) +
                hidden("expectedVersion", String(current.record.version))
              : `<label>Category <select name="category">${categories
                  .map((c) => `<option value="${c}">${escape(c)}</option>`)
                  .join("")}</select></label>`
          }
          <label>Your statement <textarea name="value" rows="6" required>${escape(current?.content.value ?? "")}</textarea></label><button>Review my statement</button></form><a href="/manage/entries">Cancel without saving</a>`;
}

export function entryDetail(
  result: EntryDetailView,
  history: HistoryPage,
  csrf: string,
  canEdit: boolean,
): string {
  const id = result.entry.id;
  const base = `/manage/entries/${encodeURIComponent(id)}`;
  return `<p><a href="/manage/entries">All retained entries</a> · <a href="/manage">Grant controls</a></p>
          <p>${escape(result.historyLabel)}. Current version: ${result.currentVersion}.</p>
          <p>Content versions: ${result.versions.map((v: number) => `<a href="${base}?version=${v}">${v}</a>`).join(" · ")}</p>
          <section>${statement(result.entry.content.value)}</section>
          ${entryFacts(result.entry)}
          <details data-raw-entry><summary>Full stored document (includes submitted claims)</summary><p>This document combines submitted content and extensions with provider-maintained records. Additional fields, including standing or fixture claims, do not establish assurance or confirmation.</p><pre data-entry-document>${escape(JSON.stringify(result.entry, null, 2))}</pre></details>
          <p>${result.entry.record.version !== result.currentVersion ? `Viewing a previous version. <a href="${base}">Open current version to edit</a>. ` : canEdit ? `<a href="/manage/person/${encodeURIComponent(id)}">Edit as your own statement</a> · ` : `${viewOnly} `}<a href="${base}/classification">Edit categories and purposes</a></p>
          ${result.entry.record.version === result.currentVersion && ["active", "conflicted"].includes(result.entry.record.status) ? ["confirmed", "rejected"].map((disposition) => `<form method="post" action="${base}/review">${hidden("csrf", csrf)}${hidden("expectedVersion", String(result.currentVersion))}${hidden("disposition", disposition)}<button>${disposition === "confirmed" ? "Review confirmation" : "Review rejection and withdrawal"}</button></form>`).join("") : ""}
          ${result.conflicts.length ? `<h2>Conflicts needing review</h2>${result.conflicts.map((c: any) => `<section>${reviewEntry(c.peer)}<p>${c.quarantined.length ? "This conflict still has a quarantined statement needing review." : "This conflict changed neither statement’s status."}</p>${c.canKeepBoth ? `<form method="post" action="/manage/conflicts/${encodeURIComponent(c.id)}/review">${hidden("csrf", csrf)}<button>Review keeping both</button></form>` : ""}</section>`).join("")}` : ""}
          <h2>Lifecycle and assertion history</h2>${historySummary(history)}${history.nextCursor ? `<a href="${base}?cursor=${encodeURIComponent(history.nextCursor)}">Next history page</a>` : ""}`;
}

const styles = `
.activity-filters{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:0 1rem}.activity-filters input{width:100%}.activity-filters label{margin:.5rem 0}
*{box-sizing:border-box}body{margin:0;background:#f6f7f4;color:#243b32;font:16px/1.6 system-ui,sans-serif;overflow-wrap:anywhere}
a{color:#24634a;text-underline-offset:3px}a:hover{color:#123b2a}a:focus-visible,button:focus-visible,input:focus-visible,textarea:focus-visible,select:focus-visible,summary:focus-visible{outline:3px solid #a15c17;outline-offset:4px}
.skip{position:absolute;top:-100px;left:1rem;background:white;padding:.5rem;z-index:2}.skip:focus{top:1rem}
.app-header{background:#fff;border-bottom:1px solid #dce4dc;padding:1.1rem max(1.25rem,calc((100% - 1060px)/2));display:flex;align-items:center;gap:1.5rem;flex-wrap:wrap}.brand{font-weight:750;font-size:1.1rem;text-decoration:none;margin-right:auto;letter-spacing:-.03em}.brand-mark{display:inline-grid;place-items:center;background:#24523d;color:white;width:32px;height:32px;border-radius:9px;margin-right:.6rem;font-size:.85rem;letter-spacing:0}
nav{display:flex;gap:.4rem;flex-wrap:wrap}nav a{padding:.45rem .8rem;border-radius:7px;text-decoration:none;font-size:.9rem}nav a[aria-current=page]{background:#e7eee6;font-weight:650;color:#1e4d35}
main{max-width:1060px;margin:2.5rem auto;padding:0 1.25rem}h1{font-size:2rem;line-height:1.2;letter-spacing:-.045em;margin:.5rem 0 1.4rem}h2{font-size:1.15rem;line-height:1.4;margin:1.5rem 0 .65rem}.eyebrow{font-size:.75rem;text-transform:uppercase;letter-spacing:.12em;color:#526b5e;margin:0}.intro{max-width:76ch;color:#536359}.muted,small{color:#536359;font-size:.88rem}small{display:block}
article,section{background:#fff;border:1px solid #dce4dc;border-radius:10px;padding:1.25rem;margin:1rem 0}article>:first-child,section>:first-child{margin-top:0}article>:last-child,section>:last-child{margin-bottom:0}.entries{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1rem;margin:1.5rem 0}.entries article{margin:0;display:flex;flex-direction:column}.entries .entry-link{margin-top:auto;padding-top:1rem}.statement{font:inherit;font-size:1.1rem;line-height:1.65;white-space:pre-wrap;margin:.85rem 0 1.1rem}.status{display:inline-block;background:#edf1ec;border:1px solid #dce4dc;padding:.1rem .55rem;border-radius:20px;font-size:.78rem;font-weight:650}.metadata{display:flex;gap:.65rem;align-items:center;flex-wrap:wrap;color:#536359;font-size:.82rem}
pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:.86rem;line-height:1.55}details{margin:1rem 0;border:1px solid #dce4dc;border-radius:8px;background:#fff;padding:.8rem 1rem}summary{cursor:pointer;font-weight:550}details pre{margin-top:1rem}label{display:block;margin:1rem 0;font-size:.95rem}input,select,button,textarea{font:inherit}input:not([type=hidden]):not([type=checkbox]),select,textarea{display:block;border:1px solid #96ab9d;border-radius:6px;background:#fff;color:#243b32;padding:.65rem .75rem;max-width:100%;margin-top:.4rem}textarea{width:100%;resize:vertical}input[type=password]{width:100%}button,.button{display:inline-block;border:1px solid #24523d;border-radius:7px;padding:.65rem 1rem;background:#24523d;color:#fff;text-decoration:none;font-weight:600;margin:.5rem .7rem .5rem 0;cursor:pointer}button:disabled{opacity:.55;cursor:default}.actions{display:flex;gap:.75rem;align-items:center;flex-wrap:wrap}.notice{border-left:3px solid #a15c17;padding:.6rem 1rem;background:#faf2e6}.success{border-left:3px solid #24523d;padding:.8rem 1rem;background:#e7eee6}
[data-history-summary]{padding-left:1.5rem}[data-history-summary] li{padding:.5rem 0 .8rem .4rem;border-bottom:1px solid #dce4dc}[data-history-summary] p{margin:.3rem 0}dl{display:grid;grid-template-columns:minmax(100px,1fr) minmax(0,3fr);gap:.5rem 1rem}dt{color:#536359}dd{margin:0}.footer{margin-top:2.5rem;padding-top:1rem;border-top:1px solid #dce4dc;color:#536359;font-size:.8rem}
@media(max-width:650px){main{margin:1.5rem auto}.app-header{gap:.75rem}.app-header nav{width:100%}nav a{padding:.4rem .6rem}.entries{grid-template-columns:1fr}h1{font-size:1.65rem}article,section{padding:1rem}dl{grid-template-columns:1fr;gap:.2rem}dd{margin-bottom:.65rem}}
`;

export function managementDocument(
  stage: string,
  title: string,
  content: string,
): string {
  const active =
    stage === "manage"
      ? "grants"
      : stage === "history"
        ? "history"
        : [
              "entries",
              "entry",
              "person-editor",
              "person-review",
              "person-saved",
              "person-view-only",
              "entry-review",
            ].includes(stage)
          ? "memories"
          : undefined;
  const nav = [
    ["memories", "/manage/entries", "Memories"],
    ["grants", "/manage", "Grants"],
    ["history", "/manage/audit", "Activity"],
  ]
    .map(
      ([key, href, label]) =>
        `<a href="${href}"${active === key && !["login", "management-error"].includes(stage) ? ' aria-current="page"' : ""}>${label}</a>`,
    )
    .join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title><style>${styles}</style></head><body data-stage="${escape(stage)}"><a class="skip" href="#main">Skip to content</a><header class="app-header"><a class="brand" href="/manage/entries"><span class="brand-mark" aria-hidden="true">cr</span>Context Router</a><nav aria-label="Main navigation">${nav}</nav></header><main id="main"><p class="eyebrow">Synthetic workspace</p><h1>${escape(title)}</h1>${content}<footer class="footer">Synthetic data only · Source experiment · No HCP conformance claim</footer></main></body></html>`;
}

function statement(value: unknown, pretty = true): string {
  return `<pre class="statement">${escape(typeof value === "string" ? value : JSON.stringify(value, null, pretty ? 2 : undefined))}</pre>`;
}

export function entryList(
  items: { entry: EntryView; canEdit: boolean }[],
): string {
  return `<p class="intro">Browse your synthetic memories, inspect their history, or review a correction. All retained lifecycle states are shown. Withdrawal retains history; hard deletion is unavailable.</p><p class="muted">${items.length} retained entries · Select a memory to inspect its content and versions.</p>
  ${items.length ? `<div class="entries">${items.map(({ entry, canEdit }) => `<article><div class="metadata"><span class="status">${escape(entry.record.status)}</span><span>Version ${entry.record.version}</span><span>${escape(entry.classification.categories.join(", "))}</span></div>${statement(entry.content.value, false)}${canEdit ? "" : "<small>View only in this text editor</small>"}<a class="entry-link" href="/manage/entries/${encodeURIComponent(entry.id)}">Inspect memory <span aria-hidden="true">→</span></a></article>`).join("")}</div>` : "<section><h2>No retained entries</h2><p>This workspace has no entries to inspect.</p></section>"}`;
}

export function personSaved(result: { id?: string }): string {
  return `<p class="success">Your approved statement was committed.</p>${result.id ? `<p><a class="button" href="/manage/entries/${encodeURIComponent(result.id)}">Inspect the entry and history</a></p>` : '<p>The entry representation is unavailable under the current permission. Sign in again to inspect retained history.</p><p><a href="/manage/entries">Sign in and inspect memories</a></p>'}<p>Do not repeat an uncertain save. Inspect current state and history through a separate request.</p>`;
}

export function historySummary(history: HistoryPage): string {
  return `${history.events.length ? `<ol data-history-summary>${history.events.map((event) => `<li><strong>${escape(event.eventType)}</strong> · ${escape(event.timestamp)}${event.data?.version === undefined ? "" : ` · version ${escape(event.data.version)}`}${event.data?.reason === undefined ? "" : `<p>${escape(event.data.reason)}</p>`}</li>`).join("")}</ol>` : "<p data-history-summary>No events in this view.</p>"}<details data-raw-history><summary>Full recorded audit events</summary><pre>${escape(JSON.stringify(history.events, null, 2))}</pre></details>`;
}

export function grantList(
  selected: GrantView[],
  copies: Map<string, string | null>,
  history: HistoryPage,
  id: string | null,
  csrf: string,
  status: string,
): string {
  return `<p class="intro">Inspect which synthetic clients have access, what they can do, and when access ends. Signing in does not issue a grant.</p>
  <nav aria-label="Grant views"><a href="/manage">Active grants</a><a href="/manage?status=all">All retained grants</a></nav>
  ${selected.length ? selected.map((g) => `<article><div class="metadata"><span class="status">${escape(g.status)}</span><span>${escape(g.grantType)} access</span></div><h2>${escape(g.client.name)}</h2><section data-grant-summary><h3>Approved scope</h3><p>Current rules and entry restrictions may limit this approved access. <a href="/manage/policy">Inspect current rules and directives</a>.</p><dl><dt>Operator</dt><dd>${escape(g.client.operator.name ?? g.client.operator.id)}</dd><dt>${g.status === "active" ? "Access ends" : "Access ended"}</dt><dd>${escape(g.status === "active" ? (g.expiresAt ?? "Persistent access; remains until revoked") : g.status)}</dd><dt>Last possible copy use-until</dt><dd>${escape(copies.get(g.grantId) ?? "No recorded copy")}</dd></dl>${g.access.map((a) => `<p><strong>${escape(a.actions.join(", "))}</strong> in ${escape(a.categories.join(", "))}.</p><p>Purposes: ${a.purposes?.map((p) => `${escape(p.description)} (${escape(p.code)})`).join("; ") ?? "Not specified"}.</p>${a.narrowedTo ? `<p>Restricted to ${a.narrowedTo.entryIds.length} selected existing entries; creating new entries is not permitted.</p>` : ""}`).join("")}</section><a href="/manage?grantId=${encodeURIComponent(g.grantId)}">Inspect grant and history</a><details><summary>Full grant document</summary><pre>${escape(JSON.stringify(g, null, 2))}</pre></details>${g.client.legalRetention ? `<p>Declared legal retention: ${escape(g.client.legalRetention.record)}, under ${escape(g.client.legalRetention.obligation)}, for ${escape(g.client.legalRetention.period)}. Revocation does not remove copies held in that record under the declared obligation.</p>` : ""}${g.status !== "revoked" ? `<p class="muted">${g.status === "expired" ? "Access has already expired. You can still record an explicit revocation." : "Revocation stops future access."} It does not prove remote copies were erased; copies retain their own use-until deadline.</p><form method="post" action="/manage/revoke">${hidden("csrf", csrf)}${hidden("grantId", g.grantId)}<button>Revoke grant</button></form>` : ""}</article>`).join("") : `<section><h2>${id ? "No matching retained grant" : status === "active" ? "No active grants" : "No grants in this view"}</h2><p>No client access is shown here. Use All retained grants to inspect expired or revoked grants. Synthetic client registration alone gives no access.</p></section>`}
  ${id ? `<h2>Grant history</h2>${historySummary(history)}${history.nextCursor ? `<a href="/manage?grantId=${encodeURIComponent(id)}&amp;cursor=${encodeURIComponent(history.nextCursor)}">Next history page</a>` : ""}` : ""}
  <section><h2>Access and disclosure history</h2><p>Automatic conflict checks cover controlled facts with matching category, slot and setting. Authorized clients can also assert a contradiction. Conflicted statements remain available here for your review.</p><p>Disclosure history records attempted releases, including write representations. Receipt is unconfirmed, including when a response is lost or expires before handoff. ${selected.some((g) => g.client.notificationEndpoint) ? "Registered synthetic endpoints receive revocation notices for previously disclosed copies. Pending, delivered and abandoned delivery outcomes are shown in possible disclosures and audit history." : "No notification endpoint is configured for these clients; no revocation notification or remote erasure is promised."} An acknowledgement is not evidence of erasure. Clients must stop using copies when notified of revocation, or at use-until.</p></section>
  <details><summary>Experimental management controls</summary><nav><a href="/manage/policy">Rules and directives</a><a href="/manage/disclosures">Possible disclosures</a><a href="/manage/export">Export</a><a href="/manage/import">Import</a><a href="/manage/person/new">Add your own statement</a></nav><p>These existing experimental workflows have separate acceptance scope from the correction demo.</p></details>`;
}

export function managementError(
  status: number,
  mutation: boolean,
): { title: string; body: string } {
  const title =
    status === 503
      ? mutation
        ? "Save outcome uncertain"
        : "Workspace unavailable"
      : status === 401
        ? "Sign in again"
        : status === 409
          ? "Review no longer current"
          : "Request refused";
  const explanation =
    status === 503
      ? mutation
        ? "We could not confirm the result of this request. It may already have been recorded. Do not submit again to find out."
        : "The workspace could not safely complete this request. Try a separate inspection when the provider is available."
      : status === 401
        ? "Your management session is no longer valid. Sign in again before inspecting current state or starting a fresh review."
        : "This request does not meet the current authorization or input requirements. A review may have expired or the entry or its permissions may have changed. Inspect current state before starting a fresh review.";
  return {
    title,
    body: `<p class="notice">${explanation}</p><p>An error does not establish whether an earlier save took effect. Use a separate inspection of current state and history. No request is retried automatically.</p><p><a href="/manage/audit">Start a fresh activity view</a></p><p><a class="button" href="/manage/entries">Inspect memories and history</a> <a href="/manage">Inspect grants</a></p>`,
  };
}
