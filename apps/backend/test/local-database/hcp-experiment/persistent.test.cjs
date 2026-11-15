const { test } = require("node:test");
const assert = require("node:assert/strict");
const { fixture, OAuthDriver, inputs } = require("./authorization-fixture.cjs");
async function persistent(f, client = "a") {
  const d = new OAuthDriver(f, client);
  await d.begin();
  await d.login();
  await d.review();
  const result = await d.request(d.interactionPath + "/persist", {
    method: "POST",
    headers: { origin: f.issuer },
    form: d.reviewed,
  });
  assert.equal(result.status, 200);
  d.reviewed = inputs(result.text);
  await d.capture(await d.approve());
  const tokens = await d.exchange();
  assert.equal(tokens.status, 200);
  return tokens.json;
}
const refresh = (f, tokens, client = "a") =>
  f.request("/token", {
    method: "POST",
    form: {
      grant_type: "refresh_token",
      client_id: client,
      resource: f.issuer,
      refresh_token: tokens.refresh_token,
    },
  });
test("C5 consumed refresh destroy crash atomically revokes A1 while independent A2 and B survive", async (t) => {
  const f = await fixture(t, { childProcess: true, approveFixtures: true });
  const a1 = await persistent(f),
    a2 = await persistent(f),
    b = await persistent(f, "b"),
    next = (await refresh(f, a1)).json;
  await f.arm({
    operation: "protocolDestroy:RefreshToken",
    point: "after-data-commit",
    action: "block",
  });
  const replay = refresh(f, a1).catch(() => null);
  await f.boundary();
  await f.kill();
  await replay;
  await f.restart();
  assert.equal((await refresh(f, next)).status, 400);
  assert.equal((await f.context("/v2/grants", next.access_token)).status, 401);
  assert.equal((await refresh(f, a2)).status, 200);
  assert.equal((await refresh(f, b, "b")).status, 200);
});
test("C5 concurrent refresh reuse and refresh/revoke interleaving cannot preserve credential authority", async (t) => {
  const f = await fixture(t, { childProcess: true, approveFixtures: true }),
    first = await persistent(f),
    other = await persistent(f, "b");
  const raced = await Promise.all([refresh(f, first), refresh(f, first)]);
  assert.ok(raced.some((r) => r.status === 400));
  for (const result of raced)
    if (result.status === 200)
      assert.equal(
        (await f.context("/v2/grants", result.json.access_token)).status,
        401,
      );
  assert.equal((await refresh(f, other, "b")).status, 200);
  const revoked = await persistent(f),
    id = (await f.context("/v2/grants", revoked.access_token)).json.grants[0]
      .grantId;
  const [renewed, removal] = await Promise.all([
    refresh(f, revoked),
    f.management(`/v2/grants/${id}`, { method: "DELETE" }),
  ]);
  assert.equal(removal.status, 204);
  if (renewed.status === 200)
    assert.equal(
      (await f.context("/v2/grants", renewed.json.access_token)).status,
      401,
    );
  assert.equal((await refresh(f, revoked)).status, 400);
});
for (const [operation, point] of [
  ["protocolConsume", "after-data-commit"],
  ["protocolUpsert:RefreshToken", "before-commit"],
  ["protocolUpsert:AccessToken", "before-commit"],
  ["protocolUpsert:RefreshToken", "after-data-commit"],
])
  test(`C5 refresh partial persistence/lost response fails closed at ${operation} ${point}`, async (t) => {
    const f = await fixture(t, { childProcess: true, approveFixtures: true }),
      first = await persistent(f),
      unaffected = await persistent(f, "b");
    await f.arm({ operation, point, action: "block" });
    const pending = refresh(f, first).catch(() => null);
    await f.boundary();
    await f.kill();
    await pending;
    await f.restart();
    assert.equal((await refresh(f, first)).status, 400);
    assert.equal((await refresh(f, unaffected, "b")).status, 200);
  });
test("C5 persistent refresh survives reopen and 48h dormancy without extending its fixed 30-day family", async (t) => {
  const f = await fixture(t, { childProcess: true, approveFixtures: true }),
    first = await persistent(f);
  const g = (await f.context("/v2/grants", first.access_token)).json.grants[0],
    issued = Date.parse(g.issuedAt);
  await f.restart({ now: issued + 48 * 3600_000 });
  const next = await refresh(f, first);
  assert.equal(next.status, 200);
  assert.ok(next.json.expires_in <= 3600);
  await f.clock(issued + 30 * 86400_000);
  assert.equal((await refresh(f, next.json)).status, 400);
  assert.equal(
    (await f.management("/v2/grants?status=all")).json.grants.find(
      (v) => v.grantId === g.grantId,
    ).status,
    "active",
  );
});
test("C5 final refresh token response is suppressed when its family expires during persistence", async (t) => {
  const f = await fixture(t, { childProcess: true, approveFixtures: true }),
    first = await persistent(f),
    g = (await f.context("/v2/grants", first.access_token)).json.grants[0];
  await f.arm({
    operation: "protocolUpsert:AccessToken",
    point: "after-data-commit",
    action: "advance",
    now: Date.parse(g.issuedAt) + 30 * 86400_000,
  });
  const result = await refresh(f, first);
  assert.notEqual(result.status, 200);
  assert.equal(result.json?.access_token, undefined);
});
test("C5 actual OAuth persistent election rotates every refresh and limits reuse to its own grant", async (t) => {
  const f = await fixture(t, { approveFixtures: true });
  const d = new OAuthDriver(f, "a");
  await d.begin();
  await d.login();
  await d.review();
  const old = d.reviewed;
  const elected = await d.request(d.interactionPath + "/persist", {
    method: "POST",
    headers: { origin: f.issuer },
    form: old,
  });
  assert.equal(elected.status, 200);
  d.reviewed = inputs(elected.text);
  await d.capture(await d.approve());
  const first = await d.exchange();
  assert.equal(first.status, 200);
  assert.equal(typeof first.json.refresh_token, "string");
  const refresh = (rt) =>
    f.request("/token", {
      method: "POST",
      form: {
        grant_type: "refresh_token",
        client_id: "a",
        resource: f.issuer,
        refresh_token: rt,
      },
    });
  const second = await refresh(first.json.refresh_token);
  assert.equal(second.status, 200);
  assert.notEqual(second.json.refresh_token, first.json.refresh_token);
  assert.ok(second.json.expires_in <= 3600);
  const unaffected = new OAuthDriver(f, "a");
  await unaffected.begin();
  await unaffected.login();
  const other = await unaffected.consentAndExchange();
  assert.equal((await refresh(first.json.refresh_token)).status, 400);
  assert.equal((await refresh(second.json.refresh_token)).status, 400);
  assert.equal(
    (await f.context("/v2/grants", other.json.access_token)).status,
    200,
  );
  assert.equal(
    (await f.context("/v2/grants", second.json.access_token)).status,
    401,
  );
});
