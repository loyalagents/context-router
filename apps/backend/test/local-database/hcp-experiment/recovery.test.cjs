const { test } = require("node:test");
const assert = require("node:assert/strict");
const { fixture, OAuthDriver } = require("./authorization-fixture.cjs");
const {
  ACCESS_TYPE,
  PURPOSES,
} = require("../../../dist/infrastructure/hcp-experiment/policy.js");

test("SIGKILL/reap preserves consent session, code, distinct A1/A2 authority, tokens and revoke", async (t) => {
  const f = await fixture(t, { childProcess: true }),
    a1 = new OAuthDriver(f, "a");
  await a1.begin();
  await a1.login();
  await a1.review();
  await f.restart();
  assert.equal((await f.management("/v2/grants")).json.grants.length, 0);
  await a1.capture(await a1.approve());
  await f.restart();
  const a2 = new OAuthDriver(f, "a");
  a2.jar = new Map(a1.jar);
  await a2.begin({
    patch: {
      authorization_details: JSON.stringify([
        {
          type: ACCESS_TYPE,
          actions: ["read"],
          categories: ["work_context"],
          purposes: [PURPOSES[1]],
        },
      ]),
    },
  });
  assert.equal(a2.stage, "consent");
  const second = await a2.consentAndExchange();
  assert.equal(second.status, 200);
  const first = await a1.exchange();
  assert.equal(first.status, 200);
  const own1 = (await f.context("/v2/grants", first.json.access_token)).json
    .grants[0];
  const own2 = (await f.context("/v2/grants", second.json.access_token)).json
    .grants[0];
  assert.notEqual(own1.grantId, own2.grantId);
  assert.deepEqual(own1.access[0].categories, ["general_preferences"]);
  assert.deepEqual(own2.access[0].categories, ["work_context"]);
  assert.equal(own1.access[0].purposes[0].code, PURPOSES[0].code);
  assert.equal(own2.access[0].purposes[0].code, PURPOSES[1].code);
  const b = new OAuthDriver(f, "b");
  await b.begin();
  await b.login();
  const third = await b.consentAndExchange();
  assert.equal(third.status, 200);
  await f.restart();
  assert.deepEqual(
    (await f.context("/v2/grants", first.json.access_token)).json.grants[0],
    own1,
  );
  assert.equal(
    (await f.management(`/v2/grants/${own1.grantId}`, { method: "DELETE" }))
      .status,
    204,
  );
  await f.restart();
  assert.equal(
    (await f.context("/v2/grants", first.json.access_token)).status,
    401,
  );
  assert.equal(
    (await f.context("/v2/grants", second.json.access_token)).status,
    200,
  );
  assert.equal(
    (await f.context("/v2/grants", third.json.access_token)).status,
    200,
  );
  assert.equal((await a2.exchange()).status, 400);
  await f.restart();
  assert.equal(
    (await f.context("/v2/grants", second.json.access_token)).status,
    401,
  );
  assert.equal(
    (await f.context("/v2/grants", third.json.access_token)).status,
    200,
  );
});

for (const point of ["before-audit", "before-commit", "after-data-commit"])
  test(`grant approval process loss at ${point} preserves atomic truthful authority`, async (t) => {
    const f = await fixture(t, { childProcess: true }),
      a = new OAuthDriver(f, "a");
    await a.begin();
    await a.login();
    await a.review();
    await f.arm({ point, operation: "approve", action: "pause" });
    const response = a.approve().then(
      () => false,
      () => true,
    );
    assert.equal(await f.boundary(), point);
    await f.kill();
    assert.equal(await response, true);
    await f.restart();
    const committed = point === "after-data-commit" ? 1 : 0;
    assert.equal(
      (await f.management("/v2/grants?status=all")).json.grants.length,
      committed,
    );
    assert.equal(
      (await f.management("/v2/audit")).json.events.filter(
        (e) => e.eventType === "grant.issued",
      ).length,
      committed,
    );
    const retry = await a.approve();
    assert.equal(retry.status, committed ? 403 : 200);
    assert.equal(
      (await f.management("/v2/grants?status=all")).json.grants.length,
      1,
    );
  });

test("token commit interrupted before reply never supplies unrecorded authority and consumed code survives", async (t) => {
  const f = await fixture(t, { childProcess: true }),
    a = new OAuthDriver(f, "a");
  await a.begin();
  await a.login();
  await a.consent();
  await f.arm({
    point: "after-data-commit",
    operation: "protocolUpsert:AccessToken",
    action: "pause",
  });
  const exchange = a.exchange().then(
    () => false,
    () => true,
  );
  assert.equal(await f.boundary(), "after-data-commit");
  await f.kill();
  assert.equal(await exchange, true);
  await f.restart();
  assert.equal((await f.management("/v2/grants")).json.grants.length, 1);
  assert.equal(
    (await f.management("/v2/audit")).json.events.filter(
      (e) => e.eventType === "grant.issued",
    ).length,
    1,
  );
  assert.equal((await a.exchange()).status, 400);
  assert.equal((await f.management("/v2/grants")).json.grants.length, 0);
});

