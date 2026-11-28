import {
  escape,
  hidden,
  viewOnly,
  reviewEntry,
  managementDocument,
  entryList,
  entryDetail,
  personEditor as renderPersonEditor,
  personReview,
  personSaved,
  grantList,
  managementError,
} from "./management-presentation";
import { activityPage } from "./activity-presentation";
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
  privateId,
} from "./policy";
import { authorizationProvider, validateAuthorization } from "./oauth";
import { COMPLETION_ONLY, WriteConflict, WriteUnresolved } from "./writes";
import { CONFLICT_DETECTION } from "./conflicts";
import { GENERAL_PROFILE } from "./fixtures";
import { requestJson, RequestJsonError } from "./request-json";
import { mcpHandler } from "./mcp";
const COOKIE = "__Host-hcp-human";
class UnsupportedVersion extends Error {}
const editableStatement = (entry: any) =>
  entry.content.profile === GENERAL_PROFILE &&
  typeof entry.content.value === "string" &&
  ["person-declared", "model-inferred"].includes(
    entry.assertion.declarationType,
  ) &&
  ["active", "conflicted", "expired", "deprecated"].includes(
    entry.record.status,
  );
function accessSummary(access: any[]): string {
  return `<section data-access-summary><ul>${access
    .map((detail) => {
      const write = detail.actions.includes("write"),
        narrowed = detail.narrowedTo;
      const actions = write
        ? narrowed
          ? "This client may read, revise and withdraw the selected existing entries"
          : "This client may read, create, revise and withdraw entries"
        : "Read access only";
      return `<li>${actions} in ${escape(detail.categories.join(", "))}.${narrowed ? ` Restricted to ${detail.narrowedTo.entryIds.length} selected existing entries.${write ? " Creating new entries is not permitted." : ""}` : ""}
      ${detail.purposes ? `Purposes: ${detail.purposes.map((p: any) => escape(p.description)).join("; ")}.` : "Choose a purpose before reviewing the exact grant."}</li>`;
    })
    .join(
      "",
    )}</ul>${access.length ? "" : "<p>No access remains available for approval.</p>"}</section>`;
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
  beforeHandoff?: () => string | void,
): void {
  const bytes = status === 204 ? undefined : JSON.stringify(value);
  const replacement = beforeHandoff?.();
  res.statusCode = status;
  res.setHeader("content-type", type);
  res.end(replacement ?? bytes);
}
function renderPage(stage: string, title: string, content: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title><style>body{font:16px system-ui;max-width:900px;margin:3rem auto;padding:0 1rem;line-height:1.5;color:#18262d;background:#f8faf9}label{display:block;margin:1rem 0}input,select,button,textarea{font:inherit}textarea{width:100%;box-sizing:border-box}pre{white-space:pre-wrap;overflow-wrap:anywhere}button{margin:1rem 1rem 1rem 0;padding:.5rem .8rem}small{display:block}article,section{background:white;padding:1rem;margin:1rem 0;border:1px solid #d7e1dc;border-radius:8px}a{color:#155b45}nav{display:flex;gap:1rem;flex-wrap:wrap}</style></head><body data-stage="${stage}"><p>Context Router · Synthetic HCP experiment</p><h1>${escape(title)}</h1>${content}</body></html>`;
}
function pageHeaders(res: ServerResponse): void {
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.setHeader(
    "content-security-policy",
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  );
}
function page(
  res: ServerResponse,
  stage: string,
  title: string,
  body: string,
  beforeHandoff?: () => string | void,
  management = false,
): void {
  const render = (content: string) =>
    management
      ? managementDocument(stage, title, content)
      : renderPage(stage, title, content);
  const bytes = render(body);
  const replacement = beforeHandoff?.();
  pageHeaders(res);
  res.end(typeof replacement === "string" ? render(replacement) : bytes);
}
async function requestBytes(
  req: IncomingMessage,
  maximum = 32768,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const b of req) {
    size += b.length;
    if (size > maximum) invalid();
    chunks.push(b);
  }
  return Buffer.concat(chunks);
}
async function body(req: IncomingMessage, maximum = 32768): Promise<any> {
  const text = (await requestBytes(req, maximum)).toString();
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
  const mcp = mcpHandler(authority);
  const currentHuman = (credential: string) => {
    if (!authority.isManagement(credential))
      throw new AuthorityError("unauthenticated");
  };
  const managementJson = (
    credential: string,
    res: ServerResponse,
    status: number,
    value: any,
    type = "application/ld+json",
  ) => json(res, status, value, type, () => currentHuman(credential));
  const managementMutationJson = (
    credential: string,
    res: ServerResponse,
    status: number,
    value: any,
  ) =>
    json(res, status, value, "application/ld+json", () =>
      authority.isManagement(credential) ? undefined : COMPLETION_ONLY,
    );
  const managementPage = (
    credential: string,
    res: ServerResponse,
    stage: string,
    title: string,
    body: string,
  ) => page(res, stage, title, body, () => currentHuman(credential), true);
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
  const loginPage = (
    res: ServerResponse,
    action: string,
    s: any,
    activityEvent?: string,
  ) =>
    page(
      res,
      "login",
      "Sign in to manage synthetic context",
      `<p>Synthetic data only. Signing in does not approve a context grant or authorize a content write. Each correction requires its own exact approval.</p><form method="post" action="${escape(action)}">${hidden("csrf", s.csrf)}${activityEvent ? hidden("activityEvent", activityEvent) : ""}<label>Human management credential <input name="credential" type="password" autocomplete="off" required></label><button>Sign in</button></form>`,
      undefined,
      action.startsWith("/manage"),
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
    if (req.url?.split("?")[0] === "/v2/mcp") return mcp(req, res);
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
      /^\/interaction\/([A-Za-z0-9_-]+)(?:\/(login|review|persist|approve|decline))?$/.exec(
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
          ${accessSummary(requested)}
          <p>Temporary: four hours by default, up to 24 hours. Client copies have a one-hour maximum use period. Grant expiry stops retrieval; an existing copy follows its own use-until. Clients must stop using copies when notified of revocation, or at use-until. These controlled clients make no directive-following claim.</p>
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
      if (action === "review" || action === "persist") {
        if (action === "review") csrf(req, form.csrf);
        else keys(form, ["reviewId", "csrf"]);
        const params = interaction.params;
        const reviewed =
          action === "persist"
            ? authority.electPersistence(
                cookie(req),
                form.reviewId,
                form.csrf,
                cookie(req) + ":" + interaction.uid,
              )
            : authority.review(
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
          ${accessSummary(reviewed.access)}${reviewed.client.legalRetention ? `<p>Declared legal retention: ${escape(reviewed.client.legalRetention.record)}, under ${escape(reviewed.client.legalRetention.obligation)}, for ${escape(reviewed.client.legalRetention.period)}. Revocation does not remove copies held in that record under the declared obligation.</p>` : ""}
          <p>${reviewed.grantType === "persistent" ? "Persistent access: remains in effect across interactions until you revoke it. Access credentials expire after one hour; rotating refresh credentials last at most 30 days from this approval." : `Temporary access expires at <strong>${escape(reviewed.expiresAt)}</strong>.`} Client copies have a one-hour maximum use period. Grant expiry stops retrieval; an existing copy follows its own use-until. Clients must stop using copies when notified of revocation, or at use-until.</p>
          <pre>${escape(JSON.stringify({ access: reviewed.access, exclusions: reviewed.exclusions }, null, 2))}</pre>
          <dl>${Object.entries(CATEGORIES)
            .map(([c, d]) => `<dt>${escape(c)}</dt><dd>${escape(d)}</dd>`)
            .join("")}</dl>
          <form method="post" action="${base}/approve">${hidden("reviewId", reviewed.reviewId)}${hidden("csrf", reviewed.csrf)}<button${reviewed.access.length ? "" : " disabled"}>Approve access</button></form>${reviewed.grantType === "temporary" ? `<p>Optional persistent access survives this interaction and remains in effect until you revoke it. Electing it here does not approve access; you must still approve the exact grant.</p><form method="post" action="${base}/persist">${hidden("reviewId", reviewed.reviewId)}${hidden("csrf", reviewed.csrf)}<button>Elect persistent access</button></form>` : ""}`,
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
      const importForm =
        route === "/manage/import" && req.method === "POST"
          ? await body(req, 4_194_304)
          : undefined;
      if (importForm?.action === "preview") {
        keys(importForm, ["csrf", "source", "mapping", "action"]);
        const token = cookie(req),
          session = authority.browserSession(token, importForm.csrf);
        if (!session.authenticated || req.headers.origin !== issuer) denied();
        let categoryMap: any;
        try {
          categoryMap = JSON.parse(importForm.mapping || "{}");
        } catch {
          invalid();
        }
        if (typeof importForm.source !== "string") invalid();
        return managementPage(
          token,
          res,
          "import-preview",
          "Dry run results",
          `<pre>${escape(JSON.stringify(authority.previewImport(token, { export: importForm.source, categoryMap }), null, 2))}</pre><p><a href="/manage/import">Back</a></p>`,
        );
      }
      const s = browser(req, res);
      if (route === "/manage/login" && req.method === "POST") {
        const form = await body(req);
        keys(form, ["csrf", "credential", "activityEvent"]);
        if (form.activityEvent !== undefined && !privateId(form.activityEvent))
          invalid();
        csrf(req, form.csrf);
        const authenticated = authority.loginBrowser(
          cookie(req),
          form.csrf,
          form.credential,
        );
        setCookie(res, authenticated.token);
        res.writeHead(303, {
          location: form.activityEvent
            ? `/manage/audit?eventId=${encodeURIComponent(form.activityEvent)}`
            : "/manage",
        });
        res.end();
        return;
      }
      if (!s.authenticated) {
        const activityEvent =
          route === "/manage/audit" &&
          req.method === "GET" &&
          url.searchParams.size === 1 &&
          privateId(url.searchParams.get("eventId"))
            ? url.searchParams.get("eventId")!
            : undefined;
        return loginPage(res, "/manage/login", s, activityEvent);
      }
      if (route === "/manage/audit" && req.method === "GET") {
        for (const key of url.searchParams.keys())
          if (url.searchParams.getAll(key).length !== 1) invalid();
        const query: any = Object.fromEntries(
          [...url.searchParams].filter(([, value]) => value !== ""),
        );
        keys(query, [
          "client",
          "category",
          "eventType",
          "from",
          "to",
          "limit",
          "cursor",
          "eventId",
          "entryId",
          "grantId",
        ]);
        if (query.eventId !== undefined) keys(query, ["eventId"]);
        query.limit = query.limit === undefined ? 20 : Number(query.limit);
        const result = authority.activity(s.token, query);
        return managementPage(
          s.token,
          res,
          "history",
          "Activity",
          activityPage(result, query.limit),
        );
      }
      if (route === "/manage/disclosures" && req.method === "GET") {
        for (const key of url.searchParams.keys())
          if (url.searchParams.getAll(key).length !== 1) invalid();
        const query: any = Object.fromEntries(
          [...url.searchParams].filter(([, value]) => value !== ""),
        );
        if (query.limit !== undefined) query.limit = Number(query.limit);
        const result = authority.disclosures(s.token, query);
        return managementPage(
          s.token,
          res,
          "history",
          "Disclosure and audit history",
          `<p><a href="/manage">Manage context</a></p><form method="get"><label>Client ID <input name="client"></label><label>Category <input name="category"></label><label>From (RFC3339) <input name="from"></label><label>To (RFC3339) <input name="to"></label><button>Filter</button></form><pre>${escape(JSON.stringify(result, null, 2))}</pre>`,
        );
      }
      if (route === "/manage/export" && req.method === "GET") {
        if (url.search) {
          for (const key of url.searchParams.keys())
            if (url.searchParams.getAll(key).length !== 1) invalid();
          return managementJson(
            s.token,
            res,
            200,
            authority.exportContext(
              s.token,
              Object.fromEntries(url.searchParams),
            ),
            "application/ld+json",
          );
        }
        return managementPage(
          s.token,
          res,
          "export",
          "Export retained context",
          `<p>This transfer contains private retained statements, including deleted records unless excluded. Grants and credentials are not portable.</p><form method="get"><label>Include <select name="include"><option value="versions">Versions</option><option value="audit">Audit</option><option value="versions,audit">Versions and audit</option></select></label><button>Export JSON-LD</button></form><p><a href="/manage/export?exclude=deleted">Export current records excluding deleted entries</a></p>`,
        );
      }
      if (route === "/manage/import" && !url.search) {
        if (req.method === "GET")
          return managementPage(
            s.token,
            res,
            "import",
            "Review a v2 context transfer",
            `<p>Foreign relationships, source audit, delegations and ambiguous histories are unsupported. Each represented subject must refer to you.</p><form method="post">${hidden("csrf", s.csrf)}<label>Exact export JSON <textarea name="source" rows="16" cols="80" required></textarea></label><label>Category mapping JSON <textarea name="mapping">{}</textarea></label><button name="action" value="preview">Dry run</button><button name="action" value="review">Review import</button></form>`,
          );
        if (req.method !== "POST") invalid();
        const form = importForm;
        keys(form, ["csrf", "source", "mapping", "action"]);
        csrf(req, form.csrf);
        let categoryMap: any;
        try {
          categoryMap = JSON.parse(form.mapping || "{}");
        } catch {
          invalid();
        }
        const input = { export: form.source, categoryMap };
        if (typeof form.source !== "string") invalid();
        if (form.action !== "review") invalid();
        const review = authority.reviewImport(s.token, input, s.token);
        return managementPage(
          s.token,
          res,
          "import-review",
          "Review the exact transfer",
          `<pre>${escape(JSON.stringify(review, null, 2))}</pre><form method="post" action="/manage/import/approve">${hidden("csrf", s.csrf)}${hidden("reviewId", review.reviewId)}${hidden("reviewCsrf", review.csrf)}${hidden("subjects", JSON.stringify(review.subjects))}<label><input type="checkbox" name="attest" value="yes" required> Every displayed subject URI refers to me. I approve these exact outcomes and effects.</label><button>Apply reviewed import</button></form>`,
        );
      }
      if (
        route === "/manage/import/approve" &&
        req.method === "POST" &&
        !url.search
      ) {
        const form = await body(req);
        keys(form, ["csrf", "reviewId", "reviewCsrf", "subjects", "attest"]);
        csrf(req, form.csrf);
        if (form.attest !== "yes") denied();
        let subjects: any;
        try {
          subjects = JSON.parse(form.subjects);
        } catch {
          invalid();
        }
        const result = authority.applyImport(
          s.token,
          form.reviewId,
          form.reviewCsrf,
          s.token,
          subjects,
        );
        const details = `<pre>${escape(JSON.stringify(result, null, 2))}</pre><p><a href="/manage/entries">Inspect retained entries</a></p>`;
        // Only a new successful commit retains completion on this original path.
        // A consumed review's response remains subject to final authorization.
        return page(res, "import-result", "Import recorded", details, () => {
          if (!authority.releaseImport(result))
            return "<p>Your import was committed. Sign in again to inspect retained history.</p>";
        });
      }
      if (route === "/manage/policy" && !url.search) {
        if (req.method === "POST") {
          const form = await body(req);
          keys(form, [
            "csrf",
            "kind",
            "id",
            "action",
            "effect",
            "text",
            "categories",
            "operators",
            "requires",
          ]);
          csrf(req, form.csrf);
          if (form.id) authority.removePolicy(s.token, form.kind, form.id);
          else {
            const input: any = {};
            for (const key of ["categories", "operators", "requires"])
              if (form[key]?.trim())
                input[key] = form[key].split(",").map((v: string) => v.trim());
            if (form.kind === "directives")
              for (const key of ["action", "effect", "text"])
                input[key] = form[key];
            authority.setPolicy(s.token, form.kind, input);
          }
          res.writeHead(303, { location: "/manage/policy" }).end();
          return;
        }
        if (req.method !== "GET") invalid();
        return managementPage(
          s.token,
          res,
          "policy",
          "Standing rules and directives",
          `<p><a href="/manage">Grant controls</a></p><p>Rules deny access immediately for current and future grants. Removing a rule does not restore a revoked grant. Clients receive applicable directive text; their declared compliance is not verified.</p>${[
            "rules",
            "directives",
          ]
            .map(
              (kind) =>
                `<h2>${escape(kind)}</h2>${authority
                  .listPolicy(s.token, kind)
                  .map(
                    (p) =>
                      `<pre>${escape(JSON.stringify(p, null, 2))}</pre><form method="post">${hidden("csrf", s.csrf)}${hidden("kind", kind)}${hidden("id", p.ruleId ?? p.directiveId)}<button>Remove</button></form>`,
                  )
                  .join(
                    "",
                  )}<form method="post">${hidden("csrf", s.csrf)}${hidden("kind", kind)}<label>Operators, separated by commas <input name="operators"></label><label>Categories, separated by commas (blank means all) <input name="categories"></label>${kind === "rules" ? '<label>Required client claim URIs, separated by commas <input name="requires"></label>' : '<label>Action (share, sign, transact or URI) <input name="action" required></label><label>Effect <select name="effect"><option>deny</option><option>ask-first</option><option>permit</option></select></label><label>Text that clients will receive <textarea name="text" required></textarea></label>'}<button>Set ${kind === "rules" ? "rule" : "directive"}</button></form>`,
            )
            .join("")}`,
        );
      }
      if (
        route === "/manage/classification/approve" &&
        req.method === "POST" &&
        !url.search
      ) {
        const form = await body(req);
        keys(form, ["csrf", "reviewId", "reviewCsrf"]);
        csrf(req, form.csrf);
        const result = authority.approveClassification(
          s.token,
          form.reviewId,
          form.reviewCsrf,
          s.token,
        );
        if (!result.id)
          return page(
            res,
            "classification-saved",
            "Change recorded",
            "<p>Your approved change was committed. Sign in again to inspect the entry.</p>",
          );
        res
          .writeHead(303, {
            location: `/manage/entries/${encodeURIComponent(result.id)}`,
          })
          .end();
        return;
      }
      const classificationEditor =
        /^\/manage\/entries\/([^/]+)\/classification$/.exec(route);
      if (classificationEditor && !url.search) {
        const id = decodeURIComponent(classificationEditor[1]);
        if (req.method === "POST") {
          const form = await body(req);
          keys(form, ["csrf", "kind", "expectedVersion", "values", "remove"]);
          csrf(req, form.csrf);
          const input: any = { expectedVersion: Number(form.expectedVersion) };
          input[
            form.kind === "categories" ? "categories" : "permittedPurposes"
          ] =
            form.remove === "yes"
              ? null
              : form.values
                  .split(",")
                  .map((v: string) => v.trim())
                  .filter(Boolean);
          const review = authority.reviewClassification(
            s.token,
            id,
            form.kind,
            input,
            s.token,
          );
          return managementPage(
            s.token,
            res,
            "classification-review",
            "Review classification change",
            `${reviewEntry(review.entry)}<p>Current content version is unchanged. This affects which clients and purposes can reach all versions of the entry.</p><pre>${escape(JSON.stringify(review.input, null, 2))}</pre><form method="post" action="/manage/classification/approve">${hidden("csrf", s.csrf)}${hidden("reviewId", review.reviewId)}${hidden("reviewCsrf", review.csrf)}<button>Approve classification change</button></form>`,
          );
        }
        if (req.method !== "GET") invalid();
        const entry = authority.managementEntry(s.token, id).entry;
        return managementPage(
          s.token,
          res,
          "classification-editor",
          "Categories and permitted purposes",
          `${reviewEntry(entry)}${["categories", "purposes"].map((kind) => `<form method="post">${hidden("csrf", s.csrf)}${hidden("kind", kind)}${hidden("expectedVersion", String(entry.record.version))}<label>${kind === "categories" ? "Categories" : "Principal purpose URI restrictions (blank denies every purpose)"}, comma-separated <input name="values" value="${escape((kind === "categories" ? entry.classification.categories : (entry.classification.permittedPurposes ?? [])).join(","))}"></label>${kind === "purposes" ? '<label><input type="checkbox" name="remove" value="yes">Remove principal restriction; assertion restrictions still apply</label>' : ""}<button>Review ${kind}</button></form>`).join("")}`,
        );
      }
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
        return managementPage(
          s.token,
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
        authority.releaseWrite(
          ticket,
          (status, bytes) => {
            res.statusCode = status;
            pageHeaders(res);
            res.end(bytes);
          },
          (bytes) => {
            const result = JSON.parse(bytes);
            return managementDocument(
              "person-saved",
              "Statement saved",
              personSaved(result),
            );
          },
        );
        return;
      }
      if (
        route === "/manage/person/review" &&
        req.method === "POST" &&
        !url.search
      ) {
        const form = await body(req);
        keys(form, [
          "csrf",
          "value",
          "category",
          "entryId",
          "expectedVersion",
          "purpose",
        ]);
        csrf(req, form.csrf);
        if (typeof form.value !== "string" || !form.value.trim()) invalid();
        const target = form.entryId || undefined;
        const current = target
          ? authority.managementEntry(s.token, target).entry
          : undefined;
        if (current && !editableStatement(current)) denied();
        const request = {
          purpose: form.purpose,
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
        return managementPage(
          s.token,
          res,
          "person-review",
          "Review your statement",
          personReview(
            current,
            review,
            authority.accountId(),
            s.csrf,
            random(),
          ),
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
        if (current && !editableStatement(current))
          return managementPage(
            s.token,
            res,
            "person-view-only",
            "View only",
            `<p>${viewOnly}</p><p><a href="/manage/entries/${encodeURIComponent(current.id)}">Inspect the retained entry</a></p>`,
          );
        return managementPage(
          s.token,
          res,
          "person-editor",
          current ? "Edit as your own statement" : "Add your own statement",
          renderPersonEditor(
            current,
            s.csrf,
            Object.keys(CATEGORIES),
            PURPOSES,
          ),
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
          return managementPage(
            s.token,
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
        return managementPage(
          s.token,
          res,
          "entry",
          "Retained entry and history",
          entryDetail(result, history, s.csrf, editableStatement(result.entry)),
        );
      }
      if (route === "/manage/entries" && req.method === "GET" && !url.search) {
        return managementPage(
          s.token,
          res,
          "entries",
          "Retained entries",
          entryList(
            authority.managementEntries(s.token).map((entry) => ({
              entry,
              canEdit: editableStatement(entry),
            })),
          ),
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
      return managementPage(
        s.token,
        res,
        "manage",
        "Human grant controls",
        grantList(
          selected,
          copies,
          history,
          id,
          s.csrf,
          url.searchParams.get("status") ?? "active",
        ),
      );
    }
    if (
      route.startsWith("/v2/") ||
      ["/experiment/policy", "/experiment/import/review"].includes(route)
    ) {
      if (req.headers.cookie || url.searchParams.has("access_token")) denied();
      const credential = /^Bearer ([A-Za-z0-9_-]+)$/.exec(
        String(req.headers.authorization ?? ""),
      )?.[1];
      if (!credential) throw new AuthorityError("unauthenticated");
      const human = authority.isManagement(credential);
      if (!human && route === "/v2/import") denied();
      const token = human
        ? undefined
        : authority.protocolFind("AccessToken", credential);
      if (!human && !token) throw new AuthorityError("unauthenticated");
      const revisionRoute = /^\/v2\/entries\/([^/]+)\/revisions$/.exec(route);
      const withdrawalRoute = /^\/v2\/entries\/([^/]+)\/withdrawal$/.exec(
        route,
      );
      if (route === "/v2/shares" && req.method === "POST" && !url.search) {
        if (human) denied();
        authority.reportSharing(credential, await body(req));
        return;
      }
      if (
        /^\/v2\/entries\/[^/]+$/.test(route) &&
        req.method === "DELETE" &&
        url.search === "?hardDelete=true"
      ) {
        if (!human) denied();
        return json(
          res,
          404,
          {
            type: "about:blank",
            title: "Not implemented",
            status: 404,
            detail: "Hard deletion is outside the experiment.",
          },
          "application/problem+json",
        );
      }
      if (route === "/v2/entries" || revisionRoute || withdrawalRoute) {
        if (human) denied();
        if (url.search || req.method !== "POST") invalid();
        if (
          !(
            withdrawalRoute
              ? ["application/json"]
              : ["application/json", "application/ld+json"]
          ).includes(String(req.headers["content-type"]))
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
              revisionRoute?.[1] ??
                withdrawalRoute?.[1] ??
                route.slice("/v2/entries/".length),
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
          ? await requestJson(req).catch((error) => {
              if (error instanceof RequestJsonError) invalid();
              throw error;
            })
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
          return human
            ? managementJson(credential, res, 200, result)
            : json(res, 200, result);
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
      if (
        ["/v2/export", "/v2/audit/export"].includes(route) &&
        req.method === "GET"
      ) {
        for (const key of url.searchParams.keys())
          if (url.searchParams.getAll(key).length !== 1) invalid();
        const input = Object.fromEntries(url.searchParams);
        return managementJson(
          credential,
          res,
          200,
          route === "/v2/export"
            ? authority.exportContext(credential, input)
            : authority.exportAudit(credential, input),
          "application/ld+json",
        );
      }
      if (
        ["/v2/import", "/experiment/import/review"].includes(route) &&
        req.method === "POST"
      ) {
        const input = await body(req, 4_194_304);
        if (route === "/experiment/import/review" && !url.search)
          return managementJson(
            credential,
            res,
            200,
            authority.reviewImport(credential, input, credential),
          );
        if (input.dryRun !== undefined && typeof input.dryRun !== "boolean")
          invalid();
        if (url.search === "?dryRun=true" || input.dryRun === true) {
          if (
            (url.search && url.search !== "?dryRun=true") ||
            input.dryRun === false
          )
            invalid();
          const { dryRun: _dryRun, ...request } = input;
          return managementJson(
            credential,
            res,
            200,
            authority.previewImport(credential, request),
          );
        }
        if (url.search) invalid();
        keys(input, ["reviewId", "csrf", "subjects"]);
        const result = authority.applyImport(
          credential,
          input.reviewId,
          input.csrf,
          credential,
          input.subjects,
        );
        return json(res, 200, result, "application/ld+json", () =>
          authority.releaseImport(result) ? undefined : COMPLETION_ONLY,
        );
      }
      if (route === "/v2/disclosures" && req.method === "GET") {
        for (const key of url.searchParams.keys())
          if (url.searchParams.getAll(key).length !== 1) invalid();
        return managementJson(
          credential,
          res,
          200,
          authority.disclosures(
            credential,
            Object.fromEntries(url.searchParams),
          ),
        );
      }
      const classificationRoute =
        /^\/v2\/entries\/([^/]+)\/(categories|purposes)$/.exec(route);
      if (classificationRoute && req.method === "PUT" && !url.search) {
        let id: string;
        try {
          id = decodeURIComponent(classificationRoute[1]);
        } catch {
          invalid();
        }
        return managementMutationJson(
          credential,
          res,
          200,
          authority.editClassification(
            credential,
            id!,
            classificationRoute[2],
            await body(req),
          ),
        );
      }
      const policyRoute = /^\/v2\/(rules|directives)(?:\/([^/]+))?$/.exec(
        route,
      );
      if (policyRoute && !url.search) {
        const [, kind, id] = policyRoute;
        if (req.method === "GET" && !id)
          return managementJson(credential, res, 200, {
            [kind]: authority.listPolicy(credential, kind),
          });
        if (req.method === "POST" && !id)
          return managementMutationJson(
            credential,
            res,
            201,
            authority.setPolicy(credential, kind, await body(req)),
          );
        if (req.method === "DELETE" && id) {
          authority.removePolicy(credential, kind, decodeURIComponent(id));
          return json(res, 204, undefined);
        }
        invalid();
      }
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
        return managementMutationJson(
          credential,
          res,
          200,
          authority.confirmEntry(credential, id!, await body(req)),
        );
      }
      if (route === "/v2/audit" && req.method === "GET") {
        for (const key of url.searchParams.keys())
          if (url.searchParams.getAll(key).length !== 1) invalid();
        const query: any = Object.fromEntries(url.searchParams);
        if (query.limit !== undefined) query.limit = Number(query.limit);
        return managementJson(
          credential,
          res,
          200,
          authority.audit(credential, query),
        );
      }
      if (route === "/experiment/policy" && req.method === "PUT")
        return managementMutationJson(
          credential,
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
    const refuse = (error: unknown) => {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      const hcp = req.url?.startsWith("/v2/");
      const unresolved = error instanceof WriteUnresolved;
      const releaseError = () => {
        authority.releaseWriteConflict(error);
        authority.releaseWriteUnresolved(error);
        if (hcp && unresolved) res.setHeader("retry-after", "1");
      };
      const kind = unresolved
        ? "idempotency-unresolved"
        : error instanceof WriteConflict
          ? error.conflict
          : error instanceof UnsupportedVersion
            ? "unsupported-version"
            : error instanceof AuthorityError
              ? {
                  invalid: "malformed-request",
                  unauthenticated: "invalid-token",
                  denied: "scope-denied",
                }[error.kind]
              : undefined;
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
      if (/^\/manage(?:[/?]|$)/.test(req.url ?? "")) {
        res.statusCode = status;
        const failure = managementError(status, req.method === "POST");
        return page(
          res,
          "management-error",
          failure.title,
          failure.body,
          releaseError,
          true,
        );
      }
      json(
        res,
        status,
        {
          type:
            hcp && kind
              ? `https://hcp.example/problems/${kind}`
              : "about:blank",
          status,
          title: unresolved
            ? "Idempotency outcome unresolved"
            : status === 503
              ? "Service Unavailable"
              : "Request refused",
          detail: unresolved
            ? "Retry the same request and key after the indicated delay."
            : status === 503
              ? "The experiment cannot determine or report this request's outcome."
              : "The request does not satisfy this operation's authorization or input requirements.",
        },
        "application/problem+json",
        releaseError,
      );
    };
    void handle(req, res).catch((error) => {
      try {
        refuse(error);
      } catch (releaseError) {
        refuse(releaseError);
      }
    });
  };
}
