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
