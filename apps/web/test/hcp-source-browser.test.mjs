import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import https from "node:https";
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import { createRequire } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { chromium } from "playwright";
import { localUiBrowserPrerequisite } from "../../../scripts/local-migration/local-ui-browser.mjs";
import { openSourceBrowser } from "../hcp-source-browser.mjs";
const require = createRequire(import.meta.url);
const {
  readSource,
  initializeSource,
  serveSource,
} = require("../../backend/dist/infrastructure/hcp-experiment/source.js");
const {
  request,
  certificates,
  inputs,
} = require("../../backend/test/local-database/hcp-experiment/authorization-fixture.cjs");
const cli = path.resolve(
  import.meta.dirname,
  "../../backend/dist/hcp-source.js",
);
const observer = path.resolve(
  import.meta.dirname,
  "../../backend/test/local-database/hcp-experiment/source-observer.cjs",
);

test(
  "C6 actual source CLI and pinned owned browser: approval, inspect, cancel, save once, history, same-session reopen and expiry",
  { timeout: 150_000 },
  async (t) => {
    const sandbox = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "hcp-c6-browser-")),
    );
    fs.chmodSync(sandbox, 0o700);
    let browser, server, exited;
    t.after(async () => {
      await browser?.close();
      if (server && server.exitCode === null) {
        server.kill("SIGTERM");
        await exited;
      }
      fs.rmSync(sandbox, { recursive: true, force: true });
    });
    const temporary = net.createServer();
    await new Promise((r) => temporary.listen(0, "127.0.0.1", r));
    const port = temporary.address().port;
    await new Promise((r) => temporary.close(r));
    const init = spawn(
      process.execPath,
      [cli, "initialize", "--sandbox", sandbox, "--port", String(port)],
      { env: { PATH: process.env.PATH }, stdio: ["pipe", "pipe", "pipe"] },
    );
    init.stderr.resume();
    let output = "",
      approved = false;
    init.stdout.on("data", (b) => {
      output += b;
      const match = /Type approve ([a-f0-9]{64})/.exec(output);
      if (match && !approved) {
        approved = true;
        init.stdin.end(`approve ${match[1]}\n`);
      }
    });
    assert.deepEqual(await once(init, "exit"), [0, null]);
    const source = readSource(sandbox),
      issuer = source.descriptor.configuration.issuer;
    assert.ok(!output.includes(source.humanCredential));
    let observed = [];
    async function serve() {
      observed = [];
      server = spawn(
        process.execPath,
        ["--require", observer, cli, "serve", "--sandbox", sandbox],
        {
          env: { PATH: process.env.PATH },
          stdio: ["ignore", "pipe", "pipe", "ipc"],
        },
      );
      exited = once(server, "exit");
      server.on("message", (message) => {
        if (message.request) observed.push(message.request);
      });
      server.stderr.resume();
      await new Promise((resolve, reject) => {
        server.stdout.on("data", (b) => {
          if (String(b).includes("Serving")) resolve();
        });
        server.once("exit", () => reject(new Error("source serve failed")));
      });
    }
    const managed = (route) =>
      request(issuer + route, source.tls, {
        headers: { authorization: `Bearer ${source.humanCredential}` },
      });
    await serve();
    browser = await openSourceBrowser(sandbox, { headless: true });
    await assert.rejects(openSourceBrowser(sandbox, { headless: true }));
    let page = browser.page;
    await page
      .getByLabel("Human management credential")
      .fill(source.humanCredential);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.goto(issuer + "/manage/entries");
    assert.match(await page.locator("body").innerText(), /Synthetic data only/);
    const entries = (await managed("/v2/export")).json.entries;
    const selected = entries.find(
      (e) =>
        e.content.value ===
        "Synthetic dashboard persona prefers a concise written summary.",
    );
    const detail =
      issuer + `/manage/entries/${encodeURIComponent(selected.id)}`;
    await page.goto(detail);
    await page
      .getByRole("link", { name: "Edit as your own statement", exact: true })
      .click();
    await page
      .getByLabel("Your statement")
      .fill("Synthetic browser correction prefers bullet points.");
    await page.getByRole("button", { name: "Review my statement" }).click();
    assert.match(
      await page.locator("body").innerText(),
      /Evidence items removed: 1/,
    );
    await page.getByRole("link", { name: "Cancel without saving" }).click();
    assert.equal(
      (await managed("/v2/export")).json.entries.find(
        (e) => e.id === selected.id,
      ).record.version,
      selected.record.version,
    );
    await page.goto(detail);
    await page
      .getByRole("link", { name: "Edit as your own statement", exact: true })
      .click();
    await page
      .getByLabel("Your statement")
      .fill("Synthetic browser correction prefers bullet points.");
    await page.getByRole("button", { name: "Review my statement" }).click();
    await page
      .getByRole("button", { name: "Approve and save my statement" })
      .click();
    assert.match(await page.locator("body").innerText(), /committed/);
    await page
      .getByRole("link", { name: "Inspect the entry and history" })
      .click();
    assert.match(
      await page.locator("body").innerText(),
      /Synthetic browser correction prefers bullet points/,
    );
    assert.match(await page.locator("body").innerText(), /context.revised/);
    await page.getByRole("link", { name: "1", exact: true }).click();
    assert.match(
      await page.locator("body").innerText(),
      /Synthetic dashboard persona prefers a concise written summary/,
    );
    assert.match(
      await page.locator("body").innerText(),
      /current lifecycle and classification/,
    );
    // Leave a pending review, then reopen: a fresh GET must not submit it.
    await page.goto(detail);
    await page
      .getByRole("link", { name: "Edit as your own statement", exact: true })
      .click();
    await page
      .getByLabel("Your statement")
      .fill("Synthetic pending text must never be auto-submitted.");
    await page.getByRole("button", { name: "Review my statement" }).click();
    const pendingForm = inputs(await page.content());
    const oldPid = browser.browserPid;
    await browser.close();
    browser = undefined;
    const preferencesFile = path.join(
      sandbox,
      "browser/profile/Default/Preferences",
    );
    const preferences = JSON.parse(fs.readFileSync(preferencesFile, "utf8"));
    preferences.session = {
      ...preferences.session,
      restore_on_startup: 1,
      startup_urls: [issuer + "/manage/person/approve"],
    };
    fs.writeFileSync(preferencesFile, JSON.stringify(preferences));
    assert.throws(() => process.kill(oldPid, 0), { code: "ESRCH" });
    server.kill("SIGTERM");
    assert.deepEqual(await exited, [0, null]);
    await serve();
    browser = await openSourceBrowser(sandbox, { headless: true });
    page = browser.page;
    assert.deepEqual(observed, [{ method: "GET", path: "/manage/entries" }]);
    // Also challenge explicit startup-URL mode, independently of the last-tab
    // restore setting above and the actual saved pending-review tab.
    await browser.close();
    browser = undefined;
    const startup = JSON.parse(fs.readFileSync(preferencesFile, "utf8"));
    startup.session = {
      ...startup.session,
      restore_on_startup: 4,
      startup_urls: [issuer + "/manage/person/approve"],
    };
    fs.writeFileSync(preferencesFile, JSON.stringify(startup));
    observed = [];
    browser = await openSourceBrowser(sandbox, { headless: true });
    page = browser.page;
    assert.deepEqual(observed, [{ method: "GET", path: "/manage/entries" }]);
    assert.equal(page.url(), issuer + "/manage/entries");
    assert.equal(await page.locator('body[data-stage="entries"]').count(), 1);
    const after = (await managed("/v2/export")).json.entries.find(
      (e) => e.id === selected.id,
    );
    assert.equal(after.record.version, selected.record.version + 1);
    assert.equal(
      after.content.value,
      "Synthetic browser correction prefers bullet points.",
    );
    // A separate, explicit recovery request can still use its original bounded
    // review. Reopen itself neither submits it nor extends any authority.
    const cookies = await browser.context.cookies(issuer);
    const recovered = await request(
      issuer + "/manage/person/approve",
      source.tls,
      {
        method: "POST",
        headers: {
          origin: issuer,
          cookie: cookies.map((c) => `${c.name}=${c.value}`).join("; "),
        },
        form: pendingForm,
      },
    );
    assert.equal(recovered.status, 201);
    assert.equal(
      (await managed("/v2/export")).json.entries.find(
        (e) => e.id === selected.id,
      ).record.version,
      selected.record.version + 2,
    );
    for (const route of [
      "/graphql",
      "/mcp",
      "/api/preferences/analysis",
      "/api/form-fill/pdf",
      "/api/local/unlock",
      "/api/local/logout",
      "/api/local/session",
      "/api/local/capabilities",
      ...[
        "list",
        "inspect",
        "grant",
        "revoke",
        "rename",
        "labels",
        "targets",
        "preview",
        "save",
      ].map((p) => "/api/local/mcp/" + p),
      "/local-admin",
      "/context-schema",
      "/dashboard",
      "/api/local/upload",
    ]) {
      for (const method of ["GET", "POST"])
        for (const headers of [
          {},
          { cookie: cookies.map((c) => `${c.name}=${c.value}`).join("; ") },
          { authorization: `Bearer ${source.humanCredential}` },
        ]) {
          const response = await request(issuer + route, source.tls, {
            method,
            headers,
            ...(method === "POST"
              ? {
                  json: {
                    query:
                      "mutation { clearMyHistory resetMyMemory applyPreferenceSuggestions applyPreferenceSuggestionsV2 }",
                  },
                }
              : {}),
          });
          assert.equal(response.status, 404, `${method} ${route}`);
          assert.deepEqual(response.json, { error: "not_found" });
          assert.ok(!response.text.includes(selected.id));
        }
    }
    await browser.close();
    browser = undefined;
    server.kill("SIGTERM");
    await exited;
    // Controlled fixture clock data: expire persisted sessions while the store is stopped.
    const db = new DatabaseSync(path.join(sandbox, "data/entries.sqlite"));
    try {
      db.exec("UPDATE human_sessions SET expires_at=0");
    } finally {
      db.close();
    }
    await serve();
    browser = await openSourceBrowser(sandbox, { headless: true });
    assert.equal(
      await browser.page.locator('body[data-stage="login"]').count(),
      1,
    );
    await browser.close();
    browser = undefined;
    const open = spawn(
      process.execPath,
      [cli, "open", "--sandbox", sandbox, "--headless", "true"],
      {
        env: {
          PATH: process.env.PATH,
          LOCAL_UI_BROWSER_EXECUTABLE: localUiBrowserPrerequisite(
            path.resolve(import.meta.dirname, "../../.."),
          ).executable,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const openExited = once(open, "exit");
    open.stderr.resume();
    t.after(() => {
      if (open.exitCode === null && open.signalCode === null)
        open.kill("SIGKILL");
    });
    await new Promise((resolve, reject) => {
      open.stdout.on("data", (b) => {
        if (String(b).includes("Owned synthetic browser opened")) resolve();
      });
      open.once("exit", () => reject(new Error("source open failed")));
    });
    open.kill("SIGTERM");
    assert.deepEqual(await openExited, [0, null]);
    const lease = new DatabaseSync(path.join(sandbox, "browser/owner.sqlite"), {
      readOnly: true,
    });
    try {
      assert.equal(
        lease.prepare("SELECT phase FROM owner").get().phase,
        "closed",
      );
    } finally {
      lease.close();
    }
  },
);

test(
  "C6 source browser verifies CA, hostname and expiry with no TLS bypass and refuses unowned profile setup",
  { timeout: 90_000 },
  async (t) => {
    const sandbox = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "hcp-c6-tls-")),
    );
    fs.chmodSync(sandbox, 0o700);
    let server, browser;
    t.after(async () => {
      await browser?.close();
      if (server) {
        server.closeAllConnections();
        await new Promise((r) => server.close(r));
      }
      fs.rmSync(sandbox, { recursive: true, force: true });
    });
    const probe = net.createServer();
    await new Promise((r) => probe.listen(0, "127.0.0.1", r));
    const port = probe.address().port;
    await new Promise((r) => probe.close(r));
    await initializeSource(
      sandbox,
      port,
      async (review) => `approve ${review.digest}`,
    );
    const source = readSource(sandbox),
      invalid = path.join(sandbox, "browser/invalid-tls");
    fs.mkdirSync(invalid, { mode: 0o700 });
    const foreign = certificates(invalid);
    for (const [kind, expected] of [
      ["ca", "ERR_CERT_AUTHORITY_INVALID"],
      ["hostname", "ERR_CERT_COMMON_NAME_INVALID"],
      ["expiry", "ERR_CERT_DATE_INVALID"],
    ]) {
      let tls = foreign;
      if (kind !== "ca") {
        fs.writeFileSync(
          path.join(invalid, "test.ext"),
          `basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:${kind === "hostname" ? "wrong.hcp.test" : "as.hcp.test"}\n`,
          { mode: 0o600 },
        );
        execFileSync(
          "openssl",
          [
            "x509",
            "-req",
            "-in",
            path.join(sandbox, "tls/leaf.csr"),
            "-CA",
            path.join(sandbox, "tls/ca.pem"),
            "-CAkey",
            path.join(sandbox, "tls/ca.key"),
            "-set_serial",
            "123",
            "-days",
            kind === "expiry" ? "0" : "1",
            "-sha256",
            "-extfile",
            "test.ext",
            "-out",
            "test.pem",
          ],
          { cwd: invalid, stdio: "ignore" },
        );
        tls = {
          key: source.tls.key,
          cert: fs.readFileSync(path.join(invalid, "test.pem")),
        };
      }
      let hits = 0;
      server = https.createServer(tls, (_req, res) => {
        hits++;
        res.end("must not be reached");
      });
      await new Promise((r) => server.listen(port, "127.0.0.1", r));
      await assert.rejects(
        openSourceBrowser(sandbox, { headless: true }),
        (e) => e.message.includes(expected),
      );
      assert.equal(hits, 0);
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
      server = undefined;
    }
    const provider = await serveSource(sandbox);
    try {
      browser = await openSourceBrowser(sandbox, { headless: true });
      assert.equal(
        await browser.page.locator('body[data-stage="login"]').count(),
        1,
      );
      await browser.close();
      browser = undefined;
      const profile = path.join(sandbox, "browser/profile");
      const independent = await chromium.launchPersistentContext(profile, {
        executablePath: localUiBrowserPrerequisite(
          path.resolve(import.meta.dirname, "../../.."),
        ).executable,
        headless: true,
        env: {
          PATH: process.env.PATH,
          HOME: path.join(sandbox, "browser"),
          TMPDIR: path.join(sandbox, "browser"),
          LANG: "C",
        },
      });
      try {
        const trustFile = path.join(profile, "Default/ServerCertificate"),
          trustBefore = fs.readFileSync(trustFile);
        await assert.rejects(openSourceBrowser(sandbox, { headless: true }));
        assert.deepEqual(fs.readFileSync(trustFile), trustBefore);
        assert.ok(independent.pages().length > 0);
      } finally {
        await independent.close();
      }
      const owner = new DatabaseSync(
        path.join(sandbox, "browser/owner.sqlite"),
      );
      try {
        owner
          .prepare("UPDATE owner SET controller=?,phase='running',browser=?")
          .run(process.pid, process.pid);
      } finally {
        owner.close();
      }
      await assert.rejects(openSourceBrowser(sandbox, { headless: true }));
    } finally {
      await provider.close();
    }
  },
);

