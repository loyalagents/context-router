const { test } = require("node:test");
const assert = require("node:assert/strict");
const { fixture, OAuthDriver, inputs } = require("./authorization-fixture.cjs");
const { authorize, detail, query } = require("./read-helpers.cjs");
const {
  PURPOSES,
} = require("../../../dist/infrastructure/hcp-experiment/policy.js");
for (const point of ["before-audit", "before-commit", "after-data-commit"])
  test(`C5 forbidden sharing report ${point} failure has truthful durable history after restart`, async (t) => {
    const f = await fixture(t, { approveFixtures: true, childProcess: true }),
      token = await authorize(f),
      result = await query(f, token);
    const report = {
      recipient: { domain: "recipient.example", name: "Synthetic recipient" },
      refs: [result.json.entries[0].ref],
      purpose: PURPOSES[0].code,
      sharedAt: new Date().toISOString(),
    };
    await f.arm({ operation: "reportSharing", point, action: "throw" });
    assert.notEqual(
      (await f.context("/v2/shares", token, { method: "POST", json: report }))
        .status,
      403,
    );
    await f.restart();
    assert.equal(
      (await f.management("/v2/audit?eventType=context.shared")).json.events
        .length,
      point === "after-data-commit" ? 1 : 0,
    );
  });
test("C5 audit cursor binds filters and its snapshot across restart and concurrent append", async (t) => {
  const f = await fixture(t, { approveFixtures: true, childProcess: true }),
    expected = (await f.management("/v2/audit")).json.events.map(
      (e) => e.eventId,
    ),
    first = (await f.management("/v2/audit?limit=2")).json;
  assert.ok(first.nextCursor);
  await f.management("/v2/rules", {
    method: "POST",
    json: { operators: ["blocked.example"] },
  });
  await f.restart();
  assert.equal(
    (await f.management(`/v2/audit?cursor=${first.nextCursor}&client=b`))
      .status,
    422,
  );
  let cursor = first.nextCursor,
    ids = first.events.map((e) => e.eventId);
  while (cursor) {
    const page = (await f.management(`/v2/audit?limit=2&cursor=${cursor}`))
      .json;
    ids.push(...page.events.map((e) => e.eventId));
    cursor = page.nextCursor;
  }
  assert.deepEqual(ids, expected);
});
for (const [path, operation, browser] of [
  ["/v2/audit", "audit", false],
  ["/v2/disclosures", "disclosures", false],
  ["/v2/rules", "listPolicy", false],
  ["/v2/directives", "listPolicy", false],
  ["/manage/audit", "audit", true],
  ["/manage/disclosures", "disclosures", true],
  ["/v2/export", "exportContext", false],
  ["entry", "audit", true],
  ["grant", "audit", true],
])
  test(`C5 ${path} rechecks human authority after response serialization`, async (t) => {
    const f = await fixture(t, { approveFixtures: true, childProcess: true }),
      d = new OAuthDriver(f, "a");
    await d.begin();
    await d.login();
    if (operation === "listPolicy")
      await f.management("/v2/directives", {
        method: "POST",
        json: {
          action: "share",
          effect: "deny",
          text: "private directive text",
        },
      });
    let route = path;
    if (path === "entry")
      route = `/manage/entries/${encodeURIComponent((await f.management("/v2/export")).json.entries[0].id)}`;
    if (path === "grant") {
      const token = await authorize(f);
      route = `/manage?grantId=${encodeURIComponent((await f.context("/v2/grants", token)).json.grants[0].grantId)}`;
    }
    await f.arm({
      operation,
      point: "during-management-serialization",
      action: "advance",
      now: Date.now() + 12 * 3600_000 + 1000,
    });
    const result = browser
      ? await d.request(route)
      : await f.context(route, d.jar.get("__Host-hcp-human"));
    assert.equal(result.status, 401);
    assert.doesNotMatch(
      result.text,
      /written notes|context.created|clientOperator|private directive text/,
    );
  });
