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
    name: `Synthetic ${id}`,
    operator: {
      id: `https://example.test/operators/${id}`,
      name: `Operator ${id}`,
    },
    redirectUri: `https://client-${id}.hcp.test:4444/callback`,
  })),
};
describe("C5 exact governance and immutable disclosure facts", () => {
  let sandbox: string,
    store: SyntheticExperiment,
    a: any,
    human: string,
    now: number,
    failAt: string | undefined,
    clockAtCommit: number | undefined,
    clockAfterCommit: number | undefined;
  beforeEach(() => {
    sandbox = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "hcp-c5-governance-")),
    );
    fs.chmodSync(sandbox, 0o700);
    now = Date.parse("2026-11-15T12:00:00Z");
    human = randomBytes(32).toString("base64url");
    failAt = undefined;
    clockAtCommit = undefined;
    clockAfterCommit = undefined;
    store = SyntheticExperiment.create(
      { sandbox, root: path.join(sandbox, "experiment") },
      {
        pendingApproval: true,
        clock: () => now,
        fault: (point) => {
          if (point === failAt) throw new Error("injected audit failure");
          if (point === "before-commit" && clockAtCommit !== undefined) {
            now = clockAtCommit;
            clockAtCommit = undefined;
          }
          if (point === "after-data-commit" && clockAfterCommit !== undefined) {
            now = clockAfterCommit;
            clockAfterCommit = undefined;
          }
        },
      },
    );
    a = store.authorization(config, human);
    const r = a.reviewBootstrap(human);
    a.approveBootstrap(human, r.reviewId, r.digest);
  });
  afterEach(() => {
    store.close();
    fs.rmSync(sandbox, { recursive: true });
  });
  const entry = () =>
    store
      .inspectEntries()
      .find(
        (e) =>
          e.record.status === "active" &&
          e.classification.categories.includes("general_preferences"),
      )!;
  function grant() {
    const r = a.review(
      human,
      {
        interactionId: randomBytes(16).toString("hex"),
        clientId: "a",
        resource: config.resource,
        access: [
          {
            type: ACCESS_TYPE,
            actions: ["read", "write"],
            categories: ["general_preferences", "work_context"],
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
    );
    const t = randomBytes(32).toString("base64url");
    a.protocolUpsert(
      "AccessToken",
      t,
      {
        kind: "AccessToken",
        jti: t,
        clientId: "a",
        accountId: a.accountId(),
        grantId: g.grantId,
        rar: g.access,
        scope: g.scopes.join(" "),
        aud: config.resource,
        exp: now / 1000 + 3600,
      },
      3600,
    );
    return { g, t };
  }
  it("filters sharing by prior possible categories under the reporting grant, not current categories or another grant", () => {
    const first = grant();
    let result: any;
    a.releaseRead(
      a.prepareRead(first.t, "query", {
        query: "written notes",
        categories: ["general_preferences"],
        purpose: PURPOSES[0].code,
      }),
      (bytes: string) => {
        result = JSON.parse(bytes);
      },
    );
    const disclosure = store
      .inspectAudit()
      .filter(
        (e) => e.eventType === "context.read" && e.grantId === first.g.grantId,
      )
      .at(-1)!.disclosed[0];
    a.editClassification(human, disclosure.entryId, "categories", {
      expectedVersion: disclosure.version,
      categories: ["work_context"],
    });
    const other = grant();
    a.releaseRead(
      a.prepareRead(other.t, "query", {
        query: "written notes",
        categories: ["work_context"],
        purpose: PURPOSES[0].code,
      }),
      () => {},
    );
    expect(() =>
      a.reportSharing(first.t, {
        recipient: { domain: "recipient.example", name: "Synthetic" },
        refs: [result.entries[0].ref],
        purpose: PURPOSES[0].code,
        sharedAt: "2020-01-01T00:00:00Z",
      }),
    ).toThrow();
    const report = store
      .inspectAudit()
      .find((e) => e.eventType === "context.shared")!;
    expect(report.data.possibleCategories).toEqual(["general_preferences"]);
    expect(
      a.audit(human, {
        category: "general_preferences",
        eventType: "context.shared",
      }).events,
    ).toEqual([report]);
    expect(
      a.audit(human, { category: "work_context", eventType: "context.shared" })
        .events,
    ).toEqual([]);
  });
  it("changes classification without a version, preserves assertion restrictions and rejects wrong versions atomically", () => {
    const e = entry(),
      before = store.inspectAudit().length;
    expect(() =>
      a.editClassification(human, e.id, "categories", {
        expectedVersion: 99,
        categories: ["work_context"],
      }),
    ).toThrow(/version-conflict/);
    expect(store.inspectAudit()).toHaveLength(before);
    const changed = a.editClassification(human, e.id, "categories", {
      expectedVersion: e.record.version,
      categories: ["work_context"],
    });
    expect(changed.record.version).toBe(e.record.version);
    expect(changed.classification.categories).toEqual(["work_context"]);
    expect(
      a.editClassification(human, e.id, "purposes", {
        expectedVersion: e.record.version,
        permittedPurposes: [],
      }).classification.permittedPurposes,
    ).toEqual([]);
    const unrestricted = a.editClassification(human, e.id, "purposes", {
      expectedVersion: e.record.version,
      permittedPurposes: null,
    });
    expect(unrestricted.classification.permittedPurposes).toBeUndefined();
    expect(unrestricted.assertion.permittedPurposes).toEqual(
      e.assertion.permittedPurposes,
    );
    expect(
      store
        .inspectAudit()
        .filter((e) => e.eventType === "context.restricted")
        .map((e) => e.data.to),
    ).toEqual([[], null]);
  });
  it("never revives reviewed approvals after same-version restriction restoration or unrelated semantic changes", () => {
    const e = entry(),
      input = {
        expectedVersion: e.record.version,
        categories: ["work_context"],
      };
    const review = a.reviewClassification(
      human,
      e.id,
      "categories",
      input,
      "browser",
    );
    a.editClassification(human, e.id, "purposes", {
      expectedVersion: e.record.version,
      permittedPurposes: [],
    });
    a.editClassification(human, e.id, "purposes", {
      expectedVersion: e.record.version,
      permittedPurposes: e.classification.permittedPurposes,
    });
    expect(() =>
      a.approveClassification(human, review.reviewId, review.csrf, "browser"),
    ).toThrow();
    const fresh = a.reviewClassification(
      human,
      e.id,
      "categories",
      input,
      "browser",
    );
    expect(() =>
      a.approveClassification(human, fresh.reviewId, "wrong", "browser"),
    ).toThrow();
    expect(
      a.approveClassification(human, fresh.reviewId, fresh.csrf, "browser")
        .classification.categories,
    ).toEqual(["work_context"]);
    expect(() =>
      a.approveClassification(human, fresh.reviewId, fresh.csrf, "browser"),
    ).toThrow();
  });
  it("retains individual policy IDs and permanently revokes authority denied by a standing rule", () => {
    const { g, t } = grant();
    const first = a.setPolicy(human, "directives", {
      action: "share",
      effect: "ask-first",
      text: "Ask me",
    });
    const second = a.setPolicy(human, "directives", {
      action: "urn:example:action",
      effect: "deny",
      text: "Do not do this",
    });
    a.removePolicy(human, "directives", second.directiveId);
    expect(a.listPolicy(human, "directives")).toEqual([first]);
    const rule = a.setPolicy(human, "rules", {
      operators: [config.clients[0].operator.id],
    });
    expect(
      a.listGrants(human, "all").find((x) => x.grantId === g.grantId).status,
    ).toBe("revoked");
    a.removePolicy(human, "rules", rule.ruleId);
    expect(a.protocolFind("AccessToken", t)).toBeUndefined();
    expect(() => a.listPolicy(t, "rules")).toThrow();
  });
  it("freezes offered categories and directive documents before later classification edits", () => {
    const { t } = grant(),
      e = entry();
    const directive = a.setPolicy(human, "directives", {
      action: "share",
      effect: "deny",
      text: "Private directive",
      categories: ["general_preferences"],
    });
    const ticket = a.prepareRead(t, "query", {
      query: "written notes",
      purpose: PURPOSES[0].code,
      categories: ["general_preferences"],
    });
    a.releaseRead(ticket, () => {});
    const read = store
      .inspectAudit()
      .filter((e) => e.eventType === "context.read")
      .at(-1)!;
    expect(
      read.disclosed.every(
        (d) => JSON.stringify(d.categories) === '["general_preferences"]',
      ),
    ).toBe(true);
    expect(read.data.directiveDocuments).toEqual([directive]);
    a.editClassification(human, e.id, "categories", {
      expectedVersion: e.record.version,
      categories: ["work_context"],
    });
    expect(
      store.inspectAudit().find((x) => x.eventId === read.eventId),
    ).toEqual(read);
    const issued = store
      .inspectAudit()
      .filter((e) => e.eventType === "grant.issued")
      .at(-1)!;
    expect(issued.data.client.name).toBe("Synthetic a");
  });
  it("does not attribute a report if its credential expires before durable commit", () => {
    const { t } = grant();
    let disclosed: any;
    a.releaseRead(
      a.prepareRead(t, "query", {
        query: "written notes",
        purpose: PURPOSES[0].code,
      }),
      (bytes: string) => {
        disclosed = JSON.parse(bytes);
      },
    );
    clockAtCommit = now + 3600_000;
    expect(() =>
      a.reportSharing(t, {
        recipient: { domain: "recipient.example", name: "Synthetic" },
        refs: [disclosed.entries[0].ref],
        purpose: PURPOSES[0].code,
        sharedAt: new Date(now).toISOString(),
      }),
    ).toThrow();
    expect(
      store.inspectAudit().filter((e) => e.eventType === "context.shared"),
    ).toHaveLength(0);
  });
  it("includes a durably forbidden sharing report in the affected entry history", () => {
    const { t } = grant();
    let result: any;
    a.releaseRead(
      a.prepareRead(t, "query", {
        query: "written notes",
        purpose: PURPOSES[0].code,
      }),
      (bytes: string) => {
        result = JSON.parse(bytes);
      },
    );
    expect(() =>
      a.reportSharing(t, {
        recipient: { domain: "recipient.example", name: "Synthetic" },
        refs: [result.entries[0].ref],
        purpose: PURPOSES[0].code,
        sharedAt: new Date(now).toISOString(),
      }),
    ).toThrow();
    const report = store
      .inspectAudit()
      .find((e) => e.eventType === "context.shared")!;
    expect(
      a.audit(human, { entryId: report.data.entries[0].id }).events,
    ).toContainEqual(report);
  });
  it("suppresses audit results if the management session expires at durable commit", () => {
    const begun = a.beginBrowserSession(),
      session = a.loginBrowser(begun.token, begun.csrf, human);
    clockAfterCommit = now + 12 * 3600_000;
    expect(() => a.audit(session.token)).toThrow();
  });
  it("recategorizing an older inference never makes it a later assertion", () => {
    const { g, t } = grant();
    const create = (category: string, value: string) => {
      const input = {
        schema: "https://hcp.example/spec/entry/2.0",
        subject: g.subject,
        content: {
          profile: "https://hcp.example/spec/profiles/general-context/2.0",
          value: {
            type: "urn:context-router:exclusive-fact:v1",
            slot: "contact",
            setting: "work",
            value,
          },
        },
        classification: { categories: [category] },
        assertion: { declarationType: "model-inferred", confidence: "high" },
        record: {
          provenance: {
            source: "synthetic",
            assertedBy: { id: "urn:example:model" },
          },
        },
      };
      a.releaseWrite(
        a.commitWrite(t, "create", input, JSON.stringify(input)),
        () => {},
      );
      return store
        .inspectEntries()
        .find((e) => e.content.value?.value === value)!;
    };
    const old = create("general_preferences", "email"),
      latest = create("work_context", "phone");
    a.editClassification(human, old.id, "categories", {
      expectedVersion: 1,
      categories: ["work_context"],
    });
    expect(store.inspectEntry(old.id)!.record.status).toBe("deprecated");
    expect(store.inspectEntry(latest.id)!.record.status).toBe("active");
  });
  it("rolls classification and review generation back when audit persistence fails", () => {
    const e = entry(),
      events = store.inspectAudit();
    failAt = "before-audit";
    expect(() =>
      a.editClassification(human, e.id, "categories", {
        expectedVersion: e.record.version,
        categories: ["work_context"],
      }),
    ).toThrow("injected audit failure");
    store.close();
    failAt = undefined;
    store = SyntheticExperiment.open(
      { sandbox, root: path.join(sandbox, "experiment") },
      { clock: () => now },
    );
    expect(store.inspectEntry(e.id)!.classification).toEqual(e.classification);
    expect(store.inspectAudit()).toEqual(events);
  });
  it.each(["set", "remove", "replace"])(
    "refuses a policy %s if management authority expires before commit",
    (operation) => {
      const rule = a.setPolicy(human, "rules", {
        operators: ["blocked.example"],
      });
      const begun = a.beginBrowserSession(),
        session = a.loginBrowser(begun.token, begun.csrf, human);
      const before = a.listPolicy(human, "rules");
      clockAtCommit = now + 12 * 3600_000;
      expect(() =>
        operation === "set"
          ? a.setPolicy(session.token, "rules", {
              operators: ["other.example"],
            })
          : operation === "remove"
            ? a.removePolicy(session.token, "rules", rule.ruleId)
            : a.replacePolicy(session.token, { rules: [], directives: [] }),
      ).toThrow();
      expect(a.listPolicy(human, "rules")).toEqual(before);
    },
  );
  it("refuses classification with unauthenticated status and no mutation when the session expires before commit", () => {
    const e = entry(),
      begun = a.beginBrowserSession(),
      session = a.loginBrowser(begun.token, begun.csrf, human),
      before = store.inspectAudit();
    clockAtCommit = now + 12 * 3600_000;
    expect(() =>
      a.editClassification(session.token, e.id, "categories", {
        expectedVersion: e.record.version,
        categories: ["work_context"],
      }),
    ).toThrow(expect.objectContaining({ kind: "unauthenticated" }));
    expect(store.inspectEntry(e.id)).toEqual(e);
    expect(store.inspectAudit()).toEqual(before);
  });
  it("returns completion only when classification commits across the human session deadline", () => {
    const e = entry(),
      begun = a.beginBrowserSession(),
      session = a.loginBrowser(begun.token, begun.csrf, human);
    clockAfterCommit = now + 12 * 3600_000;
    expect(
      a.editClassification(session.token, e.id, "categories", {
        expectedVersion: e.record.version,
        categories: ["work_context"],
      }),
    ).toEqual({ outcome: "committed", representation: "not-included" });
    expect(store.inspectEntry(e.id)!.classification.categories).toEqual([
      "work_context",
    ]);
  });
  it("rejects classification consequences if entry validity crosses before commit", () => {
    const { g, t } = grant();
    const input = {
      schema: "https://hcp.example/spec/entry/2.0",
      subject: g.subject,
      content: {
        profile: "https://hcp.example/spec/profiles/general-context/2.0",
        value: "short-lived classification target",
      },
      classification: { categories: ["general_preferences"] },
      assertion: {
        declarationType: "person-declared",
        validUntil: new Date(now + 1000).toISOString(),
      },
      record: { provenance: { source: "synthetic" } },
    };
    a.releaseWrite(
      a.commitWrite(t, "create", input, JSON.stringify(input)),
      () => {},
    );
    const e = store
      .inspectEntries()
      .find((e) => e.content.value === input.content.value)!;
    clockAtCommit = now + 1000;
    expect(() =>
      a.editClassification(human, e.id, "categories", {
        expectedVersion: 1,
        categories: ["work_context"],
      }),
    ).toThrow();
    expect(store.inspectEntry(e.id)!.classification.categories).toEqual([
      "general_preferences",
    ]);
    expect(
      a.editClassification(human, e.id, "categories", {
        expectedVersion: 1,
        categories: ["work_context"],
      }).record.status,
    ).toBe("expired");
  });
  it.each([null, {}, { expectedVersion: 1 }])(
    "refuses malformed classification %p without closing admission",
    (input) => {
      const e = entry();
      try {
        a.editClassification(human, e.id, "categories", input);
        throw new Error("accepted");
      } catch (error: any) {
        expect(error.kind).toBe("invalid");
      }
      expect(a.managementEntry(human, e.id).entry.id).toBe(e.id);
    },
  );
  it("captures a newly matching peer deadline before category graph effects", () => {
    const { g, t } = grant();
    const create = (category: string, value: string, expires: boolean) => {
      const input = {
        schema: "https://hcp.example/spec/entry/2.0",
        subject: g.subject,
        content: {
          profile: "https://hcp.example/spec/profiles/general-context/2.0",
          value: {
            type: "urn:context-router:exclusive-fact:v1",
            slot: "meeting",
            setting: "work",
            value,
          },
        },
        classification: { categories: [category] },
        assertion: {
          declarationType: "model-inferred",
          confidence: "high",
          ...(expires
            ? { validUntil: new Date(now + 1000).toISOString() }
            : {}),
        },
        record: {
          provenance: {
            source: "synthetic",
            assertedBy: { id: "urn:example:model" },
          },
        },
      };
      a.releaseWrite(
        a.commitWrite(t, "create", input, JSON.stringify(input)),
        () => {},
      );
      return store
        .inspectEntries()
        .find((e) => e.content.value?.value === value)!;
    };
    create("general_preferences", "online", true);
    const newer = create("work_context", "in-person", false);
    clockAtCommit = now + 1000;
    expect(() =>
      a.editClassification(human, newer.id, "categories", {
        expectedVersion: 1,
        categories: ["general_preferences"],
      }),
    ).toThrow();
    expect(store.inspectEntry(newer.id)!.classification.categories).toEqual([
      "work_context",
    ]);
  });
  it("keeps explicit client contradiction quarantine through category-only edits", () => {
    const { g, t } = grant();
    const create = (model: boolean, target?: string) => {
      const input = {
        schema: "https://hcp.example/spec/entry/2.0",
        subject: g.subject,
        content: {
          profile: "https://hcp.example/spec/profiles/general-context/2.0",
          value: model
            ? "incompatible inferred assertion"
            : "authoritative person assertion",
        },
        classification: { categories: ["general_preferences"] },
        assertion: model
          ? { declarationType: "model-inferred", confidence: "high" }
          : { declarationType: "person-declared" },
        record: {
          provenance: {
            source: "synthetic",
            ...(model ? { assertedBy: { id: "urn:example:model" } } : {}),
          },
          ...(target
            ? { relationships: [{ type: "contradicts", target }] }
            : {}),
        },
      };
      let response: any;
      a.releaseWrite(
        a.commitWrite(t, "create", input, JSON.stringify(input)),
        (_: number, bytes: string) => {
          response = JSON.parse(bytes);
        },
      );
      return response;
    };
    const person = create(false);
    create(true, person.ref);
    const model = store
      .inspectEntries()
      .find((e) => e.content.value === "incompatible inferred assertion")!;
    expect(model.record.status).toBe("conflicted");
    a.editClassification(human, model.id, "categories", {
      expectedVersion: 1,
      categories: ["work_context"],
    });
    expect(store.inspectEntry(model.id)!.record.status).toBe("conflicted");
    expect(a.managementEntry(human, model.id).conflicts).toHaveLength(1);
  });
});
