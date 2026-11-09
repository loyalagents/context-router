const { test } = require("node:test");
const assert = require("node:assert/strict");
const { fixture } = require("./authorization-fixture.cjs");
const { authorize, query, get } = require("./read-helpers.cjs");
const {
  syntheticFixtures,
} = require("../../../dist/infrastructure/hcp-experiment/fixtures.js");
const reads = async (f) =>
  (await f.management("/v2/audit?limit=100")).json.events.filter(
    (e) => e.eventType === "context.read",
  );

for (const change of ["revoke", "policy"])
  test(`C3 ${change} wins a prepared-read race; release-first history survives the reverse order`, async (t) => {
    const f = await fixture(t, { childProcess: true, approveFixtures: true });
    const a1 = await authorize(f),
      a2 = await authorize(f),
      b = await authorize(f, "b");
    const grant = (await f.context("/v2/grants", a1)).json.grants[0];
    const first = await query(f, a1);
    assert.equal(first.status, 200);
    await f.arm({ point: "after-preparation", action: "yield" });
    const pending = query(f, a1);
    assert.equal(await f.boundary(), "after-preparation");
    if (change === "revoke")
      assert.equal(
        (
          await f.management(`/v2/grants/${grant.grantId}`, {
            method: "DELETE",
          })
        ).status,
        204,
      );
    else
      assert.equal(
        (
          await f.management("/experiment/policy", {
            method: "PUT",
            json: {
              rules: [],
              directives: [
                {
                  action: "share",
                  effect: "deny",
                  text: "Changed during preparation",
                },
              ],
            },
          })
        ).status,
        200,
      );
    await f.resume();
    assert.equal((await pending).status, change === "revoke" ? 401 : 403);
    const history = await reads(f);
    assert.equal(history.length, 1);
    assert.equal(history[0].participants.retrievalId, first.json.retrievalId);
    assert.equal((await query(f, a2)).status, 200);
    assert.equal((await query(f, b)).status, 200);
    if (change === "policy")
      assert.equal(
        (await query(f, a1)).json.directives[0].text,
        "Changed during preparation",
      );
  });

for (const deadline of [
  "token",
  "grant",
  "current-entry",
  "selected-entry",
  "copy",
])
  test(`C3 ${deadline} deadline crossing during audit commit withholds content and retains attempted history`, async (t) => {
    const now = Math.floor(Date.now() / 1000) * 1000,
      fixtures = syntheticFixtures();
    if (deadline === "current-entry")
      fixtures[0].versions[1].assertion.validUntil = new Date(
        now + 60_000,
      ).toISOString();
    if (deadline === "selected-entry")
      fixtures[0].versions[0].assertion.validUntil = new Date(
        now + 60_000,
      ).toISOString();
    const f = await fixture(t, {
      childProcess: true,
      approveFixtures: true,
      fixtures,
      ...(deadline === "copy" ? { copyLifetimeMs: 30_000 } : {}),
    });
    await f.clock(now);
    const token = await authorize(f, "a", undefined, {
      durationSeconds: deadline === "grant" ? "60" : "14400",
    });
    const first = await query(f, token);
    assert.equal(first.status, 200);
    const crossing =
      now +
      (deadline === "token" ? 3600_000 : deadline === "copy" ? 30_000 : 60_000);
    await f.arm({
      point: "after-data-commit",
      operation: "releaseRead",
      action: "advance",
      now: crossing,
    });
    const result =
      deadline === "selected-entry"
        ? await get(f, token, first.json.entries[0].ref, { version: 1 })
        : await query(f, token);
    assert.equal(
      result.status,
      ["token", "grant"].includes(deadline) ? 401 : 403,
    );
    assert.equal(result.json.entries, undefined);
    assert.equal(result.json.entry, undefined);
    const events = await reads(f);
    assert.equal(events.length, 2);
    assert.equal(events[1].data.release, "attempted");
    assert.equal(events[1].data.receipt, "unconfirmed");
    assert.ok(Date.parse(events[1].disclosed[0].useUntil) <= now + 3600_000);
    await f.restart({ now: crossing });
    assert.deepEqual(await reads(f), events);
  });

