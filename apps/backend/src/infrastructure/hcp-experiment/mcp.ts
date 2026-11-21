/** Bounded synthetic read adapter; no SDK response queue after authorization. */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AuthorizationRepository } from "./authority";
import { AuthorityError, invalid, object } from "./policy";
import { ReadScopeError } from "./disclosure";
import { requestJson, RequestJsonError } from "./request-json";
import {
  MCP_VERSION,
  READ_TOOLS,
  SERVER_META,
  serializeTool,
  type ReadTool,
} from "./mcp-contract";

class ProtocolFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: number,
    readonly detail: string,
    readonly data?: any,
  ) {
    super(detail);
  }
}
const protocol = (
  status: number,
  code: number,
  detail: string,
  data?: any,
): never => {
  throw new ProtocolFailure(status, code, detail, data);
};
function header(req: IncomingMessage, name: string): string | undefined {
  if (
    req.rawHeaders.filter((v, i) => i % 2 === 0 && v.toLowerCase() === name)
      .length > 1
  )
    protocol(400, -32020, "Invalid request headers.");
  const value = req.headers[name];
  if (Array.isArray(value)) protocol(400, -32020, "Invalid request headers.");
  return value as string | undefined;
}
function nameHeader(value: string | undefined): string | undefined {
  if (!value?.startsWith("=?base64?")) return value;
  const match = /^=\?base64\?([A-Za-z0-9+/]*={0,2})\?=$/.exec(value);
  if (!match) protocol(400, -32020, "Invalid request headers.");
  const bytes = Buffer.from(match![1], "base64");
  if (bytes.toString("base64") !== match![1])
    protocol(400, -32020, "Invalid request headers.");
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return protocol(400, -32020, "Invalid request headers.");
  }
}
const only = (value: any, names: string[]) =>
  object(value) && Object.keys(value).every((k) => names.includes(k));
