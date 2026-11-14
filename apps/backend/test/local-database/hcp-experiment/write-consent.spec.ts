import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomBytes } from "node:crypto";
import { SyntheticExperiment } from "../../../src/infrastructure/hcp-experiment/store";
import {
  ACCESS_TYPE,
  PURPOSES,
  scopeAccess,
  validateAccess,
} from "../../../src/infrastructure/hcp-experiment/policy";

const configuration = {
  issuer: "https://as.hcp.test:4443",
  resource: "https://as.hcp.test:4443",
  clients: ["a", "b"].map((id) => ({
    id,
    name: `Controlled client ${id}`,
    operator: {
      id: "https://example.test/operator",
      name: "Synthetic operator",
    },
    redirectUri: `https://client-${id}.hcp.test:4444/callback`,
  })),
};
const detail = (actions = ["read", "write"], extra = {}) => ({
  type: ACCESS_TYPE,
  actions,
  categories: ["general_preferences"],
  purposes: [PURPOSES[0]],
  ...extra,
});

describe("C4 fresh, bounded write consent", () => {
  let sandbox: string, store: SyntheticExperiment, human: string;
  beforeEach(() => {
    sandbox = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "hcp-c4-consent-")),
    );
    fs.chmodSync(sandbox, 0o700);
    human = randomBytes(32).toString("base64url");
    store = SyntheticExperiment.create({
      sandbox,
      root: path.join(sandbox, "experiment"),
    });
  });
  afterEach(() => {
    store.close();
    fs.rmSync(sandbox, { recursive: true });
  });

  it("records fresh affirmative write consent without changing an earlier read grant, including after reopen", () => {
    let authority = store.authorization(configuration, human);
    const issue = (access: any[]) => {
      const review = authority.review(
        human,
        {
          interactionId: randomBytes(16).toString("hex"),
          clientId: "a",
          resource: configuration.resource,
          access,
        },
        {},
        "browser",
      );
      expect(authority.listGrants(human)).not.toContainEqual(
        expect.objectContaining({ access }),
      );
      return authority.approve(
        human,
        review.reviewId,
        review.csrf,
        "browser",
        "synthetic-test-driver",
      );
    };
    const read = issue([detail(["read"])]);
    const write = issue([detail()]);
    expect(write.grantId).not.toBe(read.grantId);
    expect(write.scopes).toEqual([
      "hcp:general_preferences:read",
      "hcp:general_preferences:write",
    ]);
    expect(write.access).toEqual([detail()]);
    expect(read.scopes).toEqual(["hcp:general_preferences:read"]);
    store.close();
    store = SyntheticExperiment.open({
      sandbox,
      root: path.join(sandbox, "experiment"),
    });
    authority = store.authorization(configuration, human);
    expect(authority.ownGrant(read.grantId, "a").grants[0].access).toEqual([
      detail(["read"]),
    ]);
    expect(authority.ownGrant(write.grantId, "a").grants[0].access).toEqual([
      detail(),
    ]);
    const events = store
      .inspectAudit()
      .filter((e) => e.eventType === "grant.issued");
    expect(events).toHaveLength(2);
    expect(events[1].data.access).toEqual(write.access);
  });

  it("pairs read and write within a scope-only category and still requires explicit purpose selection", () => {
    const access = scopeAccess(
      "hcp:general_preferences:write hcp:general_preferences:read",
    );
    expect(access).toEqual([
      {
        type: ACCESS_TYPE,
        actions: ["read", "write"],
        categories: ["general_preferences"],
      },
    ]);
    const authority = store.authorization(configuration, human);
    const request = {
      interactionId: "scoped",
      clientId: "a",
      resource: configuration.resource,
      scope: "hcp:general_preferences:read hcp:general_preferences:write",
    };
    expect(() => authority.review(human, request, {}, "browser")).toThrow();
    const review = authority.review(
      human,
      request,
      { purposes: [PURPOSES[0].code] },
      "browser",
    );
    expect(review.access).toEqual([detail()]);
    expect(authority.listGrants(human)).toEqual([]);
  });

  it("rejects unsupported write-only, split-detail, multi-purpose or unknown-action requests without authority", () => {
    for (const access of [
      [detail(["write"])],
      [detail(["read"]), detail(["write"])],
      [detail(["read", "write"], { purposes: PURPOSES })],
      [detail(["read", "write", "erase"])],
      [detail(), detail(["read", "write"], { purposes: [PURPOSES[1]] })],
    ])
      expect(() => validateAccess(access)).toThrow();
    for (const scope of [
      "hcp:general_preferences:write",
      "hcp:general_preferences:write hcp:work_context:read",
    ])
      expect(() => scopeAccess(scope)).toThrow();
    expect(
      validateAccess([detail(["read"], { purposes: PURPOSES })]),
    ).toHaveLength(1);
    expect(store.authorization(configuration, human).listGrants(human)).toEqual(
      [],
    );
  });
});
