// Exact-host setup startup only: no browser, credentials, or off-device egress.
// PTY output is inspected in memory, never printed or retained.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  sandboxPolicy,
  verifyHost,
  verifyUnmanagedHost,
} from "./host-boundary.mjs";

const binary = process.argv[2];
verifyHost(binary);
process.umask(0o077);
const root = fs.realpathSync(
  fs.mkdtempSync(path.join(os.tmpdir(), "hcp-c7b-setup-offline-")),
);
for (const name of ["profile", "cwd", "tmp", "protected"])
  fs.mkdirSync(path.join(root, name));
verifyUnmanagedHost(path.join(root, "cwd"));
const setupPolicy = sandboxPolicy({
  binary,
  ports: [],
  protectedRoot: path.join(root, "protected"),
  caFile: path.join(root, "protected/absent-ca"),
  subscriptionSetup: true,
});
const policy = setupPolicy
  .replace('(allow network-outbound (remote tcp "*:443"))', "")
  .replace(
    '(allow network-outbound (literal "/private/var/run/mDNSResponder"))',
    "",
  );
assert.notEqual(policy, setupPolicy);
assert.ok(!policy.includes("allow network-outbound"));
// Python's standard-library PTY provides the same interactive startup as the
// private Terminal. Only the sandboxed, pinned process sees that terminal.
const python = `
import os, sys, json, pty, fcntl, termios, struct, subprocess, select, time, signal, re, socket
config=json.load(sys.stdin)
master,slave=pty.openpty()
fcntl.ioctl(slave,termios.TIOCSWINSZ,struct.pack('HHHH',40,220,0,0))
child=subprocess.Popen(config['args'],cwd=config['cwd'],env=config['env'],stdin=slave,stdout=slave,stderr=slave,start_new_session=True)
os.close(slave)
output=b''
listener=None
reply=False
inspected=False
inspection_count=0
next_inspection=time.monotonic()+0.5
try:
  deadline=time.monotonic()+15
  while time.monotonic()<deadline and child.poll() is None:
    ready,_,_=select.select([master],[],[],0.1)
    if ready:
      try: output+=os.read(master,65536)
      except OSError: break
    if len(output)>1048576: raise RuntimeError('Output limit')
    if time.monotonic()>=next_inspection:
      check=subprocess.run(config['inspector']+[str(child.pid)],capture_output=True,timeout=5).returncode
      inspection_count+=1
      if check not in (0,2): raise RuntimeError('Parent inspection failed')
      inspected=inspected or check==0
      next_inspection=time.monotonic()+0.5
    if b'Failed to start OAuth callback server' in output: break
    if b'https://' not in output: continue
    listing=subprocess.run(['/usr/sbin/lsof','-nP','-a','-p',str(child.pid),'-iTCP','-sTCP:LISTEN','-Fn'],capture_output=True,timeout=2).stdout.decode()
    addresses=[line[1:] for line in listing.splitlines() if line.startswith('n')]
    if len(addresses)!=1 or not re.fullmatch(r'127\\.0\\.0\\.1:[0-9]+',addresses[0]):
      raise RuntimeError('Unexpected callback listener')
    listener=addresses[0]
    inspected=subprocess.run(config['inspector']+[str(child.pid)],capture_output=True,timeout=5).returncode==0
    if not inspected: raise RuntimeError('Parent inspection failed')
    with socket.create_connection(('127.0.0.1',int(listener.rsplit(':',1)[1])),timeout=2) as client:
      client.sendall(b'GET / HTTP/1.1\\r\\nHost: localhost\\r\\nConnection: close\\r\\n\\r\\n')
      reply=client.recv(4096).startswith(b'HTTP/1.1 ')
    break
finally:
  os.close(master)
  if child.poll() is None:
    os.killpg(child.pid,signal.SIGTERM)
    try: child.wait(timeout=5)
    except subprocess.TimeoutExpired:
      os.killpg(child.pid,signal.SIGKILL)
      child.wait(timeout=5)
closed=False
if listener:
  try:
    with socket.create_connection(('127.0.0.1',int(listener.rsplit(':',1)[1])),timeout=1): pass
  except ConnectionRefusedError: closed=True
print(json.dumps({'callbackFailure':b'Failed to start OAuth callback server' in output,'authorizationUrlShown':b'https://' in output,'loopbackListener':listener is not None,'parentInspectorPassed':inspected,'inspectionCount':inspection_count,'callbackHttpReply':reply,'listenerClosed':closed,'outputBytes':len(output),'exitCode':child.returncode}))
`;
const result = JSON.parse(
  execFileSync("/usr/bin/python3", ["-c", python], {
    input: JSON.stringify({
      args: ["/usr/bin/sandbox-exec", "-p", policy, binary, "setup-token"],
      inspector: [
        process.execPath,
        "--input-type=module",
        "-e",
        `import { inspectSetupListener } from ${JSON.stringify(new URL("./host-boundary.mjs", import.meta.url).href)}; if (!inspectSetupListener(Number(process.argv[1]))) process.exit(2);`,
      ],
      cwd: path.join(root, "cwd"),
      env: {
        PATH: "/usr/bin:/bin",
        LANG: "en_US.UTF-8",
        TMPDIR: path.join(root, "tmp"),
        CLAUDE_CONFIG_DIR: path.join(root, "profile"),
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
        DISABLE_TELEMETRY: "1",
        DISABLE_AUTOUPDATER: "1",
      },
    }),
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: 65536,
  }),
);
const receipt = { root, binary, policy, externalEgress: false, ...result };
fs.writeFileSync(
  path.join(root, "receipt.json"),
  JSON.stringify(receipt, null, 2),
);
console.log(JSON.stringify({ root, ...result }));
assert.equal(result.callbackFailure, false);
assert.equal(result.authorizationUrlShown, true);
assert.equal(result.loopbackListener, true);
assert.equal(result.callbackHttpReply, true);
assert.equal(result.listenerClosed, true);
assert.equal(result.parentInspectorPassed, true);
