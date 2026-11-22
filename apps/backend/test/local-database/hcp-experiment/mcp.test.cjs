const { test } = require("node:test");
const assert = require("node:assert/strict");
const { fixture } = require("./authorization-fixture.cjs");
const { authorize, query, purpose, detail } = require("./read-helpers.cjs");
const {
  PURPOSES,
} = require("../../../dist/infrastructure/hcp-experiment/policy.js");
const {
  VERSION,
  envelope,
  rpc,
  call,
  mcpQuery,
  mcpGet,
} = require("./mcp-helpers.cjs");
const {
  Client,
  StreamableHTTPClientTransport,
} = require("@modelcontextprotocol/client");

test("C7 modern public discovery, protected descriptors, query/get and JSON text equality", async (t) => {
  const f = await fixture(t, { approveFixtures: true });
  const discovery = await rpc(f, undefined, "server/discover");
  assert.equal(discovery.status, 200);
  assert.equal(discovery.json.result.resultType, "complete");
  assert.equal(discovery.json.result.ttlMs, 0);
  assert.equal(discovery.json.result.cacheScope, "private");
  assert.deepEqual(
    discovery.json.result.capabilities.extensions["example.hcp/hcp"].conformsTo,
    [],
  );
  assert.deepEqual(Object.keys(discovery.json.result.capabilities).sort(), [
    "extensions",
    "tools",
  ]);
  const token = await authorize(f);
  const listed = await rpc(f, token, "tools/list");
  assert.equal(listed.status, 200);
  assert.equal(listed.json.result.ttlMs, 0);
  assert.equal(listed.json.result.cacheScope, "private");
  const tools = listed.json.result.tools;
  assert.deepEqual(
    tools.map((t) => t.name),
    ["hcp_queryContext", "hcp_getEntry"],
  );
  for (const tool of tools) {
    assert.equal(tool.inputSchema.type, "object");
    assert.equal(tool.outputSchema.type, "object");
    assert.equal(tool.inputSchema.additionalProperties, false);
    assert.ok(tool.outputSchema.anyOf);
    const checkRefs = (value, root = false) => {
      if (!value || typeof value !== "object") return;
      if (!root) assert.equal(value.$schema, undefined);
      if (value.$ref) assert.ok(value.$ref.startsWith("#"), value.$ref);
      for (const child of Object.values(value)) checkRefs(child);
    };
    checkRefs(tool.inputSchema, true);
    checkRefs(tool.outputSchema, true);
  }
  const result = await mcpQuery(f, token);
  assert.equal(result.status, 200);
  assert.equal(result.json.result.isError, false);
  const value = result.json.result.structuredContent;
  assert.deepEqual(JSON.parse(result.json.result.content[0].text), value);
  assert.equal(result.json.result.resultType, "complete");
  const Ajv = require("ajv/dist/2020").default,
    addFormats = require("ajv-formats").default;
  const ajv = new Ajv({ strict: false });
  addFormats(ajv);
  const valid = ajv.compile(tools[0].outputSchema);
  assert.equal(valid(value), true);
  for (const forbidden of [
    "id",
    "subject",
    "record",
    "schema",
    "provenance",
    "count",
  ]) {
    const unsafe = structuredClone(value);
    unsafe.entries[0][forbidden] = "private-canary";
    assert.equal(valid(unsafe), false);
    assert.throws(() =>
      require("../../../dist/infrastructure/hcp-experiment/mcp-contract.js").serializeTool(
        1,
        "hcp_queryContext",
        unsafe,
      ),
    );
  }
  const noDirectives = structuredClone(value);
  delete noDirectives.directives;
  assert.equal(valid(noDirectives), false);
  for (const type of [
    "malformed-request",
    "invalid-token",
    "scope-denied",
    "idempotency-conflict",
    "version-conflict",
    "credential-invalid",
    "subject-unavailable",
    "rate-limited",
    "unsupported-version",
  ])
    assert.equal(valid({ type, detail: "Bounded test error." }), true);
  assert.ok(
    result.json.result._meta["io.modelcontextprotocol/serverInfo"].name,
  );
  assert.equal(result.headers["mcp-session-id"], undefined);
  const withoutCopyTime = (entries) =>
    entries.map(({ useUntil, ...entry }) => entry);
  assert.deepEqual(
    withoutCopyTime(value.entries),
    withoutCopyTime((await query(f, token)).json.entries),
  );
  const get = await mcpGet(f, token, value.entries[0].ref, { version: 1 });
  assert.equal(get.json.result.structuredContent.entry.version, 1);
  const empty = await mcpQuery(f, token, { categories: [] });
  assert.equal(empty.json.result.isError, false);
  assert.deepEqual(empty.json.result.structuredContent.entries, []);
  const audit = (await f.management("/v2/audit?limit=100")).json.events.filter(
    (e) => e.eventType === "context.read",
  );
  assert.equal(audit.length, 4);
  assert.equal(audit[0].participants.retrievalId, value.retrievalId);
  assert.equal(audit[0].disclosed[0].useUntil, value.entries[0].useUntil);
  assert.deepEqual(audit[3].disclosed, []);
});

