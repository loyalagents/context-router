const { validCandidate } = require("./candidate-contract.cjs");
const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  { randomUUID } = require("node:crypto");
const { fixture } = require("./authorization-fixture.cjs");
const { authorize, query, get } = require("./read-helpers.cjs");
async function transfer(f) {
  const bundle = (await f.management("/v2/export")).json,
    entry = bundle.entries.find((e) => e.record.status === "active");
  bundle.subject.id = entry.subject.id = "urn:foreign:synthetic-person";
  entry.id = `urn:uuid:${randomUUID()}`;
  entry.record.version = 1;
  entry.record.relationships = [];
  bundle.entries = [entry];
  const r = (
    await f.management("/experiment/import/review", {
      method: "POST",
      json: { export: JSON.stringify(bundle) },
    })
  ).json;
  return {
    entry,
    decision: { reviewId: r.reviewId, csrf: r.csrf, subjects: r.subjects },
  };
}
for (const point of ["before-audit", "before-commit", "after-data-commit"])
  test(`C5 import ${point} crash preserves atomic outcomes and exact-review recovery`, async (t) => {
    const f = await fixture(t, { approveFixtures: true, childProcess: true }),
      { entry, decision } = await transfer(f);
    await f.arm({ operation: "applyImport", point, action: "block" });
    const pending = f
      .management("/v2/import", { method: "POST", json: decision })
      .catch(() => null);
    await f.boundary();
    await f.kill();
    await pending;
    await f.restart();
    const result = await f.management("/v2/import", {
      method: "POST",
      json: decision,
    });
    assert.equal(result.status, 200);
    validCandidate("operations/import-result.json", result.json);
    assert.equal(result.json.outcomes[0].outcome, "imported");
    assert.equal(
      (await f.management("/v2/export")).json.entries.filter(
        (e) => e.id === entry.id,
      ).length,
      1,
    );
    assert.equal(
      (await f.management("/v2/audit?eventType=context.imported")).json.events
        .length,
      1,
    );
  });
