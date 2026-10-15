#!/usr/bin/env node
import { readCredential } from '../../apps/backend/scripts/mcp-bridge/credential.mjs';
import { createBridge, VERSION } from '../../apps/backend/scripts/mcp-bridge/bridge.mjs';

// Example-only endpoint selection. Transport, authority, recovery and replay
// behavior remain entirely in the existing production bridge implementation.
const args = process.argv.slice(2);
if (args.length === 1 && ['--help', '--version'].includes(args[0])) {
  process.stdout.write(args[0] === '--version'
    ? `context-router-demo-stdio-bridge ${VERSION}\n`
    : 'Usage: node desktop-bridge.mjs --credential-file /absolute/private/client.token [--mcp-port PORT]\nMCP port: default 8788; loopback only.\n');
} else {
  try {
    // Node reads these before this module, so removing them here is unsafe.
    if (process.versions.node !== '24.21.0' ||
        ['NODE_OPTIONS', 'NODE_DEBUG', 'NODE_DEBUG_NATIVE'].some(name => process.env[name]) ||
        ![2, 4].includes(args.length)) throw new Error();
    const options = new Map();
    for (let i = 0; i < args.length; i += 2) {
      if (!['--credential-file', '--mcp-port'].includes(args[i]) || options.has(args[i]) || !args[i + 1]) throw new Error();
      options.set(args[i], args[i + 1]);
    }
    const port = options.get('--mcp-port') ?? '8788';
    if (!options.has('--credential-file') || !/^[1-9][0-9]{0,4}$/.test(port) || Number(port) > 65535) throw new Error();
    const credential = readCredential(options.get('--credential-file'));
    const bridge = createBridge({ input: process.stdin, output: process.stdout, diagnostics: process.stderr, credential, port: Number(port) });
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.once(signal, () => { void bridge.close(); });
    await bridge.closed;
    // Match the production CLI: this adapter owns only its own subprocess.
    process.exit(0);
  } catch {
    process.stderr.write('Demo Desktop bridge: startup unavailable; check Node version, arguments, private credential file and disabled Node debugging.\n');
    process.exitCode = 1;
  }
}
