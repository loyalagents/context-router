const { test } = require("node:test");
const assert = require("node:assert/strict");
const { fixture, OAuthDriver } = require("./authorization-fixture.cjs");

test("invalid TLS startup releases the owned store for same-process reopen and reset", async (t) => {
  const fs = require("node:fs"),
    os = require("node:os"),
    path = require("node:path");
  const {
    createSyntheticAuthorization,
  } = require("../../../dist/composition/hcp-authorization.js");
  const {
    createSyntheticExperiment,
    openSyntheticExperiment,
    resetSyntheticExperiment,
  } = require("../../../dist/composition/hcp-experiment.js");
  const sandbox = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "hcp-c2-tls-failure-")),
  );
  fs.chmodSync(sandbox, 0o700);
  t.after(() => fs.rmSync(sandbox, { recursive: true }));
  const paths = { sandbox, root: path.join(sandbox, "experiment") };
  const initial = createSyntheticExperiment(paths),
    storeId = initial.storeId;
  initial.close();
  await assert.rejects(
    createSyntheticAuthorization(paths, {
      reopen: true,
      tls: { key: "invalid PEM", cert: "invalid PEM" },
      humanCredential: "unused-before-TLS-validation",
      clients: [],
    }),
    { code: "ERR_OSSL_PEM_NO_START_LINE" },
  );
  const reopened = openSyntheticExperiment(paths);
  try {
    assert.equal(reopened.storeId, storeId);
  } finally {
    reopened.close();
  }
  resetSyntheticExperiment(paths);
});

test("real HTTPS RAR and scope-only affirmative consent, actor isolation, own grant, human history and revoke", async (t) => {
  const f = await fixture(t);
  const a = new OAuthDriver(f, "a"),
    b = new OAuthDriver(f, "b");
  await a.begin();
  assert.equal((await f.management("/v2/grants")).json.grants.length, 0);
  await a.login();
  assert.equal(
    (await f.management("/v2/grants")).json.grants.length,
    0,
    "login must create no authority",
  );
  const a1 = await a.consentAndExchange();
  assert.equal(a1.status, 200);
  assert.equal(a1.json.refresh_token, undefined);
  assert.ok(a1.json.expires_in > 0 && a1.json.expires_in <= 3600);
  const ownA1 = await f.context("/v2/grants", a1.json.access_token);
  assert.equal(ownA1.status, 200);
  assert.deepEqual(a1.json.authorization_details, ownA1.json.grants[0].access);
  await a.begin({ scopeOnly: true });
  assert.equal(
    a.stage,
    "consent",
    "prior login/consent does not silently approve",
  );
  const a2 = await a.consentAndExchange();
  await b.begin();
  await b.login();
  const b1 = await b.consentAndExchange();
  const ownA2 = await f.context("/v2/grants", a2.json.access_token),
    ownB = await f.context("/v2/grants", b1.json.access_token);
  assert.equal(
    ownA1.json.grants[0].subject.id,
    ownA2.json.grants[0].subject.id,
  );
  assert.notEqual(
    ownA1.json.grants[0].subject.id,
    ownB.json.grants[0].subject.id,
  );
  assert.equal((await f.management("/v2/grants")).json.grants.length, 3);
  const grant = ownA1.json.grants[0].grantId;
  assert.equal(
    (
      await f.context(
        `/v2/grants/${ownA2.json.grants[0].grantId}`,
        a1.json.access_token,
        { method: "DELETE" },
      )
    ).status,
    403,
  );
  const revoke = await f.management(`/v2/grants/${grant}`, {
    method: "DELETE",
  });
  assert.equal(revoke.status, 204);
  assert.equal(revoke.headers["hcp-version"], "2.0");
  assert.equal(
    (await f.context("/v2/grants", a1.json.access_token)).status,
    401,
  );
  assert.equal(
    (await f.context("/v2/grants", a2.json.access_token)).status,
    200,
  );
  assert.equal(
    (await f.context("/v2/grants", b1.json.access_token)).status,
    200,
  );
  assert.equal(
    (await f.management("/v2/grants?status=all")).json.grants.length,
    3,
  );
  const history = await f.management("/v2/audit");
  assert.equal(history.status, 200);
  assert.equal(
    history.json.events.filter((e) => e.eventType === "grant.issued").length,
    3,
  );
  assert.equal(
    history.json.events.filter((e) => e.eventType === "context.read").length,
    0,
  );
  assert.ok(
    f.callbacks.every((c) => !c.cookie),
    "authorization/human cookies must never reach callbacks",
  );
});

