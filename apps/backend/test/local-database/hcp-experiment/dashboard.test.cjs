const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");
const { fixture, OAuthDriver, inputs } = require("./authorization-fixture.cjs");
const { sourceFixture } = require("./source-fixture.cjs");
const { authorize, detail } = require("./read-helpers.cjs");
const {
  GENERAL_PROFILE,
} = require("../../../dist/infrastructure/hcp-experiment/fixtures.js");
async function signedIn(f) {
  const browser = new OAuthDriver(f, "a"),
    login = await browser.request("/manage/entries");
  await browser.request("/manage/login", {
    method: "POST",
    headers: { origin: f.issuer },
    form: { csrf: inputs(login.text).csrf, credential: f.human },
  });
  return browser;
}
async function entries(f) {
  return (await f.management("/v2/export?include=versions")).json;
}
async function review(
  f,
  browser,
  entry,
  value = "Synthetic correction: concise summaries.",
) {
  const editor = await browser.request(
    `/manage/person/${encodeURIComponent(entry.id)}`,
  );
  return browser.request("/manage/person/review", {
    method: "POST",
    headers: { origin: f.issuer },
    form: {
      csrf: inputs(editor.text).csrf,
      entryId: entry.id,
      expectedVersion: entry.record.version,
      value,
    },
  });
}
test("C6 demo navigation, empty grants and readable retained inspection use existing routes", async (t) => {
  const f = await fixture(t, { approveFixtures: true }),
    browser = await signedIn(f);
  const list = await browser.request("/manage/entries");
  assert.match(list.text, /aria-label="Main navigation"/);
  assert.match(list.text, /aria-current="page"[^>]*>Memories/);
  assert.doesNotMatch(list.text, /href="\/manage\/person\/new"/);
  assert.doesNotMatch(list.text, /<script/);
  const grants = await browser.request("/manage");
  assert.match(grants.text, /No active grants/);
  assert.match(grants.text, /All retained grants/);
  const token = await authorize(f, "a", [detail(["general_preferences"])]);
  const grant = (await f.context("/v2/grants", token)).json.grants[0];
  const inspected = await browser.request(
    `/manage?grantId=${encodeURIComponent(grant.grantId)}`,
  );
  assert.match(inspected.text, /data-grant-summary/);
  assert.ok(
    inspected.text.includes(
      grant.access[0].purposes[0].description.replaceAll("'", "&#39;"),
    ),
  );
  assert.match(inspected.text, /Full grant document/);
  assert.match(inspected.text, /data-history-summary/);
  assert.match(inspected.text, /<strong>grant\.issued<\/strong>/);
  assert.ok(
    inspected.text.includes(`<dt>Access ends</dt><dd>${grant.expiresAt}</dd>`),
  );
  const revoked = await browser.request("/manage/revoke", {
    method: "POST",
    headers: { origin: f.issuer },
    form: { csrf: inputs(inspected.text).csrf, grantId: grant.grantId },
  });
  assert.equal(revoked.status, 303);
  const retained = await browser.request(revoked.headers.location);
  assert.match(retained.text, /<dt>Access ended<\/dt><dd>revoked<\/dd>/);
  assert.doesNotMatch(retained.text, /<dt>Access ends<\/dt>/);
});
test("C6 review displays exact submitted text without executing or flattening markup", async (t) => {
  const f = await fixture(t, { approveFixtures: true }),
    browser = await signedIn(f);
  const entry = (await entries(f)).entries.find(
    (e) => typeof e.content.value === "string" && e.record.status === "active",
  );
  const value =
    'Synthetic <script>example()</script> & "quoted" text\n</textarea>';
  const reviewed = await review(f, browser, entry, value);
  assert.equal(reviewed.status, 200);
  assert.match(
    reviewed.text,
    /&lt;script&gt;example\(\)&lt;\/script&gt; &amp; &quot;quoted&quot; text/,
  );
  assert.match(reviewed.text, /Exact replacement document/);
  assert.doesNotMatch(reviewed.text, /<script|<\/textarea>/);
  assert.equal(
    (await entries(f)).entries.find((e) => e.id === entry.id).record.version,
    entry.record.version,
  );
});
test("C6 browser denial has safe recovery links without reflecting rejected content", async (t) => {
  const f = await fixture(t, { approveFixtures: true }),
    browser = await signedIn(f);
  const denied = await browser.request("/manage/person/review", {
    method: "POST",
    headers: { origin: f.issuer },
    form: {
      csrf: "forged",
      value: "private rejected value <script>bad()</script>",
    },
  });
  assert.equal(denied.status, 403);
  assert.match(denied.headers["content-type"], /text\/html/);
  assert.match(denied.text, /Request refused/);
  assert.match(denied.text, /href="\/manage\/entries"/);
  assert.doesNotMatch(
    denied.text,
    /private rejected value|bad\(\)|<form|<script/,
  );
});
test("C6 inspection labels current lifecycle and classification; structured and unavailable targets are view-only", async (t) => {
  const f = await fixture(t, { approveFixtures: true }),
    browser = await signedIn(f),
    before = await entries(f);
  const list = await browser.request("/manage/entries");
  assert.match(list.text, /Synthetic data only/);
  for (const entry of before.entries) {
    assert.ok(list.text.includes(encodeURIComponent(entry.id)));
    const detail = await browser.request(
      `/manage/entries/${encodeURIComponent(entry.id)}`,
    );
    assert.match(detail.text, /current lifecycle and classification/);
    const editable =
      entry.content.profile === GENERAL_PROFILE &&
      ["person-declared", "model-inferred"].includes(
        entry.assertion.declarationType,
      ) &&
      typeof entry.content.value === "string" &&
      ["active", "conflicted", "expired", "deprecated"].includes(
        entry.record.status,
      );
    assert.equal(
      detail.text.includes(">Edit as your own statement</a>"),
      editable,
    );
    if (!editable) {
      const editor = await browser.request(
        `/manage/person/${encodeURIComponent(entry.id)}`,
      );
      assert.equal(editor.status, 200);
      assert.match(editor.text, /View only/);
      assert.ok(!editor.text.includes('<textarea name="value"'));
      const forged = await browser.request("/manage/person/review", {
        method: "POST",
        headers: { origin: f.issuer },
        form: {
          csrf:
            inputs(list.text).csrf ||
            inputs((await browser.request("/manage/person/new")).text).csrf,
          entryId: entry.id,
          expectedVersion: entry.record.version,
          value: "Do not flatten a structured entry",
        },
      });
      assert.equal(forged.status, 403);
    }
  }
  assert.deepEqual((await entries(f)).entries, before.entries);
});
test("C6 a client-created model-inferred string can be reviewed as a new person assertion", async (t) => {
  const f = await fixture(t, { approveFixtures: true });
  const token = await authorize(f, "a", [
    detail(["general_preferences"], undefined, { actions: ["read", "write"] }),
  ]);
  const grant = (await f.context("/v2/grants", token)).json.grants[0];
  const value = "Synthetic model suggestion to review as a person.";
  const created = await f.context("/v2/entries", token, {
    method: "POST",
    json: {
      schema: "https://hcp.example/spec/entry/2.0",
      subject: grant.subject,
      content: { profile: GENERAL_PROFILE, value },
      classification: { categories: ["general_preferences"] },
      assertion: { declarationType: "model-inferred", confidence: "high" },
      record: {
        provenance: {
          source: "synthetic-test-producer",
          assertedBy: {
            id: "urn:context-router:controlled-synthetic-model:v1",
          },
          fixture: { simulated: true, modelExecuted: false },
        },
      },
    },
  });
  assert.equal(created.status, 201);
  const entry = (await entries(f)).entries.find(
    (e) => e.content.value === value,
  );
  assert.equal(entry.assertion.declarationType, "model-inferred");
  const browser = await signedIn(f);
  const page = await browser.request(
    `/manage/entries/${encodeURIComponent(entry.id)}`,
  );
  assert.match(page.text, />Edit as your own statement<\/a>/);
  const reviewed = await review(f, browser, entry);
  assert.equal(reviewed.status, 200);
  assert.match(reviewed.text, /model-inferred/);
  assert.equal(
    (
      await browser.request("/manage/person/approve", {
        method: "POST",
        headers: { origin: f.issuer },
        form: inputs(reviewed.text),
      })
    ).status,
    201,
  );
  const after = await entries(f),
    current = after.entries.find((e) => e.id === entry.id);
  assert.equal(current.assertion.declarationType, "person-declared");
  assert.equal(current.record.version, entry.record.version + 1);
  assert.deepEqual(
    after.versions.find((e) => e.id === entry.id && e.record.version === 1),
    entry,
  );
});