// HTTP quoted-string escaping only. Encode complete Unicode sequences as UTF-8;
// lone surrogates use UTF-8's replacement character in this denial hint only.
const quote = (value: string) =>
  value
    .replace(/[^\x20-\x7e]+/gu, (c) =>
      encodeURIComponent(Buffer.from(c, "utf8").toString("utf8")),
    )
    .replace(/["\\]/g, "\\$&");

export function mcpHandler(authority: AuthorizationRepository) {
  const issuer = authority.configuration.issuer,
    host = new URL(issuer).host;
  // Fixed registered-client keys bound memory; a new grant/token cannot reset a bucket.
  const buckets = new Map<string, { start: number; calls: number }>();
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    let id: string | number | undefined, tool: ReadTool | undefined;
    const send = (status: number, value: any) => {
      const bytes = JSON.stringify(value);
      res.statusCode = status;
      res.setHeader("content-type", "application/json");
      res.end(bytes);
    };
    const coreError = (type: string, detail: string) => {
      const bytes = serializeTool(id!, tool!, { type, detail }, true);
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(bytes);
    };
    try {
      if (
        req.url !== "/v2/mcp" ||
        header(req, "host") !== host ||
        Object.keys(req.headers).some(
          (h) => h === "forwarded" || h.startsWith("x-forwarded-"),
        )
      )
        protocol(400, -32600, "Invalid endpoint request.");
      const origin = header(req, "origin");
      if (origin !== undefined && origin !== issuer)
        protocol(403, -32600, "Origin not permitted.");
      if (req.method !== "POST") {
        res.setHeader("allow", "POST");
        protocol(405, -32600, "POST required.");
      }
      const accepted = (header(req, "accept") ?? "")
        .split(",")
        .flatMap((value) => {
          const [media, ...parameters] = value
            .trim()
            .toLowerCase()
            .split(";")
            .map((part) => part.trim());
          let quality = 1;
          const seen = new Set<string>();
          for (const parameter of parameters) {
            const match = /^q\s*=\s*(0(?:\.[0-9]{0,3})?|1(?:\.0{0,3})?)$/.exec(
              parameter,
            );
            if (!match || seen.has("q")) return [];
            seen.add("q");
            quality = Number(match[1]);
          }
          return quality > 0 ? [media] : [];
        });
      if (
        !accepted.includes("application/json") ||
        !accepted.includes("text/event-stream")
      )
        protocol(406, -32600, "JSON and event-stream acceptance required.");
      const message = await requestJson(req);
      if (
        !only(message, ["jsonrpc", "id", "method", "params"]) ||
        message.jsonrpc !== "2.0" ||
        !(typeof message.id === "string" || Number.isSafeInteger(message.id)) ||
        typeof message.method !== "string"
      )
        protocol(400, -32600, "Invalid MCP request.");
      id = message.id;
      const params = message.params,
        meta = params?._meta;
      if (
        !object(params) ||
        !object(meta) ||
        typeof meta["io.modelcontextprotocol/protocolVersion"] !== "string" ||
        !object(meta["io.modelcontextprotocol/clientCapabilities"]) ||
        (meta["io.modelcontextprotocol/clientInfo"] !== undefined &&
          (!object(meta["io.modelcontextprotocol/clientInfo"]) ||
            typeof meta["io.modelcontextprotocol/clientInfo"].name !==
              "string" ||
            typeof meta["io.modelcontextprotocol/clientInfo"].version !==
              "string"))
      )
        protocol(400, -32602, "Invalid request metadata.");
      const version = meta["io.modelcontextprotocol/protocolVersion"];
      if (
        header(req, "mcp-protocol-version") !== version ||
        header(req, "mcp-method") !== message.method ||
        (message.method === "tools/call" &&
          nameHeader(header(req, "mcp-name")) !== params.name)
      )
        protocol(400, -32020, "Request headers do not match the body.");
      if (version !== MCP_VERSION)
        protocol(400, -32022, "Unsupported protocol version.", {
          supported: [MCP_VERSION],
          requested: version,
        });
      if (
        !["server/discover", "tools/list", "tools/call"].includes(
          message.method,
        )
      )
        protocol(404, -32601, "Method not found.");
      if (message.method === "server/discover") {
        if (!only(params, ["_meta"]))
          protocol(400, -32602, "Invalid discovery request.");
        return send(200, {
          jsonrpc: "2.0",
          id,
          result: {
            resultType: "complete",
            supportedVersions: [MCP_VERSION],
            capabilities: {
              tools: {},
              extensions: {
                "example.hcp/hcp": {
                  discovery: issuer + "/experiment/capabilities",
                  conformsTo: [],
                },
              },
            },
            ttlMs: 0,
            cacheScope: "private",
            _meta: SERVER_META,
          },
        });
      }
      const credential = /^Bearer ([A-Za-z0-9_-]+)$/.exec(
        header(req, "authorization") ?? "",
      )?.[1];
      if (req.headers.cookie || !credential)
        throw new AuthorityError("unauthenticated");
      const token = authority.protocolFind("AccessToken", credential);
      if (!token) throw new AuthorityError("unauthenticated");
      if (message.method === "tools/list") {
        if (!only(params, ["_meta"]))
          protocol(400, -32602, "Invalid tool-list request.");
        const bytes = JSON.stringify({
          jsonrpc: "2.0",
          id,
          result: {
            resultType: "complete",
            tools: READ_TOOLS,
            ttlMs: 0,
            cacheScope: "private",
            _meta: SERVER_META,
          },
        });
        if (!authority.protocolFind("AccessToken", credential))
          throw new AuthorityError("unauthenticated");
        res.statusCode = 200;
        res.setHeader("content-type", "application/json");
        res.end(bytes);
        return;
      }
      if (
        !only(params, ["_meta", "name", "arguments"]) ||
        typeof params.name !== "string" ||
        (params.arguments !== undefined && !object(params.arguments))
      )
        protocol(400, -32602, "Invalid tool call.");
      if (!READ_TOOLS.some((t) => t.name === params.name))
        protocol(400, -32602, "Unknown tool.");
      tool = params.name;
      const tick = performance.now();
      let bucket = buckets.get(token.clientId);
      if (!bucket || tick - bucket.start >= 60_000) {
        bucket = { start: tick, calls: 0 };
        buckets.set(token.clientId, bucket);
      }
      if (++bucket.calls > 60)
        return coreError("rate-limited", "Tool invocation limit reached.");
      const input = params.arguments ?? {},
        isQuery = tool === "hcp_queryContext";
      let request = input,
        ref: string | undefined;
      if (!isQuery) {
        if (typeof input.ref !== "string" || !input.ref) invalid();
        ({ ref, ...request } = input);
      }
      let ticket: object;
      try {
        ticket = await authority.prepareRead(
          credential,
          isQuery ? "query" : "get",
          request,
          ref,
        );
      } catch (error) {
        if (error instanceof ReadScopeError) {
          const scope = error.scopes.length
            ? `, scope="${quote(error.scopes.join(" "))}"`
            : "";
          const description = error.purpose
            ? `, error_description="Purpose not approved: ${quote(error.purpose)}"`
            : "";
          res.setHeader(
            "www-authenticate",
            `Bearer resource_metadata="${issuer}/.well-known/oauth-protected-resource", error="insufficient_scope"${scope}${description}`,
          );
          return send(403, { error: "insufficient_scope" });
        }
        throw error;
      }
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      authority.releaseRead(
        ticket,
        (bytes) => {
          res.end(bytes);
        },
        (result) => serializeTool(id!, tool!, result),
      );
    } catch (error) {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      if (error instanceof AuthorityError) {
        if (error.kind === "unauthenticated") {
          res.setHeader(
            "www-authenticate",
            `Bearer resource_metadata="${issuer}/.well-known/oauth-protected-resource"`,
          );
          return send(401, { error: "invalid_token" });
        }
        if (tool)
          return coreError(
            error.kind === "invalid" ? "malformed-request" : "scope-denied",
            error.kind === "invalid"
              ? "Invalid HCP request."
              : "Entry not available under this grant.",
          );
      }
      const failure =
        error instanceof ProtocolFailure
          ? error
          : error instanceof RequestJsonError
            ? new ProtocolFailure(
                error.kind === "media"
                  ? 415
                  : error.kind === "size"
                    ? 413
                    : 400,
                error.kind === "parse" ? -32700 : -32600,
                "Invalid JSON request.",
              )
            : new ProtocolFailure(500, -32603, "Internal server error.");
      send(failure.status, {
        jsonrpc: "2.0",
        ...(id === undefined ? {} : { id }),
        error: {
          code: failure.code,
          message: failure.detail,
          ...(failure.data ? { data: failure.data } : {}),
        },
      });
    }
  };
}