test("C7 transport errors, request-only scope challenges and generic hidden-entry tool errors", async (t) => {
  const f = await fixture(t, { approveFixtures: true });
  const token = await authorize(f);
  for (const credential of [undefined, f.human, "legacy-credential"]) {
    const r = await rpc(f, credential, "tools/list");
    assert.equal(r.status, 401);
    assert.match(r.headers["www-authenticate"], /^Bearer /);
  }
  for (const [extra, hint] of [
    [{ purpose: "https://example.test/no" }, "https://example.test/no"],
    [{ categories: ["work_context"] }, "hcp:work_context:read"],
  ]) {
    const r = await mcpQuery(f, token, extra);
    assert.equal(r.status, 403);
    assert.match(r.headers["www-authenticate"], /insufficient_scope/);
    assert.ok(r.headers["www-authenticate"].includes(hint));
  }
  for (const ref of [
    "unknown",
    "urn:uuid:00000000-0000-0000-0000-000000000000",
  ]) {
    const r = await mcpGet(f, token, ref);
    assert.equal(r.status, 200);
    assert.equal(r.headers["www-authenticate"], undefined);
    assert.equal(r.json.result.isError, true);
    assert.deepEqual(r.json.result.structuredContent, {
      type: "scope-denied",
      detail: "Entry not available under this grant.",
    });
    assert.deepEqual(
      JSON.parse(r.json.result.content[0].text),
      r.json.result.structuredContent,
    );
  }
  const malformed = await call(f, token, "hcp_queryContext", {});
  assert.equal(malformed.status, 200);
  assert.equal(
    malformed.json.result.structuredContent.type,
    "malformed-request",
  );
  const unknown = await call(f, token, "hcp_private", {});
  assert.equal(unknown.json.error.code, -32602);
  const method = await rpc(f, token, "initialize");
  assert.equal(method.status, 404);
  assert.equal(method.json.error.code, -32601);
  for (const headers of [
    { "mcp-method": "wrong" },
    { "mcp-protocol-version": "2025-11-25" },
    { "mcp-name": "other" },
  ]) {
    const r = await rpc(
      f,
      token,
      "tools/call",
      { name: "hcp_queryContext", arguments: { query: "notes", purpose } },
      { headers },
    );
    assert.equal(r.status, 400);
    assert.equal(r.json.error.code, -32020);
  }
  const origin = await rpc(
    f,
    token,
    "tools/list",
    {},
    { headers: { origin: "https://evil.test" } },
  );
  assert.equal(origin.status, 403);
  for (const method of ["GET", "DELETE"])
    assert.equal((await f.request("/v2/mcp", { method })).status, 405);
});

test("C7 official 2.4.0 peer pins the modern revision and validates descriptors/results over verified HTTPS", async (t) => {
  const f = await fixture(t, { approveFixtures: true }),
    token = await authorize(f),
    captures = [];
  const client = new Client(
    { name: "controlled-c7a-peer", version: "1" },
    { versionNegotiation: { mode: { pin: VERSION } } },
  );
  const transport = new StreamableHTTPClientTransport(
    new URL(f.issuer + "/v2/mcp"),
    {
      requestInit: { headers: { authorization: `Bearer ${token}` } },
      // Preserve the SDK's actual HTTP method/headers/body. Only fixture-local
      // name resolution and CA trust are supplied by the existing HTTPS driver.
      fetch: async (url, init) => {
        const request = new Request(url, init),
          target = new URL(request.url);
        assert.equal(target.origin, f.issuer);
        const raw = await request.text(),
          headers = Object.fromEntries(request.headers);
        const result = await f.request(target.pathname + target.search, {
          method: request.method,
          raw,
          headers,
        });
        captures.push({ body: JSON.parse(raw), response: result.json });
        return new Response(result.text, {
          status: result.status,
          headers: result.headers,
        });
      },
    },
  );
  try {
    await client.connect(transport);
    assert.equal(client.getProtocolEra(), "modern");
    const listed = await client.listTools();
    assert.equal(listed.tools.length, 2);
    const result = await client.callTool({
      name: "hcp_queryContext",
      arguments: { query: "notes", purpose },
    });
    assert.equal(result.isError, false);
    assert.deepEqual(
      JSON.parse(result.content[0].text),
      result.structuredContent,
    );
    const got = await client.callTool({
      name: "hcp_getEntry",
      arguments: { ref: result.structuredContent.entries[0].ref, purpose },
    });
    assert.equal(
      got.structuredContent.entry.ref,
      result.structuredContent.entries[0].ref,
    );
    const denied = await client.callTool({
      name: "hcp_getEntry",
      arguments: { ref: "unknown", purpose },
    });
    assert.equal(denied.isError, true);
    assert.deepEqual(
      JSON.parse(denied.content[0].text),
      denied.structuredContent,
    );
    for (const capture of captures) {
      assert.equal(
        capture.body.params._meta["io.modelcontextprotocol/protocolVersion"],
        VERSION,
      );
      assert.equal(capture.response.result.resultType, "complete");
    }
    assert.equal(JSON.stringify(captures).includes(token), false);
    assert.equal(JSON.stringify(captures).includes(f.human), false);
    assert.equal(
      captures.some((c) => c.body.method === "initialize"),
      false,
    );
  } finally {
    await client.close();
  }
});

