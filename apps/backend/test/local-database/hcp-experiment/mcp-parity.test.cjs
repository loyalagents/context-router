// Run the established HTTP semantic/recovery scenarios through MCP query/get too.
// Only binding-specific envelopes/statuses are normalized, after asserting their
// raw MCP contract. Direct HTTP-only probes in those suites remain HTTP probes.
const assert = require("node:assert/strict");
const helpers = require("./read-helpers.cjs");
const { mcpQuery, mcpGet } = require("./mcp-helpers.cjs");
async function core(response) {
  const r = await response;
  if (r.json?.result) {
    assert.equal(r.status, 200);
    assert.equal(r.headers["content-type"], "application/json");
    assert.equal(r.json.result.resultType, "complete");
    assert.deepEqual(
      JSON.parse(r.json.result.content[0].text),
      r.json.result.structuredContent,
    );
    const value = r.json.result.structuredContent;
    if (r.json.result.isError) {
      assert.equal(r.headers["www-authenticate"], undefined);
      assert.ok(["scope-denied", "malformed-request"].includes(value.type));
      return {
        ...r,
        status: value.type === "scope-denied" ? 403 : 422,
        json: {
          type: `https://hcp.example/problems/${value.type}`,
          detail: value.detail,
        },
      };
    }
    assert.equal(r.json.result.isError, false);
    return {
      ...r,
      json: value,
      headers: {
        ...r.headers,
        "content-type": "application/ld+json",
        "hcp-version": "2.0",
      },
    };
  }
  if (r.status === 500) {
    assert.equal(r.json.error.code, -32603);
    return { ...r, status: 503 };
  }
  assert.ok([401, 403].includes(r.status), JSON.stringify(r.json));
  assert.match(r.headers["www-authenticate"], /^Bearer /);
  return r;
}
helpers.query = (f, token, extra) => core(mcpQuery(f, token, extra));
helpers.get = (f, token, ref, extra) => {
  // HTTP test input encodes numeric versions in the URL. MCP uses JSON integers.
  const input = { ...extra };
  if (typeof input.version === "string" && /^[1-9][0-9]*$/.test(input.version))
    input.version = Number(input.version);
  return core(mcpGet(f, token, ref, input));
};
require("./read.test.cjs");
require("./read-recovery.test.cjs");
