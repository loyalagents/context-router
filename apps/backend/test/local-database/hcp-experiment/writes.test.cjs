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
  assert.equal(first.json.content.value, body.content.value);
  assert.equal(first.headers["content-type"], "application/ld+json");
  const same = await post();
  assert.equal(same.text, first.text);
  const changed = await post({ ...body, opaqueExtension: true });
  assert.equal(changed.status, 409);
  assert.match(changed.json.type, /idempotency-conflict$/);
  const revise = {
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
  const withdrawal = await f.context(route, token, {
    method: "DELETE",
    json: { reason: "withdraw" },
  });
  assert.equal(withdrawal.status, 200);
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
  assert.equal(response.status, 201);
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
  const post = () =>
    f.context("/v2/entries", token, {
      method: "POST",
      json: body,
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
    (
      await f.management(`/v2/audit?grantId=${grant.grantId}`)
    ).json.events.filter((e) => e.eventType === "context.created").length,
    1,
  );
});

for (const [point, expected] of [
  ["before-authorized-commit", 401],
  ["after-data-commit", 201],
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
    if (expected === 201)
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
  assert.equal(model.status, 201);
  assert.equal(model.json.assertion.confidence, "low");
  assert.deepEqual(model.json.standing, {
    assurance: "unverified",
    confirmed: false,
  });
  const purpose = writeDetail().purposes[0].code;
  assert.equal(
    (
      await f.context(
        `/v2/entries/${model.json.ref}?${new URLSearchParams({ purpose })}`,
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
  assert.equal(
    (
      await f.context(
        `/v2/entries/${model.json.ref}?${new URLSearchParams({ purpose })}`,
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
