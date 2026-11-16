// Test-only source CLI observation: method/path only, never headers, bodies or credentials.
const { Server } = require("node:https");
const emit = Server.prototype.emit;
Server.prototype.emit = function (name, ...args) {
  if (name === "request")
    process.send?.({ request: { method: args[0].method, path: args[0].url } });
  return emit.call(this, name, ...args);
};
if (process.env.HCP_SOURCE_SERVE_TEST === "close-error") {
  const source = require("../../../dist/infrastructure/hcp-experiment/source.js");
  const serve = source.serveSource;
  source.serveSource = async (...args) => {
    const server = await serve(...args);
    return {
      ...server,
      async close() {
        await server.close();
        throw new Error("private-test-shutdown-detail");
      },
    };
  };
}
