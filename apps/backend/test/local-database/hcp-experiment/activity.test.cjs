const { test } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { fixture, OAuthDriver, inputs } = require("./authorization-fixture.cjs");
const { authorize, detail, query } = require("./read-helpers.cjs");
async function signedIn(f) {
  const browser = new OAuthDriver(f, "a");
  const page = await browser.request("/manage/audit");
  await browser.request("/manage/login", {
    method: "POST",
    headers: { origin: f.issuer },
    form: { csrf: inputs(page.text).csrf, credential: f.human },
  });
  return browser;
}
const ids = (html) =>
  [...html.matchAll(/data-activity-event="([^"]+)"/g)].map((m) => m[1]);
const next = (html) =>
  /href="([^"]+)"[^>]*>Next activity page/
    .exec(html)?.[1]
    .replaceAll("&amp;", "&");
const exact = (id) => `/manage/audit?eventId=${encodeURIComponent(id)}`;

test("C7c durable Activity joins exact grants, policy scopes and readable changes across restart", async (t) => {
  const f = await fixture(t, { approveFixtures: true, childProcess: true }),
    browser = await signedIn(f);
  const token = await authorize(f, "a", [
    detail(["general_preferences", "work_context"]),
  ]);
  const grant = (await f.context("/v2/grants", token)).json.grants[0];
  await authorize(f, "b", [detail(["general_preferences"])]);
  const requestText = "C7C-PRIVATE-QUERY-CANARY";
  const purposeDescription = "C7C-PRIVATE-PURPOSE-CANARY";
  const readResult = await query(f, token, {
    query: requestText,
    purposeDescription,
    categories: ["general_preferences"],
  });
  assert.equal(readResult.status, 200);
  const rule = await f.management("/v2/rules", {
    method: "POST",
    json: {
      operators: [grant.client.operator.id],
      categories: ["work_context"],
    },
  });
  assert.equal(rule.status, 201);
  const current = await browser.request(
    `/manage?grantId=${encodeURIComponent(grant.grantId)}`,
  );
  assert.match(current.text, /Approved scope/);
  assert.match(current.text, /current rules/i);
  assert.match(current.text, /href="\/manage\/policy"/);
  assert.match(current.text, />active</);
  assert.match(current.text, /Full recorded audit events/);
  assert.ok(current.text.includes(purposeDescription));
  await f.management(`/v2/rules/${rule.json.ruleId}`, { method: "DELETE" });
  const entry = (await f.management("/v2/export")).json.entries.find(
    (e) =>
      e.record.status === "active" &&
      e.classification.categories.includes("general_preferences"),
  );
  await f.management(`/v2/entries/${encodeURIComponent(entry.id)}/categories`, {
    method: "PUT",
    json: {
      expectedVersion: entry.record.version,
      categories: ["work_context"],
    },
  });
  for (const permittedPurposes of [[], null])
    await f.management(`/v2/entries/${encodeURIComponent(entry.id)}/purposes`, {
      method: "PUT",
      json: { expectedVersion: entry.record.version, permittedPurposes },
    });
  const revoked = await f.management(`/v2/grants/${grant.grantId}`, {
    method: "DELETE",
  });
  assert.equal(revoked.status, 204);
  assert.equal((await query(f, token)).status, 401);
  const audit = (await f.management("/v2/audit?client=a")).json.events;
  assert.deepEqual(
    audit.map((e) => e.eventType),
    [
      "grant.issued",
      "context.read",
      "rule.set",
      "rule.removed",
      "grant.revoked",
    ],
  );
  const expected = audit.map((e) => e.eventId);
  const page = await browser.request("/manage/audit?client=a&limit=2");
  assert.equal(page.status, 200);
  assert.match(page.text, /<h1>Activity<\/h1>/);
  assert.match(page.text, /value="a"/);
  assert.match(page.text, /Permission granted/);
  assert.match(page.text, /Read attempt recorded/);
  assert.match(page.text, /Receipt is unconfirmed/);
  assert.ok(
    !page.text.includes(f.human) &&
      !page.text.includes(token) &&
      !page.text.includes(requestText) &&
      !page.text.includes(purposeDescription),
  );
  const read = audit.find((e) => e.eventType === "context.read");
  const readPage = await browser.request(exact(read.eventId));
  assert.deepEqual(ids(readPage.text), [read.eventId]);
  assert.ok(readPage.text.includes(grant.grantId));
  assert.match(readPage.text, /Inspect current grant/);
  const selected = audit.find((e) => e.eventType === "rule.set");
  assert.match(
    (await browser.request(exact(selected.eventId))).text,
    /Recorded grants matching this policy scope/,
  );
  const laterToken = await authorize(f, "a");
  const laterGrant = (await f.context("/v2/grants", laterToken)).json.grants[0];
  const fresh = (await f.management("/v2/audit?client=a")).json.events;
  assert.deepEqual(
    fresh.slice(0, -1).map((e) => e.eventId),
    expected,
  );
  assert.equal(fresh.at(-1).eventType, "grant.issued");
  assert.equal(fresh.at(-1).grantId, laterGrant.grantId);
  await f.restart();
  const seen = ids(page.text);
  let link = next(page.text);
  while (link) {
    const response = await browser.request(link);
    assert.equal(response.status, 200);
    seen.push(...ids(response.text));
    link = next(response.text);
  }
  assert.deepEqual(seen, expected);
  assert.ok(!seen.includes(fresh.at(-1).eventId));
  assert.deepEqual(ids((await browser.request(exact(read.eventId))).text), [
    read.eventId,
  ]);
  const categories = await browser.request(
    `/manage/audit?category=general_preferences&eventType=context.recategorized`,
  );
  assert.match(categories.text, /Before/);
  assert.match(categories.text, /After/);
  assert.match(categories.text, /general_preferences/);
  assert.match(categories.text, /work_context/);
  const purposes = await browser.request(
    "/manage/audit?eventType=context.restricted",
  );
  assert.match(purposes.text, /No permitted purposes/);
  assert.match(purposes.text, /No principal purpose restriction/);
  assert.doesNotMatch(
    (await browser.request("/manage/audit?client=b")).text,
    /data-event-type="rule.set"/,
  );
});

