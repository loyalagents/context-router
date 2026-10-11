// Test-only endpoint injection. Production CLI has no endpoint/port override.
import { createBridge } from '../../../scripts/mcp-bridge/bridge.mjs';
import { readCredential } from '../../../scripts/mcp-bridge/credential.mjs';
const bridge = createBridge({
  input: process.stdin,
  output: process.stdout,
  diagnostics: process.stderr,
  credential: readCredential(process.argv[3]),
  port: Number(process.argv[2]),
});
process.once('SIGTERM', () => {
  void bridge.close();
});
await bridge.closed;
process.exit(0);
