const { test } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { channel } = require("node:diagnostics_channel");
const {
  observeMcp,
  createTrialEvidence,
} = require("../../../../../scripts/hcp/mcp-observer.mjs");
const {
  serializeTool,
} = require("../../../dist/infrastructure/hcp-experiment/mcp-contract.js");
const { envelope } = require("./mcp-helpers.cjs");
const { PURPOSE } = require("../../../../../scripts/hcp/trial-protocol.mjs");
const issuer = "https://localhost:19321";
const ref = "r_synthetic_opaque_canary";
const entry = {
  ref,
  version: 1,
  content: {
    profile: "https://hcp.example/spec/profiles/general-context/2.0",
    value: "Synthetic C7b persona prefers a concise written summary.",
    language: "en",
  },
  assertion: {
    declarationType: "person-declared",
    permittedPurposes: [PURPOSE],
  },
  classification: {
    categories: ["general_preferences"],
    permittedPurposes: [PURPOSE],
  },
  standing: { assurance: "authenticated", confirmed: false },
  useUntil: "2026-11-25T20:30:08Z",
  evidence: [],
  relationships: [],
};
const common = {
  retrievalId: "urn:uuid:00000000-0000-4000-8000-000000000001",
  timestamp: "2026-11-25T19:30:08Z",
  directives: [],
};
const query = {
  ...common,
  entries: [entry],
  categoriesSearched: ["general_preferences"],
  minimization: { method: "lexical" },
};
const get = { ...common, entry, minimization: { method: "none" } };
const readArgs = {
  query: "concise written summary",
  categories: ["general_preferences"],
  purpose: PURPOSE,
  maxEntries: 1,
};
const scopeArgs = {
  query: "project codename",
  categories: ["work_context"],
  purpose: PURPOSE,
  maxEntries: 1,
};
const request = (name = "hcp_queryContext", args = readArgs) =>
  envelope("tools/call", { name, arguments: args });
const success = (name = "hcp_queryContext", value = query) =>
  serializeTool(1, name, value);

// Instrument the actual diagnostics entry point; verify the wrappers are transparent.
function exchange({
  body = request(),
  raw,
  result = success(),
  status = 200,
  chunks,
  incomplete = false,
  host,
  url,
  headers = {},
  encoding,
  emptyEnd = false,
  requestChunks,
} = {}) {
  const req = new EventEmitter();
  req.headers = {
    host: host ?? new URL(issuer).host,
    "mcp-protocol-version": "2026-07-28",
    authorization: "Bearer credential-canary",
    ...headers,
  };
  req.url = url ?? "/v2/mcp";
  req.complete = !incomplete;
  const res = new EventEmitter();
  res.statusCode = status;
  res.getHeader = () => "application/json";
  const delivered = [],
    calls = [];
  res.write = function (...args) {
    assert.equal(this, res);
    calls.push(args);
    delivered.push(
      Buffer.from(args[0], typeof args[1] === "string" ? args[1] : undefined),
    );
    args.find((a) => typeof a === "function")?.();
    return false;
  };
  res.end = function (...args) {
    assert.equal(this, res);
    calls.push(args);
    if (args[0] !== undefined && typeof args[0] !== "function")
      delivered.push(
        Buffer.from(args[0], typeof args[1] === "string" ? args[1] : undefined),
      );
    args.find((a) => typeof a === "function")?.();
    res.emit(
      incomplete === "error" ? "error" : incomplete ? "close" : "finish",
    );
    res.emit("close");
    return res;
  };
  channel("http.server.request.start").publish({ request: req, response: res });
  const bytes = Buffer.from(raw ?? JSON.stringify(body));
  if (requestChunks) for (const chunk of requestChunks) req.emit("data", chunk);
  else
    for (let i = 0; i < bytes.length; i += 13)
      req.emit("data", bytes.subarray(i, i + 13));
  req.emit("end");
  const parts = chunks ?? [Buffer.from(result)];
  let callbacks = 0;
  for (const part of emptyEnd ? parts : parts.slice(0, -1))
    assert.equal(
      res.write(part, ...(encoding ? [encoding] : []), () => callbacks++),
      false,
    );
  assert.equal(
    emptyEnd
      ? res.end(() => callbacks++)
      : res.end(
          parts.at(-1),
          ...(encoding ? [encoding] : []),
          () => callbacks++,
        ),
    res,
  );
  assert.equal(callbacks, parts.length + Number(emptyEnd));
  assert.deepEqual(
    Buffer.concat(delivered),
    Buffer.concat(parts.map((p) => Buffer.from(p, encoding))),
  );
  assert.equal(calls.length, parts.length + Number(emptyEnd));
}

