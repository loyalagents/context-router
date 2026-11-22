const { test } = require("node:test");
const assert = require("node:assert/strict");
const { fixture } = require("./authorization-fixture.cjs");
const { authorize, query } = require("./read-helpers.cjs");
const {
  AuthorizationRepository,
} = require("../../../dist/infrastructure/hcp-experiment/authority.js");

for (const mode of ["envelope", "throw", "async", "expire"])
  test(`C7 whole-response serializer: ${mode}`, async (t) => {
    const release = AuthorizationRepository.prototype.releaseRead;
    let now;
    const f = await fixture(t, {
      approveFixtures: true,
      clock: () => now ?? Date.now(),
    });
    const token = await authorize(f);
    t.after(() => {
      AuthorizationRepository.prototype.releaseRead = release;
    });
    let serialized = false,
      observedAudit;
    AuthorizationRepository.prototype.releaseRead = function (ticket, handoff) {
      return release.call(
        this,
        ticket,
        (bytes) => {
          assert.equal(serialized, true);
          observedAudit = this.audit(f.human, {}).events.filter(
            (e) => e.eventType === "context.read",
          ).length;
          handoff(bytes);
        },
        (result) => {
          serialized = true;
          if (mode === "throw") throw new Error("private-canary-serializer");
          if (mode === "async") return Promise.resolve("not-synchronous");
          const bytes = JSON.stringify({ jsonrpc: "2.0", id: 1, result });
          if (mode === "expire") now = Date.now() + 3600_000;
          return bytes;
        },
      );
    };
    const result = await query(f, token);
    if (mode === "envelope") {
      assert.equal(result.status, 200);
      assert.equal(result.json.result.entries.length, 1);
      assert.equal(observedAudit, 1);
    } else {
      assert.equal(result.status, mode === "expire" ? 401 : 503);
      assert.equal(result.text.includes("private-canary"), false);
      assert.equal(result.json.entries, undefined);
      if (mode === "throw" || mode === "async")
        assert.equal((await f.management("/v2/audit")).status, 503);
      // Unexpected serializer faults latch the store unavailable. Reopen under its
      // normal ownership protocol before inspecting rollback; never bypass the latch.
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
          clients: f.clients,
          humanCredential: f.human,
          port: Number(new URL(f.issuer).port),
          clock: () => now ?? Date.now(),
        },
      );
      try {
        const response = await f.management("/v2/audit");
        assert.equal(response.status, 200);
        assert.equal(
          response.json.events.filter((e) => e.eventType === "context.read")
            .length,
          0,
        );
      } finally {
        await reopened.close();
      }
    }
  });
