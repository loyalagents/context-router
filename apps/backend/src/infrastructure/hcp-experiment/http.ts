import type { IncomingMessage, ServerResponse } from "node:http";
import { AuthorizationRepository, random } from "./authority";
import {
  AuthorityError,
  CATEGORIES,
  CONTEXT_SCOPES,
  PURPOSES,
  denied,
  invalid,
  keys,
  scopeAccess,
  validateAccess,
} from "./policy";
import { authorizationProvider, validateAuthorization } from "./oauth";
import { WriteConflict } from "./writes";
import { CONFLICT_DETECTION } from "./conflicts";
const COOKIE = "__Host-hcp-human";
class UnsupportedVersion extends Error {}
const escape = (s: any) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const hidden = (name: string, value: string) =>
  `<input type="hidden" name="${escape(name)}" value="${escape(value)}">`;
function reviewEntry(entry: any): string {
  const provenance = entry.record.provenance;
  return `<article><pre>${escape(typeof entry.content.value === "string" ? entry.content.value : JSON.stringify(entry.content.value, null, 2))}</pre>
    <p>Version ${entry.record.version} · ${escape(entry.record.status)} · ${escape(entry.assertion.declarationType)}</p>
    <p>Asserter: ${escape(provenance.assertedBy.id)}. Assurance: ${escape(provenance.assertedBy.assurance)}.
    Latest confirmation: ${escape(provenance.confirmations.at(-1)?.disposition ?? "none")}.</p>
    <p>Basis: ${escape(JSON.stringify(entry.assertion.basis ?? "not recorded"))}. Source: ${escape(provenance.source)}.</p>
    <p>Permitted purposes: ${escape(JSON.stringify({ assertion: entry.assertion.permittedPurposes ?? "not restricted", principal: entry.classification.permittedPurposes ?? "not restricted" }))}.</p></article>`;
}
const cookie = (req: IncomingMessage) =>
  (req.headers.cookie ?? "")
    .split(/;\s*/)
    .find((c) => c.startsWith(COOKIE + "="))
    ?.slice(COOKIE.length + 1) ?? "";