test("observer proves query/get and exact ref correlation, then accepts scope and revocation denials", () => {
  let stopped = 0;
  const gate = createTrialEvidence(() => stopped++);
  const observer = observeMcp(issuer, gate.accept);
  try {
    exchange();
    exchange({
      body: request("hcp_getEntry", { ref, purpose: PURPOSE }),
      result: success("hcp_getEntry", get),
    });
    gate.assertStage();
    gate.advance();
    exchange({
      body: request("hcp_queryContext", scopeArgs),
      status: 403,
      result: '{"error":"insufficient_scope"}',
    });
    gate.assertStage();
    gate.advance();
    exchange({ status: 401, result: '{"error":"invalid_token"}' });
    gate.assertStage();
    assert.equal(gate.count, 4);
    assert.equal(stopped, 0);
    assert.deepEqual(
      observer.events.map((e) => e.outcome),
      ["success", "success", "scope-denied", "invalid-token"],
    );
    assert.equal(observer.events[1].requestRefMatches, true);
    assert.equal(observer.events[1].responseRefMatches, true);
    const retained = JSON.stringify(observer.events);
    for (const canary of [
      ref,
      entry.content.value,
      PURPOSE,
      "credential-canary",
      common.retrievalId,
    ])
      assert.equal(retained.includes(canary), false);
  } finally {
    observer.close();
  }
});

test("missing zero-call or one-call evidence latches once before stage failure escapes", () => {
  for (const calls of [0, 1]) {
    let stopped = 0;
    const gate = createTrialEvidence(() => stopped++);
    const observer = observeMcp(issuer, gate.accept);
    try {
      if (calls) exchange();
      assert.throws(() => gate.assertStage());
      assert.equal(stopped, 1);
      assert.equal(gate.failed, true);
      assert.throws(() => gate.advance());
      assert.throws(() => gate.assertStage());
      exchange();
      assert.equal(stopped, 1);
      assert.equal(gate.count, calls);
    } finally {
      observer.close();
    }
  }
});

test("HTTP 200 tool error with a mistyped ref stops once and cannot advance", () => {
  let stopped = 0;
  const gate = createTrialEvidence(() => stopped++);
  const observer = observeMcp(issuer, gate.accept);
  try {
    exchange();
    exchange({
      body: request("hcp_getEntry", { ref: ref + "J", purpose: PURPOSE }),
      result: serializeTool(
        1,
        "hcp_getEntry",
        {
          type: "scope-denied",
          detail: "Entry not available under this grant.",
        },
        true,
      ),
    });
    assert.equal(observer.events[1].outcome, "tool-error");
    assert.equal(observer.events[1].requestRefMatches, false);
    assert.equal(stopped, 1);
    assert.throws(() => gate.assertStage());
    assert.throws(() => gate.advance());
    exchange();
    assert.equal(stopped, 1);
  } finally {
    observer.close();
  }
});

