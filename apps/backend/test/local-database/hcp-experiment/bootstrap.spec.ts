import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomBytes } from "node:crypto";
import { SyntheticExperiment } from "../../../src/infrastructure/hcp-experiment/store";
import {
  syntheticFixtures,
  validateFixtures,
} from "../../../src/infrastructure/hcp-experiment/fixtures";

const start = Date.parse("2026-11-09T12:00:00Z");
const configuration = {
  issuer: "https://as.hcp.test:4443",
  resource: "https://as.hcp.test:4443",
  clients: ["a", "b"].map((id) => ({
    id,
    name: `Client ${id}`,
    operator: {
      id: "https://example.test/operators/synthetic",
      name: "Synthetic fixture operator",
    },
    redirectUri: `https://client-${id}.hcp.test:4444/callback`,
  })),
};

describe("C3 bounded authenticated fixture initialization", () => {
  let sandbox: string,
    store: SyntheticExperiment,
    authority: any,
    human: string,
    now: number;
  let failAt: string | undefined;
  const paths = () => ({ sandbox, root: path.join(sandbox, "experiment") });
  const options = () => ({
    clock: () => now,
    fault: (p: string) => {
      if (p === failAt) throw new Error("Injected bootstrap failure");
    },
  });
  beforeEach(() => {
    sandbox = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "hcp-c3-bootstrap-")),
    );
    fs.chmodSync(sandbox, 0o700);
    human = randomBytes(32).toString("base64url");
    now = start;
    failAt = undefined;
    store = SyntheticExperiment.create(paths(), {
      ...options(),
      pendingApproval: true,
    } as any);
    authority = store.authorization(configuration, human);
  });
  afterEach(() => {
    store?.close();
    fs.rmSync(sandbox, { recursive: true });
  });
  const reopen = () => {
    store.close();
    store = SyntheticExperiment.open(paths(), options());
    authority = store.authorization(configuration, human);
  };
  const approve = () => {
    const review = authority.reviewBootstrap(human);
    authority.approveBootstrap(human, review.reviewId, review.digest);
    return review;
  };
  it("requires a distinct authenticated exact-bundle approval and closes authority atomically", () => {
    expect(store.inspectEntries()).toEqual([]);
    expect(authority.entryReadEnabled()).toBe(false);
    expect(() => authority.reviewBootstrap("wrong")).toThrow();
    const review = authority.reviewBootstrap(human);
    expect(review.fixtures).toEqual(syntheticFixtures());
    expect(store.inspectEntries()).toEqual([]);
    expect(() =>
      authority.approveBootstrap("wrong", review.reviewId, review.digest),
    ).toThrow();
    expect(() =>
      authority.approveBootstrap(human, review.reviewId, "wrong"),
    ).toThrow();
    now += 1000;
    authority.approveBootstrap(human, review.reviewId, review.digest);
    expect(authority.entryReadEnabled()).toBe(true);
    const entries = store.inspectEntries(),
      audit = store.inspectAudit();
    expect(entries).toHaveLength(7);
    const seedGrant = authority.listGrants(human, "all")[0];
    expect(seedGrant.status).toBe("revoked");
    expect(seedGrant.client.id).toBe(
      "urn:context-router:synthetic-initializer",
    );
    for (const entry of entries) {
      const p = entry.record.provenance;
      expect(p.assertedBy).toEqual({
        id: entry.subject.id,
        assurance: "authenticated",
      });
      expect(p.authorizedUnder).toBe(seedGrant.grantId);
      expect(p.submittedByClient).toEqual(seedGrant.client);
      expect(p.assertedAt).toBe(new Date(now).toISOString());
      expect(p.recordedAt).toBe(new Date(now).toISOString());
      expect(p.confirmations).toEqual([]);
      expect(p.fixture.simulated).toBe(false);
    }
    expect(audit.filter((e) => e.eventType === "grant.issued")).toHaveLength(1);
    expect(audit.filter((e) => e.eventType === "grant.revoked")).toHaveLength(
      1,
    );
    expect(() =>
      authority.approveBootstrap(human, review.reviewId, review.digest),
    ).toThrow();
    expect(() => authority.reviewBootstrap(human)).toThrow();
    reopen();
    expect(authority.entryReadEnabled()).toBe(true);
    expect(store.inspectEntries()).toEqual(entries);
    expect(store.inspectAudit()).toEqual(audit);
    expect(() =>
      authority.approveBootstrap(human, review.reviewId, review.digest),
    ).toThrow();
  });
  it("expires and supersedes review challenges without authorizing startup", () => {
    const old = authority.reviewBootstrap(human),
      latest = authority.reviewBootstrap(human);
    expect(() =>
      authority.approveBootstrap(human, old.reviewId, old.digest),
    ).toThrow();
    now += 300_000;
    expect(() =>
      authority.approveBootstrap(human, latest.reviewId, latest.digest),
    ).toThrow();
    reopen();
    expect(authority.entryReadEnabled()).toBe(false);
    expect(store.inspectEntries()).toEqual([]);
    approve();
    expect(authority.entryReadEnabled()).toBe(true);
  });
  it("records actual initializer relationship provenance and rejects unimplemented lifecycle relationship effects", () => {
    const fixtures = syntheticFixtures();
    fixtures[0].versions[1].relationships = [
      { type: "duplicates", targetFixture: 1 },
    ];
    const related = SyntheticExperiment.create(
      { sandbox, root: path.join(sandbox, "related") },
      { ...options(), pendingApproval: true, fixtures },
    );
    try {
      const a = related.authorization(configuration, human),
        review = a.reviewBootstrap(human);
      a.approveBootstrap(human, review.reviewId, review.digest);
      const entries = related.inspectEntries();
      const first = entries.find((e) => e.record.version === 2)!,
        target = entries.find(
          (e) =>
            e.record.status === "active" &&
            e.classification.categories.includes("work_context"),
        )!;
      expect(first.record.relationships).toEqual([
        {
          type: "duplicates",
          target: target.id,
          assertedBy: {
            role: "management-client",
            id: "urn:context-router:synthetic-initializer",
          },
          recordedAt: new Date(now).toISOString(),
        },
      ]);
    } finally {
      related.close();
    }
    for (const type of ["supersedes", "contradicts"]) {
      fixtures[0].versions[1].relationships = [
        { type, targetFixture: 1 },
      ] as any;
      expect(() => validateFixtures(fixtures)).toThrow();
    }
  });
  it.each(["before-audit", "before-commit"])(
    "rolls back seed, authority, audit and closure at %s",
    (point) => {
      const review = authority.reviewBootstrap(human);
      failAt = point;
      expect(() =>
        authority.approveBootstrap(human, review.reviewId, review.digest),
      ).toThrow();
      expect(() => store.inspectEntries()).toThrow();
      failAt = undefined;
      reopen();
      expect(store.inspectEntries()).toEqual([]);
      expect(store.inspectAudit()).toEqual([]);
      expect(authority.listGrants(human, "all")).toEqual([]);
      approve();
      expect(authority.entryReadEnabled()).toBe(true);
    },
  );
  it("preserves committed approval after uncertain acknowledgement without reseeding", () => {
    const review = authority.reviewBootstrap(human);
    failAt = "after-data-commit";
    expect(() =>
      authority.approveBootstrap(human, review.reviewId, review.digest),
    ).toThrow();
    failAt = undefined;
    reopen();
    const audit = store.inspectAudit();
    expect(authority.entryReadEnabled()).toBe(true);
    expect(store.inspectEntries()).toHaveLength(7);
    expect(() =>
      authority.approveBootstrap(human, review.reviewId, review.digest),
    ).toThrow();
    reopen();
    expect(store.inspectAudit()).toEqual(audit);
  });
  it("never relabels C1 simulated history or enables public reads on it", () => {
    const simulated = SyntheticExperiment.create({
      sandbox,
      root: path.join(sandbox, "simulated"),
    });
    try {
      const a: any = simulated.authorization(configuration, human);
      expect(a.entryReadEnabled()).toBe(false);
      expect(() => a.reviewBootstrap(human)).toThrow();
      for (const entry of simulated.inspectEntries()) {
        expect(entry.record.provenance.fixture.simulated).toBe(true);
        expect(entry.record.provenance.assertedBy.assurance).toBe("unverified");
      }
    } finally {
      simulated.close();
    }
  });
});