test("C7c empty, exact missing, invalid filters and expired cursor are honest and management-only", async (t) => {
  const f = await fixture(t, { approveFixtures: true, childProcess: true }),
    browser = await signedIn(f);
  assert.match(
    (await browser.request("/manage/audit?client=never-recorded")).text,
    /No events match these filters/,
  );
  assert.match(
    (await browser.request(exact(`urn:uuid:${randomUUID()}`))).text,
    /Recorded event unavailable/,
  );
  for (const route of [
    "/manage/audit?client=a&client=b",
    "/manage/audit?eventId=bad",
    "/manage/audit?eventId=urn:uuid:00000000-0000-4000-8000-000000000001&client=a",
    "/manage/audit?from=2026-02-30T00%3A00%3A00Z",
    "/manage/audit?unknown=value",
  ]) {
    assert.equal((await browser.request(route)).status, 400);
  }
  const first = await browser.request("/manage/audit?limit=1");
  const continuation = next(first.text);
  assert.ok(continuation);
  await f.clock(Date.now() + 600_001);
  const expired = await browser.request(continuation);
  assert.equal(expired.status, 400);
  assert.match(expired.text, /Start a fresh activity view/);
  const token = await authorize(f);
  for (const route of [
    "/manage/audit",
    exact(`urn:uuid:${randomUUID()}`),
    "/v2/audit",
  ]) {
    const response = await f.context(route, token);
    assert.equal(response.status, 403);
    assert.doesNotMatch(
      response.text,
      /data-activity-event|context.created|clientOperator/,
    );
  }
  const anonymous = await new OAuthDriver(f, "b").request("/manage/audit");
  assert.match(anonymous.text, /Sign in/);
  assert.doesNotMatch(anonymous.text, /data-activity-event/);
});

