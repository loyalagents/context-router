import * as fs from "node:fs";
import * as path from "node:path";
import { StorageUnavailableError } from "../../domains/shared/storage/storage-errors";

export interface FilePin {
  dev: number;
  ino: number;
  uid: number;
  mode: number;
}
export interface RootPin {
  path: string;
  ancestors: Array<{ path: string; pin: FilePin }>;
}
export const unavailable = (): never => {
  throw new StorageUnavailableError();
};
export const pin = (s: fs.Stats): FilePin => ({
  dev: s.dev,
  ino: s.ino,
  uid: s.uid,
  mode: s.mode,
});
export const samePin = (s: fs.Stats, p: FilePin): boolean =>
  s.dev === p.dev && s.ino === p.ino && s.uid === p.uid && s.mode === p.mode;
export const missing = (e: unknown) => (e as NodeJS.ErrnoException)?.code === "ENOENT";
export function exists(file: string): boolean {
  try {
    fs.lstatSync(file);
    return true;
  } catch (e) {
    if (missing(e)) return false;
    unavailable();
  }
}
export function ancestry(target: string): RootPin {
  const paths: string[] = [path.parse(target).root];
  for (const part of target
    .slice(paths[0].length)
    .split(path.sep)
    .filter(Boolean))
    paths.push(path.join(paths[paths.length - 1], part));
  const stats = paths.map((file) => fs.lstatSync(file));
  stats.forEach((s, i) => {
    if (!s.isDirectory() || (s.uid !== 0 && s.uid !== process.getuid()))
      unavailable();
    if (
      (s.mode & 0o022) !== 0 &&
      !(
        s.uid === 0 &&
        (s.mode & 0o1000) !== 0 &&
        stats[i + 1]?.uid === process.getuid()
      )
    )
      unavailable();
  });
  if (fs.realpathSync(target) !== target) unavailable();
  const result = {
    path: target,
    ancestors: paths.map((file, i) => ({ path: file, pin: pin(stats[i]) })),
  };
  assertRoot(result);
  return result;
}
export function assertRoot(root: RootPin): void {
  for (const item of root.ancestors) {
    const s = fs.lstatSync(item.path);
    if (!s.isDirectory() || !samePin(s, item.pin)) unavailable();
  }
}
export function privateRoot(target: string, create = false): RootPin {
  if (!exists(target)) {
    if (!create) unavailable();
    const parent = ancestry(path.dirname(target));
    const s = fs.lstatSync(parent.path);
    if (s.uid !== process.getuid() || (s.mode & 0o7777) !== 0o700)
      unavailable();
    fs.mkdirSync(target, { mode: 0o700 });
    assertRoot(parent);
    syncDirectory(parent);
  }
  const root = ancestry(target);
  const s = fs.lstatSync(target);
  if (s.uid !== process.getuid() || (s.mode & 0o7777) !== 0o700) unavailable();
  return root;
}
export function regular(file: string, links = 1): fs.Stats {
  const s = fs.lstatSync(file);
  if (
    !s.isFile() ||
    s.uid !== process.getuid() ||
    (s.mode & 0o7777) !== 0o600 ||
    s.nlink !== links
  )
    unavailable();
  return s;
}
export function syncDirectory(root: RootPin): void {
  assertRoot(root);
  const fd = fs.openSync(
    root.path,
    fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW,
  );
  try {
    if (
      !samePin(fs.fstatSync(fd), root.ancestors[root.ancestors.length - 1].pin)
    )
      unavailable();
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  assertRoot(root);
}