async function lifecycleFixture(t, { trusted = true } = {}) {
  const sandbox = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "hcp-c6-browser-lifecycle-")),
  );
  fs.chmodSync(sandbox, 0o700);
  let provider;
  t.after(async () => {
    await provider?.close();
    // A failing startup-signal regression can terminate its controller before
    // Playwright returns a handle. Do not remove a profile while Chromium exits.
    const lock = path.join(sandbox, "browser/profile/SingletonLock");
    try {
      const pid = Number(fs.readlinkSync(lock).split("-").at(-1));
      assert.ok(Number.isSafeInteger(pid) && pid > 0);
      const until = performance.now() + 5_000;
      for (;;) {
        try {
          process.kill(pid, 0);
        } catch (error) {
          if (error.code === "ESRCH") break;
          throw error;
        }
        assert.ok(
          performance.now() < until,
          "Owned browser must exit before fixture removal",
        );
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    fs.rmSync(sandbox, { recursive: true, force: true });
  });
  const probe = net.createServer();
  await new Promise((r) => probe.listen(0, "127.0.0.1", r));
  const port = probe.address().port;
  await new Promise((r) => probe.close(r));
  await initializeSource(sandbox, port, async (r) => `approve ${r.digest}`);
  provider = await serveSource(sandbox);
  if (trusted) {
    const browser = await openSourceBrowser(sandbox, { headless: true });
    await browser.close();
  }
  const source = readSource(sandbox);
  const owner = () => {
    const db = new DatabaseSync(path.join(sandbox, "browser/owner.sqlite"), {
      readOnly: true,
    });
    try {
      return db.prepare("SELECT * FROM owner").get();
    } finally {
      db.close();
    }
  };
  const exported = async () => {
    const result = await request(provider.issuer + "/v2/export", source.tls, {
      headers: { authorization: `Bearer ${source.humanCredential}` },
    });
    // Compare retained state, excluding only the envelope's per-request timestamp.
    assert.equal(
      new Date(result.json.exportedAt).toISOString(),
      result.json.exportedAt,
    );
    delete result.json.exportedAt;
    return result;
  };
  return { sandbox, owner, exported };
}

function observedOpen(t, sandbox, mode) {
  const executable = localUiBrowserPrerequisite(
    path.resolve(import.meta.dirname, "../../.."),
  ).executable;
  const child = spawn(
    process.execPath,
    [
      "--require",
      path.join(import.meta.dirname, "hcp-source-browser-hook.cjs"),
      cli,
      "open",
      "--sandbox",
      sandbox,
      "--headless",
      "true",
    ],
    {
      env: {
        PATH: process.env.PATH,
        LOCAL_UI_BROWSER_EXECUTABLE: executable,
        HCP_SOURCE_BROWSER_TEST: mode,
      },
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    },
  );
  let stdout = "",
    stderr = "";
  const messages = [],
    exited = once(child, "exit");
  child.on("message", (message) => messages.push(message));
  child.stdout.on("data", (bytes) => {
    stdout += bytes;
  });
  child.stderr.on("data", (bytes) => {
    stderr += bytes;
  });
  const ready = new Promise((resolve, reject) => {
    child.stdout.on("data", () => {
      if (stdout.includes("Owned synthetic browser opened")) resolve();
    });
    child.once("exit", () => reject(new Error("Source browser did not open")));
  });
  ready.catch(() => {}); // Rejected-launch tests intentionally never await ready.
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      await exited;
    }
  });
  return {
    child,
    ready,
    exited,
    messages,
    stderr: () => stderr,
    stdout: () => stdout,
  };
}

