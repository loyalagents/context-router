// Owned source browser only: no Next server, personal profile, OS trust or TLS bypass.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { X509Certificate, createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";
import { localUiBrowserPrerequisite } from "../../scripts/local-migration/local-ui-browser.mjs";
const require = createRequire(import.meta.url);
const {
  readSource,
} = require("../backend/dist/infrastructure/hcp-experiment/source.js");
const {
  privateRoot,
  regular,
  pin,
  samePin,
  syncDirectory,
} = require("../backend/dist/infrastructure/filesystem/private-files.js");
const repository = path.resolve(import.meta.dirname, "../..");
const refused = () => {
  throw new Error(
    "Owned source browser refused; preserve its profile and ownership record. No repair attempted.",
  );
};
const BROWSER_EXIT_WAIT_MS = 5_000;
function isStopped(pid) {
  if (pid === null) return true;
  if (!Number.isSafeInteger(pid) || pid <= 0) refused();
  try {
    process.kill(pid, 0);
  } catch (e) {
    if (e.code === "ESRCH") return true;
    refused();
  }
  return false;
}
function stopped(pid) {
  if (!isStopped(pid)) refused();
}
async function awaitStopped(pid) {
  const deadline = performance.now() + BROWSER_EXIT_WAIT_MS;
  while (!isStopped(pid)) {
    if (performance.now() >= deadline) refused();
    // A protocol disconnect can precede child reaping. Keep the lease while the
    // event loop reaps it; never signal a possibly live/reused recorded PID.
    await delay(25);
  }
}
function browserLease(root) {
  const directory = privateRoot(root),
    file = path.join(root, "owner.sqlite");
  let fresh = false;
  try {
    const fd = fs.openSync(
      file,
      fs.constants.O_CREAT |
        fs.constants.O_EXCL |
        fs.constants.O_WRONLY |
        fs.constants.O_NOFOLLOW,
      0o600,
    );
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fresh = true;
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
  }
  const filePin = pin(regular(file));
  if (fs.existsSync(file + "-journal")) regular(file + "-journal");
  const db = new DatabaseSync(file, { timeout: 0, allowExtension: false });
  try {
    db.exec(
      "PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA fullfsync=ON; PRAGMA locking_mode=EXCLUSIVE; BEGIN EXCLUSIVE",
    );
    if (fresh) {
      db.exec(
        "PRAGMA application_id=1127629378; PRAGMA user_version=1; CREATE TABLE owner(singleton INTEGER PRIMARY KEY CHECK(singleton=1),controller INTEGER,browser INTEGER,phase TEXT NOT NULL,trust TEXT); INSERT INTO owner VALUES(1,NULL,NULL,'closed',NULL)",
      );
    } else if (
      db.prepare("PRAGMA application_id").get().application_id !== 1127629378 ||
      db.prepare("PRAGMA user_version").get().user_version !== 1
    )
      refused();
    const rows = db.prepare("SELECT * FROM owner").all();
    if (rows.length !== 1) refused();
    const previous = rows[0];
    stopped(previous.controller);
    stopped(previous.browser);
    if (
      previous.phase !== "closed" &&
      (previous.phase !== "running" || previous.browser === null)
    )
      refused();
    db.exec("COMMIT");
    syncDirectory(directory);
    const update = (phase, browser, trust = previous.trust) => {
      if (!samePin(regular(file), filePin)) refused();
      db.exec("BEGIN EXCLUSIVE");
      db.prepare(
        "UPDATE owner SET controller=?,browser=?,phase=?,trust=? WHERE singleton=1",
      ).run(phase === "closed" ? null : process.pid, browser, phase, trust);
      db.exec("COMMIT");
    };
    update("starting", null);
    return {
      trust: previous.trust,
      update,
      close() {
        db.close();
      },
    };
  } catch (e) {
    db.close();
    throw e;
  }
}
function browserPid(profile) {
  const link = fs.readlinkSync(path.join(profile, "SingletonLock")),
    prefix = os.hostname() + "-";
  if (!link.startsWith(prefix) || !/^\d+$/.test(link.slice(prefix.length)))
    refused();
  const pid = Number(link.slice(prefix.length));
  if (!Number.isSafeInteger(pid) || pid <= 0) refused();
  return pid;
}
export async function openSourceBrowser(sandbox, { headless = false } = {}) {
  const source = readSource(sandbox),
    browserPin = localUiBrowserPrerequisite(repository);
  const browserRoot = path.join(sandbox, "browser"),
    profile = path.join(browserRoot, "profile");
  const lease = browserLease(browserRoot),
    ca = new X509Certificate(source.tls.ca).raw;
  const fingerprint = createHash("sha256").update(ca).digest("hex");
  let context,
    pid,
    launchUnproven = false,
    trustReady = lease.trust === fingerprint;
  const options = {
    executablePath: browserPin.executable,
    headless,
    ignoreHTTPSErrors: false,
    handleSIGINT: false,
    handleSIGTERM: false,
    handleSIGHUP: false,
    timeout: 15_000,
    args: [
      "--host-resolver-rules=MAP as.hcp.test 127.0.0.1",
      "--no-proxy-server",
    ],
    env: {
      PATH: process.env.PATH,
      HOME: browserRoot,
      TMPDIR: browserRoot,
      LANG: "C",
    },
  };
  async function launch() {
    lease.update("starting", null);
    launchUnproven = true;
    context = await chromium.launchPersistentContext(profile, options);
    pid = browserPid(profile);
    lease.update("running", pid, fingerprint);
  }
  async function closeContext() {
    if (context) {
      // Pinned Playwright bounds graceful close at 30s, then kills its owned
      // process group and awaits child cleanup/reaping. No other processes signalled.
      await context.close();
      context = undefined;
      await awaitStopped(pid);
      pid = undefined;
      launchUnproven = false;
    }
  }
  try {
    if (lease.trust === null) {
      if (fs.existsSync(profile)) refused();
      privateRoot(profile, true);
      await launch();
      const setup = await context.newPage();
      await setup.goto("chrome://certificate-manager");
      await setup.waitForSelector("certificate-manager");
      await closeContext();
      lease.update("starting", null, null);
      const certificates = new DatabaseSync(
        path.join(profile, "Default/ServerCertificate"),
      );
      try {
        if (
          certificates.prepare("SELECT count(*) n FROM certificates").get()
            .n !== 0
        )
          refused();
        certificates
          .prepare(
            "INSERT INTO certificates(sha256hash_hex,der_cert,trust_settings) VALUES(?,?,?)",
          )
          .run(fingerprint, ca, Buffer.from([0x0a, 0x02, 0x08, 0x03]));
      } finally {
        certificates.close();
      }
      trustReady = true;
    } else if (lease.trust !== fingerprint) refused();
    privateRoot(profile);
    // Chromium may have been started independently against this owned profile.
    // Its separate lock must also prove stopped before inspecting profile trust.
    try {
      fs.lstatSync(path.join(profile, "SingletonLock"));
      stopped(browserPid(profile));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    // Reopen verifies exactly the owned trust entry; it never edits a running profile.
    privateRoot(path.join(profile, "Default"));
    const trustFile = path.join(profile, "Default/ServerCertificate");
    regular(trustFile);
    const trustDb = new DatabaseSync(trustFile, { readOnly: true });
    try {
      const entries = trustDb
        .prepare(
          "SELECT sha256hash_hex,der_cert,trust_settings FROM certificates",
        )
        .all();
      if (
        entries.length !== 1 ||
        entries[0].sha256hash_hex !== fingerprint ||
        !Buffer.from(entries[0].der_cert).equals(ca) ||
        !Buffer.from(entries[0].trust_settings).equals(
          Buffer.from([0x0a, 0x02, 0x08, 0x03]),
        )
      )
        refused();
    } finally {
      trustDb.close();
    }
    await launch();
    const origin = source.descriptor.configuration.issuer;
    await context.route("**/*", (route) =>
      new URL(route.request().url()).origin === origin
        ? route.continue()
        : route.abort(),
    );
    // Pinned Playwright starts persistent Chromium with about:blank. Close that
    // startup page and open a fresh GET; never select or resubmit a saved form.
    for (const page of context.pages()) await page.close();
    const page = await context.newPage();
    await page.goto(origin + "/manage/entries");
    let closing;
    return {
      context,
      page,
      browserPid: pid,
      close() {
        return (closing ??= (async () => {
          try {
            await closeContext();
            lease.update("closed", null, fingerprint);
          } finally {
            lease.close();
          }
        })());
      },
    };
  } catch (e) {
    try {
      await closeContext();
      if (trustReady && !launchUnproven)
        lease.update("closed", null, fingerprint);
    } finally {
      lease.close();
    }
    // Failed setup is retained. An unproven starting state cannot be repaired on reopen.
    throw e;
  }
}
