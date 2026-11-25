// Strict C7b helper contracts. No network or credential discovery on import.
import { isDeepStrictEqual } from "node:util";
import { createRequire } from "node:module";
import { TOOLS } from "./host-boundary.mjs";
const { parseRequestJson } = createRequire(import.meta.url)(
  "../../apps/backend/dist/infrastructure/hcp-experiment/request-json.js",
);
export const PURPOSE = "https://example.test/purpose/synthetic-review";
export const ACCESS = {
  type: "https://hcp.example/spec/authorization/context-access",
  actions: ["read"],
  categories: ["general_preferences"],
  purposes: [
    { code: PURPOSE, description: "Review the synthetic person's preferences" },
  ],
};
export const TRIAL_PROMPTS = [
  'This is a synthetic HCP trial. Call hcp_queryContext once with query "concise written summary", categories ["general_preferences"], purpose "https://example.test/purpose/synthetic-review", maxEntries 1. Then call hcp_getEntry once using the returned ref and the same purpose. Summarize the result. Do not call other tools or retry a failed call.',
  'Call hcp_queryContext once with query "project codename", categories ["work_context"], purpose "https://example.test/purpose/synthetic-review", maxEntries 1. Report the denial. Do not retry, reconnect, request authorization, or infer the withheld value.',
  'Make one new hcp_queryContext request for "concise written summary" in ["general_preferences"] with purpose "https://example.test/purpose/synthetic-review". Report whether access was denied. Do not retry or request authorization. Do not reuse earlier results as evidence of current access.',
];
const refuse = () => {
  throw new Error("C7b protocol boundary refused; no recovery attempted");
};
export function callbackCode({
  method,
  url,
  headers,
  body,
  issuer,
  callback,
  state,
}) {
  const expected = new URL(callback);
  if (
    method !== "POST" ||
    url !== expected.pathname ||
    headers.host !== expected.host ||
    headers.origin !== issuer ||
    headers.cookie !== undefined ||
    headers["content-type"] !== "application/x-www-form-urlencoded" ||
    Buffer.byteLength(body) > 8192 ||
    /%(?![0-9a-fA-F]{2})/.test(body)
  )
    refuse();
  const values = new URLSearchParams(body),
    keys = [...values.keys()];
  if (
    !isDeepStrictEqual(keys.slice().sort(), ["code", "iss", "state"]) ||
    values.get("state") !== state ||
    values.get("iss") !== issuer ||
    !/^[A-Za-z0-9_-]{1,2048}$/.test(values.get("code") ?? "")
  )
    refuse();
  return values.get("code");
}
export function validateGrant(token, own, now = Date.now()) {
  const scope = "hcp:general_preferences:read";
  if (
    !token ||
    typeof token.access_token !== "string" ||
    token.access_token.length < 8 ||
    token.token_type !== "Bearer" ||
    token.refresh_token !== undefined ||
    !Number.isInteger(token.expires_in) ||
    token.expires_in <= 0 ||
    token.expires_in > 900 ||
    token.scope !== scope ||
    own?.grants?.length !== 1 ||
    !Array.isArray(own.directives)
  )
    refuse();
  const grant = own.grants[0],
    end = Date.parse(grant.expiresAt),
    start = Date.parse(grant.issuedAt);
  if (
    grant.client?.id !== "claude-code-c7b" ||
    grant.status !== "active" ||
    grant.grantType !== "temporary" ||
    !Number.isFinite(end) ||
    !Number.isFinite(start) ||
    start > now ||
    end <= now ||
    end - now > 900000 ||
    end - start > 900000 ||
    !isDeepStrictEqual(grant.scopes, [scope]) ||
    !isDeepStrictEqual(grant.access, [ACCESS])
  )
    refuse();
  return grant.grantId;
}
const allowedHeaders = new Set([
  "accept",
  "content-type",
  "user-agent",
  "x-claude-code-session-id",
  "x-stainless-arch",
  "x-stainless-lang",
  "x-stainless-os",
  "x-stainless-package-version",
  "x-stainless-retry-count",
  "x-stainless-runtime",
  "x-stainless-runtime-version",
  "x-stainless-timeout",
  "anthropic-beta",
  "anthropic-dangerous-direct-browser-access",
  "anthropic-version",
  "x-app",
  "connection",
  "host",
  "accept-encoding",
  "content-length",
  "authorization",
]);
export function assertNoSecrets(value, secrets) {
  const walk = (v) => {
    if (typeof v === "string") {
      if (secrets.some((s) => s && v.includes(s))) refuse();
    } else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object")
      for (const [k, item] of Object.entries(v)) {
        walk(k);
        walk(item);
      }
  };
  walk(value);
}
export function validateModelStream(text, secrets) {
  const normalized = text.replaceAll("\r\n", "\n");
  if (normalized.includes("\r") || !normalized.endsWith("\n\n")) refuse();
  let state = "initial",
    nextIndex = 0,
    openIndex = null,
    stopReason;
  for (const frame of normalized.split("\n\n")) {
    const lines = frame
      .split("\n")
      .filter((line) => line && !line.startsWith(":"));
    if (!lines.length) continue;
    const names = lines.filter((line) => line.startsWith("event:"));
    const data = lines.filter((line) => line.startsWith("data:"));
    if (
      names.length !== 1 ||
      data.length === 0 ||
      names.length + data.length !== lines.length
    )
      refuse();
    const name = names[0].slice(6).trim();
    const value = parseRequestJson(
      data.map((line) => line.slice(5).replace(/^ /, "")).join("\n"),
    );
    assertNoSecrets(value, secrets);
    if (value.type !== name || state === "stopped") refuse();
    if (name === "ping") continue;
    if (name === "message_start") {
      if (
        state !== "initial" ||
        value.message?.model !== "claude-sonnet-4-6" ||
        !isDeepStrictEqual(value.message.content, [])
      )
        refuse();
      state = "content";
    } else if (name === "content_block_start") {
      if (
        state !== "content" ||
        openIndex !== null ||
        value.index !== nextIndex ||
        !["text", "tool_use", "thinking", "redacted_thinking"].includes(
          value.content_block?.type,
        )
      )
        refuse();
      openIndex = nextIndex++;
    } else if (name === "content_block_delta") {
      if (
        state !== "content" ||
        openIndex === null ||
        value.index !== openIndex ||
        !value.delta
      )
        refuse();
    } else if (name === "content_block_stop") {
      if (
        state !== "content" ||
        openIndex === null ||
        value.index !== openIndex
      )
        refuse();
      openIndex = null;
    } else if (name === "message_delta") {
      if (
        !["content", "delta"].includes(state) ||
        openIndex !== null ||
        !value.delta
      )
        refuse();
      state = "delta";
      if (value.delta.stop_reason !== undefined)
        stopReason = value.delta.stop_reason;
    } else if (name === "message_stop") {
      if (
        state !== "delta" ||
        !["end_turn", "tool_use", "refusal"].includes(stopReason)
      )
        refuse();
      state = "stopped";
    } else refuse();
  }
  if (state !== "stopped") refuse();
}
export function guardModelRequest(
  { method, url, headers, body },
  localToken,
  secrets,
) {
  if (
    method !== "POST" ||
    !["/v1/messages", "/v1/messages?beta=true"].includes(url) ||
    headers.authorization !== "Bearer " + localToken ||
    headers["content-type"] !== "application/json" ||
    Object.keys(headers).some((k) => !allowedHeaders.has(k)) ||
    Buffer.byteLength(body) > 2 ** 20 ||
    (headers["x-stainless-retry-count"] !== undefined &&
      headers["x-stainless-retry-count"] !== "0")
  )
    refuse();
  const otherHeaders = { ...headers };
  delete otherHeaders.authorization;
  assertNoSecrets([otherHeaders, body], secrets);
  const parsed = parseRequestJson(body);
  assertNoSecrets(parsed, secrets);
  if (
    parsed.model !== "claude-sonnet-4-6" ||
    parsed.stream !== true ||
    !Array.isArray(parsed.messages) ||
    !Array.isArray(parsed.tools) ||
    parsed.tools.some((t) => !TOOLS.includes(t.name))
  )
    refuse();
  return parsed;
}