test("C5 export cannot succeed when its required audit append fails", async (t) => {
  const f = await fixture(t, { approveFixtures: true, childProcess: true });
  await f.arm({
    operation: "exportContext",
    point: "before-audit",
    action: "throw",
  });
  const result = await f.management("/v2/export");
  assert.notEqual(result.status, 200);
  await f.restart();
  assert.deepEqual(
    (await f.management("/v2/audit?eventType=context.exported")).json.events,
    [],
  );
});
test("C5 rejected current imports never enter authorized query/get while deleted source remains retained", async (t) => {
  const f = await fixture(t, { approveFixtures: true, childProcess: true });
  const bundle = (await f.management("/v2/export")).json,
    entry = structuredClone(
      bundle.entries.find((e) => e.record.status === "active"),
    );
  entry.id = `urn:uuid:${randomUUID()}`;
  entry.subject.id = bundle.subject.id = "urn:foreign:rejected-subject";
  entry.content.value = "private rejected transfer sentinel";
  entry.classification.categories = ["general_preferences"];
  entry.record.version = 1;
  entry.record.relationships = [];
  entry.record.provenance.confirmations = [
    {
      disposition: "rejected",
      confirmedBy: { id: entry.subject.id },
      confirmedAt: new Date().toISOString(),
    },
  ];
  const deleted = structuredClone(entry);
  deleted.id = `urn:uuid:${randomUUID()}`;
  deleted.record.status = "deleted";
  bundle.entries = [entry, deleted];
  const raw = JSON.stringify(bundle);
  const preview = await f.management("/v2/import?dryRun=true", {
    method: "POST",
    json: { export: raw },
  });
  const review = (
    await f.management("/experiment/import/review", {
      method: "POST",
      json: { export: raw },
    })
  ).json;
  const result = await f.management("/v2/import", {
    method: "POST",
    json: {
      reviewId: review.reviewId,
      csrf: review.csrf,
      subjects: review.subjects,
    },
  });
  assert.equal(result.status, 200);
  assert.deepEqual(result.json.outcomes, preview.json.outcomes);
  const token = await authorize(f);
  const found = await query(f, token, {
    query: "private rejected transfer sentinel",
  });
  assert.equal(found.status, 200);
  assert.deepEqual(found.json.entries, []);
  assert.doesNotMatch(found.text, /private rejected transfer sentinel/);
  // A real authorized query/get control distinguishes non-disclosure from a broken grant.
  const readable = await query(f, token);
  assert.equal((await get(f, token, readable.json.entries[0].ref)).status, 200);
  for (const id of [entry.id, deleted.id]) {
    const denied = await get(f, token, id);
    assert.equal(denied.status, 403);
    assert.doesNotMatch(denied.text, /private rejected transfer sentinel/);
  }
  assert.equal(preview.json.outcomes[0].outcome, "rejected");
  assert.equal(preview.json.outcomes[1].outcome, "imported");
  await f.restart();
  const exported = (await f.management("/v2/export")).json.entries;
  assert.equal(
    exported.some((e) => e.id === entry.id),
    false,
  );
  assert.deepEqual(
    exported.find((e) => e.id === deleted.id),
    deleted,
  );
  assert.equal(JSON.stringify(bundle), raw);
});
test("C5 exact raw history retries and re-exported history remain duplicates after restart", async (t) => {
  const f = await fixture(t, { approveFixtures: true, childProcess: true });
  const bundle = (await f.management("/v2/export")).json,
    entry = structuredClone(
      bundle.entries.find((e) => e.record.status === "active"),
    );
  entry.id = `urn:uuid:${randomUUID()}`;
  entry.subject.id = bundle.subject.id = "urn:foreign:versioned-subject";
  entry.record.relationships = [];
  entry.record.version = 1;
  entry.classification.categories = ["general_preferences"];
  entry.classification.permittedPurposes = ["urn:purpose:previous"];
  const previous = structuredClone(entry);
  previous.content.value = "previous private wording";
  entry.record.version = 2;
  entry.classification.categories = ["work_context"];
  entry.classification.permittedPurposes = ["urn:purpose:current"];
  bundle.entries = [entry];
  bundle.versions = [previous];
  const raw = JSON.stringify(bundle);
  const apply = async (source) => {
    const review = (
      await f.management("/experiment/import/review", {
        method: "POST",
        json: { export: source },
      })
    ).json;
    const result = await f.management("/v2/import", {
      method: "POST",
      json: {
        reviewId: review.reviewId,
        csrf: review.csrf,
        subjects: review.subjects,
      },
    });
    assert.equal(result.status, 200);
    return result.json;
  };
  assert.equal((await apply(raw)).outcomes[0].outcome, "imported");
  await f.restart();
  assert.equal((await apply(raw)).outcomes[0].outcome, "skipped");
  const exported = (await f.management("/v2/export?include=versions")).json;
  exported.entries = exported.entries.filter((e) => e.id === entry.id);
  exported.versions = exported.versions.filter((e) => e.id === entry.id);
  assert.equal(exported.entries.length, 1);
  assert.equal(exported.versions.length, 1);
  assert.deepEqual(exported.versions[0].classification, entry.classification);
  assert.equal(
    (await apply(JSON.stringify(exported))).outcomes[0].outcome,
    "skipped",
  );
});
for (const browser of [false, true])
  for (const point of [
    "before-commit",
    "after-data-commit",
    "during-management-serialization",
    ...(browser ? ["during-management-page-render"] : []),
  ])
    test(`C5 ${browser ? "browser" : "API"} import expiry ${point} preserves truthful completion`, async (t) => {
      const { OAuthDriver, inputs } = require("./authorization-fixture.cjs");
      const f = await fixture(t, { approveFixtures: true, childProcess: true }),
        d = new OAuthDriver(f, "a");
      await d.begin();
      await d.login();
      const session = d.jar.get("__Host-hcp-human"),
        { entry } = await transfer(f),
        bundle = (await f.management("/v2/export")).json;
      bundle.entries = [entry];
      let decision;
      if (browser) {
        const page = await d.request("/manage/import");
        const reviewed = await d.request("/manage/import", {
          method: "POST",
          headers: { origin: f.issuer },
          form: {
            csrf: inputs(page.text).csrf,
            action: "review",
            source: JSON.stringify(bundle),
            mapping: "{}",
          },
        });
        assert.equal(reviewed.status, 200);
        decision = { ...inputs(reviewed.text), attest: "yes" };
      } else {
        const r = (
          await f.context("/experiment/import/review", session, {
            method: "POST",
            json: { export: JSON.stringify(bundle) },
          })
        ).json;
        decision = { reviewId: r.reviewId, csrf: r.csrf, subjects: r.subjects };
      }
      await f.arm({
        operation: "applyImport",
        point,
        action: "advance",
        now: Date.now() + 12 * 3600_000 + 1000,
      });
      const result = browser
        ? await d.request("/manage/import/approve", {
            method: "POST",
            headers: { origin: f.issuer },
            form: decision,
          })
        : await f.context("/v2/import", session, {
            method: "POST",
            json: decision,
          });
      assert.equal(result.status, point === "before-commit" ? 401 : 200);
      if (point !== "before-commit") {
        if (browser) assert.match(result.text, /Import recorded/);
        else {
          validCandidate("operations/import-result.json", result.json);
          validCandidate("operations/completion-result.json", result.json);
          assert.deepEqual(result.json, {
            outcome: "committed",
            representation: "not-included",
          });
        }
      }
      assert.doesNotMatch(
        result.text,
        /urn:uuid|written notes|foreign:|association|outcomes/,
      );
      await f.restart();
      const events = (
        await f.management("/v2/audit?eventType=context.imported")
      ).json.events;
      assert.equal(events.length, point === "before-commit" ? 0 : 1);
      assert.equal(
        (await f.management("/v2/export")).json.entries.filter(
          (e) => e.id === entry.id,
        ).length,
        point === "before-commit" ? 0 : 1,
      );
    });
