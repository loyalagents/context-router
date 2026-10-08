import * as fs from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { Socket } from "node:net";
import { spawnSync } from "node:child_process";
import { isMainThread } from "node:worker_threads";
import { StorageUnavailableError } from "../../domains/shared/storage/storage-errors";
import { assertRoot, privateRoot, regular, samePin, pin, type RootPin, type FilePin } from "../filesystem/private-files";

type Inode = Readonly<{ dev: number; ino: number }>;
export interface ManagedCapability {
  version: 1;
  epoch: 1;
  envelope: string;
  installationId: string;
  storeId: string;
  generation: string;
  bootId: string;
  role: "prepare" | "application" | "maintenance";
  operation: "initialize" | "verify" | "resume-setup" | "serve" | "admin" | "backup" | "restore" | "recover-bootstrap" | "recover-identity" | "initialize-recovered";
  nonce: string;
  envelopePin: Inode;
  lockPin: Inode;
  dataPin: Inode | null;
  identityPin: Inode | null;
  targetId: string | null;
}
export interface ManagedWorkerAdmission {
  capability: ManagedCapability;
  guardianExecutable: string;
  stop: SharedArrayBuffer;
}
interface Admission extends ManagedWorkerAdmission {
  roots: Map<string, RootPin>;
  installationPin: FilePin;
  journalPin: FilePin;
}
let attempted = false;
let revoked = false;
let admitted: Admission | undefined;
let bootstrapScratch: string | undefined;
const modelInvalidation = new AbortController();
const fail = (): never => { throw new StorageUnavailableError(); };
const exact = (value: any, keys: string[]): boolean => value !== null && typeof value === "object" &&
  !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(key => Object.prototype.hasOwnProperty.call(value, key));
const id = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{32}$/.test(value);
const inode = (value: unknown): value is Inode => exact(value, ["dev", "ino"]) &&
  ["dev", "ino"].every(key => Number.isSafeInteger(value[key]) && value[key] >= 0);
const matches = (value: fs.Stats, expected: Inode): boolean => value.dev === expected.dev && value.ino === expected.ino;
const pairPaths = (cap: ManagedCapability) => {
  const store = join(cap.envelope, "stores", cap.storeId);
  return { store, data: join(store, "data"), identity: join(store, "identity") };
};

/** Parsing is deliberately separate from authority: no parsed value grants access. */
export function validateManagedCapability(value: unknown): ManagedCapability {
  const v = value as ManagedCapability;
  if (!exact(v, ["version", "epoch", "envelope", "installationId", "storeId", "generation", "bootId", "role", "operation", "nonce", "envelopePin", "lockPin", "dataPin", "identityPin", "targetId"]) ||
    v.version !== 1 || v.epoch !== 1 || typeof v.envelope !== "string" || v.envelope.length > 4096 ||
    !isAbsolute(v.envelope) || resolve(v.envelope) !== v.envelope || basename(v.envelope) !== "managed-v1" || v.envelope.includes("\0") ||
    !id(v.installationId) || !id(v.storeId) || !id(v.generation) ||
    typeof v.bootId !== "string" || !/^[A-Za-z0-9-]{1,64}$/.test(v.bootId) ||
    typeof v.nonce !== "string" || !/^[a-f0-9]{64}$/.test(v.nonce) ||
    !inode(v.envelopePin) || !inode(v.lockPin) || (v.dataPin !== null && !inode(v.dataPin)) ||
    (v.identityPin !== null && !inode(v.identityPin)) ||
    (v.targetId !== null && (typeof v.targetId !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(v.targetId)))) fail();
  const operations = {
    prepare: ["initialize", "initialize-recovered", "verify", "resume-setup"],
    application: ["serve"],
    maintenance: ["admin", "backup", "restore", "recover-bootstrap", "recover-identity", "resume-setup"],
  };
  if (!Object.prototype.hasOwnProperty.call(operations, v.role) || !operations[v.role].includes(v.operation)) fail();
  if ((v.role === "application" || ["verify", "admin", "backup"].includes(v.operation)) &&
    (!v.dataPin || !v.identityPin || v.targetId === null)) fail();
  if (v.operation === "recover-identity" && (!v.dataPin || !v.identityPin)) fail();
  if (v.operation === "initialize-recovered" && !v.dataPin) fail();
  return Object.freeze({ ...v, envelopePin: Object.freeze({ ...v.envelopePin }), lockPin: Object.freeze({ ...v.lockPin }),
    dataPin: v.dataPin && Object.freeze({ ...v.dataPin }), identityPin: v.identityPin && Object.freeze({ ...v.identityPin }) });
}