for (const exactView of [false, true])
  test(`C7c final HTML authorization withholds ${exactView ? "exact" : "timeline"} activity`, async (t) => {
    const f = await fixture(t, { approveFixtures: true, childProcess: true }),
      browser = await signedIn(f);
    const token = await authorize(f),
      grant = (await f.context("/v2/grants", token)).json.grants[0];
    const event = (
      await f.management("/v2/audit?eventType=grant.issued&client=a")
    ).json.events[0];
    await f.arm({
      operation: "c7c-render",
      point: "during-management-page-render",
      title: "Activity",
      action: "advance",
      now: Date.now() + 12 * 3600_000 + 1000,
    });
    const response = await browser.request(
      exactView ? exact(event.eventId) : "/manage/audit",
    );
    assert.equal(response.status, 401);
    for (const value of [
      event.eventId,
      grant.grantId,
      grant.client.name,
      token,
      f.human,
    ])
      assert.ok(!response.text.includes(value));
    assert.doesNotMatch(
      response.text,
      /data-activity-event|context.created|general_preferences/,
    );
  });

test("C7c expiry uses the recorded reconciliation time and effective deadline, never revocation wording", async (t) => {
  const f = await fixture(t, { approveFixtures: true, childProcess: true }),
    browser = await signedIn(f);
  const token = await authorize(f),
    grant = (await f.context("/v2/grants", token)).json.grants[0];
  await f.clock(Date.parse(grant.expiresAt) + 1000);
  const response = await browser.request(
    "/manage/audit?eventType=grant.expired&client=a",
  );
  assert.match(response.text, /Permission expired/);
  assert.match(response.text, /Effective at/);
  assert.ok(response.text.includes(grant.expiresAt));
  assert.doesNotMatch(response.text, /Permission revoked/);
});

test("C7c revocation after expiry describes the recorded deadline without claiming access just ended", async (t) => {
  const f = await fixture(t, { approveFixtures: true, childProcess: true }),
    browser = await signedIn(f),
    token = await authorize(f),
    grant = (await f.context("/v2/grants", token)).json.grants[0];
  await f.clock(Date.parse(grant.expiresAt) + 1000);
  const current = await browser.request(
    `/manage?grantId=${encodeURIComponent(grant.grantId)}`,
  );
  assert.match(current.text, />expired</);
  assert.match(current.text, /Access has already expired/);
  assert.match(current.text, /Revoke grant/);
  assert.equal(
    (await f.management(`/v2/grants/${grant.grantId}`, { method: "DELETE" }))
      .status,
    204,
  );
  const audit = (await f.management("/v2/audit?client=a")).json.events;
  assert.deepEqual(
    audit.map((e) => e.eventType),
    ["grant.issued", "grant.expired", "grant.revoked"],
  );
  await f.restart();
  const page = await browser.request(exact(audit.at(-1).eventId));
  assert.match(
    page.text,
    /approved deadline had already been reached when revocation was recorded/,
  );
  assert.doesNotMatch(page.text, /Future access under this grant was revoked/);
  assert.match(page.text, /does not prove remote copies were erased/);
  assert.equal((await query(f, token)).status, 401);
});

test("C7c more than fifty events remain reachable through page links and exact links after restart", async (t) => {
  const f = await fixture(t, { approveFixtures: true, childProcess: true }),
    browser = await signedIn(f);
  for (let i = 0; i < 53; i++)
    assert.equal(
      (
        await f.management("/v2/directives", {
          method: "POST",
          json: {
            action: "share",
            effect: "deny",
            text: `PRIVATE-DIRECTIVE-${i}`,
          },
        })
      ).status,
      201,
    );
  const expected = (
    await f.management("/v2/audit?eventType=directive.set&limit=100")
  ).json.events;
  assert.equal(expected.length, 53);
  const first = await browser.request(
    "/manage/audit?eventType=directive.set&limit=20",
  );
  const seen = ids(first.text);
  assert.equal(seen.length, 20);
  await f.restart();
  let link = next(first.text);
  while (link) {
    const page = await browser.request(link);
    assert.equal(page.status, 200);
    seen.push(...ids(page.text));
    assert.doesNotMatch(
      page.text,
      /PRIVATE-DIRECTIVE|Clear history|Clear session/,
    );
    link = next(page.text);
  }
  assert.deepEqual(
    seen,
    expected.map((e) => e.eventId),
  );
  for (const event of [expected[0], expected.at(-1)])
    assert.deepEqual(ids((await browser.request(exact(event.eventId))).text), [
      event.eventId,
    ]);
});

