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
      purpose: "urn:purpose:outside-grant",
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
test("C7c JSON audit and export share documented beneficiary, initiator and historical policy-scope client filters", async (t) => {
  const f = await fixture(t, { approveFixtures: true }),
    tokenA = await authorize(f, "a", [
      detail(["general_preferences", "work_context"]),
    ]),
    grantA = (await f.context("/v2/grants", tokenA)).json.grants[0],
    tokenB = await authorize(f, "b", [detail(["general_preferences"])]),
    grantB = (await f.context("/v2/grants", tokenB)).json.grants[0];
  assert.equal(
    (await query(f, tokenA, { categories: ["general_preferences"] })).status,
    200,
  );
  const rule = await f.management("/v2/rules", {
    method: "POST",
    json: {
      operators: [grantA.client.operator.id],
      categories: ["work_context"],
    },
  });
  assert.equal(rule.status, 201);
  assert.equal(
    (await f.management(`/v2/rules/${rule.json.ruleId}`, { method: "DELETE" }))
      .status,
    204,
  );
  assert.equal(
    (await f.management(`/v2/grants/${grantA.grantId}`, { method: "DELETE" }))
      .status,
    204,
  );
  const recorded = (await f.management("/v2/audit?limit=100")).json.events;
  const find = (eventType, match) => {
    const matches = recorded.filter(
      (e) => e.eventType === eventType && match(e),
    );
    assert.equal(matches.length, 1);
    return matches[0];
  };
  const a = (e) => e.grantId === grantA.grantId,
    policy = (e) => e.data.ruleId === rule.json.ruleId,
    issued = find("grant.issued", a),
    read = find("context.read", a),
    set = find("rule.set", policy),
    removed = find("rule.removed", policy),
    revoked = find("grant.revoked", a);
  for (const e of [set, removed]) {
    assert.equal(e.grantId, null);
    assert.equal(
      e.participants.initiator.id,
      "urn:context-router:synthetic-management",
    );
  }
  for (const [filter, expected] of [
    [{ client: "a" }, [issued, read, set, removed, revoked]],
    [
      { client: "b" },
      [find("grant.issued", (e) => e.grantId === grantB.grantId)],
    ],
    [
      {
        client: "urn:context-router:synthetic-management",
        eventType: "grant.revoked",
      },
      [revoked],
    ],
  ]) {
    const selected = [];
    let cursor;
    do {
      const response = await f.management(
        `/v2/audit?${new URLSearchParams({ ...filter, limit: "2", ...(cursor ? { cursor } : {}) })}`,
      );
      assert.equal(response.status, 200);
      selected.push(...response.json.events);
      cursor = response.json.nextCursor;
    } while (cursor);
    assert.deepEqual(selected, expected);
    // Export appends its own attempted-release event after selecting its rows.
    const exported = await f.management(
      `/v2/audit/export?${new URLSearchParams(filter)}`,
    );
    assert.equal(exported.status, 200);
    assert.deepEqual(exported.json.events, expected);
  }
});