/** Reserved outside strict store roots, including when metadata is absent or corrupt. */
export function managedEnvelopeForPath(value: string): string | undefined {
  if (typeof value !== "string") return undefined;
  let current = resolve(value);
  while (true) {
    if (basename(current) === "managed-v1") return current;
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

function readPrivateJson(file: string): { value: any; filePin: FilePin } {
  const before = regular(file);
  if (before.size < 2 || before.size > 16384) fail();
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const opened = fs.fstatSync(fd);
    if (!samePin(opened, pin(before)) || opened.size !== before.size) fail();
    const bytes = Buffer.alloc(before.size + 1);
    const count = fs.readSync(fd, bytes, 0, bytes.length, 0);
    const after = regular(file);
    if (count !== before.size || !samePin(after, pin(before)) || before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs || before.size !== after.size) fail();
    return { value: JSON.parse(bytes.subarray(0, count).toString("utf8")), filePin: pin(before) };
  } finally { fs.closeSync(fd); }
}

function checkMetadata(a: Admission): void {
  const c = a.capability;
  const installation = readPrivateJson(join(c.envelope, "installation.json"));
  const i = installation.value;
  if (!samePin(installation.filePin as fs.Stats, a.installationPin) ||
    !exact(i, ["version", "installationId", "selectedStore", "minimumEpoch", "setup", "pendingRestore"]) ||
    i.version !== 1 || i.installationId !== c.installationId || !id(i.selectedStore) ||
    !Number.isSafeInteger(i.minimumEpoch) || i.minimumEpoch < 1 || i.minimumEpoch > c.epoch ||
    !["initializing", "ready", "failed"].includes(i.setup)) fail();
  if (i.pendingRestore !== null) {
    const p = i.pendingRestore;
    if (!exact(p, ["storeId", "sourceDigest", "expectedSelection", "status"]) || !id(p.storeId) ||
      typeof p.sourceDigest !== "string" || !/^[a-f0-9]{64}$/.test(p.sourceDigest) || p.expectedSelection !== i.selectedStore ||
      !["reserved", "complete", "failed"].includes(p.status) || c.role !== "maintenance" ||
      c.storeId !== p.storeId || !["restore", "admin"].includes(c.operation)) fail();
  } else if (i.selectedStore !== c.storeId || c.operation === "restore") fail();
  if ((c.role === "application" || c.operation === "verify") && i.setup !== "ready") fail();
  if (c.operation === "initialize" && i.setup !== "initializing") fail();
  if (c.operation === "initialize-recovered" && i.setup === "ready") fail();
  const journal = readPrivateJson(join(c.envelope, "owner.json"));
  const j = journal.value;
  if (!samePin(journal.filePin as fs.Stats, a.journalPin) ||
    !exact(j, ["version", "lifecycle", "outcome", "generation", "bootId", "installationId", "storeId", "role", "operation", "nonceHash"]) ||
    j.version !== 1 || j.lifecycle !== "active" || j.outcome !== "pending" || j.generation !== c.generation ||
    j.bootId !== c.bootId || j.installationId !== c.installationId || j.storeId !== c.storeId ||
    j.role !== c.role || j.operation !== c.operation || j.nonceHash !== createHash("sha256").update(c.nonce).digest("hex")) fail();
}

function checkCurrent(a: Admission): void {
  try { checkCurrentState(a); }
  catch {
    revoked = true;
    modelInvalidation.abort();
    Atomics.store(new Int32Array(a.stop), 0, 1);
    Atomics.notify(new Int32Array(a.stop), 0);
    fail();
  }
}
function checkCurrentState(a: Admission): void {
  if (revoked || Atomics.load(new Int32Array(a.stop), 0) !== 0) fail();
  const c = a.capability;
  const lock = regular(join(c.envelope, "owner.lock"));
  if (!matches(lock, c.lockPin) || !matches(fs.fstatSync(3), c.lockPin)) fail();
  for (const root of a.roots.values()) assertRoot(root);
  checkMetadata(a);
  const pair = pairPaths(c);
  if (!a.roots.has(pair.store)) {
    try {
      fs.lstatSync(pair.store);
      a.roots.set(pair.store, privateRoot(pair.store));
    }
    catch (error) {
      if (c.operation !== "restore" || (error as NodeJS.ErrnoException)?.code !== "ENOENT") throw error;
    }
  }
  for (const [file, expected] of [[pair.data, c.dataPin], [pair.identity, c.identityPin]] as const) {
    if (a.roots.has(file)) continue;
    try {
      const s = fs.lstatSync(file);
      if (expected && !matches(s, expected)) fail();
      a.roots.set(file, privateRoot(file));
    } catch (error) {
      if (expected || (error as NodeJS.ErrnoException)?.code !== "ENOENT") throw error;
    }
  }
}

function establish(value: ManagedWorkerAdmission): void {
  if (revoked || !(value.stop instanceof SharedArrayBuffer) || value.stop.byteLength !== 4 ||
    Atomics.load(new Int32Array(value.stop), 0) !== 0) fail();
  const capability = validateManagedCapability(value.capability);
  const executable = value.guardianExecutable;
  if (typeof executable !== "string" || !isAbsolute(executable) || resolve(executable) !== executable ||
    executable.length > 4096 || executable.includes("\0")) fail();
  const stat = fs.lstatSync(executable);
  if (!stat.isFile() || (stat.mode & 0o022) !== 0 || stat.nlink !== 1 || fs.realpathSync(executable) !== executable) fail();
  const root = privateRoot(capability.envelope);
  if (!matches(fs.lstatSync(capability.envelope), capability.envelopePin)) fail();
  const store = pairPaths(capability).store;
  const roots = new Map([[capability.envelope, root], [dirname(store), privateRoot(dirname(store))]]);
  // The existing restore contract itself claims the absent destination.
  // Parent admission must not precreate that directory.
  if (capability.operation !== "restore") roots.set(store, privateRoot(store));
  const a: Admission = { ...value, capability, roots,
    installationPin: readPrivateJson(join(capability.envelope, "installation.json")).filePin,
    journalPin: readPrivateJson(join(capability.envelope, "owner.json")).filePin };
  checkCurrent(a);
  // Trusted packaged caller supplies its sibling guardian, never a path from FD4/env.
  // Check the held open-file description, not merely a matching file inode.
  const checked = spawnSync(executable, ["verify-inherited"], {
    stdio: ["ignore", "pipe", "ignore", 3], env: {}, timeout: 2000, maxBuffer: 1024, encoding: "utf8",
  });
  if (checked.error || checked.status !== 0 || checked.stdout !== `${capability.bootId}\n`) fail();
  checkCurrent(a);
  admitted = a;
  // A worker detecting a broken authority must also interrupt its parent's AI.
  // Pinned Node 24 provides waitAsync; the retained backend TS lib target predates it.
  const atomic = Atomics as typeof Atomics & {
    waitAsync(array: Int32Array, index: number, value: number):
      { async: true; value: Promise<string> } | { async: false; value: string };
  };
  const observed = atomic.waitAsync(new Int32Array(a.stop), 0, 0);
  if (observed.async) void observed.value.then(() => modelInvalidation.abort());
  else modelInvalidation.abort();
}

/** FD4 is a fresh anonymous pipe, consumed and closed only by the main thread. */
export async function admitManagedProcess(guardianExecutable: string): Promise<ManagedCapability> {
  if (attempted || !isMainThread) fail();
  attempted = true;
  try {
    if (!fs.fstatSync(4).isFIFO()) fail();
    const bytes = await new Promise<Buffer>((accept, reject) => {
      // libuv makes the anonymous pipe nonblocking; destroy really closes it on timeout.
      const stream = new Socket({ fd: 4, readable: true, writable: false });
      let size = 0;
      const chunks: Buffer[] = [];
      const timer = setTimeout(() => stream.destroy(new StorageUnavailableError()), 5000);
      stream.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > 16384) stream.destroy(new StorageUnavailableError());
        else chunks.push(chunk);
      });
      stream.once("error", () => { clearTimeout(timer); reject(new StorageUnavailableError()); });
      stream.once("end", () => { clearTimeout(timer); accept(Buffer.concat(chunks)); });
    });
    if (!bytes.length) fail();
    establish({ capability: JSON.parse(bytes.toString("utf8")), guardianExecutable, stop: new SharedArrayBuffer(4) });
    return admitted.capability;
  } catch { revokeManagedAdmission(); return fail(); }
}

