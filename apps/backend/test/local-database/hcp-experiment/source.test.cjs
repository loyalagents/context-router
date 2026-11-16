const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const { DatabaseSync } = require("node:sqlite");
const { request } = require("./authorization-fixture.cjs");
const cli = path.resolve(__dirname, "../../../dist/hcp-source.js");
const {
  initializeSource,
  readSource,
  serveSource,
} = require("../../../dist/infrastructure/hcp-experiment/source.js");

function sandbox(t) {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "hcp-c6-source-")),
  );
  fs.chmodSync(root, 0o700);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
async function port() {
  const server = net.createServer();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const value = server.address().port;
  await new Promise((r) => server.close(r));
  return value;
}
const approve = async (review) => `approve ${review.digest}`;
test("CLI argument errors show static usage without claiming sandbox damage or echoing values", async (t) => {
  const root = sandbox(t);
  for (const args of [
    [],
    ["typo-private-value"],
    ["serve"],
    ["serve", "--sandbox", root, "--port", "9443"],
    ["open", "--sandbox", root, "--headless", "false"],
    ["initialize", "--sandbox", root],
    ["initialize", "--sandbox", root, "--port", "not-a-port-private-value"],
    ["initialize", "--sandbox", root, "--port", "0"],
    ["serve", "--sandbox"],
    ["serve", "--sandbox", root, "--sandbox", root],
  ]) {
    const child = spawn(process.execPath, [cli, ...args], {
      env: { PATH: process.env.PATH },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "",
      stdout = "";
    child.stderr.on("data", (b) => {
      stderr += b;
    });
    child.stdout.on("data", (b) => {
      stdout += b;
    });
    assert.deepEqual(await once(child, "close"), [1, null]);
    assert.match(stderr, /^Usage: hcp-source /);
    assert.doesNotMatch(stderr, /Preserve|private-value|\n\s+at /);
    assert.ok(!stderr.includes(root));
    assert.equal(stdout, "");
    assert.deepEqual(fs.readdirSync(root), []);
  }
});

test("actual serve CLI sanitizes shutdown errors and releases its owned store", async (t) => {
  const root = sandbox(t),
    selected = await port();
  await initializeSource(root, selected, approve);
  const child = spawn(
    process.execPath,
    [
      "--require",
      path.join(__dirname, "source-observer.cjs"),
      cli,
      "serve",
      "--sandbox",
      root,
    ],
    {
      env: { PATH: process.env.PATH, HCP_SOURCE_SERVE_TEST: "close-error" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let stderr = "";
  child.stderr.on("data", (b) => {
    stderr += b;
  });
  const exited = once(child, "close");
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await exited;
    }
  });
  await new Promise((resolve, reject) => {
    child.stdout.on("data", (b) => {
      if (String(b).includes("Serving")) resolve();
    });
    child.once("exit", () => reject(new Error("source serve failed")));
  });
  child.kill("SIGTERM");
  assert.deepEqual(await exited, [1, null]);
  assert.match(stderr, /^HCP source command refused\./);
  assert.doesNotMatch(
    stderr,
    /private-test-shutdown-detail|\n\s+at |UnhandledPromise/i,
  );
  const reopened = await serveSource(root);
  await reopened.close();
});
test("source bootstrap approval keeps its original deadline and never publishes readiness after expiry", async (t) => {
  const root = sandbox(t),
    selected = await port(),
    realNow = Date.now;
  let now = realNow();
  Date.now = () => now;
  try {
    await assert.rejects(
      initializeSource(root, selected, async (review) => {
        now += 300_001;
        return approve(review);
      }),
    );
  } finally {
    Date.now = realNow;
  }
  assert.equal(fs.existsSync(path.join(root, "launcher/ready.json")), false);
  assert.equal(rows(root, "entries").length, 0);
  await assert.rejects(serveSource(root));
});
function rows(root, table) {
  const db = new DatabaseSync(path.join(root, "data/entries.sqlite"), {
    readOnly: true,
  });
  try {
    return db.prepare(`SELECT * FROM ${table}`).all();
  } finally {
    db.close();
  }
}
test("source initialization reviews the exact fixture bundle without listening; reopen preserves identities and closed bootstrap", async (t) => {
  const root = sandbox(t),
    selected = await port();
  await initializeSource(root, selected, async (review) => {
    assert.match(review.notice, /synthetic persona/);
    assert.ok(
      review.fixtures.some(
        (f) => typeof f.versions.at(-1).content.value === "string",
      ),
    );
    assert.equal(fs.existsSync(path.join(root, "launcher/ready.json")), false);
    const probe = net.createServer();
    await new Promise((r, reject) => {
      probe.once("error", reject);
      probe.listen(selected, "127.0.0.1", r);
    });
    await new Promise((r) => probe.close(r));
    return approve(review);
  });
  const before = readSource(root),
    entries = rows(root, "entries"),
    history = rows(root, "audit_events");
  assert.deepEqual(
    new Set(entries.map((e) => e.status)),
    new Set([
      "active",
      "conflicted",
      "deprecated",
      "expired",
      "deleted",
      "suspended",
      "revoked",
    ]),
  );
  assert.equal(
    before.descriptor.configuration.issuer,
    `https://as.hcp.test:${selected}`,
  );
  for (let i = 0; i < 2; i++) {
    const server = await serveSource(root);
    assert.equal(server.issuer, before.descriptor.configuration.issuer);
    await assert.rejects(serveSource(root));
    const response = await request(
      server.issuer + "/manage/entries",
      before.tls,
    );
    assert.equal(response.status, 200);
    assert.match(response.text, /Sign in/);
    await server.close();
    assert.deepEqual(rows(root, "entries"), entries);
    assert.deepEqual(rows(root, "audit_events"), history);
  }
  assert.equal(readSource(root).humanCredential, before.humanCredential);
  assert.equal(rows(root, "fixture_bootstrap")[0].state, "closed");
  await assert.rejects(initializeSource(root, selected, approve));
});
test("cancellation and changed private material refuse without publishing or repairing", async (t) => {
  const root = sandbox(t),
    selected = await port();
  await assert.rejects(initializeSource(root, selected, async () => "cancel"));
  assert.equal(fs.existsSync(path.join(root, "launcher/ready.json")), false);
  await assert.rejects(serveSource(root));
  await assert.rejects(initializeSource(root, selected, approve));
  const other = sandbox(t);
  await initializeSource(other, selected, approve);
  const credential = path.join(other, "launcher/human.credential");
  fs.writeFileSync(credential, "changed", { mode: 0o600 });
  await assert.rejects(serveSource(other));
  assert.equal(fs.readFileSync(credential, "utf8"), "changed");
});
test("source admission refuses symlinks, broad modes, arbitrary roots, missing descriptor and busy fixed origin", async (t) => {
  const root = sandbox(t),
    selected = await port();
  await assert.rejects(initializeSource("relative", selected, approve));
  fs.chmodSync(root, 0o755);
  await assert.rejects(initializeSource(root, selected, approve));
  fs.chmodSync(root, 0o700);
  await initializeSource(root, selected, approve);
  const busy = net.createServer();
  await new Promise((r) => busy.listen(selected, "127.0.0.1", r));
  try {
    await assert.rejects(serveSource(root));
  } finally {
    await new Promise((r) => busy.close(r));
  }
  const ready = path.join(root, "launcher/ready.json"),
    original = fs.readFileSync(ready);
  fs.unlinkSync(ready);
  await assert.rejects(serveSource(root));
  fs.writeFileSync(ready, original, { mode: 0o600 });
  const target = path.join(root, "launcher/copy");
  fs.renameSync(ready, target);
  fs.symlinkSync(target, ready);
  await assert.rejects(serveSource(root));
});
test("actual CLI requires exact approval and explicit arguments, never prints a credential, and serves/reaps the same store", async (t) => {
  const root = sandbox(t),
    selected = await port();
  const child = spawn(
    process.execPath,
    [cli, "initialize", "--sandbox", root, "--port", String(selected)],
    { env: { PATH: process.env.PATH }, stdio: ["pipe", "pipe", "pipe"] },
  );
  let output = "",
    sent = false;
  child.stderr.resume();
  child.stdout.on("data", (b) => {
    output += b;
    const match = /Type approve ([0-9a-f]{64})/.exec(output);
    if (match && !sent) {
      sent = true;
      child.stdin.end(`approve ${match[1]}\n`);
    }
  });
  assert.deepEqual(await once(child, "exit"), [0, null]);
  const source = readSource(root);
  assert.ok(sent);
  assert.ok(!output.includes(source.humanCredential));
  const running = spawn(process.execPath, [cli, "serve", "--sandbox", root], {
    env: { PATH: process.env.PATH },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const exited = once(running, "exit");
  running.stderr.resume();
  t.after(() => {
    if (running.exitCode === null) running.kill("SIGKILL");
  });
  await new Promise((resolve, reject) => {
    running.stdout.on("data", (b) => {
      if (String(b).includes("Serving")) resolve();
    });
    running.once("exit", () => reject(new Error("serve failed")));
  });
  assert.equal(
    (
      await request(
        source.descriptor.configuration.issuer + "/manage",
        source.tls,
      )
    ).status,
    200,
  );
  running.kill("SIGTERM");
  assert.deepEqual(await exited, [0, null]);
  const reopened = await serveSource(root);
  await reopened.close();
});
test("source expiry, exact registration binding, and interrupted pre-approval initialization fail closed", async (t) => {
  const root = sandbox(t),
    selected = await port();
  await initializeSource(root, selected, approve);
  const now = Date.now;
  try {
    Date.now = () => now() + 8 * 24 * 3600_000;
    await assert.rejects(serveSource(root));
  } finally {
    Date.now = now;
  }
  const descriptor = path.join(root, "launcher/ready.json"),
    bytes = fs.readFileSync(descriptor),
    changed = JSON.parse(bytes);
  changed.configuration.clients[0].redirectUri = `https://client-a.hcp.test:${selected}/other`;
  fs.writeFileSync(descriptor, JSON.stringify(changed));
  await assert.rejects(serveSource(root));
  fs.writeFileSync(descriptor, bytes);
  const partial = sandbox(t),
    init = spawn(
      process.execPath,
      [cli, "initialize", "--sandbox", partial, "--port", String(selected)],
      { env: { PATH: process.env.PATH }, stdio: ["pipe", "pipe", "pipe"] },
    );
  init.stderr.resume();
  const ended = once(init, "exit");
  await new Promise((resolve) =>
    init.stdout.on("data", (b) => {
      if (String(b).includes("Type approve")) resolve();
    }),
  );
  init.kill("SIGKILL");
  await ended;
  assert.equal(fs.existsSync(path.join(partial, "launcher/ready.json")), false);
  await assert.rejects(serveSource(partial));
  assert.equal(rows(partial, "entries").length, 0);
});
test("source killed owner must be reaped before exact store/issuer reopen and cannot reseed", async (t) => {
  const root = sandbox(t),
    selected = await port();
  await initializeSource(root, selected, approve);
  const before = rows(root, "entries");
  const child = spawn(process.execPath, [cli, "serve", "--sandbox", root], {
    env: { PATH: process.env.PATH },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const exited = once(child, "exit");
  child.stderr.resume();
  await new Promise((resolve) =>
    child.stdout.on("data", (b) => {
      if (String(b).includes("Serving")) resolve();
    }),
  );
  await assert.rejects(serveSource(root));
  child.kill("SIGKILL");
  await exited;
  assert.throws(() => process.kill(child.pid, 0), { code: "ESRCH" });
  const reopened = await serveSource(root);
  await reopened.close();
  assert.deepEqual(rows(root, "entries"), before);
});
