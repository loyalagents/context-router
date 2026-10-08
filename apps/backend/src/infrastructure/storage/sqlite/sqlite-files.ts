import * as fs from "node:fs";
import * as path from "node:path";
import { assertRoot, ancestry, privateRoot, regular, samePin, pin, unavailable, exists, missing, syncDirectory, type RootPin, type FilePin } from "../../filesystem/private-files";
export { assertRoot, ancestry, privateRoot, regular, samePin, pin, unavailable, exists, syncDirectory, type RootPin, type FilePin } from "../../filesystem/private-files";

export const DATABASE_BASENAME = "database.sqlite";
export const JOURNAL_MAGIC = Buffer.from("d9d505f920a163d7", "hex");
export const BOOTSTRAP_NAME = /^bootstrap-[a-f0-9]{32}\.sqlite$/;
export interface LocalDatabasePaths {
  databaseRoot: string;
  identityRoot: string;
  expectedTarget?: string;
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
export function requireEmptyIdentity(target: string): void {
  if (!exists(target)) {
    ancestry(path.dirname(target));
    return;
  }
  const root = privateRoot(target);
  if (fs.readdirSync(target).length !== 0) unavailable();
  assertRoot(root);
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
    try {
      regular(path.join(root.path, name));
    } catch (error) {
      // A competing DELETE-journal commit may remove this optional entry after enumeration.
      if (name !== basename + "-journal" || !missing(error)) throw error;
    }
  }
  assertRoot(root);
}
export function assertDatabase(
  root: RootPin,
  filePin: FilePin,
  basename = DATABASE_BASENAME,
): void {
  assertEntries(root, basename);
  if (!samePin(regular(path.join(root.path, basename)), filePin)) unavailable();
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