for (const point of ["before-audit", "before-commit", "after-data-commit"])
  for (const action of ["pause", "throw"])
    test(`C3 ${action === "pause" ? "SIGKILL/reap" : "failure"} at ${point} never releases unaudited content`, async (t) => {
      const f = await fixture(t, { childProcess: true, approveFixtures: true }),
        token = await authorize(f);
      await f.arm({ point, operation: "releaseRead", action });
      const response = query(f, token).then(
        (r) => r,
        () => null,
      );
      if (action === "pause") {
        assert.equal(await f.boundary(), point);
        await f.kill();
      }
      const result = await response;
      assert.ok(result === null || result.status === 503);
      await f.restart();
      const expected = point === "after-data-commit" ? 1 : 0;
      assert.equal((await reads(f)).length, expected);
      const first = await query(f, token);
      assert.equal(first.status, 200);
      const original = await reads(f);
      await f.restart();
      assert.deepEqual(await reads(f), original);
      assert.equal(
        (await query(f, token)).json.entries[0].ref,
        first.json.entries[0].ref,
      );
      assert.equal((await reads(f)).length, expected + 2);
    });

test("C3 48h dormancy retains original copies and reconciles entry/grant expiry once", async (t) => {
  const now = Date.now(),
    fixtures = syntheticFixtures();
  fixtures[0].versions[1].assertion.validUntil = new Date(
    now + 60_000,
  ).toISOString();
  const f = await fixture(t, {
    childProcess: true,
    approveFixtures: true,
    fixtures,
  });
  await f.clock(now);
  const token = await authorize(f, "a", undefined, { durationSeconds: "60" });
  const first = await query(f, token);
  assert.equal(first.status, 200);
  const later = now + 48 * 3600_000;
  await assert.rejects(
    f.restart({
      now: later,
      barrier: { point: "before-audit", action: "throw" },
    }),
  );
  await f.restart({ now: later });
  assert.equal((await query(f, token)).status, 401);
  const history = (await f.management("/v2/audit?limit=100")).json.events;
  assert.equal(
    history.filter((e) => e.eventType === "grant.expired").length,
    1,
  );
  assert.equal(
    history.filter((e) => e.eventType === "context.expired").length,
    1,
  );
  assert.equal(
    history.find((e) => e.eventType === "context.read").disclosed[0].useUntil,
    first.json.entries[0].useUntil,
  );
  await f.restart({ now: later });
  assert.deepEqual(
    (await f.management("/v2/audit?limit=100")).json.events,
    history,
  );
});

test("C3 slow multi-megabyte content recipient cannot delay durable revoke", async (t) => {
  const fixtures = syntheticFixtures();
  fixtures[0].versions[1].content.value = "notes ".repeat(600_000);
  const f = await fixture(t, {
      childProcess: true,
      approveFixtures: true,
      fixtures,
    }),
    token = await authorize(f);
  const first = await query(f, token),
    grant = (await f.context("/v2/grants", token)).json.grants[0];
  const https = require("node:https");
  let request, response;
  try {
    await new Promise((resolve, reject) => {
      request = https.get(
        f.issuer +
          `/v2/entries/${first.json.entries[0].ref}?purpose=https://example.test/purpose/synthetic-review`,
        {
          ca: f.tls.ca,
          agent: false,
          headers: { authorization: `Bearer ${token}` },
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
        f.management(`/v2/grants/${grant.grantId}`, { method: "DELETE" }),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("Revoke waited for recipient")),
            3000,
          );
        }),
      ]);
      assert.equal(revoke.status, 204);
    } finally {
      clearTimeout(timer);
    }
    assert.equal((await query(f, token)).status, 401);
    assert.equal((await reads(f)).length, 2);
  } finally {
    response?.destroy();
    request?.destroy();
  }
});