test("observer refuses malformed, contradictory, oversized and incomplete evidence, including unknown methods", () => {
  const altered = (edit) => {
    const value = JSON.parse(success());
    edit(value);
    return JSON.stringify(value);
  };
  const cases = [
    {
      result: altered((v) => {
        v.id = 2;
      }),
    },
    {
      result: altered((v) => {
        delete v.result.isError;
      }),
    },
    {
      result: altered((v) => {
        v.result.resultType = "pending";
      }),
    },
    {
      result: altered((v) => {
        v.error = { code: 0 };
      }),
    },
    {
      result: altered((v) => {
        v.result.content[0].text = JSON.stringify({ ...query, entries: [] });
      }),
    },
    {
      result: altered((v) => {
        v.result.structuredContent = {};
        v.result.content[0].text = "{}";
      }),
    },
    {
      result: success().replace(
        '"jsonrpc":"2.0"',
        '"jsonrpc":"2.0","jsonrpc":"2.0"',
      ),
    },
    {
      result: altered((v) => {
        v.result.content[0].text = JSON.stringify(query).replace(
          '"entries":',
          '"entries":[],"entries":',
        );
      }),
    },
    { result: "{" },
    { result: Buffer.from([0xff]) },
    { result: " ".repeat(2 ** 20 + 1) },
    { raw: " ".repeat(32769) },
    { raw: '{"method":"tools/call","method":"tools/call"}' },
    { incomplete: true },
    { incomplete: "error" },
    { body: { jsonrpc: "2.0", id: 1, method: "private-method-canary" } },
    { status: 403, result: '{"error":"invalid_token"}' },
    { status: 401, result: '{"error":"invalid_token","extra":"canary"}' },
  ];
  for (const options of cases) {
    let stopped = 0;
    const gate = createTrialEvidence(() => stopped++);
    const observer = observeMcp(issuer, gate.accept);
    try {
      exchange(options);
      assert.equal(observer.events.length, 1);
      assert.equal(observer.events[0].outcome, "invalid");
      assert.equal(stopped, 1);
      assert.throws(() => gate.advance());
    } finally {
      observer.close();
    }
  }
});

test("a schema-valid success cannot mask wrong request/ref/content or an early denial stage", () => {
  const cases = [
    {
      body: request("hcp_getEntry", { ref: ref + "J", purpose: PURPOSE }),
      result: success("hcp_getEntry", get),
    },
    {
      body: request("hcp_getEntry", { ref, purpose: PURPOSE }),
      result: success("hcp_getEntry", {
        ...get,
        entry: { ...entry, ref: ref + "J" },
      }),
    },
    {
      body: request("hcp_getEntry", {
        ref,
        purpose: "https://example.test/wrong",
      }),
      result: success("hcp_getEntry", get),
    },
    { result: success("hcp_queryContext", { ...query, entries: [] }) },
    {
      result: success("hcp_queryContext", {
        ...query,
        entries: [
          {
            ...entry,
            content: { ...entry.content, value: "Different synthetic value" },
          },
        ],
      }),
    },
    {
      body: request("hcp_queryContext", scopeArgs),
      status: 403,
      result: '{"error":"insufficient_scope"}',
    },
  ];
  for (const options of cases) {
    let stopped = 0;
    const gate = createTrialEvidence(() => stopped++);
    const observer = observeMcp(issuer, gate.accept);
    try {
      exchange();
      exchange(options);
      assert.equal(stopped, 1);
      assert.throws(() => gate.advance());
    } finally {
      observer.close();
    }
  }
});

test("capture preserves split UTF-8 writes, string encodings, callbacks, backpressure and scope", () => {
  const observer = observeMcp(issuer);
  try {
    const text = serializeTool(
      1,
      "hcp_queryContext",
      { type: "scope-denied", detail: "Synthetic café" },
      true,
    );
    const bytes = Buffer.from(text),
      index = bytes.indexOf(Buffer.from("é")) + 1;
    exchange({
      result: text,
      chunks: [bytes.subarray(0, index), bytes.subarray(index)],
    });
    assert.equal(observer.events[0].outcome, "tool-error");
    exchange({ chunks: [success()] });
    assert.equal(observer.events[1].outcome, "success");
    exchange({
      chunks: [Buffer.from(success()).toString("base64")],
      encoding: "base64",
      emptyEnd: true,
    });
    assert.equal(observer.events[2].outcome, "success");
    const req = request();
    req.params._meta["io.modelcontextprotocol/clientInfo"] = {
      name: "Synthetic café",
      version: "1",
    };
    exchange({
      requestChunks: Array.from(Buffer.from(JSON.stringify(req)), (byte) =>
        Buffer.from([byte]),
      ),
    });
    assert.equal(observer.events[3].outcome, "success");
    exchange({ host: "localhost:19322" });
    exchange({ url: "/v2/other" });
    assert.equal(observer.events.length, 4);
  } finally {
    observer.close();
  }
});
