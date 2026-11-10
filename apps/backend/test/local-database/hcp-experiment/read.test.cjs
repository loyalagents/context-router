const { test } = require("node:test");
const assert = require("node:assert/strict");
const { fixture, OAuthDriver } = require("./authorization-fixture.cjs");
const {
  syntheticFixtures,
} = require("../../../dist/infrastructure/hcp-experiment/fixtures.js");
const {
  ACCESS_TYPE,
  PURPOSES,
} = require("../../../dist/infrastructure/hcp-experiment/policy.js");
const {
  authorize,
  query,
  get,
  detail,
  purpose,
} = require("./read-helpers.cjs");

test("C3 actual HTTP: seed approval, A1/A2/B query/get, allowlist, history and revoke", async (t) => {
  const f = await fixture(t, { approveFixtures: true });
  const a1 = await authorize(f),
    a2 = await authorize(f),
    b = await authorize(f, "b");
  const result = await query(f, a1);
  assert.equal(result.status, 200);
  assert.equal(result.headers["content-type"], "application/ld+json");
  assert.equal(result.headers["hcp-version"], "2.0");
  assert.deepEqual(result.json.minimization, { method: "lexical" });
  assert.deepEqual(result.json.categoriesSearched, ["general_preferences"]);
  assert.equal(result.json.entries.length, 1);
  const entry = result.json.entries[0];
  assert.deepEqual(Object.keys(entry).sort(), [
    "assertion",
    "classification",
    "content",
    "evidence",
    "ref",
    "relationships",
    "standing",
    "useUntil",
    "version",
  ]);
  assert.equal(entry.version, 2);
  assert.deepEqual(entry.standing, {
    assurance: "authenticated",
    confirmed: false,
  });
  assert.deepEqual(entry.content.extension, {
    nested: [false, null, { number: 1.5 }],
  });
  assert.deepEqual(entry.assertion.extension, { keep: [true, 5, null] });
  assert.deepEqual(entry.evidence[0].credential.opaque, [null, false, 3]);
  assert.ok(
    Date.parse(entry.useUntil) <= Date.parse(result.json.timestamp) + 3600_000,
  );
  assert.deepEqual(
    (await query(f, a1)).json.entries.map((e) => e.ref),
    [entry.ref],
  );
  const refA2 = (await query(f, a2)).json.entries[0].ref,
    refB = (await query(f, b)).json.entries[0].ref;
  assert.equal(new Set([entry.ref, refA2, refB]).size, 3);
  const old = await get(f, a1, entry.ref, {
    version: 1,
    purposeDescription: "Inspect prior wording",
  });
  assert.equal(old.status, 200);
  assert.equal(old.json.entry.version, 1);
  assert.equal(
    old.json.entry.content.value,
    "Synthetic person prefers written notes.",
  );
  assert.deepEqual(old.json.minimization, { method: "none" });
  for (const ref of [
    refB,
    "absent",
    "urn:uuid:00000000-0000-0000-0000-000000000000",
  ]) {
    const denied = await get(f, a1, ref);
    assert.equal(denied.status, 403);
    assert.deepEqual(denied.json, (await get(f, a1, "absent")).json);
  }
  const own = (await f.context("/v2/grants", a1)).json.grants[0];
  const history = (await f.management(`/v2/audit?grantId=${own.grantId}`)).json
    .events;
  const event = history.find(
    (e) => e.participants.retrievalId === result.json.retrievalId,
  );
  assert.ok(
    history
      .filter((e) => e.eventType === "context.read")
      .every((e) => Array.isArray(e.data.directives)),
  );
  assert.equal(event.eventType, "context.read");
  assert.equal(event.purpose, purpose);
  assert.equal(event.participants.initiator.id, "a");
  assert.equal(event.disclosed[0].version, 2);
  assert.equal(event.disclosed[0].useUntil, entry.useUntil);
  assert.notEqual(event.disclosed[0].entryId, entry.ref);
  assert.equal(event.data.release, "attempted");
  assert.equal(event.data.receipt, "unconfirmed");
  assert.equal(JSON.stringify(event).includes("written notes"), false);
  assert.equal(JSON.stringify(event).includes(a1), false);
  assert.deepEqual(event.data.categoriesSearched, ["general_preferences"]);
  assert.equal(event.data.maxEntries, 5);
  assert.equal(
    (await f.management(`/v2/grants/${own.grantId}`, { method: "DELETE" }))
      .status,
    204,
  );
  assert.equal((await query(f, a1)).status, 401);
  assert.equal((await query(f, a2)).status, 200);
  assert.equal((await query(f, b)).status, 200);
});

