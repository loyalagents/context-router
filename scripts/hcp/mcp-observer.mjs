// Bounded evidence from this process's owned provider. Bodies/refs stay ephemeral.
import { subscribe, unsubscribe } from "node:diagnostics_channel";
import { createRequire } from "node:module";
import { isDeepStrictEqual as equal } from "node:util";
import { PURPOSE } from "./trial-protocol.mjs";
const require = createRequire(import.meta.url);
const {
  assertReadResult,
} = require("../../apps/backend/dist/infrastructure/hcp-experiment/core-contract.js");
const {
  parseRequestJson,
} = require("../../apps/backend/dist/infrastructure/hcp-experiment/request-json.js");
const VERSION = "2026-07-28";
const METHODS = ["server/discover", "tools/list", "tools/call"];
const TOOLS = ["hcp_queryContext", "hcp_getEntry"];
const object = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const only = (v, keys) =>
  object(v) && Object.keys(v).every((k) => keys.includes(k));
const validId = (v) => typeof v === "string" || Number.isSafeInteger(v);
function capture(limit) {
  let chunks = [],
    size = 0,
    invalid = false;
  return {
    append(chunk, encoding) {
      if (invalid || chunk === undefined || typeof chunk === "function") return;
      try {
        const bytes = Buffer.from(
          chunk,
          typeof encoding === "string" ? encoding : undefined,
        );
        size += bytes.length;
        if (size > limit) throw new Error("Capture limit");
        chunks.push(bytes);
      } catch {
        invalid = true;
        chunks = [];
      }
    },
    parse() {
      if (invalid) throw new Error("Invalid capture");
      return parseRequestJson(
        new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)),
      );
    },
    clear() {
      invalid = true;
      chunks = [];
    },
  };
}
function requestKind(tool, args) {
  if (tool === "hcp_getEntry")
    return only(args, ["ref", "purpose"]) &&
      typeof args.ref === "string" &&
      args.purpose === PURPOSE
      ? "get"
      : "unexpected";
  if (
    !only(args, ["query", "categories", "purpose", "maxEntries"]) ||
    args.purpose !== PURPOSE ||
    ![undefined, 1].includes(args.maxEntries)
  )
    return "unexpected";
  if (
    args.query === "concise written summary" &&
    equal(args.categories, ["general_preferences"])
  )
    return "read-query";
  if (
    args.query === "project codename" &&
    equal(args.categories, ["work_context"]) &&
    args.maxEntries === 1
  )
    return "scope-query";
  return "unexpected";
}
function expectedEntry(entry) {
  return (
    entry?.version === 1 &&
    equal(entry.content, {
      profile: "https://hcp.example/spec/profiles/general-context/2.0",
      value: "Synthetic C7b persona prefers a concise written summary.",
      language: "en",
    }) &&
    equal(entry.assertion, {
      declarationType: "person-declared",
      permittedPurposes: [PURPOSE],
    }) &&
    equal(entry.classification, {
      categories: ["general_preferences"],
      permittedPurposes: [PURPOSE],
    })
  );
}
export function observeMcp(issuer, onEvent = () => {}) {
  const host = new URL(issuer).host,
    events = [],
    pending = new Set();
  let queryRef;
  const listener = ({ request, response }) => {
    if (request.headers.host !== host || request.url !== "/v2/mcp") return;
    const input = capture(32768),
      output = capture(2 ** 20);
    let done = false,
      depth = 0;
    request.on("data", (chunk) => input.append(chunk));
    for (const name of ["write", "end"]) {
      const original = response[name];
      response[name] = function (...args) {
        // end may delegate to write. Copy bytes once without changing delivery.
        if (depth === 0) output.append(args[0], args[1]);
        depth++;
        try {
          return Reflect.apply(original, this, args);
        } finally {
          depth--;
        }
      };
    }
    const finish = (complete) => {
      if (done) return;
      done = true;
      pending.delete(finish);
      const event = {
        method: "unexpected",
        version:
          request.headers["mcp-protocol-version"] === VERSION
            ? VERSION
            : "unexpected",
        status: response.statusCode,
        outcome: "invalid",
      };
      try {
        const req = input.parse();
        event.method = METHODS.includes(req?.method)
          ? req.method
          : "unexpected";
        if (event.method === "tools/call") {
          event.tool = TOOLS.includes(req?.params?.name)
            ? req.params.name
            : "unexpected";
          event.request = requestKind(event.tool, req?.params?.arguments);
          if (event.tool === "hcp_getEntry")
            event.requestRefMatches =
              queryRef !== undefined &&
              req?.params?.arguments?.ref === queryRef;
          else event.limitOne = req?.params?.arguments?.maxEntries === 1;
        }
        if (
          !complete ||
          request.complete !== true ||
          req?.jsonrpc !== "2.0" ||
          !validId(req.id) ||
          event.method === "unexpected" ||
          event.tool === "unexpected" ||
          !/^application\/json(?:;|$)/.test(
            response.getHeader("content-type") ?? "",
          )
        )
          throw new Error("Invalid observation");
        const res = output.parse();
        if (event.status === 403 && equal(res, { error: "insufficient_scope" }))
          event.outcome = "scope-denied";
        else if (event.status === 401 && equal(res, { error: "invalid_token" }))
          event.outcome = "invalid-token";
        else {
          if (
            event.status !== 200 ||
            !only(res, ["jsonrpc", "id", "result"]) ||
            res.jsonrpc !== "2.0" ||
            res.id !== req.id ||
            !object(res.result) ||
            res.result.resultType !== "complete"
          )
            throw new Error("Invalid response");
          if (event.method !== "tools/call") event.outcome = "complete";
          else {
            const result = res.result;
            if (
              typeof result.isError !== "boolean" ||
              !Array.isArray(result.content) ||
              result.content.length !== 1 ||
              result.content[0]?.type !== "text" ||
              typeof result.content[0].text !== "string" ||
              !equal(
                parseRequestJson(result.content[0].text),
                result.structuredContent,
              )
            )
              throw new Error("Invalid tool result");
            const value = result.structuredContent;
            assertReadResult(
              event.tool === "hcp_queryContext" ? "query" : "get",
              value,
              result.isError,
            );
            event.outcome = result.isError ? "tool-error" : "success";
            if (!result.isError) {
              if (event.tool === "hcp_queryContext") {
                event.entryCount = value.entries.length;
                event.expectedEntry =
                  value.entries.length === 1 &&
                  expectedEntry(value.entries[0]) &&
                  equal(value.categoriesSearched, ["general_preferences"]);
                if (
                  queryRef === undefined &&
                  event.expectedEntry &&
                  event.request === "read-query"
                )
                  queryRef = value.entries[0].ref;
              } else {
                event.expectedEntry = expectedEntry(value.entry);
                event.responseRefMatches =
                  queryRef !== undefined && value.entry.ref === queryRef;
              }
            }
          }
        }
      } catch {
        event.outcome = "invalid";
      } finally {
        input.clear();
        output.clear();
      }
      events.push(event);
      // Include malformed/unknown requests so unclassifiable evidence also stops.
      onEvent(event);
    };
    pending.add(finish);
    response.once("finish", () => finish(true));
    response.once("close", () => finish(false));
    response.once("error", () => finish(false));
    request.once("aborted", () => finish(false));
  };
  subscribe("http.server.request.start", listener);
  return {
    events,
    close() {
      unsubscribe("http.server.request.start", listener);
      for (const finish of pending) finish(false);
      queryRef = undefined;
    },
  };
}

