const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  { randomUUID } = require("node:crypto");
const { fixture } = require("./authorization-fixture.cjs");
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
