// Explicit credential-free network diagnostic after live setup authorization.
// Sends only fixed public hostnames and TLS handshakes, never OAuth/model data.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { sandboxPolicy } from "./host-boundary.mjs";

assert.equal(process.platform, "darwin");
assert.deepEqual(process.argv.slice(2), ["--network-preflight"]);
process.umask(0o077);
const root = fs.realpathSync(
  fs.mkdtempSync(path.join(os.tmpdir(), "hcp-c7b-network-")),
);
const protectedRoot = path.join(root, "protected");
fs.mkdirSync(protectedRoot);
const socketPath = path.join(root, "unrelated.sock");
const server = net.createServer((socket) => socket.end());
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(socketPath, resolve);
});
const childProgram = `
import dns from 'node:dns/promises';
import net from 'node:net';
import tls from 'node:tls';
const result={unrelatedSocketDenied:false,hosts:[]};
result.unrelatedSocketDenied=await new Promise(resolve=>{
  const socket=net.connect(${JSON.stringify(socketPath)});
  socket.once('connect',()=>{socket.destroy();resolve(false);});
  socket.once('error',error=>resolve(error.code==='EPERM'||error.code==='EACCES'));
  socket.setTimeout(2000,()=>{socket.destroy();resolve(false);});
});
for(const host of ['platform.claude.com','claude.ai']) {
  const outcome={host,resolved:false,tlsVerified:false};
  try {
    const answers=await dns.lookup(host,{all:true});
    outcome.resolved=answers.length>0;
    await new Promise((resolve,reject)=>{
      const socket=tls.connect({host,port:443,servername:host,rejectUnauthorized:true});
      socket.once('secureConnect',()=>{outcome.tlsVerified=socket.authorized;socket.destroy();resolve();});
      socket.once('error',reject);
      socket.setTimeout(5000,()=>socket.destroy(new Error('TLS timeout')));
    });
  } catch(error) {outcome.error=error.code||'DIAGNOSTIC_FAILED';}
  result.hosts.push(outcome);
}
console.log(JSON.stringify(result));
`;
try {
  const outcomes = [];
  for (const mode of [
    "model-empty",
    "model",
    "setup-without-resolver",
    "setup",
  ]) {
    const generated = sandboxPolicy({
      binary: process.execPath,
      ports: mode === "model" ? [19443, 19444] : [],
      protectedRoot,
      caFile: path.join(protectedRoot, "absent-ca"),
      subscriptionSetup: mode.startsWith("setup"),
    });
    const policy =
      mode === "setup-without-resolver"
        ? generated.replace(
            '(allow network-outbound (literal "/private/var/run/mDNSResponder"))',
            "",
          )
        : generated;
    if (mode === "setup-without-resolver") assert.notEqual(policy, generated);
    const child = spawn(
      "/usr/bin/sandbox-exec",
      [
        "-p",
        policy,
        process.execPath,
        "--input-type=module",
        "-e",
        childProgram,
      ],
      {
        cwd: root,
        env: { PATH: "/usr/bin:/bin", LANG: "en_US.UTF-8" },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "",
      stderr = "";
    const timeout = setTimeout(() => child.kill("SIGKILL"), 20_000);
    child.stdout.on("data", (data) => {
      stdout += data;
      if (stdout.length > 16384) child.kill("SIGKILL");
    });
    child.stderr.on("data", (data) => {
      stderr += data;
      if (stderr.length > 16384) child.kill("SIGKILL");
    });
    const code = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
    clearTimeout(timeout);
    assert.equal(code, 0);
    assert.equal(stderr, "");
    outcomes.push({ mode, ...JSON.parse(stdout), policy });
  }
  fs.writeFileSync(
    path.join(root, "receipt.json"),
    JSON.stringify({ root, outcomes }, null, 2),
  );
  console.log(
    JSON.stringify({
      root,
      outcomes: outcomes.map(({ policy, ...outcome }) => outcome),
    }),
  );
  for (const result of outcomes) {
    assert.equal(result.unrelatedSocketDenied, true);
    for (const host of result.hosts) {
      assert.equal(
        host.resolved,
        result.mode === "setup",
        `${result.mode} DNS: ${host.host}`,
      );
      assert.equal(
        host.tlsVerified,
        result.mode === "setup",
        `${result.mode} TLS: ${host.host}`,
      );
    }
  }
} finally {
  await new Promise((resolve) => server.close(resolve));
}