// Shared live/offline acceptance. A model's narrative never establishes tool success.
export function createTrialEvidence(onFailure) {
  let count = 0,
    stage = 0,
    failed = false;
  const fail = () => {
    if (!failed) {
      failed = true;
      onFailure();
    }
  };
  const assertStage = () => {
    if (failed || count !== [2, 3, 4][stage]) {
      fail();
      throw new Error("C7b semantic evidence incomplete");
    }
  };
  return {
    get count() {
      return count;
    },
    get failed() {
      return failed;
    },
    assertStage,
    advance() {
      assertStage();
      if (stage >= 2) throw new Error("C7b stage limit");
      stage++;
    },
    accept(event) {
      if (failed) return;
      if (event.version !== VERSION || event.outcome === "invalid")
        return fail();
      if (event.method !== "tools/call") {
        if (
          !["server/discover", "tools/list"].includes(event.method) ||
          event.status !== 200 ||
          event.outcome !== "complete"
        )
          fail();
        return;
      }
      const index = count++;
      if (count > [2, 3, 4][stage]) return fail();
      const valid = [
        () =>
          event.tool === "hcp_queryContext" &&
          event.request === "read-query" &&
          event.limitOne &&
          event.status === 200 &&
          event.outcome === "success" &&
          event.entryCount === 1 &&
          event.expectedEntry,
        () =>
          event.tool === "hcp_getEntry" &&
          event.request === "get" &&
          event.status === 200 &&
          event.outcome === "success" &&
          event.expectedEntry &&
          event.requestRefMatches &&
          event.responseRefMatches,
        () =>
          event.tool === "hcp_queryContext" &&
          event.request === "scope-query" &&
          event.status === 403 &&
          event.outcome === "scope-denied",
        () =>
          event.tool === "hcp_queryContext" &&
          event.request === "read-query" &&
          event.status === 401 &&
          event.outcome === "invalid-token",
      ][index];
      if (!valid?.()) fail();
    },
  };
}
