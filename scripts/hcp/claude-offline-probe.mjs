// Explicit target-Mac host probe. Local fake Anthropic only; no login or live model.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { createRequire } from "node:module";
import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  verifyHost,
  hostInvocation,
  runOwnedHost,
  TOOLS,
} from "./host-boundary.mjs";
import { startModelRelay } from "./model-relay.mjs";
import { validateGrant } from "./trial-protocol.mjs";
import { observeMcp, createTrialEvidence } from "./mcp-observer.mjs";
import { stopOnPromptFailure } from "./claude-trial.mjs";
import assert from "node:assert/strict";
const binary = process.argv[2];
verifyHost(binary);
const scenario = process.argv[3] ?? "positive";
assert.ok(
  [
    "positive",
    "mistyped-ref",
    "missing-get",
    "untrusted",
    "hostname",
    "expired",
    "missing-auth",
    "invalid-auth",
    "drop",
    "partial",
    "misleading",
    "sse-error",
  ].includes(scenario),
);
process.umask(0o077);
const root = fs.realpathSync(
  fs.mkdtempSync(path.join(os.tmpdir(), "hcp-c7b-host-probe-")),
);
for (const dir of ["profile", "cwd", "tmp"]) fs.mkdirSync(path.join(root, dir));
const secrets = {
  hcp: randomBytes(32).toString("base64url"),
  anthropic: "sk-ant-oat01-" + randomBytes(32).toString("base64url"),
};
const require = createRequire(import.meta.url);
const {
  initializeSource,
  readSource,
  serveSource,
} = require("../../apps/backend/dist/infrastructure/hcp-experiment/source.js");
const {
  request,
  OAuthDriver,
  inputs,
} = require("../../apps/backend/test/local-database/hcp-experiment/authorization-fixture.cjs");
const freePort = async () => {
  const s = net.createServer();
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  const p = s.address().port;
  await new Promise((r) => s.close(r));
  return p;
};
const providerRoot = path.join(root, "provider");
fs.mkdirSync(providerRoot);
const providerPort = await freePort(),
  callbackPort = await freePort();
await initializeSource(
  providerRoot,
  providerPort,
  async (r) => `approve ${r.digest}`,
  { profile: "claude-code", callbackPort },
);
const source = readSource(providerRoot),
  provider = await serveSource(providerRoot);
const semanticScenario = ["positive", "mistyped-ref", "missing-get"].includes(
  scenario,
);
const abort = new AbortController();
let relay;
const stop = () => {
  relay?.cancel();
  abort.abort();
};
const evidence = createTrialEvidence(stop);
const observer = observeMcp(
    provider.issuer,
    semanticScenario ? evidence.accept : undefined,
  ),
  wire = observer.events;
const f = {
  issuer: provider.issuer,
  human: source.humanCredential,
  redirects: {
    "claude-code-c7b": source.descriptor.configuration.clients[0].redirectUri,
  },
  request: (route, opts) =>
    request(new URL(route, provider.issuer), source.tls, opts),
};
const management = (route, opts = {}) =>
  f.request(route, {
    ...opts,
    headers: { authorization: `Bearer ${f.human}` },
  });
const driver = new OAuthDriver(f, "claude-code-c7b");
await driver.begin();
await driver.login();
await driver.review({ durationSeconds: "900" });
const authorization = inputs((await driver.approve()).text);
assert.equal(authorization.state, driver.state);
assert.equal(authorization.iss, provider.issuer);
driver.code = authorization.code;
const tokens = await driver.exchange();
assert.equal(tokens.status, 200);
secrets.hcp = tokens.json.access_token;
secrets.human = source.humanCredential;
secrets.verifier = driver.verifier;
secrets.code = driver.code;
const grant = (await management("/v2/grants")).json.grants[0];
validateGrant(
  tokens.json,
  (
    await f.request("/v2/grants", {
      headers: { authorization: "Bearer " + secrets.hcp },
    })
  ).json,
);
secrets.relay = "sk-ant-oat01-" + randomBytes(32).toString("base64url");
const requests = [],
  headers = [];
const sockets = new Set();
let failure,
  negativeServer,
  negativeRequests = 0;
