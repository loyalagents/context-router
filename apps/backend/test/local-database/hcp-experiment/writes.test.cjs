const { validCandidate } = require("./candidate-contract.cjs");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { fixture, OAuthDriver, inputs } = require("./authorization-fixture.cjs");
const { authorize, detail } = require("./read-helpers.cjs");
const {
  AuthorizationRepository,
} = require("../../../dist/infrastructure/hcp-experiment/authority.js");
const writeDetail = () =>
  detail(["general_preferences"], undefined, { actions: ["read", "write"] });
async function setup(f) {
  const token = await authorize(f, "a", [writeDetail()]);
  const own = await f.context("/v2/grants", token);
  assert.equal(own.status, 200);
  const grant = own.json.grants[0];
  assert.deepEqual(grant.scopes, [
    "hcp:general_preferences:read",
    "hcp:general_preferences:write",
  ]);
  const body = {
    purpose: "https://example.test/purpose/synthetic-review",
    schema: "https://hcp.example/spec/entry/2.0",
    subject: grant.subject,
    content: {
      profile: "https://hcp.example/spec/profiles/general-context/2.0",
      value: "C4 confidential statement",
    },
    classification: { categories: ["general_preferences"] },
    assertion: { declarationType: "person-declared" },
    record: { provenance: { source: "person-input" } },
  };
  return { token, grant, body };
}
test("consent describes actual read/write categories and narrowed reach on both pages", async (t) => {
  const f = await fixture(t, { approveFixtures: true });
  const labels = new OAuthDriver(f, "a");
  await labels.begin();
  await labels.login();
  const ids = [/urn:uuid:[0-9a-f-]{36}/.exec(labels.page.text)[0]];
  const cases = [
    {
      scopeOnly: true,
      patch: {
        scope: "hcp:general_preferences:read hcp:general_preferences:write",
      },
      write: true,
    },
    {
      patch: {
        authorization_details: JSON.stringify([
          writeDetail(),
          detail(["work_context"]),
        ]),
      },
      write: true,
      mixed: true,
    },
    {
      patch: {
        authorization_details: JSON.stringify([
          { ...writeDetail(), narrowedTo: { entryIds: ids.slice(0, 1) } },
        ]),
      },
      narrowed: true,
    },
    { scopeOnly: true },
  ];
  for (const c of cases) {
    const d = new OAuthDriver(f, "a");
    await d.begin(c);
    await d.login();
    for (const stage of ["consent", "review"]) {
      if (stage === "review") await d.review();
      const summary = /<section data-access-summary>([\s\S]*?)<\/section>/.exec(
        d.page.text,
      )?.[1];
      assert.ok(summary, `${stage} has a dedicated permission explanation`);
      if (c.write) {
        assert.match(summary, /read, create, revise and withdraw/);
        if (!c.mixed) assert.doesNotMatch(d.page.text, /Read access only\./);
      } else if (c.narrowed) {
        assert.match(
          summary,
          /read, revise and withdraw the selected existing entries/,
        );
        assert.match(summary, /Creating new entries is not permitted/);
        assert.doesNotMatch(summary, /read, create, revise and withdraw/);
      } else assert.match(summary, /Read access only/);
      if (c.mixed)
        assert.match(summary, /<li>Read access only[^<]*work_context/);
    }
  }
});

test("management distinguishes recorded assurance from authority-looking submitted extensions", async (t) => {
  const f = await fixture(t, { approveFixtures: true });
  const { token, body, grant } = await setup(f);
  const document = {
    ...body,
    standing: { assurance: "authenticated", confirmed: true },
    assertion: { declarationType: "model-inferred", confidence: "high" },
    record: {
      provenance: {
        source: "<script>forged()</script>",
        assertedBy: {
          id: "urn:context-router:controlled-synthetic-model:v1",
          extension: { assurance: "cryptographically-verified" },
        },
        fixture: { simulated: true, modelExecuted: false },
      },
    },
  };
  assert.equal(
    (await f.context("/v2/entries", token, { method: "POST", json: document }))
      .status,
    201,
  );
  const id = (
    await f.management(`/v2/audit?grantId=${grant.grantId}`)
  ).json.events.find((e) => e.eventType === "context.created").entryId;
  const d = new OAuthDriver(f, "a");
  await d.begin();
  await d.login();
  const page = await d.request("/manage/entries/" + encodeURIComponent(id));
  const facts = /<section data-entry-facts>([\s\S]*?)<\/section>/.exec(
    page.text,
  )?.[1];
  assert.ok(facts);
  assert.match(facts, /Assurance: unverified/);
  assert.match(facts, /Latest confirmation: none/);
  assert.doesNotMatch(
    facts,
    /authenticated|cryptographically-verified|modelExecuted/,
  );
  assert.match(page.text, /Full stored document \(includes submitted claims\)/);
  assert.match(page.text, /do not establish assurance or confirmation/);
  assert.match(page.text, /cryptographically-verified/);
  assert.match(page.text, /modelExecuted/);
  assert.doesNotMatch(page.text, /<script>forged/);
});

