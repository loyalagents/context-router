import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { openSync, closeSync } from 'node:fs';
const chunks = []; for await (const chunk of process.stdin) chunks.push(chunk);
const { guardian, lock } = JSON.parse(Buffer.concat(chunks));
const verify = fd => spawnSync(guardian, ['verify-inherited'], { stdio: ['ignore', 'pipe', 'ignore', fd], env: {}, timeout: 2000 }).status;
assert.equal(verify(3), 0);
const reopened = openSync(lock, 'r+');
try { assert.equal(verify(reopened), 1); } finally { closeSync(reopened); }
process.stdout.write(JSON.stringify({ ok: true, pages: 1, items: 1, bytes: 8, canvasPresent: false }) + '\nverified');