for (const field of ["categories", "purposes", "rules", "directives"])
  for (const point of ["during-management-serialization", "after-data-commit"])
    test(`C5 ${field} returns completion only when human authority expires ${point}`, async (t) => {
      const f = await fixture(t, { approveFixtures: true, childProcess: true }),
        d = new OAuthDriver(f, "a");
      await d.begin();
      await d.login();
      const entry = (await f.management("/v2/export")).json.entries.find(
        (e) => e.record.status === "active",
      );
      const classification = ["categories", "purposes"].includes(field),
        route = classification
          ? `/v2/entries/${encodeURIComponent(entry.id)}/${field}`
          : `/v2/${field}`,
        input = classification
          ? {
              expectedVersion: entry.record.version,
              ...(field === "categories"
                ? { categories: ["work_context"] }
                : { permittedPurposes: [] }),
            }
          : field === "rules"
            ? { operators: ["private-policy.example"] }
            : {
                action: "share",
                effect: "deny",
                text: "private directive text",
              },
        eventType = {
          categories: "context.recategorized",
          purposes: "context.restricted",
          rules: "rule.set",
          directives: "directive.set",
        }[field],
        auditRoute = `/v2/audit?eventType=${eventType}`,
        before = (await f.management(auditRoute)).json.events.length;
      await f.arm({
        operation: classification ? "editClassification" : "setPolicy",
        point,
        action: "advance",
        now: Date.now() + 12 * 3600_000 + 1000,
      });
      const result = await f.context(route, d.jar.get("__Host-hcp-human"), {
        method: classification ? "PUT" : "POST",
        json: input,
      });
      assert.equal(result.status, classification ? 200 : 201);
      assert.deepEqual(result.json, {
        outcome: "committed",
        representation: "not-included",
      });
      assert.doesNotMatch(
        result.text,
        /written notes|private directive text|private-policy|urn:uuid/,
      );
      await f.restart();
      assert.equal(
        (await f.management(auditRoute)).json.events.length,
        before + 1,
      );
      if (classification) {
        const held = (await f.management("/v2/export")).json.entries.find(
          (e) => e.id === entry.id,
        );
        assert.equal(held.record.version, entry.record.version);
        assert.deepEqual(
          held.classification[
            field === "purposes" ? "permittedPurposes" : field
          ],
          input[field === "purposes" ? "permittedPurposes" : field],
        );
      } else {
        const policies = (await f.management(`/v2/${field}`)).json[field];
        assert.equal(policies.length, 1);
        for (const [key, value] of Object.entries(input))
          assert.deepEqual(policies[0][key], value);
      }
    });
