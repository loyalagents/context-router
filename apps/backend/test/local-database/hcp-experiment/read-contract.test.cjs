const { test } = require("node:test");
const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { fixture } = require("./authorization-fixture.cjs");
const {
  authorize,
  detail,
  query,
  get,
  purpose,
} = require("./read-helpers.cjs");
const {
  mcpQuery,
  mcpGet,
  rpc,
  envelope,
  VERSION,
} = require("./mcp-helpers.cjs");
const {
  syntheticFixtures,
} = require("../../../dist/infrastructure/hcp-experiment/fixtures.js");
const {
  PURPOSES,
} = require("../../../dist/infrastructure/hcp-experiment/policy.js");
const audit = async (f) =>
  (await f.management("/v2/audit?limit=100")).json.events;
const badFields = [
  { evidence: [{ note: "missing role and type" }] },
  { evidence: [{ role: "supports" }] },
  { evidence: [{ type: "urn:example:opaque" }] },
  { assertion: { declarationType: "person-declared", basis: { task: 7 } } },
  {
    assertion: {
      declarationType: "person-declared",
      permittedPurposes: [purpose, "x:"],
    },
  },
  {
    content: {
      profile: "https://hcp.example/spec/profiles/general-context/2.0",
      value: "bad language",
      language: 7,
    },
  },
  { record: { provenance: { source: "person-input" }, metadata: 7 } },
];

test("C7 fixture admission rejects invalid Core fields before initialization", () => {
  const {
    validateFixtures,
  } = require("../../../dist/infrastructure/hcp-experiment/fixtures.js");
  for (const extra of badFields.slice(0, 6)) {
    const fixtures = syntheticFixtures();
    Object.assign(fixtures[0].versions[0], extra);
    assert.throws(() => validateFixtures(fixtures));
  }
});

test("C7 Core-invalid writes reject before persistence while valid unknown evidence survives both bindings", async (t) => {
  const f = await fixture(t, { approveFixtures: true });
  const writer = await authorize(f, "a", [
    detail(["general_preferences"], undefined, { actions: ["read", "write"] }),
  ]);
  const grant = (await f.context("/v2/grants", writer)).json.grants[0];
  const body = {
    schema: "https://hcp.example/spec/entry/2.0",
    subject: grant.subject,
    content: {
      profile: "https://hcp.example/spec/profiles/general-context/2.0",
      value: "contract sentinel",
    },
    classification: { categories: ["general_preferences"] },
    assertion: { declarationType: "person-declared" },
    record: { provenance: { source: "person-input" } },
  };
  const before = await audit(f);
  for (const extra of badFields) {
    const r = await f.context("/v2/entries", writer, {
      method: "POST",
      json: { ...body, ...extra },
    });
    assert.equal(r.status, 422, JSON.stringify(extra));
  }
  assert.deepEqual(await audit(f), before);
  const evidence = [
    {
      role: "supports",
      type: "urn:example:opaque",
      extra: { nested: [null, 7] },
    },
  ];
  assert.equal(
    (
      await f.context("/v2/entries", writer, {
        method: "POST",
        json: { ...body, evidence },
      })
    ).status,
    201,
  );
  const reader = await authorize(f, "b"),
    http = await query(f, reader, { query: "contract sentinel" });
  assert.deepEqual(http.json.entries[0].evidence, evidence);
  assert.deepEqual(
    (await mcpQuery(f, reader, { query: "contract sentinel" })).json.result
      .structuredContent.entries[0].evidence,
    evidence,
  );
  const own = (await query(f, writer, { query: "contract sentinel" })).json
    .entries[0];
  const prior = await audit(f);
  for (const extra of badFields) {
    const { schema, subject, classification, ...revision } = {
      ...body,
      ...extra,
    };
    assert.equal(
      (
        await f.context(`/v2/entries/${encodeURIComponent(own.ref)}`, writer, {
          method: "PUT",
          json: {
            ...revision,
            expectedVersion: own.version,
            reason: "contract rejection",
          },
        })
      ).status,
      422,
    );
  }
  assert.deepEqual(await audit(f), prior);
});

