// Test process only: any non-loopback network attempt is a failing observation.
const net = require('node:net');
const dns = require('node:dns');
const original = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  let normalized = args;
  while (Array.isArray(normalized[0])) normalized = normalized[0];
  const options =
    normalized[0] && typeof normalized[0] === 'object'
      ? normalized[0]
      : {
          port: normalized[0],
          host: typeof normalized[1] === 'string' ? normalized[1] : 'localhost',
        };
  if (options.path) return original.apply(this, args);
  const host = options.host ?? 'localhost';
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
    process.stderr.write('LOCAL_UI_TEST_FORBIDDEN_EGRESS\n');
    throw new Error('Test forbids external network');
  }
  return original.apply(this, args);
};
const lookup = dns.lookup;
dns.lookup = function (hostname, ...args) {
  if (!['127.0.0.1', 'localhost', '::1'].includes(hostname)) {
    process.stderr.write('LOCAL_UI_TEST_FORBIDDEN_EGRESS\n');
    throw new Error('Test forbids external DNS');
  }
  return lookup.call(this, hostname, ...args);
};
