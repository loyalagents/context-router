import { createRequire } from 'node:module';
import path from 'node:path';
import { constants, lstatSync, realpathSync, openSync, writeSync, fsyncSync, closeSync, readSync, fstatSync } from 'node:fs';
import { openManagedControl } from './control.mjs';
export const resources = path.resolve(import.meta.dirname, '../..');
export const webRoot = path.join(resources, 'app');
export const backend = createRequire(path.join(webRoot, 'local-ui.mjs'));
export const authority = backend('backend/dist/infrastructure/managed/managed-admission.js');
export const nativeOwners = backend('backend/dist/infrastructure/storage/sqlite/sqlite-database.js');
export const guardian = path.resolve(resources, '../MacOS/context-router');
const failure = () => new Error('Managed runtime unavailable');
export async function admit(role, onCommand = () => {}) {
  let cap, control;
  try {
    cap = await authority.admitManagedProcess(guardian);
    if (cap.role !== role) throw failure();
    control = await openManagedControl(cap.generation, { onStop: () => authority.revokeManagedAdmission(), onCommand });
    for (const signal of ['SIGINT','SIGTERM']) process.once(signal, () => control.end());
  } catch { authority.revokeManagedAdmission(); await control?.close().catch(() => {}); throw failure(); }
  const store = path.join(cap.envelope, 'stores', cap.storeId);
  return { cap, control, configuration: Object.freeze({ kind: 'sqlite', databaseRoot: path.join(store,'data'), stateRoot: path.join(store,'identity') }),
    session: path.join(cap.envelope, 'sessions', cap.generation), exports: path.join(cap.envelope, 'exports', cap.generation) };
}
export function privateDirectory(root) {
  const s = lstatSync(root);
  if (!s.isDirectory() || s.uid !== process.getuid() || (s.mode & 0o7777) !== 0o700 || realpathSync(root) !== root) throw failure();
  return { dev: s.dev, ino: s.ino };
}
export function writePrivate(root, name, bytes) {
  authority.managedCapability(); const before = privateDirectory(root);
  if (!/^[a-z][a-z0-9.-]{0,63}$/.test(name) || Buffer.byteLength(bytes) > 16384) throw failure();
  const file = openSync(path.join(root,name), constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW, 0o600);
  try { let offset = 0, data = Buffer.from(bytes); while (offset < data.length) { const count=writeSync(file,data,offset,data.length-offset); if(!count)throw failure(); offset += count; } fsyncSync(file); }
  finally { closeSync(file); }
  const dir = openSync(root, constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
  try { fsyncSync(dir); } finally { closeSync(dir); }
  const after = privateDirectory(root);
  if (after.dev !== before.dev || after.ino !== before.ino) throw failure(); authority.managedCapability();
}
export function readPrivate(root, name) {
  authority.managedCapability(); privateDirectory(root);
  const file = path.join(root,name), before = lstatSync(file);
  if (!before.isFile() || before.uid !== process.getuid() || (before.mode & 0o7777) !== 0o600 || before.nlink !== 1 || before.size < 1 || before.size > 16384) throw failure();
  const fd = openSync(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK), data = Buffer.alloc(before.size+1);
  try {
    const opened = fstatSync(fd), count=readSync(fd,data,0,data.length,0), after=lstatSync(file);
    if ([opened,after].some(s=>s.dev!==before.dev||s.ino!==before.ino||s.size!==before.size||s.mode!==before.mode||s.mtimeMs!==before.mtimeMs||s.ctimeMs!==before.ctimeMs)||count!==before.size) throw failure();
    authority.managedCapability(); return data.subarray(0,count);
  } finally { closeSync(fd); }
}