test("C7 complete framing/parser refusals and credential separation have no read audit", async (t) => {
  const f = await fixture(t, { approveFixtures: true }),
    token = await authorize(f);
  for (const [body, code] of [
    [null, -32600],
    [[], -32600],
    [{ jsonrpc: "2.0", id: null, method: "tools/list" }, -32600],
    [{ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }, -32602],
  ]) {
    const r = await rpc(f, token, "tools/list", {}, { json: body });
    assert.equal(r.status, 400);
    assert.equal(r.json.error.code, code);
  }
  const body = envelope("tools/list");
  body.params._meta["io.modelcontextprotocol/protocolVersion"] = "2025-11-25";
  const older = await rpc(
    f,
    token,
    "tools/list",
    {},
    { json: body, headers: { "mcp-protocol-version": "2025-11-25" } },
  );
  assert.equal(older.status, 400);
  assert.equal(older.json.error.code, -32022);
  assert.deepEqual(older.json.error.data, {
    supported: [VERSION],
    requested: "2025-11-25",
  });
  for (const [raw, code] of [
    ["{", -32700],
    ['{"id":1,"id":2}', -32600],
    ['{"a":{"x":1,"\\u0078":2}}', -32600],
    [Buffer.from([0xff]), -32700],
  ]) {
    const r = await rpc(
      f,
      token,
      "tools/list",
      {},
      { json: undefined, raw, headers: { "content-type": "application/json" } },
    );
    assert.equal(r.status, 400);
    assert.equal(r.json.error.code, code);
    assert.equal("id" in r.json, false);
  }
  for (const headers of [
    { "content-type": "application/ld+json" },
    { "content-type": "application/json; charset=ascii" },
    { "content-type": "application/json", "content-encoding": "gzip" },
  ]) {
    const r = await rpc(
      f,
      token,
      "tools/list",
      {},
      { json: undefined, raw: JSON.stringify(envelope("tools/list")), headers },
    );
    assert.equal(r.status, 415);
  }
  for (const headers of [{ "mcp-method": "" }, { "mcp-protocol-version": "" }])
    assert.equal(
      (await rpc(f, token, "tools/list", {}, { headers })).json.error.code,
      -32020,
    );
  assert.equal(
    (
      await rpc(
        f,
        token,
        "tools/list",
        {},
        { headers: { accept: "application/json" } },
      )
    ).status,
    406,
  );
  assert.equal(
    (
      await rpc(
        f,
        token,
        "tools/list",
        {},
        {
          headers: { accept: "application/json;q=1, text/event-stream; q=0.5" },
        },
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await rpc(
        f,
        token,
        "tools/list",
        {},
        { headers: { accept: "application/json, text/event-stream;q=0" } },
      )
    ).status,
    406,
  );
  assert.equal(
    (
      await rpc(
        f,
        token,
        "tools/list",
        {},
        { headers: { cookie: "canary-human-cookie" } },
      )
    ).status,
    401,
  );
  assert.equal(
    (
      await rpc(
        f,
        undefined,
        "tools/list",
        {},
        { headers: { "mcp-session-id": "claimed-session" } },
      )
    ).status,
    401,
  );
  const params = {
    name: "hcp_queryContext",
    arguments: { query: "notes", purpose },
  };
  const encoded = await rpc(f, token, "tools/call", params, {
    headers: {
      "mcp-name":
        "=?base64?" + Buffer.from(params.name).toString("base64") + "?=",
    },
  });
  assert.equal(encoded.status, 200);
  assert.equal(encoded.json.result.isError, false);
  for (const args of [null, [], "x"])
    assert.equal(
      (await call(f, token, "hcp_queryContext", args)).json.error.code,
      -32602,
    );
  for (const args of [
    { ref: 17, purpose },
    { ref: "", purpose },
    { ref: "x", purpose, entryId: "private" },
  ])
    assert.equal(
      (await call(f, token, "hcp_getEntry", args)).json.result.structuredContent
        .type,
      "malformed-request",
    );
  const events = (await f.management("/v2/audit")).json.events.filter(
    (e) => e.eventType === "context.read",
  );
  assert.equal(events.length, 1); // Only the valid encoded-name call above.
});

test("C7 client invocation limit survives fresh grants and never limits revocation", async (t) => {
  const f = await fixture(t, { approveFixtures: true }),
    a = await authorize(f),
    a2 = await authorize(f),
    b = await authorize(f, "b");
  for (let i = 0; i < 60; i++)
    assert.equal(
      (await call(f, a, "hcp_queryContext", {})).json.result.structuredContent
        .type,
      "malformed-request",
    );
  const limited = await mcpQuery(f, a2);
  assert.equal(limited.status, 200);
  assert.equal(limited.json.result.isError, true);
  assert.equal(limited.json.result.structuredContent.type, "rate-limited");
  assert.equal((await mcpQuery(f, b)).json.result.isError, false);
  const grant = (await f.context("/v2/grants", a)).json.grants[0];
  assert.equal(
    (await f.management(`/v2/grants/${grant.grantId}`, { method: "DELETE" }))
      .status,
    204,
  );
  assert.equal((await mcpQuery(f, a)).status, 401);
});

test("C7 a purpose missing for requested categories remains an actionable purpose challenge", async (t) => {
  const f = await fixture(t, { approveFixtures: true }),
    token = await authorize(f, "a", [
      detail(["general_preferences"], [PURPOSES[0]]),
      detail(["work_context"], [PURPOSES[1]]),
    ]);
  const r = await mcpQuery(f, token, { categories: ["work_context"] });
  assert.equal(r.status, 403);
  assert.ok(
    r.headers["www-authenticate"].includes(`Purpose not approved: ${purpose}`),
  );
  assert.ok(r.headers["www-authenticate"].includes("hcp:work_context:read"));
});

test("C7 malformed categories never become OAuth scope challenges", async (t) => {
  const f = await fixture(t, { approveFixtures: true }),
    token = await authorize(f);
  for (const category of [
    "😀",
    "\ud800",
    "\udc00",
    "café",
    "\r\n",
    '"\\',
    "general_preferences:write hcp:work_context",
    "x offline_access openid y",
  ]) {
    const r = await mcpQuery(f, token, { categories: [category] });
    assert.equal(r.status, 200, JSON.stringify(category));
    assert.equal(r.headers["www-authenticate"], undefined);
    assert.equal(r.json.result.isError, true);
    assert.equal(r.json.result.structuredContent.type, "malformed-request");
    assert.equal(
      (await query(f, token, { categories: [category] })).status,
      422,
    );
  }
  assert.equal(
    (await f.management("/v2/audit")).json.events.filter(
      (event) => event.eventType === "context.read",
    ).length,
    0,
  );
});

test("C7 raw MCP query/get enforce Core argument bounds before reading", async (t) => {
  const f = await fixture(t, { approveFixtures: true }),
    token = await authorize(f);
  for (const extra of [
    { query: "" },
    { query: "  " },
    { query: 7 },
    { query: "x".repeat(8193) },
    { purpose: "not a URI" },
    { purposeDescription: "" },
    { purposeDescription: "x".repeat(2049) },
    { categories: "general_preferences" },
    { categories: [""] },
    { categories: [7] },
    { categories: ["x".repeat(513)] },
    { categories: Array(101).fill("general_preferences") },
    { maxEntries: 0 },
    { maxEntries: 1.5 },
    { maxEntries: Number.MAX_SAFE_INTEGER + 1 },
    { entryId: "private-canary" },
  ]) {
    const r = await mcpQuery(f, token, extra);
    assert.equal(r.status, 200);
    assert.equal(r.json.result.isError, true);
    assert.deepEqual(r.json.result.structuredContent, {
      type: "malformed-request",
      detail: "Invalid HCP request.",
    });
    assert.deepEqual(
      JSON.parse(r.json.result.content[0].text),
      r.json.result.structuredContent,
    );
    assert.equal(r.headers["www-authenticate"], undefined);
  }
  for (const version of [0, -1, 1.5, "1", Number.MAX_SAFE_INTEGER + 1]) {
    const r = await mcpGet(f, token, "unknown", { version });
    assert.equal(r.status, 200);
    assert.equal(r.json.result.isError, true);
    assert.equal(r.json.result.structuredContent.type, "malformed-request");
  }
  assert.equal(
    (await f.management("/v2/audit")).json.events.filter(
      (event) => event.eventType === "context.read",
    ).length,
    0,
  );
});