test("C6 string-valued retained unsupported declarations and profiles remain view-only", async (t) => {
  const f = await fixture(t, { approveFixtures: true, childProcess: true });
  const original = (await entries(f)).entries.find(
    (e) => e.record.status === "active" && typeof e.content.value === "string",
  );
  const retained = [
    "issuer-attested",
    "future-declaration",
    "credential-profile",
  ].map((kind) => {
    const entry = structuredClone(original);
    entry.id = `urn:uuid:${randomUUID()}`;
    if (kind === "credential-profile")
      entry.content.profile =
        "https://hcp.example/spec/profiles/credential/2.0";
    else entry.assertion.declarationType = kind;
    return entry;
  });
  await f.close();
  // Public admission excludes these types. Seed new controlled retained records
  // while stopped, without changing existing immutable versions or schema guards.
  const db = new DatabaseSync(
    path.join(f.sandbox, "experiment/entries.sqlite"),
  );
  try {
    db.exec("PRAGMA foreign_keys=ON; BEGIN");
    for (const entry of retained) {
      db.prepare(
        "INSERT INTO entries(id,subject,current_version,classification,status) VALUES(?,?,?,?,?)",
      ).run(
        entry.id,
        JSON.stringify(entry.subject),
        entry.record.version,
        JSON.stringify(entry.classification),
        entry.record.status,
      );
      db.prepare(
        "INSERT INTO entry_versions(entry_id,version,document,valid_until) VALUES(?,?,?,?)",
      ).run(entry.id, entry.record.version, JSON.stringify(entry), null);
    }
    db.exec("COMMIT");
  } finally {
    db.close();
  }
  await f.restart();
  const browser = await signedIn(f),
    before = await entries(f);
  const csrf = inputs((await browser.request("/manage/person/new")).text).csrf;
  for (const entry of retained) {
    const detail = await browser.request(
      `/manage/entries/${encodeURIComponent(entry.id)}`,
    );
    assert.equal(detail.status, 200);
    assert.doesNotMatch(detail.text, />Edit as your own statement<\/a>/);
    const editor = await browser.request(
      `/manage/person/${encodeURIComponent(entry.id)}`,
    );
    assert.equal(editor.status, 200);
    assert.match(editor.text, /View only/);
    assert.doesNotMatch(editor.text, /<textarea name="value"/);
    const forged = await browser.request("/manage/person/review", {
      method: "POST",
      headers: { origin: f.issuer },
      form: {
        csrf,
        entryId: entry.id,
        expectedVersion: entry.record.version,
        value: "Do not convert this retained type",
      },
    });
    assert.equal(forged.status, 403);
  }
  assert.deepEqual((await entries(f)).entries, before.entries);
});
test("C6 exact correction displays replacement losses, preserves content extensions and principal restrictions, and commits one new person version", async (t) => {
  const f = await fixture(t, { approveFixtures: true }),
    browser = await signedIn(f),
    before = await entries(f);
  const entry = before.entries.find(
      (e) =>
        e.record.status === "active" && typeof e.content.value === "string",
    ),
    reviewed = await review(f, browser, entry);
  assert.equal(reviewed.status, 200);
  for (const text of [
    /Previous assertion/,
    /Proposed assertion/,
    /Evidence items removed/,
    /not inherited/,
    /Principal purpose restrictions remain/,
    /Cancel without saving/,
  ])
    assert.match(reviewed.text, text);
  assert.ok(reviewed.text.includes(entry.id));
  assert.equal(
    (await entries(f)).entries.find((e) => e.id === entry.id).record.version,
    entry.record.version,
  );
  const post = {
    method: "POST",
    headers: { origin: f.issuer },
    form: inputs(reviewed.text),
  };
  const saved = await browser.request("/manage/person/approve", post);
  assert.equal(saved.status, 201);
  const after = await entries(f),
    current = after.entries.find((e) => e.id === entry.id);
  assert.equal(current.record.version, entry.record.version + 1);
  assert.equal(
    current.content.value,
    "Synthetic correction: concise summaries.",
  );
  assert.deepEqual(current.content.extension, entry.content.extension);
  assert.deepEqual(current.classification, entry.classification);
  assert.deepEqual(current.evidence ?? [], []);
  assert.deepEqual(current.record.provenance.confirmations, []);
  assert.equal(current.assertion.declarationType, "person-declared");
  assert.equal(current.record.provenance.source, "person-input");
  assert.deepEqual(
    after.versions.find(
      (e) => e.id === entry.id && e.record.version === entry.record.version,
    ),
    entry,
  );
  const historical = await browser.request(
    `/manage/entries/${encodeURIComponent(entry.id)}?version=${entry.record.version}`,
  );
  assert.match(historical.text, /Viewing a previous version/);
  assert.match(historical.text, /Open current version to edit/);
  assert.match(historical.text, /data-history-summary/);
  assert.match(historical.text, /<details data-raw-history>/);
  assert.equal(
    (await browser.request("/manage/person/approve", post)).status,
    201,
  );
  assert.equal(
    (await entries(f)).entries.find((e) => e.id === entry.id).record.version,
    current.record.version,
  );
  assert.equal(
    (
      await browser.request("/manage/person/approve", {
        ...post,
        form: { ...post.form, operationKey: "different-key" },
      })
    ).status,
    403,
  );
});
for (const [stage, title] of [
  ["entries", "Retained entries"],
  ["entry", "Retained entry and history"],
  ["editor", "Edit as your own statement"],
  ["review", "Review your statement"],
  ["saved", "Statement saved"],
  ["grants", "Human grant controls"],
  ["audit", "Activity"],
])
  test(`C6 ${stage} withholds protected details at the final HTML render deadline`, async (t) => {
    const f = await fixture(t, { approveFixtures: true, childProcess: true }),
      browser = await signedIn(f),
      entry = (await entries(f)).entries.find(
        (e) =>
          e.record.status === "active" && typeof e.content.value === "string",
      );
    const protectedGrant =
      stage === "grants"
        ? (await f.context("/v2/grants", await authorize(f))).json.grants[0]
        : undefined;
    const reviewed =
      stage === "saved" ? await review(f, browser, entry) : undefined;
    await f.arm({
      operation: "c6-render",
      point: "during-management-page-render",
      title,
      action: "advance",
      now: Date.now() + 12 * 3600_000 + 1000,
    });
    const response =
      stage === "saved"
        ? await browser.request("/manage/person/approve", {
            method: "POST",
            headers: { origin: f.issuer },
            form: inputs(reviewed.text),
          })
        : stage === "review"
          ? await review(f, browser, entry)
          : await browser.request(
              stage === "grants"
                ? "/manage"
                : stage === "audit"
                  ? "/manage/audit"
                  : stage === "entries"
                    ? "/manage/entries"
                    : stage === "entry"
                      ? `/manage/entries/${encodeURIComponent(entry.id)}`
                      : `/manage/person/${encodeURIComponent(entry.id)}`,
            );
    assert.equal(response.status, stage === "saved" ? 201 : 401);
    assert.ok(!response.text.includes(entry.id));
    assert.ok(!response.text.includes(encodeURIComponent(entry.id)));
    assert.doesNotMatch(
      response.text,
      /written notes|Synthetic correction|context\.created|context\.revised/,
    );
    if (protectedGrant) {
      assert.ok(!response.text.includes(protectedGrant.grantId));
      assert.ok(
        !response.text.includes(encodeURIComponent(protectedGrant.grantId)),
      );
    }
    if (stage === "saved") assert.match(response.text, /committed/);
  });