test("C3 whole-request purpose/category denial, input validation and governance separation", async (t) => {
  const f = await fixture(t, { approveFixtures: true }),
    token = await authorize(f);
  for (const extra of [
    { purpose: PURPOSES[1].code },
    { categories: ["general_preferences", "work_context"] },
    { categories: ["unknown_category"] },
  ])
    assert.equal((await query(f, token, extra)).status, 403);
  for (const body of [
    {},
    { purpose },
    { query: "notes" },
    { query: "", purpose },
    ...[0, -1, 1.5, "5", null].map((maxEntries) => ({
      query: "notes",
      purpose,
      maxEntries,
    })),
    { query: "notes", purpose, cursor: "next" },
  ])
    assert.equal(
      (
        await f.context("/v2/entries/query", token, {
          method: "POST",
          json: body,
        })
      ).status,
      422,
    );
  assert.equal((await get(f, token, "absent", { version: "1.5" })).status, 422);
  assert.equal(
    (
      await f.context(
        `/v2/entries/absent?purpose=${purpose}&purpose=${purpose}`,
        token,
      )
    ).status,
    422,
  );
  const empty = await query(f, token, { categories: [] });
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.json.entries, []);
  assert.deepEqual(empty.json.categoriesSearched, []);
  for (const route of [
    "/v2/audit",
    "/v2/export",
    "/v2/disclosures",
    "/v2/rules",
    "/v2/directives",
    "/v2/delegations",
  ])
    assert.equal((await f.context(route, token)).status, 403);
  assert.equal(
    (
      await f.management("/v2/entries/query", {
        method: "POST",
        json: { query: "notes", purpose },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await f.context("/v2/entries/query", token, {
        method: "POST",
        headers: { "hcp-version": "1.0" },
        json: { query: "notes", purpose },
      })
    ).status,
    400,
  );
  for (const route of [
    "/graphql",
    "/mcp",
    "/documents",
    "/models",
    "/import",
    "/reset",
    "/history",
    "/experiment/seed",
  ])
    assert.equal((await f.context(route, token)).status, 404);
  assert.equal((await query(f, "old-client-credential")).status, 401);
  assert.equal(
    (await f.request("/experiment/capabilities")).json.publicEntryRead,
    true,
  );
});

test("C3 malformed transport input is a validation error, not subject unavailability", async (t) => {
  const f = await fixture(t, { approveFixtures: true }),
    token = await authorize(f);
  for (const raw of ["{", "[", '{"query":"unterminated']) {
    const r = await f.context("/v2/entries/query", token, {
      method: "POST",
      headers: { "content-type": "application/json" },
      raw,
    });
    assert.equal(r.status, 422);
    assert.equal(r.json.type, "https://hcp.example/problems/malformed-request");
  }
  assert.equal((await query(f, token)).status, 200);
});

test("C3 malformed encoded get reference is a validation error", async (t) => {
  const f = await fixture(t, { approveFixtures: true }),
    token = await authorize(f);
  const r = await f.context(`/v2/entries/%E0%A4%A?purpose=${purpose}`, token);
  assert.equal(r.status, 422);
  assert.equal(r.json.type, "https://hcp.example/problems/malformed-request");
  assert.equal((await query(f, token)).status, 200);
});

test("C3 lexical ordering uses only eligible public primitive value leaves and one 1/5/20 cap", async (t) => {
  const base = syntheticFixtures()[0];
  base.versions = [base.versions[0]];
  const fixtures = Array.from({ length: 27 }, (_, i) => {
    const item = structuredClone(base);
    item.versions[0].content.value =
      i === 0
        ? "Alpha beta gamma"
        : i === 1
          ? { privateKeyOnly: ["ALPHA", "beta", 73, true, null] }
          : `alpha item ${i}`;
    item.versions[0].recordExtensions.metadata = { hidden: "secretneedle" };
    item.versions[0].assertion.extension = { hidden: "assertionneedle" };
    return item;
  });
  const f = await fixture(t, { approveFixtures: true, fixtures }),
    token = await authorize(f);
  for (const [maxEntries, expected] of [
    [1, 1],
    [5, 5],
    [20, 20],
    [100, 20],
  ]) {
    const r = await query(f, token, { query: "alpha beta gamma", maxEntries });
    assert.equal(r.status, 200);
    assert.equal(r.json.entries.length, expected);
    assert.equal(r.json.entries[0].content.value, "Alpha beta gamma");
    if (expected > 1)
      assert.deepEqual(
        r.json.entries[1].content.value,
        fixtures[1].versions[0].content.value,
      );
    assert.deepEqual(Object.keys(r.json.minimization), ["method"]);
    assert.equal("nextCursor" in r.json, false);
  }
  assert.equal(
    (await query(f, token, { query: "alpha" })).json.entries.length,
    5,
  );
  for (const term of [
    "secretneedle",
    "assertionneedle",
    "privateKeyOnly",
    "general_preferences",
    "person-declared",
    "no-match",
  ])
    assert.deepEqual((await query(f, token, { query: term })).json.entries, []);
  assert.equal(
    (await query(f, token, { query: "73 true null", maxEntries: 20 })).json
      .entries.length,
    1,
  );
  assert.equal(
    (await query(f, token, { query: "ＡＬＰＨＡ beta gamma", maxEntries: 1 }))
      .json.entries[0].content.value,
    "Alpha beta gamma",
  );
  const h = (await f.management("/v2/audit?limit=100")).json.events;
  assert.ok(
    h.some((e) => e.eventType === "context.read" && e.disclosed.length === 0),
  );
});

test("C3 current lifecycle/purpose and all-category rules filter before scoring; directives and narrowed refs", async (t) => {
  const fixtures = syntheticFixtures();
  fixtures[0].classification.categories = [
    "general_preferences",
    "work_context",
  ];
  fixtures[1].versions[0].content.value = "written notes";
  const f = await fixture(t, { approveFixtures: true, fixtures });
  const token = await authorize(f, "a", [
    detail(["general_preferences", "work_context"]),
  ]);
  const initial = await query(f, token);
  assert.equal(initial.json.entries.length, 2);
  const ids = (await f.management("/v2/audit?limit=100")).json.events
    .filter((e) => e.eventType === "context.created")
    .map((e) => e.entryId);
  const narrow = await authorize(f, "b", [
    detail(["general_preferences"], [PURPOSES[0]], {
      narrowedTo: { entryIds: [ids[0]] },
    }),
  ]);
  const narrowed = (await query(f, narrow)).json.entries;
  assert.equal(narrowed.length, 1);
  assert.deepEqual(narrowed[0].classification.categories, [
    "general_preferences",
  ]);
  const grant = (await f.context("/v2/grants", narrow)).json.grants[0];
  assert.equal(grant.access[0].narrowedTo.entryIds[0], narrowed[0].ref);
  await f.management("/experiment/policy", {
    method: "PUT",
    json: {
      rules: [],
      directives: [
        {
          action: "share",
          effect: "deny",
          text: "Do not share work",
          categories: ["work_context"],
        },
        { action: "sign", effect: "ask-first", text: "Ask first" },
      ],
    },
  });
  const d = await query(f, narrow);
  assert.equal(d.json.directives.length, 2); // applies even through the withheld work category
  const historical = await get(f, narrow, narrowed[0].ref, { version: 1 });
  assert.equal(historical.status, 200);
  const empty = await query(f, narrow, { query: "no-match" });
  assert.equal(empty.json.directives.length, 1);
  const history = (await f.management("/v2/audit?limit=100")).json.events;
  for (const response of [d, historical, empty]) {
    const audit = history.find(
      (e) => e.participants.retrievalId === response.json.retrievalId,
    );
    assert.deepEqual(
      audit.data.directives,
      response.json.directives.map((item) => item.directiveId),
    );
    assert.equal(audit.directives, undefined);
  }
  await f.management("/experiment/policy", {
    method: "PUT",
    json: {
      rules: [{ operators: ["example.test"], categories: ["work_context"] }],
      directives: [],
    },
  });
  assert.deepEqual((await query(f, narrow)).json.entries, []);
  assert.equal(
    (await get(f, narrow, narrowed[0].ref, { version: 1 })).status,
    403,
  );
});

test("C3 pending approval cannot serve and simulated C1 fixtures cannot become public", async (t) => {
  await assert.rejects(fixture(t, { pendingApproval: true }));
  const f = await fixture(t),
    token = await authorize(f);
  assert.equal((await query(f, token)).status, 403);
  assert.equal(
    (await f.request("/experiment/capabilities")).json.publicEntryRead,
    false,
  );
});

test("C3 historical purposes and deadlines use both current and selected assertions", async (t) => {
  const fixtures = syntheticFixtures(),
    now = Date.now();
  fixtures[0].versions[0].assertion.permittedPurposes = [PURPOSES[1].code];
  fixtures[0].versions[1].assertion.validUntil = new Date(
    now + 120_000,
  ).toISOString();
  fixtures[1].versions[0].assertion.permittedPurposes = [];
  const f = await fixture(t, { approveFixtures: true, fixtures }),
    token = await authorize(f);
  const r = await query(f, token),
    entry = r.json.entries[0];
  assert.equal(r.json.entries.length, 1);
  assert.equal(entry.useUntil, fixtures[0].versions[1].assertion.validUntil);
  assert.equal((await get(f, token, entry.ref, { version: 1 })).status, 403);
  assert.equal((await get(f, token, entry.ref, { version: 99 })).status, 403);
  assert.deepEqual(
    (
      await query(f, token, {
        categories: ["general_preferences", "general_preferences"],
      })
    ).json.categoriesSearched,
    ["general_preferences"],
  );
});

test("C3 category search cannot combine narrowing from a different access detail", async (t) => {
  const fixtures = syntheticFixtures();
  fixtures[0].classification.categories = [
    "general_preferences",
    "work_context",
  ];
  const f = await fixture(t, { approveFixtures: true, fixtures });
  const ids = (await f.management("/v2/audit?limit=100")).json.events
    .filter((e) => e.eventType === "context.created")
    .map((e) => e.entryId);
  const token = await authorize(f, "a", [
    detail(["general_preferences"], [PURPOSES[0]], {
      narrowedTo: { entryIds: [ids[2]] },
    }),
    detail(["work_context"]),
  ]);
  assert.deepEqual(
    (await query(f, token, { categories: ["general_preferences"] })).json
      .entries,
    [],
  );
  const reached = await query(f, token, { categories: ["work_context"] });
  assert.equal(reached.json.entries.length, 2);
  assert.ok(
    reached.json.entries.every(
      (e) => !e.classification.categories.includes("general_preferences"),
    ),
  );
});

test("C3 get checks the entry's categories when a standing rule denies another grant category", async (t) => {
  const f = await fixture(t, { approveFixtures: true });
  const token = await authorize(f, "a", [
    detail(["general_preferences", "work_context"]),
  ]);
  const result = await query(f, token),
    general = result.json.entries.find((e) => e.version === 2),
    work = result.json.entries.find((e) => e.version === 1);
  await f.management("/experiment/policy", {
    method: "PUT",
    json: {
      rules: [{ operators: ["example.test"], categories: ["work_context"] }],
      directives: [],
    },
  });
  assert.equal((await get(f, token, general.ref)).status, 200);
  assert.equal((await get(f, token, work.ref)).status, 403);
  assert.equal(
    (await query(f, token, { categories: ["general_preferences"] })).json
      .entries.length,
    1,
  );
});

for (const categories of [["general_preferences", "work_context"], undefined])
  test(`C3 standing-rule query denial with ${categories ? "explicit" : "omitted"} categories preserves partial grant authority`, async (t) => {
    const f = await fixture(t, { approveFixtures: true });
    const token = await authorize(f, "a", [
      detail(["general_preferences", "work_context"]),
    ]);
    const initial = await query(f, token);
    assert.equal(initial.status, 200);
    assert.equal(initial.json.entries.length, 2);
    const originalGrant = (await f.context("/v2/grants", token)).json.grants[0];
    assert.equal(
      (
        await f.management("/experiment/policy", {
          method: "PUT",
          json: {
            rules: [
              { operators: ["example.test"], categories: ["work_context"] },
            ],
            directives: [],
          },
        })
      ).status,
      200,
    );
    const own = await f.context("/v2/grants", token);
    assert.equal(own.status, 200);
    assert.equal(own.json.grants[0].status, "active");
    assert.deepEqual(own.json.grants[0].access, originalGrant.access);

    const denied = await query(f, token, categories ? { categories } : {});
    assert.equal(denied.status, 403);
    assert.equal(denied.json.entries, undefined);
    const reads = (
      await f.management("/v2/audit?limit=100")
    ).json.events.filter((e) => e.eventType === "context.read");
    assert.equal(reads.length, 1);
    assert.equal(reads[0].participants.retrievalId, initial.json.retrievalId);

    const allowed = await query(f, token, {
      categories: ["general_preferences"],
    });
    assert.equal(allowed.status, 200);
    assert.deepEqual(allowed.json.categoriesSearched, ["general_preferences"]);
    assert.equal(allowed.json.entries.length, 1);
    assert.deepEqual(allowed.json.entries[0].classification.categories, [
      "general_preferences",
    ]);
  });

test("C3 relationships expose only same-response targets as grant refs", async (t) => {
  const fixtures = syntheticFixtures();
  fixtures[0].versions[1].relationships = [
    { type: "duplicates", targetFixture: 1 },
    { type: "duplicates", targetFixture: 2 },
  ];
  const f = await fixture(t, { approveFixtures: true, fixtures });
  const token = await authorize(f, "a", [
    detail(["general_preferences", "work_context"]),
  ]);
  const r = await query(f, token),
    first = r.json.entries.find((e) => e.version === 2),
    other = r.json.entries.find((e) => e.version === 1);
  assert.deepEqual(first.relationships, [
    { type: "duplicates", target: other.ref },
  ]);
  assert.deepEqual(
    (await get(f, token, first.ref)).json.entry.relationships,
    [],
  );
  assert.deepEqual(
    (await query(f, token, { maxEntries: 1 })).json.entries[0].relationships,
    [],
  );
});

test("C3 human history pages all attempts and summarizes the conservative copy deadline", async (t) => {
  const f = await fixture(t, { approveFixtures: true }),
    token = await authorize(f);
  const grant = (await f.context("/v2/grants", token)).json.grants[0];
  for (let i = 0; i < 23; i++)
    assert.equal((await query(f, token)).status, 200);
  let cursor,
    history = [];
  do {
    const r = await f.management(
      `/v2/audit?grantId=${grant.grantId}&limit=4` +
        (cursor ? `&cursor=${cursor}` : ""),
    );
    assert.equal(r.status, 200);
    history.push(...r.json.events);
    cursor = r.json.nextCursor;
  } while (cursor);
  assert.equal(
    history.filter((e) => e.eventType === "context.read").length,
    23,
  );
  const driver = new OAuthDriver(f, "a");
  await driver.follow(await driver.request("/manage"));
  const { inputs } = require("./authorization-fixture.cjs");
  await driver.follow(
    await driver.request("/manage/login", {
      method: "POST",
      headers: { origin: f.issuer },
      form: { ...inputs(driver.page.text), credential: f.human },
    }),
  );
  const page = await driver.request(`/manage?grantId=${grant.grantId}`);
  assert.ok(page.text.includes("Last possible copy use-until"));
  assert.ok(page.text.includes("Receipt is unconfirmed"));
  assert.ok(page.text.includes("No notification endpoint"));
  assert.ok(
    page.text.includes(
      "Clients must stop using copies when notified of revocation, or at use-until.",
    ),
  );
  assert.ok(page.text.includes("Next history page"));
  assert.equal(
    page.text.includes("No context content has been disclosed"),
    false,
  );
  const until = history
    .flatMap((e) => e.disclosed ?? [])
    .map((e) => e.useUntil)
    .sort()
    .at(-1);
  assert.ok(page.text.includes(until));
  const next = /href="([^"]+)"[^>]*>Next history page/
    .exec(page.text)[1]
    .replaceAll("&amp;", "&");
  assert.ok((await driver.request(next)).text.includes("context.read"));
});
