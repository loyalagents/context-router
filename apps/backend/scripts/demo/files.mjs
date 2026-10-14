import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
export const safeError = message => Object.assign(new Error(message), { demoSafeMessage: message });
export const writeJson = (file, value) => fs.writeFile(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
export const cleanEnvironment = () => ({ PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`, LANG: 'en_US.UTF-8', NEXT_TELEMETRY_DISABLED: '1' });

export async function privatePath(name, directory = false) {
  if (!path.isAbsolute(name) || path.resolve(name) !== name || await fs.realpath(name) !== name) throw safeError('Private demo paths must be canonical and must not contain links.');
  const s = await fs.lstat(name);
  if (s.uid !== process.getuid() || (s.mode & 0o7777) !== (directory ? 0o700 : 0o600) ||
      !(directory ? s.isDirectory() : s.isFile() && s.nlink === 1 && s.size <= 16 * 1024 * 1024)) throw safeError('Invalid private demo path ownership, type or permissions.');
  return s;
}
export async function privateBytes(file) {
  const before = await privatePath(file), handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const opened = await handle.stat();
    if (opened.ino !== before.ino || opened.dev !== before.dev) throw new Error();
    const data = await handle.readFile(), after = await handle.stat();
    if (data.length !== before.size || after.ctimeMs !== before.ctimeMs || after.mtimeMs !== before.mtimeMs) throw new Error();
    return data;
  } finally { await handle.close(); }
}
export const privateJson = async file => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await privateBytes(file)));