for (const deadline of ["copy", "token"])
  test(`C8 historical key conflict rechecks ${deadline} expiry after serialization`, async (t) => {
    const f = await fixture(t, { approveFixtures: true, childProcess: true });
    const { token, body, grant } = await setup(f);
    body.assertion.validUntil = new Date(Date.now() + 60_000).toISOString();
    const post = (value) =>
      f.context("/v2/entries", token, {
        method: "POST",
        json: value,
        headers: { "idempotency-key": "conflict-boundary" },
      });
    const original = await post(body);
    assert.equal(original.status, 201);
    const changed = { ...body, extension: "changed" };
    assert.equal((await post(changed)).status, 409);
    await f.arm({
      operation: "commitWrite",
      point: "during-conflict-serialization",
      action: "advance",
      now:
        deadline === "copy"
          ? Date.parse(original.json.useUntil)
          : Date.now() + 12 * 3600_000,
    });
    const denied = await post(changed);
    assert.equal(denied.status, deadline === "copy" ? 403 : 401);
    assert.doesNotMatch(
      denied.text,
      /idempotency-conflict|committed|conflict-boundary/,
    );
    await f.restart();
    assert.equal(
      (
        await f.management(
          `/v2/audit?eventType=context.created&grantId=${grant.grantId}`,
        )
      ).json.events.length,
      1,
    );
  });

test("C4 actual OAuth/TLS create/revise/withdraw and byte-bound retries", async (t) => {
  const f = await fixture(t, { approveFixtures: true });
  const { token, body } = await setup(f);
  const post = (value = body, key = "create") =>
    f.context("/v2/entries", token, {
      method: "POST",
      json: value,
      headers: { "idempotency-key": key },
    });
  const first = await post();
  assert.equal(first.status, 201);
  validCandidate("operations/create-request.json", body);
  validCandidate("operations/create-result.json", first.json);
  validCandidate("disclosure.json", first.json);
  assert.equal(first.json.content.value, body.content.value);
  assert.equal(first.headers["content-type"], "application/ld+json");
  const same = await post();
  assert.equal(same.text, first.text);
  const changed = await post({ ...body, opaqueExtension: true });
  assert.equal(changed.status, 409);
  assert.match(changed.json.type, /idempotency-conflict$/);
  const revise = {
    purpose: "https://example.test/purpose/synthetic-review",
    expectedVersion: 1,
    reason: "corrected",
    content: { ...body.content, value: "corrected" },
    record: body.record,
  };
  const route = `/v2/entries/${first.json.ref}`;
  const revision = await f.context(route + "/revisions", token, {
    method: "POST",
    json: revise,
    headers: { "idempotency-key": "revision" },
  });
  assert.equal(revision.status, 201);
  validCandidate("operations/revise-request.json", {
    ...revise,
    ref: first.json.ref,
  });
  validCandidate("operations/revise-result.json", revision.json);
  validCandidate("disclosure.json", revision.json);
  assert.equal(revision.json.version, 2);
  assert.equal(
    (await f.context(route, token, { method: "PATCH", json: revise })).status,
    422,
  );
  const stale = await f.context(route + "/revisions", token, {
    method: "POST",
    json: revise,
  });
  assert.equal(stale.status, 409);
  assert.match(stale.json.type, /version-conflict$/);
  const withdrawal = await f.context(route + "/withdrawal", token, {
    method: "POST",
    json: { purpose: body.purpose, reason: "withdraw" },
  });
  assert.equal(withdrawal.status, 200);
  validCandidate("operations/withdraw-result.json", withdrawal.json);
  assert.equal(withdrawal.json.status, "deleted");
  const readToken = await authorize(f);
  assert.equal(
    (await f.context("/v2/entries", readToken, { method: "POST", json: body }))
      .status,
    403,
  );
});

