import * as fs from "node:fs";
import * as path from "node:path";
import { StorageUnavailableError } from "../../../domains/shared/storage/storage-errors";

export const DATABASE_BASENAME = "database.sqlite";
export const JOURNAL_MAGIC = Buffer.from("d9d505f920a163d7", "hex");
export const BOOTSTRAP_NAME = /^bootstrap-[a-f0-9]{32}\.sqlite$/;
export interface LocalDatabasePaths {
  databaseRoot: string;
  identityRoot: string;
  expectedTarget?: string;
}
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
const missing = (e: unknown) => (e as NodeJS.ErrnoException)?.code === "ENOENT";
export function exists(file: string): boolean {
  try {
    fs.lstatSync(file);
    return true;
  } catch (e) {
    if (missing(e)) return false;
    unavailable();
  }
}
export function validatePaths(options: LocalDatabasePaths): void {
  if (typeof process.getuid !== "function") unavailable();
  for (const value of [options.databaseRoot, options.identityRoot]) {
    if (
      typeof value !== "string" ||
      !path.isAbsolute(value) ||
      path.resolve(value) !== value ||
      path.parse(value).root === value ||
      value.includes("\0")
    )
      unavailable();
  }
  const [a, b] = [options.databaseRoot, options.identityRoot];
  if (a === b || a.startsWith(b + path.sep) || b.startsWith(a + path.sep))
    unavailable();
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
export function requireEmptyIdentity(target: string): void {
  if (!exists(target)) {
    ancestry(path.dirname(target));
    return;
  }
  const root = privateRoot(target);
  if (fs.readdirSync(target).length !== 0) unavailable();
  assertRoot(root);
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
const sameContent = (a: fs.Stats, b: fs.Stats) =>
  samePin(a, pin(b)) &&
  a.nlink === b.nlink &&
  a.size === b.size &&
  a.mtimeMs === b.mtimeMs &&
  a.ctimeMs === b.ctimeMs;
/** Never open a raw descriptor to the main database: that can cancel SQLite's POSIX locks. */
export function inspectJournal(file: string): void {
  if (!exists(file)) return;
  const before = regular(file);
  const fd = fs.openSync(
    file,
    fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK,
  );
  try {
    const opened = fs.fstatSync(fd);
    if (!sameContent(before, opened)) unavailable();
    if (opened.size > 0 && opened.size < 8) unavailable();
    if (opened.size >= 8) {
      const header = Buffer.alloc(8),
        footer = Buffer.alloc(8);
      if (
        fs.readSync(fd, header, 0, 8, 0) !== 8 ||
        fs.readSync(fd, footer, 0, 8, opened.size - 8) !== 8
      )
        unavailable();
      // Pinned SQLite 3.53.4 readSuperJournal requires this suffix; never parse or follow its path.
      if (
        footer.equals(JOURNAL_MAGIC) ||
        (!header.equals(JOURNAL_MAGIC) && !header.equals(Buffer.alloc(8)))
      )
        unavailable();
    }
    if (
      !sameContent(opened, fs.fstatSync(fd)) ||
      !sameContent(opened, regular(file))
    )
      unavailable();
  } finally {
    fs.closeSync(fd);
  }
}
export function admitFile(
  root: RootPin,
  basename = DATABASE_BASENAME,
): FilePin {
  assertRoot(root);
  const file = path.join(root.path, basename);
  const s = regular(file);
  if (s.size < 100) unavailable();
  assertEntries(root, basename);
  inspectJournal(file + "-journal");
  if (!sameContent(s, regular(file))) unavailable();
  assertRoot(root);
  return pin(s);
}
export function assertEntries(
  root: RootPin,
  basename = DATABASE_BASENAME,
): void {
  assertRoot(root);
  for (const name of fs.readdirSync(root.path)) {
    if (name !== basename && name !== basename + "-journal") unavailable();
    regular(path.join(root.path, name));
  }
}
export function assertDatabase(
  root: RootPin,
  filePin: FilePin,
  basename = DATABASE_BASENAME,
): void {
  assertEntries(root, basename);
  if (!samePin(regular(path.join(root.path, basename)), filePin)) unavailable();
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
/** Called only for a closed bootstrap file, never for a live SQLite database. */
export function syncClosedFile(file: string): void {
  const before = regular(file);
  const fd = fs.openSync(
    file,
    fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK,
  );
  try {
    if (!sameContent(before, fs.fstatSync(fd))) unavailable();
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  if (!sameContent(before, regular(file))) unavailable();
}
