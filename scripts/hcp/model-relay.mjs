// C7b messages-only loopback relay. No retry, discovery, refresh or redirect.
import http from "node:http";
import https from "node:https";
import { createHash } from "node:crypto";
import {
  guardModelRequest,
  assertNoSecrets,
  validateModelStream,
} from "./trial-protocol.mjs";

async function bounded(stream, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of stream) {
    size += chunk.length;
    if (size > limit) throw new Error("C7b body limit");
    chunks.push(chunk);
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(
    Buffer.concat(chunks),
  );
}
export async function startModelRelay({
  subscription,
  localToken,
  secrets,
  upstream = { origin: "https://api.anthropic.com" },
  onStop = () => {},
}) {
  const destination = new URL(upstream.origin);
  if (
    destination.protocol !== "https:" ||
    destination.origin !== upstream.origin ||
    !["api.anthropic.com", "as.hcp.test", "localhost"].includes(
      destination.hostname,
    )
  )
    throw new Error("C7b relay destination refused");
  const allSecrets = [...secrets, subscription, localToken];
  const receipt = { latched: false, requests: [], upstreamSends: 0 };
  const seen = new Set(),
    sockets = new Set(),
    upstreamRequests = new Set();
  let busy = false;
  const stop = () => {
    if (receipt.latched) return;
    receipt.latched = true;
    for (const req of upstreamRequests) req.destroy();
    onStop();
  };
  const server = http.createServer(
    { requestTimeout: 15_000, headersTimeout: 10_000 },
    async (req, res) => {
      if (receipt.latched) {
        res.writeHead(502).end();
        return;
      }
      if (busy) {
        stop();
        res.writeHead(502).end();
        return;
      }
      busy = true;
      let completed = false;
      const deadline = setTimeout(() => {
        stop();
        req.destroy();
        res.destroy();
      }, 60_000);
      res.once("close", () => {
        if (!completed || !res.writableFinished) stop();
      });
      try {
        const names = req.rawHeaders
          .filter((_v, i) => i % 2 === 0)
          .map((v) => v.toLowerCase());
        if (new Set(names).size !== names.length)
          throw new Error("Duplicate header");
        const body = await bounded(req, 2 ** 20);
        const parsed = guardModelRequest(
          { method: req.method, url: req.url, headers: req.headers, body },
          localToken,
          allSecrets,
        );
        const digest = createHash("sha256").update(body).digest("hex");
        if (receipt.latched || seen.has(digest) || receipt.upstreamSends >= 12)
          throw new Error("Retry or turn bound");
        seen.add(digest);
        const headers = {
          ...req.headers,
          authorization: "Bearer " + subscription,
          host: destination.host,
          "accept-encoding": "identity",
          "content-length": Buffer.byteLength(body),
          connection: "close",
        };
        // Reconstructed from an allowlisted header set; no client destination/auth choice.
        receipt.upstreamSends++;
        const response = await new Promise((resolve, reject) => {
          const request = https.request(
            new URL(req.url, destination),
            {
              method: "POST",
              headers,
              ca: upstream.ca,
              lookup: upstream.lookup,
              agent: false,
              timeout: 45_000,
            },
            async (response) => {
              try {
                if (
                  response.statusCode !== 200 ||
                  !/^text\/event-stream(?:;|$)/.test(
                    response.headers["content-type"] ?? "",
                  ) ||
                  (response.headers["content-encoding"] &&
                    response.headers["content-encoding"] !== "identity")
                )
                  throw new Error("Upstream response refused");
                const text = await bounded(response, 2 ** 22);
                if (!response.complete)
                  throw new Error("Incomplete upstream response");
                assertNoSecrets(text, allSecrets);
                validateModelStream(text, allSecrets);
                resolve(text);
              } catch {
                response.destroy();
                reject(new Error("Unconfirmed upstream response"));
              }
            },
          );
          upstreamRequests.add(request);
          request.once("close", () => upstreamRequests.delete(request));
          request.once("timeout", () =>
            request.destroy(new Error("Upstream timeout")),
          );
          request.once("error", () =>
            reject(new Error("Upstream transport failed")),
          );
          request.end(body);
        });
        if (receipt.latched || res.destroyed)
          throw new Error("Delivery interrupted");
        receipt.requests.push({
          digest,
          model: parsed.model,
          messages: parsed.messages,
          tools: parsed.tools.map((t) => t.name),
        });
        completed = true;
        res
          .writeHead(200, {
            "content-type": "text/event-stream",
            "cache-control": "no-store",
          })
          .end(response);
      } catch {
        stop();
        if (!res.destroyed) res.writeHead(502).end();
      } finally {
        clearTimeout(deadline);
        busy = false;
      }
    },
  );
  server.on("connection", (s) => {
    sockets.add(s);
    s.once("close", () => sockets.delete(s));
  });
  server.on("clientError", (_error, socket) => {
    stop();
    socket.destroy();
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    receipt,
    cancel: stop,
    async close() {
      for (const req of upstreamRequests) req.destroy();
      for (const s of sockets) s.destroy();
      await new Promise((r) => server.close(r));
    },
  };
}
