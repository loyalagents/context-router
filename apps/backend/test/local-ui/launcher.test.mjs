import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLocalUiArgs } from '../../../web/local-ui.mjs';

test('local UI launcher requires explicit command, private export path and canonical loopback ports', () => {
  assert.deepEqual(
    parseLocalUiArgs(['serve', '--unlock-dir', '/synthetic/exports']),
    {
      command: 'serve',
      exportRoot: '/synthetic/exports',
      port: 3002,
      mcpPort: 8787,
    },
  );
  assert.equal(
    parseLocalUiArgs([
      'serve-model',
      '--unlock-dir',
      '/synthetic/exports',
      '--port',
      '0',
      '--mcp-port',
      '0',
    ]).command,
    'serve-model',
  );
  for (const args of [
    [],
    ['serve'],
    ['serve', '--unlock-dir', 'relative'],
    ['serve', '--unlock-dir', '/x/../y'],
    ['serve', '--unlock-dir', '/x', '--host', '0.0.0.0'],
    ['serve', '--unlock-dir', '/x', '--port', '01'],
    ['serve', '--unlock-dir', '/x', '--port', '-1'],
    ['serve', '--unlock-dir', '/x', '--port', '65536'],
    ['serve', '--unlock-dir', '/x', '--port', '8787'],
    ['serve-model', '--unlock-dir', '/x', 'extra'],
  ]) {
    assert.throws(() => parseLocalUiArgs(args));
  }
});