for (const trusted of [false, true])
  for (const signal of ["SIGINT", "SIGTERM"])
    test(
      `C6 ${signal} during ${trusted ? "trusted" : "first"} browser startup closes safely and permits reopen`,
      { timeout: 60_000 },
      async (t) => {
        const { sandbox, owner, exported } = await lifecycleFixture(t, {
          trusted,
        });
        const before = (await exported()).json;
        const opened = observedOpen(t, sandbox, `signal-start:${signal}`);
        assert.deepEqual(await opened.exited, [0, null], opened.stderr());
        assert.equal(
          opened.messages.filter((m) => m.startupSignal === signal).length,
          2,
        );
        assert.doesNotMatch(opened.stdout(), /Owned synthetic browser opened/);
        for (const { browserPid } of opened.messages.filter(
          (m) => m.browserPid,
        ))
          assert.throws(() => process.kill(browserPid, 0), { code: "ESRCH" });
        assert.equal(owner().phase, "closed");
        assert.deepEqual((await exported()).json, before);
        const reopened = observedOpen(t, sandbox, "natural-close");
        await reopened.ready;
        reopened.child.kill("SIGTERM");
        assert.deepEqual(await reopened.exited, [0, null], reopened.stderr());
        assert.equal(owner().phase, "closed");
      },
    );

