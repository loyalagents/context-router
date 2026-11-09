// Owned synthetic TLS/client fixture. No personal trust store, profile, data or credentials.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const https = require("node:https");
const { execFileSync } = require("node:child_process");
const { randomBytes, createHash } = require("node:crypto");
const assert = require("node:assert/strict");
const {
  createSyntheticAuthorization,
} = require("../../../dist/composition/hcp-authorization.js");
const {
  ACCESS_TYPE,
  PURPOSES,
} = require("../../../dist/infrastructure/hcp-experiment/policy.js");
const secret = () => randomBytes(32).toString("base64url");
function certificates(directory) {
  const openssl = (args) =>
    execFileSync("openssl", args, { cwd: directory, stdio: "ignore" });
  openssl([
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-sha256",
    "-days",
    "2",
    "-subj",
    "/CN=Owned HCP C2 fixture CA",
    "-keyout",
    "ca.key",
    "-out",
    "ca.pem",
    "-addext",
    "basicConstraints=critical,CA:TRUE",
    "-addext",
    "keyUsage=critical,keyCertSign,cRLSign",
  ]);
  openssl([
    "req",
    "-new",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-subj",
    "/CN=as.hcp.test",
    "-keyout",
    "leaf.key",
    "-out",
    "leaf.csr",
  ]);
  fs.writeFileSync(
    path.join(directory, "extensions"),
    "basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:as.hcp.test,DNS:client-a.hcp.test,DNS:client-b.hcp.test\n",
    { mode: 0o600 },
  );
  openssl([
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
    "2",
    "-sha256",
    "-extfile",
    "extensions",
    "-out",
    "leaf.pem",
  ]);
  for (const file of fs.readdirSync(directory))
    fs.chmodSync(path.join(directory, file), 0o600);
  return {
    key: fs.readFileSync(path.join(directory, "leaf.key")),
    cert: fs.readFileSync(path.join(directory, "leaf.pem")),
    ca: fs.readFileSync(path.join(directory, "ca.pem")),
  };
}
const listen = (server) =>
  new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
const close = (server) =>
  new Promise((resolve) => {
    server.closeAllConnections();
    server.close(resolve);
  });