test("known commit then revoke sends only original completion; retry gets no cached response", async (t) => {
  const f = await fixture(t, { approveFixtures: true });
  const { token, grant, body } = await setup(f);
  const original = AuthorizationRepository.prototype.commitWrite;
  let signal, resume;
  const committed = new Promise((resolve) => {
    signal = resolve;
  });
  const waiting = new Promise((resolve) => {
    resume = resolve;
  });
  AuthorizationRepository.prototype.commitWrite = async function (...args) {
    const result = original.apply(this, args);
    signal();
    await waiting;
    return result;
  };
  t.after(() => {
    AuthorizationRepository.prototype.commitWrite = original;
    resume();
  });
  const request = f.context("/v2/entries", token, {
    method: "POST",
    json: body,
    headers: { "idempotency-key": "race" },
  });
  await committed;
  const revoked = await f.management(`/v2/grants/${grant.grantId}`, {
    method: "DELETE",
  });
  assert.equal(revoked.status, 204);
  resume();
  const response = await request;
  assert.equal(response.status, 200);
  validCandidate("operations/completion-result.json", response.json);
  validCandidate("operations/create-result.json", response.json);
  assert.deepEqual(response.json, {
    outcome: "committed",
    representation: "not-included",
  });
  assert.equal(response.headers.location, undefined);
  assert.equal(response.headers.etag, undefined);
  const retry = await f.context("/v2/entries", token, {
    method: "POST",
    json: body,
    headers: { "idempotency-key": "race" },
  });
  assert.equal(retry.status, 401);
  assert.ok(!retry.text.includes(body.content.value));
});

test("human inspects retained versions and explicitly reviews a confirmation through the management surface", async (t) => {
  const f = await fixture(t, { approveFixtures: true });
  const { token, grant, body } = await setup(f);
  assert.equal(
    (await f.context("/v2/entries", token, { method: "POST", json: body }))
      .status,
    201,
  );
  const audit = await f.management(`/v2/audit?grantId=${grant.grantId}`);
  const id = audit.json.events.find(
    (e) => e.eventType === "context.created",
  ).entryId;
  const confirmation = `/v2/entries/${id}/confirmation`;
  assert.equal(
    (
      await f.context(confirmation, token, {
        method: "POST",
        json: { expectedVersion: 1, disposition: "confirmed" },
      })
    ).status,
    403,
  );
  const browser = new OAuthDriver(f, "a");
  const login = await browser.request("/manage");
  assert.equal(
    (
      await browser.request("/manage/login", {
        method: "POST",
        headers: { origin: f.issuer },
        form: { csrf: inputs(login.text).csrf, credential: f.human },
      })
    ).status,
    303,
  );
  const entry = await browser.request(`/manage/entries/${id}`);
  assert.equal(entry.status, 200);
  assert.match(entry.text, /current lifecycle/i);
  assert.ok(entry.text.includes(body.content.value));
  const form = {
    csrf: inputs(entry.text).csrf,
    expectedVersion: "1",
    disposition: "confirmed",
  };
  assert.equal(
    (
      await browser.request(`/manage/entries/${id}/review`, {
        method: "POST",
        headers: { origin: "https://wrong.test" },
        form,
      })
    ).status,
    403,
  );
  const review = await browser.request(`/manage/entries/${id}/review`, {
    method: "POST",
    headers: { origin: f.issuer },
    form,
  });
  assert.equal(review.status, 200);
  assert.match(review.text, /Confirm this version/);
  const approved = await browser.request("/manage/entries/approve", {
    method: "POST",
    headers: { origin: f.issuer },
    form: inputs(review.text),
  });
  assert.equal(approved.status, 303);
  const details = await browser.request(`/manage/entries/${id}`);
  assert.match(details.text, /confirmedAt/);
  const reject = await f.management(confirmation, {
    method: "POST",
    json: { expectedVersion: 1, disposition: "rejected" },
  });
  assert.equal(reject.status, 200);
  assert.equal(reject.json.record.status, "deleted");
  assert.equal(
    reject.json.record.provenance.confirmations.at(-1).disposition,
    "rejected",
  );
});