for (const duration of [60, 14400])
  test(`time crossing ${duration === 60 ? "grant" : "token"} deadline during token commit suppresses release`, async (t) => {
    const f = await fixture(t, { childProcess: true }),
      a = new OAuthDriver(f, "a"),
      now = Date.now();
    await f.clock(now);
    await a.begin();
    await a.login();
    await a.consent({ durationSeconds: String(duration) });
    await f.arm({
      point: "after-data-commit",
      operation: "protocolUpsert:AccessToken",
      action: "advance",
      now: now + Math.min(duration, 3600) * 1000,
    });
    const result = await a.exchange();
    assert.ok(result.status >= 400);
    assert.equal(result.json.access_token, undefined);
    const grants = (await f.management("/v2/grants?status=all")).json.grants;
    assert.equal(grants.length, 1);
    assert.equal(grants[0].status, duration === 60 ? "expired" : "active");
  });

test("48h process dormancy reconciles once with effective deadlines, failure refusal and revoked precedence", async (t) => {
  const f = await fixture(t, { childProcess: true }),
    a = new OAuthDriver(f, "a"),
    now = Date.now();
  await f.clock(now);
  await a.begin();
  await a.login();
  const first = await a.consentAndExchange({ durationSeconds: "60" });
  const old = (await f.context("/v2/grants", first.json.access_token)).json
    .grants[0];
  assert.equal(
    (await f.management(`/v2/grants/${old.grantId}`, { method: "DELETE" }))
      .status,
    204,
  );
  await a.begin();
  const second = await a.consentAndExchange({ durationSeconds: "60" });
  const deadline = (await f.context("/v2/grants", second.json.access_token))
    .json.grants[0].expiresAt;
  const later = now + 48 * 3600_000;
  await assert.rejects(
    f.restart({
      now: later,
      barrier: { point: "before-audit", action: "throw" },
    }),
  );
  await f.restart({ now: later });
  assert.equal(
    (await f.context("/v2/grants", second.json.access_token)).status,
    401,
  );
  const audit = (await f.management("/v2/audit")).json.events;
  const events = audit.filter((e) => e.eventType === "grant.expired");
  assert.equal(events.length, 1);
  assert.equal(events[0].timestamp, new Date(later).toISOString());
  assert.equal(events[0].data.effectiveAt, deadline);
  assert.equal(
    (await f.management("/v2/grants?status=all")).json.grants.find(
      (g) => g.grantId === old.grantId,
    ).status,
    "revoked",
  );
  await f.restart({ now: later });
  assert.deepEqual((await f.management("/v2/audit")).json.events, audit);
});

test("a paused own-grant recipient does not hold up durable revoke or later admission", async (t) => {
  const f = await fixture(t, { childProcess: true }),
    a = new OAuthDriver(f, "a");
  await a.begin();
  await a.login();
  const token = await a.consentAndExchange();
  const id = (await f.context("/v2/grants", token.json.access_token)).json
    .grants[0].grantId;
  assert.equal(
    (
      await f.management("/experiment/policy", {
        method: "PUT",
        json: {
          rules: [],
          directives: Array.from({ length: 100 }, () => ({
            action: "share",
            effect: "deny",
            text: "Synthetic directive. ".repeat(9),
          })),
        },
      })
    ).status,
    200,
  );
  const https = require("node:https");
  let request, response;
  try {
    await new Promise((resolve, reject) => {
      request = https.get(
        f.issuer + "/v2/grants",
        {
          ca: f.tls.ca,
          agent: false,
          headers: { authorization: `Bearer ${token.json.access_token}` },
          lookup: (_h, options, cb) =>
            options.all
              ? cb(null, [{ address: "127.0.0.1", family: 4 }])
              : cb(null, "127.0.0.1", 4),
        },
        (res) => {
          response = res;
          res.pause();
          assert.equal(res.statusCode, 200);
          resolve();
        },
      );
      request.on("error", () =>
        reject(new Error("Owned slow recipient failed")),
      );
    });
    let timer;
    try {
      const revoke = await Promise.race([
        f.management(`/v2/grants/${id}`, { method: "DELETE" }),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("Revoke waited for a paused recipient")),
            3000,
          );
        }),
      ]);
      assert.equal(revoke.status, 204);
    } finally {
      clearTimeout(timer);
    }
    assert.equal(
      (await f.context("/v2/grants", token.json.access_token)).status,
      401,
    );
    const history = (await f.management("/v2/audit", { headers: {} })).json;
    // The history is paginated; its first page must never invent a disclosure event.
    assert.equal(
      history.events.some((e) => e.eventType === "context.read"),
      false,
    );
  } finally {
    response?.destroy();
    request?.destroy();
  }
});

for (const operation of ["protocolFind:AccessToken", "ownGrant"])
  test(`own-grant expiry after ${operation} is invalid evidence and releases no grant`, async (t) => {
    const f = await fixture(t, { childProcess: true }),
      a = new OAuthDriver(f, "a"),
      now = Date.now();
    await f.clock(now);
    await a.begin();
    await a.login();
    const token = await a.consentAndExchange({ durationSeconds: "60" });
    assert.equal(token.status, 200);
    await f.arm({
      operation,
      point: "after-operation",
      action: "advance",
      now: now + 60_000,
    });
    const result = await f.context("/v2/grants", token.json.access_token);
    assert.equal(result.status, 401);
    assert.equal(
      result.json.type,
      "https://hcp.example/problems/invalid-token",
    );
    assert.equal(result.json.grants, undefined);
  });
