import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { SyntheticExperiment } from "../../../src/infrastructure/hcp-experiment/store";
import {
  ACCESS_TYPE,
  PURPOSES,
  AuthorityError,
} from "../../../src/infrastructure/hcp-experiment/policy";
import { project } from "../../../src/infrastructure/hcp-experiment/disclosure";

const start = Date.parse("2026-11-13T12:00:00Z");
const config = {
  issuer: "https://as.hcp.test:4443",
  resource: "https://as.hcp.test:4443",
  copyLifetimeMs: 1000,
  clients: ["a", "b"].map((id) => ({
    id,
    name: `Synthetic ${id}`,
    operator: {
      id: `https://example.test/operator/${id}`,
      name: `Synthetic operator ${id}`,
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

describe("C4 durable person writes and original completion", () => {
  let sandbox: string, store: SyntheticExperiment, authority: any;
  let now: number,
    human: string,
    failAt: string | undefined,
    clockAtCommit: number | undefined,
    clockAtBeforeCommit: number | undefined,
    clockBeforeCommit: number | undefined;
  const paths = () => ({ sandbox, root: path.join(sandbox, "experiment") });
  const options = () => ({
    clock: () => now,
    pendingApproval: true,
    fault: (point: string) => {
      if (point === failAt) throw new Error("synthetic failure");
      if (point === "before-commit" && clockAtBeforeCommit !== undefined) {
        now = clockAtBeforeCommit;
        clockAtBeforeCommit = undefined;
      }
      if (
        point === "before-authorized-commit" &&
        clockBeforeCommit !== undefined
      ) {
        now = clockBeforeCommit;
        clockBeforeCommit = undefined;
      }
      if (point === "after-data-commit" && clockAtCommit !== undefined) {
        now = clockAtCommit;
        clockAtCommit = undefined;
      }
    },
  });
  beforeEach(() => {
    sandbox = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "hcp-c4-write-")),
    );
    fs.chmodSync(sandbox, 0o700);
    now = start;
    failAt = undefined;
    clockAtCommit = undefined;
    clockAtBeforeCommit = undefined;
    clockBeforeCommit = undefined;
    human = randomBytes(32).toString("base64url");
    store = SyntheticExperiment.create(paths(), options());
    authority = store.authorization(config, human);
    const r = authority.reviewBootstrap(human);
    authority.approveBootstrap(human, r.reviewId, r.digest);
  });
  afterEach(() => {
    store.close();
    fs.rmSync(sandbox, { recursive: true });
  });
  function reopen() {
    store.close();
    store = SyntheticExperiment.open(paths(), options());
    authority = store.authorization(config, human);
  }
  function tokenFor(grant: any, seconds = 3600) {
    const token = randomBytes(32).toString("base64url");
    authority.protocolUpsert(
      "AccessToken",
      token,
      {
        kind: "AccessToken",
        jti: token,
        clientId: grant.client.id,
        accountId: authority.accountId(),
        grantId: grant.grantId,
        rar: authority.ownGrant(grant.grantId, grant.client.id).grants[0]
          .access,
        scope: grant.scopes.join(" "),
        aud: config.resource,
        exp: Math.floor(now / 1000) + seconds,
      },
      seconds,
    );
    return token;
  }
  function issue(clientId = "a", access = [detail()], durationSeconds = 14400) {
    const r = authority.review(
      human,
      {
        interactionId: randomBytes(16).toString("hex"),
        clientId,
        resource: config.resource,
        access,
      },
      { durationSeconds },
      "browser",
    );
    const grant = authority.approve(
      human,
      r.reviewId,
      r.csrf,
      "browser",
      "synthetic-test-driver",
    );
    return { grant, token: tokenFor(grant, Math.min(durationSeconds, 3600)) };
  }
  const input = (grant: any, extra = {}) => ({
    schema: "https://hcp.example/spec/entry/2.0",
    subject: grant.subject,
    content: {
      profile: "https://hcp.example/spec/profiles/general-context/2.0",
      value: "private C4 statement",
    },
    classification: { categories: ["general_preferences"] },
    assertion: { declarationType: "person-declared" },
    record: { provenance: { source: "person-input" } },
    ...extra,
  });
  function commit(
    token: string,
    body: any,
    key?: string,
    operation = "create",
    ref?: string,
    raw = JSON.stringify(body),
  ) {
    return authority.commitWrite(token, operation, body, raw, key, ref);
  }
  function release(ticket: object) {
    let result: any;
    authority.releaseWrite(ticket, (status: number, bytes: string) => {
      result = { status, body: JSON.parse(bytes), bytes };
    });
    return result;
  }
  function modelInput(grant: any, value: string, model = "one") {
    return input(grant, {
      content: {
        ...input(grant).content,
        value: {
          type: "urn:context-router:exclusive-fact:v1",
          slot: "contact",
          setting: "work",
          value,
        },
      },
      assertion: { declarationType: "model-inferred", confidence: "high" },
      record: {
        provenance: {
          assertedBy: { id: `https://example.test/models/${model}/1` },
          source: "External synthetic assertion; no model run",
        },
      },
    });
  }

  it("records unverified model provenance and confidence, then edits it only through an approved person assertion", () => {
    const a = issue(),
      body = modelInput(a.grant, "email");
    for (const confidence of [undefined, "certain", 0.9]) {
      const bad = structuredClone(body);
      (bad.assertion as any).confidence = confidence;
      expect(() => commit(a.token, bad)).toThrow(AuthorityError);
    }
    const created = release(commit(a.token, body));
    expect(created.body.assertion).toMatchObject({
      declarationType: "model-inferred",
      confidence: "high",
    });
    const entry = store
      .inspectEntries()
      .find((e) => e.assertion.declarationType === "model-inferred")!;
    expect(entry.record.provenance.assertedBy).toEqual({
      id: "https://example.test/models/one/1",
      assurance: "unverified",
    });
    const request = {
      expectedVersion: 1,
      reason: "I am replacing the inference with my statement",
      content: { ...body.content, value: "I prefer email at work" },
      assertion: { declarationType: "person-declared" },
      record: { provenance: { source: "person-input" } },
    };
    const reviewed = authority.reviewPersonWrite(
      human,
      "revise",
      request,
      entry.id,
      "browser",
    );
    const capability = authority.approvePersonWrite(
      human,
      reviewed.reviewId,
      reviewed.csrf,
      "browser",
    );
    release(
      authority.commitPersonWrite(
        human,
        capability,
        "revise",
        request,
        JSON.stringify(request),
        "person-edit",
        entry.id,
      ),
    );
    expect(store.inspectEntry(entry.id)!.record.provenance.assertedBy).toEqual({
      id: authority.accountId(),
      assurance: "authenticated",
    });
    expect(store.inspectEntry(entry.id, 1)!.assertion.declarationType).toBe(
      "model-inferred",
    );
    expect(
      store.inspectEntry(entry.id)!.record.provenance.confirmations,
    ).toEqual([]);
  });

  it("discloses an immediate own-quarantined result only while the exact causal state remains unchanged", () => {
    const a = issue();
    const person = input(
      { subject: { id: authority.accountId() } },
      { content: modelInput(a.grant, "email").content },
    );
    const review = authority.reviewPersonWrite(
      human,
      "create",
      person,
      undefined,
      "browser",
    );
    const capability = authority.approvePersonWrite(
      human,
      review.reviewId,
      review.csrf,
      "browser",
    );
    release(
      authority.commitPersonWrite(
        human,
        capability,
        "create",
        person,
        JSON.stringify(person),
        "person",
      ),
    );
    const body = modelInput(a.grant, "phone");
    const result = release(commit(a.token, body, "model"));
    expect(result.body.content).toEqual(body.content);
    const entry = store
      .inspectEntries()
      .find((e) => e.assertion.declarationType === "model-inferred")!;
    expect(entry.record.status).toBe("conflicted");
    expect(() => commit(a.token, body, "model")).toThrow(AuthorityError);
    expect(() =>
      authority.prepareRead(
        a.token,
        "get",
        { purpose: PURPOSES[0].code },
        result.body.ref,
      ),
    ).toThrow(AuthorityError);
    const another = modelInput(a.grant, "letter", "two"),
      ticket = commit(a.token, another, "second-model");
    const second = store
      .inspectEntries()
      .find(
        (e) =>
          e.record.provenance.assertedBy.id ===
          "https://example.test/models/two/1",
      )!;
    const personRead = authority.prepareRead(a.token, "query", {
      query: "email",
      purpose: PURPOSES[0].code,
    });
    let personRef: string;
    authority.releaseRead(personRead, (bytes: string) => {
      personRef = JSON.parse(bytes).entries[0].ref;
    });
    release(
      commit(
        a.token,
        { reason: "Person statement withdrawn" },
        undefined,
        "withdraw",
        personRef!,
      ),
    );
    // Same content version and same conflicted status, but a later causal change.
    expect(store.inspectEntry(second.id)!.record.version).toBe(1);
    expect(store.inspectEntry(second.id)!.record.status).toBe("conflicted");
    expect(release(ticket).body).toEqual({
      outcome: "committed",
      representation: "not-included",
    });
    reopen();
    expect(store.inspectEntry(entry.id)!.record.status).toBe("conflicted");
  });

  it("withholds an earlier prepared active result when a later write quarantines that version", () => {
    const a = issue(),
      body = modelInput(a.grant, "email");
    const ticket = commit(a.token, body);
    release(
      commit(
        a.token,
        input(a.grant, { content: modelInput(a.grant, "phone").content }),
      ),
    );
    expect(release(ticket).body).toEqual({
      outcome: "committed",
      representation: "not-included",
    });
  });

  it.each(["expiry", "rejection"])(
    "invalidates own-quarantine release when opponent %s changes its retained cause",
    (change) => {
      const a = issue();
      const person = input(
        { subject: { id: authority.accountId() } },
        {
          content: modelInput(a.grant, "email").content,
          assertion: {
            declarationType: "person-declared",
            ...(change === "expiry"
              ? { validUntil: new Date(now + 100).toISOString() }
              : {}),
          },
        },
      );
      const review = authority.reviewPersonWrite(
        human,
        "create",
        person,
        undefined,
        "browser",
      );
      const capability = authority.approvePersonWrite(
        human,
        review.reviewId,
        review.csrf,
        "browser",
      );
      const created = release(
        authority.commitPersonWrite(
          human,
          capability,
          "create",
          person,
          JSON.stringify(person),
          "person-cause",
        ),
      );
      const ticket = commit(a.token, modelInput(a.grant, "phone"));
      if (change === "expiry") now += 100;
      else
        authority.confirmEntry(human, created.body.id, {
          expectedVersion: 1,
          disposition: "rejected",
        });
      expect(release(ticket).body).toEqual({
        outcome: "committed",
        representation: "not-included",
      });
    },
  );

  it.each(["supersedes", "acceptance"])(
    "invalidates an indirectly affected original ticket after %s deprecates its opponent",
    (action) => {
      const a = issue();
      const author = (body: any, key: string) => {
        const review = authority.reviewPersonWrite(
          human,
          "create",
          body,
          undefined,
          "browser",
        );
        const capability = authority.approvePersonWrite(
          human,
          review.reviewId,
          review.csrf,
          "browser",
        );
        return release(
          authority.commitPersonWrite(
            human,
            capability,
            "create",
            body,
            JSON.stringify(body),
            key,
          ),
        );
      };
      const person = author(
        input(
          { subject: { id: authority.accountId() } },
          { content: modelInput(a.grant, "email").content },
        ),
        "opponent",
      );
      const pending = commit(a.token, modelInput(a.grant, "phone"));
      if (action === "supersedes")
        author(
          input(
            { subject: { id: authority.accountId() } },
            {
              content: {
                ...input(a.grant).content,
                value: "I am replacing the old statement",
              },
              record: {
                provenance: { source: "person-input" },
                relationships: [{ type: "supersedes", target: person.body.id }],
              },
            },
          ),
          "replacement",
        );
      else {
        release(commit(a.token, modelInput(a.grant, "letter", "two")));
        const alternative = store
          .inspectEntries()
          .find(
            (e) =>
              e.record.provenance.assertedBy.id ===
              "https://example.test/models/two/1",
          )!;
        authority.confirmEntry(human, alternative.id, {
          expectedVersion: 1,
          disposition: "confirmed",
        });
      }
      expect(store.inspectEntry(person.body.id)!.record.status).toBe(
        "deprecated",
      );
      expect(release(pending).body).toEqual({
        outcome: "committed",
        representation: "not-included",
      });
    },
  );

  it("reconciles expiry with the graph and records both lifecycle and no-status conflict history", () => {
    const a = issue();
    const first: any = input(a.grant, {
      content: modelInput(a.grant, "email").content,
      assertion: {
        declarationType: "person-declared",
        validUntil: new Date(now + 500).toISOString(),
      },
    });
    release(commit(a.token, first));
    release(
      commit(
        a.token,
        input(a.grant, { content: modelInput(a.grant, "phone").content }),
      ),
    );
    const expiring = store
      .inspectEntries()
      .find((e) => e.assertion.validUntil === first.assertion.validUntil)!;
    now += 500;
    const history = authority.audit(human, { entryId: expiring.id }).events;
    expect(history.some((e: any) => e.eventType === "context.expired")).toBe(
      true,
    );
    expect(
      history.some(
        (e: any) =>
          e.eventType === "conflict.resolved" && e.data.transition === "ended",
      ),
    ).toBe(true);
    expect(authority.managementEntry(human, expiring.id).conflicts).toEqual([]);
  });

  it("keeps controlled producer proposals private until an atomic apply under current write authority", () => {
    const a = issue(),
      b = issue("b"),
      readOnly = issue("a", [detail(["read"])]);
    const fields = {
      content: modelInput(a.grant, "email").content,
      classification: { categories: ["general_preferences"] },
      confidence: "medium",
    };
    const beforeEntries = store.inspectEntries().length,
      beforeAudit = store.inspectAudit().length;
    const staged = authority.stageSyntheticProposal(human, "a", fields);
    expect(store.inspectEntries()).toHaveLength(beforeEntries);
    expect(store.inspectAudit()).toHaveLength(beforeAudit);
    expect(authority.stagedProposals(human)).toHaveLength(1);
    expect(() => authority.stagedProposals(a.token)).toThrow(AuthorityError);
    expect(() =>
      authority.applySyntheticProposal(b.token, staged.id, "apply"),
    ).toThrow(AuthorityError);
    expect(() =>
      authority.applySyntheticProposal(readOnly.token, staged.id, "apply"),
    ).toThrow(AuthorityError);
    expect(() =>
      authority.stageSyntheticProposal(human, "a", {
        ...fields,
        source: "forged",
        model: "forged",
      }),
    ).toThrow(AuthorityError);
    const query = authority.prepareRead(a.token, "query", {
      query: "contact work email",
      purpose: PURPOSES[0].code,
    });
    let disclosed: any;
    authority.releaseRead(query, (bytes: string) => {
      disclosed = JSON.parse(bytes);
    });
    expect(disclosed.entries).toEqual([]);
    failAt = "before-audit";
    expect(() =>
      authority.applySyntheticProposal(a.token, staged.id, "apply"),
    ).toThrow();
    failAt = undefined;
    reopen();
    expect(authority.stagedProposals(human)[0].state).toBe("pending");
    expect(store.inspectEntries()).toHaveLength(beforeEntries);
    const applied = release(
      authority.applySyntheticProposal(a.token, staged.id, "apply"),
    );
    expect(applied.body.assertion.confidence).toBe("medium");
    const written = store
      .inspectEntries()
      .find((e) => e.assertion.declarationType === "model-inferred")!;
    expect(written.record.provenance).toMatchObject({
      assertedBy: {
        id: "urn:context-router:controlled-synthetic-model:v1",
        assurance: "unverified",
      },
      source: "urn:context-router:controlled-synthetic-source:v1",
      fixture: { simulated: true, modelExecuted: false, producerVersion: "1" },
    });
    expect(written.record.provenance.authorizedUnder).toBe(a.grant.grantId);
    reopen();
    expect(
      release(authority.applySyntheticProposal(a.token, staged.id, "apply"))
        .bytes,
    ).toBe(applied.bytes);
    expect(() =>
      authority.applySyntheticProposal(a.token, staged.id, "new-key"),
    ).toThrow(AuthorityError);
    expect(store.inspectEntries()).toHaveLength(beforeEntries + 1);
    const declined = authority.stageSyntheticProposal(human, "a", fields);
    authority.declineSyntheticProposal(human, declined.id);
    expect(() =>
      authority.applySyntheticProposal(a.token, declined.id, "declined"),
    ).toThrow(AuthorityError);
    const revoked = authority.stageSyntheticProposal(human, "a", fields);
    authority.revoke(human, a.grant.grantId);
    expect(() =>
      authority.applySyntheticProposal(a.token, revoked.id, "revoked"),
    ).toThrow(AuthorityError);
    expect(store.inspectEntries()).toHaveLength(beforeEntries + 1);
  });

  it("authorizes relationship refs in the same grant and records provider-owned attribution", () => {
    const a = issue(),
      otherGrant = issue(),
      b = issue("b");
    const target = release(commit(a.token, input(a.grant))).body.ref;
    const body: any = input(a.grant, {
      record: {
        provenance: { source: "person-input" },
        relationships: [
          { type: "contradicts", target, extension: "preserved" },
        ],
      },
    });
    const result = release(commit(a.token, body));
    const sources = store
      .inspectEntries()
      .filter((e) =>
        e.record.relationships.some((r: any) => r.extension === "preserved"),
      );
    expect(sources).toHaveLength(2);
    expect(sources[0].record.relationships[0]).toMatchObject({
      type: "contradicts",
      assertedBy: { role: "context-client", id: "a" },
      recordedAt: new Date(now).toISOString(),
    });
    expect(result.body.relationships).toEqual([]); // Target is not in this response.
    for (const credential of [otherGrant.token, b.token])
      expect(() => commit(credential, body)).toThrow(AuthorityError);
    for (const owned of ["assertedBy", "recordedAt"]) {
      const forged = structuredClone(body);
      (forged.record.relationships[0] as any)[owned] = "forged";
      expect(() => commit(a.token, forged)).toThrow(AuthorityError);
    }
    const source = sources[0];
    expect(
      authority
        .audit(human, { entryId: source.id })
        .events.some((e: any) => e.eventType === "conflict.detected"),
    ).toBe(true);
  });

  it("permits revision of a deprecated entry without allowing a foreign asserter to supersede it", () => {
    const a = issue();
    const first = release(commit(a.token, input(a.grant))).body;
    const original = store
      .inspectEntries()
      .find((e) => e.content.value === "private C4 statement")!;
    const superseding = input(a.grant, {
      content: { ...input(a.grant).content, value: "replacement statement" },
      record: {
        provenance: { source: "person-input" },
        relationships: [{ type: "supersedes", target: first.ref }],
      },
    });
    release(commit(a.token, superseding));
    expect(store.inspectEntry(original.id)!.record.status).toBe("deprecated");
    const targetHistory = authority.audit(human, {
      entryId: original.id,
    }).events;
    expect(
      targetHistory.some((e: any) =>
        e.data.relatedTransitions?.some(
          (t: any) =>
            t.id === original.id &&
            t.before === "active" &&
            t.after === "deprecated",
        ),
      ),
    ).toBe(true);
    const revision = {
      expectedVersion: 1,
      reason: "new statement",
      content: {
        ...input(a.grant).content,
        value: "new assertion after deprecation",
      },
      record: { provenance: { source: "person-input" } },
    };
    expect(
      release(commit(a.token, revision, undefined, "revise", first.ref)).status,
    ).toBe(201);
    expect(store.inspectEntry(original.id)!.record.status).toBe("active");
    const b = issue("b");
    const read = authority.prepareRead(b.token, "query", {
      query: "new assertion after deprecation",
      purpose: PURPOSES[0].code,
    });
    let ref: string;
    authority.releaseRead(read, (bytes: string) => {
      ref = JSON.parse(bytes).entries[0].ref;
    });
    release(
      commit(
        b.token,
        input(b.grant, {
          record: {
            provenance: { source: "person-input" },
            relationships: [{ type: "supersedes", target: ref! }],
          },
        }),
      ),
    );
    expect(store.inspectEntry(original.id)!.record.status).toBe("active");
  });

  it("reviews every conflict peer and refuses stale same-version standing before keeping both", () => {
    const a = issue();
    const typed = (value: string) =>
      input(a.grant, {
        content: {
          ...input(a.grant).content,
          value: {
            type: "urn:context-router:exclusive-fact:v1",
            slot: "contact",
            setting: "work",
            value,
          },
        },
      });
    release(commit(a.token, typed("email")));
    release(commit(a.token, typed("phone")));
    const entries = store
      .inspectEntries()
      .filter(
        (e) =>
          typeof e.content.value === "object" &&
          (e.content.value as any).type ===
            "urn:context-router:exclusive-fact:v1",
      );
    const [left, right] = entries;
    const page = authority.managementEntry(human, left.id);
    expect(page.conflicts).toHaveLength(1);
    expect(page.conflicts[0].peer.id).toBe(right.id);
    const confirmation = authority.reviewConfirmation(
      human,
      left.id,
      { expectedVersion: 1, disposition: "confirmed" },
      "browser",
    );
    expect(confirmation.conflicts[0].peer.id).toBe(right.id);
    const keep = authority.reviewKeepBoth(
      human,
      page.conflicts[0].id,
      "browser",
    );
    authority.confirmEntry(human, right.id, {
      expectedVersion: 1,
      disposition: "confirmed",
    });
    expect(() =>
      authority.approveConfirmation(
        human,
        confirmation.reviewId,
        confirmation.csrf,
        "browser",
      ),
    ).toThrow(AuthorityError);
    expect(() =>
      authority.approveKeepBoth(human, keep.reviewId, keep.csrf, "browser"),
    ).toThrow(AuthorityError);
    const fresh = authority.reviewKeepBoth(
      human,
      page.conflicts[0].id,
      "browser",
    );
    authority.approveKeepBoth(human, fresh.reviewId, fresh.csrf, "browser");
    expect(authority.managementEntry(human, left.id).conflicts).toEqual([]);
    expect(store.inspectEntry(left.id)!.record.relationships).toHaveLength(1);
    expect(store.inspectEntry(right.id)!.record.version).toBe(1);
    reopen();
    expect(authority.managementEntry(human, left.id).conflicts).toEqual([]);
  });

  it("commits one create, immutable revision and withdrawal with truthful provenance and stable grant ref", () => {
    const { grant, token } = issue();
    const before = store.inspectEntries().length;
    const create = release(commit(token, input(grant)));
    expect(create.status).toBe(201);
    expect(create.body).toMatchObject({
      ref: expect.stringMatching(/^r_/),
      version: 1,
      content: input(grant).content,
      standing: { assurance: "unverified", confirmed: false },
    });
    expect(create.body.id).toBeUndefined();
    expect(create.body.record).toBeUndefined();
    expect(authority.lastPossibleCopyUseUntil(human, grant.grantId)).toBe(
      create.body.useUntil,
    );
    const entry = store
      .inspectEntries()
      .find((e) => e.content.value === "private C4 statement")!;
    expect(store.inspectEntries()).toHaveLength(before + 1);
    expect(entry.record.provenance).toMatchObject({
      authorizedUnder: grant.grantId,
      submittedByClient: grant.client,
      assertedBy: { assurance: "unverified" },
      confirmations: [],
    });
    const revision = {
      expectedVersion: 1,
      content: { ...input(grant).content, value: "revised" },
      reason: "person corrected statement",
      record: { provenance: { source: "person-input" } },
    };
    const revised = release(
      commit(token, revision, undefined, "revise", create.body.ref),
    );
    expect(revised.body).toMatchObject({
      ref: create.body.ref,
      version: 2,
      content: revision.content,
    });
    expect(store.inspectEntry(entry.id, 1)!.content.value).toBe(
      "private C4 statement",
    );
    expect(() =>
      commit(token, revision, undefined, "revise", create.body.ref),
    ).toThrow(/conflict/i);
    const deleted = release(
      commit(
        token,
        { reason: "withdraw" },
        "withdraw-key",
        "withdraw",
        create.body.ref,
      ),
    );
    expect(deleted.body).toMatchObject({
      ref: create.body.ref,
      status: "deleted",
    });
    expect(() =>
      commit(
        token,
        { ...revision, expectedVersion: 2 },
        undefined,
        "revise",
        create.body.ref,
      ),
    ).toThrow(AuthorityError);
    reopen();
    expect(store.inspectEntry(entry.id)!.record.status).toBe("deleted");
    expect(store.inspectEntry(entry.id, 1)!.content.value).toBe(
      "private C4 statement",
    );
  });

  it("old read authority, another grant's ref and login alone cannot mutate", () => {
    const read = issue("a", [detail(["read"])]),
      write = issue(),
      other = issue();
    const before = store.inspectEntries().length;
    expect(() => commit(read.token, input(read.grant))).toThrow(AuthorityError);
    expect(() => commit(human, input(write.grant))).toThrow(AuthorityError);
    const created = release(commit(write.token, input(write.grant)));
    expect(() =>
      commit(
        other.token,
        { reason: "foreign ref" },
        undefined,
        "withdraw",
        created.body.ref,
      ),
    ).toThrow(AuthorityError);
    expect(store.inspectEntries()).toHaveLength(before + 1);
  });

  it("retains a candidate for exact keyed retry across lost reply and restart without a second event", () => {
    const { grant, token } = issue();
    const body = input(grant);
    const first = commit(token, body, "key");
    const expected = release(first);
    const events = store.inspectAudit();
    reopen();
    expect(release(commit(token, body, "key"))).toEqual(expected);
    expect(store.inspectAudit()).toEqual(events);
    expect(() => commit(token, { ...body, extension: true }, "key")).toThrow(
      /idempotency-conflict/,
    );
    expect(() =>
      commit(
        token,
        body,
        "key",
        "create",
        undefined,
        JSON.stringify(body) + " ",
      ),
    ).toThrow(/idempotency-conflict/);
    const other = issue();
    expect(() => commit(other.token, input(other.grant), "key")).toThrow(
      AuthorityError,
    );
  });

  it("returns only known completion after revoke, while a later retry is denied and remains consumed", () => {
    const { grant, token } = issue();
    const body = input(grant);
    const ticket = commit(token, body, "revoked");
    authority.revoke(human, grant.grantId);
    expect(release(ticket)).toMatchObject({
      status: 201,
      body: { outcome: "committed", representation: "not-included" },
    });
    expect(() => commit(token, body, "revoked")).toThrow(AuthorityError);
    reopen();
    expect(() => commit(token, body, "revoked")).toThrow(AuthorityError);
    expect(
      store
        .inspectEntries()
        .filter((e) => e.content.value === "private C4 statement"),
    ).toHaveLength(1);
  });

  it("sticky partial-policy invalidation survives narrowing, restoration and restart while another client stays eligible", () => {
    const a = issue("a", [
      detail(["read", "write"], {
        categories: ["general_preferences", "work_context"],
      }),
    ]);
    const b = issue("b");
    const body = input(a.grant),
      otherBody = input(b.grant);
    const prepared = commit(a.token, body, "policy");
    const unaffected = release(commit(b.token, otherBody, "policy"));
    authority.replacePolicy(human, {
      rules: [
        {
          operators: [config.clients[0].operator.id],
          categories: ["general_preferences"],
        },
      ],
      directives: [],
    });
    authority.replacePolicy(human, { rules: [], directives: [] });
    expect(release(prepared).body).toEqual({
      outcome: "committed",
      representation: "not-included",
    });
    store.close();
    const inspection = new DatabaseSync(
      path.join(paths().root, "entries.sqlite"),
      { readOnly: true },
    );
    try {
      const affected = inspection
        .prepare("SELECT * FROM mutation_receipts WHERE grant_id=?")
        .get(a.grant.grantId)!;
      expect(affected.invalidated).toBe(1);
      expect(affected.response).toBeNull();
      expect(String(affected.binding)).not.toContain(body.content.value);
      expect(String(affected.binding)).not.toContain(a.token);
      expect(
        inspection
          .prepare("SELECT response FROM mutation_receipts WHERE grant_id=?")
          .get(b.grant.grantId)!.response,
      ).not.toBeNull();
    } finally {
      inspection.close();
    }
    reopen();
    expect(() => commit(a.token, body, "policy")).toThrow(AuthorityError);
    expect(release(commit(b.token, otherBody, "policy"))).toEqual(unaffected);
  });

  it("token expiry after commit yields minimal success; a fresh token on unchanged grant can recover candidate", () => {
    const { grant } = issue();
    const token = tokenFor(grant, 1),
      body = input(grant);
    const prepared = commit(token, body, "expired-token");
    now += 1000;
    expect(release(prepared).body).toEqual({
      outcome: "committed",
      representation: "not-included",
    });
    reopen();
    const fresh = tokenFor(grant);
    expect(release(commit(fresh, body, "expired-token")).body.content).toEqual(
      body.content,
    );
  });

  it.each(["before-commit", "after-data-commit"])(
    "does not falsely acknowledge uncertain %s; retry recovers exactly one mutation",
    (point) => {
      const { grant, token } = issue();
      const body = input(grant);
      const before = store.inspectEntries().length;
      failAt = point;
      expect(() => commit(token, body, "failure")).toThrow();
      failAt = undefined;
      reopen();
      expect(store.inspectEntries()).toHaveLength(
        before + (point === "after-data-commit" ? 1 : 0),
      );
      expect(release(commit(token, body, "failure")).body.content).toEqual(
        body.content,
      );
      expect(store.inspectEntries()).toHaveLength(before + 1);
    },
  );

  it("checks token expiry at the last cancellable boundary, but truthfully acknowledges a known commit crossing expiry", () => {
    const { grant } = issue();
    const token = tokenFor(grant, 1),
      body = input(grant);
    const before = store.inspectEntries().length;
    clockBeforeCommit = start + 1000;
    expect(() => commit(token, body, "pre-expiry")).toThrow(AuthorityError);
    expect(store.inspectEntries()).toHaveLength(before);
    const fresh = tokenFor(grant, 1);
    clockAtCommit = now + 1000;
    const known = commit(fresh, body, "slow-commit");
    expect(release(known).body).toEqual({
      outcome: "committed",
      representation: "not-included",
    });
    expect(store.inspectEntries()).toHaveLength(before + 1);
  });

  it("expired original copies use minimal first replies and remain exact expired candidates on eligible retry", () => {
    const { grant, token } = issue();
    const body = input(grant);
    // Copy deadline is shorter than the still-valid token/grant; isolate this release gate.
    const ticket = commit(token, body, "copy");
    now += 1000;
    expect(release(ticket).body).toEqual({
      outcome: "committed",
      representation: "not-included",
    });
    reopen();
    const response = release(commit(tokenFor(grant), body, "copy"));
    expect(Date.parse(response.body.useUntil)).toBe(now);
    expect(response.body.content).toEqual(body.content);
  });

  it("valid revision of expired content is allowed while deleted content cannot revive", () => {
    const { grant, token } = issue();
    const body = input(grant, {
      assertion: {
        declarationType: "person-declared",
        validUntil: new Date(now + 1000).toISOString(),
      },
    });
    const first = release(commit(token, body));
    now += 1000;
    expect(() => commit(token, body)).toThrow();
    const revised = release(
      commit(
        token,
        {
          expectedVersion: 1,
          reason: "fresh statement",
          content: body.content,
          assertion: { declarationType: "person-declared" },
          record: body.record,
        },
        undefined,
        "revise",
        first.body.ref,
      ),
    );
    expect(revised.body.version).toBe(2);
    expect(revised.body.assertion.validUntil).toBeUndefined();
  });

  it("preserves extensions but rejects provider-owned authority and writes outside all category/purpose/reach bounds", () => {
    const { grant, token } = issue();
    const base = input(grant);
    const before = store.inspectEntries().length;
    for (const body of [
      {
        ...base,
        classification: { categories: ["general_preferences", "work_context"] },
      },
      {
        ...base,
        assertion: {
          declarationType: "person-declared",
          permittedPurposes: [PURPOSES[1].code],
        },
      },
      { ...base, record: { ...base.record, version: 8 } },
      {
        ...base,
        record: {
          provenance: {
            ...base.record.provenance,
            authorizedUnder: grant.grantId,
          },
        },
      },
      {
        ...base,
        record: {
          provenance: {
            ...base.record.provenance,
            assertedBy: { id: grant.subject.id, assurance: "authenticated" },
          },
        },
      },
      {
        ...base,
        classification: {
          ...base.classification,
          permittedPurposes: [PURPOSES[0].code],
        },
      },
      { ...base, record: { ...base.record, conversion: { from: "forged" } } },
    ])
      expect(() => commit(token, body, "invalid")).toThrow();
    expect(store.inspectEntries()).toHaveLength(before);
    const extension = { nested: [null, true, 7, "7", { unknown: "kept" }] };
    const good = {
      ...base,
      extension,
      content: { ...base.content, extension },
      assertion: { ...base.assertion, extension },
      evidence: [{ type: "urn:example:opaque", extension }],
      record: { ...base.record, extension },
    };
    const result = release(commit(token, good, "invalid"));
    expect(result.body.content.extension).toEqual(extension);
    const entry = store
      .inspectEntries()
      .find((e) => e.record.provenance.authorizedUnder === grant.grantId)!;
    expect(entry.extension).toEqual(extension);
    expect(entry.record.extension).toEqual(extension);
    const narrowed = issue("a", [
      detail(["read", "write"], { narrowedTo: { entryIds: [entry.id] } }),
    ]);
    expect(() => commit(narrowed.token, input(narrowed.grant))).toThrow(
      AuthorityError,
    );
  });

  it("retains version-bound confirmation history without changing assertion, assurance or immutable content", () => {
    const { grant, token } = issue();
    const body = input(grant);
    const created = release(commit(token, body));
    const entry = store
      .inspectEntries()
      .find((e) => e.record.provenance.authorizedUnder === grant.grantId)!;
    expect(() =>
      authority.confirmEntry(token, entry.id, {
        expectedVersion: 1,
        disposition: "confirmed",
      }),
    ).toThrow(AuthorityError);
    const before = authority.managementEntry(human, entry.id);
    authority.confirmEntry(human, entry.id, {
      expectedVersion: 1,
      disposition: "confirmed",
    });
    const confirmed = authority.managementEntry(human, entry.id);
    expect(confirmed.entry.record.version).toBe(1);
    expect(confirmed.entry.record.provenance.assertedBy).toEqual(
      before.entry.record.provenance.assertedBy,
    );
    expect(confirmed.entry.record.provenance.confirmations).toEqual([
      {
        disposition: "confirmed",
        confirmedBy: { id: entry.subject.id },
        confirmedAt: new Date(now).toISOString(),
      },
    ]);
    expect(confirmed.entry.assertion).toEqual(before.entry.assertion);
    const revised = release(
      commit(
        token,
        {
          expectedVersion: 1,
          reason: "new wording",
          content: body.content,
          record: body.record,
        },
        undefined,
        "revise",
        created.body.ref,
      ),
    );
    expect(revised.body.standing.confirmed).toBe(false);
    const historical = authority.managementEntry(human, entry.id, 1);
    expect(historical.entry.record.provenance.confirmations).toHaveLength(1);
    expect(historical.currentVersion).toBe(2);
    expect(() =>
      authority.confirmEntry(human, entry.id, {
        expectedVersion: 1,
        disposition: "rejected",
      }),
    ).toThrow(/version-conflict/);
    authority.confirmEntry(human, entry.id, {
      expectedVersion: 2,
      disposition: "confirmed",
    });
    authority.confirmEntry(human, entry.id, {
      expectedVersion: 2,
      disposition: "rejected",
    });
    reopen();
    const rejected = authority.managementEntry(human, entry.id);
    expect(rejected.entry.record.status).toBe("deleted");
    expect(
      rejected.entry.record.provenance.confirmations.map(
        (c: any) => c.disposition,
      ),
    ).toEqual(["confirmed", "rejected"]);
    expect(
      project(
        { entry: rejected.entry, categories: ["general_preferences"] },
        new Map([[entry.id, created.body.ref]]),
        now + 1000,
      ).standing.confirmed,
    ).toBe(false);
    expect(() =>
      authority.confirmEntry(human, entry.id, {
        expectedVersion: 2,
        disposition: "confirmed",
      }),
    ).toThrow(AuthorityError);
    const history = authority.audit(human, { entryId: entry.id, limit: 2 });
    expect(history.events).toHaveLength(2);
    expect(history.nextCursor).not.toBeNull();
    expect(() =>
      authority.audit(human, {
        entryId: "urn:uuid:00000000-0000-4000-8000-000000000000",
        cursor: history.nextCursor,
      }),
    ).toThrow();
    expect(
      authority
        .audit(human, { entryId: entry.id, limit: 100 })
        .events.filter((e: any) => e.eventType === "context.confirmed"),
    ).toHaveLength(3);
  });

  it("rolls back a failed confirmation audit and keeps lifecycle and endorsements together on reopen", () => {
    const { grant, token } = issue();
    release(commit(token, input(grant)));
    const entry = store
      .inspectEntries()
      .find((e) => e.record.provenance.authorizedUnder === grant.grantId)!;
    failAt = "before-commit";
    expect(() =>
      authority.confirmEntry(human, entry.id, {
        expectedVersion: 1,
        disposition: "rejected",
      }),
    ).toThrow();
    failAt = undefined;
    reopen();
    const retained = authority.managementEntry(human, entry.id).entry;
    expect(retained.record.status).toBe("active");
    expect(retained.record.provenance.confirmations).toEqual([]);
  });

  it("rejects credential-content evidence and unsupported General Context values without consuming keys", () => {
    const { grant, token } = issue();
    const body = input(grant);
    const before = store.inspectEntries().length;
    const unsupported: any[] = [
      ...[null, false, 42, ["not a top-level object"]].map((value) => ({
        ...body,
        content: { ...body.content, value },
      })),
      {
        ...body,
        evidence: [
          {
            id: "urn:evidence:test",
            type: "urn:example:credential",
            role: "content",
            credential: { opaque: true },
          },
        ],
      },
    ];
    for (const value of unsupported)
      expect(() => commit(token, value, "validation")).toThrow(AuthorityError);
    expect(store.inspectEntries()).toHaveLength(before);
    const valid = release(commit(token, body, "validation"));
    expect(valid.body.version).toBe(1);
    const revision = {
      expectedVersion: 1,
      reason: "new wording",
      content: body.content,
      record: body.record,
      evidence: unsupported.at(-1)!.evidence,
    };
    expect(() =>
      commit(token, revision, "revision-validation", "revise", valid.body.ref),
    ).toThrow(AuthorityError);
    expect(
      release(
        commit(
          token,
          {
            ...revision,
            evidence: [
              { type: "urn:example:opaque", role: "supports", extension: true },
            ],
          },
          "revision-validation",
          "revise",
          valid.body.ref,
        ),
      ).body.version,
    ).toBe(2);
  });

  it("binds human confirmation review to browser, action, expiry and unchanged version/state", () => {
    const { grant, token } = issue();
    release(commit(token, input(grant)));
    const entry = store
      .inspectEntries()
      .find((e) => e.record.provenance.authorizedUnder === grant.grantId)!;
    const inputValue = { expectedVersion: 1, disposition: "confirmed" };
    const reviewed = authority.reviewConfirmation(
      human,
      entry.id,
      inputValue,
      "browser",
    );
    expect(() =>
      authority.approveConfirmation(
        human,
        reviewed.reviewId,
        reviewed.csrf,
        "other-browser",
      ),
    ).toThrow(AuthorityError);
    expect(() =>
      authority.approveConfirmation(
        human,
        reviewed.reviewId,
        "wrong",
        "browser",
      ),
    ).toThrow(AuthorityError);
    authority.confirmEntry(human, entry.id, inputValue);
    expect(() =>
      authority.approveConfirmation(
        human,
        reviewed.reviewId,
        reviewed.csrf,
        "browser",
      ),
    ).toThrow(AuthorityError);
    const fresh = authority.reviewConfirmation(
      human,
      entry.id,
      inputValue,
      "browser",
    );
    authority.approveConfirmation(human, fresh.reviewId, fresh.csrf, "browser");
    expect(() =>
      authority.approveConfirmation(
        human,
        fresh.reviewId,
        fresh.csrf,
        "browser",
      ),
    ).toThrow(AuthorityError);
    const expired = authority.reviewConfirmation(
      human,
      entry.id,
      inputValue,
      "browser",
    );
    now += 600_000;
    expect(() =>
      authority.approveConfirmation(
        human,
        expired.reviewId,
        expired.csrf,
        "browser",
      ),
    ).toThrow(AuthorityError);
  });

  it("keeps known completion when later representation reconciliation fails, while the store remains closed", () => {
    const { grant, token } = issue("a", [detail()], 1);
    const body = input(grant);
    const ticket = commit(token, body, "known");
    now += 1000;
    failAt = "before-commit";
    expect(release(ticket).body).toEqual({
      outcome: "committed",
      representation: "not-included",
    });
    expect(() => commit(token, body, "known")).toThrow();
    failAt = undefined;
    reopen();
    expect(
      store
        .inspectEntries()
        .filter((e) => e.record.provenance.authorizedUnder === grant.grantId),
    ).toHaveLength(1);
    expect(() => commit(token, body, "known")).toThrow(AuthorityError);
  });

  it("requires an exact affirmative person-write review; one-use capability preserves only same-key recovery", () => {
    const request = input({ subject: { id: authority.accountId() } });
    const before = store.inspectEntries().length;
    const reviewed = authority.reviewPersonWrite(
      human,
      "create",
      request,
      undefined,
      "browser",
    );
    expect(store.inspectEntries()).toHaveLength(before);
    expect(() =>
      authority.approvePersonWrite(
        human,
        reviewed.reviewId,
        reviewed.csrf,
        "another-browser",
      ),
    ).toThrow(AuthorityError);
    const capability = authority.approvePersonWrite(
      human,
      reviewed.reviewId,
      reviewed.csrf,
      "browser",
    );
    const raw = JSON.stringify(request);
    expect(() =>
      authority.commitPersonWrite(
        human,
        capability,
        "create",
        { ...request, content: { ...request.content, value: "not approved" } },
        raw,
        "person",
      ),
    ).toThrow(AuthorityError);
    expect(() =>
      authority.commitPersonWrite(
        human,
        capability,
        "create",
        { ...request, extension: true },
        JSON.stringify({ ...request, extension: true }),
        "person",
      ),
    ).toThrow(AuthorityError);
    const first = release(
      authority.commitPersonWrite(
        human,
        capability,
        "create",
        request,
        raw,
        "person",
      ),
    );
    expect(first.body.record.provenance.assertedBy).toEqual({
      id: authority.accountId(),
      assurance: "authenticated",
    });
    expect(first.body.record.provenance.confirmations).toEqual([]);
    const grant = authority
      .listGrants(human)
      .find(
        (g: any) => g.grantId === first.body.record.provenance.authorizedUnder,
      );
    expect(grant.status).toBe("active");
    authority.replacePolicy(human, {
      rules: [{ requires: ["urn:example:required-client-claim"] }],
      directives: [],
    });
    expect(
      authority.listGrants(human).find((g: any) => g.grantId === grant.grantId)
        .status,
    ).toBe("active");
    expect(() =>
      authority.commitPersonWrite(
        human,
        capability,
        "create",
        request,
        raw,
        "another-key",
      ),
    ).toThrow(AuthorityError);
    reopen();
    expect(
      release(
        authority.commitPersonWrite(
          human,
          capability,
          "create",
          request,
          raw,
          "person",
        ),
      ),
    ).toEqual(first);
    expect(store.inspectEntries()).toHaveLength(before + 1);
    authority.revoke(human, grant.grantId);
    expect(() =>
      authority.commitPersonWrite(
        human,
        capability,
        "create",
        request,
        raw,
        "person",
      ),
    ).toThrow(AuthorityError);
  });

  it.each([false, true])(
    "refuses confirmation when a live conflict peer expires before final commit (browser=%s)",
    (browser) => {
      const a = issue();
      const person = input(
        { subject: { id: authority.accountId() } },
        {
          content: modelInput(a.grant, "email").content,
          assertion: {
            declarationType: "person-declared",
            validUntil: new Date(start + 1000).toISOString(),
          },
        },
      );
      const review = authority.reviewPersonWrite(
        human,
        "create",
        person,
        undefined,
        "browser",
      );
      const capability = authority.approvePersonWrite(
        human,
        review.reviewId,
        review.csrf,
        "browser",
      );
      release(
        authority.commitPersonWrite(
          human,
          capability,
          "create",
          person,
          JSON.stringify(person),
          "person",
        ),
      );
      release(commit(a.token, modelInput(a.grant, "phone")));
      const entry = store
        .inspectEntries()
        .find((e) => e.assertion.declarationType === "model-inferred")!;
      const command = { expectedVersion: 1, disposition: "confirmed" };
      const reviewed = browser
        ? authority.reviewConfirmation(human, entry.id, command, "browser")
        : undefined;
      clockBeforeCommit = start + 1000;
      expect(() =>
        browser
          ? authority.approveConfirmation(
              human,
              reviewed.reviewId,
              reviewed.csrf,
              "browser",
            )
          : authority.confirmEntry(human, entry.id, command),
      ).toThrow(AuthorityError);
      expect(
        store.inspectEntry(entry.id)!.record.provenance.confirmations,
      ).toEqual([]);
      expect(store.inspectEntry(entry.id)!.record.status).toBe("conflicted");
      // After reconciliation, the person can still resolve the retained quarantine.
      authority.confirmEntry(human, entry.id, command);
      expect(store.inspectEntry(entry.id)!.record.status).toBe("active");
    },
  );

  it("does not issue a person-write capability after its exact review expires before commit", () => {
    const request = input({ subject: { id: authority.accountId() } });
    const review = authority.reviewPersonWrite(
      human,
      "create",
      request,
      undefined,
      "browser",
    );
    const before = store
      .inspectAudit()
      .filter((e) => e.eventType === "grant.issued").length;
    clockAtBeforeCommit = start + 600_000;
    expect(() =>
      authority.approvePersonWrite(
        human,
        review.reviewId,
        review.csrf,
        "browser",
      ),
    ).toThrow(AuthorityError);
    reopen();
    expect(
      store.inspectAudit().filter((e) => e.eventType === "grant.issued"),
    ).toHaveLength(before);
  });

  it("guards confirmation review/session deadlines before commit and withholds representation after known commit expiry", () => {
    const { grant, token } = issue();
    release(commit(token, input(grant)));
    const entry = store
      .inspectEntries()
      .find((e) => e.record.provenance.authorizedUnder === grant.grantId)!;
    const command = { expectedVersion: 1, disposition: "confirmed" };
    const review = authority.reviewConfirmation(
      human,
      entry.id,
      command,
      "browser",
    );
    clockBeforeCommit = start + 600_000;
    expect(() =>
      authority.approveConfirmation(
        human,
        review.reviewId,
        review.csrf,
        "browser",
      ),
    ).toThrow(AuthorityError);
    expect(
      authority.managementEntry(human, entry.id).entry.record.provenance
        .confirmations,
    ).toEqual([]);
    const anonymous = authority.beginBrowserSession();
    const session = authority.loginBrowser(
      anonymous.token,
      anonymous.csrf,
      human,
    );
    const expiry = now + 12 * 3600_000;
    clockBeforeCommit = expiry;
    expect(() =>
      authority.confirmEntry(session.token, entry.id, command),
    ).toThrow(AuthorityError);
    expect(
      authority.managementEntry(human, entry.id).entry.record.provenance
        .confirmations,
    ).toEqual([]);
    const nextAnonymous = authority.beginBrowserSession();
    const next = authority.loginBrowser(
      nextAnonymous.token,
      nextAnonymous.csrf,
      human,
    );
    clockAtCommit = now + 12 * 3600_000;
    expect(authority.confirmEntry(next.token, entry.id, command)).toEqual({
      outcome: "committed",
      representation: "not-included",
    });
    expect(
      authority.managementEntry(human, entry.id).entry.record.provenance
        .confirmations,
    ).toHaveLength(1);
  });
});