test("rejects bad OAuth binding, unsupported flows and credential capacity substitutions", async (t) => {
  const f = await fixture(t),
    a = new OAuthDriver(f, "a");
  for (const patch of [
    { resource: "https://foreign.test" },
    { resource: null },
    { redirect_uri: f.redirects.a + "/wrong" },
    { code_challenge_method: "plain" },
    { code_challenge: null },
    { subject: "other" },
    { requestingParty: "other" },
    { response_type: "token" },
    { response_mode: "query" },
    { scope: "offline_access", authorization_details: null },
  ]) {
    const result = await a.begin({ patch, expectFailure: true });
    assert.ok(result.status >= 400, "bad request must not start a usable flow");
  }
  await a.begin();
  await a.login();
  const token = await a.consentAndExchange();
  for (const route of [
    "/v2/audit",
    "/experiment/policy",
    "/v2/export",
    "/v2/disclosures",
    "/v2/rules",
    "/v2/directives",
  ])
    assert.equal(
      (
        await f.context(route, token.json.access_token, {
          headers: { "x-management-scope": "all" },
        })
      ).status,
      403,
    );
  assert.equal(
    (
      await f.request("/auth", {
        headers: { authorization: `Bearer ${f.human}` },
      })
    ).status >= 400,
    true,
  );
  assert.equal(
    (
      await f.request("/v2/entries/query", {
        method: "POST",
        headers: { authorization: `Bearer ${f.human}` },
        json: {},
      })
    ).status >= 400,
    true,
  );
  assert.equal(
    (
      await f.context("/v2/grants", token.json.access_token, {
        headers: { "hcp-version": "9.9" },
      })
    ).status,
    400,
  );
  assert.equal(
    (await f.request("/v2/grants", { headers: { host: "foreign.test" } }))
      .status,
    422,
  );
  assert.equal(
    (
      await f.request("/v2/grants", {
        headers: { "x-forwarded-host": "foreign.test" },
      })
    ).status,
    422,
  );
  const metadata = await f.request("/.well-known/oauth-authorization-server");
  assert.equal(metadata.json.issuer, f.issuer);
  assert.deepEqual(metadata.json.grant_types_supported, ["authorization_code"]);
  assert.equal(
    (await f.request("/.well-known/oauth-protected-resource")).json.resource,
    f.issuer,
  );
  const manifest = await f.request("/experiment/capabilities");
  assert.equal(manifest.json.experimental, true);
  assert.equal(manifest.json.conformsTo, undefined);
  assert.equal((await f.request("/.well-known/hcp-configuration")).status, 404);
});

test("selected HCP errors carry pinned status, problem type/detail and version, including early rejection", async (t) => {
  const f = await fixture(t);
  for (const [route, options, status, type] of [
    [
      "/v2/grants",
      { headers: { "hcp-version": "9.9" } },
      400,
      "unsupported-version",
    ],
    ["/v2/grants", {}, 401, "invalid-token"],
    [
      "/v2/grants",
      { headers: { authorization: "Bearer invented" } },
      401,
      "invalid-token",
    ],
    [
      "/v2/grants",
      { headers: { host: "foreign.test" } },
      422,
      "malformed-request",
    ],
    [
      "/v2/grants?status=imagined",
      { headers: { authorization: `Bearer ${f.human}` } },
      422,
      "malformed-request",
    ],
  ]) {
    const r = await f.request(route, options);
    assert.equal(r.status, status);
    assert.equal(r.headers["hcp-version"], "2.0");
    assert.equal(r.headers["content-type"], "application/problem+json");
    assert.equal(r.json.type, `https://hcp.example/problems/${type}`);
    assert.equal(r.json.status, status);
    assert.equal(typeof r.json.detail, "string");
  }
  const a = new OAuthDriver(f, "a");
  await a.begin();
  await a.login();
  assert.match(a.page.text, /own use-until/);
  assert.doesNotMatch(a.page.text, /never past grant expiry/);
  await a.review();
  assert.match(a.page.text, /own use-until/);
});

