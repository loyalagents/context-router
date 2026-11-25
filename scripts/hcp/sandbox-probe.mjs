// Independently exercise the same Seatbelt policy with an owned native process.
// Only synthetic files and loopback listeners; never fetch credentials.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { execFileSync, spawn } from "node:child_process";
import assert from "node:assert/strict";
import { sandboxPolicy, inspectSetupListener } from "./host-boundary.mjs";
assert.equal(process.platform, "darwin");
process.umask(0o077);
const root = fs.realpathSync(
  fs.mkdtempSync(path.join(os.tmpdir(), "hcp-c7b-confinement-")),
);
const protectedRoot = path.join(root, "provider");
fs.mkdirSync(protectedRoot);
const caFile = path.join(protectedRoot, "ca.pem"),
  secret = path.join(protectedRoot, "synthetic-secret");
fs.writeFileSync(caFile, "readable canary");
fs.writeFileSync(secret, "forbidden canary");
// A workspace file under home is a synthetic proxy for private-home access.
const homeCanary = path.resolve("scripts/hcp/.sandbox-canary-" + process.pid);
fs.writeFileSync(homeCanary, "forbidden home canary", {
  flag: "wx",
  mode: 0o600,
});
const source = path.join(root, "probe.c"),
  binary = path.join(root, "probe");
