import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import { execFileSync } from "node:child_process";
import { X509Certificate, createHash, randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { createRequire } from "node:module";
import { chromium } from "playwright";
import { localUiBrowserPrerequisite } from "../../../scripts/local-migration/local-ui-browser.mjs";
const require = createRequire(import.meta.url);
const {
  fixture,
  inputs,
} = require("../../backend/test/local-database/hcp-experiment/authorization-fixture.cjs");
const {
  ACCESS_TYPE,
  PURPOSES,
} = require("../../backend/dist/infrastructure/hcp-experiment/policy.js");
const root = path.resolve(import.meta.dirname, "../../..");
const secret = () => randomBytes(32).toString("base64url");

test(
  "C5 browser separately elects persistence and reviews governance and exact-subject portability",
  { timeout: 120_000 },
  async (t) => {
    const f = await fixture(t, {
        approveFixtures: true,
        notifications: true,
        childProcess: true,
      }),
      good = await probeServer(t, f, f.tls.cert);
    const context = await trustedBrowser(f, (c) =>
      rejected(c, good, "ERR_CERT_AUTHORITY_INVALID"),
    );
    try {
      const allowed = new Set([
          f.issuer,
          good.url,
          new URL(f.redirects.a).origin,
        ]),
        unexpected = [];
      await context.route("**/*", (route) => {
        if (allowed.has(new URL(route.request().url()).origin))
          return route.continue();
        unexpected.push(route.request().url());
        return route.abort();
      });
      const page = await context.newPage(),
        verifier = secret(),
        state = secret();
      await page.goto(
        f.issuer +
          "/auth?" +
          new URLSearchParams({
            client_id: "a",
            redirect_uri: f.redirects.a,
            response_type: "code",
            response_mode: "form_post",
            resource: f.issuer,
            state,
            code_challenge: createHash("sha256")
              .update(verifier)
              .digest("base64url"),
            code_challenge_method: "S256",
            authorization_details: JSON.stringify([
              {
                type: ACCESS_TYPE,
                actions: ["read"],
                categories: ["general_preferences"],
                purposes: [PURPOSES[0]],
              },
            ]),
          }),
      );
      await page.getByLabel("Human management credential").fill(f.human);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await page.getByRole("button", { name: "Review exact grant" }).click();
      await page.waitForSelector('body[data-stage="review"]');
      assert.match(
        await page.locator("body").innerText(),
        /Temporary access expires/,
      );
      assert.match(
        await page.locator("body").innerText(),
        /Revocation does not remove copies/,
      );
      const oldForm = inputs(await page.content()),
        approvePath = await page
          .locator('form[action$="/approve"]')
          .getAttribute("action"),
        count = (await f.management("/v2/grants")).json.grants.length;
      await page
        .getByRole("button", { name: "Elect persistent access" })
        .click();
      await page.waitForSelector('body[data-stage="review"]');
      assert.match(
        await page.locator("body").innerText(),
        /Persistent access: remains/,
      );
      assert.equal(
        (await f.management("/v2/grants")).json.grants.length,
        count,
      );
      const browserCookies = await context.cookies(f.issuer);
      const staleResponse = await f.request(approvePath, {
        method: "POST",
        headers: {
          origin: f.issuer,
          cookie: browserCookies.map((c) => `${c.name}=${c.value}`).join("; "),
        },
        form: { reviewId: oldForm.reviewId, csrf: oldForm.csrf },
      });
      assert.equal(staleResponse.status, 403);
      await page
        .getByRole("button", { name: "Approve access", exact: true })
        .click();
      await page.waitForURL(f.redirects.a);
      const callback = JSON.parse(await page.locator("body").innerText());
      assert.equal(callback.state, state);
      const exchange = await f.request("/token", {
        method: "POST",
        form: {
          grant_type: "authorization_code",
          client_id: "a",
          code: callback.code,
          code_verifier: verifier,
          redirect_uri: f.redirects.a,
          resource: f.issuer,
        },
      });
      assert.equal(exchange.status, 200);
      assert.equal(typeof exchange.json.refresh_token, "string");
      const refreshed = await f.request("/token", {
        method: "POST",
        form: {
          grant_type: "refresh_token",
          client_id: "a",
          refresh_token: exchange.json.refresh_token,
          resource: f.issuer,
        },
      });
      assert.equal(refreshed.status, 200);
      const token = refreshed.json.access_token,
        read = await f.context("/v2/entries/query", token, {
          method: "POST",
          json: { query: "written notes", purpose: PURPOSES[0].code },
        });
      assert.equal(read.status, 200);
      assert.equal(
        (
          await f.context("/v2/shares", token, {
            method: "POST",
            json: {
              recipient: { domain: "recipient.example", name: "Synthetic" },
              refs: [read.json.entries[0].ref],
              purpose: PURPOSES[0].code,
              sharedAt: new Date().toISOString(),
            },
          })
        ).status,
        403,
      );
      await page.goto(f.issuer + "/manage/disclosures");
      assert.match(
        await page.locator("body").innerText(),
        /receipt is unconfirmed/i,
      );
      await page.goto(f.issuer + "/manage/policy");
      const form = page
        .locator("form")
        .filter({ has: page.getByRole("button", { name: "Set directive" }) });
      await form.locator('[name="action"]').fill("share");
      await form
        .locator('[name="text"]')
        .fill("Synthetic onward-use restriction");
      await form.getByRole("button", { name: "Set directive" }).click();
      assert.match(
        await page.locator("body").innerText(),
        /Synthetic onward-use restriction/,
      );
      const bundle = (await f.management("/v2/export?include=versions")).json,
        entry = bundle.entries.find((e) => e.record.status === "active");
      entry.id = `urn:uuid:${crypto.randomUUID()}`;
      entry.subject.id = bundle.subject.id = "urn:foreign:browser-subject";
      entry.record.version = 1;
      entry.record.relationships = [];
      bundle.entries = [entry];
      delete bundle.versions;
      await page.goto(f.issuer + "/manage/import");
      await page.locator('[name="source"]').fill(JSON.stringify(bundle));
      await page.getByRole("button", { name: "Dry run", exact: true }).click();
      await page.waitForSelector('body[data-stage="import-preview"]');
      assert.match(
        await page.locator("body").innerText(),
        /urn:foreign:browser-subject/,
      );
      await page.goto(f.issuer + "/manage/import");
      await page.locator('[name="source"]').fill(JSON.stringify(bundle));
      await page
        .getByRole("button", { name: "Review import", exact: true })
        .click();
      await page.waitForSelector('body[data-stage="import-review"]');
      await page.locator('[name="attest"]').check();
      await page.getByRole("button", { name: "Apply reviewed import" }).click();
      await page.waitForSelector('body[data-stage="import-result"]');
      await page.goto(
        f.issuer +
          `/manage/entries/${encodeURIComponent(entry.id)}/classification`,
      );
      const categories = page.locator("form").filter({
        has: page.getByRole("button", {
          name: "Review categories",
          exact: true,
        }),
      });
      await categories.locator('[name="values"]').fill("work_context");
      await categories
        .getByRole("button", { name: "Review categories", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Approve classification change" })
        .click();
      await page.waitForSelector('body[data-stage="entry"]');
      await f.restart();
      await page.reload();
      assert.match(await page.locator("body").innerText(), /work_context/);
      const exported = (await f.management("/v2/export")).json.entries.find(
        (e) => e.id === entry.id,
      );
      assert.equal(exported.subject.id, bundle.subject.id);
      assert.equal(exported.record.version, 1);
      assert.deepEqual(unexpected, []);
    } finally {
      await context.close();
    }
  },
);

// Chromium's normal per-profile trust store; never a TLS-ignore option or OS trust edit.
async function trustedBrowser(f, beforeTrust) {
  const pin = localUiBrowserPrerequisite(root);
  const profile = path.join(f.sandbox, "browser-profile");
  const options = {
    executablePath: pin.executable,
    headless: true,
    ignoreHTTPSErrors: false,
    args: [
      "--host-resolver-rules=MAP as.hcp.test 127.0.0.1, MAP client-a.hcp.test 127.0.0.1, MAP client-b.hcp.test 127.0.0.1",
      "--no-proxy-server",
    ],
    env: {
      PATH: process.env.PATH,
      HOME: f.sandbox,
      TMPDIR: f.sandbox,
      LANG: "C",
    },
  };
  const setup = await chromium.launchPersistentContext(profile, options);
  try {
    await beforeTrust(setup);
    const page = await setup.newPage();
    await page.goto("chrome://certificate-manager");
    await page.waitForSelector("certificate-manager");
  } finally {
    await setup.close();
  }
  const db = new DatabaseSync(
    path.join(profile, "Default", "ServerCertificate"),
  );
  try {
    assert.equal(db.prepare("SELECT count(*) n FROM certificates").get().n, 0);
    const der = new X509Certificate(f.tls.ca).raw;
    db.prepare(
      "INSERT INTO certificates(sha256hash_hex,der_cert,trust_settings) VALUES(?,?,?)",
    ).run(
      createHash("sha256").update(der).digest("hex"),
      der,
      Buffer.from([0x0a, 0x02, 0x08, 0x03]),
    );
  } finally {
    db.close();
  }
  return chromium.launchPersistentContext(profile, options);
}
async function invalidLeaf(f, name, hostname, days) {
  const directory = path.join(f.sandbox, "tls");
  fs.writeFileSync(
    path.join(directory, name + ".ext"),
    `basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:${hostname}\n`,
    { mode: 0o600 },
  );
  execFileSync(
    "openssl",
    [
      "x509",
      "-req",
      "-in",
      "leaf.csr",
      "-CA",
      "ca.pem",
      "-CAkey",
      "ca.key",
      "-CAcreateserial",
      "-days",
      days,
      "-sha256",
      "-extfile",
      name + ".ext",
      "-out",
      name + ".pem",
    ],
    { cwd: directory, stdio: "ignore" },
  );
  fs.chmodSync(path.join(directory, name + ".pem"), 0o600);
  return fs.readFileSync(path.join(directory, name + ".pem"));
}
async function probeServer(t, f, cert) {
  let hits = 0;
  const server = https.createServer({ key: f.tls.key, cert }, (_req, res) => {
    hits++;
    res.end("verified");
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  return {
    url: `https://as.hcp.test:${server.address().port}`,
    hits: () => hits,
  };
}
async function rejected(context, probe, code) {
  const page = await context.newPage();
  try {
    await assert.rejects(page.goto(probe.url), (e) => e.message.includes(code));
    assert.equal(probe.hits(), 0);
  } finally {
    await page.close();
  }
}

for (const approvedFixtures of [false, true])
  test(
    `${approvedFixtures ? "C3 read journey" : "C2 authorization"}: browser verifies isolated TLS, consent, callbacks, history and revoke`,
    { timeout: 120_000 },
    async (t) => {
      const f = await fixture(t, { approveFixtures: approvedFixtures });
      const good = await probeServer(t, f, f.tls.cert);
      const wrong = await probeServer(
        t,
        f,
        await invalidLeaf(f, "wrong", "other.hcp.test", "2"),
      );
      const expired = await probeServer(
        t,
        f,
        await invalidLeaf(f, "expired", "as.hcp.test", "0"),
      );
      const context = await trustedBrowser(f, (c) =>
        rejected(c, good, "ERR_CERT_AUTHORITY_INVALID"),
      );
      try {
        const allowed = new Set([
          f.issuer,
          ...Object.values(f.redirects).map((u) => new URL(u).origin),
          good.url,
          wrong.url,
          expired.url,
        ]);
        const unexpected = [];
        await context.route("**/*", (route) => {
          if (allowed.has(new URL(route.request().url()).origin))
            return route.continue();
          unexpected.push("unexpected-origin");
          return route.abort();
        });
        const page = await context.newPage();
        const response = await page.goto(good.url);
        assert.equal(response.status(), 200);
        assert.equal(
          (await response.securityDetails()).issuer,
          "Owned HCP C2 fixture CA",
        );
        await rejected(context, wrong, "ERR_CERT_COMMON_NAME_INVALID");
        await rejected(context, expired, "ERR_CERT_DATE_INVALID");
        async function authorize(client, scopeOnly = false, first = false) {
          const verifier = secret(),
            state = secret();
          const params = {
            client_id: client,
            redirect_uri: f.redirects[client],
            response_type: "code",
            response_mode: "form_post",
            resource: f.issuer,
            state,
            code_challenge: createHash("sha256")
              .update(verifier)
              .digest("base64url"),
            code_challenge_method: "S256",
            ...(scopeOnly
              ? { scope: "hcp:general_preferences:read" }
              : {
                  authorization_details: JSON.stringify([
                    {
                      type: ACCESS_TYPE,
                      actions: ["read"],
                      categories: ["general_preferences"],
                      purposes: [PURPOSES[0]],
                    },
                  ]),
                }),
          };
          await page.goto(f.issuer + "/auth?" + new URLSearchParams(params));
          if (first) {
            await page.waitForSelector('body[data-stage="login"]');
            await page.getByLabel("Human management credential").fill(f.human);
            await page
              .getByRole("button", { name: "Sign in", exact: true })
              .click();
          }
          await page.waitForSelector('body[data-stage="consent"]');
          assert.match(
            await page.locator("[data-access-summary]").innerText(),
            /Read access only/,
          );
          assert.doesNotMatch(
            await page.locator("[data-access-summary]").innerText(),
            /create, revise and withdraw/,
          );
          const before = (await f.management("/v2/grants")).json.grants.length;
          if (scopeOnly)
            await page
              .getByLabel("Choose a purpose")
              .selectOption(PURPOSES[0].code);
          assert.match(await page.locator("body").innerText(), /own use-until/);
          await page
            .getByRole("button", { name: "Review exact grant" })
            .click();
          await page.waitForSelector('body[data-stage="review"]');
          assert.match(
            await page.locator("[data-access-summary]").innerText(),
            /Read access only/,
          );
          assert.equal(
            (await f.management("/v2/grants")).json.grants.length,
            before,
          );
          await page
            .getByRole("button", { name: "Approve access", exact: true })
            .click();
          await page.waitForURL(f.redirects[client]);
          assert.equal(
            new URL(page.url()).search,
            "",
            "code stays in the POST body",
          );
          const callback = JSON.parse(await page.locator("body").innerText());
          assert.equal(callback.state, state);
          assert.equal(callback.iss, f.issuer);
          assert.equal(typeof callback.code, "string");
          const exchange = await f.request("/token", {
            method: "POST",
            form: {
              grant_type: "authorization_code",
              client_id: client,
              code: callback.code,
              code_verifier: verifier,
              redirect_uri: f.redirects[client],
              resource: f.issuer,
            },
          });
          assert.equal(exchange.status, 200);
          assert.ok(exchange.json.expires_in <= 3600);
          return exchange.json.access_token;
        }
        const a1 = await authorize("a", false, true),
          a2 = await authorize("a", true),
          b = await authorize("b");
        assert.equal(f.callbacks.length, 3);
        assert.ok(f.callbacks.every((c) => !c.cookie));
        const cookies = await context.cookies(f.issuer);
        assert.ok(cookies.some((c) => c.name === "__Host-hcp-human"));
        assert.ok(
          cookies.every(
            (c) => c.domain === "as.hcp.test" && c.secure && c.httpOnly,
          ),
        );
        const grantId = (await f.context("/v2/grants", a1)).json.grants[0]
          .grantId;
        const read = (token) =>
          f.context("/v2/entries/query", token, {
            method: "POST",
            json: { query: "written notes", purpose: PURPOSES[0].code },
          });
        if (approvedFixtures) {
          const results = await Promise.all([a1, a2, b].map(read));
          assert.ok(
            results.every(
              (r) => r.status === 200 && r.json.entries.length === 1,
            ),
          );
          assert.equal(
            new Set(results.map((r) => r.json.entries[0].ref)).size,
            3,
          );
          const get = await f.context(
            `/v2/entries/${results[0].json.entries[0].ref}?purpose=${PURPOSES[0].code}&version=1`,
            a1,
          );
          assert.equal(get.status, 200);
          assert.equal(get.json.entry.version, 1);
        }
        await page.goto(f.issuer + "/manage");
        assert.equal(await page.locator("article").count(), 3);
        await page.goto(
          f.issuer + "/manage?grantId=" + encodeURIComponent(grantId),
        );
        assert.match(await page.locator("body").innerText(), /grant\.issued/);
        const historyText = await page.locator("body").innerText();
        assert.equal(historyText.includes("context.read"), approvedFixtures);
        if (approvedFixtures) {
          assert.ok(historyText.includes("Receipt is unconfirmed"));
          assert.ok(historyText.includes("Last possible copy use-until"));
          assert.ok(historyText.includes("No notification endpoint"));
        }
        await page
          .getByRole("button", { name: "Revoke grant", exact: true })
          .click();
        await page.waitForURL(f.issuer + "/manage?status=all");
        assert.equal((await f.context("/v2/grants", a1)).status, 401);
        assert.equal((await f.context("/v2/grants", a2)).status, 200);
        assert.equal((await f.context("/v2/grants", b)).status, 200);
        if (approvedFixtures) {
          assert.equal((await read(a1)).status, 401);
          assert.equal((await read(a2)).status, 200);
          assert.equal((await read(b)).status, 200);
          await page.goto(
            f.issuer + "/manage?grantId=" + encodeURIComponent(grantId),
          );
          const retained = await page.locator("body").innerText();
          assert.ok(
            retained.includes("context.read") &&
              retained.includes("grant.revoked"),
          );
        }
        const history = (await f.management("/v2/audit")).json.events;
        assert.ok(
          history
            .filter(
              (e) =>
                e.eventType === "grant.issued" &&
                e.data.modality !== "private-fixture-initializer",
            )
            .every((e) => e.data.modality === "browser"),
        );
        assert.equal(unexpected.length, 0);
      } finally {
        await context.close();
      }
    },
  );

test(
  "C4 browser reviews write consent, person edits, model confirmation and revocation",
  { timeout: 120_000 },
  async (t) => {
    const f = await fixture(t, { approveFixtures: true });
    const good = await probeServer(t, f, f.tls.cert);
    const context = await trustedBrowser(f, (c) =>
      rejected(c, good, "ERR_CERT_AUTHORITY_INVALID"),
    );
    try {
      const allowed = new Set([
          f.issuer,
          good.url,
          new URL(f.redirects.a).origin,
        ]),
        unexpected = [];
      await context.route("**/*", (route) => {
        if (allowed.has(new URL(route.request().url()).origin))
          return route.continue();
        unexpected.push("unexpected-origin");
        return route.abort();
      });
      const page = await context.newPage(),
        verifier = secret(),
        state = secret();
      const access = [
        {
          type: ACCESS_TYPE,
          actions: ["read", "write"],
          categories: ["general_preferences"],
          purposes: [PURPOSES[0]],
        },
      ];
      await page.goto(
        f.issuer +
          "/auth?" +
          new URLSearchParams({
            client_id: "a",
            redirect_uri: f.redirects.a,
            response_type: "code",
            response_mode: "form_post",
            resource: f.issuer,
            state,
            code_challenge: createHash("sha256")
              .update(verifier)
              .digest("base64url"),
            code_challenge_method: "S256",
            authorization_details: JSON.stringify(access),
          }),
      );
      await page.waitForSelector('body[data-stage="login"]');
      await page.getByLabel("Human management credential").fill(f.human);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await page.waitForSelector('body[data-stage="consent"]');
      assert.match(
        await page.locator("[data-access-summary]").innerText(),
        /read, create, revise and withdraw/,
      );
      assert.doesNotMatch(
        await page.locator("body").innerText(),
        /Read access only/,
      );
      await page.getByRole("button", { name: "Review exact grant" }).click();
      await page.waitForSelector('body[data-stage="review"]');
      assert.match(
        await page.locator("[data-access-summary]").innerText(),
        /read, create, revise and withdraw/,
      );
      assert.doesNotMatch(
        await page.locator("body").innerText(),
        /Read access only/,
      );
      await page
        .getByRole("button", { name: "Approve access", exact: true })
        .click();
      await page.waitForURL(f.redirects.a);
      const callback = JSON.parse(await page.locator("body").innerText());
      assert.equal(callback.state, state);
      const exchange = await f.request("/token", {
        method: "POST",
        form: {
          grant_type: "authorization_code",
          client_id: "a",
          code: callback.code,
          code_verifier: verifier,
          redirect_uri: f.redirects.a,
          resource: f.issuer,
        },
      });
      assert.equal(exchange.status, 200);
      const token = exchange.json.access_token,
        grant = (await f.context("/v2/grants", token)).json.grants[0];
      assert.deepEqual(grant.access[0].actions, ["read", "write"]);

      await page.goto(f.issuer + "/manage/person/new");
      await page.getByLabel("Your statement").fill("I prefer a short summary");
      await page.getByRole("button", { name: "Review my statement" }).click();
      await page.waitForSelector('body[data-stage="person-review"]');
      assert.match(
        await page.locator("[data-person-authority]").innerText(),
        /Review the synthetic person's preferences/,
      );
      assert.match(
        await page.locator("body").innerText(),
        /I prefer a short summary/,
      );
      await page
        .getByRole("button", { name: "Approve and save my statement" })
        .click();
      await page.waitForSelector('body[data-stage="person-saved"]');
      await page
        .getByRole("link", { name: "Inspect the entry and history" })
        .click();
      await page.waitForSelector('body[data-stage="entry"]');
      assert.equal(
        JSON.parse(await page.locator("pre[data-entry-document]").textContent())
          .record.provenance.assertedBy.assurance,
        "authenticated",
      );
      await page
        .getByRole("link", { name: "Edit as your own statement" })
        .click();
      await page
        .getByLabel("Your statement")
        .fill("I prefer a compact email summary");
      await page.getByRole("button", { name: "Review my statement" }).click();
      await page.waitForSelector('body[data-stage="person-review"]');
      await page
        .getByRole("button", { name: "Approve and save my statement" })
        .click();
      await page.waitForSelector('body[data-stage="person-saved"]');
      await page
        .getByRole("link", { name: "Inspect the entry and history" })
        .click();
      await page.waitForSelector('body[data-stage="entry"]');
      assert.equal(
        JSON.parse(await page.locator("pre[data-entry-document]").textContent())
          .record.version,
        2,
      );
      await page.getByRole("link", { name: "1", exact: true }).click();
      assert.equal(
        JSON.parse(await page.locator("pre[data-entry-document]").textContent())
          .content.value,
        "I prefer a short summary",
      );

      const fact = (value) => ({
        profile: "https://hcp.example/spec/profiles/general-context/2.0",
        value: {
          type: "urn:context-router:exclusive-fact:v1",
          slot: "contact",
          setting: "work",
          value,
        },
      });
      const body = {
        schema: "https://hcp.example/spec/entry/2.0",
        subject: grant.subject,
        content: fact("email"),
        classification: { categories: ["general_preferences"] },
        assertion: { declarationType: "person-declared" },
        record: { provenance: { source: "person-input" } },
      };
      assert.equal(
        (await f.context("/v2/entries", token, { method: "POST", json: body }))
          .status,
        201,
      );
      const modelBody = {
        ...body,
        standing: { assurance: "authenticated", confirmed: true },
        content: fact("phone"),
        assertion: { declarationType: "model-inferred", confidence: "medium" },
        record: {
          provenance: {
            assertedBy: {
              id: "https://example.test/models/browser-fixture/v1",
              extension: { assurance: "cryptographically-verified" },
            },
            source: "Controlled browser test; no model invocation",
            fixture: { simulated: true, modelExecuted: false },
          },
        },
      };
      const model = await f.context("/v2/entries", token, {
        method: "POST",
        json: modelBody,
        headers: { "idempotency-key": "browser-model" },
      });
      assert.equal(model.status, 201);
      const events = (await f.management(`/v2/audit?grantId=${grant.grantId}`))
        .json.events;
      const id = events.find(
        (e) => e.eventType === "context.created" && e.participants.model,
      ).entryId;
      await page.goto(f.issuer + "/manage/entries/" + encodeURIComponent(id));
      const facts = await page.locator("[data-entry-facts]").innerText();
      assert.match(facts, /Assurance: unverified/);
      assert.match(facts, /Latest confirmation: none/);
      assert.doesNotMatch(
        facts,
        /authenticated|cryptographically-verified|modelExecuted/,
      );
      await page
        .getByText("Full stored document (includes submitted claims)", {
          exact: true,
        })
        .click();
      assert.match(
        await page.locator("[data-raw-entry]").innerText(),
        /do not establish assurance or confirmation/,
      );
      const raw = JSON.parse(
        await page.locator("pre[data-entry-document]").textContent(),
      );
      assert.deepEqual(raw.standing, modelBody.standing);
      assert.deepEqual(
        raw.record.provenance.fixture,
        modelBody.record.provenance.fixture,
      );
      assert.equal(
        JSON.parse(await page.locator("pre[data-entry-document]").textContent())
          .record.status,
        "conflicted",
      );
      await page
        .getByRole("button", { name: "Review confirmation", exact: true })
        .click();
      await page.waitForSelector('body[data-stage="entry-review"]');
      const reviewed = await page.locator("body").innerText();
      assert.ok(reviewed.includes("phone") && reviewed.includes("email"));
      await page
        .getByRole("button", { name: "Confirm this version", exact: true })
        .click();
      await page.waitForSelector('body[data-stage="entry"]');
      const confirmed = JSON.parse(
        await page.locator("pre[data-entry-document]").textContent(),
      );
      assert.equal(confirmed.record.status, "active");
      assert.equal(confirmed.record.version, 1);
      assert.equal(confirmed.assertion.declarationType, "model-inferred");
      assert.equal(
        confirmed.record.provenance.assertedBy.id,
        "https://example.test/models/browser-fixture/v1",
      );
      assert.equal(
        confirmed.record.provenance.confirmations.at(-1).disposition,
        "confirmed",
      );
      assert.match(
        await page.locator("body").innerText(),
        /conflict\.resolved/,
      );
      await page.goto(
        f.issuer + "/manage?grantId=" + encodeURIComponent(grant.grantId),
      );
      await page
        .getByRole("button", { name: "Revoke grant", exact: true })
        .click();
      await page.waitForURL(f.issuer + "/manage?status=all");
      assert.equal(
        (
          await f.context("/v2/entries", token, {
            method: "POST",
            json: modelBody,
            headers: { "idempotency-key": "browser-model" },
          })
        ).status,
        401,
      );
      assert.equal(unexpected.length, 0);
    } finally {
      await context.close();
    }
  },
);