function request(url, tls, options = {}) {
  return new Promise((resolve, reject) => {
    const headers = { ...options.headers };
    let body;
    if (options.json !== undefined) {
      body = JSON.stringify(options.json);
      headers["content-type"] = "application/json";
    }
    if (options.form !== undefined) {
      body = new URLSearchParams(options.form).toString();
      headers["content-type"] = "application/x-www-form-urlencoded";
    }
    if (body !== undefined) headers["content-length"] = Buffer.byteLength(body);
    const req = https.request(
      url,
      {
        method: options.method ?? "GET",
        headers,
        ca: tls.ca,
        agent: false,
        servername: new URL(url).hostname,
        lookup: (_host, opts, callback) =>
          opts.all
            ? callback(null, [{ address: "127.0.0.1", family: 4 }])
            : callback(null, "127.0.0.1", 4),
      },
      (res) => {
        const chunks = [];
        res.on("data", (b) => chunks.push(b));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString();
          let json;
          try {
            json = JSON.parse(text);
          } catch {}
          resolve({ status: res.statusCode, headers: res.headers, text, json });
        });
      },
    );
    req.on("error", () => reject(new Error("Fixture TLS/request failed")));
    req.end(body);
  });
}
async function fixture(t, options = {}) {
  const sandbox = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "hcp-c2-https-")),
  );
  fs.chmodSync(sandbox, 0o700);
  const certDir = path.join(sandbox, "tls");
  fs.mkdirSync(certDir, { mode: 0o700 });
  const tls = certificates(certDir),
    human = secret(),
    callbacks = [];
  let server;
  t.after(async () => {
    if (server) await server.close();
    await close(callbackServer);
    fs.rmSync(sandbox, { recursive: true });
  });
  const callbackServer = https.createServer(tls, async (req, res) => {
    const host = req.headers.host;
    if (
      !["a", "b"].some(
        (id) => host === `client-${id}.hcp.test:${callbackPort}`,
      ) ||
      req.url !== "/callback" ||
      req.method !== "POST"
    ) {
      res.writeHead(400).end();
      return;
    }
    const chunks = [];
    for await (const b of req) chunks.push(b);
    callbacks.push({ cookie: req.headers.cookie, host });
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify(
        Object.fromEntries(
          new URLSearchParams(Buffer.concat(chunks).toString()),
        ),
      ),
    );
  });
  const callbackPort = await listen(callbackServer);
  const redirects = Object.fromEntries(
    ["a", "b"].map((id) => [
      id,
      `https://client-${id}.hcp.test:${callbackPort}/callback`,
    ]),
  );
  const clients = ["a", "b"].map((id) => ({
    id,
    name: `Controlled client ${id.toUpperCase()}`,
    operator: {
      id: "https://example.test/operators/synthetic",
      name: "Synthetic fixture operator",
    },
    redirectUri: redirects[id],
  }));
  const { childProcess, ...startup } = options;
  const create = childProcess
    ? require("./authorization-child.cjs").childServer
    : createSyntheticAuthorization;
  server = await create(
    { sandbox, root: path.join(sandbox, "experiment") },
    { tls, clients, humanCredential: human, ...startup },
  );
  const f = {
    ...server,
    sandbox,
    tls,
    human,
    redirects,
    clients,
    callbacks,
    request: (route, opts) => request(new URL(route, server.issuer), tls, opts),
    management: (route, opts = {}) =>
      request(new URL(route, server.issuer), tls, {
        ...opts,
        headers: { authorization: `Bearer ${human}`, ...opts.headers },
      }),
    context: (route, token, opts = {}) =>
      request(new URL(route, server.issuer), tls, {
        ...opts,
        headers: { authorization: `Bearer ${token}`, ...opts.headers },
      }),
  };
  return f;
}
const unescape = (s) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
function inputs(text) {
  return Object.fromEntries(
    [
      ...text.matchAll(/<input[^>]*name="([^"]+)"[^>]*value="([^"]*)"[^>]*>/g),
    ].map((m) => [unescape(m[1]), unescape(m[2])]),
  );
}
class OAuthDriver {
  constructor(f, client) {
    this.f = f;
    this.client = client;
    this.jar = new Map();
  }
  async request(route, options = {}) {
    const r = await this.f.request(route, {
      ...options,
      headers: {
        cookie: [...this.jar].map(([k, v]) => `${k}=${v}`).join("; "),
        ...options.headers,
      },
    });
    for (const cookie of r.headers["set-cookie"] ?? []) {
      const [pair] = cookie.split(";");
      const i = pair.indexOf("=");
      this.jar.set(pair.slice(0, i), pair.slice(i + 1));
    }
    return r;
  }
  async follow(r) {
    for (let i = 0; i < 15 && r.headers.location; i++) {
      const next = new URL(r.headers.location, this.f.issuer);
      assert.equal(next.origin, this.f.issuer);
      this.interactionPath = next.pathname;
      r = await this.request(next.pathname + next.search);
    }
    this.stage = /data-stage="([^"]+)"/.exec(r.text)?.[1];
    this.page = r;
    return r;
  }
  async begin({ scopeOnly = false, patch = {}, expectFailure = false } = {}) {
    this.verifier = secret();
    this.state = secret();
    this.scopeOnly = scopeOnly;
    const params = {
      client_id: this.client,
      redirect_uri: this.f.redirects[this.client],
      response_type: "code",
      response_mode: "form_post",
      resource: this.f.issuer,
      state: this.state,
      code_challenge: createHash("sha256")
        .update(this.verifier)
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
      ...patch,
    };
    for (const k of Object.keys(params))
      if (params[k] === null) delete params[k];
    const r = await this.request("/auth?" + new URLSearchParams(params));
    return expectFailure ? r : this.follow(r);
  }
  async login() {
    assert.equal(this.stage, "login");
    return this.follow(
      await this.request(this.interactionPath + "/login", {
        method: "POST",
        headers: { origin: this.f.issuer },
        form: { ...inputs(this.page.text), credential: this.f.human },
      }),
    );
  }
  async review(selection = {}) {
    assert.equal(this.stage, "consent");
    this.page = await this.request(this.interactionPath + "/review", {
      method: "POST",
      headers: { origin: this.f.issuer },
      form: {
        csrf: inputs(this.page.text).csrf,
        ...(this.scopeOnly ? { purposes: PURPOSES[0].code } : {}),
        ...selection,
      },
    });
    assert.equal(this.page.status, 200);
    this.reviewed = inputs(this.page.text);
    return this.reviewed;
  }
  async approve(patch = {}) {
    return this.follow(
      await this.request(this.interactionPath + "/approve", {
        method: "POST",
        headers: { origin: this.f.issuer },
        form: { ...this.reviewed, ...patch },
      }),
    );
  }
  async consent(selection) {
    await this.review(selection);
    await this.capture(await this.approve());
  }
  async capture(response) {
    assert.equal(response.status, 200);
    const action = unescape(
      /<form[^>]*action="([^"]+)"/.exec(response.text)?.[1] ?? "",
    );
    assert.equal(action, this.f.redirects[this.client]);
    const callback = await request(action, this.f.tls, {
      method: "POST",
      form: inputs(response.text),
    });
    assert.equal(callback.json.state, this.state);
    assert.equal(callback.json.iss, this.f.issuer);
    assert.equal(typeof callback.json.code, "string");
    this.code = callback.json.code;
  }
  async exchange(patch = {}) {
    const form = {
      grant_type: "authorization_code",
      client_id: this.client,
      code: this.code,
      code_verifier: this.verifier,
      redirect_uri: this.f.redirects[this.client],
      resource: this.f.issuer,
      ...patch,
    };
    for (const k of Object.keys(form)) if (form[k] === null) delete form[k];
    return this.f.request("/token", { method: "POST", form });
  }
  async consentAndExchange(selection) {
    await this.consent(selection);
    return this.exchange();
  }
}
module.exports = { fixture, OAuthDriver, certificates, request, inputs };