test("management login requires an additional exact-content approval before a person assertion is created", async (t) => {
  const f = await fixture(t, { approveFixtures: true });
  const browser = new OAuthDriver(f, "a");
  const login = await browser.request("/manage");
  await browser.request("/manage/login", {
    method: "POST",
    headers: { origin: f.issuer },
    form: { csrf: inputs(login.text).csrf, credential: f.human },
  });
  const editor = await browser.request("/manage/person/new");
  assert.equal(editor.status, 200);
  const review = await browser.request("/manage/person/review", {
    method: "POST",
    headers: { origin: f.issuer },
    form: {
      purpose: "https://example.test/purpose/synthetic-review",
      csrf: inputs(editor.text).csrf,
      value: "I prefer a short summary",
      category: "general_preferences",
    },
  });
  assert.equal(review.status, 200);
  assert.match(review.text, /Review your statement/);
  const before = await browser.request("/manage/entries");
  assert.ok(!before.text.includes("I prefer a short summary"));
  const approved = await browser.request("/manage/person/approve", {
    method: "POST",
    headers: { origin: f.issuer },
    form: inputs(review.text),
  });
  assert.equal(approved.status, 201);
  assert.match(approved.text, /Statement saved/);
  const entries = await browser.request("/manage/entries");
  assert.ok(entries.text.includes("I prefer a short summary"));
  await f.close();
  const {
    createSyntheticAuthorization,
  } = require("../../../dist/composition/hcp-authorization.js");
  const reopened = await createSyntheticAuthorization(
    {
      sandbox: f.sandbox,
      root: require("node:path").join(f.sandbox, "experiment"),
    },
    {
      reopen: true,
      tls: f.tls,
      humanCredential: f.human,
      clients: f.clients,
      port: Number(new URL(f.issuer).port),
    },
  );
  try {
    const replay = await browser.request("/manage/person/approve", {
      method: "POST",
      headers: { origin: f.issuer },
      form: inputs(review.text),
    });
    assert.equal(replay.status, 201);
    assert.equal(replay.text, approved.text);
    assert.equal(
      (
        await browser.request("/manage/person/approve", {
          method: "POST",
          headers: { origin: f.issuer },
          form: { ...inputs(review.text), operationKey: "different-key" },
        })
      ).status,
      403,
    );
  } finally {
    await reopened.close();
  }
});