let issuer = provider.issuer;
if (["hostname", "expired"].includes(scenario)) {
  const dir = path.join(root, "negative-tls");
  fs.mkdirSync(dir);
  const openssl = (args) =>
    execFileSync("/usr/bin/openssl", args, { cwd: dir, stdio: "ignore" });
  openssl([
    "req",
    "-new",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-subj",
    "/CN=C7b negative fixture",
    "-keyout",
    "leaf.key",
    "-out",
    "leaf.csr",
  ]);
  fs.writeFileSync(
    path.join(dir, "extensions"),
    "basicConstraints=critical,CA:FALSE\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:" +
      (scenario === "hostname" ? "wrong.test" : "localhost") +
      "\n",
  );
  if (scenario === "expired") {
    fs.writeFileSync(path.join(dir, "index"), "");
    fs.writeFileSync(path.join(dir, "serial"), "0314");
    fs.writeFileSync(
      path.join(dir, "openssl.cnf"),
      `[ca]\ndefault_ca=c\n[c]\ndatabase=index\nnew_certs_dir=.\nserial=serial\ndefault_md=sha256\npolicy=p\ncertificate=${providerRoot}/tls/ca.pem\nprivate_key=${providerRoot}/tls/ca.key\n[p]\ncommonName=supplied\n`,
    );
    openssl([
      "ca",
      "-batch",
      "-config",
      "openssl.cnf",
      "-in",
      "leaf.csr",
      "-out",
      "leaf.pem",
      "-startdate",
      "200101000000Z",
      "-enddate",
      "200102000000Z",
      "-extfile",
      "extensions",
    ]);
  } else
    openssl([
      "x509",
      "-req",
      "-in",
      "leaf.csr",
      "-CA",
      path.join(providerRoot, "tls/ca.pem"),
      "-CAkey",
      path.join(providerRoot, "tls/ca.key"),
      "-set_serial",
      "314",
      "-days",
      "1",
      "-extfile",
      "extensions",
      "-out",
      "leaf.pem",
    ]);
  negativeServer = https.createServer(
    {
      key: fs.readFileSync(path.join(dir, "leaf.key")),
      cert: fs.readFileSync(path.join(dir, "leaf.pem")),
    },
    (_req, res) => {
      negativeRequests++;
      res.writeHead(500).end();
    },
  );
  await new Promise((r) => negativeServer.listen(0, "127.0.0.1", r));
  issuer = `https://localhost:${negativeServer.address().port}`;
}
const server = https.createServer(source.tls, async (req, res) => {
  try {
    let body = "";
    for await (const b of req) body += b;
    assert.ok(body.length <= 2 ** 20, "model request too large");
    for (const value of Object.values(secrets))
      assert.ok(!body.includes(value), "credential in model body");
    const receivedHeaders = { ...req.headers };
    assert.equal(receivedHeaders.authorization, "Bearer " + secrets.anthropic);
    for (const name of ["x-api-key", "proxy-authorization", "cookie"])
      assert.equal(receivedHeaders[name], undefined);
    delete receivedHeaders.authorization;
    for (const value of Object.values(secrets))
      assert.ok(
        !JSON.stringify(receivedHeaders).includes(value),
        "credential in other model headers",
      );
    headers.push(receivedHeaders);
    assert.equal(req.method, "POST");
    assert.ok(
      ["/v1/messages", "/v1/messages?beta=true"].includes(req.url),
      "unexpected endpoint",
    );
    const message = JSON.parse(body);
    requests.push(message);
    if (scenario === "misleading" || scenario === "sse-error") {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end(
        scenario === "misleading"
          ? ': keepalive {"type":"message_stop"}\n\n'
          : 'event: error\ndata: {"type":"error","error":{"type":"overloaded_error"}}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n',
      );
      return;
    }
    if (scenario === "drop") {
      req.socket.destroy();
      return;
    }
    if (scenario === "partial") {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write("event: message_start\ndata: {}\n\n");
      setTimeout(() => res.destroy(), 20);
      return;
    }
    if (scenario === "invalid-auth") {
      res.writeHead(401, { "content-type": "application/json" }).end(
        JSON.stringify({
          type: "error",
          error: {
            type: "authentication_error",
            message: "Synthetic token rejected",
          },
        }),
      );
      return;
    }
    const index = requests.length - 1;
    let content =
      index === 0
        ? {
            type: "tool_use",
            id: "toolu_absent_bash",
            name: "Bash",
            input: { command: "env" },
          }
        : index === 1
          ? {
              type: "tool_use",
              id: "toolu_absent_read",
              name: "Read",
              input: {
                file_path: path.join(root, "profile/.credentials.json"),
              },
            }
          : { type: "text", text: "Offline probe finished." };
    const purpose = "https://example.test/purpose/synthetic-review";
    const use = (name, input) => ({
      type: "tool_use",
      id: "toolu_hcp_" + index,
      name: "mcp__c7b__" + name,
      input,
    });
    if (index === 2)
      content = use("hcp_queryContext", {
        query: "concise written summary",
        categories: ["general_preferences"],
        purpose,
        maxEntries: 1,
      });
    if (index === 3 && scenario !== "missing-get") {
      const refs = JSON.stringify(message.messages).match(
        /(?:\\)?"ref(?:\\)?"\s*:\s*(?:\\)?"([^"\\]+)/g,
      );
      const ref = refs
        ?.at(-1)
        ?.split(":")
        .slice(1)
        .join(":")
        .replace(/["\\\s]/g, "");
      assert.ok(ref, "real query result ref required");
      content = use("hcp_getEntry", {
        ref: scenario === "mistyped-ref" ? ref + "J" : ref,
        purpose,
      });
    }
    if (index === 5)
      content = use("hcp_queryContext", {
        query: "project codename",
        categories: ["work_context"],
        purpose,
        maxEntries: 1,
      });
    if (index === 7) {
      content = use("hcp_queryContext", {
        query: "concise written summary",
        categories: ["general_preferences"],
        purpose,
        maxEntries: 1,
      });
    }
    if (!semanticScenario)
      content = { type: "text", text: "Offline negative probe finished." };
    const events = [
      [
        "message_start",
        {
          type: "message_start",
          message: {
            id: "msg_probe_" + index,
            type: "message",
            role: "assistant",
            model: "claude-sonnet-4-6",
            content: [],
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: 10, output_tokens: 0 },
          },
        },
      ],
      [
        "content_block_start",
        {
          type: "content_block_start",
          index: 0,
          content_block:
            content.type === "tool_use"
              ? { ...content, input: {} }
              : { type: "text", text: "" },
        },
      ],
      [
        "content_block_delta",
        {
          type: "content_block_delta",
          index: 0,
          delta:
            content.type === "tool_use"
              ? {
                  type: "input_json_delta",
                  partial_json: JSON.stringify(content.input),
                }
              : { type: "text_delta", text: content.text },
        },
      ],
      ["content_block_stop", { type: "content_block_stop", index: 0 }],
      [
        "message_delta",
        {
          type: "message_delta",
          delta: {
            stop_reason: content.type === "tool_use" ? "tool_use" : "end_turn",
            stop_sequence: null,
          },
          usage: { output_tokens: 20 },
        },
      ],
      ["message_stop", { type: "message_stop" }],
    ];
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "request-id": "offline-probe",
    });
    for (const [event, data] of events)
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    res.end();
  } catch {
    failure = "Fake model request guard failed";
    res.writeHead(500).end("{}");
    abort.abort();
  }
});
server.on("connection", (socket) => {
  sockets.add(socket);
  socket.once("close", () => sockets.delete(socket));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;
relay = await startModelRelay({
  subscription: secrets.anthropic,
  localToken: secrets.relay,
  secrets: [secrets.hcp, secrets.human, secrets.verifier, secrets.code],
  onStop: () => abort.abort(),
  upstream: {
    origin: `https://localhost:${port}`,
    ca: source.tls.ca,
    lookup: (_h, opts, cb) =>
      opts.all
        ? cb(null, [{ address: "127.0.0.1", family: 4 }])
        : cb(null, "127.0.0.1", 4),
  },
});
let host;
const results = [];
let waiting;
const nextResult = () =>
  results.length
    ? Promise.resolve(results.shift())
    : new Promise((r) => {
        waiting = r;
      });
const onResult = (event) => {
  if (waiting) {
    const resolve = waiting;
    waiting = undefined;
    resolve(event);
  } else results.push(event);
};
async function* prompts() {
  yield "Offline synthetic read and get probe.";
  assert.equal((await nextResult()).is_error, false);
  evidence.advance();
  yield "Offline synthetic scope denial probe.";
  assert.equal((await nextResult()).is_error, false);
  assert.equal(
    (await management("/v2/grants/" + grant.grantId, { method: "DELETE" }))
      .status,
    204,
  );
  evidence.advance();
  yield "Offline synthetic revoked read probe.";
}
try {
  host = await runOwnedHost(
    hostInvocation({
      binary,
      root,
      providerRoot,
      issuer,
      modelPort: Number(new URL(relay.origin).port),
      subscription: scenario === "missing-auth" ? undefined : secrets.relay,
      hcpToken: secrets.hcp,
      trust: scenario !== "untrusted",
      streaming: semanticScenario,
    }),
    {
      signal: abort.signal,
      ...(semanticScenario
        ? { prompts: stopOnPromptFailure(prompts(), stop), onResult }
        : {}),
    },
  );
} finally {
  await relay.close();
  for (const socket of sockets) socket.destroy();
  await new Promise((r) => server.close(r));
  if (negativeServer) {
    negativeServer.closeAllConnections();
    await new Promise((r) => negativeServer.close(r));
  }
  await provider.close();
  observer.close();
}
const { exit: result, output, errors } = host;
assert.equal(failure, undefined);
const serialized = JSON.stringify(requests) + output + errors;
for (const value of Object.values(secrets))
  assert.ok(!serialized.includes(value), "credential in model/output");
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, e.name);
    if (e.isDirectory()) walk(file);
    else if (e.isFile())
      for (const value of Object.values(secrets))
        assert.ok(
          !fs.readFileSync(file).includes(value),
          "credential in retained file",
        );
  }
};
for (const dir of ["profile", "cwd", "tmp"]) walk(path.join(root, dir));
const receipt = {
  root,
  scenario,
  headers,
  negativeRequests,
  relay: relay.receipt,
  exit: result,
  requestCount: requests.length,
  toolInventories: requests.map((r) => (r.tools ?? []).map((t) => t.name)),
  wire,
  output,
  errors,
  messages: requests.map((r) => r.messages),
};
fs.writeFileSync(
  path.join(root, "receipt.json"),
  JSON.stringify(receipt, null, 2),
);
console.log(
  JSON.stringify(
    {
      root,
      scenario,
      negativeRequests,
      exit: result,
      requestCount: requests.length,
      tools: receipt.toolInventories,
      wire,
      outputTail: output.slice(-150),
      errorTail: errors.slice(-800),
    },
    null,
    2,
  ),
);
if (scenario === "positive") {
  evidence.assertStage();
  assert.equal(relay.receipt.latched, false);
  assert.equal(result[0], 0);
  assert.equal(requests.length, 9);
  for (const r of requests)
    assert.deepEqual(
      (r.tools ?? []).map((t) => t.name).sort(),
      [...TOOLS].sort(),
    );
  for (const r of requests.slice(1, 3))
    assert.ok(JSON.stringify(r.messages).includes("No such tool available"));
  assert.deepEqual(
    wire.filter((r) => r.method === "tools/call").map((r) => r.status),
    [200, 200, 403, 401],
  );
  assert.ok(wire.every((r) => r.version === "2026-07-28"));
  assert.deepEqual(
    wire.filter((r) => r.method === "tools/call").map((r) => r.outcome),
    ["success", "success", "scope-denied", "invalid-token"],
  );
} else if (["mistyped-ref", "missing-get"].includes(scenario)) {
  assert.notEqual(result[0], 0);
  assert.equal(evidence.failed, true);
  assert.throws(() => evidence.advance());
  assert.equal(relay.receipt.latched, true);
  assert.equal(requests.length, 4); // No next summary/repair request after the failed get.
  assert.equal(relay.receipt.upstreamSends, 4);
  const calls = wire.filter((r) => r.method === "tools/call");
  assert.deepEqual(
    calls.map((r) => r.outcome),
    scenario === "mistyped-ref" ? ["success", "tool-error"] : ["success"],
  );
  if (scenario === "mistyped-ref") {
    assert.equal(calls[1].status, 200);
    assert.equal(calls[1].requestRefMatches, false);
  }
} else if (
  [
    "missing-auth",
    "invalid-auth",
    "drop",
    "partial",
    "misleading",
    "sse-error",
  ].includes(scenario)
) {
  assert.notEqual(result[0], 0);
  assert.equal(requests.length, scenario === "missing-auth" ? 0 : 1);
  assert.equal(wire.filter((r) => r.method === "tools/call").length, 0);
} else {
  assert.equal(result[0], 0);
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0].tools ?? [], []);
  assert.equal(negativeRequests, 0);
  assert.equal(wire.length, 0);
}