test("C5 denied dry runs do not reconcile overdue authority or create replacement browser sessions", async (t) => {
  const fs = require("node:fs"),
    path = require("node:path");
  const f = await fixture(t, { approveFixtures: true, childProcess: true });
  const token = await authorize(f);
  const d = new OAuthDriver(f, "a");
  await d.begin();
  await d.login();
  const csrf = inputs((await d.request("/manage")).text).csrf;
  await f.clock(Date.now() + 48 * 3600_000);
  const file = path.join(f.sandbox, "experiment", "entries.sqlite"),
    before = fs.readFileSync(file);
  for (const credential of [token, "notavalidcredential"]) {
    assert.ok(
      [401, 403].includes(
        (
          await f.context("/v2/import?dryRun=true", credential, {
            method: "POST",
            json: {},
          })
        ).status,
      ),
    );
    assert.deepEqual(fs.readFileSync(file), before);
  }
  assert.equal(
    (
      await f.context("/v2/import", token, {
        method: "POST",
        json: { export: {}, dryRun: true },
      })
    ).status,
    403,
  );
  assert.deepEqual(fs.readFileSync(file), before);
  assert.equal(
    (
      await d.request("/manage/import", {
        method: "POST",
        headers: { origin: f.issuer },
        form: { csrf, action: "preview", source: "{}", mapping: "{}" },
      })
    ).status,
    403,
  );
  assert.deepEqual(fs.readFileSync(file), before);
});
test("C5 management portability requires exact reviewed subject association and exports audited JSON-LD", async (t) => {
  const f = await fixture(t, { approveFixtures: true });
  const token = await authorize(f);
  assert.equal((await f.context("/v2/export", token)).status, 403);
  const exported = await f.management("/v2/export?include=versions");
  assert.equal(exported.status, 200);
  assert.match(exported.headers["content-type"], /ld\+json/);
  const bundle = exported.json;
  bundle.subject.id = "urn:foreign:subject";
  const e = bundle.entries.find((e) => e.record.status === "active");
  e.id = `urn:uuid:${require("node:crypto").randomUUID()}`;
  e.subject.id = bundle.subject.id;
  e.record.version = 1;
  e.record.relationships = [];
  bundle.entries = [e];
  delete bundle.versions;
  const input = { export: bundle };
  const preview = await f.management("/v2/import?dryRun=true", {
    method: "POST",
    json: input,
  });
  assert.equal(preview.status, 200);
  assert.equal(
    (
      await f.management("/v2/import", {
        method: "POST",
        json: { ...input, dryRun: true },
      })
    ).status,
    200,
  );
  const review = await f.management("/experiment/import/review", {
    method: "POST",
    json: input,
  });
  assert.equal(review.status, 200);
  const decision = {
    reviewId: review.json.reviewId,
    csrf: review.json.csrf,
    subjects: review.json.subjects,
  };
  assert.equal(
    (
      await f.management("/v2/import", {
        method: "POST",
        json: { ...decision, subjects: [] },
      })
    ).status,
    403,
  );
  assert.equal(
    (await f.management("/v2/import", { method: "POST", json: decision })).json
      .outcomes[0].outcome,
    "imported",
  );
  assert.equal(
    (await f.management("/v2/export")).json.entries.find((v) => v.id === e.id)
      .subject.id,
    bundle.subject.id,
  );
  assert.equal(
    (await f.management("/v2/audit/export?eventType=context.imported")).json
      .events.length,
    1,
  );
});
test("C5 summaries and forbidden sharing reports derive from durable attributable disclosures", async (t) => {
  const f = await fixture(t, { approveFixtures: true });
  const token = await authorize(f),
    result = await query(f, token);
  const summary = await f.management("/v2/disclosures");
  assert.equal(summary.status, 200);
  assert.equal(summary.json.clients[0].retrievals, 1);
  assert.equal((await f.context("/v2/disclosures", token)).status, 403);
  const report = {
    recipient: { domain: "recipient.example", name: "Synthetic recipient" },
    refs: [result.json.entries[0].ref],
    purpose: PURPOSES[0].code,
    sharedAt: new Date().toISOString(),
  };
  for (let i = 0; i < 2; i++)
    assert.equal(
      (await f.context("/v2/shares", token, { method: "POST", json: report }))
        .status,
      403,
    );
  const audit = await f.management(
    "/v2/audit?client=a&eventType=context.shared",
  );
  assert.equal(audit.status, 200);
  assert.equal(audit.json.events.length, 2);
  assert.ok(audit.json.events.every((e) => e.data.permitted === false));
  assert.equal(
    (
      await f.context("/v2/shares", token, {
        method: "POST",
        json: { ...report, refs: ["r_never-disclosed"] },
      })
    ).status,
    403,
  );
  assert.equal(
    (await f.management("/v2/audit?eventType=context.shared")).json.events
      .length,
    2,
  );
});
test("C5 management routes preserve versions and deny context authority including hard deletion", async (t) => {
  const f = await fixture(t, { approveFixtures: true });
  const token = await authorize(f, "a", [
    detail(["general_preferences", "work_context"]),
  ]);
  await query(f, token);
  const audit = await f.management("/v2/audit");
  const read = audit.json.events.find((e) => e.eventType === "context.read");
  const id = read.disclosed[0].entryId,
    version = read.disclosed[0].version;
  const route = `/v2/entries/${encodeURIComponent(id)}/categories`;
  assert.equal(
    (
      await f.context(route, token, {
        method: "PUT",
        json: { expectedVersion: version, categories: ["work_context"] },
      })
    ).status,
    403,
  );
  const changed = await f.management(route, {
    method: "PUT",
    json: { expectedVersion: version, categories: ["work_context"] },
  });
  assert.equal(changed.status, 200);
  assert.equal(changed.json.record.version, version);
  assert.deepEqual(changed.json.classification.categories, ["work_context"]);
  const one = await f.management("/v2/rules", {
    method: "POST",
    json: { operators: ["blocked.example"] },
  });
  assert.equal(one.status, 201);
  assert.equal(
    (await f.management("/v2/rules")).json.rules[0].ruleId,
    one.json.ruleId,
  );
  assert.equal(
    (await f.management(`/v2/rules/${one.json.ruleId}`, { method: "DELETE" }))
      .status,
    204,
  );
  assert.equal((await f.context("/v2/rules", token)).status, 403);
  assert.equal(
    (
      await f.management(`/v2/entries/${encodeURIComponent(id)}?hard=true`, {
        method: "DELETE",
        json: {},
      })
    ).status,
    403,
  );
});
