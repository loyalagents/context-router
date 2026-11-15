const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createPublicKey, verify } = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");
const path = require("node:path");
const fs = require("node:fs"),
  { execFileSync } = require("node:child_process");
const { fixture } = require("./authorization-fixture.cjs");
const { authorize, query } = require("./read-helpers.cjs");
const waitFor = async (predicate) => {
  for (let n = 0; n < 60; n++) {
    const value = await predicate();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("Notification fixture timed out");
};
for (const [operation, point] of [
  ["prepareNotification", "before-commit"],
  ["finishNotification", "before-audit"],
  ["finishNotification", "before-commit"],
])
  test(`C5 notification ${operation} ${point} crash preserves revocation and uncertain-attempt accounting`, async (t) => {
    const f = await fixture(t, {
        approveFixtures: true,
        childProcess: true,
        notifications: true,
      }),
      token = await authorize(f);
    await query(f, token);
    const id = (await f.context("/v2/grants", token)).json.grants[0].grantId,
      audit = (await f.management("/v2/audit?eventType=context.read")).json
        .events;
    const lastUseUntil = audit
      .flatMap((e) => e.disclosed)
      .map((d) => d.useUntil)
      .sort()
      .at(-1);
    await f.arm({ operation, point, action: "block" });
    await f.management(`/v2/grants/${id}`, { method: "DELETE" });
    await f.boundary();
    await f.kill();
    const priorToken = f.notificationRequests[0]?.token;
    await f.restart();
    const event = await waitFor(
      async () =>
        (await f.management("/v2/audit?eventType=revocation.notified")).json
          ?.events[0],
    );
    assert.equal(event.data.attempts, 1);
    assert.equal(event.data.lastUseUntil, lastUseUntil);
    assert.equal((await f.context("/v2/grants", token)).status, 401);
    if (priorToken) {
      assert.equal(f.notificationRequests.length, 2);
      assert.equal(f.notificationRequests[1].token, priorToken);
    }
  });
test("C5 a stalled receiver never delays a later human revocation", async (t) => {
  const f = await fixture(t, {
      approveFixtures: true,
      notifications: true,
      notificationStatuses: [503],
      notificationBody: "stalled",
    }),
    one = await authorize(f),
    two = await authorize(f);
  await query(f, one);
  await query(f, two);
  const ids = await Promise.all(
    [one, two].map(
      async (token) =>
        (await f.context("/v2/grants", token)).json.grants[0].grantId,
    ),
  );
  await f.management(`/v2/grants/${ids[0]}`, { method: "DELETE" });
  await waitFor(() => f.notificationRequests.length === 1);
  const before = Date.now();
  assert.equal(
    (await f.management(`/v2/grants/${ids[1]}`, { method: "DELETE" })).status,
    204,
  );
  assert.ok(Date.now() - before < 2000);
  assert.equal((await f.context("/v2/grants", two)).status, 401);
});
for (const failure of ["untrusted-ca", "wrong-hostname", "redirect"])
  test(`C5 notification transport rejects ${failure} without following another destination`, async (t) => {
    const f = await fixture(t, {
        approveFixtures: true,
        notifications: true,
        ...(failure === "untrusted-ca"
          ? { notificationCa: Buffer.from("untrusted fixture CA") }
          : {}),
        ...(failure === "redirect" ? { notificationStatuses: [302] } : {}),
      }),
      token = await authorize(f);
    await query(f, token);
    if (failure === "wrong-hostname") {
      const dir = path.join(f.sandbox, "tls");
      fs.writeFileSync(
        path.join(dir, "wrong.ext"),
        "basicConstraints=critical,CA:FALSE\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:wrong.hcp.test\n",
      );
      execFileSync(
        "openssl",
        [
          "x509",
          "-req",
          "-in",
          "leaf.csr",
          "-CA",
          "ca.pem",
          "-CAkey",
          "ca.key",
          "-CAcreateserial",
          "-days",
          "2",
          "-sha256",
          "-extfile",
          "wrong.ext",
          "-out",
          "wrong.pem",
        ],
        { cwd: dir, stdio: "ignore" },
      );
      f.notificationTls({
        key: f.tls.key,
        cert: fs.readFileSync(path.join(dir, "wrong.pem")),
      });
    }
    const id = (await f.context("/v2/grants", token)).json.grants[0].grantId;
    await f.management(`/v2/grants/${id}`, { method: "DELETE" });
    await waitFor(() => {
      const db = new DatabaseSync(
        path.join(f.sandbox, "experiment", "entries.sqlite"),
        { readOnly: true },
      );
      try {
        return (
          db
            .prepare("SELECT attempts FROM revocation_outbox WHERE grant_id=?")
            .get(id)?.attempts === 1
        );
      } finally {
        db.close();
      }
    });
    assert.equal(f.notificationRequests.length, failure === "redirect" ? 1 : 0);
    assert.deepEqual(
      (await f.management("/v2/audit?eventType=revocation.notified")).json
        .events,
      [],
    );
    assert.equal((await f.context("/v2/grants", token)).status, 401);
  });
for (const status of [202, 400])
  for (const notificationBody of ["oversized", "stalled"])
    test(`C5 terminal ${status} remains terminal with ${notificationBody} response body`, async (t) => {
      const f = await fixture(t, {
        approveFixtures: true,
        notifications: true,
        notificationStatuses: [status],
        notificationBody,
      });
      const token = await authorize(f);
      await query(f, token);
      const id = (await f.context("/v2/grants", token)).json.grants[0].grantId;
      await f.management(`/v2/grants/${id}`, { method: "DELETE" });
      const event = await waitFor(
        async () =>
          (await f.management("/v2/audit?eventType=revocation.notified")).json
            ?.events[0],
      );
      assert.equal(
        event.data.outcome,
        status === 202 ? "delivered" : "abandoned",
      );
      assert.equal(event.data.attempts, 1);
      assert.equal(event.data.error, undefined);
    });
for (const strict of [false, true])
  test(`C5 exact signed SET survives restart and stale receiver ${strict ? "rejects" : "accepts by explicit exception"}`, async (t) => {
    const f = await fixture(t, {
      approveFixtures: true,
      childProcess: true,
      notifications: true,
      notificationStatuses: [503, 202],
      notificationStrictAge: strict,
    });
    const token = await authorize(f);
    await query(f, token);
    const grant = (await f.context("/v2/grants", token)).json.grants[0];
    assert.equal(grant.client.legalRetention.period, "7 years");
    assert.equal(
      (await f.management(`/v2/grants/${grant.grantId}`, { method: "DELETE" }))
        .status,
      204,
    );
    assert.equal((await f.context("/v2/grants", token)).status, 401);
    await waitFor(() => f.notificationRequests.length === 1);
    const first = f.notificationRequests[0],
      [h, p, signature] = first.token.split("."),
      header = JSON.parse(Buffer.from(h, "base64url")),
      payload = JSON.parse(Buffer.from(p, "base64url"));
    assert.equal(first.headers["content-type"], "application/secevent+jwt");
    const key = (await f.request("/jwks")).json.keys.find(
      (key) => key.kid === header.kid,
    );
    assert.ok(
      verify(
        "RSA-SHA256",
        Buffer.from(`${h}.${p}`),
        createPublicKey({ key, format: "jwk" }),
        Buffer.from(signature, "base64url"),
      ),
    );
    const pending = (await f.management("/v2/disclosures")).json.clients[0];
    assert.equal(pending.notification, "none");
    assert.deepEqual(pending.pendingNotifications, [grant.grantId]);
    // First failed response has completed before restart; no catch-up delivery burst.
    await new Promise((r) => setTimeout(r, 100));
    const later = Date.now() + 48 * 3600_000;
    f.notificationClock(later);
    await f.restart({ now: later });
    await waitFor(() => f.notificationRequests.length === 2);
    assert.equal(f.notificationRequests[1].token, first.token);
    const event = await waitFor(
      async () =>
        (await f.management("/v2/audit?eventType=revocation.notified")).json
          ?.events[0],
    );
    assert.equal(event.data.outcome, strict ? "abandoned" : "delivered");
    assert.equal(event.data.attempts, 2);
    assert.equal(
      payload.events["https://hcp.example/spec/events/grant-revoked"].grantId,
      grant.grantId,
    );
  });
