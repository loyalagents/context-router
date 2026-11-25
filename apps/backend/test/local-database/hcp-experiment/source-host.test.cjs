const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const https = require("node:https");
const { X509Certificate } = require("node:crypto");
const {
  initializeSource,
  readSource,
  serveSource,
  sourceConfiguration,
} = require("../../../dist/infrastructure/hcp-experiment/source.js");
const { request, OAuthDriver, inputs } = require("./authorization-fixture.cjs");
const { rpc, mcpQuery, mcpGet } = require("./mcp-helpers.cjs");

async function freePort() {
  const server = net.createServer();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  await new Promise((r) => server.close(r));
  return port;
}
async function hostFixture(t) {
  const sandbox = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "hcp-c7b-source-")),
  );
  fs.chmodSync(sandbox, 0o700);
  const port = await freePort(),
    callbackPort = await freePort();
  let provider;
  t.after(async () => {
    await provider?.close();
    fs.rmSync(sandbox, { recursive: true, force: true });
  });
  await initializeSource(sandbox, port, async (r) => `approve ${r.digest}`, {
    profile: "claude-code",
    callbackPort,
  });
  const source = readSource(sandbox);
  provider = await serveSource(sandbox);
  const f = {
    sandbox,
    source,
    port,
    callbackPort,
    issuer: provider.issuer,
    human: source.humanCredential,
    redirects: {
      "claude-code-c7b": `https://127.0.0.1:${callbackPort}/callback`,
    },
    request: (route, options) =>
      request(new URL(route, provider.issuer), source.tls, options),
    management: (route, options = {}) =>
      request(new URL(route, provider.issuer), source.tls, {
        ...options,
        headers: {
          authorization: `Bearer ${source.humanCredential}`,
          ...options.headers,
        },
      }),
    async reopen() {
      await provider.close();
      provider = await serveSource(sandbox);
    },
    async stop() {
      await provider.close();
    },
  };
  return f;
}

test("C7b creates a distinct localhost identity, registration and exact two-entry fixture", async (t) => {
  const f = await hostFixture(t),
    d = f.source.descriptor;
  assert.equal(f.issuer, `https://localhost:${f.port}`);
  assert.equal(d.configuration.resource, f.issuer);
  assert.deepEqual(
    d.configuration.clients.map((c) => c.id),
    ["claude-code-c7b"],
  );
  assert.equal(
    d.configuration.clients[0].redirectUri,
    f.redirects["claude-code-c7b"],
  );
  const cert = new X509Certificate(f.source.tls.cert);
  assert.equal(cert.checkHost("localhost"), "localhost");
  assert.equal(cert.checkHost("as.hcp.test"), undefined);
  await f.stop();
  const {
    SyntheticExperiment,
  } = require("../../../dist/infrastructure/hcp-experiment/store.js");
  const store = SyntheticExperiment.open({
    sandbox: f.sandbox,
    root: path.join(f.sandbox, "data"),
  });
  let entries;
  try {
    entries = store.inspectEntries();
  } finally {
    store.close();
  }
  await f.reopen();
  assert.equal(entries.length, 2);
  assert.deepEqual(entries.map((e) => e.content.value).sort(), [
    "Synthetic C7b persona prefers a concise written summary.",
    "Synthetic C7b persona uses the project codename Blue Lantern.",
  ]);
  for (const e of entries) assert.deepEqual(e.evidence, []);
  const before = fs.readFileSync(path.join(f.sandbox, "launcher/ready.json"));
  await f.reopen();
  assert.deepEqual(
    fs.readFileSync(path.join(f.sandbox, "launcher/ready.json")),
    before,
  );
  assert.equal((await rpc(f, undefined, "server/discover")).status, 200);
  assert.equal((await rpc(f, f.human, "tools/list")).status, 401);
  assert.notEqual(
    (await f.request("/manage", { headers: { host: `as.hcp.test:${f.port}` } }))
      .status,
    200,
  );
  await assert.rejects(
    initializeSource(f.sandbox, f.port, async (r) => `approve ${r.digest}`),
  );
});

test("C7b profile rejects malformed selectors/ports and keeps controlled configuration unchanged", () => {
  assert.equal(sourceConfiguration(19443).issuer, "https://as.hcp.test:19443");
  assert.deepEqual(
    sourceConfiguration(19443).clients.map((c) => c.id),
    ["a", "b"],
  );
  for (const options of [
    { profile: "other", callbackPort: 19444 },
    { callbackPort: 19444 },
    { profile: "claude-code" },
    { profile: "claude-code", callbackPort: 19443 },
    { profile: "claude-code", callbackPort: 0 },
    { profile: "claude-code", callbackPort: 65536 },
    {
      profile: "claude-code",
      callbackPort: 19444,
      issuer: "https://example.test",
    },
  ])
    assert.throws(() => sourceConfiguration(19443, options));
});

test("C7b actual TLS requires the private CA and exact hostname", async (t) => {
  const f = await hostFixture(t);
  const probe = (options) =>
    new Promise((resolve, reject) => {
      const req = https.get(
        `https://localhost:${f.port}/.well-known/oauth-protected-resource`,
        {
          agent: false,
          lookup: (_h, _o, cb) =>
            cb(null, [{ address: "127.0.0.1", family: 4 }]),
          ...options,
        },
        (res) => {
          res.resume();
          res.on("end", () => resolve(res.statusCode));
        },
      );
      req.on("error", reject);
    });
  assert.equal(await probe({ ca: f.source.tls.ca }), 200);
  await assert.rejects(probe({}), /certificate|issuer|self.signed/i);
  await assert.rejects(
    probe({ ca: f.source.tls.ca, servername: "wrong.test" }),
    /hostname|altnames/i,
  );
});