test("C7 policy and classification ingress reject Core-invalid identifiers without changing authority", async (t) => {
  const f = await fixture(t, { approveFixtures: true }),
    token = await authorize(f);
  const entry = (await f.management("/v2/export")).json.entries[0],
    before = await audit(f);
  for (const action of ["urn:", "x:"]) {
    const directive = { action, effect: "deny", text: "not a valid action" };
    assert.equal(
      (
        await f.management("/v2/directives", {
          method: "POST",
          json: directive,
        })
      ).status,
      422,
    );
    assert.equal(
      (
        await f.management("/experiment/policy", {
          method: "PUT",
          json: { rules: [], directives: [directive] },
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await f.management(
          `/v2/entries/${encodeURIComponent(entry.id)}/purposes`,
          {
            method: "PUT",
            json: {
              expectedVersion: entry.record.version,
              permittedPurposes: [purpose, action],
            },
          },
        )
      ).status,
      422,
    );
  }
  assert.deepEqual(await audit(f), before);
  assert.equal((await mcpQuery(f, token)).json.result.isError, false);
});

test("C7 imports reject malformed current/history entries and directives before application", async (t) => {
  const f = await fixture(t, { approveFixtures: true });
  const original = (await f.management("/v2/export?include=versions")).json;
  for (const history of [false, true]) {
    const bundle = structuredClone(original),
      entry = bundle.entries.find((e) => e.record.version === 2);
    bundle.entries = [entry];
    bundle.versions = bundle.versions.filter((e) => e.id === entry.id);
    const id = `urn:uuid:${randomUUID()}`;
    for (const e of [...bundle.entries, ...bundle.versions]) {
      e.id = id;
      e.record.relationships = [];
    }
    (history ? bundle.versions[0] : entry).evidence = [{ role: "supports" }];
    const r = await f.management("/v2/import?dryRun=true", {
      method: "POST",
      json: { export: JSON.stringify(bundle) },
    });
    assert.equal(r.status, 200);
    assert.equal(r.json.outcomes[0].outcome, "rejected");
  }
  const bundle = structuredClone(original);
  bundle.directives = [
    {
      directiveId: `urn:uuid:${randomUUID()}`,
      action: "x:",
      effect: "deny",
      text: "bad",
      setBy: "context-subject",
      createdAt: new Date().toISOString(),
    },
  ];
  const r = await f.management("/v2/import?dryRun=true", {
    method: "POST",
    json: { export: JSON.stringify(bundle) },
  });
  assert.equal(r.status, 200);
  assert.ok(r.json.blockers.length);
  assert.equal(
    (await audit(f)).filter((e) => e.eventType === "context.imported").length,
    0,
  );
});

for (const retained of ["current", "historical", "directive"])
  test(`C7 retained invalid ${retained} data refuses only the read and leaves management/revocation available`, async (t) => {
    const f = await fixture(t, { approveFixtures: true, childProcess: true });
    const token = await authorize(f),
      other = await authorize(f, "b");
    const grant = (await f.context("/v2/grants", token)).json.grants[0];
    let directiveId;
    if (retained === "directive") {
      const d = await f.management("/v2/directives", {
        method: "POST",
        json: { action: "share", effect: "deny", text: "retained directive" },
      });
      assert.equal(d.status, 201);
      directiveId = d.json.directiveId;
    }
    // Emulate data written by the pre-fix provider, only after its owned fixture
    // has closed normally. No live handle, private user state or journal is edited.
    await f.close();
    const file = path.join(f.sandbox, "experiment", "entries.sqlite"),
      db = new DatabaseSync(file);
    try {
      if (retained === "directive") {
        const doc = JSON.parse(
          db
            .prepare("SELECT document FROM policies WHERE id=?")
            .get(directiveId).document,
        );
        doc.action = "x:";
        db.prepare("UPDATE policies SET document=? WHERE id=?").run(
          JSON.stringify(doc),
          directiveId,
        );
      } else {
        const row = db
          .prepare("SELECT id FROM entries WHERE current_version=2")
          .get();
        const original = JSON.parse(
          db
            .prepare(
              "SELECT document FROM entry_versions WHERE entry_id=? AND version=2",
            )
            .get(row.id).document,
        );
        const doc = structuredClone(original);
        doc.record.version = 3;
        doc.evidence = [{ role: "supports" }];
        // Append simulated pre-fix versions; preserve every immutable-row trigger.
        db.prepare("INSERT INTO entry_versions VALUES(?,?,?,NULL)").run(
          row.id,
          3,
          JSON.stringify(doc),
        );
        if (retained === "historical") {
          original.record.version = 4;
          db.prepare("INSERT INTO entry_versions VALUES(?,?,?,NULL)").run(
            row.id,
            4,
            JSON.stringify(original),
          );
        }
        db.prepare("UPDATE entries SET current_version=? WHERE id=?").run(
          retained === "historical" ? 4 : 3,
          row.id,
        );
      }
    } finally {
      db.close();
    }
    await f.restart();
    let ref;
    if (retained === "historical")
      ref = (await query(f, token)).json.entries[0].ref;
    const before = (await audit(f)).filter(
      (e) => e.eventType === "context.read",
    );
    const refs = () => {
      const inspect = new DatabaseSync(file, { readOnly: true });
      try {
        return inspect.prepare("SELECT count(*) AS n FROM grant_refs").get().n;
      } finally {
        inspect.close();
      }
    };
    const refsBefore = refs();
    const http =
      retained === "historical"
        ? await get(f, token, ref, { version: 3 })
        : await query(
            f,
            token,
            retained === "directive" ? { categories: [] } : {},
          );
    assert.equal(http.status, 503);
    const mcp =
      retained === "historical"
        ? await mcpGet(f, token, ref, { version: 3 })
        : await mcpQuery(
            f,
            token,
            retained === "directive" ? { categories: [] } : {},
          );
    assert.equal(mcp.status, 500);
    assert.equal(mcp.json.error.code, -32603);
    assert.equal(mcp.headers["www-authenticate"], undefined);
    assert.equal(refs(), refsBefore);
    assert.deepEqual(
      (await audit(f)).filter((e) => e.eventType === "context.read"),
      before,
    );
    assert.equal((await rpc(f, token, "tools/list")).status, 200);
    assert.equal(
      (await f.management(`/v2/grants/${grant.grantId}`, { method: "DELETE" }))
        .status,
      204,
    );
    if (directiveId)
      assert.equal(
        (
          await f.management(`/v2/directives/${directiveId}`, {
            method: "DELETE",
          })
        ).status,
        204,
      );
    assert.equal(
      (await mcpQuery(f, other, { categories: [] })).json.result.isError,
      false,
    );
    assert.equal((await query(f, other, { categories: [] })).status, 200);
    await f.restart();
    assert.equal((await rpc(f, other, "tools/list")).status, 200);
    if (retained !== "directive") {
      const retry =
        retained === "historical"
          ? await mcpGet(
              f,
              other,
              (await query(f, other)).json.entries[0].ref,
              { version: 3 },
            )
          : await mcpQuery(f, other);
      assert.equal(retry.status, 500);
      assert.equal((await f.management("/v2/audit")).status, 200);
    }
  });

test("C7 scope hints contain only requested advertised read scopes", async (t) => {
  const f = await fixture(t, { approveFixtures: true }),
    token = await authorize(f);
  const listed = (await rpc(f, token, "tools/list")).json.result.tools[0];
  const Ajv = require("ajv/dist/2020").default,
    ajv = new Ajv({ strict: false });
  require("ajv-formats")(ajv);
  const valid = ajv.compile(listed.inputSchema);
  for (const category of [
    "😀",
    "general_preferences:write hcp:work_context",
    "x offline_access openid y",
    "\r\n",
  ])
    assert.equal(
      valid({ query: "notes", purpose, categories: [category] }),
      false,
    );
  for (const category of [
    "unknown_slug",
    "https://example.test/custom",
    "urn:custom:category",
  ]) {
    assert.equal(
      valid({ query: "notes", purpose, categories: [category] }),
      true,
    );
    for (const categories of [[category], [category, "work_context"]]) {
      const r = await mcpQuery(f, token, { categories });
      assert.equal(r.status, 403);
      const scope = /(?:^|, )scope="([^"]*)"/.exec(
        r.headers["www-authenticate"],
      );
      assert.equal(
        scope?.[1],
        categories.length === 1 ? undefined : "hcp:work_context:read",
      );
    }
  }
});