test(
  "C6 browser-initiated CLI shutdown reaps before closed, keeps provider alive and permits exact reopen",
  { timeout: 60_000 },
  async (t) => {
    const { sandbox, owner, exported } = await lifecycleFixture(t);
    const before = (await exported()).json;
    const opened = observedOpen(t, sandbox, "natural-close");
    await opened.ready;
    opened.child.send({ closeBrowser: true });
    assert.deepEqual(await opened.exited, [0, null], opened.stderr());
    const pid = opened.messages.find((m) => m.browserPid)?.browserPid;
    assert.ok(pid > 0);
    assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
    assert.equal(owner().phase, "closed");
    assert.deepEqual((await exported()).json, before);
    const reopened = observedOpen(t, sandbox, "natural-close");
    await reopened.ready;
    reopened.child.kill("SIGTERM");
    assert.deepEqual(await reopened.exited, [0, null], reopened.stderr());
    assert.equal(owner().phase, "closed");
  },
);

test(
  "C6 browser close bounds a live or reused PID refusal and reports it without an unhandled rejection",
  { timeout: 60_000 },
  async (t) => {
    const { sandbox, owner, exported } = await lifecycleFixture(t);
    const opened = observedOpen(t, sandbox, "hold-exit-probe");
    await opened.ready;
    const closingBrowser = new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timeout);
        opened.child.off("message", onMessage);
        opened.child.off("exit", onExit);
      };
      const onMessage = (message) => {
        if (!message.closingBrowser) return;
        cleanup();
        resolve();
      };
      const onExit = () => {
        cleanup();
        reject(new Error("Browser exited before enabling the live-PID probe"));
      };
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error("Browser-close probe acknowledgement timed out"));
      }, 10_000);
      opened.child.on("message", onMessage);
      opened.child.once("exit", onExit);
    });
    const start = Date.now();
    opened.child.send({ closeBrowser: true });
    await closingBrowser; // The hook has enabled the live-PID probe before signals.
    const signals = ["SIGINT", "SIGINT", "SIGTERM", "SIGTERM"].map(
      (signal, index) =>
        setTimeout(
          () => {
            if (
              opened.child.exitCode === null &&
              opened.child.signalCode === null
            )
              opened.child.kill(signal);
          },
          250 + index * 100,
        ),
    );
    t.after(() => signals.forEach(clearTimeout));
    assert.deepEqual(await opened.exited, [1, null]);
    assert.match(opened.stderr(), /HCP source command refused/);
    assert.doesNotMatch(opened.stderr(), /\n\s+at |UnhandledPromise|uncaught/i);
    assert.ok(
      Date.now() - start >= 4_000,
      "Must await stopped proof within the fixed bound",
    );
    assert.ok(
      Date.now() - start < 15_000,
      "Stopped-proof wait must remain bounded",
    );
    assert.equal(owner().phase, "running");
    assert.equal((await exported()).status, 200);
  },
);

test(
  "C6 rejected trusted-profile launch stays unproven and next open refuses before trust access or launch",
  { timeout: 60_000 },
  async (t) => {
    const { sandbox, owner, exported } = await lifecycleFixture(t);
    const trustFile = path.join(
      sandbox,
      "browser/profile/Default/ServerCertificate",
    );
    const trustBefore = fs.readFileSync(trustFile),
      before = (await exported()).json;
    const failed = observedOpen(t, sandbox, "reject-launch");
    assert.deepEqual(await failed.exited, [1, null]);
    assert.equal(failed.messages.filter((m) => m.launch).length, 1);
    const retry = observedOpen(t, sandbox, "reject-launch");
    assert.deepEqual(await retry.exited, [1, null]);
    assert.deepEqual(
      retry.messages,
      [],
      "Refusal must precede profile trust access and a second launch",
    );
    assert.equal(owner().phase, "starting");
    assert.deepEqual(fs.readFileSync(trustFile), trustBefore);
    assert.deepEqual((await exported()).json, before);
  },
);
