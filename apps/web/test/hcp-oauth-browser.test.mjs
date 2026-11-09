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
} = require("../../backend/test/local-database/hcp-experiment/authorization-fixture.cjs");
const {
  ACCESS_TYPE,
  PURPOSES,
} = require("../../backend/dist/infrastructure/hcp-experiment/policy.js");
const root = path.resolve(import.meta.dirname, "../../..");
const secret = () => randomBytes(32).toString("base64url");

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

test(
  "C2 browser verifies isolated CA/hostname/expiry and performs real consent, callbacks, history and revoke",
  { timeout: 120_000 },
  async (t) => {
    const f = await fixture(t);
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
        const before = (await f.management("/v2/grants")).json.grants.length;
        if (scopeOnly)
          await page
            .getByLabel("Choose a purpose")
            .selectOption(PURPOSES[0].code);
        assert.match(await page.locator("body").innerText(), /own use-until/);
        await page.getByRole("button", { name: "Review exact grant" }).click();
        await page.waitForSelector('body[data-stage="review"]');
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
      await page.goto(f.issuer + "/manage");
      assert.equal(await page.locator("article").count(), 3);
      await page.goto(
        f.issuer + "/manage?grantId=" + encodeURIComponent(grantId),
      );
      assert.match(await page.locator("body").innerText(), /grant\.issued/);
      assert.doesNotMatch(
        await page.locator("body").innerText(),
        /context\.read/,
      );
      await page
        .getByRole("button", { name: "Revoke grant", exact: true })
        .click();
      await page.waitForURL(f.issuer + "/manage?status=all");
      assert.equal((await f.context("/v2/grants", a1)).status, 401);
      assert.equal((await f.context("/v2/grants", a2)).status, 200);
      assert.equal((await f.context("/v2/grants", b)).status, 200);
      const history = (await f.management("/v2/audit")).json.events;
      assert.ok(
        history
          .filter((e) => e.eventType === "grant.issued")
          .every((e) => e.data.modality === "browser"),
      );
      assert.equal(unexpected.length, 0);
    } finally {
      await context.close();
    }
  },
);
