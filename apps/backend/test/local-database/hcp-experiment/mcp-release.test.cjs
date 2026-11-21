const { test } = require("node:test"),
  assert = require("node:assert/strict");
const { fixture } = require("./authorization-fixture.cjs");
const { authorize, query } = require("./read-helpers.cjs");
const { mcpQuery } = require("./mcp-helpers.cjs");
const reads = async (f) =>
  (await f.management("/v2/audit?limit=100")).json.events.filter(
    (e) => e.eventType === "context.read",
  );

test("C7 source launcher serves the binding with exact consent, retained audit and no authority revival on reopen", async (t) => {
  const { sourceFixture } = require("./source-fixture.cjs");
  const {
    readSource,
  } = require("../../../dist/infrastructure/hcp-experiment/source.js");
  const { OAuthDriver, inputs } = require("./authorization-fixture.cjs");
  const { rpc, mcpGet } = require("./mcp-helpers.cjs");
  const f = await sourceFixture(t),
    source = readSource(f.sandbox);
  f.redirects = Object.fromEntries(
    source.descriptor.configuration.clients.map((c) => [c.id, c.redirectUri]),
  );
  const d = new OAuthDriver(f, "a");
  // This controlled source client consumes the exact form_post payload directly;
  // no callback listener or browser/host redirect-delivery claim is made here.
  d.capture = async (response) => {
    assert.equal(response.status, 200);
    assert.ok(response.text.includes(`action="${f.redirects.a}"`));
    const fields = inputs(response.text);
    assert.equal(fields.state, d.state);
    assert.equal(fields.iss, f.issuer);
    assert.equal(typeof fields.code, "string");
    d.code = fields.code;
  };
  await d.begin();
  await d.login();
  const auth = await d.consentAndExchange();
  assert.equal(auth.status, 200);
  const token = auth.json.access_token;
  assert.equal((await rpc(f, token, "tools/list")).json.result.tools.length, 2);
  const first = await mcpQuery(f, token);
  assert.equal(first.json.result.isError, false);
  const value = first.json.result.structuredContent;
  assert.equal(
    (await mcpGet(f, token, value.entries[0].ref, { version: 1 })).json.result
      .structuredContent.entry.version,
    1,
  );
  const before = await reads(f);
  assert.equal(before.length, 2);
  await f.restart();
  assert.deepEqual(await reads(f), before);
  const grant = (await f.management("/v2/grants")).json.grants[0];
  assert.equal(
    (await f.management(`/v2/grants/${grant.grantId}`, { method: "DELETE" }))
      .status,
    204,
  );
  await f.restart();
  assert.equal((await mcpQuery(f, token)).status, 401);
  assert.deepEqual(await reads(f), before);
});

for (const action of ["advance", "throw"])
  test(`C7 whole MCP envelope ${action} before audit rolls back and releases no success`, async (t) => {
    const f = await fixture(t, { childProcess: true, approveFixtures: true }),
      token = await authorize(f);
    await f.arm({
      point: "during-mcp-serialization",
      operation: "releaseRead",
      action,
      now: Date.now() + 3600_000,
    });
    const r = await mcpQuery(f, token);
    assert.equal(r.status, action === "advance" ? 401 : 500);
    assert.equal(r.json.result, undefined);
    await f.restart();
    assert.equal((await reads(f)).length, 0);
    assert.equal((await mcpQuery(f, token)).json.result.isError, false);
  });

for (const binding of [query, mcpQuery])
  test(`C7 ${binding.name} policy change then restore permanently invalidates a prepared read`, async (t) => {
    const f = await fixture(t, { childProcess: true, approveFixtures: true }),
      token = await authorize(f);
    await f.arm({ point: "after-preparation", action: "yield" });
    const pending = binding(f, token);
    assert.equal(await f.boundary(), "after-preparation");
    for (const directives of [
      [{ action: "share", effect: "deny", text: "Temporary restriction" }],
      [],
    ])
      assert.equal(
        (
          await f.management("/experiment/policy", {
            method: "PUT",
            json: { rules: [], directives },
          })
        ).status,
        200,
      );
    await f.resume();
    const r = await pending;
    if (binding === query) assert.equal(r.status, 403);
    else {
      assert.equal(r.status, 200);
      assert.equal(r.json.result.structuredContent.type, "scope-denied");
      assert.equal(r.headers["www-authenticate"], undefined);
    }
    assert.equal((await reads(f)).length, 0);
    assert.equal((await binding(f, token)).status, 200);
  });

// Ordinary issued temporary tokens expire no later than their grants. Inject only
// the grant deadline at the authenticated authority seam to independently test
// that final release checks it even when the real token remains valid for an hour.
for (const binding of [query, mcpQuery])
  for (const boundary of ["serialization", "commit"])
    test(`C7 ${binding.name} independent grant deadline at ${boundary}`, async (t) => {
      const {
        AuthorizationRepository,
      } = require("../../../dist/infrastructure/hcp-experiment/authority.js");
      const read = AuthorizationRepository.prototype.readAuthority,
        release = AuthorizationRepository.prototype.releaseRead;
      let now,
        crossing,
        armed = false;
      const f = await fixture(t, {
        approveFixtures: true,
        clock: () => now ?? Date.now(),
        fault: (point) => {
          if (armed && boundary === "commit" && point === "after-data-commit") {
            now = crossing;
            armed = false;
          }
        },
      });
      const token = await authorize(f);
      crossing = Date.now() + 60_000;
      let tokenUntil;
      AuthorizationRepository.prototype.readAuthority = function (...args) {
        const result = read.apply(this, args);
        tokenUntil = result.tokenUntil;
        result.grant.expiresAt = new Date(crossing).toISOString();
        return result;
      };
      AuthorizationRepository.prototype.releaseRead = function (
        ticket,
        handoff,
        serialize = JSON.stringify,
      ) {
        armed = true;
        return release.call(this, ticket, handoff, (result) => {
          const bytes = serialize(result);
          if (boundary === "serialization") now = crossing;
          return bytes;
        });
      };
      try {
        const r = await binding(f, token);
        assert.equal(r.status, 401);
        assert.ok(tokenUntil > crossing);
        assert.equal(r.json.result, undefined);
        assert.equal(r.json.entries, undefined);
        assert.equal((await reads(f)).length, boundary === "commit" ? 1 : 0);
        assert.equal((await f.context("/v2/grants", token)).status, 200); // real OAuth credential still valid
      } finally {
        AuthorizationRepository.prototype.readAuthority = read;
        AuthorizationRepository.prototype.releaseRead = release;
      }
    });
