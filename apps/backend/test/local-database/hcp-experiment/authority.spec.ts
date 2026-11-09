import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { DATA_SCHEMA } from "../../../src/infrastructure/hcp-experiment/schema";
import { SyntheticExperiment } from "../../../src/infrastructure/hcp-experiment/store";
import { syntheticFixtures } from "../../../src/infrastructure/hcp-experiment/fixtures";
import {
  ACCESS_TYPE,
  PURPOSES,
  type AuthorizationRepository,
} from "../../../src/infrastructure/hcp-experiment/authority";

const start = Date.parse("2026-11-08T12:00:00.000Z");
const config = {
  issuer: "https://as.hcp.test:4443",
  resource: "https://as.hcp.test:4443",
  clients: ["a", "b"].map((id) => ({
    id,
    name: `Controlled client ${id.toUpperCase()}`,
    operator: {
      id: "https://example.test/operators/synthetic",
      name: "Synthetic fixture operator",
    },
    redirectUri: `https://client-${id}.hcp.test:4444/callback`,
  })),
};
const detail = (categories = ["general_preferences"], extra = {}) => ({
  type: ACCESS_TYPE,
  actions: ["read"],
  categories,
  purposes: [PURPOSES[0]],
  ...extra,
});

describe("C2 durable grant authority (internal boundary; no public disclosure)", () => {
  let sandbox: string,
    store: SyntheticExperiment,
    authority: AuthorizationRepository;
  let now: number, human: string, failAt: string | undefined;
  const paths = () => ({ sandbox, root: path.join(sandbox, "experiment") });
  const options = () => ({
    clock: () => now,
    fault: (point: string) => {
      if (point === failAt) throw new Error("injected persistence failure");
    },
  });
  beforeEach(() => {
    sandbox = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "hcp-c2-authority-")),
    );
    fs.chmodSync(sandbox, 0o700);
    now = start;
    failAt = undefined;
    human = randomBytes(32).toString("base64url");
    store = SyntheticExperiment.create(paths(), options());
    authority = store.authorization(config, human);
  });
  afterEach(() => {
    store?.close();
    fs.rmSync(sandbox, { recursive: true });
  });
  const request = (clientId = "a", access: any[] = [detail()]) => ({
    interactionId: randomBytes(16).toString("hex"),
    clientId,
    resource: config.resource,
    access,
  });
  function issue(
    clientId = "a",
    access: any[] = [detail()],
    durationSeconds?: number,
  ) {
    const req = request(clientId, access);
    const review = authority.review(
      human,
      req,
      { durationSeconds },
      "browser-binding",
    );
    return authority.approve(
      human,
      review.reviewId,
      review.csrf,
      "browser-binding",
      "synthetic-test-driver",
    );
  }
  function reopen() {
    store.close();
    store = SyntheticExperiment.open(paths(), options());
    authority = store.authorization(config, human);
  }

  it("authentication alone creates no grant; affirmative approval binds server actors and audit", () => {
    expect(authority.isManagement(human)).toBe(true);
    expect(authority.listGrants(human)).toHaveLength(0);
    const grant = issue();
    expect(grant.client).toEqual({
      id: "a",
      name: config.clients[0].name,
      operator: config.clients[0].operator,
    });
    expect(grant.subject).toEqual(grant.authorizingPrincipal);
    expect(grant.requestingParty).toEqual({
      type: "person",
      id: grant.subject.id,
      name: "Synthetic context subject",
    });
    expect(grant.subject.id).not.toBe(store.inspectEntries()[0].subject.id);
    expect(grant.grantType).toBe("temporary");
    expect(grant.issuedAt).toBe(new Date(start).toISOString());
    expect(grant.expiresAt).toBe(new Date(start + 4 * 3600_000).toISOString());
    const events = store
      .inspectAudit()
      .filter((e) => e.eventType === "grant.issued");
    expect(events).toHaveLength(1);
    expect(events[0].grantId).toBe(grant.grantId);
    expect(events[0].data).toMatchObject({
      access: grant.access,
      expiresAt: grant.expiresAt,
      grantType: "temporary",
      modality: "synthetic-test-driver",
      acr: "urn:context-router:acr:local-credential",
    });
    expect(events[0].participants).toHaveProperty("authorizingPrincipal");
    expect(events[0].participants).toHaveProperty("requestingParty");
    expect(events[0].participants.retrievalId).toMatch(/^urn:uuid:/);
    expect(JSON.stringify(store.inspectAudit()).includes(human)).toBe(false);
  });

  it("requires independent management authority, request binding and one-use approval", () => {
    expect(() =>
      authority.review("context-token", request(), {}, "browser-binding"),
    ).toThrow();
    const review = authority.review(human, request(), {}, "browser-binding");
    expect(() =>
      authority.approve(
        human,
        review.reviewId,
        review.csrf,
        "other-browser",
        "synthetic-test-driver",
      ),
    ).toThrow();
    expect(() =>
      authority.approve(
        human,
        review.reviewId,
        "wrong-csrf",
        "browser-binding",
        "synthetic-test-driver",
      ),
    ).toThrow();
    const grant = authority.approve(
      human,
      review.reviewId,
      review.csrf,
      "browser-binding",
      "synthetic-test-driver",
    );
    expect(() =>
      authority.approve(
        human,
        review.reviewId,
        review.csrf,
        "browser-binding",
        "synthetic-test-driver",
      ),
    ).toThrow();
    expect(authority.listGrants(human)).toHaveLength(1);
    expect(() => authority.listGrants(grant.grantId)).toThrow();
  });

  it("scope-only requests require human purposes, while consent never widens requested details", () => {
    const req = {
      ...request(),
      access: undefined,
      scope: "hcp:general_preferences:read",
    };
    expect(() => authority.review(human, req, {}, "binding")).toThrow();
    const review = authority.review(
      human,
      req,
      { purposes: [PURPOSES[0].code] },
      "binding",
    );
    const grant = authority.approve(
      human,
      review.reviewId,
      review.csrf,
      "binding",
      "synthetic-test-driver",
    );
    expect(grant.access).toEqual([detail()]);
    expect(() =>
      authority.review(
        human,
        request(),
        { categories: ["work_context"] },
        "binding",
      ),
    ).toThrow();
    expect(() =>
      authority.review(
        human,
        request(),
        { purposes: [PURPOSES[1].code] },
        "binding",
      ),
    ).toThrow();
  });

  it.each([
    detail(["unknown"]),
    detail(["general_preferences"], { actions: ["write"] }),
    detail(["general_preferences"], { actions: ["read", "provenance"] }),
    detail(["general_preferences"], { narrowedTo: { invented: [] } }),
    detail(["general_preferences"], { onwardSharing: {} }),
    detail(["general_preferences"], {
      purposes: [{ code: "not-a-uri", description: "Bad purpose" }],
    }),
  ])("rejects unsupported authorization detail %#", (bad) => {
    expect(() =>
      authority.review(human, request("a", [bad]), {}, "binding"),
    ).toThrow();
    expect(authority.listGrants(human)).toHaveLength(0);
  });

  it("rejects foreign resource, actor substitutions, persistent grants and excessive duration", () => {
    for (const patch of [
      { resource: "https://foreign.test" },
      { subject: "other" },
      { operator: "other" },
      { requestingParty: "other" },
      { grantType: "persistent" },
    ]) {
      expect(() =>
        authority.review(human, { ...request(), ...patch }, {}, "binding"),
      ).toThrow();
    }
    expect(() => issue("a", [detail()], 86401)).toThrow();
    expect(() => issue("a", [detail()], 0)).toThrow();
    expect(Date.parse(issue("a", [detail()], 86400).expiresAt) - start).toBe(
      86400_000,
    );
  });

  it("does not move the displayed expiry at approval and rejects stale policy reviews", () => {
    const review = authority.review(
      human,
      request(),
      { durationSeconds: 120 },
      "binding",
    );
    now += 30_000;
    const grant = authority.approve(
      human,
      review.reviewId,
      review.csrf,
      "binding",
      "synthetic-test-driver",
    );
    expect(grant.expiresAt).toBe(review.expiresAt);
    expect(Date.parse(grant.expiresAt) - now).toBe(90_000);
    const stale = authority.review(human, request(), {}, "binding");
    authority.replacePolicy(human, {
      rules: [],
      directives: [{ action: "share", effect: "deny", text: "Do not share." }],
    });
    expect(() =>
      authority.approve(
        human,
        stale.reviewId,
        stale.csrf,
        "binding",
        "synthetic-test-driver",
      ),
    ).toThrow();
  });

  it("isolates A1/A2/B, stable pseudonyms, ref restrictions and revocation across reopen", () => {
    const entry = store
      .inspectEntries()
      .find(
        (e) =>
          e.record.status === "active" &&
          e.classification.categories.includes("general_preferences"),
      )!;
    const access = [
      detail(["general_preferences"], { narrowedTo: { entryIds: [entry.id] } }),
    ];
    const a1 = issue("a", access),
      a2 = issue("a", access),
      b = issue("b", access);
    expect(a1.subject).toEqual(a2.subject);
    expect(a1.subject).not.toEqual(b.subject);
    const publicA1 = authority.ownGrant(a1.grantId, "a");
    const refs = [a1, a2, b].map(
      (g) =>
        authority.ownGrant(g.grantId, g.client.id).grants[0].access[0]
          .narrowedTo.entryIds[0],
    );
    expect(new Set(refs).size).toBe(3);
    expect(refs.every((r) => /^r_[A-Za-z0-9_-]{32}$/.test(r))).toBe(true);
    expect(JSON.stringify(publicA1).includes(entry.id)).toBe(false);
    expect(() => authority.ownGrant(a1.grantId, "b")).toThrow();
    expect(() => authority.relinquish(a1.grantId, "a", a2.grantId)).toThrow();
    expect(() =>
      issue("a", [
        detail(["general_preferences"], {
          narrowedTo: { entryIds: [refs[0]] },
        }),
      ]),
    ).toThrow();
    reopen();
    expect(authority.ownGrant(a1.grantId, "a")).toEqual(publicA1);
    authority.revoke(human, a1.grantId);
    expect(() => authority.ownGrant(a1.grantId, "a")).toThrow();
    expect(authority.ownGrant(a2.grantId, "a").grants).toHaveLength(1);
    expect(authority.ownGrant(b.grantId, "b").grants).toHaveLength(1);
    expect(authority.listGrants(human)).toHaveLength(2);
    expect(authority.listGrants(human, "all")).toHaveLength(3);
    authority.relinquish(b.grantId, "b", b.grantId);
    expect(
      store
        .inspectAudit()
        .filter((e) => e.eventType === "grant.revoked")
        .at(-1)!.participants.initiator.role,
    ).toBe("context-client");
    reopen();
    expect(() => authority.ownGrant(a1.grantId, "a")).toThrow();
    expect(authority.ownGrant(a2.grantId, "a").grants).toHaveLength(1);
  });

  it.each(["before-audit", "before-commit"])(
    "rolls back grant and decision consumption on %s failure",
    (point) => {
      const review = authority.review(human, request(), {}, "binding");
      failAt = point;
      expect(() =>
        authority.approve(
          human,
          review.reviewId,
          review.csrf,
          "binding",
          "synthetic-test-driver",
        ),
      ).toThrow();
      failAt = undefined;
      reopen();
      expect(authority.listGrants(human, "all")).toHaveLength(0);
      expect(
        store.inspectAudit().filter((e) => e.eventType === "grant.issued"),
      ).toHaveLength(0);
      authority.approve(
        human,
        review.reviewId,
        review.csrf,
        "binding",
        "synthetic-test-driver",
      );
      expect(authority.listGrants(human)).toHaveLength(1);
    },
  );

  it("expires at the exact deadline and catches up a 48h outage once, preserving revoked precedence", () => {
    const revoked = issue("a", [detail()], 60),
      expired = issue("a", [detail()], 60),
      later = issue("b", [detail()], 120);
    authority.revoke(human, revoked.grantId);
    now += 60_000;
    expect(() => authority.ownGrant(expired.grantId, "a")).toThrow();
    expect(authority.ownGrant(later.grantId, "b").grants).toHaveLength(1);
    store.close();
    now += 48 * 3600_000;
    store = SyntheticExperiment.open(paths(), options());
    authority = store.authorization(config, human);
    const events = store
      .inspectAudit()
      .filter((e) => e.eventType === "grant.expired");
    expect(events).toHaveLength(2);
    const lateEvent = events.find((e) => e.grantId === later.grantId)!;
    expect(lateEvent.timestamp).toBe(new Date(now).toISOString());
    expect(lateEvent.data).toMatchObject({
      reason: "expiresAt",
      effectiveAt: later.expiresAt,
    });
    expect(
      authority
        .listGrants(human, "all")
        .find((g) => g.grantId === revoked.grantId)!.status,
    ).toBe("revoked");
    reopen();
    expect(
      store.inspectAudit().filter((e) => e.eventType === "grant.expired"),
    ).toEqual(events);
  });

  it("fails closed on expiry reconciliation failure, then recovers without renewal or duplicate history", () => {
    const grants = [issue("a", [detail()], 60), issue("b", [detail()], 60)];
    now += 48 * 3600_000;
    failAt = "before-audit";
    expect(() => authority.ownGrant(grants[0].grantId, "a")).toThrow();
    failAt = undefined;
    expect(() => authority.ownGrant(grants[0].grantId, "a")).toThrow();
    reopen();
    expect(authority.listGrants(human)).toHaveLength(0);
    expect(
      store.inspectAudit().filter((e) => e.eventType === "grant.expired"),
    ).toHaveLength(2);
  });

  it("paginates retained audit with opaque stable snapshot cursors and rejects context authority", () => {
    issue();
    issue("b");
    const first = authority.audit(human, { limit: 2 });
    expect(first.events).toHaveLength(2);
    expect(first.nextCursor).toMatch(/^[A-Za-z0-9_-]{32,}$/);
    const second = authority.audit(human, {
      cursor: first.nextCursor,
      limit: 2,
    });
    now += 300_000;
    reopen();
    expect(
      authority.audit(human, { cursor: first.nextCursor, limit: 2 }),
    ).toEqual(second);
    expect(
      new Set([...first.events, ...second.events].map((e) => e.eventId)).size,
    ).toBe(4);
    expect(() => authority.audit("context-token", {})).toThrow();
  });

  it("binds protocol objects to durable authority, consumes codes once and retains replay revocation", () => {
    const grant = issue(),
      projected = authority.ownGrant(grant.grantId, "a").grants[0];
    const source = {
      kind: "AuthorizationCode",
      jti: "private-code",
      grantId: grant.grantId,
      clientId: "a",
      accountId: authority.accountId(),
      resource: config.resource,
      rar: projected.access,
      scope: grant.scopes.join(" "),
      redirectUri: config.clients[0].redirectUri,
      codeChallenge: "c".repeat(43),
      codeChallengeMethod: "S256",
      iat: start / 1000,
      exp: start / 1000 + 60,
    };
    expect(() =>
      authority.protocolUpsert(
        "AuthorizationCode",
        "private-code",
        { ...source, grantId: "unknown" },
        60,
      ),
    ).toThrow();
    expect(() =>
      authority.protocolUpsert(
        "AuthorizationCode",
        "private-code",
        { ...source, clientId: "b" },
        60,
      ),
    ).toThrow();
    expect(() =>
      authority.protocolUpsert(
        "AuthorizationCode",
        "private-code",
        { ...source, resource: "https://foreign.test" },
        60,
      ),
    ).toThrow();
    authority.protocolUpsert("AuthorizationCode", "private-code", source, 60);
    authority.protocolConsume("AuthorizationCode", "private-code");
    reopen();
    expect(
      authority.protocolFind("AuthorizationCode", "private-code").consumed,
    ).toBeTruthy();
    expect(() =>
      authority.protocolConsume("AuthorizationCode", "private-code"),
    ).toThrow();
    expect(authority.listGrants(human, "all")[0].status).toBe("revoked");
    authority.protocolRevoke(grant.grantId);
    authority.protocolRevoke(grant.grantId);
    expect(
      authority.protocolFind("AuthorizationCode", "private-code"),
    ).toBeUndefined();
    expect(authority.listGrants(human, "all")[0].status).toBe("revoked");
    expect(
      store.inspectAudit().filter((e) => e.eventType === "grant.revoked"),
    ).toHaveLength(1);
  });

  it("keeps independent browser sessions durable, short-lived and CSRF-bound", () => {
    const pre = authority.beginBrowserSession();
    expect(authority.isManagement(pre.token)).toBe(false);
    expect(() => authority.loginBrowser(pre.token, "wrong", human)).toThrow();
    expect(() =>
      authority.loginBrowser(pre.token, pre.csrf, "context-token"),
    ).toThrow();
    const authenticated = authority.loginBrowser(pre.token, pre.csrf, human);
    expect(authority.isManagement(pre.token)).toBe(false);
    expect(authority.isManagement(authenticated.token)).toBe(true);
    expect(() =>
      authority.browserSession(authenticated.token, "wrong"),
    ).toThrow();
    reopen();
    expect(
      authority.browserSession(authenticated.token, authenticated.csrf)
        .authenticated,
    ).toBe(true);
    now += 12 * 3600_000;
    expect(authority.isManagement(authenticated.token)).toBe(false);
    expect(() =>
      authority.browserSession(authenticated.token, authenticated.csrf),
    ).toThrow();
  });

  it("applies persisted policies to existing and future grants and delivers directives without a claim", () => {
    const a = issue(),
      b = issue("b", [detail(["general_preferences", "work_context"])]);
    const active = store
      .inspectEntries()
      .find(
        (e) =>
          e.record.status === "active" &&
          e.classification.categories.includes("general_preferences"),
      )!;
    expect(
      authority.allowsEntry(a.grantId, "a", active.id, PURPOSES[0].code),
    ).toBe(true);
    authority.replacePolicy(human, {
      rules: [{ operators: ["example.test"], categories: ["work_context"] }],
      directives: ["permit", "ask-first", "deny"].map((effect) => ({
        action: "share",
        effect,
        text: effect,
      })),
    });
    expect(authority.ownGrant(b.grantId, "b").directives).toHaveLength(3);
    const future = issue("a", [
      detail(["general_preferences", "work_context"]),
    ]);
    expect(future.access[0].categories).toEqual(["general_preferences"]);
    authority.replacePolicy(human, {
      rules: [{ requires: ["https://example.test/claim/directives"] }],
      directives: [],
    });
    for (const g of [a, b, future])
      expect(() => authority.ownGrant(g.grantId, g.client.id)).toThrow();
    expect(() => issue()).toThrow();
    expect(
      authority.listGrants(human, "all").every((g) => g.status === "revoked"),
    ).toBe(true);
    reopen();
    expect(
      authority.allowsEntry(a.grantId, "a", active.id, PURPOSES[0].code),
    ).toBe(false);
  });

  it("fails closed on an unknown persisted narrowing instead of dropping the restriction", () => {
    const grant = issue(),
      active = store
        .inspectEntries()
        .find((e) => e.record.status === "active")!;
    store.close();
    // Explicit future-format/corruption fixture in a stopped owned store. Restore
    // the exact immutable trigger before reopening; runtime has no such mutation API.
    const db = new DatabaseSync(path.join(paths().root, "entries.sqlite"));
    try {
      const document = JSON.parse(
        String(
          db
            .prepare("SELECT document FROM grants WHERE id=?")
            .get(grant.grantId)!.document,
        ),
      );
      document.access[0].narrowedTo = { "https://future.test/restriction": [] };
      db.exec("DROP TRIGGER grants_immutable");
      db.prepare("UPDATE grants SET document=? WHERE id=?").run(
        JSON.stringify(document),
        grant.grantId,
      );
      db.exec(
        DATA_SCHEMA.find((s) =>
          s.startsWith("CREATE TRIGGER grants_immutable"),
        )!,
      );
    } finally {
      db.close();
    }
    store = SyntheticExperiment.open(paths(), options());
    authority = store.authorization(config, human);
    expect(
      authority.allowsEntry(grant.grantId, "a", active.id, PURPOSES[0].code),
    ).toBe(false);
    expect(() => authority.ownGrant(grant.grantId, "a")).toThrow();
  });

  it("rolls back a failed policy replacement together with its grant revocations", () => {
    const grant = issue();
    failAt = "before-audit";
    expect(() =>
      authority.replacePolicy(human, {
        rules: [{ operators: ["example.test"] }],
        directives: [],
      }),
    ).toThrow();
    failAt = undefined;
    reopen();
    expect(authority.ownGrant(grant.grantId, "a").grants).toHaveLength(1);
    expect(
      store
        .inspectAudit()
        .filter((e) => ["rule.set", "grant.revoked"].includes(e.eventType)),
    ).toHaveLength(0);
  });
});