test("C7c interrupted committed read stays unconfirmed after restart; later denial invents no read", async (t) => {
  const f = await fixture(t, { approveFixtures: true, childProcess: true }),
    browser = await signedIn(f),
    token = await authorize(f);
  const grant = (await f.context("/v2/grants", token)).json.grants[0];
  await f.arm({
    operation: "releaseRead",
    point: "after-data-commit",
    action: "pause",
  });
  const pending = query(f, token, { query: "PRIVATE-LOST-QUERY" }).catch(
    () => null,
  );
  assert.equal(await f.boundary(), "after-data-commit");
  await f.kill();
  assert.equal(await pending, null);
  await f.restart();
  const events = (await f.management("/v2/audit?eventType=context.read")).json
    .events;
  assert.equal(events.length, 1);
  const page = await browser.request(exact(events[0].eventId));
  assert.match(page.text, /Read attempt recorded/);
  assert.match(page.text, /Receipt is unconfirmed/);
  assert.doesNotMatch(page.text, /PRIVATE-LOST-QUERY/);
  await f.management(`/v2/grants/${grant.grantId}`, { method: "DELETE" });
  assert.equal((await query(f, token)).status, 401);
  assert.deepEqual(
    (await f.management("/v2/audit?eventType=context.read")).json.events,
    events,
  );
});

test("C7c write-result disclosure is presented separately from a read and omits memory content", async (t) => {
  const f = await fixture(t, { approveFixtures: true }),
    browser = await signedIn(f);
  const token = await authorize(f, "a", [
    detail(["general_preferences"], undefined, { actions: ["read", "write"] }),
  ]);
  const grant = (await f.context("/v2/grants", token)).json.grants[0];
  const created = await f.context("/v2/entries", token, {
    method: "POST",
    json: {
      schema: "https://hcp.example/spec/entry/2.0",
      subject: grant.subject,
      content: {
        profile: "https://hcp.example/spec/profiles/general-context/2.0",
        value: "PRIVATE-WRITE-CONTENT",
      },
      classification: { categories: ["general_preferences"] },
      assertion: { declarationType: "person-declared" },
      record: { provenance: { source: "person-input" } },
    },
  });
  assert.equal(created.status, 201);
  const page = await browser.request(
    "/manage/audit?client=a&eventType=context.created",
  );
  assert.match(page.text, /Memory created/);
  assert.match(page.text, /Recorded disclosure attempt of the write result/);
  assert.doesNotMatch(page.text, /PRIVATE-WRITE-CONTENT|Read attempt recorded/);
});

for (const malformed of [false, true])
  test(`C7c reviewed imported policy extensions (${malformed ? "objects" : "arrays"}) cannot break or fabricate history matches`, async (t) => {
    const f = await fixture(t, { approveFixtures: true }),
      browser = await signedIn(f);
    const bundle = (await f.management("/v2/export")).json;
    bundle.entries = [];
    const unrelated = `urn:uuid:${randomUUID()}`;
    bundle.rules = [
      {
        ruleId: `urn:uuid:${randomUUID()}`,
        setBy: "context-subject",
        createdAt: new Date().toISOString(),
        effect: "deny",
        categories: ["work_context"],
        operators: ["unrelated.example"],
        categoriesSearched: malformed ? {} : ["general_preferences"],
        relatedTransitions: malformed ? {} : [{ id: unrelated }],
      },
    ];
    const review = await f.management("/experiment/import/review", {
      method: "POST",
      json: { export: bundle },
    });
    assert.equal(review.status, 200);
    assert.equal(
      (
        await f.management("/v2/import", {
          method: "POST",
          json: {
            reviewId: review.json.reviewId,
            csrf: review.json.csrf,
            subjects: review.json.subjects,
          },
        })
      ).status,
      200,
    );
    assert.equal((await browser.request("/manage/audit")).status, 200);
    const policy = (
      await f.management("/v2/audit?eventType=rule.set")
    ).json.events.at(-1);
    assert.equal((await browser.request(exact(policy.eventId))).status, 200);
    for (const suffix of [
      `category=general_preferences&eventType=rule.set`,
      `entryId=${unrelated}`,
    ]) {
      assert.deepEqual(
        (await f.management(`/v2/audit?${suffix}`)).json.events,
        [],
      );
      assert.match(
        (await browser.request(`/manage/audit?${suffix}`)).text,
        /No events match/,
      );
    }
    assert.equal(
      (
        await f.management(
          "/v2/audit/export?category=work_context&eventType=rule.set",
        )
      ).json.events.length,
      1,
    );
    assert.equal((await f.management("/v2/rules")).status, 200);
  });