test("C6 source reviews reject foreign sessions, CSRF, stale versions, expired deadlines and policy changes restored to the same value", async (t) => {
  const f = await sourceFixture(t),
    browser = await signedIn(f),
    foreign = await signedIn(f),
    entry = (await entries(f)).entries.find(
      (e) =>
        typeof e.content.value === "string" && e.record.status === "active",
    );
  const reviewed = await review(f, browser, entry),
    form = inputs(reviewed.text),
    post = { method: "POST", headers: { origin: f.issuer }, form };
  assert.equal(
    (await foreign.request("/manage/person/approve", post)).status,
    403,
  );
  assert.equal(
    (
      await browser.request("/manage/person/approve", {
        ...post,
        form: { ...form, csrf: "forged" },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await browser.request("/manage/person/approve", {
        ...post,
        headers: { origin: "https://foreign.example" },
      })
    ).status,
    403,
  );
  const policy = await f.management(
    `/v2/entries/${encodeURIComponent(entry.id)}/purposes`,
    {
      method: "PUT",
      json: { expectedVersion: entry.record.version, permittedPurposes: [] },
    },
  );
  assert.equal(policy.status, 200);
  await f.management(`/v2/entries/${encodeURIComponent(entry.id)}/purposes`, {
    method: "PUT",
    json: {
      expectedVersion: entry.record.version,
      permittedPurposes: entry.classification.permittedPurposes,
    },
  });
  assert.equal(
    (await browser.request("/manage/person/approve", post)).status,
    403,
  );
  const fresh = await review(f, browser, entry);
  await f.clock(Date.now() + 600_001);
  assert.equal(
    (
      await browser.request("/manage/person/approve", {
        ...post,
        form: inputs(fresh.text),
      })
    ).status,
    403,
  );
  await f.clock(Date.now());
  const first = await review(f, browser, entry),
    second = await review(f, browser, entry);
  assert.equal(
    (
      await browser.request("/manage/person/approve", {
        ...post,
        form: inputs(first.text),
      })
    ).status,
    201,
  );
  assert.equal(
    (
      await browser.request("/manage/person/approve", {
        ...post,
        form: inputs(second.text),
      })
    ).status,
    403,
  );
  assert.equal(
    (await entries(f)).entries.find((e) => e.id === entry.id).record.version,
    entry.record.version + 1,
  );
});
for (const [point, action] of [
  ["before-audit", "throw"],
  ["before-commit", "block"],
  ["after-data-commit", "block"],
])
  test(`C6 source correction ${point}: rollback or one durable commit, no automatic replay`, async (t) => {
    const f = await sourceFixture(t),
      browser = await signedIn(f),
      entry = (await entries(f)).entries.find(
        (e) =>
          typeof e.content.value === "string" && e.record.status === "active",
      ),
      reviewed = await review(f, browser, entry),
      form = inputs(reviewed.text);
    await f.arm({ operation: "commitMutation", point, action });
    const response = browser
      .request("/manage/person/approve", {
        method: "POST",
        headers: { origin: f.issuer },
        form,
      })
      .catch(() => undefined);
    if (action === "block") {
      await f.boundary();
      await f.kill();
    }
    const outcome = await response;
    if (point === "before-audit") {
      assert.equal(outcome.status, 503);
      assert.match(outcome.headers["content-type"], /text\/html/);
      assert.match(outcome.text, /Save outcome uncertain/);
      assert.match(outcome.text, /Do not submit again/);
      assert.doesNotMatch(outcome.text, /<form|Synthetic correction/);
    }
    await f.restart();
    const current = (await entries(f)).entries.find((e) => e.id === entry.id);
    assert.equal(
      current.record.version,
      entry.record.version + (point === "after-data-commit" ? 1 : 0),
    );
    if (point === "after-data-commit") {
      assert.equal(
        (
          await browser.request("/manage/person/approve", {
            method: "POST",
            headers: { origin: f.issuer },
            form,
          })
        ).status,
        201,
      );
      assert.equal(
        (await entries(f)).entries.find((e) => e.id === entry.id).record
          .version,
        entry.record.version + 1,
      );
      assert.equal(
        (
          await f.management(
            `/v2/audit?entryId=${encodeURIComponent(entry.id)}&eventType=context.revised`,
          )
        ).json.events.length,
        1,
      );
    }
    if (point === "before-audit" || point === "before-commit") {
      const retry = await review(f, browser, entry);
      assert.equal(
        (
          await browser.request("/manage/person/approve", {
            method: "POST",
            headers: { origin: f.issuer },
            form: inputs(retry.text),
          })
        ).status,
        201,
      );
    }
  });