function setCookie(res: ServerResponse, token: string): void {
  res.setHeader(
    "set-cookie",
    `${COOKIE}=${token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=43200`,
  );
}
function json(
  res: ServerResponse,
  status: number,
  value: any,
  type = "application/ld+json",
): void {
  res.statusCode = status;
  res.setHeader("content-type", type);
  res.end(status === 204 ? undefined : JSON.stringify(value));
}
function page(
  res: ServerResponse,
  stage: string,
  title: string,
  body: string,
): void {
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.setHeader(
    "content-security-policy",
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  );
  res.end(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escape(title)}</title><style>body{font:16px system-ui;max-width:800px;margin:3rem auto;padding:0 1rem;line-height:1.5}label{display:block;margin:1rem 0}input,select,button{font:inherit}pre{white-space:pre-wrap;overflow-wrap:anywhere}button{margin:1rem 1rem 1rem 0}small{display:block}</style></head><body data-stage="${stage}"><p>Context Router · Synthetic C2 experiment</p><h1>${escape(title)}</h1>${body}</body></html>`,
  );
}
async function requestBytes(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const b of req) {
    size += b.length;
    if (size > 32768) invalid();
    chunks.push(b);
  }
  return Buffer.concat(chunks);
}
async function body(req: IncomingMessage): Promise<any> {
  const text = (await requestBytes(req)).toString();
  if (req.headers["content-type"] === "application/json") {
    try {
      return JSON.parse(text);
    } catch (error) {
      if (error instanceof SyntaxError) invalid();
      throw error;
    }
  }
  if (req.headers["content-type"] !== "application/x-www-form-urlencoded")
    invalid();
  const form = new URLSearchParams(text);
  for (const key of form.keys()) if (form.getAll(key).length !== 1) invalid();
  return Object.fromEntries(form);
}
function selection(form: any): any {
  keys(form, ["csrf", "purposes", "categories", "entryIds", "durationSeconds"]);
  const chosen: any = {};
  for (const k of ["purposes", "categories", "entryIds"])
    if (form[k] !== undefined && form[k] !== "") chosen[k] = form[k].split(",");
  if (form.durationSeconds !== undefined)
    chosen.durationSeconds = Number(form.durationSeconds);
  return chosen;
}
export function authorizationHandler(
  authority: AuthorizationRepository,
  entryLabels: () => any[],
): (req: IncomingMessage, res: ServerResponse) => void {
  const provider = authorizationProvider(authority),
    oauth = provider.callback();
  const issuer = authority.configuration.issuer,
    host = new URL(issuer).host;
  const contextOperation = <T>(credential: string, operation: () => T): T => {
    try {
      return operation();
    } catch (error) {
      // Time can cross a deadline between admission and the synchronous operation.
      if (
        error instanceof AuthorityError &&
        !authority.protocolFind("AccessToken", credential)
      )
        throw new AuthorityError("unauthenticated");
      throw error;
    }
  };
  const browser = (req: IncomingMessage, res: ServerResponse) => {
    const token = cookie(req);
    try {
      return { token, ...authority.browserSession(token) };
    } catch (e) {
      if (!(e instanceof AuthorityError)) throw e;
    }
    const session = authority.beginBrowserSession();
    setCookie(res, session.token);
    return session;
  };
  const csrf = (req: IncomingMessage, value: string) => {
    if (req.headers.origin !== issuer || typeof value !== "string") denied();
    return authority.browserSession(cookie(req), value);
  };
  const loginPage = (res: ServerResponse, action: string, s: any) =>
    page(
      res,
      "login",
      "Sign in to manage synthetic context",
      `<p>Signing in does not approve a context grant.</p><form method="post" action="${escape(action)}">${hidden("csrf", s.csrf)}<label>Human management credential <input name="credential" type="password" autocomplete="off" required></label><button>Sign in</button></form>`,
    );
  async function handle(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    // no-referrer makes Chromium send Origin:null on form POSTs, defeating our
    // same-origin CSRF check. strict-origin discloses no path/query or credentials.
    res.setHeader("cache-control", "no-store");
    res.setHeader("referrer-policy", "strict-origin");
    res.setHeader("x-content-type-options", "nosniff");
    if (req.url?.startsWith("/v2/")) res.setHeader("hcp-version", "2.0");
    if (
      req.headers.host !== host ||
      Object.keys(req.headers).some(
        (h) => h === "forwarded" || h.startsWith("x-forwarded-"),
      ) ||
      !req.url?.startsWith("/") ||
      req.url.startsWith("//")
    )
      invalid();
    const url = new URL(req.url, issuer),
      route = url.pathname;
    if (req.url.length > 16384) invalid();
    if (route.startsWith("/v2/")) {
      res.setHeader("hcp-version", "2.0");
      if (
        req.headers["hcp-version"] !== undefined &&
        req.headers["hcp-version"] !== "2.0"
      )
        throw new UnsupportedVersion();
    }
    if (route === "/auth") {
      if (req.method !== "GET" || req.headers.authorization) invalid();
      try {
        validateAuthorization(url.searchParams, authority);
      } catch {
        invalid();
      }
      return oauth(req, res);
    }
    if (
      /^\/auth\/[A-Za-z0-9_-]+$/.test(route) ||
      route === "/token" ||
      route === "/jwks" ||
      route === "/.well-known/oauth-authorization-server"
    ) {
      if (
        (route === "/token" ? req.method !== "POST" : req.method !== "GET") ||
        url.search
      )
        invalid();
      return oauth(req, res);
    }
    if (
      route === "/.well-known/oauth-protected-resource" &&
      req.method === "GET"
    ) {
      return json(
        res,
        200,
        {
          resource: issuer,
          authorization_servers: [issuer],
          bearer_methods_supported: ["header"],
          scopes_supported: CONTEXT_SCOPES,
        },
        "application/json",
      );
    }
    if (route === "/experiment/capabilities" && req.method === "GET") {
      return json(
        res,
        200,
        {
          experimental: true,
          protocolTarget: "HCP 2.0-draft-3",
          operations: [
            "own-grant",
            "relinquish",
            "human-grants",
            "human-audit",
            "human-revoke",
          ],
          publicEntryRead: authority.entryReadEnabled(),
          publicEntryWrite: authority.entryReadEnabled(),
          writeDeclarationTypes: ["person-declared", "model-inferred"],
          conflict_detection: CONFLICT_DETECTION,
        },
        "application/json",
      );
    }
    const interactionMatch =
      /^\/interaction\/([A-Za-z0-9_-]+)(?:\/(login|review|approve|decline))?$/.exec(
        route,
      );
    if (interactionMatch) {
      if (url.search || req.headers.authorization) invalid();
      let interaction: any;
      try {
        interaction = await provider.interactionDetails(req, res);
      } catch (error) {
        if (error.statusCode === 400) denied();
        throw error;
      }
      if (interaction.uid !== interactionMatch[1]) denied();
      const base = `/interaction/${interaction.uid}`,
        action = interactionMatch[2];
      if (req.method === "GET" && !action) {
        const s = browser(req, res);
        if (interaction.prompt.name === "login" || !s.authenticated)
          return loginPage(res, `${base}/login`, s);
        const params = interaction.params,
          client = authority.configuration.clients.find(
            (c) => c.id === params.client_id,
          )!;
        const requested = params.authorization_details
          ? validateAccess(JSON.parse(params.authorization_details), true)
          : scopeAccess(params.scope);
        const purposesMissing = requested.some((d) => !d.purposes);
        const available = purposesMissing
          ? PURPOSES
          : requested.flatMap((d) => d.purposes);
        return page(
          res,
          "consent",
          "Review requested access",
          `<p>${escape(client.name)} · ${escape(client.operator.name)} (${escape(client.operator.id)})</p>
          <p>Read access only. Temporary: four hours by default, up to 24 hours. Client copies have a one-hour maximum use period. Grant expiry stops retrieval; an existing copy follows its own use-until. Clients must stop using copies when notified of revocation, or at use-until. These controlled clients make no directive-following claim.</p>
          <pre>${escape(JSON.stringify(requested, null, 2))}</pre><dl>${Object.entries(
            CATEGORIES,
          )
            .map(
              ([c, definition]) =>
                `<dt>${escape(c)}</dt><dd>${escape(definition)}</dd>`,
            )
            .join("")}</dl>
          <form method="post" action="${base}/review">${hidden("csrf", s.csrf)}
          ${purposesMissing ? `<label>Choose a purpose <select name="purposes" required><option value="">Choose…</option>${available.map((p) => `<option value="${escape(p.code)}">${escape(p.description)}</option>`).join("")}</select></label>` : ""}
          <label>Duration in seconds (maximum 86400) <input type="number" name="durationSeconds" min="1" max="86400" value="14400" required></label>
          <label>Narrow categories (comma-separated; blank keeps requested categories) <input name="categories"></label>
          <label>Narrow to private entry IDs (comma-separated; blank keeps requested restriction) <input name="entryIds"></label>
          <details><summary>Synthetic entry labels for narrowing</summary><pre>${escape(JSON.stringify(entryLabels(), null, 2))}</pre></details>
          <button>Review exact grant</button></form><form method="post" action="${base}/decline">${hidden("csrf", s.csrf)}<button>Decline</button></form>`,
        );
      }
      if (req.method !== "POST" || !action) invalid();
      const form = await body(req);
      if (action === "login") {
        keys(form, ["csrf", "credential"]);
        csrf(req, form.csrf);
        const s = authority.loginBrowser(
          cookie(req),
          form.csrf,
          form.credential,
        );
        setCookie(res, s.token);
        await provider.interactionFinished(
          req,
          res,
          {
            login: {
              accountId: authority.accountId(),
              acr: "urn:context-router:acr:local-credential",
              amr: ["pwd"],
            },
          },
          { mergeWithLastSubmission: false },
        );
        return;
      }
      if (!authority.isManagement(cookie(req))) denied();
      if (req.headers.origin !== issuer) denied();
      if (action === "review") {
        csrf(req, form.csrf);
        const params = interaction.params;
        const reviewed = authority.review(
          cookie(req),
          {
            interactionId: interaction.uid,
            clientId: params.client_id,
            resource: params.resource,
            ...(params.authorization_details
              ? { access: JSON.parse(params.authorization_details) }
              : { scope: params.scope }),
          },
          selection(form),
          cookie(req) + ":" + interaction.uid,
        );
        return page(
          res,
          "review",
          "Approve this exact grant",
          `<p>${escape(reviewed.client.name)} · ${escape(reviewed.client.operator.name)}</p>
          <p>Expires at <strong>${escape(reviewed.expiresAt)}</strong>. Client copies have a one-hour maximum use period. Grant expiry stops retrieval; an existing copy follows its own use-until. Clients must stop using copies when notified of revocation, or at use-until.</p>
          <pre>${escape(JSON.stringify({ access: reviewed.access, exclusions: reviewed.exclusions }, null, 2))}</pre>
          <dl>${Object.entries(CATEGORIES)
            .map(([c, d]) => `<dt>${escape(c)}</dt><dd>${escape(d)}</dd>`)
            .join("")}</dl>
          <form method="post" action="${base}/approve">${hidden("reviewId", reviewed.reviewId)}${hidden("csrf", reviewed.csrf)}<button${reviewed.access.length ? "" : " disabled"}>Approve access</button></form>`,
        );
      }
      if (action === "decline") {
        keys(form, ["csrf"]);
        csrf(req, form.csrf);
        await provider.interactionFinished(
          req,
          res,
          { error: "access_denied" },
          { mergeWithLastSubmission: false },
        );
        return;
      }
      keys(form, ["reviewId", "csrf"]);
      const committed = authority.approve(
        cookie(req),
        form.reviewId,
        form.csrf,
        cookie(req) + ":" + interaction.uid,
        "browser",
      );
      const grant = new provider.Grant({
        jti: committed.grantId,
        accountId: authority.accountId(),
        clientId: committed.client.id,
      });
      grant.addResourceScope(issuer, committed.scopes.join(" "));
      for (const d of authority.ownGrant(committed.grantId, committed.client.id)
        .grants[0].access)
        grant.addRar(d);
      await grant.save();
      authority.ownGrant(committed.grantId, committed.client.id);
      await provider.interactionFinished(
        req,
        res,
        { consent: { grantId: committed.grantId } },
        { mergeWithLastSubmission: true },
      );
      return;
    }
    if (route.startsWith("/manage")) {
      if (req.headers.authorization) denied();
      const s = browser(req, res);
      if (route === "/manage/login" && req.method === "POST") {
        const form = await body(req);
        keys(form, ["csrf", "credential"]);
        csrf(req, form.csrf);
        const authenticated = authority.loginBrowser(
          cookie(req),
          form.csrf,
          form.credential,
        );
        setCookie(res, authenticated.token);
        res.writeHead(303, { location: "/manage" });
        res.end();
        return;
      }
      if (!s.authenticated) return loginPage(res, "/manage/login", s);
      if (
        route === "/manage/conflicts/approve" &&
        req.method === "POST" &&
        !url.search
      ) {
        const form = await body(req);
        keys(form, ["csrf", "reviewId", "reviewCsrf"]);
        csrf(req, form.csrf);
        const result = authority.approveKeepBoth(
          s.token,
          form.reviewId,
          form.reviewCsrf,
          s.token,
        );
        if (!result.id)
          return page(
            res,
            "conflict-saved",
            "Action recorded",
            "<p>Your action was committed. Sign in again to inspect retained history.</p>",
          );
        res
          .writeHead(303, {
            location: `/manage/entries/${encodeURIComponent(result.id)}`,
          })
          .end();
        return;
      }
      const conflictReview = /^\/manage\/conflicts\/([^/]+)\/review$/.exec(
        route,
      );
      if (conflictReview && req.method === "POST" && !url.search) {
        const form = await body(req);
        keys(form, ["csrf"]);
        csrf(req, form.csrf);
        let relationId: string;
        try {
          relationId = decodeURIComponent(conflictReview[1]);
        } catch {
          invalid();
        }
        const review = authority.reviewKeepBoth(s.token, relationId!, s.token);
        return page(
          res,
          "conflict-review",
          "Review keeping both statements",
          `<p>This conflict did not quarantine either statement. Keeping both leaves their content and standing unchanged and dismisses this conflict until a revision requires evaluation again.</p>
          ${reviewEntry(review.entry)}${reviewEntry(review.conflict.peer)}
          ${review.conflict.document.proposal ? `<p>Proposed resolution: ${escape(JSON.stringify(review.conflict.document.proposal))}. Keeping both does not apply that proposal.</p>` : ""}
          <form method="post" action="/manage/conflicts/approve">${hidden("csrf", s.csrf)}${hidden("reviewId", review.reviewId)}${hidden("reviewCsrf", review.csrf)}<button>Keep both statements</button></form>`,
        );
      }
      if (
        route === "/manage/person/approve" &&
        req.method === "POST" &&
        !url.search
      ) {
        const form = await body(req);
        keys(form, ["csrf", "reviewId", "reviewCsrf", "operationKey"]);
        csrf(req, form.csrf);
        const ticket = await authority.commitReviewedPersonWrite(
          s.token,
          form.reviewId,
          form.reviewCsrf,
          s.token,
          form.operationKey,
        );
        authority.releaseWrite(ticket, (status, bytes) => {
          const result = JSON.parse(bytes);
          res.statusCode = status;
          page(
            res,
            "person-saved",
            "Statement saved",
            `<p>Your approved statement was committed.</p>${result.id ? `<p><a href="/manage/entries/${encodeURIComponent(result.id)}">Inspect the entry and history</a></p>` : "<p>The entry representation is unavailable under the current permission. Sign in again to inspect retained history.</p>"}`,
          );
        });
        return;
      }
      if (
        route === "/manage/person/review" &&
        req.method === "POST" &&
        !url.search
      ) {
        const form = await body(req);
        keys(form, ["csrf", "value", "category", "entryId", "expectedVersion"]);
        csrf(req, form.csrf);
        if (typeof form.value !== "string" || !form.value.trim()) invalid();
        const target = form.entryId || undefined;
        const current = target
          ? authority.managementEntry(s.token, target).entry
          : undefined;
        const request = {
          ...(current
            ? {
                expectedVersion: Number(form.expectedVersion),
                reason: "Person edited their statement",
              }
            : {
                schema: "https://hcp.example/spec/entry/2.0",
                subject: { id: authority.accountId() },
                classification: { categories: [form.category] },
              }),
          content: {
            ...(current?.content ?? {
              profile: "https://hcp.example/spec/profiles/general-context/2.0",
            }),
            value: form.value,
          },
          assertion: { declarationType: "person-declared" },
          record: { provenance: { source: "person-input" } },
        };
        const review = authority.reviewPersonWrite(
          s.token,
          current ? "revise" : "create",
          request,
          target,
          s.token,
        );
        return page(
          res,
          "person-review",
          "Review your statement",
          `<p>Approving records this wording as your own authenticated statement. A revised version starts without prior confirmations.</p><pre>${escape(JSON.stringify(review.request, null, 2))}</pre>
          <form method="post" action="/manage/person/approve">${hidden("csrf", s.csrf)}${hidden("reviewId", review.reviewId)}${hidden("reviewCsrf", review.csrf)}${hidden("operationKey", random())}<button>Approve and save my statement</button></form>`,
        );
      }
      const personEditor = /^\/manage\/person\/([^/]+)$/.exec(route);
      if (personEditor && req.method === "GET" && !url.search) {
        const id =
          personEditor[1] === "new"
            ? undefined
            : decodeURIComponent(personEditor[1]);
        const current = id
          ? authority.managementEntry(s.token, id).entry
          : undefined;
        return page(
          res,
          "person-editor",
          current ? "Edit as your own statement" : "Add your own statement",
          `<p>This is an explicit person statement. Review the exact wording before saving.</p><form method="post" action="/manage/person/review">${hidden("csrf", s.csrf)}
          ${
            current
              ? hidden("entryId", current.id) +
                hidden("expectedVersion", String(current.record.version))
              : `<label>Category <select name="category">${Object.keys(
                  CATEGORIES,
                )
                  .map((c) => `<option value="${c}">${escape(c)}</option>`)
                  .join("")}</select></label>`
          }
          <label>Your statement <textarea name="value" rows="6" required>${escape(current ? (typeof current.content.value === "string" ? current.content.value : JSON.stringify(current.content.value)) : "")}</textarea></label><button>Review my statement</button></form>`,
        );
      }
      if (
        route === "/manage/entries/approve" &&
        req.method === "POST" &&
        !url.search
      ) {
        const form = await body(req);
        keys(form, ["csrf", "reviewId", "reviewCsrf"]);
        csrf(req, form.csrf);
        const entry = authority.approveConfirmation(
          s.token,
          form.reviewId,
          form.reviewCsrf,
          s.token,
        );
        if (!entry.id)
          return page(
            res,
            "confirmation-saved",
            "Action recorded",
            "<p>Your action was committed. Sign in again to inspect retained history.</p>",
          );
        res
          .writeHead(303, {
            location: `/manage/entries/${encodeURIComponent(entry.id)}`,
          })
          .end();
        return;
      }
      const managed = /^\/manage\/entries\/([^/]+)(\/review)?$/.exec(route);
      if (managed) {
        let id: string;
        try {
          id = decodeURIComponent(managed[1]);
        } catch {
          invalid();
        }
        if (managed[2] && req.method === "POST" && !url.search) {
          const form = await body(req);
          keys(form, ["csrf", "expectedVersion", "disposition"]);
          csrf(req, form.csrf);
          const review = authority.reviewConfirmation(
            s.token,
            id!,
            {
              expectedVersion: Number(form.expectedVersion),
              disposition: form.disposition,
            },
            s.token,
          );
          return page(
            res,
            "entry-review",
            review.disposition === "confirmed"
              ? "Confirm this version"
              : "Reject and withdraw this version",
            `<p>Review the statement and its current lifecycle, assertion, standing and permitted purposes. This action does not edit the statement or its author.</p>${reviewEntry(review.entry)}
            ${review.conflicts.length ? `<h2>Related statements affected</h2><p>Accepting a quarantined statement can deprecate an authoritative opposing statement. Other unresolved conflicts remain open.</p>${review.conflicts.map((c: any) => `${reviewEntry(c.peer)}${c.document.proposal ? `<p>Proposal: ${escape(JSON.stringify(c.document.proposal))}</p>` : ""}`).join("")}` : ""}
            <form method="post" action="/manage/entries/approve">${hidden("csrf", s.csrf)}${hidden("reviewId", review.reviewId)}${hidden("reviewCsrf", review.csrf)}<button>${review.disposition === "confirmed" ? "Confirm this version" : "Reject and withdraw"}</button></form>`,
          );
        }
        if (req.method !== "GET" || managed[2]) invalid();
        for (const key of url.searchParams.keys())
          if (
            !["version", "cursor"].includes(key) ||
            url.searchParams.getAll(key).length !== 1
          )
            invalid();
        const result = authority.managementEntry(
          s.token,
          id!,
          url.searchParams.has("version")
            ? Number(url.searchParams.get("version"))
            : undefined,
        );
        const history = authority.audit(s.token, {
          entryId: id!,
          limit: 20,
          ...(url.searchParams.has("cursor")
            ? { cursor: url.searchParams.get("cursor")! }
            : {}),
        });
        const base = `/manage/entries/${encodeURIComponent(id!)}`;
        return page(
          res,
          "entry",
          "Retained entry and history",
          `<p><a href="/manage/entries">All retained entries</a> · <a href="/manage">Grant controls</a></p>
          <p>${escape(result.historyLabel)}. Current version: ${result.currentVersion}.</p>
          <p>Content versions: ${result.versions.map((v: number) => `<a href="${base}?version=${v}">${v}</a>`).join(" · ")}</p><pre>${escape(JSON.stringify(result.entry, null, 2))}</pre><p><a href="/manage/person/${encodeURIComponent(id!)}">Edit as your own statement</a></p>
          ${result.entry.record.version === result.currentVersion && ["active", "conflicted"].includes(result.entry.record.status) ? ["confirmed", "rejected"].map((disposition) => `<form method="post" action="${base}/review">${hidden("csrf", s.csrf)}${hidden("expectedVersion", String(result.currentVersion))}${hidden("disposition", disposition)}<button>${disposition === "confirmed" ? "Review confirmation" : "Review rejection and withdrawal"}</button></form>`).join("") : ""}
          ${result.conflicts.length ? `<h2>Conflicts needing review</h2>${result.conflicts.map((c: any) => `<section>${reviewEntry(c.peer)}<p>${c.quarantined.length ? "This conflict still has a quarantined statement needing review." : "This conflict changed neither statement’s status."}</p>${c.canKeepBoth ? `<form method="post" action="/manage/conflicts/${encodeURIComponent(c.id)}/review">${hidden("csrf", s.csrf)}<button>Review keeping both</button></form>` : ""}</section>`).join("")}` : ""}
          <h2>Lifecycle and assertion history</h2><pre>${escape(JSON.stringify(history.events, null, 2))}</pre>${history.nextCursor ? `<a href="${base}?cursor=${encodeURIComponent(history.nextCursor)}">Next history page</a>` : ""}`,
        );
      }
      if (route === "/manage/entries" && req.method === "GET" && !url.search) {
        return page(
          res,
          "entries",
          "Retained entries",
          `<p><a href="/manage">Grant controls</a> · <a href="/manage/person/new">Add your own statement</a></p>${authority
            .managementEntries(s.token)
            .map(
              (entry) =>
                `<article><a href="/manage/entries/${encodeURIComponent(entry.id)}">${escape(entry.id)}</a><p>Current lifecycle: ${escape(entry.record.status)} · version ${entry.record.version}</p><pre>${escape(JSON.stringify(entry.content, null, 2))}</pre></article>`,
            )
            .join("")}`,
        );
      }
      if (route === "/manage/revoke" && req.method === "POST") {
        const form = await body(req);
        keys(form, ["csrf", "grantId"]);
        csrf(req, form.csrf);
        authority.revoke(s.token, form.grantId);
        res.writeHead(303, { location: "/manage?status=all" });
        res.end();
        return;
      }
      if (req.method !== "GET" || route !== "/manage") invalid();
      const grants = authority.listGrants(
        s.token,
        url.searchParams.get("status") ?? "active",
      );
      const id = url.searchParams.get("grantId");
      const selected = id
        ? authority.listGrants(s.token, "all").filter((g) => g.grantId === id)
        : grants;
      for (const key of url.searchParams.keys())
        if (url.searchParams.getAll(key).length !== 1) invalid();
      const history = id
        ? authority.audit(s.token, {
            grantId: id,
            limit: 20,
            ...(url.searchParams.has("cursor")
              ? { cursor: url.searchParams.get("cursor")! }
              : {}),
          })
        : { events: [], nextCursor: null };
      const copies = new Map(
        selected.map((g) => [
          g.grantId,
          authority.lastPossibleCopyUseUntil(s.token, g.grantId),
        ]),
      );
      return page(
        res,
        "manage",
        "Human grant controls",
        `<p><a href="/manage/entries">Retained entries and history</a> · <a href="/manage">Active grants</a> · <a href="/manage?status=all">All retained grants</a></p><p>Automatic conflict checks cover controlled facts with matching category, slot and setting. Authorized clients can also assert a contradiction. Conflicted statements remain available here for your review.</p><p>Disclosure history records attempted releases, including write representations. Receipt is unconfirmed, including when a response is lost or expires before handoff. No notification endpoint is configured; no revocation notification or remote erasure is promised. Clients must stop using copies when notified of revocation, or at use-until.</p>
        ${selected.map((g) => `<article><h2>${escape(g.client.name)} · ${escape(g.status)}</h2><a href="/manage?grantId=${encodeURIComponent(g.grantId)}">Inspect grant and history</a><p>Last possible copy use-until: ${escape(copies.get(g.grantId) ?? "No recorded copy")}</p><pre>${escape(JSON.stringify(g, null, 2))}</pre>${g.status === "active" ? `<form method="post" action="/manage/revoke">${hidden("csrf", s.csrf)}${hidden("grantId", g.grantId)}<button>Revoke grant</button></form>` : ""}</article>`).join("")}
        ${id ? `<h2>Grant history</h2><pre>${escape(JSON.stringify(history.events, null, 2))}</pre>${history.nextCursor ? `<a href="/manage?grantId=${encodeURIComponent(id)}&amp;cursor=${encodeURIComponent(history.nextCursor)}">Next history page</a>` : ""}` : ""}`,
      );
    }
    if (route.startsWith("/v2/") || route === "/experiment/policy") {
      if (req.headers.cookie || url.searchParams.has("access_token")) denied();
      const credential = /^Bearer ([A-Za-z0-9_-]+)$/.exec(
        String(req.headers.authorization ?? ""),
      )?.[1];
      if (!credential) throw new AuthorityError("unauthenticated");
      const human = authority.isManagement(credential);
      const token = human
        ? undefined
        : authority.protocolFind("AccessToken", credential);
      if (!human && !token) throw new AuthorityError("unauthenticated");
      const revisionRoute = /^\/v2\/entries\/([^/]+)\/revisions$/.exec(route);
      if (
        route === "/v2/entries" ||
        revisionRoute ||
        (/^\/v2\/entries\/[^/]+$/.test(route) && req.method === "DELETE")
      ) {
        if (human) denied();
        if (
          url.search ||
          ((route === "/v2/entries" || revisionRoute) && req.method !== "POST")
        )
          invalid();
        if (
          !["application/json", "application/ld+json"].includes(
            String(req.headers["content-type"]),
          )
        )
          invalid();
        if (
          req.rawHeaders.filter(
            (h, i) => i % 2 === 0 && h.toLowerCase() === "idempotency-key",
          ).length > 1
        )
          invalid();
        let raw: string, input: any, ref: string | undefined;
        const bytes = await requestBytes(req);
        try {
          raw = new TextDecoder("utf-8", {
            fatal: true,
            ignoreBOM: true,
          }).decode(bytes);
          input = JSON.parse(raw);
          if (route !== "/v2/entries")
            ref = decodeURIComponent(
              revisionRoute?.[1] ?? route.slice("/v2/entries/".length),
            );
        } catch {
          invalid();
        }
        const key = req.headers["idempotency-key"];
        if (key !== undefined && typeof key !== "string") invalid();
        const ticket = await authority.commitWrite(
          credential,
          route === "/v2/entries"
            ? "create"
            : revisionRoute
              ? "revise"
              : "withdraw",
          input,
          raw!,
          key as string | undefined,
          ref,
        );
        authority.releaseWrite(ticket, (status, response) => {
          res.statusCode = status;
          res.setHeader("content-type", "application/ld+json");
          res.end(response);
        });
        return;
      }
      if (
        route === "/v2/entries/query" ||
        /^\/v2\/entries\/[^/]+$/.test(route)
      ) {
        if (human) denied();
        const isQuery = route === "/v2/entries/query";
        if (
          req.method !== (isQuery ? "POST" : "GET") ||
          (isQuery && url.search)
        )
          invalid();
        for (const key of url.searchParams.keys())
          if (url.searchParams.getAll(key).length !== 1) invalid();
        const input = isQuery
          ? await body(req)
          : Object.fromEntries(url.searchParams);
        if (!isQuery && input.version !== undefined) {
          if (!/^[1-9][0-9]*$/.test(input.version)) invalid();
          input.version = Number(input.version);
        }
        let ref: string | undefined;
        if (!isQuery) {
          try {
            ref = decodeURIComponent(route.slice("/v2/entries/".length));
          } catch (error) {
            if (error instanceof URIError) invalid();
            throw error;
          }
        }
        const prepared = await authority.prepareRead(
          credential,
          isQuery ? "query" : "get",
          input,
          ref,
        );
        res.statusCode = 200;
        res.setHeader("content-type", "application/ld+json");
        authority.releaseRead(prepared, (bytes) => {
          res.end(bytes);
        });
        return;
      }
      const grantMatch = /^\/v2\/grants(?:\/(urn:uuid:[0-9a-f-]+))?$/.exec(
        decodeURI(route),
      );
      if (grantMatch) {
        if (req.method === "GET" && !grantMatch[1]) {
          const result = human
            ? {
                grants: authority.listGrants(
                  credential,
                  url.searchParams.get("status") ?? "active",
                ),
              }
            : contextOperation(credential, () =>
                authority.ownGrant(token.grantId, token.clientId),
              );
          if (!human && !authority.protocolFind("AccessToken", credential))
            throw new AuthorityError("unauthenticated");
          if (!human && url.search) denied();
          return json(res, 200, result);
        }
        if (req.method === "DELETE" && grantMatch[1] && !url.search) {
          if (human) authority.revoke(credential, grantMatch[1]);
          else
            contextOperation(credential, () =>
              authority.relinquish(
                token.grantId,
                token.clientId,
                grantMatch[1],
              ),
            );
          return json(res, 204, undefined);
        }
        invalid();
      }
      if (!human) denied();
      const confirmationRoute = /^\/v2\/entries\/([^/]+)\/confirmation$/.exec(
        route,
      );
      if (confirmationRoute && req.method === "POST" && !url.search) {
        let id: string;
        try {
          id = decodeURIComponent(confirmationRoute[1]);
        } catch {
          invalid();
        }
        return json(
          res,
          200,
          authority.confirmEntry(credential, id!, await body(req)),
        );
      }
      if (route === "/v2/audit" && req.method === "GET") {
        const query: any = Object.fromEntries(url.searchParams);
        if (query.limit !== undefined) query.limit = Number(query.limit);
        return json(res, 200, authority.audit(credential, query));
      }
      if (route === "/experiment/policy" && req.method === "PUT")
        return json(
          res,
          200,
          authority.replacePolicy(credential, await body(req)),
        );
      // Public query/get and the remaining governance endpoints are outside C2.
      return json(
        res,
        404,
        {
          type: "about:blank",
          title: "Not implemented",
          status: 404,
          detail: "This operation is outside the C2 experiment.",
        },
        "application/problem+json",
      );
    }
    json(res, 404, { error: "not_found" }, "application/json");
  }
  return (req, res) => {
    void handle(req, res).catch((error) => {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      const hcp = req.url?.startsWith("/v2/");
      const kind =
        error instanceof WriteConflict
          ? error.conflict
          : error instanceof UnsupportedVersion
            ? "unsupported-version"
            : error instanceof AuthorityError
              ? {
                  invalid: "malformed-request",
                  unauthenticated: "invalid-token",
                  denied: "scope-denied",
                }[error.kind]
              : "subject-unavailable";
      const status =
        error instanceof WriteConflict
          ? 409
          : error instanceof UnsupportedVersion
            ? 400
            : error instanceof AuthorityError
              ? { invalid: hcp ? 422 : 400, unauthenticated: 401, denied: 403 }[
                  error.kind
                ]
              : 503;
      if (status === 401)
        res.setHeader(
          "www-authenticate",
          `Bearer resource_metadata="${issuer}/.well-known/oauth-protected-resource"`,
        );
      json(
        res,
        status,
        {
          type: hcp ? `https://hcp.example/problems/${kind}` : "about:blank",
          status,
          title: status === 503 ? "Authority unavailable" : "Request refused",
          detail:
            status === 503
              ? "The experiment cannot safely admit this request."
              : "The request does not satisfy this operation's authorization or input requirements.",
        },
        "application/problem+json",
      );
    });
  };
}