test("human reviews both conflict endpoints before keeping them and stale peer changes are refused", async (t) => {
  const f = await fixture(t, { approveFixtures: true });
  const { token, grant, body } = await setup(f);
  for (const value of ["email", "phone"]) {
    const result = await f.context("/v2/entries", token, {
      method: "POST",
      json: {
        ...body,
        content: {
          ...body.content,
          value: {
            type: "urn:context-router:exclusive-fact:v1",
            slot: "contact",
            setting: "work",
            value,
          },
        },
      },
    });
    assert.equal(result.status, 201);
  }
  const events = (await f.management(`/v2/audit?grantId=${grant.grantId}`)).json
    .events;
  const ids = events
    .filter((e) => e.eventType === "context.created")
    .map((e) => e.entryId);
  assert.equal(ids.length, 2);
  const browser = new OAuthDriver(f, "a");
  const login = await browser.request("/manage");
  await browser.request("/manage/login", {
    method: "POST",
    headers: { origin: f.issuer },
    form: { csrf: inputs(login.text).csrf, credential: f.human },
  });
  const entryRoute = `/manage/entries/${encodeURIComponent(ids[0])}`;
  const entryPage = await browser.request(entryRoute);
  const reviewRoute = /action="(\/manage\/conflicts\/[^\"]+\/review)"/.exec(
    entryPage.text,
  )?.[1];
  assert.ok(reviewRoute, "The surfaced conflict offers a keep-both review");
  const review = await browser.request(reviewRoute, {
    method: "POST",
    headers: { origin: f.issuer },
    form: { csrf: inputs(entryPage.text).csrf },
  });
  assert.equal(review.status, 200);
  assert.match(review.text, /email/);
  assert.match(review.text, /phone/);
  assert.equal(
    (
      await browser.request("/manage/conflicts/approve", {
        method: "POST",
        headers: { origin: f.issuer },
        form: { ...inputs(review.text), csrf: "wrong" },
      })
    ).status,
    403,
  );
  await f.management(`/v2/entries/${ids[1]}/confirmation`, {
    method: "POST",
    json: { expectedVersion: 1, disposition: "confirmed" },
  });
  assert.equal(
    (
      await browser.request("/manage/conflicts/approve", {
        method: "POST",
        headers: { origin: f.issuer },
        form: inputs(review.text),
      })
    ).status,
    403,
  );
  const fresh = await browser.request(reviewRoute, {
    method: "POST",
    headers: { origin: f.issuer },
    form: { csrf: inputs(entryPage.text).csrf },
  });
  const approved = await browser.request("/manage/conflicts/approve", {
    method: "POST",
    headers: { origin: f.issuer },
    form: inputs(fresh.text),
  });
  assert.equal(approved.status, 303);
  const after = await browser.request(entryRoute);
  assert.ok(!/action="\/manage\/conflicts\//.test(after.text));
  const history = (await f.management(`/v2/audit?entryId=${ids[1]}`)).json
    .events;
  assert.ok(
    history.some(
      (e) =>
        e.eventType === "conflict.resolved" &&
        e.data.transition === "dismissed",
    ),
  );
});

test("C4 concurrent HTTP retries commit once and expected-version revisions have one winner", async (t) => {
  const f = await fixture(t, { approveFixtures: true });
  const { token, grant, body } = await setup(f);
  const post = (json, key) =>
    f.context("/v2/entries", token, {
      method: "POST",
      json,
      headers: { "idempotency-key": key },
    });
  const [a, b] = await Promise.all([post(body, "same"), post(body, "same")]);
  assert.equal(a.status, 201);
  assert.equal(b.text, a.text);
  const changed = await Promise.all([
    post(body, "changed"),
    post({ ...body, extension: true }, "changed"),
  ]);
  assert.deepEqual(changed.map((r) => r.status).sort(), [201, 409]);
  const revise = (value) =>
    f.context(`/v2/entries/${a.json.ref}/revisions`, token, {
      method: "POST",
      json: {
        purpose: "https://example.test/purpose/synthetic-review",
        expectedVersion: 1,
        reason: "concurrent correction",
        content: { ...body.content, value },
        record: body.record,
      },
    });
  const revisions = await Promise.all([
    revise("first contender"),
    revise("second contender"),
  ]);
  assert.deepEqual(revisions.map((r) => r.status).sort(), [201, 409]);
  const events = (await f.management(`/v2/audit?grantId=${grant.grantId}`)).json
    .events;
  assert.equal(
    events.filter((e) => e.eventType === "context.created").length,
    2,
  );
  assert.equal(
    events.filter((e) => e.eventType === "context.revised").length,
    1,
  );
});

for (const point of [
  "before-audit",
  "before-commit",
  "after-data-commit",
  "after-operation",
])
  for (const action of ["pause", "throw"])
    test(`C4 ${action === "pause" ? "SIGKILL/reap" : "failure"} at ${point} preserves atomic write/audit/receipt recovery`, async (t) => {
      const f = await fixture(t, { childProcess: true, approveFixtures: true });
      const { token, grant, body } = await setup(f);
      const post = () =>
        f.context("/v2/entries", token, {
          method: "POST",
          json: body,
          headers: { "idempotency-key": "recover" },
        });
      await f.arm({ point, operation: "commitWrite", action });
      const pending = post().then(
        (r) => r,
        () => null,
      );
      if (action === "pause") {
        assert.equal(await f.boundary(), point);
        await f.kill();
      }
      const lost = await pending;
      assert.ok(lost === null || lost.status === 503);
      await f.restart();
      const committed = ["after-data-commit", "after-operation"].includes(
        point,
      );
      const history = () => f.management(`/v2/audit?grantId=${grant.grantId}`);
      assert.equal(
        (await history()).json.events.filter(
          (e) => e.eventType === "context.created",
        ).length,
        committed ? 1 : 0,
      );
      const recovered = await post();
      assert.equal(recovered.status, 201);
      assert.equal(recovered.json.content.value, body.content.value);
      await f.restart();
      assert.equal((await post()).text, recovered.text);
      assert.equal(
        (await history()).json.events.filter(
          (e) => e.eventType === "context.created",
        ).length,
        1,
      );
    });

test("C4 prepared replay remains invalid after policy narrowing/restoration and restart", async (t) => {
  const f = await fixture(t, { childProcess: true, approveFixtures: true });
  const { token, grant, body } = await setup(f);
  const post = (json = body) =>
    f.context("/v2/entries", token, {
      method: "POST",
      json,
      headers: { "idempotency-key": "policy-race" },
    });
  assert.equal((await post()).status, 201);
  await f.arm({ point: "after-write-preparation", action: "yield" });
  const pending = post();
  assert.equal(await f.boundary(), "after-write-preparation");
  for (const directives of [
    [
      {
        action: "share",
        effect: "deny",
        operators: [grant.client.operator.id],
        text: "Synthetic narrower policy",
      },
    ],
    [],
  ]) {
    assert.equal(
      (
        await f.management("/experiment/policy", {
          method: "PUT",
          json: { rules: [], directives },
        })
      ).status,
      200,
    );
  }
  await f.resume();
  assert.equal((await pending).status, 403);
  await f.restart();
  assert.equal((await post()).status, 403);
  assert.equal(
    (await post({ ...body, extension: "changed request" })).status,
    403,
  );
  assert.equal(
    (
      await f.management(`/v2/audit?grantId=${grant.grantId}`)
    ).json.events.filter((e) => e.eventType === "context.created").length,
    1,
  );
});

for (const [point, expected] of [
  ["before-authorized-commit", 401],
  ["after-data-commit", 200],
])
  test(`C4 token deadline at ${point} gives ${expected} without unauthorized data`, async (t) => {
    const f = await fixture(t, { childProcess: true, approveFixtures: true });
    const now = Math.floor(Date.now() / 1000) * 1000;
    await f.clock(now);
    const { token, body } = await setup(f);
    await f.arm({
      point,
      operation: "commitWrite",
      action: "advance",
      now: now + 3600_000,
    });
    const result = await f.context("/v2/entries", token, {
      method: "POST",
      json: body,
      headers: { "idempotency-key": "deadline" },
    });
    assert.equal(result.status, expected);
    assert.ok(!result.text.includes(body.content.value));
    assert.equal(result.headers.location, undefined);
    assert.equal(result.headers.etag, undefined);
    if (expected === 200)
      assert.deepEqual(result.json, {
        outcome: "committed",
        representation: "not-included",
      });
  });

test("C4 advertises its bounded detector and keeps model asserter distinct through human confirmation", async (t) => {
  const f = await fixture(t, { approveFixtures: true });
  const { token, grant, body } = await setup(f);
  const capabilities = (await f.request("/experiment/capabilities")).json;
  assert.equal(capabilities.publicEntryWrite, true);
  assert.equal(
    capabilities.conflict_detection,
    "urn:context-router:exclusive-fact:v1",
  );
  assert.equal(capabilities.conformsTo, undefined);
  const fact = (value) => ({
    ...body.content,
    value: {
      type: capabilities.conflict_detection,
      slot: "contact",
      setting: "work",
      value,
    },
  });
  assert.equal(
    (
      await f.context("/v2/entries", token, {
        method: "POST",
        json: { ...body, content: fact("email") },
      })
    ).status,
    201,
  );
  const model = await f.context("/v2/entries", token, {
    method: "POST",
    json: {
      ...body,
      content: fact("phone"),
      assertion: {
        declarationType: "model-inferred",
        confidence: "low",
        basis: {
          drawnFrom: ["observation"],
          rationale: "Synthetic test assertion",
        },
      },
      record: {
        provenance: {
          assertedBy: { id: "https://example.test/models/controlled/1" },
          source: "External synthetic fixture; no model invocation",
        },
      },
    },
  });
  assert.equal(model.status, 200);
  validCandidate("operations/completion-result.json", model.json);
  const beforeConfirmation = await f.context("/v2/entries/query", token, {
    method: "POST",
    json: { query: "phone", purpose: writeDetail().purposes[0].code },
  });
  assert.ok(
    beforeConfirmation.json.entries.every(
      (e) => e.content.value.value !== "phone",
    ),
  );
  const purpose = writeDetail().purposes[0].code;
  assert.equal(
    (
      await f.context(
        `/v2/entries/r_undisclosed?${new URLSearchParams({ purpose })}`,
        token,
      )
    ).status,
    403,
  );
  const events = (await f.management(`/v2/audit?grantId=${grant.grantId}`)).json
    .events;
  const modelId = events.find(
    (e) => e.eventType === "context.created" && e.participants.model,
  ).entryId;
  const confirmed = await f.management(`/v2/entries/${modelId}/confirmation`, {
    method: "POST",
    json: { expectedVersion: 1, disposition: "confirmed" },
  });
  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.json.record.status, "active");
  assert.equal(confirmed.json.assertion.declarationType, "model-inferred");
  assert.equal(
    confirmed.json.record.provenance.assertedBy.id,
    "https://example.test/models/controlled/1",
  );
  const visible = await f.context("/v2/entries/query", token, {
    method: "POST",
    json: { query: "phone", purpose },
  });
  const disclosed = visible.json.entries.find(
    (e) => e.content.value.value === "phone",
  );
  assert.equal(disclosed.assertion.confidence, "low");
  assert.equal(disclosed.standing.confirmed, true);
  assert.equal(
    (
      await f.context(
        `/v2/entries/${disclosed.ref}?${new URLSearchParams({ purpose })}`,
        token,
      )
    ).status,
    200,
  );
});