for (const [path, operation, browser] of [
  ["/v2/audit", "audit", false],
  ["/v2/grants", "listGrants", false],
  ["/v2/disclosures", "disclosures", false],
  ["/v2/rules", "listPolicy", false],
  ["/v2/directives", "listPolicy", false],
  ["/manage/audit", "activity", true],
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
    if (path === "/v2/grants") await authorize(f);
    let route = path;
    if (path === "entry")
      route = `/manage/entries/${encodeURIComponent((await f.management("/v2/export")).json.entries[0].id)}`;
    if (path === "grant") {
      const token = await authorize(f);
      route = `/manage?grantId=${encodeURIComponent((await f.context("/v2/grants", token)).json.grants[0].grantId)}`;
    }
    await f.arm({
      operation,
      point:
        path === "/manage/audit"
          ? "during-management-page-render"
          : "during-management-serialization",
      ...(path === "/manage/audit" ? { title: "Activity" } : {}),
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
for (const field of [
  "categories",
  "purposes",
  "rules",
  "directives",
  "confirmation",
  "policy",
])
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
          : field === "confirmation"
            ? `/v2/entries/${encodeURIComponent(entry.id)}/confirmation`
            : field === "policy"
              ? "/experiment/policy"
              : `/v2/${field}`,
        input = classification
          ? {
              expectedVersion: entry.record.version,
              ...(field === "categories"
                ? { categories: ["work_context"] }
                : { permittedPurposes: [] }),
            }
          : field === "confirmation"
            ? {
                expectedVersion: entry.record.version,
                disposition: "confirmed",
              }
            : field === "policy"
              ? {
                  rules: [{ operators: ["private-policy.example"] }],
                  directives: [],
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
          confirmation: "context.confirmed",
          policy: "rule.set",
        }[field],
        auditRoute = `/v2/audit?eventType=${eventType}`,
        before = (await f.management(auditRoute)).json.events.length;
      await f.arm({
        operation: classification
          ? "editClassification"
          : field === "confirmation"
            ? "confirmEntry"
            : field === "policy"
              ? "replacePolicy"
              : "setPolicy",
        point,
        action: "advance",
        now: Date.now() + 12 * 3600_000 + 1000,
      });
      const result = await f.context(route, d.jar.get("__Host-hcp-human"), {
        method: classification || field === "policy" ? "PUT" : "POST",
        json: input,
      });
      assert.equal(
        result.status,
        classification || ["confirmation", "policy"].includes(field)
          ? 200
          : 201,
      );
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
      } else if (field === "confirmation") {
        const held = (await f.management("/v2/export")).json.entries.find(
          (e) => e.id === entry.id,
        );
        assert.equal(
          held.record.provenance.confirmations.length,
          entry.record.provenance.confirmations.length + 1,
        );
      } else if (field === "policy") {
        assert.equal((await f.management("/v2/rules")).json.rules.length, 1);
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
  const beforeEntries = (await f.management("/v2/export")).json.entries;
  const beforeAudit = (await f.management("/v2/audit")).json.events;
  for (const management of [true, false]) {
    const route = `/v2/entries/${encodeURIComponent(id)}?hardDelete=true`;
    const result = management
      ? await f.management(route, { method: "DELETE", json: {} })
      : await f.context(route, token, { method: "DELETE", json: {} });
    assert.equal(result.status, management ? 404 : 403);
    if (management) assert.match(result.text, /outside the experiment/);
  }
  assert.deepEqual((await f.management("/v2/audit")).json.events, beforeAudit);
  assert.deepEqual(
    (await f.management("/v2/export")).json.entries,
    beforeEntries,
  );
});
for (const kind of ["confirmation", "keep-both"])
  for (const point of ["before-commit", "after-data-commit"])
    test(`C5 browser ${kind} ${point} expiry preserves content-free committed acknowledgement`, async (t) => {
      const f = await fixture(t, { approveFixtures: true, childProcess: true }),
        d = new OAuthDriver(f, "a");
      let entry,
        ids = [];
      if (kind === "keep-both") {
        const token = await authorize(f, "a", [
            detail(["general_preferences"], undefined, {
              actions: ["read", "write"],
            }),
          ]),
          grant = (await f.context("/v2/grants", token)).json.grants[0];
        for (const value of ["email", "phone"]) {
          const created = await f.context("/v2/entries", token, {
            method: "POST",
            json: {
              purpose: "https://example.test/purpose/synthetic-review",
              schema: "https://hcp.example/spec/entry/2.0",
              subject: grant.subject,
              content: {
                profile:
                  "https://hcp.example/spec/profiles/general-context/2.0",
                value: {
                  type: "urn:context-router:exclusive-fact:v1",
                  slot: "contact",
                  setting: "work",
                  value,
                },
              },
              classification: { categories: ["general_preferences"] },
              assertion: { declarationType: "person-declared" },
              record: { provenance: { source: "person-input" } },
            },
          });
          assert.equal(created.status, 201);
        }
        ids = (
          await f.management(
            `/v2/audit?grantId=${grant.grantId}&eventType=context.created`,
          )
        ).json.events.map((e) => e.entryId);
        entry = (await f.management("/v2/export")).json.entries.find(
          (e) => e.id === ids[0],
        );
      } else
        entry = (await f.management("/v2/export")).json.entries.find(
          (e) => e.record.status === "active",
        );
      await d.begin();
      await d.login();
      const page = await d.request(
          `/manage/entries/${encodeURIComponent(entry.id)}`,
        ),
        route =
          kind === "confirmation"
            ? `/manage/entries/${encodeURIComponent(entry.id)}/review`
            : /action="(\/manage\/conflicts\/[^\"]+\/review)"/.exec(
                page.text,
              )?.[1];
      assert.ok(route);
      const review = await d.request(route, {
        method: "POST",
        headers: { origin: f.issuer },
        form: {
          csrf: inputs(page.text).csrf,
          ...(kind === "confirmation"
            ? {
                expectedVersion: String(entry.record.version),
                disposition: "confirmed",
              }
            : {}),
        },
      });
      assert.equal(review.status, 200);
      const eventType =
          kind === "confirmation" ? "context.confirmed" : "conflict.resolved",
        auditRoute = `/v2/audit?eventType=${eventType}`,
        before = (await f.management(auditRoute)).json.events.length;
      await f.arm({
        operation:
          kind === "confirmation" ? "approveConfirmation" : "approveKeepBoth",
        point,
        action: "advance",
        now: Date.now() + 12 * 3600_000 + 1000,
      });
      const result = await d.request(
        kind === "confirmation"
          ? "/manage/entries/approve"
          : "/manage/conflicts/approve",
        {
          method: "POST",
          headers: { origin: f.issuer },
          form: inputs(review.text),
        },
      );
      assert.equal(result.status, point === "before-commit" ? 401 : 200);
      if (point !== "before-commit")
        assert.match(result.text, /Action recorded/);
      assert.doesNotMatch(
        result.text,
        /urn:uuid|written notes|contact|email|phone/,
      );
      await f.restart();
      assert.equal(
        (await f.management(auditRoute)).json.events.length,
        before + (point === "before-commit" ? 0 : 1),
      );
      const held = (await f.management("/v2/export")).json.entries.find(
        (e) => e.id === entry.id,
      );
      if (kind === "confirmation")
        assert.equal(
          held.record.provenance.confirmations.length,
          entry.record.provenance.confirmations.length +
            (point === "before-commit" ? 0 : 1),
        );
      else if (point === "before-commit") assert.deepEqual(held, entry);
      else assert.equal(held.record.status, "active");
    });
test("C5 forbidden outside-grant purpose is recorded, while malformed or unattributable reports are not", async (t) => {
  const f = await fixture(t, { approveFixtures: true, childProcess: true }),
    token = await authorize(f),
    found = await query(f, token),
    other = await authorize(f, "b"),
    report = {
      recipient: { domain: "recipient.example", name: "Synthetic" },
      refs: [found.json.entries[0].ref],
      purpose: "urn:purpose:outside-grant",
      sharedAt: new Date().toISOString(),
    };
  assert.equal(
    (await f.context("/v2/shares", "invalid", { method: "POST", json: report }))
      .status,
    401,
  );
  assert.equal(
    (await f.context("/v2/shares", other, { method: "POST", json: report }))
      .status,
    403,
  );
  assert.equal(
    (
      await f.context("/v2/shares", token, {
        method: "POST",
        json: { ...report, purpose: "malformed purpose" },
      })
    ).status,
    422,
  );
  assert.equal(
    (await f.management("/v2/audit?eventType=context.shared")).json.events
      .length,
    0,
  );
  assert.equal(
    (await f.context("/v2/shares", token, { method: "POST", json: report }))
      .status,
    403,
  );
  await f.restart();
  const events = (await f.management("/v2/audit?eventType=context.shared")).json
    .events;
  assert.equal(events.length, 1);
  assert.equal(events[0].data.permitted, false);
  assert.equal(events[0].data.purpose, report.purpose);
});