for (const browser of [false, true])
  for (const point of [
    "during-management-serialization",
    ...(browser ? ["during-management-page-render"] : []),
  ])
    for (const mode of [
      "session",
      "review",
      "original-review",
      ...(point === "during-management-page-render" ? ["adjacent-clock"] : []),
    ])
      test(`C8 ${browser ? "browser" : "API"} import ${mode} expiry at ${point}`, async (t) => {
        const { OAuthDriver, inputs } = require("./authorization-fixture.cjs");
        const f = await fixture(t, {
            approveFixtures: true,
            childProcess: true,
          }),
          d = new OAuthDriver(f, "a");
        await d.begin();
        await d.login();
        const session = d.jar.get("__Host-hcp-human"),
          { entry } = await transfer(f),
          bundle = (await f.management("/v2/export")).json;
        bundle.entries = [entry];
        let decision;
        if (browser) {
          const page = await d.request("/manage/import");
          const reviewed = await d.request("/manage/import", {
            method: "POST",
            headers: { origin: f.issuer },
            form: {
              csrf: inputs(page.text).csrf,
              action: "review",
              source: JSON.stringify(bundle),
              mapping: "{}",
            },
          });
          assert.equal(reviewed.status, 200);
          decision = { ...inputs(reviewed.text), attest: "yes" };
        } else {
          const reviewed = await f.context(
            "/experiment/import/review",
            session,
            {
              method: "POST",
              json: { export: JSON.stringify(bundle) },
            },
          );
          assert.equal(reviewed.status, 200);
          const r = reviewed.json;
          decision = {
            reviewId: r.reviewId,
            csrf: r.csrf,
            subjects: r.subjects,
          };
        }
        const apply = () =>
          browser
            ? d.request("/manage/import/approve", {
                method: "POST",
                headers: { origin: f.issuer },
                form: decision,
              })
            : f.context("/v2/import", session, {
                method: "POST",
                json: decision,
              });
        const originalPath = ["original-review", "adjacent-clock"].includes(
          mode,
        );
        if (!originalPath) {
          const original = await apply(),
            replay = await apply();
          assert.equal(original.status, 200);
          assert.equal(replay.status, 200);
          if (browser) {
            assert.match(replay.text, /Import recorded/);
            assert.ok(replay.text.includes(entry.id));
          } else {
            assert.deepEqual(replay.json, original.json);
            assert.equal(replay.json.outcomes[0].outcome, "imported");
            assert.equal("original" in replay.json, false);
          }
        }
        await f.arm({
          operation: "applyImport",
          point,
          action: "advance",
          now:
            Date.now() +
            (mode === "adjacent-clock"
              ? 0
              : mode === "session"
                ? 12 * 3600_000 + 1000
                : 600_001),
          ...(mode === "adjacent-clock"
            ? { nextNow: Date.now() + 12 * 3600_000 + 1000 }
            : {}),
        });
        const expired = await apply();
        assert.equal(
          expired.status,
          originalPath ? 200 : mode === "session" ? 401 : 403,
        );
        if (mode === "original-review")
          assert.ok(expired.text.includes(entry.id));
        else if (mode === "adjacent-clock") {
          assert.match(expired.text, /committed/);
          assert.doesNotMatch(expired.text, /urn:uuid|foreign:|outcomes/);
        } else
          assert.doesNotMatch(
            expired.text,
            /committed|Import recorded|urn:uuid|written notes|foreign:|association|outcomes/,
          );
        await f.restart();
        assert.equal(
          (await f.management("/v2/audit?eventType=context.imported")).json
            .events.length,
          1,
        );
        assert.equal(
          (await f.management("/v2/export")).json.entries.filter(
            (e) => e.id === entry.id,
          ).length,
          1,
        );
      });

