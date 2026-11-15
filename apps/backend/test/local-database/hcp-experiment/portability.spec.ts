import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { SyntheticExperiment } from "../../../src/infrastructure/hcp-experiment/store";
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
describe("C5 bounded v2 portability", () => {
  let sandbox: string,
    store: SyntheticExperiment,
    a: any,
    human: string,
    now: number;
  beforeEach(() => {
    sandbox = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "hcp-c5-portability-")),
    );
    fs.chmodSync(sandbox, 0o700);
    now = Date.parse("2026-11-15T12:00:00Z");
    human = randomBytes(32).toString("base64url");
    store = SyntheticExperiment.create(
      { sandbox, root: path.join(sandbox, "experiment") },
      { clock: () => now },
    );
    a = store.authorization(config, human);
  });
  afterEach(() => {
    store.close();
    fs.rmSync(sandbox, { recursive: true });
  });
  function foreign() {
    const bundle = a.exportContext(human, { include: "versions" });
    bundle.subject.id = "urn:example:source-subject";
    const entry = bundle.entries.find((e: any) => e.record.status === "active");
    entry.id = `urn:uuid:${randomUUID()}`;
    entry.subject.id = bundle.subject.id;
    entry.record.version = 1;
    entry.record.relationships = [];
    bundle.entries = [entry];
    delete bundle.versions;
    return bundle;
  }
  const apply = (bundle: any) => {
    const review = a.reviewImport(human, { export: bundle }, "browser");
    return a.applyImport(
      human,
      review.reviewId,
      review.csrf,
      "browser",
      review.subjects,
    );
  };
  it("indexes every import outcome and snapshots only accepted mapped categories", () => {
    const bundle = foreign(),
      accepted = bundle.entries[0];
    accepted.classification.categories = ["urn:foreign:category"];
    const skipped = a
      .exportContext(human)
      .entries.find((e: any) => e.record.status === "active");
    const rejected = structuredClone(accepted);
    rejected.id = `urn:uuid:${randomUUID()}`;
    rejected.classification.categories = ["general_preferences"];
    rejected.record.status = "conflicted";
    bundle.entries = [accepted, skipped, rejected];
    const input = {
      export: bundle,
      categoryMap: { "urn:foreign:category": "work_context" },
    };
    const review = a.reviewImport(human, input, "browser");
    const result = a.applyImport(
      human,
      review.reviewId,
      review.csrf,
      "browser",
      review.subjects,
    );
    expect(result.outcomes.map((o: any) => o.outcome)).toEqual([
      "imported",
      "skipped",
      "rejected",
    ]);
    const event = store
      .inspectAudit()
      .find((e) => e.eventType === "context.imported")!;
    expect(event.data.outcomes).toEqual(result.outcomes);
    expect(event.data.outcomes[2].reason).toBeDefined();
    for (const entry of bundle.entries)
      expect(
        a.audit(human, { entryId: entry.id, eventType: "context.imported" })
          .events,
      ).toEqual([event]);
    expect(event.categories).toEqual(["work_context"]);
    expect(
      a.audit(human, {
        category: "work_context",
        eventType: "context.imported",
      }).events,
    ).toEqual([event]);
    expect(
      a.audit(human, {
        category: "general_preferences",
        eventType: "context.imported",
      }).events,
    ).toEqual([]);
    const bytes = JSON.stringify(event);
    a.editClassification(human, accepted.id, "categories", {
      expectedVersion: 1,
      categories: ["general_preferences"],
    });
    store.close();
    store = SyntheticExperiment.open(
      { sandbox, root: path.join(sandbox, "experiment") },
      { clock: () => now },
    );
    a = store.authorization(config, human);
    expect(
      JSON.stringify(
        a.audit(human, { entryId: accepted.id, eventType: "context.imported" })
          .events[0],
      ),
    ).toBe(bytes);
    expect(
      a.audit(human, {
        category: "general_preferences",
        eventType: "context.imported",
      }).events,
    ).toEqual([]);
  });
  it("exports retained lifecycle states and immutable historical versions without credentials", () => {
    const result = a.exportContext(human, { include: "versions,audit" });
    expect(result.entries).toHaveLength(7);
    expect(result.versions).toHaveLength(1);
    expect(result.options).toEqual({
      includeVersions: true,
      includeAudit: true,
      excludeDeleted: false,
    });
    expect(result.entries.some((e: any) => e.record.status === "deleted")).toBe(
      true,
    );
    expect(a.exportContext(human, { exclude: "deleted" }).entries).toHaveLength(
      6,
    );
    expect(JSON.stringify(result)).not.toContain(human);
    expect(result.grants).toBeUndefined();
    expect(
      store.inspectAudit().filter((e) => e.eventType === "context.exported"),
    ).toHaveLength(2);
  });
  it("applies current principal classification to historical export representations", () => {
    const e = store.inspectEntries().find((e) => e.record.version > 1)!;
    a.editClassification(human, e.id, "categories", {
      expectedVersion: e.record.version,
      categories: ["work_context"],
    });
    a.editClassification(human, e.id, "purposes", {
      expectedVersion: e.record.version,
      permittedPurposes: [],
    });
    const exported = a.exportContext(human, { include: "versions" });
    expect(
      exported.versions.find((v: any) => v.id === e.id).classification,
    ).toEqual({
      ...e.classification,
      categories: ["work_context"],
      permittedPurposes: [],
    });
    exported.entries = exported.entries.filter((v: any) => v.id === e.id);
    expect(
      a.previewImport(human, { export: exported }).outcomes[0],
    ).toMatchObject({ id: e.id, outcome: "skipped" });
  });
  it("requires exact subject-set attestation, preserves source subject and supports re-exported association", () => {
    const bundle = foreign(),
      preview = a.previewImport(human, { export: bundle });
    expect(preview.outcomes[0].outcome).toBe("imported");
    const review = a.reviewImport(human, { export: bundle }, "browser");
    expect(() =>
      a.applyImport(human, review.reviewId, review.csrf, "browser", []),
    ).toThrow();
    const result = a.applyImport(
      human,
      review.reviewId,
      review.csrf,
      "browser",
      review.subjects,
    );
    expect(result.outcomes[0].outcome).toBe("imported");
    expect(store.inspectEntry(bundle.entries[0].id)!.subject).toEqual(
      bundle.entries[0].subject,
    );
    expect(
      a.applyImport(
        human,
        review.reviewId,
        review.csrf,
        "browser",
        review.subjects,
      ),
    ).toEqual(result);
    expect(
      a.previewImport(human, { export: a.exportContext(human) }).subjects,
    ).toContain(bundle.subject.id);
  });
  it("rejects changed held IDs, foreign graphs, incomplete history and nonempty source audit without silent dropping", () => {
    const bundle = foreign();
    apply(bundle);
    expect(a.previewImport(human, { export: bundle }).outcomes[0].outcome).toBe(
      "skipped",
    );
    bundle.entries[0].record.version = 2;
    expect(a.previewImport(human, { export: bundle }).outcomes[0].outcome).toBe(
      "rejected",
    );
    const graph = foreign();
    graph.entries[0].record.relationships = [
      { type: "derivedFrom", target: `urn:uuid:${randomUUID()}` },
    ];
    expect(
      a.previewImport(human, { export: graph }).outcomes[0].reason,
    ).toMatch(/relationship/);
    const history = foreign();
    history.entries[0].record.version = 3;
    history.versions = [
      {
        ...history.entries[0],
        record: { ...history.entries[0].record, version: 1 },
      },
    ];
    expect(
      a.previewImport(human, { export: history }).outcomes[0].reason,
    ).toMatch(/history/);
    const audited = foreign();
    audited.audit = [{ eventType: "context.created" }];
    expect(a.previewImport(human, { export: audited }).blockers).toContain(
      "source audit is unsupported",
    );
    for (const status of ["revoked", "suspended"]) {
      const unsupported = foreign();
      unsupported.entries[0].record.status = status;
      expect(
        a.previewImport(human, { export: unsupported }).outcomes[0].outcome,
      ).toBe("rejected");
    }
    const issuer = foreign();
    issuer.entries[0].assertion.declarationType = "issuer-attested";
    expect(a.previewImport(human, { export: issuer }).outcomes[0].reason).toBe(
      "unsupported declaration type",
    );
  });
  it("dry run does not reconcile expired entries or append audit, and semantic changes stale an import review", () => {
    const bundle = foreign(),
      before = store.inspectAudit();
    a.previewImport(human, { export: bundle });
    expect(store.inspectAudit()).toEqual(before);
    const review = a.reviewImport(human, { export: bundle }, "browser");
    a.setPolicy(human, "directives", {
      action: "share",
      effect: "deny",
      text: "Changed",
    });
    expect(() =>
      a.applyImport(
        human,
        review.reviewId,
        review.csrf,
        "browser",
        review.subjects,
      ),
    ).toThrow();
    expect(store.inspectEntry(bundle.entries[0].id)).toBeUndefined();
  });
  it("preserves an associated foreign subject when the person later revises its assertion", () => {
    const bundle = foreign();
    apply(bundle);
    const e = bundle.entries[0];
    const request = {
      expectedVersion: 1,
      reason: "My correction",
      content: { ...e.content, value: "new wording" },
      assertion: { declarationType: "person-declared" },
      record: { provenance: { source: "person-input" } },
    };
    const review = a.reviewPersonWrite(
      human,
      "revise",
      request,
      e.id,
      "browser",
    );
    let updated: any;
    a.releaseWrite(
      a.commitReviewedPersonWrite(
        human,
        review.reviewId,
        review.csrf,
        "browser",
        "foreign-subject-revise",
      ),
      (_: number, bytes: string) => {
        updated = JSON.parse(bytes);
      },
    );
    expect(updated.subject).toEqual(e.subject);
    expect(store.inspectEntry(e.id)!.subject).toEqual(e.subject);
    expect(store.inspectEntry(e.id, 1)!.subject).toEqual(e.subject);
  });
  it("runs dry import interpretation without expiry reconciliation or any file mutation", () => {
    const bundle = foreign();
    bundle.entries[0].assertion.validUntil = new Date(now + 1000).toISOString();
    apply(bundle);
    const file = path.join(sandbox, "experiment", "entries.sqlite"),
      before = fs.readFileSync(file);
    now += 2000;
    a.previewImport(human, { export: bundle });
    expect(fs.readFileSync(file)).toEqual(before);
    expect(store.inspectEntry(bundle.entries[0].id)!.record.status).toBe(
      "expired",
    );
  });
  it("rejects ambiguous imported assertion chronology during later recategorization", () => {
    const bundle = foreign();
    const base = bundle.entries[0];
    base.classification.categories = ["general_preferences"];
    base.assertion = {
      declarationType: "model-inferred",
      confidence: "medium",
    };
    base.content.value = {
      type: "urn:context-router:exclusive-fact:v1",
      slot: "choice",
      setting: "test",
      value: "one",
    };
    base.record.provenance.assertedBy = {
      id: "urn:model:foreign",
      assurance: "unverified",
    };
    const other = structuredClone(base);
    other.id = `urn:uuid:${randomUUID()}`;
    other.content.value.value = "two";
    other.classification.categories = ["work_context"];
    bundle.entries.push(other);
    apply(bundle);
    expect(() =>
      a.editClassification(human, other.id, "categories", {
        expectedVersion: 1,
        categories: base.classification.categories,
      }),
    ).toThrow();
  });
  it("rejects policy IDs repeated across rule/directive kinds in the preview", () => {
    const bundle = foreign(),
      id = `urn:uuid:${randomUUID()}`,
      common = {
        setBy: "context-subject",
        createdAt: new Date(now).toISOString(),
      };
    bundle.rules = [
      { ...common, ruleId: id, effect: "deny", operators: ["blocked.example"] },
    ];
    bundle.directives = [
      {
        ...common,
        directiveId: id,
        action: "share",
        effect: "deny",
        text: "No onward use",
      },
    ];
    expect(
      a.previewImport(human, { export: bundle }).blockers.length,
    ).toBeGreaterThan(0);
  });
  it("evaluates overdue local assertions as expired in a pure dry run", () => {
    const bundle = foreign(),
      e = bundle.entries[0];
    e.classification.categories = ["general_preferences"];
    e.assertion = {
      declarationType: "model-inferred",
      confidence: "medium",
      validUntil: new Date(now + 1000).toISOString(),
    };
    e.record.provenance.assertedBy = {
      id: "urn:model:foreign",
      assurance: "unverified",
    };
    e.content.value = {
      type: "urn:context-router:exclusive-fact:v1",
      slot: "clock",
      setting: "same",
      value: "old",
    };
    apply(bundle);
    const incoming = structuredClone(bundle);
    incoming.entries[0].id = `urn:uuid:${randomUUID()}`;
    delete incoming.entries[0].assertion.validUntil;
    incoming.entries[0].content.value.value = "new";
    now += 2000;
    const result = a.previewImport(human, { export: incoming });
    expect(result.outcomes[0].outcome).toBe("imported");
    expect(result.effects).toEqual([]);
  });
  it("blocks repeated current IDs regardless of array order", () => {
    const bundle = foreign(),
      other = structuredClone(bundle.entries[0]);
    other.content.value = "different record";
    bundle.entries.push(other);
    for (const entries of [bundle.entries, [...bundle.entries].reverse()]) {
      const input = { export: { ...bundle, entries } },
        preview = a.previewImport(human, input);
      expect(preview.blockers).toContain("duplicate current entry ID");
      const review = a.reviewImport(human, input, "browser");
      expect(() =>
        a.applyImport(
          human,
          review.reviewId,
          review.csrf,
          "browser",
          review.subjects,
        ),
      ).toThrow();
      expect(store.inspectEntry(other.id)).toBeUndefined();
    }
  });
  it("accepts omitted optional arrays and preserves source shape through import, export, duplicate detection and revision", () => {
    const bundle = foreign(),
      e = bundle.entries[0];
    delete e.record.relationships;
    delete e.record.provenance.confirmations;
    delete e.evidence;
    expect(a.previewImport(human, { export: bundle }).outcomes[0].outcome).toBe(
      "imported",
    );
    apply(bundle);
    expect(a.previewImport(human, { export: bundle }).outcomes[0].outcome).toBe(
      "skipped",
    );
    const again = a.exportContext(human);
    again.entries = again.entries.filter((v: any) => v.id === e.id);
    expect(a.previewImport(human, { export: again }).outcomes[0].outcome).toBe(
      "skipped",
    );
    const request = {
      expectedVersion: 1,
      reason: "Correction",
      content: { ...e.content, value: "revised" },
      assertion: { declarationType: "person-declared" },
      record: { provenance: { source: "person-input" } },
    };
    expect(
      a.reviewPersonWrite(human, "revise", request, e.id, "browser").reviewId,
    ).toBeDefined();
  });
  it.each(["local-person", "local-model", "batch", "batch-reversed"])(
    "evaluates foreign person/model conflict standing for %s",
    (mode) => {
      const bundle = foreign(),
        person = bundle.entries[0];
      person.classification.categories = ["general_preferences"];
      person.record.provenance.assertedBy.assurance = "authenticated";
      person.content.value = {
        type: "urn:context-router:exclusive-fact:v1",
        slot: "transfer",
        setting: "same",
        value: "person",
      };
      const model = structuredClone(person);
      model.id = `urn:uuid:${randomUUID()}`;
      model.content.value.value = "model";
      model.assertion = {
        declarationType: "model-inferred",
        confidence: "medium",
      };
      model.record.provenance.assertedBy = {
        id: "urn:foreign:model",
        assurance: "unverified",
      };
      model.record.provenance.confirmations = [];
      let incoming;
      if (mode.startsWith("local")) {
        const first = mode === "local-person" ? person : model;
        apply({ ...bundle, entries: [first] });
        incoming = {
          ...bundle,
          entries: [mode === "local-person" ? model : person],
        };
      } else
        incoming = {
          ...bundle,
          entries: mode === "batch" ? [person, model] : [model, person],
        };
      const preview = a.previewImport(human, { export: incoming });
      expect(preview.effects).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ quarantine: [model.id] }),
        ]),
      );
      apply(incoming);
      expect(store.inspectEntry(model.id)!.record.status).toBe("conflicted");
      expect(store.inspectEntry(person.id)!.record.status).toBe("active");
    },
  );
  it("shows imported policy effects before atomically revoking affected existing grants", () => {
    const r = a.review(
        human,
        {
          interactionId: "policy-import",
          clientId: "a",
          resource: config.resource,
          access: [
            {
              type: "https://hcp.example/spec/authorization/context-access",
              actions: ["read"],
              categories: ["general_preferences"],
              purposes: [
                {
                  code: "https://example.test/purpose/synthetic-review",
                  description: "Synthetic review",
                },
              ],
            },
          ],
        },
        {},
        "browser",
      ),
      g = a.approve(
        human,
        r.reviewId,
        r.csrf,
        "browser",
        "synthetic-test-driver",
      );
    const bundle = foreign();
    bundle.rules = [
      {
        ruleId: `urn:uuid:${randomUUID()}`,
        operators: [config.clients[0].operator.id],
        effect: "deny",
        setBy: "context-subject",
        createdAt: new Date(now).toISOString(),
      },
    ];
    expect(
      a.previewImport(human, { export: bundle }).grantEffects,
    ).toContainEqual(
      expect.objectContaining({ grantId: g.grantId, outcome: "revoked" }),
    );
    apply(bundle);
    expect(() => a.ownGrant(g.grantId, "a")).toThrow();
    expect(a.listPolicy(human, "rules")).toContainEqual(bundle.rules[0]);
  });
  it("exports all seven retained lifecycle states, including elapsed validity", () => {
    const bundle = foreign();
    bundle.entries[0].assertion.validUntil = new Date(now + 1000).toISOString();
    apply(bundle);
    now += 2000;
    expect(
      new Set(a.exportContext(human).entries.map((e: any) => e.record.status)),
    ).toEqual(
      new Set([
        "active",
        "deprecated",
        "conflicted",
        "expired",
        "revoked",
        "suspended",
        "deleted",
      ]),
    );
  });
  it("recognizes a repeated versioned foreign transfer with the same category mapping", () => {
    const bundle = foreign(),
      e = bundle.entries[0];
    e.classification.categories = ["urn:foreign:category"];
    const previous = structuredClone(e);
    previous.content.value = "previous";
    e.record.version = 2;
    bundle.versions = [previous];
    const input = {
        export: bundle,
        categoryMap: { "urn:foreign:category": "general_preferences" },
      },
      review = a.reviewImport(human, input, "browser");
    a.applyImport(
      human,
      review.reviewId,
      review.csrf,
      "browser",
      review.subjects,
    );
    expect(a.previewImport(human, input).outcomes[0].outcome).toBe("skipped");
  });
  it.each(["active", "deprecated", "expired"])(
    "rejects a current %s source whose latest confirmation is rejection without changing the source",
    (status) => {
      const bundle = foreign(),
        e = bundle.entries[0];
      e.record.status = status;
      e.record.provenance.confirmations = [
        {
          disposition: "rejected",
          confirmedBy: { id: e.subject.id },
          confirmedAt: new Date(now).toISOString(),
        },
      ];
      const source = structuredClone(bundle);
      const preview = a.previewImport(human, { export: bundle });
      expect(preview.outcomes[0]).toMatchObject({ outcome: "rejected" });
      expect(preview.outcomes[0].reason).toMatch(/rejection.*deleted/);
      expect(apply(bundle).outcomes).toEqual(preview.outcomes);
      expect(store.inspectEntry(e.id)).toBeUndefined();
      expect(bundle).toEqual(source);
    },
  );
  it("preserves deleted rejected sources and version-bound historical rejections", () => {
    const bundle = foreign(),
      e = bundle.entries[0];
    e.record.status = "deleted";
    e.record.provenance.confirmations = [
      {
        disposition: "rejected",
        confirmedBy: { id: e.subject.id },
        confirmedAt: new Date(now).toISOString(),
      },
    ];
    expect(apply(bundle).outcomes[0].outcome).toBe("imported");
    expect(store.inspectEntry(e.id)).toMatchObject(e);
    const next = foreign(),
      current = next.entries[0];
    current.record.version = 2;
    current.record.provenance.confirmations = [];
    const previous = structuredClone(current);
    previous.record.version = 1;
    // An export projects the current lifecycle on earlier immutable versions.
    previous.record.provenance.confirmations =
      e.record.provenance.confirmations;
    next.versions = [previous];
    expect(apply(next).outcomes[0].outcome).toBe("imported");
    expect(
      store.inspectEntry(current.id)!.record.provenance.confirmations,
    ).toEqual([]);
    expect(
      store.inspectEntry(current.id, 1)!.record.provenance.confirmations,
    ).toEqual(previous.record.provenance.confirmations);
  });
  it.each(["none", "current-and-history", "history-only"])(
    "recognizes exact raw and exported history with distinct classification and purposes (mapped=%s)",
    (mapping) => {
      const bundle = foreign(),
        e = bundle.entries[0];
      const previous = structuredClone(e);
      previous.content.value = "previous private wording";
      previous.classification.categories =
        mapping !== "none" ? ["urn:foreign:previous"] : ["general_preferences"];
      previous.classification.permittedPurposes = ["urn:purpose:previous"];
      e.record.version = 2;
      e.classification.categories =
        mapping === "current-and-history"
          ? ["urn:foreign:current"]
          : ["work_context"];
      e.classification.permittedPurposes = ["urn:purpose:current"];
      bundle.versions = [previous];
      const input = {
        export: bundle,
        ...(mapping === "current-and-history"
          ? {
              categoryMap: {
                "urn:foreign:previous": "general_preferences",
                "urn:foreign:current": "work_context",
              },
            }
          : {}),
      };
      const perform = (request: any) => {
        const review = a.reviewImport(human, request, "browser");
        return a.applyImport(
          human,
          review.reviewId,
          review.csrf,
          "browser",
          review.subjects,
        );
      };
      expect(perform(input).outcomes[0].outcome).toBe("imported");
      expect(a.previewImport(human, input).outcomes[0].outcome).toBe("skipped");
      expect(perform(input).outcomes[0].outcome).toBe("skipped");
      const exported = a.exportContext(human, { include: "versions" });
      exported.entries = exported.entries.filter((v: any) => v.id === e.id);
      exported.versions = exported.versions.filter((v: any) => v.id === e.id);
      expect(exported.versions[0].classification).toEqual(
        exported.entries[0].classification,
      );
      expect(
        a.previewImport(human, { export: exported }).outcomes[0].outcome,
      ).toBe("skipped");
      expect(perform({ export: exported }).outcomes[0].outcome).toBe("skipped");
      for (const alter of [
        (v: any) => {
          v.content.value = "altered";
        },
        (v: any) => {
          v.record.provenance.source = "altered";
        },
        (v: any) => {
          v.classification.categories = ["general_preferences", "work_context"];
        },
        (v: any) => {
          v.classification.permittedPurposes = [];
        },
      ]) {
        for (const request of [input, { export: exported }]) {
          const changed = structuredClone(request);
          alter(changed.export.versions[0]);
          expect(a.previewImport(human, changed).outcomes[0]).toMatchObject({
            outcome: "rejected",
            reason: "nonidentical held history",
          });
        }
      }
    },
  );
  it("agrees on elapsed held duplicates before and after reconciliation", () => {
    const bundle = foreign();
    bundle.entries[0].assertion.validUntil = new Date(now + 1000).toISOString();
    apply(bundle);
    now += 2000;
    const input = { export: bundle },
      dry = a.previewImport(human, input),
      reviewed = a.reviewImport(human, input, "browser");
    expect(dry.outcomes).toEqual(reviewed.outcomes);
    expect(dry.outcomes[0].outcome).toBe("skipped");
  });
  it("does not preview policy revocation of an already elapsed temporary grant", () => {
    const r = a.review(
        human,
        {
          interactionId: "expired-policy-import",
          clientId: "a",
          resource: config.resource,
          access: [
            {
              type: "https://hcp.example/spec/authorization/context-access",
              actions: ["read"],
              categories: ["general_preferences"],
              purposes: [
                {
                  code: "https://example.test/purpose/synthetic-review",
                  description: "Synthetic review",
                },
              ],
            },
          ],
        },
        {},
        "browser",
      ),
      g = a.approve(
        human,
        r.reviewId,
        r.csrf,
        "browser",
        "synthetic-test-driver",
      );
    const bundle = foreign();
    bundle.rules = [
      {
        ruleId: `urn:uuid:${randomUUID()}`,
        operators: [config.clients[0].operator.id],
        effect: "deny",
        setBy: "context-subject",
        createdAt: new Date(now).toISOString(),
      },
    ];
    now = Date.parse(g.expiresAt);
    expect(a.previewImport(human, { export: bundle }).grantEffects).toEqual([]);
    expect(
      a.reviewImport(human, { export: bundle }, "browser").grantEffects,
    ).toEqual([]);
  });
});