test("C7c a reviewed mapped import is filterable by its foreign source and local destination categories", async (t) => {
  const f = await fixture(t, { approveFixtures: true }),
    browser = await signedIn(f);
  const bundle = (await f.management("/v2/export")).json;
  bundle.subject.id = "urn:example:foreign-subject";
  const entry = bundle.entries.find((e) => e.record.status === "active");
  entry.id = `urn:uuid:${randomUUID()}`;
  entry.subject.id = bundle.subject.id;
  entry.record.version = 1;
  entry.record.relationships = [];
  entry.classification.categories = ["urn:example:foreign-category"];
  bundle.entries = [entry];
  const review = await f.management("/experiment/import/review", {
    method: "POST",
    json: {
      export: bundle,
      categoryMap: { "urn:example:foreign-category": "work_context" },
    },
  });
  assert.equal(review.status, 200);
  assert.equal(
    (
      await f.management("/v2/import", {
        method: "POST",
        json: {
          reviewId: review.json.reviewId,
          csrf: review.json.csrf,
          subjects: review.json.subjects,
        },
      })
    ).status,
    200,
  );
  let id;
  for (const category of ["urn:example:foreign-category", "work_context"]) {
    const suffix = new URLSearchParams({
      category,
      eventType: "context.recategorized",
      entryId: entry.id,
    });
    const result = await f.management(`/v2/audit?${suffix}`);
    assert.equal(result.status, 200);
    assert.equal(result.json.events.length, 1);
    id ??= result.json.events[0].eventId;
    assert.equal(result.json.events[0].eventId, id);
    assert.deepEqual(
      ids((await browser.request(`/manage/audit?${suffix}`)).text),
      [id],
    );
  }
});

test("C7c management initiators and applied grant/entry filters remain visible and sticky", async (t) => {
  const f = await fixture(t, { approveFixtures: true }),
    browser = await signedIn(f),
    token = await authorize(f);
  const grant = (await f.context("/v2/grants", token)).json.grants[0];
  await f.management(`/v2/grants/${grant.grantId}`, { method: "DELETE" });
  const manager = "urn:context-router:synthetic-management";
  assert.equal(
    (
      await f.management(
        `/v2/audit?client=${encodeURIComponent(manager)}&eventType=grant.revoked`,
      )
    ).json.events.length,
    1,
  );
  for (const [key, value] of [
    ["grantId", grant.grantId],
    ["entryId", `urn:uuid:${randomUUID()}`],
  ]) {
    const page = await browser.request(
      `/manage/audit?${key}=${encodeURIComponent(value)}`,
    );
    assert.equal(inputs(page.text)[key], value);
    const submitted = await browser.request(
      `/manage/audit?${new URLSearchParams(inputs(page.text))}`,
    );
    assert.equal(inputs(submitted.text)[key], value);
  }
});

test("C7c anonymous exact bookmarks return to that event after sign-in without allowing arbitrary redirects", async (t) => {
  const f = await fixture(t, { approveFixtures: true });
  const event = (await f.management("/v2/audit")).json.events[0];
  const browser = new OAuthDriver(f, "a"),
    login = await browser.request(exact(event.eventId));
  const fields = inputs(login.text);
  assert.equal(fields.activityEvent, event.eventId);
  for (const value of ["//foreign.example", "/manage/export", "urn:uuid:bad"]) {
    assert.equal(
      (
        await browser.request("/manage/login", {
          method: "POST",
          headers: { origin: f.issuer },
          form: { ...fields, activityEvent: value, credential: f.human },
        })
      ).status,
      400,
    );
  }
  const signed = await browser.request("/manage/login", {
    method: "POST",
    headers: { origin: f.issuer },
    form: { ...fields, credential: f.human },
  });
  assert.equal(signed.status, 303);
  assert.equal(signed.headers.location, exact(event.eventId));
  assert.deepEqual(ids((await browser.request(signed.headers.location)).text), [
    event.eventId,
  ]);
});