test("C4 mutation parsing rejects invalid UTF-8 and duplicate keys without consuming operations", async (t) => {
  const f = await fixture(t, { approveFixtures: true });
  const { token, body } = await setup(f);
  const invalid = await f.context("/v2/entries", token, {
    method: "POST",
    raw: Buffer.from([0xc3, 0x28]),
    headers: { "content-type": "application/json", "idempotency-key": "bytes" },
  });
  assert.equal(invalid.status, 422);
  assert.equal(
    (
      await f.context("/v2/entries", token, {
        method: "POST",
        json: body,
        headers: { "idempotency-key": ["bytes", "bytes"] },
      })
    ).status,
    422,
  );
  const raw = JSON.stringify(body);
  const first = await f.context("/v2/entries", token, {
    method: "POST",
    raw,
    headers: {
      "content-type": "application/ld+json",
      "idempotency-key": "bytes",
    },
  });
  assert.equal(first.status, 201);
  const reordered = JSON.stringify({
    record: body.record,
    ...Object.fromEntries(Object.entries(body).filter(([k]) => k !== "record")),
  });
  assert.equal(
    (
      await f.context("/v2/entries", token, {
        method: "POST",
        raw: reordered,
        headers: {
          "content-type": "application/json",
          "idempotency-key": "bytes",
        },
      })
    ).status,
    409,
  );
});

