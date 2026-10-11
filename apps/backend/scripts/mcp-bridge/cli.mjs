#!/usr/bin/env node
import { readCredential } from './credential.mjs';
import { createBridge, VERSION } from './bridge.mjs';

const args = process.argv.slice(2);
if (args.length === 1 && ['--help', '--version'].includes(args[0])) {
  process.stdout.write(
    args[0] === '--version'
      ? `context-router-stdio-bridge ${VERSION}\n`
      : 'Usage: node cli.mjs --credential-file /absolute/private/client.token\n',
  );
} else {
  try {
    if (
      // Node caches debug flags before this module; deleting them here is unsafe.
      ['NODE_DEBUG', 'NODE_DEBUG_NATIVE', 'NODE_OPTIONS'].some(
        (name) => process.env[name],
      ) ||
      process.versions.node !== '24.21.0' ||
      args.length !== 2 ||
      args[0] !== '--credential-file'
    )
      throw new Error();
    const credential = readCredential(args[1]);
    const bridge = createBridge({
      input: process.stdin,
      output: process.stdout,
      diagnostics: process.stderr,
      credential,
    });
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'])
      process.once(signal, () => {
        void bridge.close();
      });
    await bridge.closed;
    // The bridge owns only this subprocess; exit also bounds blocked client pipes.
    process.exit(0);
  } catch {
    process.stderr.write(
      'Context Router bridge: startup unavailable; check Node version, arguments, private credential file and disabled Node debugging.\n',
    );
    process.exitCode = 1;
  }
}