test("C7b Code+PKCE separates A/B, allows query/get, denies scope and retains revocation after reopen", async (t) => {
  const f = await hostFixture(t);
  const driver = new OAuthDriver(f, "claude-code-c7b");
  for (const patch of [
    { client_id: "a" },
    { resource: `${f.issuer}/v2/mcp` },
    { redirect_uri: `http://localhost:${f.callbackPort}/callback` },
  ]) {
    assert.equal(
      (await driver.begin({ patch, expectFailure: true })).status,
      400,
    );
  }
  await driver.begin();
  await driver.login();
  await driver.review({ durationSeconds: "900" });
  const response = await driver.approve();
  const posted = inputs(response.text);
  assert.equal(posted.state, driver.state);
  assert.equal(posted.iss, f.issuer);
  driver.code = posted.code; // Controlled test client, never live-human approval.
  const tokenResponse = await driver.exchange();
  assert.equal(tokenResponse.status, 200);
  assert.equal(tokenResponse.json.refresh_token, undefined);
  const token = tokenResponse.json.access_token;
  const result = await mcpQuery(f, token, {
    query: "concise written summary",
    categories: ["general_preferences"],
  });
  assert.equal(result.status, 200);
  const entry = result.json.result.structuredContent.entries[0];
  assert.equal(
    entry.content.value,
    "Synthetic C7b persona prefers a concise written summary.",
  );
  assert.equal((await mcpGet(f, token, entry.ref)).json.result.isError, false);
  assert.equal(
    (await mcpQuery(f, token, { categories: ["work_context"] })).status,
    403,
  );
  await f.reopen();
  assert.equal((await mcpGet(f, token, entry.ref)).json.result.isError, false);
  const grant = (await f.management("/v2/grants")).json.grants[0];
  assert.equal(
    (await f.management(`/v2/grants/${grant.grantId}`, { method: "DELETE" }))
      .status,
    204,
  );
  assert.equal((await mcpGet(f, token, entry.ref)).status, 401);
  await f.reopen();
  assert.equal((await mcpQuery(f, token)).status, 401);
  const audit = (await f.management("/v2/audit?limit=100")).json.events;
  assert.equal(audit.filter((e) => e.eventType === "context.read").length, 3);
});

test("C7b semantic observer accepts real query/get and stops on a mistyped opaque ref despite HTTP 200", async (t) => {
  const {
    observeMcp,
    createTrialEvidence,
  } = require("../../../../../scripts/hcp/mcp-observer.mjs");
  const f = await hostFixture(t);
  const driver = new OAuthDriver(f, "claude-code-c7b");
  await driver.begin();
  await driver.login();
  await driver.review({ durationSeconds: "900" });
  driver.code = inputs((await driver.approve()).text).code;
  const token = (await driver.exchange()).json.access_token;
  let stopped = 0;
  const evidence = createTrialEvidence(() => stopped++);
  const observer = observeMcp(f.issuer, evidence.accept);
  t.after(() => observer.close());
  const result = await mcpQuery(f, token, {
    query: "concise written summary",
    categories: ["general_preferences"],
    maxEntries: 1,
  });
  const ref = result.json.result.structuredContent.entries[0].ref;
  assert.equal((await mcpGet(f, token, ref)).json.result.isError, false);
  evidence.assertStage();
  assert.equal(stopped, 0);
  assert.deepEqual(
    observer.events.map((e) => e.outcome),
    ["success", "success"],
  );
  const denied = await mcpGet(f, token, ref + "J");
  assert.equal(denied.status, 200);
  assert.equal(denied.json.result.isError, true);
  assert.equal(observer.events[2].outcome, "tool-error");
  assert.equal(observer.events[2].requestRefMatches, false);
  assert.equal(stopped, 1);
  assert.throws(() => evidence.advance());
  const retained = JSON.stringify(observer.events);
  for (const secret of [ref, token, f.human])
    assert.equal(retained.includes(secret), false);
});

test("C7b real helper consumes its callback once and validates the actual narrow grant before launch", async (t) => {
  const {
    openAuthorization,
  } = require("../../../../../scripts/hcp/authorize-host.mjs");
  const f = await hostFixture(t);
  const flow = await openAuthorization(f.source);
  t.after(() => flow.close());
  const driver = new OAuthDriver(f, "claude-code-c7b");
  await driver.begin({
    patch: Object.fromEntries(new URL(flow.url).searchParams),
  });
  await driver.login();
  await driver.review({ durationSeconds: "900" });
  const form = inputs((await driver.approve()).text);
  const callback = () =>
    request(f.redirects["claude-code-c7b"], f.source.tls, {
      method: "POST",
      headers: { origin: f.issuer },
      form,
    });
  assert.equal((await callback()).status, 200);
  const result = await flow.wait;
  assert.equal(typeof result.token, "string");
  assert.equal((await mcpQuery(f, result.token)).status, 200);
  assert.equal((await callback()).status, 400);
});

test("C7b real helper refuses the consent form default four-hour grant", async (t) => {
  const {
    openAuthorization,
  } = require("../../../../../scripts/hcp/authorize-host.mjs");
  const f = await hostFixture(t);
  const flow = await openAuthorization(f.source);
  t.after(() => flow.close());
  const driver = new OAuthDriver(f, "claude-code-c7b");
  await driver.begin({
    patch: Object.fromEntries(new URL(flow.url).searchParams),
  });
  await driver.login();
  await driver.review({ durationSeconds: "14400" });
  const form = inputs((await driver.approve()).text);
  assert.equal(
    (
      await request(f.redirects["claude-code-c7b"], f.source.tls, {
        method: "POST",
        headers: { origin: f.issuer },
        form,
      })
    ).status,
    400,
  );
  await assert.rejects(flow.wait, /refused/);
});

module.exports = { hostFixture };