test("C8 soft withdrawal uses POST and exact retry preserves its historical acknowledgement", async (t) => {
  const f = await fixture(t, { approveFixtures: true });
  const { token, body, grant } = await setup(f);
  const created = await f.context("/v2/entries", token, {
    method: "POST",
    json: body,
  });
  assert.equal(created.status, 201);
  const route = `/v2/entries/${created.json.ref}`;
  const request = { purpose: body.purpose, reason: "Synthetic withdrawal" };
  const old = await f.context(route, token, {
    method: "DELETE",
    json: request,
  });
  assert.ok(old.status >= 400);
  const options = {
    method: "POST",
    json: request,
    headers: { "idempotency-key": "post-withdrawal" },
  };
  const withdrawn = await f.context(route + "/withdrawal", token, options);
  assert.equal(withdrawn.status, 200);
  assert.deepEqual(withdrawn.json, {
    ref: created.json.ref,
    status: "deleted",
    timestamp: withdrawn.json.timestamp,
  });
  assert.deepEqual(
    (await f.context(route + "/withdrawal", token, options)).json,
    withdrawn.json,
  );
  const events = await f.management(
    `/v2/audit?eventType=context.withdrawn&grantId=${grant.grantId}`,
  );
  assert.equal(events.json.events.length, 1);
  assert.equal(events.json.events[0].purpose, body.purpose);
});

for (const expiresAtRelease of [false, true])
  test(`C8 uncertain native commit is typed only under unchanged current authority (expires=${expiresAtRelease})`, async (t) => {
    const f = await fixture(t, { approveFixtures: true, childProcess: true });
    const { token, body, grant } = await setup(f);
    const post = (value = body) =>
      f.context("/v2/entries", token, {
        method: "POST",
        json: value,
        headers: { "idempotency-key": "native-uncertain" },
      });
    await f.arm({
      operation: "commitWrite",
      point: "before-authorized-commit",
      action: "uncertain-commit",
      ...(expiresAtRelease
        ? {
            nextFault: {
              operation: "commitWrite",
              point: "during-unresolved-serialization",
              action: "advance",
              now: Date.now() + 24 * 3600_000,
            },
          }
        : {}),
    });
    const uncertain = await post();
    if (expiresAtRelease) {
      assert.notEqual(
        uncertain.json.type,
        "https://hcp.example/problems/idempotency-unresolved",
      );
      assert.equal(uncertain.headers["retry-after"], undefined);
    } else {
      assert.equal(uncertain.status, 503);
      assert.equal(
        uncertain.json.type,
        "https://hcp.example/problems/idempotency-unresolved",
      );
      assert.equal(uncertain.headers["retry-after"], "1");
      validCandidate("problem.json", uncertain.json);
      assert.throws(() =>
        validCandidate("error.json", {
          code: "idempotency-unresolved",
          message: "retry",
        }),
      );
    }
    // Closed admission cannot freshly authorize or disclose a match, conflict or pending key.
    const later = await post({ ...body, extension: "changed" });
    assert.equal(later.status, 503);
    assert.notEqual(
      later.json.type,
      "https://hcp.example/problems/idempotency-unresolved",
    );
    assert.equal(later.headers["retry-after"], undefined);
    await f.restart();
    const recovered = await post();
    assert.equal(recovered.status, 201);
    assert.equal(recovered.json.content.value, body.content.value);
    assert.equal(
      (
        await f.management(
          `/v2/audit?eventType=context.created&grantId=${grant.grantId}`,
        )
      ).json.events.length,
      1,
    );
  });