/** Workers never read/close FD3 or FD4 and cannot replace the parent's revocation flag. */
export function admitManagedWorker(value: ManagedWorkerAdmission | undefined): void {
  if (value === undefined) return;
  if (attempted || isMainThread) fail();
  attempted = true;
  try { establish(value); } catch {
    // Establishment may fail before `admitted` is assigned. Revocation still
    // reaches the parent's explicitly supplied shared flag; it grants no access.
    if (value?.stop instanceof SharedArrayBuffer && value.stop.byteLength === 4) {
      Atomics.store(new Int32Array(value.stop), 0, 1);
      Atomics.notify(new Int32Array(value.stop), 0);
    }
    revokeManagedAdmission(); fail();
  }
}
export function managedWorkerAdmission(): ManagedWorkerAdmission | undefined {
  if (!admitted) { if (attempted) fail(); return undefined; }
  checkCurrent(admitted);
  return { capability: admitted.capability, guardianExecutable: admitted.guardianExecutable, stop: admitted.stop };
}
export function managedCapability(): ManagedCapability {
  if (!admitted) fail();
  checkCurrent(admitted);
  return admitted.capability;
}
export function managedApplication(): boolean {
  if (!admitted) { if (attempted) fail(); return false; }
  return managedCapability().role === "application";
}
export function assertManagedSchemaUpgrade(): void {
  if (!admitted) { if (attempted) fail(); return; }
  const c = managedCapability();
  if (!(c.role === "prepare" && ["initialize", "initialize-recovered", "resume-setup"].includes(c.operation)) &&
      !(c.role === "maintenance" && c.operation === "admin")) fail();
}
export function revokeManagedAdmission(): void {
  revoked = true;
  modelInvalidation.abort();
  if (admitted) {
    Atomics.store(new Int32Array(admitted.stop), 0, 1);
    Atomics.notify(new Int32Array(admitted.stop), 0);
  }
}

