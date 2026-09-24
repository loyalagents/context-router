"use strict";
const Module = require("node:module");
const net = require("node:net");
const original = Module._load;
Module._load = function (name, ...args) {
  if (
    typeof name === "string" &&
    /^(?:pg(?:\/|$)|@prisma\/|@google-cloud\/)|(?:infrastructure[\/\\](?:prisma|postgres|vertex-ai))/.test(
      name,
    )
  )
    throw new Error("Forbidden local runtime provider");
  return original.call(this, name, ...args);
};
net.Server.prototype.listen = function () {
  throw new Error("Forbidden local listener");
};
net.Socket.prototype.connect = function () {
  throw new Error("Forbidden local network connection");
};