test("C7 stored-rule and historical-purpose denials never challenge for more OAuth scope", async (t) => {
  const fixtures = syntheticFixtures();
  fixtures[0].versions[0].assertion.permittedPurposes = [PURPOSES[1].code];
  const f = await fixture(t, { approveFixtures: true, fixtures }),
    token = await authorize(f, "a", [
      detail(["general_preferences", "work_context"]),
    ]);
  const entries = (
    await mcpQuery(f, token, { categories: ["general_preferences"] })
  ).json.result.structuredContent.entries;
  assert.equal(entries.length, 1);
  assert.equal(entries[0].version, 2);
  const ref = entries[0].ref;
  const noChallenge = (r) => {
    assert.equal(r.status, 200);
    assert.equal(r.json.result.isError, true);
    assert.equal(r.json.result.structuredContent.type, "scope-denied");
    assert.equal(r.headers["www-authenticate"], undefined);
  };
  noChallenge(await mcpGet(f, token, ref, { version: 1 }));
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
  noChallenge(await mcpQuery(f, token));
  noChallenge(
    await mcpQuery(f, token, {
      categories: ["general_preferences", "work_context"],
    }),
  );
});

test("C7 modern-only initialize refusals identify the supported protocol", async (t) => {
  const f = await fixture(t, { approveFixtures: true });
  const message = envelope("initialize", {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name: "legacy", version: "1" },
  });
  delete message.params._meta;
  const r = await f.request("/v2/mcp", {
    method: "POST",
    json: message,
    headers: { accept: "application/json, text/event-stream" },
  });
  assert.equal(r.status, 400);
  assert.deepEqual(r.json.error.data.supported, [VERSION]);
});
