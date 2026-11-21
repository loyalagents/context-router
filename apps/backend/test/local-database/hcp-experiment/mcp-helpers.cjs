const { purpose } = require("./read-helpers.cjs");
const VERSION = "2026-07-28";
function envelope(method, params = {}, id = 1) {
  return {
    jsonrpc: "2.0",
    id,
    method,
    params: {
      ...params,
      _meta: {
        "io.modelcontextprotocol/protocolVersion": VERSION,
        "io.modelcontextprotocol/clientCapabilities": {},
      },
    },
  };
}
function rpc(f, token, method, params = {}, options = {}) {
  return f.request("/v2/mcp", {
    method: "POST",
    json: envelope(method, params),
    ...options,
    headers: {
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": VERSION,
      "mcp-method": method,
      ...(params.name ? { "mcp-name": params.name } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
}
const call = (f, token, name, args, options) =>
  rpc(f, token, "tools/call", { name, arguments: args }, options);
const mcpQuery = (f, token, extra = {}) =>
  call(f, token, "hcp_queryContext", {
    query: "written notes",
    purpose,
    ...extra,
  });
const mcpGet = (f, token, ref, extra = {}) =>
  call(f, token, "hcp_getEntry", { ref, purpose, ...extra });
module.exports = { VERSION, envelope, rpc, call, mcpQuery, mcpGet };
