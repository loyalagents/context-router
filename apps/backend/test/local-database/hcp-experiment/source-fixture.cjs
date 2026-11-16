// The source launcher owns admission/configuration; this child adds fault/clock controls only.
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  net = require("node:net");
const {
  initializeSource,
  readSource,
} = require("../../../dist/infrastructure/hcp-experiment/source.js");
const { childServer } = require("./authorization-child.cjs");
const { request } = require("./authorization-fixture.cjs");
async function sourceFixture(t) {
  const sandbox = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "hcp-c6-fault-")),
  );
  fs.chmodSync(sandbox, 0o700);
  let server;
  t.after(async () => {
    await server?.close();
    fs.rmSync(sandbox, { recursive: true, force: true });
  });
  const probe = net.createServer();
  await new Promise((r) => probe.listen(0, "127.0.0.1", r));
  const port = probe.address().port;
  await new Promise((r) => probe.close(r));
  await initializeSource(
    sandbox,
    port,
    async (review) => `approve ${review.digest}`,
  );
  const source = readSource(sandbox);
  server = await childServer(
    { sandbox, root: path.join(sandbox, "data") },
    { source: true },
  );
  return {
    ...server,
    sandbox,
    human: source.humanCredential,
    request: (route, options) =>
      request(server.issuer + route, source.tls, options),
    management: (route, options = {}) =>
      request(server.issuer + route, source.tls, {
        ...options,
        headers: {
          ...options.headers,
          authorization: `Bearer ${source.humanCredential}`,
        },
      }),
  };
}
module.exports = { sourceFixture };
