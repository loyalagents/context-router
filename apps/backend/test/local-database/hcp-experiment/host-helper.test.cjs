const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  callbackCode,
  validateGrant,
  guardModelRequest,
  ACCESS,
} = require("../../../../../scripts/hcp/trial-protocol.mjs");
const {
  startModelRelay,
} = require("../../../../../scripts/hcp/model-relay.mjs");
const {
  validateModelStream,
} = require("../../../../../scripts/hcp/trial-protocol.mjs");
const {
  boundedChildStop,
  runOwnedHost,
  setupListenerSnapshot,
  watchSetupListener,
} = require("../../../../../scripts/hcp/host-boundary.mjs");
const {
  bindTerminalStop,
  stopOnPromptFailure,
  startHumanAuthorization,
} = require("../../../../../scripts/hcp/claude-trial.mjs");
const eventStream = (events) =>
  events
    .map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
    .join("");
test("prompt failures close dispatch before escaping to host termination, without stopping a successful turn sequence", async () => {
  for (const fail of [true, false]) {
    let stops = 0;
    async function* prompts() {
      yield "first";
      if (fail) throw new Error("Synthetic incomplete or refused stage");
      yield "second";
      yield "third";
    }
    const iterator = stopOnPromptFailure(prompts(), () => stops++);
    assert.deepEqual(await iterator.next(), { value: "first", done: false });
    assert.equal(stops, 0);
    if (fail) {
      await assert.rejects(iterator.next());
      assert.equal(stops, 1);
      assert.equal((await iterator.next()).done, true);
    } else {
      assert.deepEqual(await iterator.next(), { value: "second", done: false });
      assert.deepEqual(await iterator.next(), { value: "third", done: false });
      assert.equal((await iterator.next()).done, true);
      assert.equal(stops, 0);
    }
  }
});
test("live CLI explains nonterminal stdin without exposing input or starting a host", () => {
  const { spawnSync } = require("node:child_process");
  const fs = require("node:fs"),
    os = require("node:os"),
    path = require("node:path");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hcp-terminal-refusal-"));
  const canary = "synthetic-private-input-canary";
  try {
    const result = spawnSync(
      process.execPath,
      [
        path.resolve(__dirname, "../../../../../scripts/hcp/claude-trial.mjs"),
        "--live",
        "--sandbox",
        "/synthetic",
        "--host",
        "/synthetic-host",
      ],
      {
        input: canary,
        encoding: "utf8",
        timeout: 5000,
        env: { PATH: "/usr/bin:/bin", TMPDIR: root },
      },
    );
    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /C7b input refused: standard input is not a terminal/,
    );
    assert.match(result.stderr, /FD3 process substitution/);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr.includes(canary), false);
    assert.deepEqual(fs.readdirSync(root), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
test("setup listener inspection refuses wildcard, nonloopback, IPv6, multiple, foreign and uncertain listeners", () => {
  const result = (stdout, status = 0) => ({ stdout, status, stderr: "" });
  assert.equal(setupListenerSnapshot(123, result("", 1)), false);
  assert.equal(
    setupListenerSnapshot(123, result("p123\nf9\nn127.0.0.1:54321\n")),
    true,
  );
  for (const snapshot of [
    result("p123\nf9\nn*:54321\n"),
    result("p123\nf9\nn192.0.2.1:54321\n"),
    result("p123\nf9\nn[::1]:54321\n"),
    result("p123\nf9\nn127.0.0.1:54321\nf10\nn127.0.0.1:54322\n"),
    result("p456\nf9\nn127.0.0.1:54321\n"),
    result("p123\n"),
    result("", 0),
    result("unknown output\n", 1),
    { ...result("", 1), stderr: "Permission denied" },
    { ...result("", 1), error: new Error("Inspection failed") },
    { ...result("", null), signal: "SIGTERM" },
  ])
    assert.throws(() => setupListenerSnapshot(123, snapshot));
});
test("setup monitoring stops on failed inspection or startup deadline and permits normal callback closure", async () => {
  const { EventEmitter } = require("node:events");
  for (const scenario of ["inspection", "deadline", "normal"]) {
    const child = new EventEmitter();
    child.pid = 123;
    let stops = 0,
      verified = 0,
      calls = 0;
    const monitor = watchSetupListener(child, {
      stop: () => stops++,
      onVerified: () => verified++,
      intervalMs: 5,
      startupMs: 20,
      inspect: () => {
        calls++;
        if (scenario === "inspection") throw new Error("Cannot inspect");
        return scenario === "normal" && calls === 1;
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 40));
    child.emit("close");
    const closedCalls = calls;
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(calls, closedCalls);
    if (scenario === "normal") {
      assert.equal(stops, 0);
      assert.equal(verified, 1);
      monitor.assertComplete();
    } else {
      assert.equal(stops, 1);
      assert.throws(() => monitor.assertComplete());
    }
  }
});
const completeEvents = [
  {
    type: "message_start",
    message: { model: "claude-sonnet-4-6", content: [] },
  },
  {
    type: "content_block_start",
    index: 0,
    content_block: { type: "text", text: "" },
  },
  {
    type: "content_block_delta",
    index: 0,
    delta: { type: "text_delta", text: "Synthetic" },
  },
  { type: "content_block_stop", index: 0 },
  { type: "message_delta", delta: { stop_reason: "end_turn" } },
  { type: "message_stop" },
];
test("relay requires real complete SSE events, rejects misleading comments, errors and truncation", () => {
  validateModelStream(eventStream(completeEvents), []);
  validateModelStream(
    eventStream([
      completeEvents[0],
      { type: "ping" },
      ...completeEvents.slice(1),
    ]),
    [],
  );
  for (const text of [
    ': keepalive {"type":"message_stop"}\n\n',
    eventStream(completeEvents).slice(0, -1),
    eventStream(completeEvents.slice(0, -1)),
    eventStream([
      completeEvents[0],
      { type: "error", error: { type: "overloaded_error" } },
      ...completeEvents.slice(1),
    ]),
    eventStream(
      completeEvents.filter((event) => event.type !== "content_block_stop"),
    ),
    eventStream([completeEvents[0], ...completeEvents]),
    eventStream([...completeEvents, { type: "content_block_start", index: 1 }]),
    eventStream([
      { ...completeEvents[0], message: { model: "other", content: [] } },
      ...completeEvents.slice(1),
    ]),
  ])
    assert.throws(() => validateModelStream(text, []));
});
test("terminal Ctrl-C and EOF abort OAuth/model waits even without a pending question", () => {
  const { PassThrough } = require("node:stream");
  const { createInterface } = require("node:readline");
  for (const phase of ["oauth", "model"]) {
    const input = new PassThrough(),
      output = new PassThrough();
    const terminal = createInterface({ input, output, terminal: true });
    const abort = new AbortController();
    bindTerminalStop(terminal, () => abort.abort());
    input.write("\u0003");
    assert.equal(abort.signal.aborted, true, phase);
    terminal.close();
  }
  const terminal = createInterface({
    input: new PassThrough(),
    output: new PassThrough(),
    terminal: true,
  });
  const abort = new AbortController();
  bindTerminalStop(terminal, () => abort.abort());
  terminal.close();
  assert.equal(abort.signal.aborted, true);
});
test("cancellation during browser startup closes acquired resources and never visits OAuth", async () => {
  const abort = new AbortController();
  let opened,
    release,
    visits = 0,
    closes = 0;
  const opening = new Promise((r) => {
      opened = r;
    }),
    gate = new Promise((r) => {
      release = r;
    });
  const closed = async () => {
    closes++;
  };
  const pending = startHumanAuthorization({
    source: {},
    sandbox: "/synthetic",
    abort,
    serve: async () => ({ close: closed }),
    authorize: async () => ({
      close: closed,
      url: "https://invalid.test",
      wait: new Promise(() => {}),
    }),
    browse: async () => {
      opened();
      await gate;
      return {
        close: closed,
        context: new (require("node:events").EventEmitter)(),
        page: {
          goto: async () => {
            visits++;
          },
        },
      };
    },
  });
  await opening;
  abort.abort();
  release();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(visits, 0);
  assert.ok(closes >= 3);
  await assert.rejects(runOwnedHost({}, { signal: abort.signal }), {
    name: "AbortError",
  });
});
test(
  "a child ignoring SIGTERM is killed and reaped within the stop deadline",
  { timeout: 15000 },
  async () => {
    const { spawn } = require("node:child_process");
    const { once } = require("node:events");
    const child = spawn(
      process.execPath,
      [
        "-e",
        'process.on("SIGTERM",()=>{});setInterval(()=>{},1000);console.log("ready")',
      ],
      { stdio: ["ignore", "pipe", "ignore"], detached: true },
    );
    const lifecycle = boundedChildStop(child, {
      timeoutMs: 60000,
      group: true,
    });
    await once(child.stdout, "data");
    const start = performance.now();
    lifecycle.stop();
    assert.deepEqual(await lifecycle.closed, [null, "SIGKILL"]);
    assert.ok(performance.now() - start < 12000);
    assert.throws(() => process.kill(child.pid, 0), { code: "ESRCH" });
  },
);
const issuer = "https://localhost:19443",
  callback = "https://127.0.0.1:19444/callback",
  state = "synthetic-state";
const headers = {
  host: "127.0.0.1:19444",
  origin: issuer,
  "content-type": "application/x-www-form-urlencoded",
};
const form = { code: "synthetic-code", state, iss: issuer };
const body = new URLSearchParams(form).toString();
const valid = {
  method: "POST",
  url: "/callback",
  headers,
  body,
  issuer,
  callback,
  state,
};
test("callback checks exact form POST, host, origin, state, issuer and duplicate fields", () => {
  assert.equal(callbackCode(valid), form.code);
  for (const patch of [
    { method: "GET" },
    { url: "/callback?x=1" },
    { body: body + "&state=" + state },
    { body: new URLSearchParams({ ...form, state: "wrong" }).toString() },
    {
      body: new URLSearchParams({
        ...form,
        iss: "https://evil.test",
      }).toString(),
    },
    { body: body + "&access_token=secret" },
    { body: "x".repeat(9000) },
    { body: body + "%ZZ" },
    ...["host", "origin", "content-type"].map((k) => ({
      headers: { ...headers, [k]: "wrong" },
    })),
    { headers: { ...headers, cookie: "provider-session" } },
  ])
    assert.throws(() => callbackCode({ ...valid, ...patch }));
});
test("launch inspects actual token and own-grant, refuses wider or persistent human selection", () => {
  const now = Date.now(),
    token = {
      access_token: "temporary-token",
      token_type: "Bearer",
      expires_in: 899,
      scope: "hcp:general_preferences:read",
    };
  const grant = {
    grantId: "urn:uuid:fixture",
    status: "active",
    client: { id: "claude-code-c7b" },
    grantType: "temporary",
    issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 899000).toISOString(),
    scopes: ["hcp:general_preferences:read"],
    access: [ACCESS],
  };
  const own = { grants: [grant], directives: [] };
  assert.equal(validateGrant(token, own, now), grant.grantId);
  for (const patch of [
    { refresh_token: "forbidden" },
    { expires_in: 901 },
    { token_type: "Other" },
    { scope: "hcp:work_context:read" },
  ])
    assert.throws(() => validateGrant({ ...token, ...patch }, own, now));
  for (const patch of [
    { grantType: "persistent", expiresAt: null },
    { status: "revoked" },
    { expiresAt: new Date(now + 3600000).toISOString() },
    { access: [{ ...ACCESS, actions: ["read", "write"] }] },
    { access: [{ ...ACCESS, categories: ["work_context"] }] },
  ])
    assert.throws(() =>
      validateGrant(token, { ...own, grants: [{ ...grant, ...patch }] }, now),
    );
});
test("model guard scans decoded complete payload and all non-auth headers before forwarding", () => {
  const local = "synthetic-relay-token",
    secret = "secret-do-not-send";
  const modelBody = JSON.stringify({
    model: "claude-sonnet-4-6",
    messages: [{ role: "user", content: "Synthetic prompt" }],
    tools: [],
    stream: true,
  });
  const request = {
    method: "POST",
    url: "/v1/messages?beta=true",
    headers: {
      authorization: "Bearer " + local,
      "content-type": "application/json",
    },
    body: modelBody,
  };
  assert.equal(
    guardModelRequest(request, local, [local, secret]).model,
    "claude-sonnet-4-6",
  );
  for (const patch of [
    { method: "GET" },
    { url: "/v1/messages/other" },
    { url: "/v1/messages?redirect=https://evil.test" },
    { headers: { ...request.headers, "x-api-key": "anything" } },
    { headers: { ...request.headers, "content-encoding": "gzip" } },
    { headers: { ...request.headers, "x-unexpected": secret } },
    {
      body: modelBody.replace(
        "Synthetic prompt",
        secret.replace("s", "\\u0073"),
      ),
    },
    { body: modelBody.replace('"tools":[]', '"tools":[{"name":"Bash"}]') },
    { body: modelBody.replace("claude-sonnet-4-6", "other-model") },
  ])
    assert.throws(() =>
      guardModelRequest({ ...request, ...patch }, local, [local, secret]),
    );
});

test("relay validates whole request before dispatch and latches ambiguous or rejected dispatch once", async (t) => {
  const http = require("node:http");
  const { certificates } = require("./authorization-fixture.cjs");
  const fs = require("node:fs"),
    path = require("node:path"),
    os = require("node:os"),
    https = require("node:https");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "c7b-relay-"));
  const tls = certificates(root);
  let sends = 0,
    mode = "ok",
    holding;
  const server = https.createServer(tls, async (req, res) => {
    sends++;
    assert.equal(
      req.headers.authorization,
      "Bearer real-synthetic-subscription",
    );
    assert.equal(req.headers["x-api-key"], undefined);
    for await (const chunk of req) void chunk;
    if (mode === "hold") {
      holding();
      return;
    }
    if (mode === "drop") {
      req.socket.destroy();
      return;
    }
    if (mode === "reject") {
      res.writeHead(401).end("{}");
      return;
    }
    res.writeHead(200, { "content-type": "text/event-stream" });
    if (mode === "partial") {
      res.write("event: message_start\ndata: {}\n\n");
      setTimeout(() => res.destroy(), 10);
      return;
    }
    if (mode === "misleading") {
      res.end(': keepalive {"type":"message_stop"}\n\n');
      return;
    }
    if (mode === "sse-error") {
      res.end(
        eventStream([
          completeEvents[0],
          { type: "error", error: { type: "overloaded_error" } },
          ...completeEvents.slice(1),
        ]),
      );
      return;
    }
    res.end(eventStream(completeEvents));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    fs.rmSync(root, { recursive: true });
  });
  const body = JSON.stringify({
    model: "claude-sonnet-4-6",
    messages: [],
    tools: [],
    stream: true,
  });
  const send = (relay, raw = body) =>
    new Promise((resolve, reject) => {
      const req = http.request(
        relay.origin + "/v1/messages",
        {
          method: "POST",
          headers: {
            authorization: "Bearer local-synthetic",
            "content-type": "application/json",
          },
        },
        (res) => {
          res.resume();
          res.on("end", () => resolve(res.statusCode));
        },
      );
      req.on("error", reject);
      req.end(raw);
    });
  const open = (onStop = () => {}) =>
    startModelRelay({
      subscription: "real-synthetic-subscription",
      localToken: "local-synthetic",
      secrets: ["private-hcp"],
      onStop,
      upstream: {
        origin: `https://as.hcp.test:${server.address().port}`,
        ca: tls.ca,
        lookup: (_h, opts, cb) =>
          opts.all
            ? cb(null, [{ address: "127.0.0.1", family: 4 }])
            : cb(null, "127.0.0.1", 4),
      },
    });
  let relay = await open();
  assert.equal(await send(relay), 200);
  assert.equal(sends, 1);
  relay.cancel();
  relay.cancel();
  assert.equal(relay.receipt.latched, true);
  assert.equal(await send(relay), 502);
  assert.equal(sends, 1);
  await relay.close();
  mode = "hold";
  const reached = new Promise((resolve) => {
    holding = resolve;
  });
  let stops = 0;
  relay = await open(() => {
    assert.equal(relay.receipt.latched, true);
    stops++;
  });
  const inFlight = send(relay);
  await reached;
  relay.cancel();
  assert.equal(await inFlight, 502);
  assert.equal(await send(relay), 502);
  assert.equal(sends, 2);
  assert.equal(stops, 1);
  await relay.close();
  mode = "ok";
  relay = await open();
  assert.equal(
    await send(
      relay,
      body.replace('"messages":[]', '"messages":["private-hcp"]'),
    ),
    502,
  );
  assert.equal(sends, 2);
  assert.equal(await send(relay), 502);
  assert.equal(sends, 2);
  await relay.close();
  for (mode of ["drop", "reject", "partial", "misleading", "sse-error"]) {
    relay = await open();
    const before = sends;
    assert.equal(await send(relay), 502);
    assert.equal(await send(relay), 502);
    assert.equal(sends, before + 1);
    assert.equal(relay.receipt.latched, true);
    await relay.close();
  }
});