test("C8 no-use create is closed completion on the wire and survives exact recovery", async (t) => {
  const f = await fixture(t, { approveFixtures: true });
  const { token, body, grant } = await setup(f);
  body.assertion.permittedPurposes = [];
  const post = () =>
    f.context("/v2/entries", token, {
      method: "POST",
      json: body,
      headers: { "idempotency-key": "completion-candidate" },
    });
  const first = await post();
  assert.equal(first.status, 200);
  validCandidate("operations/create-request.json", body);
  validCandidate("operations/create-result.json", first.json);
  validCandidate("operations/completion-result.json", first.json);
  assert.equal(first.headers.location, undefined);
  assert.equal(first.headers.etag, undefined);
  assert.deepEqual((await post()).json, first.json);
  assert.throws(() =>
    validCandidate("operations/completion-result.json", {
      ...first.json,
      ref: "r_extra",
    }),
  );
  const events = (
    await f.management(
      `/v2/audit?eventType=context.created&grantId=${grant.grantId}`,
    )
  ).json.events;
  assert.equal(events.length, 1);
  assert.equal(events[0].disclosed, undefined);
});

for (const boundary of [
  "peer-expiry",
  "supersedes",
  "replace-data",
  "remove-data",
])
  test(`C8 review: uncertain outcome stays opaque after ${boundary}`, async (t) => {
    const f = await fixture(t, { approveFixtures: true, childProcess: true });
    const { token, body } = await setup(f);
    const deadline = Date.now() + 60_000;
    const peer = await f.context("/v2/entries", token, {
      method: "POST",
      json: {
        ...body,
        assertion: {
          ...body.assertion,
          validUntil: new Date(deadline).toISOString(),
        },
      },
    });
    assert.equal(peer.status, 201);
    const request = {
      ...body,
      content: { ...body.content, value: "Derived uncertain write" },
      record: {
        ...body.record,
        relationships: [
          {
            type: boundary === "supersedes" ? "supersedes" : "derivedFrom",
            target: peer.json.ref,
          },
        ],
      },
    };
    await f.arm({
      operation: "commitWrite",
      point: "before-authorized-commit",
      action: "uncertain-commit",
      ...(boundary === "supersedes"
        ? {}
        : {
            nextFault: {
              operation: "commitWrite",
              point: "during-unresolved-serialization",
              ...(boundary === "peer-expiry"
                ? { action: "advance", now: deadline }
                : {
                    action: boundary,
                    path: require("node:path").join(
                      f.sandbox,
                      "experiment",
                      "entries.sqlite",
                    ),
                  }),
            },
          }),
    });
    const result = await f.context("/v2/entries", token, {
      method: "POST",
      json: request,
      headers: { "idempotency-key": "review-uncertain" },
    });
    // Restore only this synthetic fixture's path so ordinary cleanup can verify
    // its pinned file after the disclosure boundary has been exercised.
    if (["replace-data", "remove-data"].includes(boundary)) {
      const fs = require("node:fs"),
        data = require("node:path").join(
          f.sandbox,
          "experiment",
          "entries.sqlite",
        );
      fs.rmSync(data, { force: true });
      fs.renameSync(data + ".old", data);
    }
    assert.notEqual(
      result.json.type,
      "https://hcp.example/problems/idempotency-unresolved",
    );
    assert.equal(result.headers["retry-after"], undefined);
    if (boundary === "peer-expiry") assert.equal(result.status, 403);
  });

for (const deadline of ["token-in-commit", "peer-in-commit", "copy-at-release"])
  test(`C8 recheck: uncertain outcome preserves the known ${deadline} denial`, async (t) => {
    const f = await fixture(t, {
      approveFixtures: true,
      childProcess: true,
      copyLifetimeMs: 60_000,
    });
    const { token, body } = await setup(f);
    const expires = Date.now() + 120_000;
    const peer = await f.context("/v2/entries", token, {
      method: "POST",
      json: {
        ...body,
        assertion: {
          ...body.assertion,
          validUntil: new Date(expires).toISOString(),
        },
      },
    });
    assert.equal(peer.status, 201);
    const request = {
      ...body,
      content: { ...body.content, value: "Expiry across native commit" },
      record: {
        ...body.record,
        relationships: [{ type: "derivedFrom", target: peer.json.ref }],
      },
    };
    await f.arm({
      operation: "commitWrite",
      point: "before-authorized-commit",
      action: "uncertain-commit",
      ...(deadline === "copy-at-release"
        ? {
            nextFault: {
              operation: "commitWrite",
              point: "during-unresolved-serialization",
              action: "advance",
              now: Date.now() + 90_000,
            },
          }
        : {
            now:
              deadline === "token-in-commit"
                ? Date.now() + 24 * 3600_000
                : expires,
          }),
    });
    const result = await f.context("/v2/entries", token, {
      method: "POST",
      json: request,
      headers: { "idempotency-key": "recheck-expiry" },
    });
    assert.equal(result.status, deadline === "token-in-commit" ? 401 : 403);
    assert.notEqual(
      result.json.type,
      "https://hcp.example/problems/idempotency-unresolved",
    );
    assert.equal(result.headers["retry-after"], undefined);
  });
