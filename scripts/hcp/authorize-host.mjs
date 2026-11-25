// Owned C7b human Code+PKCE callback. Never logs in or consents for the human.
import https from "node:https";
import { randomBytes, createHash } from "node:crypto";
import { ACCESS, callbackCode, validateGrant } from "./trial-protocol.mjs";

export async function sourceJson(source, route, { form, token } = {}) {
  const body = form && new URLSearchParams(form).toString();
  return new Promise((resolve, reject) => {
    const fail = () =>
      reject(new Error("C7b source exchange refused; no retry attempted"));
    const req = https.request(
      new URL(route, source.descriptor.configuration.issuer),
      {
        method: form ? "POST" : "GET",
        ca: source.tls.ca,
        agent: false,
        timeout: 10_000,
        lookup: (_h, opts, cb) =>
          opts.all
            ? cb(null, [{ address: "127.0.0.1", family: 4 }])
            : cb(null, "127.0.0.1", 4),
        headers: {
          ...(form
            ? {
                "content-type": "application/x-www-form-urlencoded",
                "content-length": Buffer.byteLength(body),
              }
            : {}),
          ...(token ? { authorization: "Bearer " + token } : {}),
        },
      },
      async (res) => {
        try {
          if (res.statusCode !== 200) throw new Error();
          let size = 0;
          const chunks = [];
          for await (const chunk of res) {
            size += chunk.length;
            if (size > 65536) throw new Error();
            chunks.push(chunk);
          }
          if (!res.complete) throw new Error();
          resolve(
            JSON.parse(
              new TextDecoder("utf-8", { fatal: true }).decode(
                Buffer.concat(chunks),
              ),
            ),
          );
        } catch {
          res.destroy();
          fail();
        }
      },
    );
    req.once("timeout", () => req.destroy());
    req.once("error", fail);
    req.end(body);
  });
}
export async function openAuthorization(source) {
  if (source.descriptor.profile?.profile !== "claude-code")
    throw new Error("C7b source profile required");
  const { issuer, clients } = source.descriptor.configuration;
  const client = clients[0],
    callback = new URL(client.redirectUri);
  const verifier = randomBytes(32).toString("base64url"),
    state = randomBytes(32).toString("base64url");
  const url =
    issuer +
    "/auth?" +
    new URLSearchParams({
      client_id: client.id,
      redirect_uri: client.redirectUri,
      response_type: "code",
      response_mode: "form_post",
      resource: issuer,
      state,
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
      authorization_details: JSON.stringify([ACCESS]),
    });
  let accept,
    reject,
    consumed = false,
    closed = false;
  const wait = new Promise((r, j) => {
    accept = r;
    reject = j;
  });
  void wait.catch(() => {});
  const fail = () => {
    consumed = true;
    reject(
      new Error(
        "C7b human authorization refused; preserve the grant for explicit inspection/revocation",
      ),
    );
  };
  const deadline = setTimeout(fail, 300_000);
  const server = https.createServer(
    { ...source.tls, requestTimeout: 10_000, headersTimeout: 5000 },
    async (req, res) => {
      res.setHeader("cache-control", "no-store");
      res.setHeader("content-security-policy", "default-src 'none'");
      res.setHeader("referrer-policy", "no-referrer");
      if (consumed) {
        res.writeHead(400).end("Authorization closed.");
        return;
      }
      try {
        const names = req.rawHeaders
          .filter((_v, i) => i % 2 === 0)
          .map((v) => v.toLowerCase());
        if (new Set(names).size !== names.length) throw new Error();
        let size = 0;
        const chunks = [];
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 8192) throw new Error();
          chunks.push(chunk);
        }
        if (consumed) throw new Error();
        const code = callbackCode({
          method: req.method,
          url: req.url,
          headers: req.headers,
          body: new TextDecoder("utf-8", { fatal: true }).decode(
            Buffer.concat(chunks),
          ),
          issuer,
          callback: client.redirectUri,
          state,
        });
        consumed = true;
        clearTimeout(deadline); // Single transition before any asynchronous exchange.
        const token = await sourceJson(source, "/token", {
          form: {
            grant_type: "authorization_code",
            client_id: client.id,
            code,
            code_verifier: verifier,
            redirect_uri: client.redirectUri,
            resource: issuer,
          },
        });
        const own = await sourceJson(source, "/v2/grants", {
          token: token.access_token,
        });
        const grantId = validateGrant(token, own);
        res
          .writeHead(200, { "content-type": "text/plain" })
          .end("Temporary C7b grant accepted. Return to the trial terminal.");
        accept({
          token: token.access_token,
          grantId,
          secrets: [verifier, state, code, token.access_token],
        });
      } catch {
        fail();
        if (!res.destroyed)
          res
            .writeHead(400)
            .end("Authorization refused. Inspect the grant in management.");
      }
    },
  );
  try {
    await new Promise((r, j) => {
      server.once("error", j);
      server.listen(Number(callback.port), "127.0.0.1", r);
    });
  } catch {
    clearTimeout(deadline);
    fail();
    throw new Error("C7b callback port refused");
  }
  return {
    url,
    wait,
    async close() {
      if (closed) return;
      closed = true;
      clearTimeout(deadline);
      fail();
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
    },
  };
}