test("C8 zero-entry import commits one audit event, while dry run commits none", async (t) => {
  const f = await fixture(t, { approveFixtures: true, childProcess: true });
  const bundle = (await f.management("/v2/export")).json;
  for (const key of [
    "entries",
    "versions",
    "rules",
    "directives",
    "delegations",
    "audit",
  ])
    bundle[key] = [];
  const source = JSON.stringify(bundle);
  const preview = await f.management("/v2/import?dryRun=true", {
    method: "POST",
    json: { export: source },
  });
  assert.equal(preview.status, 200);
  assert.deepEqual(preview.json.outcomes, []);
  assert.equal(
    (await f.management("/v2/audit?eventType=context.imported")).json.events
      .length,
    0,
  );
  const review = (
    await f.management("/experiment/import/review", {
      method: "POST",
      json: { export: source },
    })
  ).json;
  const decision = {
    reviewId: review.reviewId,
    csrf: review.csrf,
    subjects: review.subjects,
  };
  const original = await f.management("/v2/import", {
    method: "POST",
    json: decision,
  });
  assert.equal(original.status, 200);
  assert.deepEqual(original.json.outcomes, []);
  await f.restart();
  const replay = await f.management("/v2/import", {
    method: "POST",
    json: decision,
  });
  assert.deepEqual(replay.json, original.json);
  assert.equal(
    (await f.management("/v2/audit?eventType=context.imported")).json.events
      .length,
    1,
  );
});

for (const [route, operation] of [
  ["/v2/export", "exportContext"],
  ["/v2/audit/export", "exportAudit"],
])
  for (const point of [
    "before-commit",
    "after-data-commit",
    "during-management-serialization",
  ])
    test(`C5 ${operation} ${point} expiry records only attempted release`, async (t) => {
      const { OAuthDriver } = require("./authorization-fixture.cjs");
      const f = await fixture(t, { approveFixtures: true, childProcess: true }),
        d = new OAuthDriver(f, "a");
      await d.begin();
      await d.login();
      await f.arm({
        operation,
        point,
        action: "advance",
        now: Date.now() + 12 * 3600_000 + 1000,
      });
      const result = await f.context(route, d.jar.get("__Host-hcp-human"));
      assert.equal(result.status, 401);
      assert.doesNotMatch(
        result.text,
        /written notes|urn:uuid|context.created/,
      );
      await f.restart();
      const events = (
        await f.management("/v2/audit?eventType=context.exported")
      ).json.events;
      assert.equal(events.length, point === "before-commit" ? 0 : 1);
      for (const event of events) assert.equal(event.data.release, "attempted");
    });
for (const browser of [false, true])
  test(`C5 ${browser ? "browser" : "API"} uncertain import error does not claim completion`, async (t) => {
    const { OAuthDriver, inputs } = require("./authorization-fixture.cjs");
    const f = await fixture(t, { approveFixtures: true, childProcess: true }),
      d = new OAuthDriver(f, "a");
    await d.begin();
    await d.login();
    const session = d.jar.get("__Host-hcp-human"),
      { entry } = await transfer(f),
      bundle = (await f.management("/v2/export")).json;
    bundle.entries = [entry];
    let decision;
    if (browser) {
      const page = await d.request("/manage/import");
      const review = await d.request("/manage/import", {
        method: "POST",
        headers: { origin: f.issuer },
        form: {
          csrf: inputs(page.text).csrf,
          action: "review",
          source: JSON.stringify(bundle),
          mapping: "{}",
        },
      });
      decision = { ...inputs(review.text), attest: "yes" };
    } else {
      const r = (
        await f.context("/experiment/import/review", session, {
          method: "POST",
          json: { export: JSON.stringify(bundle) },
        })
      ).json;
      decision = { reviewId: r.reviewId, csrf: r.csrf, subjects: r.subjects };
    }
    await f.arm({
      operation: "applyImport",
      point: "after-data-commit",
      action: "throw",
    });
    const result = browser
      ? await d.request("/manage/import/approve", {
          method: "POST",
          headers: { origin: f.issuer },
          form: decision,
        })
      : await f.context("/v2/import", session, {
          method: "POST",
          json: decision,
        });
    assert.notEqual(result.status, 200);
    assert.doesNotMatch(
      result.text,
      /Import recorded|committed|urn:uuid|outcomes/,
    );
    await f.restart();
    assert.equal(
      (await f.management("/v2/audit?eventType=context.imported")).json.events
        .length,
      1,
    );
    assert.equal(
      (await f.management("/v2/export")).json.entries.filter(
        (e) => e.id === entry.id,
      ).length,
      1,
    );
  });