/** Model loss/sleep invalidates AI only; the non-AI application remains usable. */
export function invalidateManagedModel(): void {
  if (!admitted || admitted.capability.role !== "application") fail();
  modelInvalidation.abort();
}
export function managedModelAuthority(configuration: { root: string; databaseRoot: string; identityRoot: string }):
  { signal: AbortSignal; assertHeld(): void } | undefined {
  assertManagedPathsAccess(configuration?.databaseRoot, configuration?.identityRoot);
  if (!admitted) {
    if (managedEnvelopeForPath(configuration?.root)) fail();
    return undefined;
  }
  assertManagedDatabasePaths(configuration.databaseRoot, configuration.identityRoot);
  const c = admitted.capability;
  if (c.role !== "application" || configuration.root !== join(c.envelope, "sessions", c.generation)) fail();
  return { signal: modelInvalidation.signal, assertHeld: () => checkCurrent(admitted) };
}
export function managedLifetimeDescriptor(): number | undefined {
  if (!admitted) { if (attempted) fail(); return undefined; }
  checkCurrent(admitted);
  return 3;
}

/** Cached authority, current journal and pinned paths are rechecked at every storage boundary. */
export function assertManagedPathsAccess(...paths: string[]): void {
  if (!admitted) {
    if (attempted || paths.some(value => managedEnvelopeForPath(value) !== undefined)) fail();
    return;
  }
  try {
    checkCurrent(admitted);
    const pair = pairPaths(admitted.capability);
    if (paths.some(value => value !== pair.data && value !== pair.identity && value !== bootstrapScratch)) fail();
  } catch { revokeManagedAdmission(); fail(); }
}
export function assertManagedTarget(target: string): void {
  if (!admitted) { if (attempted) fail(); return; }
  checkCurrent(admitted);
  if (admitted.capability.targetId !== null && admitted.capability.targetId !== target) {
    revokeManagedAdmission(); fail();
  }
}

