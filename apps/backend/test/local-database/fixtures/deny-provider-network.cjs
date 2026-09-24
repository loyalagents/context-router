// Test-only preload: local runtime must start without opening listeners, outbound sockets, or hosted provider modules.
const Module = require("node:module");
const net = require("node:net");
const original = Module._load;
Module._load = function (request, ...args) {
  if (
    request === "pg" ||
    request.startsWith("@prisma/") ||
    request.startsWith("@google-cloud/") ||
    /(?:^|\/)infrastructure\/(?:prisma|vertex-ai)\//.test(request) ||
    /(?:^|\/)storage\/postgres\//.test(request)
  )
    throw new Error("Hosted provider import forbidden in local runtime");
  return original.call(this, request, ...args);
};
net.Server.prototype.listen = function () {
  throw new Error("Listener forbidden in local runtime");
};
net.Socket.prototype.connect = function () {
  throw new Error("Outbound socket forbidden in local runtime");
};
