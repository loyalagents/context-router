import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
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
    purpose:
      grant.access?.find((d: any) => d.actions.includes("write"))?.purposes[0]
        .code ?? PURPOSES[0].code,
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
  it("C8 review: relationship expiry at the last commit check rolls back without closing admission", () => {
    const { grant, token } = issue();
    const body = input(grant);
    const peer = release(
      commit(
        token,
        input(grant, {
          assertion: {
            declarationType: "person-declared",
            validUntil: new Date(start + 1000).toISOString(),
          },
        }),
      ),
    );
    const request = input(grant, {
      content: { ...body.content, value: "Derived after peer expiry" },
      record: {
        ...body.record,
        relationships: [{ type: "derivedFrom", target: peer.body.ref }],
      },
    });
    clockBeforeCommit = start + 1000;
    expect(() => commit(token, request, "expired-peer")).toThrow(
      new AuthorityError("denied"),
    );
    expect(
      store
        .inspectEntries()
        .some((e) => e.content.value === request.content.value),
    ).toBe(false);
    expect(release(commit(token, body)).status).toBe(201);
  });

  it.each([{ relationships: "extension text" }, 7])(
    "C8 review: withdrawal record extension %j cannot poison admission",
    (record) => {
      const { grant, token } = issue();
      const created = release(commit(token, input(grant)));
      const request = { purpose: PURPOSES[0].code, reason: "Withdraw", record };
      const result = release(
        commit(
          token,
          request,
          "withdraw-extension",
          "withdraw",
          created.body.ref,
        ),
      );
      expect(result.status).toBe(200);
      expect(
        release(
          commit(
            token,
            request,
            "withdraw-extension",
            "withdraw",
            created.body.ref,
          ),
        ),
      ).toEqual(result);
      expect(release(commit(token, input(grant))).status).toBe(201);
    },
  );

  it.each([undefined, "held-original"])(
    "C8 review: historical candidate categories remain protected (%s)",
    (key) => {
      const { grant, token } = issue("a", [
        detail(["read", "write"], {
          categories: ["general_preferences", "work_context"],
        }),
      ]);
      const ticket = commit(token, input(grant), key);
      const entry = store
        .inspectEntries()
        .find((e) => e.record.provenance.authorizedUnder === grant.grantId)!;
      authority.editClassification(human, entry.id, "categories", {
        expectedVersion: 1,
        categories: ["work_context"],
      });
      authority.replacePolicy(human, {
        rules: [
          {
            operators: [config.clients[0].operator.id],
            categories: ["general_preferences"],
          },
        ],
        directives: [],
      });
      expect(release(ticket)).toMatchObject({
        status: 200,
        body: { outcome: "committed", representation: "not-included" },
      });
    },
  );

  it.each(["categories", "operators"])(
    "C8 review: changing irrelevant %s selectors preserves an original and retained result",
    (selector) => {
      const { grant, token } = issue();
      const narrow = {
        action: "urn:example:action:a",
        effect: "deny",
        text: "A",
        categories: ["general_preferences"],
        operators: [config.clients[0].operator.id],
      };
      const broad = {
        ...narrow,
        [selector]:
          selector === "categories"
            ? ["general_preferences", "work_context"]
            : config.clients.map((c) => c.operator.id),
      };
      authority.replacePolicy(human, { rules: [], directives: [narrow] });
      const body = input(grant),
        original = release(commit(token, body, "effective-directive"));
      for (const directive of [broad, narrow]) {
        const pending = commit(token, body);
        authority.replacePolicy(human, { rules: [], directives: [directive] });
        expect(release(pending).status).toBe(201);
        expect(release(commit(token, body, "effective-directive"))).toEqual(
          original,
        );
      }
    },
  );

  it("C8 review: a historical reference outside current grant reach does not discard new retained results", () => {
    const { grant, token } = issue();
    const body = input(grant);
    release(commit(token, body, "old-reachable"));
    const entry = store
      .inspectEntries()
      .find((e) => e.record.provenance.authorizedUnder === grant.grantId)!;
    authority.editClassification(human, entry.id, "categories", {
      expectedVersion: 1,
      categories: ["work_context"],
    });
    expect(() => commit(token, body, "old-reachable")).toThrow(AuthorityError);
    const newer = input(grant, {
      content: { ...body.content, value: "Still reachable" },
    });
    const expected = release(commit(token, newer, "new-reachable"));
    authority.editClassification(human, entry.id, "purposes", {
      expectedVersion: 1,
      permittedPurposes: [],
    });
    reopen();
    expect(release(commit(token, newer, "new-reachable"))).toEqual(expected);
    expect(() => commit(token, body, "old-reachable")).toThrow(AuthorityError);
  });

  it.each(["none", "broad", "before", "after"])(
    "C8 recheck: recategorization observes destination directives (%s)",
    (timing) => {
      const { grant, token } = issue("a", [
        detail(["read", "write"], {
          categories: ["general_preferences", "work_context"],
        }),
      ]);
      const directive = {
        action: "urn:example:action:a",
        effect: "ask-first",
        text: "Confirm the action",
        categories:
          timing === "broad"
            ? ["general_preferences", "work_context"]
            : ["work_context"],
      };
      if (["before", "broad"].includes(timing))
        authority.replacePolicy(human, { rules: [], directives: [directive] });
      const ticket = commit(token, input(grant));
      const entry = store
        .inspectEntries()
        .find((e) => e.record.provenance.authorizedUnder === grant.grantId)!;
      authority.editClassification(human, entry.id, "categories", {
        expectedVersion: 1,
        categories: ["work_context"],
      });
      if (timing === "after")
        authority.replacePolicy(human, { rules: [], directives: [directive] });
      expect(release(ticket).status).toBe(
        ["none", "broad"].includes(timing) ? 201 : 200,
      );
    },
  );

  it("C8 requires explicit purpose on every context write before any effect", () => {
    const { grant, token } = issue();
    const body = input(grant, { purpose: PURPOSES[0].code });
    const created = release(commit(token, body));
    const before = store.inspectAudit();
    for (const operation of ["create", "revise", "withdraw"] as const) {
      const request: any =
        operation === "create"
          ? { ...body }
          : operation === "revise"
            ? {
                purpose: PURPOSES[0].code,
                expectedVersion: 1,
                reason: "update",
                content: body.content,
                assertion: body.assertion,
                record: body.record,
              }
            : { purpose: PURPOSES[0].code, reason: "withdraw" };
      for (const purpose of [undefined, null, "", "not a URI"]) {
        const missing = { ...request, purpose };
        if (purpose === undefined) delete missing.purpose;
        expect(() =>
          commit(
            token,
            missing,
            undefined,
            operation,
            operation === "create" ? undefined : created.body.ref,
          ),
        ).toThrow(new AuthorityError("invalid"));
      }
    }
    expect(store.inspectAudit()).toEqual(before);
  });

  it("C8 authorizes the named write purpose and keeps it out of stored metadata", () => {
    const { grant, token } = issue("a", [
      detail(["read"], { purposes: [PURPOSES[0]] }),
      detail(["read", "write"], { purposes: [PURPOSES[1]] }),
    ]);
    const before = store.inspectAudit();
    expect(() =>
      commit(token, input(grant, { purpose: PURPOSES[0].code })),
    ).toThrow(new AuthorityError("denied"));
    expect(store.inspectAudit()).toEqual(before);
    const body = input(grant, {
      purpose: PURPOSES[1].code,
      extension: "retained",
    });
    const result = release(commit(token, body, "named-purpose"));
    expect(result.status).toBe(201);
    const entry = store
      .inspectEntries()
      .find((e) => e.record.provenance.authorizedUnder === grant.grantId)!;
    expect(entry).not.toHaveProperty("purpose");
    expect(entry).toHaveProperty("extension", "retained");
    expect(
      store
        .inspectAudit()
        .find(
          (e) =>
            e.eventType === "context.created" && e.grantId === grant.grantId,
        )?.purpose,
    ).toBe(PURPOSES[1].code);
  });

  it("C8 person review binds the explicitly selected purpose rather than choosing one", () => {
    const { grant } = issue();
    const body: any = input(grant, {
      purpose: PURPOSES[1].code,
      subject: { id: authority.accountId() },
    });
    const review = authority.reviewPersonWrite(
      human,
      "create",
      body,
      undefined,
      "browser",
    );
    expect(review.purpose).toEqual(PURPOSES[1]);
    const capability = authority.approvePersonWrite(
      human,
      review.reviewId,
      review.csrf,
      "browser",
    );
    const changed = { ...body, purpose: PURPOSES[0].code };
    expect(() =>
      authority.commitPersonWrite(
        human,
        capability,
        "create",
        changed,
        JSON.stringify(changed),
        "person-purpose",
      ),
    ).toThrow(AuthorityError);
    const result = release(
      authority.commitPersonWrite(
        human,
        capability,
        "create",
        body,
        JSON.stringify(body),
        "person-purpose",
      ),
    );
    expect(result.body).not.toHaveProperty("purpose");
    expect(
      store
        .inspectAudit()
        .find(
          (e) =>
            e.eventType === "context.created" && e.entryId === result.body.id,
        )?.purpose,
    ).toBe(PURPOSES[1].code);
  });

  it.each([
    { permittedPurposes: [] },
    { permittedPurposes: [PURPOSES[1].code] },
  ])(
    "C8 freezes completion when a create cannot disclose for its named purpose (%j)",
    ({ permittedPurposes }) => {
      const { grant, token } = issue();
      const body = input(grant, {
        assertion: { declarationType: "person-declared", permittedPurposes },
      });
      const before = store.inspectEntries().length;
      const result = release(commit(token, body, "no-use"));
      expect(result).toMatchObject({
        status: 200,
        body: { outcome: "committed", representation: "not-included" },
      });
      expect(Object.keys(result.body)).toHaveLength(2);
      const audit = store
        .inspectAudit()
        .find(
          (e) =>
            e.eventType === "context.created" && e.grantId === grant.grantId,
        )!;
      expect(audit.disclosed).toBeUndefined();
      expect(
        authority.lastPossibleCopyUseUntil(human, grant.grantId),
      ).toBeNull();
      reopen();
      expect(release(commit(token, body, "no-use"))).toEqual(result);
      expect(store.inspectEntries()).toHaveLength(before + 1);
      expect(
        store
          .inspectAudit()
          .filter(
            (e) =>
              e.eventType === "context.created" && e.grantId === grant.grantId,
          ),
      ).toHaveLength(1);
    },
  );

  it("C8 management create with no future uses retains its independently authorized result", () => {
    const { grant } = issue();
    const body = input(grant, {
      subject: { id: authority.accountId() },
      assertion: { declarationType: "person-declared", permittedPurposes: [] },
    });
    const review = authority.reviewPersonWrite(
      human,
      "create",
      body,
      undefined,
      "browser",
    );
    const result = release(
      authority.commitReviewedPersonWrite(
        human,
        review.reviewId,
        review.csrf,
        "browser",
        "managed-no-use",
      ),
    );
    expect(result.status).toBe(201);
    expect(result.body.id).toMatch(/^urn:uuid:/);
    expect(result.body.assertion.permittedPurposes).toEqual([]);
    expect(result.body).not.toHaveProperty("useUntil");
    expect(result.body).not.toHaveProperty("purpose");
  });

  it("C8 exact copy-only expiry returns completion across restart while mismatches deny", () => {
    const { grant, token } = issue();
    const body = input(grant);
    const first = release(commit(token, body, "copy-only"));
    expect(first.status).toBe(201);
    now += 1000;
    reopen();
    const before = store.inspectAudit();
    expect(release(commit(token, body, "copy-only"))).toMatchObject({
      status: 200,
      body: { outcome: "committed", representation: "not-included" },
    });
    expect(() =>
      commit(token, { ...body, extension: true }, "copy-only"),
    ).toThrow(new AuthorityError("denied"));
    expect(store.inspectAudit()).toEqual(before);
    const current = store
      .inspectEntries()
      .find((e) => e.record.provenance.authorizedUnder === grant.grantId)!;
    authority.confirmEntry(human, current.id, {
      expectedVersion: 1,
      disposition: "rejected",
    });
    expect(() => commit(token, body, "copy-only")).toThrow(AuthorityError);
  });

  it.each([undefined, "held-key"])(
    "C8 preserves an unaffected original across a different category's rule change (key=%s)",
    (key) => {
      const { grant, token } = issue("a", [
        detail(["read", "write"], {
          categories: ["general_preferences", "work_context"],
        }),
      ]);
      const body = input(grant),
        ticket = commit(token, body, key);
      const otherAuthority = store.authorization(config, human);
      otherAuthority.replacePolicy(human, {
        rules: [
          {
            operators: [config.clients[0].operator.id],
            categories: ["work_context"],
          },
        ],
        directives: [],
      });
      otherAuthority.replacePolicy(human, { rules: [], directives: [] });
      expect(release(ticket)).toMatchObject({
        status: 201,
        body: { content: body.content },
      });
      if (key) expect(() => commit(token, body, key)).toThrow(AuthorityError);
    },
  );

  it.each(["admission", "handoff"])(
    "C8 authorizes historical relationship targets on a changed-key conflict at %s",
    (boundary) => {
      const { grant, token } = issue();
      const body = input(grant);
      const target = release(commit(token, body));
      const id = store
        .inspectEntries()
        .find((e) => e.record.provenance.authorizedUnder === grant.grantId)!.id;
      const request = input(grant, {
        content: { ...body.content, value: "Derived" },
        record: {
          ...body.record,
          relationships: [{ type: "derivedFrom", target: target.body.ref }],
        },
      });
      release(commit(token, request, "historical-peer"));
      const changed = { ...request, record: body.record };
      const attempt = () => commit(token, changed, "historical-peer");
      let conflict: unknown;
      try {
        attempt();
      } catch (e) {
        conflict = e;
      }
      expect((conflict as Error).message).toBe("idempotency-conflict");
      authority.confirmEntry(human, id, {
        expectedVersion: 1,
        disposition: "rejected",
      });
      if (boundary === "admission")
        expect(attempt).toThrow(new AuthorityError("denied"));
      else
        expect(() => authority.releaseWriteConflict(conflict)).toThrow(
          new AuthorityError("denied"),
        );
    },
  );

  it("C8 person context-write review obeys applicable standing rules", () => {
    const { grant } = issue();
    const body = input(grant, { subject: { id: authority.accountId() } });
    authority.replacePolicy(human, {
      rules: [
        {
          operators: ["https://example.test/operators/synthetic"],
          categories: ["general_preferences"],
        },
      ],
      directives: [],
    });
    const before = store.inspectAudit();
    expect(() =>
      authority.reviewPersonWrite(human, "create", body, undefined, "browser"),
    ).toThrow(new AuthorityError("denied"));
    expect(store.inspectAudit()).toEqual(before);
    expect(authority.managementEntries(human).entries).toBeDefined();
  });

  it("C8 equivalent directive replacement preserves original and retained responses", () => {
    const { grant, token } = issue();
    const directives = [
      {
        action: "urn:example:action:a",
        effect: "deny",
        text: "A",
        categories: ["general_preferences", "work_context"],
      },
      {
        action: "urn:example:action:b",
        effect: "ask-first",
        text: "B",
        operators: [
          config.clients[0].operator.id,
          config.clients[1].operator.id,
        ],
      },
    ];
    authority.replacePolicy(human, { rules: [], directives });
    const body = input(grant),
      original = release(commit(token, body, "directive-noop")),
      pending = commit(token, body);
    authority.replacePolicy(human, {
      directives: directives
        .slice()
        .reverse()
        .map((d) => ({
          ...d,
          ...(d.categories
            ? { categories: d.categories.slice().reverse() }
            : {}),
          ...(d.operators ? { operators: d.operators.slice().reverse() } : {}),
        })),
      rules: [],
    });
    expect(release(pending).status).toBe(201);
    expect(release(commit(token, body, "directive-noop"))).toEqual(original);
  });

  it.each(["general_preferences", "work_context"])(
    "C8 tracks original permissions through deny/restore during rendering (%s)",
    (category) => {
      const { grant, token } = issue("a", [
        detail(["read", "write"], {
          categories: ["general_preferences", "work_context"],
        }),
      ]);
      const body = input(grant),
        ticket = commit(token, body);
      let changed = false,
        result: any;
      authority.releaseWrite(
        ticket,
        (status: number, bytes: string) => {
          result = { status, body: JSON.parse(bytes) };
        },
        (bytes: string) => {
          if (!changed) {
            changed = true;
            authority.replacePolicy(human, {
              rules: [
                {
                  operators: [config.clients[0].operator.id],
                  categories: [category],
                },
              ],
              directives: [],
            });
            authority.replacePolicy(human, { rules: [], directives: [] });
          }
          return bytes;
        },
      );
      expect(result.status).toBe(
        category === "general_preferences" ? 200 : 201,
      );
      if (category === "general_preferences")
        expect(result.body).toEqual({
          outcome: "committed",
          representation: "not-included",
        });
      else expect(result.body.content).toEqual(body.content);
    },
  );

  it("C8 original management disclosure survives execution-grant revocation while retry does not", () => {
    const { grant } = issue();
    const body = input(grant, { subject: { id: authority.accountId() } });
    const review = authority.reviewPersonWrite(
      human,
      "create",
      body,
      undefined,
      "browser",
    );
    const ticket = authority.commitReviewedPersonWrite(
      human,
      review.reviewId,
      review.csrf,
      "browser",
      "management-original",
    );
    authority.replacePolicy(human, {
      rules: [
        {
          operators: ["https://example.test/operators/synthetic"],
          categories: ["general_preferences"],
        },
      ],
      directives: [],
    });
    expect(release(ticket)).toMatchObject({
      status: 201,
      body: { content: body.content },
    });
    expect(() =>
      authority.commitReviewedPersonWrite(
        human,
        review.reviewId,
        review.csrf,
        "browser",
        "management-original",
      ),
    ).toThrow(AuthorityError);
  });

  it("refuses non-Core and provider-owned person writes and classification reviews without issuing review authority", () => {
    const { grant } = issue();
    const personInput = (extra = {}) =>
      input(grant, { subject: { id: authority.accountId() }, ...extra });
    expect(
      authority.reviewPersonWrite(
        human,
        "create",
        personInput(),
        undefined,
        "browser",
      ).reviewId,
    ).toBeTruthy();
    const before = store.inspectAudit();
    for (const extra of [
      { evidence: [{ role: "supports" }] },
      { assertion: { declarationType: "person-declared", basis: { task: 7 } } },
      { content: { ...input(grant).content, language: 7 } },
      ...[5, null, [], ["/credentialSubject/forged"]].map((revealed) => ({
        evidence: [{ role: "supports", type: "urn:example:opaque", revealed }],
      })),
    ])
      expect(() =>
        authority.reviewPersonWrite(
          human,
          "create",
          personInput(extra),
          undefined,
          "browser",
        ),
      ).toThrow();
    const entry = store.inspectEntries()[0];
    expect(() =>
      authority.reviewClassification(
        human,
        entry.id,
        "purposes",
        {
          expectedVersion: entry.record.version,
          permittedPurposes: [PURPOSES[0].code, "x:"],
        },
        "browser",
      ),
    ).toThrow();
    expect(store.inspectAudit()).toEqual(before);
    expect(authority.isManagement(human)).toBe(true);
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

  it.each(["confirmed", "rejected"])(
    "records hidden conflict candidates before human %s and keeps contradictory inferences unreadable after reopen",
    (disposition) => {
      const a = issue();
      const personBody = modelInput(a.grant, "email");
      personBody.assertion = { declarationType: "person-declared" };
      personBody.record = { provenance: { source: "person-input" } };
      release(commit(a.token, personBody));
      const person = store
        .inspectEntries()
        .find((e) => e.content.value?.value === "email")!;
      release(commit(a.token, modelInput(a.grant, "phone", "one")));
      const review = authority.reviewConfirmation(
        human,
        person.id,
        { expectedVersion: 1, disposition },
        "browser",
      );
      release(commit(a.token, modelInput(a.grant, "fax", "two")));
      expect(() =>
        authority.approveConfirmation(
          human,
          review.reviewId,
          review.csrf,
          "browser",
        ),
      ).toThrow(AuthorityError);
      const fax = store
        .inspectEntries()
        .find((e) => e.content.value?.value === "fax")!;
      expect(fax.record.status).toBe("conflicted");
      expect(authority.managementEntry(human, fax.id).conflicts).toHaveLength(
        2,
      );
      reopen();
      const fresh = authority.reviewConfirmation(
        human,
        person.id,
        { expectedVersion: 1, disposition },
        "browser",
      );
      expect(fresh.conflicts).toHaveLength(2);
      authority.approveConfirmation(
        human,
        fresh.reviewId,
        fresh.csrf,
        "browser",
      );
      reopen();
      expect(store.inspectEntry(person.id)!.record.status).toBe(
        disposition === "confirmed" ? "active" : "deleted",
      );
      for (const value of ["phone", "fax"]) {
        const entry = store
          .inspectEntries()
          .find((e) => e.content.value?.value === value)!;
        expect(entry.record.status).toBe("conflicted");
        const read = authority.prepareRead(a.token, "query", {
          query: value,
          purpose: PURPOSES[0].code,
        });
        authority.releaseRead(read, (bytes: string) =>
          expect(JSON.parse(bytes).entries).toEqual([]),
        );
      }
    },
  );

  it("rolls back new quarantined-candidate edges with their mutation and audit", () => {
    const a = issue();
    const personBody = modelInput(a.grant, "email");
    personBody.assertion = { declarationType: "person-declared" };
    personBody.record = { provenance: { source: "person-input" } };
    release(commit(a.token, personBody));
    release(commit(a.token, modelInput(a.grant, "phone", "one")));
    const before = store.inspectEntries(),
      events = store.inspectAudit();
    failAt = "before-audit";
    expect(() =>
      commit(a.token, modelInput(a.grant, "fax", "two"), "third"),
    ).toThrow("synthetic failure");
    failAt = undefined;
    reopen();
    expect(store.inspectEntries()).toEqual(before);
    expect(store.inspectAudit()).toEqual(events);
    release(commit(a.token, modelInput(a.grant, "fax", "two"), "third"));
    expect(
      store.inspectEntries().find((e) => e.content.value?.value === "fax")!
        .record.status,
    ).toBe("conflicted");
  });

  it("supersedes the same model's quarantined earlier inference without hiding its new conflict", () => {
    const a = issue();
    const personBody = modelInput(a.grant, "email");
    personBody.assertion = { declarationType: "person-declared" };
    personBody.record = { provenance: { source: "person-input" } };
    release(commit(a.token, personBody));
    release(commit(a.token, modelInput(a.grant, "phone", "same")));
    release(commit(a.token, modelInput(a.grant, "fax", "same")));
    const old = store
      .inspectEntries()
      .find((e) => e.content.value?.value === "phone")!;
    const fresh = store
      .inspectEntries()
      .find((e) => e.content.value?.value === "fax")!;
    expect(old.record.status).toBe("deprecated");
    expect(fresh.record.status).toBe("conflicted");
    reopen();
    expect(store.inspectEntry(old.id)!.record.status).toBe("deprecated");
    expect(store.inspectEntry(fresh.id)!.record.status).toBe("conflicted");
  });

  it.each(["create", "revise"])(
    "freezes a supported permitted purpose in a reviewed person %s",
    (operation) => {
      const a = issue("a", [
        detail(["read", "write"], { purposes: [PURPOSES[1]] }),
      ]);
      const body = input(a.grant, {
        assertion: {
          declarationType: "person-declared",
          permittedPurposes: [PURPOSES[1].code],
        },
      });
      let target: string | undefined;
      if (operation === "revise") {
        release(commit(a.token, body));
        target = store
          .inspectEntries()
          .find(
            (e) => e.record.provenance.authorizedUnder === a.grant.grantId,
          )!.id;
      }
      const request =
        operation === "create"
          ? { ...body, subject: { id: authority.accountId() } }
          : {
              purpose: body.purpose,
              expectedVersion: 1,
              reason: "Person correction",
              content: { ...body.content, value: "Updated work statement" },
              assertion: body.assertion,
              record: body.record,
            };
      const review = authority.reviewPersonWrite(
        human,
        operation,
        request,
        target,
        "browser",
      );
      expect(review.purpose).toEqual(PURPOSES[1]);
      reopen();
      const capability = authority.approvePersonWrite(
        human,
        review.reviewId,
        review.csrf,
        "browser",
      );
      const result = release(
        authority.commitPersonWrite(
          human,
          capability,
          operation,
          request,
          JSON.stringify(request),
          "purpose-edit",
          target,
        ),
      );
      expect(result.status).toBe(201);
      const written = store.inspectEntry(result.body.id)!;
      const grant = authority.ownGrant(
        written.record.provenance.authorizedUnder,
        "urn:context-router:synthetic-management",
      ).grants[0];
      expect(grant.access[0].purposes).toEqual([PURPOSES[1]]);
      expect(written.assertion.permittedPurposes).toEqual([PURPOSES[1].code]);
    },
  );

  it("does not bypass a new assertion with no supported purpose", () => {
    const a = issue("a", [
      detail(["read", "write"], { purposes: [PURPOSES[1]] }),
    ]);
    const body = input(a.grant, {
      assertion: {
        declarationType: "person-declared",
        permittedPurposes: [PURPOSES[1].code],
      },
    });
    release(commit(a.token, body));
    const entry = store
      .inspectEntries()
      .find((e) => e.record.provenance.authorizedUnder === a.grant.grantId)!;
    for (const permittedPurposes of [[], ["urn:example:unsupported-purpose"]]) {
      const request = {
        purpose: body.purpose,
        expectedVersion: 1,
        reason: "Person correction",
        content: body.content,
        assertion: { declarationType: "person-declared", permittedPurposes },
        record: body.record,
      };
      expect(() =>
        authority.reviewPersonWrite(
          human,
          "revise",
          request,
          entry.id,
          "browser",
        ),
      ).toThrow(AuthorityError);
      expect(authority.managementEntry(human, entry.id).currentVersion).toBe(1);
    }
  });

  it("allows an exact reviewed person correction under a new purpose while context writes retain the old restriction", () => {
    const a = issue("a", [
      detail(["read", "write"], { purposes: [PURPOSES[1]] }),
    ]);
    const body = input(a.grant, {
      assertion: {
        declarationType: "person-declared",
        permittedPurposes: [PURPOSES[1].code],
      },
    });
    const result = release(commit(a.token, body));
    const entry = store
      .inspectEntries()
      .find((e) => e.record.provenance.authorizedUnder === a.grant.grantId)!;
    const request = {
      purpose: PURPOSES[0].code,
      expectedVersion: 1,
      reason: "Person correction",
      content: body.content,
      assertion: {
        declarationType: "person-declared",
        permittedPurposes: [PURPOSES[0].code],
      },
      record: body.record,
    };
    expect(() =>
      commit(a.token, request, "context-correction", "revise", result.body.ref),
    ).toThrow();
    const review = authority.reviewPersonWrite(
      human,
      "revise",
      request,
      entry.id,
      "browser",
    );
    expect(review.purpose).toEqual(PURPOSES[0]);
    const ticket = authority.commitReviewedPersonWrite(
      human,
      review.reviewId,
      review.csrf,
      "browser",
      "person-correction",
    );
    expect(release(ticket).body.assertion.permittedPurposes).toEqual([
      PURPOSES[0].code,
    ]);
    expect(
      store.inspectEntry(entry.id, 1)!.assertion.permittedPurposes,
    ).toEqual([PURPOSES[1].code]);
  });
  it("does not let a person correction bypass the current principal purpose restriction", () => {
    const a = issue(),
      body = input(a.grant),
      result = release(commit(a.token, body));
    const e = store
      .inspectEntries()
      .find((e) => e.record.provenance.authorizedUnder === a.grant.grantId)!;
    authority.editClassification(human, e.id, "purposes", {
      expectedVersion: 1,
      permittedPurposes: [PURPOSES[1].code],
    });
    const request = {
      purpose: body.purpose,
      expectedVersion: 1,
      reason: "Correction",
      content: body.content,
      assertion: {
        declarationType: "person-declared",
        permittedPurposes: [PURPOSES[0].code],
      },
      record: body.record,
    };
    expect(() =>
      authority.reviewPersonWrite(human, "revise", request, e.id, "browser"),
    ).toThrow(AuthorityError);
    expect(store.inspectEntry(e.id)!.record.version).toBe(1);
  });

  it.each(["issuer-attested", "credential-profile"])(
    "refuses an otherwise valid person correction of retained %s content",
    (kind) => {
      const a = issue("a", [
        detail(["read", "write"], { purposes: [PURPOSES[1]] }),
      ]);
      const body = input(a.grant, {
        assertion: {
          declarationType: "person-declared",
          permittedPurposes: [PURPOSES[1].code],
        },
      });
      release(commit(a.token, body));
      const original = store
        .inspectEntries()
        .find((e) => e.record.provenance.authorizedUnder === a.grant.grantId)!;
      const request = {
        purpose: "https://example.test/purpose/synthetic-review",
        expectedVersion: 1,
        reason: "Exact person correction under a new purpose",
        content: { ...body.content, value: "Corrected person statement" },
        assertion: {
          declarationType: "person-declared",
          permittedPurposes: [PURPOSES[0].code],
        },
        record: body.record,
      };
      // The same request is reviewable for a retained General Context person entry.
      expect(
        authority.reviewPersonWrite(
          human,
          "revise",
          request,
          original.id,
          "browser",
        ).reviewId,
      ).toEqual(expect.any(String));
      const retained: any = structuredClone(original);
      retained.id = `urn:uuid:${randomUUID()}`;
      if (kind === "issuer-attested") {
        retained.assertion.declarationType = "issuer-attested";
        retained.record.provenance.assertedBy = {
          id: "https://issuer.example.test",
          assurance: "cryptographically-verified",
        };
      } else {
        retained.content = {
          profile: "https://hcp.example/spec/profiles/credential/2.0",
          value: { type: "SyntheticCredential", credential: "fixture-only" },
        };
      }
      // Public admission deliberately excludes these records. Insert a controlled
      // retained fixture to exercise the person-editor guard, without changing any
      // existing immutable assertion, schema trigger, or production admission path.
      store.close();
      const fixtureDb = new DatabaseSync(
        path.join(paths().root, "entries.sqlite"),
      );
      try {
        fixtureDb.exec("PRAGMA foreign_keys=ON; BEGIN");
        fixtureDb
          .prepare(
            "INSERT INTO entries(id,subject,current_version,classification,status) VALUES(?,?,?,?,?)",
          )
          .run(
            retained.id,
            JSON.stringify(retained.subject),
            1,
            JSON.stringify(retained.classification),
            retained.record.status,
          );
        fixtureDb
          .prepare(
            "INSERT INTO entry_versions(entry_id,version,document,valid_until) VALUES(?,?,?,?)",
          )
          .run(retained.id, 1, JSON.stringify(retained), null);
        fixtureDb.exec("COMMIT");
      } finally {
        fixtureDb.close();
      }
      reopen();
      const entries = store.inspectEntries(),
        audit = store.inspectAudit();
      const grants = authority.listGrants(human, "all");
      expect(() =>
        authority.reviewPersonWrite(
          human,
          "revise",
          request,
          retained.id,
          "browser",
        ),
      ).toThrow(AuthorityError);
      expect(store.inspectEntries()).toEqual(entries);
      expect(store.inspectEntry(retained.id, 2)).toBeUndefined();
      expect(store.inspectAudit()).toEqual(audit);
      expect(authority.listGrants(human, "all")).toEqual(grants);
    },
  );

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
      purpose: "https://example.test/purpose/synthetic-review",
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

  it.each([false, true])(
    "settles repeated same-model client contradictions in the write transaction (detector=%s)",
    (detected) => {
      const a = issue(),
        old = modelInput(a.grant, "email"),
        next = modelInput(a.grant, "phone");
      if (!detected) {
        old.content.value = "Opaque email claim" as any;
        next.content.value = "Opaque phone claim" as any;
      }
      const first = release(commit(a.token, old));
      const relationships = [
        { type: "contradicts", target: first.body.ref },
        {
          type: "contradicts",
          target: first.body.ref,
          extension: "second independent assertion",
        },
      ];
      release(
        commit(a.token, { ...next, record: { ...next.record, relationships } }),
      );
      const entries = store
        .inspectEntries()
        .filter((e) => e.assertion.declarationType === "model-inferred");
      expect(entries.map((e) => e.record.status).sort()).toEqual([
        "active",
        "deprecated",
      ]);
      for (const entry of entries)
        expect(authority.managementEntry(human, entry.id).conflicts).toEqual(
          [],
        );
      expect(
        store
          .inspectAudit()
          .filter(
            (e) =>
              e.eventType === "conflict.resolved" &&
              e.data.transition === "asserter-superseded",
          ),
      ).toHaveLength(detected ? 3 : 2);
    },
  );

  it("keeps a quarantined create completion-only on its original response and exact recovery", () => {
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
    expect(result).toMatchObject({
      status: 200,
      body: { outcome: "committed", representation: "not-included" },
    });
    const entry = store
      .inspectEntries()
      .find((e) => e.assertion.declarationType === "model-inferred")!;
    expect(entry.record.status).toBe("conflicted");
    expect(release(commit(a.token, body, "model"))).toEqual(result);
    expect(() =>
      authority.prepareRead(
        a.token,
        "get",
        { purpose: PURPOSES[0].code },
        "r_undisclosed",
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
        {
          purpose: "https://example.test/purpose/synthetic-review",
          reason: "Person statement withdrawn",
        },
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
      purpose: "https://example.test/purpose/synthetic-review",
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
      purpose: "https://example.test/purpose/synthetic-review",
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
      purpose: "https://example.test/purpose/synthetic-review",
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
        {
          purpose: "https://example.test/purpose/synthetic-review",
          reason: "withdraw",
        },
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
        {
          purpose: "https://example.test/purpose/synthetic-review",
          reason: "foreign ref",
        },
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
      status: 200,
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

  it("keeps assertion-purpose invalidation after restoration and restart without affecting another purpose", () => {
    const a = issue("a", [
        detail(["read", "write"], { purposes: [PURPOSES[1]] }),
      ]),
      b = issue("b"),
      body = input(a.grant),
      otherBody = input(b.grant),
      original = commit(a.token, body, "assertion-purpose"),
      unaffected = release(commit(b.token, otherBody, "assertion-purpose"));
    const entry = store
      .inspectEntries()
      .find((e) => e.record.provenance.authorizedUnder === a.grant.grantId)!;
    // Give B a reference to the same entry, so it is an actual unaffected context.
    const read = authority.prepareRead(b.token, "query", {
      query: "private C4 statement",
      purpose: PURPOSES[0].code,
    });
    authority.releaseRead(read, () => {});
    const preparedReplay = commit(a.token, body, "assertion-purpose");
    for (const [index, permittedPurposes] of [
      [PURPOSES[0].code],
      undefined,
    ].entries()) {
      const request = {
        purpose: PURPOSES[0].code,
        expectedVersion: index + 1,
        reason: "Person purpose correction",
        content: body.content,
        assertion: {
          declarationType: "person-declared",
          ...(permittedPurposes ? { permittedPurposes } : {}),
        },
        record: body.record,
      };
      const review = authority.reviewPersonWrite(
        human,
        "revise",
        request,
        entry.id,
        "browser",
      );
      release(
        authority.commitReviewedPersonWrite(
          human,
          review.reviewId,
          review.csrf,
          "browser",
          `purpose-${index}`,
        ),
      );
    }
    expect(release(original).body).toEqual({
      outcome: "committed",
      representation: "not-included",
    });
    expect(() => release(preparedReplay)).toThrow(new AuthorityError("denied"));
    reopen();
    const audit = store.inspectAudit();
    expect(() => commit(a.token, body, "assertion-purpose")).toThrow(
      new AuthorityError("denied"),
    );
    expect(release(commit(b.token, otherBody, "assertion-purpose"))).toEqual(
      unaffected,
    );
    expect(store.inspectAudit()).toEqual(audit);
  });

  it.each(["categories", "purposes"])(
    "preserves replay across equivalent %s updates",
    (kind) => {
      const { grant, token } = issue("a", [
        detail(["read", "write"], {
          categories: ["general_preferences", "work_context"],
        }),
      ]);
      const body = input(grant, {
        classification: { categories: ["general_preferences", "work_context"] },
      });
      const original = release(commit(token, body, "unchanged"));
      const entry = store
        .inspectEntries()
        .find((e) => e.record.provenance.authorizedUnder === grant.grantId)!;
      authority.editClassification(human, entry.id, kind, {
        expectedVersion: 1,
        ...(kind === "categories"
          ? { categories: ["work_context", "general_preferences"] }
          : { permittedPurposes: null }),
      });
      reopen();
      expect(release(commit(token, body, "unchanged"))).toEqual(original);
    },
  );

  it.each(["copy", "token"])(
    "classifies a %s deadline crossing at the last replay handoff",
    (deadline) => {
      const { grant } = issue();
      const token = tokenFor(grant, deadline === "token" ? 1 : 3600),
        body = input(grant);
      release(commit(token, body, "boundary"));
      const ticket = commit(token, body, "boundary");
      const representation = authority.writeRepresentation.bind(authority);
      authority.writeRepresentation = (...args: any[]) => {
        const result = representation(...args);
        now = start + 1000;
        return result;
      };
      if (deadline === "token")
        expect(() => release(ticket)).toThrow(
          new AuthorityError("unauthenticated"),
        );
      else
        expect(release(ticket)).toMatchObject({
          status: 200,
          body: { outcome: "committed", representation: "not-included" },
        });
    },
  );

  it.each(
    ["revise", "relationship"].flatMap((kind) =>
      ["rejected", "deleted"].flatMap((state) =>
        ["admission", "handoff"].map((boundary) => ({ kind, state, boundary })),
      ),
    ),
  )(
    "checks the attempted $kind target when $state at conflict $boundary",
    ({ kind, state, boundary }) => {
      const { grant, token } = issue(),
        body = input(grant);
      release(commit(token, body, "historical-key"));
      const target = release(
        commit(
          token,
          input(grant, {
            content: { ...body.content, value: "Other synthetic target" },
          }),
          "target-key",
        ),
      );
      const id = store
        .inspectEntries()
        .find((e) => e.content.value === "Other synthetic target")!.id;
      const request =
        kind === "revise"
          ? {
              purpose: body.purpose,
              expectedVersion: 1,
              content: body.content,
              reason: "Correction",
              record: body.record,
            }
          : {
              ...body,
              record: {
                ...body.record,
                relationships: [
                  { type: "derivedFrom", target: target.body.ref },
                ],
              },
            };
      const attempt = () =>
        commit(
          token,
          request,
          "historical-key",
          kind === "revise" ? "revise" : "create",
          kind === "revise" ? target.body.ref : undefined,
        );
      const conflict = () => {
        try {
          attempt();
        } catch (error) {
          return error;
        }
        throw new Error("Expected a historical conflict");
      };
      const live = conflict();
      expect((live as Error).message).toBe("idempotency-conflict");
      expect(() => authority.releaseWriteConflict(live)).not.toThrow();
      const prepared = boundary === "handoff" ? conflict() : undefined;
      if (state === "rejected")
        authority.confirmEntry(human, id, {
          expectedVersion: 1,
          disposition: "rejected",
        });
      else
        release(
          commit(
            token,
            {
              purpose: "https://example.test/purpose/synthetic-review",
              reason: "Withdraw target",
            },
            "withdraw-target",
            "withdraw",
            target.body.ref,
          ),
        );
      const audit = store.inspectAudit();
      if (boundary === "admission")
        expect(attempt).toThrow(new AuthorityError("denied"));
      else
        expect(() => authority.releaseWriteConflict(prepared)).toThrow(
          new AuthorityError("denied"),
        );
      expect(store.inspectAudit()).toEqual(audit);
    },
  );

  it.each(
    ["rejected", "deleted"].flatMap((state) =>
      ["admission", "handoff"].map((boundary) => ({ state, boundary })),
    ),
  )(
    "checks an exact retry's related target when $state at $boundary",
    ({ state, boundary }) => {
      const { grant, token } = issue(),
        body = input(grant);
      const target = release(commit(token, body, "related-target"));
      const id = store
        .inspectEntries()
        .find((e) => e.record.provenance.authorizedUnder === grant.grantId)!.id;
      const request = input(grant, {
        content: { ...body.content, value: "Derived synthetic statement" },
        record: {
          ...body.record,
          relationships: [{ type: "derivedFrom", target: target.body.ref }],
        },
      });
      const original = release(commit(token, request, "exact-related"));
      expect(release(commit(token, request, "exact-related"))).toEqual(
        original,
      );
      const prepared =
        boundary === "handoff"
          ? commit(token, request, "exact-related")
          : undefined;
      if (state === "rejected")
        authority.confirmEntry(human, id, {
          expectedVersion: 1,
          disposition: "rejected",
        });
      else
        release(
          commit(
            token,
            {
              purpose: "https://example.test/purpose/synthetic-review",
              reason: "Withdraw target",
            },
            "withdraw-related",
            "withdraw",
            target.body.ref,
          ),
        );
      const audit = store.inspectAudit();
      if (prepared)
        expect(() => release(prepared)).toThrow(new AuthorityError("denied"));
      reopen();
      expect(() => commit(token, request, "exact-related")).toThrow(
        new AuthorityError("denied"),
      );
      expect(store.inspectAudit()).toEqual(audit);
    },
  );

  it("does not revive an unreadable superseded relationship target through exact retry", () => {
    const { grant, token } = issue(),
      body = input(grant);
    const target = release(commit(token, body, "superseded-target"));
    const request = input(grant, {
      content: { ...body.content, value: "Replacement synthetic statement" },
      record: {
        ...body.record,
        relationships: [{ type: "supersedes", target: target.body.ref }],
      },
    });
    expect(release(commit(token, request, "exact-supersedes")).status).toBe(
      201,
    );
    const audit = store.inspectAudit();
    expect(() => commit(token, request, "exact-supersedes")).toThrow(
      new AuthorityError("denied"),
    );
    expect(store.inspectAudit()).toEqual(audit);
  });

  it("authorizes the original receipt before revealing a changed-body key conflict", () => {
    const a = issue("a", [
      detail(["read", "write"], {
        categories: ["general_preferences", "work_context"],
      }),
    ]);
    const body = input(a.grant),
      changed = input(a.grant, {
        classification: { categories: ["work_context"] },
      });
    release(commit(a.token, body, "receipt"));
    expect(() => commit(a.token, changed, "receipt")).toThrow(
      "idempotency-conflict",
    );
    authority.replacePolicy(human, {
      rules: [
        {
          operators: [config.clients[0].operator.id],
          categories: ["general_preferences"],
        },
      ],
      directives: [],
    });
    expect(() => commit(a.token, changed, "receipt")).toThrow(
      new AuthorityError("denied"),
    );
    authority.replacePolicy(human, { rules: [], directives: [] });
    reopen();
    expect(() => commit(a.token, changed, "receipt")).toThrow(
      new AuthorityError("denied"),
    );
    // Lifecycle denial is independent of sticky permission invalidation.
    const fresh = release(commit(a.token, body, "lifecycle"));
    release(
      commit(
        a.token,
        { purpose: PURPOSES[0].code, expectedVersion: 1, reason: "withdraw" },
        undefined,
        "withdraw",
        fresh.body.ref,
      ),
    );
    expect(() => commit(a.token, changed, "lifecycle")).toThrow(
      new AuthorityError("denied"),
    );
  });

  it("token and copy expiry yield minimal success; a fresh token cannot extend the original copy", () => {
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
    expect(release(commit(fresh, body, "expired-token"))).toMatchObject({
      status: 200,
      body: { outcome: "committed", representation: "not-included" },
    });
  });

  it("replays a still-live candidate under a refreshed unchanged grant after original minimal completion", () => {
    const { grant } = issue();
    now += 500;
    const token = tokenFor(grant, 1),
      body = input(grant),
      before = store.inspectEntries().length;
    const prepared = commit(token, body, "short-token-live-copy");
    now += 500; // Token expires at the second boundary; the copy has 500 ms left.
    expect(release(prepared).body).toEqual({
      outcome: "committed",
      representation: "not-included",
    });
    reopen();
    const fresh = tokenFor(grant),
      events = store.inspectAudit(),
      replay = release(commit(fresh, body, "short-token-live-copy"));
    expect(replay.status).toBe(201);
    expect(replay.body.content).toEqual(body.content);
    expect(replay.body.useUntil).toBe(new Date(start + 1500).toISOString());
    expect(replay.body.ref).toMatch(/^r_/);
    expect(replay.body.id).toBeUndefined();
    expect(store.inspectEntries()).toHaveLength(before + 1);
    expect(store.inspectAudit()).toEqual(events);
    now += 500;
    expect(release(commit(fresh, body, "short-token-live-copy"))).toMatchObject(
      {
        status: 200,
        body: { outcome: "committed", representation: "not-included" },
      },
    );
    expect(store.inspectAudit()).toEqual(events);
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

  it("expired original copies use minimal original and exact retry replies without repeating the write", () => {
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
    const events = store.inspectAudit();
    expect(release(commit(tokenFor(grant), body, "copy"))).toMatchObject({
      status: 200,
      body: { outcome: "committed", representation: "not-included" },
    });
    expect(store.inspectAudit()).toEqual(events);
  });
  it("checks the original copy deadline again when releasing an already prepared retry", () => {
    const { grant, token } = issue(),
      body = input(grant);
    release(commit(token, body, "retry-copy"));
    now += 500;
    const prepared = commit(token, body, "retry-copy"),
      events = store.inspectAudit();
    now += 500;
    expect(release(prepared)).toMatchObject({
      status: 200,
      body: { outcome: "committed", representation: "not-included" },
    });
    expect(store.inspectAudit()).toEqual(events);
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
          purpose: body.purpose,
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
      { ...base, purpose: PURPOSES[1].code },
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
      subject: { ...base.subject, extension },
      content: { ...base.content, extension },
      assertion: { ...base.assertion, extension },
      evidence: [{ role: "supports", type: "urn:example:opaque", extension }],
      record: {
        ...base.record,
        extension,
        provenance: {
          ...base.record.provenance,
          assertedBy: { id: base.subject.id, extension },
        },
      },
    };
    const result = release(commit(token, good, "invalid"));
    expect(result.body.content.extension).toEqual(extension);
    const entry = store
      .inspectEntries()
      .find((e) => e.record.provenance.authorizedUnder === grant.grantId)!;
    expect(entry.extension).toEqual(extension);
    expect(entry.record.extension).toEqual(extension);
    expect(entry.subject.extension).toEqual(extension);
    expect(entry.record.provenance.assertedBy.extension).toEqual(extension);
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
          purpose: body.purpose,
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

  it("rejects credential-content/provider-owned evidence and unsupported General Context values without consuming keys", () => {
    const { grant, token } = issue();
    const body = input(grant);
    const before = store.inspectEntries().length;
    const unsupported: any[] = [
      ...[null, false, 42, ["not a top-level object"]].map((value) => ({
        ...body,
        content: { ...body.content, value },
      })),
      ...[5, null, [], ["/credentialSubject/forged"]].map((revealed) => ({
        ...body,
        evidence: [{ role: "supports", type: "urn:example:opaque", revealed }],
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
      purpose: body.purpose,
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

  it("replays a historical confidence proposal after a readable target changes asserter", () => {
    const { grant, token } = issue(),
      body = input(grant);
    const target = release(commit(token, body, "proposal-target"));
    const id = store
      .inspectEntries()
      .find((e) => e.record.provenance.authorizedUnder === grant.grantId)!.id;
    const request = input(
      { subject: { id: authority.accountId() } },
      {
        content: { ...body.content, value: "Historical person statement" },
        record: {
          ...body.record,
          relationships: [
            {
              type: "contradicts",
              target: id,
              proposal: {
                act: "reject",
                entry: id,
                rationale: "Synthetic historical comparison",
                weighed: ["confidence"],
              },
            },
          ],
        },
      },
    );
    const review = authority.reviewPersonWrite(
      human,
      "create",
      request,
      undefined,
      "browser",
    );
    const capability = authority.approvePersonWrite(
      human,
      review.reviewId,
      review.csrf,
      "browser",
    );
    const retry = () =>
      authority.commitPersonWrite(
        human,
        capability,
        "create",
        request,
        JSON.stringify(request),
        "historical-proposal",
      );
    const original = release(retry());
    const revised = modelInput(grant, "unrelated target", "two");
    release(
      commit(
        token,
        {
          purpose: "https://example.test/purpose/synthetic-review",
          expectedVersion: 1,
          reason: "New model assertion",
          content: revised.content,
          assertion: revised.assertion,
          record: revised.record,
        },
        "new-asserter",
        "revise",
        target.body.ref,
      ),
    );
    expect(
      authority.managementEntry(human, id).entry.record.provenance.assertedBy
        .id,
    ).not.toBe(original.body.record.provenance.assertedBy.id);
    const audit = store.inspectAudit();
    expect(release(retry())).toEqual(original);
    expect(store.inspectAudit()).toEqual(audit);
  });

  it("retains authorized management recovery after assertion expiry and one-use approval consumption", () => {
    const request = input(
      { subject: { id: authority.accountId() } },
      {
        assertion: {
          declarationType: "person-declared",
          validUntil: new Date(start + 1000).toISOString(),
        },
      },
    );
    const review = authority.reviewPersonWrite(
      human,
      "create",
      request,
      undefined,
      "browser",
    );
    const capability = authority.approvePersonWrite(
      human,
      review.reviewId,
      review.csrf,
      "browser",
    );
    const retry = () =>
      authority.commitPersonWrite(
        human,
        capability,
        "create",
        request,
        JSON.stringify(request),
        "management-expired-assertion",
      );
    const original = release(retry());
    now = start + 1000;
    reopen();
    const audit = store.inspectAudit();
    expect(release(retry())).toEqual(original);
    expect(store.inspectAudit()).toEqual(audit);
    expect(store.inspectEntry(original.body.id)!.record.status).toBe("expired");
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
      authority
        .listGrants(human, "all")
        .find((g: any) => g.grantId === grant.grantId).status,
    ).toBe("revoked");
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
    expect(
      authority.managementEntry(human, first.body.id).entry.content,
    ).toEqual(request.content);
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

  it("rejects a supplied noncanonical context without reserving the write key", () => {
    const a = issue(),
      body = input(a.grant);
    for (const context of [
      "bogus",
      ["https://invalid.example/context"],
      [],
      null,
    ])
      expect(() =>
        commit(a.token, { ...body, "@context": context }, "context"),
      ).toThrow(AuthorityError);
    const created = release(
      commit(
        a.token,
        { ...body, "@context": ["https://hcp.example/contexts/v2"] },
        "context",
      ),
    );
    const revised = {
      purpose: body.purpose,
      expectedVersion: 1,
      reason: "context correction",
      content: body.content,
      assertion: body.assertion,
      record: body.record,
    };
    expect(() =>
      commit(
        a.token,
        { ...revised, "@context": ["https://invalid.example/context"] },
        "context-revision",
        "revise",
        created.body.ref,
      ),
    ).toThrow(AuthorityError);
    release(
      commit(
        a.token,
        { ...revised, "@context": ["https://hcp.example/contexts/v2"] },
        "context-revision",
        "revise",
        created.body.ref,
      ),
    );
    expect(
      store
        .inspectEntries()
        .find((e) => e.record.provenance.authorizedUnder === a.grant.grantId)![
        "@context"
      ],
    ).toEqual(["https://hcp.example/contexts/v2"]);
  });

  it.each(["unchanged", "confirmation", "peer"])(
    "reuses a failed person approval only while its reviewed state is unchanged (%s)",
    (change) => {
      const a = issue();
      const body = input(a.grant, {
        content: modelInput(a.grant, "email").content,
      });
      release(commit(a.token, body));
      const entry = store
        .inspectEntries()
        .find((e) => e.record.provenance.authorizedUnder === a.grant.grantId)!;
      const request = {
        purpose: "https://example.test/purpose/synthetic-review",
        expectedVersion: 1,
        reason: "My reviewed edit",
        content: { ...body.content, value: "My new statement" },
        assertion: { declarationType: "person-declared" },
        record: { provenance: { source: "person-input" } },
      };
      const review = authority.reviewPersonWrite(
        human,
        "revise",
        request,
        entry.id,
        "browser",
      );
      authority.approvePersonWrite(
        human,
        review.reviewId,
        review.csrf,
        "browser",
      );
      failAt = "before-commit";
      expect(() =>
        authority.commitReviewedPersonWrite(
          human,
          review.reviewId,
          review.csrf,
          "browser",
          "reviewed-edit",
        ),
      ).toThrow();
      failAt = undefined;
      reopen();
      if (change === "confirmation")
        authority.confirmEntry(human, entry.id, {
          expectedVersion: 1,
          disposition: "confirmed",
        });
      if (change === "peer")
        release(
          commit(
            a.token,
            input(a.grant, { content: modelInput(a.grant, "phone").content }),
          ),
        );
      const retry = () =>
        authority.commitReviewedPersonWrite(
          human,
          review.reviewId,
          review.csrf,
          "browser",
          "reviewed-edit",
        );
      if (change === "unchanged") {
        const result = release(retry());
        expect(release(retry())).toEqual(result);
        expect(store.inspectEntry(entry.id)!.record.version).toBe(2);
      } else {
        expect(retry).toThrow(AuthorityError);
        expect(store.inspectEntry(entry.id)!.record.version).toBe(1);
      }
    },
  );

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