export function assertManagedDatabasePaths(databaseRoot: string, identityRoot: string,
  operation: "open" | "bootstrap" | "recover-bootstrap" = "open"): void {
  assertManagedPathsAccess(databaseRoot, identityRoot);
  if (!admitted) return;
  const c = admitted.capability, pair = pairPaths(c);
  if ((databaseRoot !== pair.data && !(operation === "open" && databaseRoot === bootstrapScratch)) || identityRoot !== pair.identity ||
    (operation === "bootstrap" && (c.role !== "prepare" || c.operation !== "initialize")) ||
    (operation === "recover-bootstrap" && (c.role !== "maintenance" || c.operation !== "recover-bootstrap"))) {
    revokeManagedAdmission(); fail();
  }
}

export function assertManagedIdentityMutation(): void {
  if (!admitted) { if (attempted) fail(); return; }
  checkCurrent(admitted);
  const c = admitted.capability;
  if (!((c.role === "prepare" && ["initialize", "initialize-recovered"].includes(c.operation)) ||
    (c.role === "maintenance" && ["admin", "recover-identity"].includes(c.operation)))) fail();
}
export function assertManagedIdentityOperation(operation: "initialize" | "rotate" | "recover"): void {
  assertManagedIdentityMutation();
  if (!admitted) return;
  const c = admitted.capability;
  const allowed = operation === "initialize" ? c.role === "prepare" && ["initialize", "initialize-recovered"].includes(c.operation) :
    c.role === "maintenance" && (operation === "recover" ? ["admin", "recover-identity"].includes(c.operation) : c.operation === "admin");
  if (!allowed) fail();
}

/** Only the pre-acquire recovery implementation delegates its newly owned scratch. */
export function withManagedBootstrapScratch<T>(databaseRoot: string, identityRoot: string, scratch: string, body: () => T): T {
  assertManagedDatabasePaths(databaseRoot, identityRoot, "recover-bootstrap");
  if (!admitted) return body();
  if (bootstrapScratch || dirname(scratch) !== dirname(databaseRoot) || !/^database-bootstrap-check-[A-Za-z0-9]{6}$/.test(basename(scratch))) fail();
  admitted.roots.set(scratch, privateRoot(scratch));
  bootstrapScratch = scratch;
  try { return body(); }
  finally { bootstrapScratch = undefined; admitted.roots.delete(scratch); }
}

export function assertManagedBackupDestination(destination: string): void {
  if (!admitted) {
    if (attempted || managedEnvelopeForPath(destination)) fail();
    return;
  }
  checkCurrent(admitted);
  const c = admitted.capability;
  const exports = join(c.envelope, "exports");
  if (c.role !== "maintenance" || c.operation !== "backup" || destination !== join(exports, c.generation)) fail();
  if (!admitted.roots.has(exports)) admitted.roots.set(exports, privateRoot(exports));
}
export function assertManagedRestoreDestination(destination: string): void {
  if (!admitted) {
    if (attempted || managedEnvelopeForPath(destination)) fail();
    return;
  }
  checkCurrent(admitted);
  const c = admitted.capability;
  if (c.role !== "maintenance" || c.operation !== "restore" || destination !== pairPaths(c).store) fail();
}
export function assertManagedBackupSource(source: string): void {
  if (!admitted) {
    if (attempted || managedEnvelopeForPath(source)) fail();
    return;
  }
  checkCurrent(admitted);
  const c = admitted.capability;
  if (c.role !== "maintenance" || c.operation !== "restore") fail();
  if (managedEnvelopeForPath(source) && (dirname(source) !== join(c.envelope, "exports") || !id(basename(source)))) fail();
}
export function assertManagedRestoreSourceDigest(marker: Buffer): void {
  if (!admitted) { if (attempted) fail(); return; }
  checkCurrent(admitted);
  const c = admitted.capability;
  if (c.role !== "maintenance" || c.operation !== "restore") fail();
  const i = readPrivateJson(join(c.envelope, "installation.json")).value;
  if (i.pendingRestore.sourceDigest !== createHash("sha256").update(marker).digest("hex")) fail();
}