test("PKCE failures, code replay and concurrent exchange never create reusable or unrecorded authority", async (t) => {
  const f = await fixture(t),
    a = new OAuthDriver(f, "a");
  await a.begin();
  await a.login();
  await a.consent();
  assert.equal(
    (await a.exchange({ code_verifier: "wrong".repeat(12) })).status,
    400,
  );
  assert.equal((await a.exchange({ code_verifier: null })).status, 400);
  const good = await a.exchange();
  assert.equal(good.status, 200);
  assert.equal((await a.exchange()).status, 400);
  assert.equal(
    (await f.context("/v2/grants", good.json.access_token)).status,
    401,
  );
  await a.begin();
  await a.consent();
  const pair = await Promise.all([a.exchange(), a.exchange()]);
  assert.ok(pair.filter((r) => r.status === 200).length <= 1);
  assert.ok(pair.some((r) => r.status === 400));
  for (const winner of pair.filter((r) => r.status === 200))
    assert.equal(
      (await f.context("/v2/grants", winner.json.access_token)).status,
      401,
    );
  assert.equal(
    (await f.management("/v2/audit")).json.events.filter(
      (e) => e.eventType === "grant.revoked",
    ).length,
    2,
  );
});

test("CSRF and cross-browser review substitution fail without issuing a grant", async (t) => {
  const f = await fixture(t),
    a = new OAuthDriver(f, "a");
  await a.begin();
  await a.login();
  const reviewed = await a.review();
  assert.equal((await a.approve({ csrf: "wrong" })).status, 403);
  const stolen = await f.request(a.interactionPath + "/approve", {
    method: "POST",
    form: { reviewId: reviewed.reviewId, csrf: reviewed.csrf },
    headers: { origin: f.issuer },
  });
  assert.equal(stolen.status, 403);
  assert.equal((await f.management("/v2/grants")).json.grants.length, 0);
});

test("token exchange rejects extra authority, foreign issuer/resource, cross-client and unsupported parameters", async (t) => {
  const f = await fixture(t),
    a = new OAuthDriver(f, "a");
  await a.begin();
  await a.login();
  for (const patch of [
    { resource: null },
    { resource: "https://foreign.test" },
    { issuer: "https://foreign.test" },
    { subject: "other" },
    { client_id: "b", redirect_uri: f.redirects.b },
    { scope: "hcp:work_context:read" },
    { authorization_details: "[]" },
  ]) {
    if (!a.stage) await a.begin();
    await a.consent();
    const result = await a.exchange(patch);
    assert.equal(result.status, 400, "unsupported token request must fail");
    await a.begin();
  }
  for (const grant_type of [
    "refresh_token",
    "client_credentials",
    "password",
    "urn:ietf:params:oauth:grant-type:device_code",
  ])
    assert.equal(
      (
        await f.request("/token", {
          method: "POST",
          form: { grant_type, client_id: "a", resource: f.issuer },
        })
      ).status,
      400,
    );
});

test("own-grant and token restrictions use only this grant refs; policy withdrawal wins before exchange", async (t) => {
  const f = await fixture(t),
    a = new OAuthDriver(f, "a");
  await a.begin();
  await a.login();
  // Human-only consent labels are the sole place this fixture obtains the private entry ID.
  const privateId = /urn:uuid:[0-9a-f-]{36}/.exec(a.page.text)[0];
  const token = await a.consentAndExchange({ entryIds: privateId });
  assert.equal(token.status, 200);
  const own = await f.context("/v2/grants", token.json.access_token);
  assert.equal(own.status, 200);
  assert.deepEqual(token.json.authorization_details, own.json.grants[0].access);
  assert.equal(
    JSON.stringify(token.json.authorization_details).includes(privateId),
    false,
  );
  assert.match(
    own.json.grants[0].access[0].narrowedTo.entryIds[0],
    /^r_[A-Za-z0-9_-]{32}$/,
  );
  await a.begin();
  await a.consent();
  const policy = await f.management("/experiment/policy", {
    method: "PUT",
    json: { rules: [{ operators: ["example.test"] }], directives: [] },
  });
  assert.equal(policy.status, 200);
  assert.equal((await a.exchange()).status, 400);
  assert.equal(
    (await f.context("/v2/grants", token.json.access_token)).status,
    401,
  );
});
