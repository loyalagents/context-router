// Candidate compatibility only. The runtime's adopted schema bundle remains separate
// until the actual upstream merge is verified.
const assert = require("node:assert/strict");
const Ajv2020 = require("ajv/dist/2020").default;
const addFormats = require("ajv-formats");
const candidate = require("./fixtures/spec-49-schemas.json");
const validator = new Ajv2020({ strict: false, allErrors: true });
addFormats(validator);
for (const schema of Object.values(candidate.schemas))
  validator.addSchema(schema);
function validCandidate(name, value) {
  const check = validator.getSchema(
    "https://hcp.example/schemas/2.0-draft-3/" + name,
  );
  assert.ok(check, name);
  assert.ok(check(value), JSON.stringify(check.errors));
}
module.exports = { validCandidate };
