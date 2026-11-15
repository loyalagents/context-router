import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  generateKeyPairSync,
  randomBytes,
  createPublicKey,
  verify,
} from "node:crypto";
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
    ...(id === "a"
      ? {
          notificationEndpoint: "https://client-a.hcp.test:4444/revocations",
          legalRetention: {
            record: "Synthetic chart",
            obligation: "Synthetic obligation",
            period: "7 years",
          },
        }
      : {}),
  })),
};
describe("C5 durable revocation outbox", () => {
  let sandbox: string,
    store: SyntheticExperiment,
    a: any,
    human: string,
    now: number,
    clockAtCommit: number | undefined;
  const paths = () => ({ sandbox, root: path.join(sandbox, "experiment") });
  beforeEach(() => {
    sandbox = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "hcp-c5-notify-")),
    );
    fs.chmodSync(sandbox, 0o700);
    now = Date.parse("2026-11-15T12:00:00Z");
    human = randomBytes(32).toString("base64url");
    clockAtCommit = undefined;
    store = SyntheticExperiment.create(paths(), {
      clock: () => now,
      pendingApproval: true,
      fault: (point) => {
        if (point === "before-commit" && clockAtCommit !== undefined) {
          now = clockAtCommit;
          clockAtCommit = undefined;
        }
      },
    });
    a = store.authorization(config, human);
    const review = a.reviewBootstrap(human);
    a.approveBootstrap(human, review.reviewId, review.digest);
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    a.protocolSecrets(() => ({
      jwks: {
        keys: [
          {
            ...privateKey.export({ format: "jwk" }),
            kid: "fixture-key",
            alg: "RS256",
            use: "sig",
          },
        ],
      },
    }));
  });
  afterEach(() => {
    store.close();
    fs.rmSync(sandbox, { recursive: true });
  });
  function grant(clientId = "a", disclose = true) {
    const r = a.review(
      human,
      {
        interactionId: randomBytes(12).toString("hex"),
        clientId,
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
    const g = a.approve(
        human,
        r.reviewId,
        r.csrf,
        "browser",
        "synthetic-test-driver",
      ),
      token = randomBytes(24).toString("base64url");
    a.protocolUpsert(
      "AccessToken",
      token,
      {
        jti: token,
        kind: "AccessToken",
        clientId,
        accountId: a.accountId(),
        grantId: g.grantId,
        rar: g.access,
        scope: g.scopes.join(" "),
        aud: config.resource,
        exp: now / 1000 + 3600,
      },
      3600,
    );
    if (disclose)
      a.releaseRead(
        a.prepareRead(token, "query", {
          query: "written notes",
          purpose: PURPOSES[0].code,
        }),
        () => {},
      );
    return g;
  }
  it("revokes immediately, signs once, retains exact bytes across retry/reopen and audits terminal acknowledgement", () => {
    const g = grant();
    a.revoke(human, g.grantId);
    a.revoke(human, g.grantId);
    expect(() => a.ownGrant(g.grantId, "a")).toThrow();
    const first = a.prepareNotification();
    expect(first.grantId).toBe(g.grantId);
    const [header, payload, signature] = first.token.split(".");
    const material = a.protocolSecrets(() => {
      throw new Error("existing signing key required");
    });
    expect(
      verify(
        "RSA-SHA256",
        Buffer.from(`${header}.${payload}`),
        createPublicKey({ key: material.jwks.keys[0], format: "jwk" }),
        Buffer.from(signature, "base64url"),
      ),
    ).toBe(true);
    expect(
      JSON.parse(Buffer.from(payload, "base64url").toString()),
    ).toMatchObject({
      iss: config.issuer,
      aud: "a",
      events: {
        "https://hcp.example/spec/events/grant-revoked": { grantId: g.grantId },
      },
    });
    a.finishNotification(g.grantId, 503);
    expect(a.prepareNotification()).toBeUndefined();
    now += 48 * 3600_000;
    store.close();
    store = SyntheticExperiment.open(paths(), { clock: () => now });
    a = store.authorization(config, human);
    const retry = a.prepareNotification();
    expect(retry.token).toBe(first.token);
    a.finishNotification(g.grantId, 202);
    const events = store
      .inspectAudit()
      .filter((e) => e.eventType === "revocation.notified");
    expect(events).toHaveLength(1);
    expect(events[0].data).toMatchObject({ outcome: "delivered", attempts: 2 });
    expect(a.prepareNotification()).toBeUndefined();
  });
  it("uses actual attempts after outages, waits 5/10/20/40 minutes and abandons after five attempts", () => {
    const g = grant();
    a.revoke(human, g.grantId);
    now += 2 * 86400_000;
    const initial = a.prepareNotification().token;
    for (const delay of [5, 10, 20, 40]) {
      expect(a.prepareNotification().token).toBe(initial);
      a.finishNotification(g.grantId, 0);
      expect(a.prepareNotification()).toBeUndefined();
      now += delay * 60_000 - 1;
      expect(a.prepareNotification()).toBeUndefined();
      now++;
    }
    expect(a.prepareNotification().token).toBe(initial);
    a.finishNotification(g.grantId, 503);
    expect(
      store.inspectAudit().find((e) => e.eventType === "revocation.notified")!
        .data,
    ).toMatchObject({ outcome: "abandoned", attempts: 5 });
  });
  it("does not notify without endpoint/copies, on self-relinquishment or ordinary expiry, but permits human revocation of expired grants", () => {
    const empty = grant("a", false),
      noEndpoint = grant("b"),
      self = grant(),
      expired = grant();
    a.revoke(human, empty.grantId);
    a.revoke(human, noEndpoint.grantId);
    a.relinquish(self.grantId, "a", self.grantId);
    now = Date.parse(expired.expiresAt);
    a.listGrants(human, "all");
    expect(a.prepareNotification()).toBeUndefined();
    a.revoke(human, expired.grantId);
    expect(a.prepareNotification().grantId).toBe(expired.grantId);
    a.finishNotification(expired.grantId, 400, "invalid_key");
    expect(
      store.inspectAudit().find((e) => e.eventType === "revocation.notified")!
        .data.error,
    ).toBe("invalid_key");
  });
  it("does not commit human revocation or its outbox after session expiry before commit", () => {
    const g = grant(),
      begun = a.beginBrowserSession(),
      session = a.loginBrowser(begun.token, begun.csrf, human);
    clockAtCommit = now + 12 * 3600_000;
    expect(() => a.revoke(session.token, g.grantId)).toThrow();
    expect(
      store
        .inspectAudit()
        .filter(
          (e) => e.grantId === g.grantId && e.eventType === "grant.revoked",
        ),
    ).toEqual([]);
    expect(a.prepareNotification()).toBeUndefined();
  });
  it("keeps committed local revocation usable when signing fails before token persistence", () => {
    const g = grant();
    a.revoke(human, g.grantId);
    const signing = jest
      .spyOn(require("node:crypto"), "sign")
      .mockImplementationOnce(() => {
        throw new Error("synthetic signing failure");
      });
    try {
      expect(() => a.prepareNotification()).toThrow(
        "synthetic signing failure",
      );
    } finally {
      signing.mockRestore();
    }
    expect(
      a.listGrants(human, "all").find((g2) => g2.grantId === g.grantId).status,
    ).toBe("revoked");
    expect(a.prepareNotification().grantId).toBe(g.grantId);
  });
  it.each([
    "https://outside.example/revocations",
    "http://client-a.hcp.test:4444/revocations",
    "https://client-a.hcp.test:4444/other",
    "https://client-a.hcp.test:4445/revocations",
  ])("rejects non-fixture notification endpoint %s", (endpoint) => {
    expect(() =>
      store.authorization(
        {
          ...config,
          clients: config.clients.map((c) =>
            c.id === "a" ? { ...c, notificationEndpoint: endpoint } : c,
          ),
        },
        human,
      ),
    ).toThrow();
  });
});