fs.writeFileSync(
  source,
  `
#include <stdio.h>
#include <stdlib.h>
#include <fcntl.h>
#include <unistd.h>
#include <errno.h>
#include <spawn.h>
#include <sys/socket.h>
#include <arpa/inet.h>
#include <string.h>
#include <signal.h>
#include <sys/wait.h>
#include <mach/mach.h>
#include <servers/bootstrap.h>
extern char **environ;
int connect_port(int p) { int s=socket(AF_INET,SOCK_STREAM,0); struct sockaddr_in a={0}; a.sin_family=AF_INET; a.sin_port=htons(p); a.sin_addr.s_addr=htonl(INADDR_LOOPBACK); int r=connect(s,(struct sockaddr*)&a,sizeof(a)); close(s); return r; }
int main(int n,char **a) {
  if(n==3 && (strcmp(a[1],"listen")==0 || strcmp(a[1],"fork-listen")==0)) {
    pid_t descendant=-1;
    if(strcmp(a[1],"fork-listen")==0){ descendant=fork(); if(descendant==0){ pause(); return 0; } if(descendant<0) return 34; }
    int v6=strchr(a[2],':')!=NULL;
    int s=socket(v6?AF_INET6:AF_INET,SOCK_STREAM,0), r;
    struct sockaddr_in a4={0}; struct sockaddr_in6 a6={0};
    if(v6){ a6.sin6_family=AF_INET6; inet_pton(AF_INET6,a[2],&a6.sin6_addr); r=bind(s,(struct sockaddr*)&a6,sizeof(a6)); }
    else { a4.sin_family=AF_INET; inet_pton(AF_INET,a[2],&a4.sin_addr); r=bind(s,(struct sockaddr*)&a4,sizeof(a4)); }
    if(r!=0){ printf("bind denied %d\\n",errno); return errno==EPERM?30:31; }
    if(listen(s,1)!=0){ printf("listen denied %d\\n",errno); return errno==EPERM?30:31; }
    socklen_t len=v6?sizeof(a6):sizeof(a4);
    getsockname(s,v6?(struct sockaddr*)&a6:(struct sockaddr*)&a4,&len);
    printf("port %d\\n",ntohs(v6?a6.sin6_port:a4.sin_port)); fflush(stdout);
    int c=accept(s,NULL,NULL); if(c<0) return 32;
    if(write(c,"callback",8)!=8) return 33; close(c); close(s);
    if(descendant>0){ kill(descendant,SIGTERM); waitpid(descendant,NULL,0); } return 0;
  }
  if(n==2) return 0;
  if(n!=6 && n!=7) return 20;
  int fd=open(a[1],O_RDONLY); if(fd<0) return 21; close(fd);
  if(open(a[2],O_RDONLY)>=0 || open(a[3],O_RDONLY)>=0) return 22;
  if(open(a[2],O_WRONLY)>=0 || open(a[3],O_WRONLY)>=0) return 23;
  if((n==6 ? connect_port(atoi(a[4]))!=0 : connect_port(atoi(a[4]))==0) || connect_port(atoi(a[5]))==0) return 24;
  char *args[]={"/usr/bin/true",NULL}; pid_t pid;
  if(posix_spawn(&pid,args[0],NULL,NULL,args,environ)==0) return 25;
  const char *names[]={"com.apple.SecurityServer","com.apple.securityd.xpc","com.apple.securityd.general","com.apple.securityd.systemkeychain"};
  for(int i=0;i<4;i++){ mach_port_t port=MACH_PORT_NULL; kern_return_t r=bootstrap_look_up(bootstrap_port,names[i],&port); printf("Keychain service %s lookup status %d\\n",names[i],r); if(r==KERN_SUCCESS) return 26; }
  puts(n==6?"allowed CA and listed loopback port; denied home/provider read/write, unlisted port, exec; no successful Keychain IPC lookup (absent services are not denial evidence)":"allowed CA; denied home/provider read/write, both sampled local ports, exec; no successful Keychain IPC lookup (absent services are not denial evidence)"); return 0;
}
`,
);
const servers = [
  net.createServer((s) => s.end()),
  net.createServer((s) => s.end()),
];
try {
  for (const s of servers)
    await new Promise((r, reject) => {
      s.once("error", reject);
      s.listen(0, "127.0.0.1", r);
    });
  const ports = servers.map((s) => s.address().port);
  execFileSync("/usr/bin/cc", [source, "-o", binary], {
    stdio: "pipe",
    timeout: 30_000,
  });
  const policy = sandboxPolicy({
    binary,
    ports: [ports[0]],
    protectedRoot,
    caFile,
  });
  const output = execFileSync(
    "/usr/bin/sandbox-exec",
    ["-p", policy, binary, caFile, secret, homeCanary, ...ports.map(String)],
    { encoding: "utf8", timeout: 10_000, env: { PATH: "/usr/bin:/bin" } },
  );
  const setupPolicy = sandboxPolicy({
    binary,
    ports: [],
    protectedRoot,
    caFile,
    subscriptionSetup: true,
  });
  const setupBoundaryOutput = execFileSync(
    "/usr/bin/sandbox-exec",
    [
      "-p",
      setupPolicy,
      binary,
      caFile,
      secret,
      homeCanary,
      ...ports.map(String),
      "setup",
    ],
    {
      encoding: "utf8",
      timeout: 10_000,
      env: { PATH: "/usr/bin:/bin" },
    },
  );
  const listenProbe = async (
    activePolicy,
    address,
    allowed,
    inspection = null,
    descendant = false,
  ) => {
    const child = spawn(
      "/usr/bin/sandbox-exec",
      [
        "-p",
        activePolicy,
        binary,
        descendant ? "fork-listen" : "listen",
        address,
      ],
      {
        env: { PATH: "/usr/bin:/bin" },
        stdio: ["ignore", "pipe", "pipe"],
        detached: true,
      },
    );
    let stdout = "",
      stderr = "",
      connection,
      inspected = null;
    const timer = setTimeout(() => process.kill(-child.pid, "SIGKILL"), 5000);
    child.stderr.on("data", (data) => {
      stderr += data;
    });
    child.stdout.on("data", (data) => {
      stdout += data;
      const match = /^port (\d+)\n/.exec(stdout);
      if (match && !connection) {
        if (inspection !== null) {
          try {
            inspected = inspectSetupListener(child.pid);
          } catch {
            inspected = false;
          }
        }
        connection = new Promise((resolve, reject) => {
          const socket = net.connect({ host: address, port: Number(match[1]) });
          let body = "";
          socket.on("data", (data) => {
            body += data;
          });
          socket.on("error", reject);
          socket.on("end", () => resolve(body));
          socket.setTimeout(2000, () =>
            socket.destroy(new Error("Callback timeout")),
          );
        });
        connection.catch(() => {});
      }
    });
    const code = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
    clearTimeout(timer);
    assert.equal(code, allowed ? 0 : 30, `${address}: ${stdout} ${stderr}`);
    if (allowed) assert.equal(await connection, "callback");
    else assert.equal(connection, undefined);
    if (inspection !== null)
      assert.equal(inspected, inspection, "Parent listener inspection");
    return { address, allowed, code, inspected, descendant };
  };
  const listeners = [];
  // The model host must still be unable to open any callback listener.
  for (const address of ["127.0.0.1", "0.0.0.0", "::1", "::"])
    listeners.push({
      mode: "model",
      ...(await listenProbe(policy, address, false)),
    });
  // Record the Seatbelt limitation honestly: localhost also admits wildcard and
  // assigned IPv4 interfaces. The parent inspector must reject those listeners.
  const external = Object.values(os.networkInterfaces())
    .flat()
    .filter((a) => a.family === "IPv4" && !a.internal)
    .map((a) => a.address);
  for (const address of ["::", "::1"])
    listeners.push({
      mode: "setup",
      ...(await listenProbe(setupPolicy, address, false)),
    });
  for (const address of ["0.0.0.0", ...new Set(external)])
    listeners.push({
      mode: "setup",
      ...(await listenProbe(setupPolicy, address, true, false)),
    });
  listeners.push({
    mode: "setup",
    ...(await listenProbe(setupPolicy, "127.0.0.1", true, true)),
  });
  listeners.push({
    mode: "setup",
    ...(await listenProbe(setupPolicy, "127.0.0.1", true, false, true)),
  });
  const receipt = {
    root,
    outcome: output.trim(),
    setupBoundaryOutput: setupBoundaryOutput.trim(),
    policy,
    setupPolicy,
    listeners,
  };
  fs.writeFileSync(
    path.join(root, "receipt.json"),
    JSON.stringify(receipt, null, 2),
  );
  console.log(JSON.stringify({ root, outcome: receipt.outcome }));
} finally {
  for (const s of servers) await new Promise((r) => s.close(r));
  fs.unlinkSync(homeCanary);
}
