import { fstatSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';

// Synthetic finite-lived fixtures only. Never used by an installed application.
const [role, generation] = process.argv.slice(2);
if (!['application', 'model', 'parser'].includes(role)) process.exit(9);
const descriptor = fstatSync(3);
process.stdout.write(JSON.stringify({ event: 'fixture-ready', role, generation: Number(generation),
  pid: process.pid, inode: descriptor.ino }) + '\n');
let parser, server, stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  if (server?.listening) await new Promise(resolve => server.close(resolve));
  if (parser && parser.exitCode === null && parser.signalCode === null) {
    const done = new Promise(resolve => parser.once('close', resolve));
    parser.kill('SIGTERM');
    await done;
  }
  process.exit(0);
}
if (role === 'application') {
  parser = spawn(process.execPath, [new URL(import.meta.url).pathname, 'parser', generation], {
    stdio: ['ignore', 1, 2, 3], env: process.env,
  });
  if (process.env.FIXTURE_PORT) {
    server = createServer((_req, res) => res.end('fixture'));
    server.on('error', error => {
      if (error.code === 'EADDRINUSE') process.stdout.write(JSON.stringify({ event: 'fixture-listen-refused' }) + '\n');
      void stop();
    });
    server.listen(Number(process.env.FIXTURE_PORT), '127.0.0.1');
  }
}
process.on('SIGTERM', () => { if (process.env.FIXTURE_IGNORE_TERM_ROLE !== role) void stop(); });
process.on('SIGINT', stop);
const lifetime = Number(process.env.FIXTURE_LIFETIME_MS ?? 15000);
if (!Number.isInteger(lifetime) || lifetime < 1000 || lifetime > 20000) process.exit(9);
setTimeout(stop, lifetime);
