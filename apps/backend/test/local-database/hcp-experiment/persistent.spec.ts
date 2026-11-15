import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomBytes } from "node:crypto";
import { SyntheticExperiment } from "../../../src/infrastructure/hcp-experiment/store";
import {
  ACCESS_TYPE,
  PURPOSES,
} from "../../../src/infrastructure/hcp-experiment/policy";
const config = {
  issuer: "https://as.hcp.test:4443",
  resource: "https://as.hcp.test:4443",
  clients: ["a", "b"].map((id) => ({
    id,
    name: id,
    operator: { id: `https://example.test/${id}`, name: id },
    redirectUri: `https://client-${id}.hcp.test:4444/callback`,
  })),
};
describe("C5 distinct persistence and fixed credential families", () => {
  let sandbox: string,
    store: SyntheticExperiment,
    a: any,
    human: string,
    now: number,
    clockAtCommit: number | undefined;
  const paths = () => ({ sandbox, root: path.join(sandbox, "experiment") });
  beforeEach(() => {
    sandbox = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "hcp-c5-persistent-")),
    );
    fs.chmodSync(sandbox, 0o700);
    now = Date.parse("2026-11-15T12:00:00Z");
    clockAtCommit = undefined;
    human = randomBytes(32).toString("base64url");
    store = SyntheticExperiment.create(paths(), {
      clock: () => now,
      fault: (point) => {
        if (point === "before-commit" && clockAtCommit !== undefined) {
          now = clockAtCommit;
          clockAtCommit = undefined;
        }
      },
    });
    a = store.authorization(config, human);
  });
  afterEach(() => {
    store.close();
    fs.rmSync(sandbox, { recursive: true });
  });
  function review() {
    return a.review(
      human,
      {
        interactionId: randomBytes(12).toString("hex"),
        clientId: "a",
        resource: config.resource,
        access: [
          {
            type: ACCESS_TYPE,
            actions: ["read"],
            categories: ["general_preferences"],
            purposes: [PURPOSES[0]],
          },
        ],
      },
      {},
      "browser",
    );
  }
  const approve = (r: any) =>
    a.approve(human, r.reviewId, r.csrf, "browser", "synthetic-test-driver");
  const persist = () => {
    const r = review();
    return approve(a.electPersistence(human, r.reviewId, r.csrf, "browser"));
  };
  it.each(["elect", "approve"])(
    "refuses %s when the exact consent review expires before commit",
    (operation) => {
      let r = review();
      if (operation === "approve")
        r = a.electPersistence(human, r.reviewId, r.csrf, "browser");
      clockAtCommit = now + 600_000;
      expect(() =>
        operation === "elect"
          ? a.electPersistence(human, r.reviewId, r.csrf, "browser")
          : approve(r),
      ).toThrow();
      expect(a.listGrants(human, "all")).toEqual([]);
    },
  );
  it.each(["elect", "approve"])(
    "refuses %s when the browser session expires while its review remains valid",
    (operation) => {
      const begun = a.beginBrowserSession(),
        session = a.loginBrowser(begun.token, begun.csrf, human);
      now += 12 * 3600_000 - 300_000;
      let r = review();
      if (operation === "approve")
        r = a.electPersistence(session.token, r.reviewId, r.csrf, "browser");
      clockAtCommit = now + 300_000;
      expect(() =>
        operation === "elect"
          ? a.electPersistence(session.token, r.reviewId, r.csrf, "browser")
          : a.approve(session.token, r.reviewId, r.csrf, "browser", "browser"),
      ).toThrow();
      expect(a.listGrants(human, "all")).toEqual([]);
    },
  );
  it("keeps ordinary approval temporary, separately elects persistence and invalidates the back-navigation form", () => {
    expect(approve(review()).grantType).toBe("temporary");
    const r = review();
    expect(() =>
      a.electPersistence(human, r.reviewId, "forged", "browser"),
    ).toThrow();
    const elected = a.electPersistence(human, r.reviewId, r.csrf, "browser");
    expect(() => approve(r)).toThrow();
    const grant = approve(elected);
    expect(grant).toMatchObject({
      grantType: "persistent",
      expiresAt: null,
      status: "active",
    });
    expect(
      store
        .inspectAudit()
        .filter(
          (e) => e.grantId === grant.grantId && e.eventType === "grant.issued",
        )[0].data.persistenceElection,
    ).toBe("separate-affirmative-act");
    now += 48 * 3600_000;
    store.close();
    store = SyntheticExperiment.open(paths(), { clock: () => now });
    a = store.authorization(config, human);
    expect(a.ownGrant(grant.grantId, "a").grants[0].status).toBe("active");
  });
  it("consumed refresh reuse revokes only its HCP grant and never extends the fixed family", () => {
    const one = persist(),
      two = persist(),
      token = randomBytes(32).toString("base64url");
    const payload = {
      kind: "RefreshToken",
      jti: token,
      clientId: "a",
      accountId: a.accountId(),
      grantId: one.grantId,
      rar: one.access,
      scope: one.scopes.join(" "),
      resource: config.resource,
      exp: now / 1000 + 30 * 86400,
    };
    a.protocolUpsert("RefreshToken", token, payload, 30 * 86400);
    a.protocolConsume("RefreshToken", token);
    expect(a.protocolFind("RefreshToken", token).consumed).toBeDefined();
    expect(() => a.protocolConsume("RefreshToken", token)).toThrow();
    expect(() => a.ownGrant(one.grantId, "a")).toThrow();
    expect(a.ownGrant(two.grantId, "a").grants[0].status).toBe("active");
    expect(() =>
      a.protocolUpsert(
        "RefreshToken",
        token + "x",
        {
          ...payload,
          jti: token + "x",
          grantId: two.grantId,
          exp: payload.exp + 1,
        },
        30 * 86400 + 1,
      ),
    ).toThrow();
  });
  it("atomically revokes the family when oidc-provider destroys a consumed refresh before its separate revoke call", () => {
    const one = persist(),
      two = persist(),
      token = randomBytes(32).toString("base64url");
    const payload = {
      kind: "RefreshToken",
      jti: token,
      clientId: "a",
      accountId: a.accountId(),
      grantId: one.grantId,
      rar: one.access,
      scope: one.scopes.join(" "),
      resource: config.resource,
      exp: now / 1000 + 30 * 86400,
    };
    a.protocolUpsert("RefreshToken", token, payload, 30 * 86400);
    a.protocolConsume("RefreshToken", token);
    a.protocolUpsert(
      "RefreshToken",
      token + "next",
      { ...payload, jti: token + "next" },
      30 * 86400,
    );
    a.protocolDestroy("RefreshToken", token);
    // Simulate process loss between adapter destroy completion and the provider's revoke call.
    store.close();
    store = SyntheticExperiment.open(paths(), { clock: () => now });
    a = store.authorization(config, human);
    expect(() => a.ownGrant(one.grantId, "a")).toThrow();
    expect(a.protocolFind("RefreshToken", token + "next")).toBeUndefined();
    expect(a.ownGrant(two.grantId, "a").grants[0].status).toBe("active");
  });
});
