const { test } = require("node:test");
const assert = require("node:assert/strict");
const { fixture } = require("./authorization-fixture.cjs");
const { authorize, query, purpose } = require("./read-helpers.cjs");

test("C7 N4 HTTP query: UTF-8 JSON media, strict decoding and duplicate decoded keys", async (t) => {
  const f = await fixture(t, { approveFixtures: true });
  const token = await authorize(f);
  const raw = JSON.stringify({ query: "notes", purpose });
  const send = (value, media = "application/json", encoding) =>
    f.context("/v2/entries/query", token, {
      method: "POST",
      raw: value,
      headers: {
        "content-type": media,
        ...(encoding ? { "content-encoding": encoding } : {}),
      },
    });
  for (const media of [
    "application/json",
    "Application/JSON",
    "application/json; charset=utf-8",
    ' application/json ; charset = "UTF-8" ',
  ]) {
    await t.test(`accept ${media}`, async () =>
      assert.equal((await send(raw, media)).status, 200),
    );
  }
  for (const media of [
    "text/plain",
    "application/ld+json",
    "application/x-www-form-urlencoded",
    "multipart/form-data",
    "application/json; charset=ascii",
    "application/json; charset=utf-8; charset=utf-8",
    "application/json; profile=x",
    "application/json;",
  ]) {
    await t.test(`reject ${media}`, async () =>
      assert.equal((await send(raw, media)).status, 422),
    );
  }
  for (const encoding of ["gzip", "br", "identity, identity"])
    assert.equal((await send(raw, "application/json", encoding)).status, 422);
  assert.equal((await send(raw, "application/json", "identity")).status, 200);
  for (const value of [
    `{\"query\":\"notes\",\"purpose\":\"wrong\",\"purpose\":${JSON.stringify(purpose)}}`,
    `{\"query\":\"notes\",\"purpose\":\"wrong\",\"\\u0070urpose\":${JSON.stringify(purpose)}}`,
    '{"outer":{"a":1,"\\u0061":2}}',
    '{"query":"notes","purpose":',
    "null",
    "[]",
    "1",
    Buffer.from([0x7b, 0x22, 0x71, 0x22, 0x3a, 0x22, 0xff, 0x22, 0x7d]),
    " ".repeat(32769),
  ]) {
    const result = await send(value);
    assert.equal(result.status, 422);
    assert.equal(
      result.json.type,
      "https://hcp.example/problems/malformed-request",
    );
  }
  assert.equal((await query(f, token)).status, 200);
});
