const assert = require("node:assert/strict");
const { OAuthDriver } = require("./authorization-fixture.cjs");
const {
  ACCESS_TYPE,
  PURPOSES,
} = require("../../../dist/infrastructure/hcp-experiment/policy.js");
const purpose = PURPOSES[0].code;
async function authorize(f, client = "a", access, selection) {
  const d = new OAuthDriver(f, client);
  await d.begin(
    access ? { patch: { authorization_details: JSON.stringify(access) } } : {},
  );
  await d.login();
  const r = await d.consentAndExchange(selection);
  assert.equal(r.status, 200);
  return r.json.access_token;
}
const query = (f, token, extra = {}) =>
  f.context("/v2/entries/query", token, {
    method: "POST",
    json: { query: "written notes", purpose, ...extra },
  });
const get = (f, token, ref, extra = {}) =>
  f.context(
    `/v2/entries/${encodeURIComponent(ref)}?` +
      new URLSearchParams({ purpose, ...extra }),
    token,
  );
const detail = (categories, purposes = [PURPOSES[0]], extra = {}) => ({
  type: ACCESS_TYPE,
  actions: ["read"],
  categories,
  purposes,
  ...extra,
});

module.exports = { authorize, query, get, detail, purpose };
