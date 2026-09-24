import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { SqliteDatabase, requireNoNativeOwners } from "./sqlite-database";
import {
  SqliteLocalIdentityCoordination,
  type CoordinationWorkerFactory,
} from "./sqlite-local-identity-coordination";
import { LocalIdentityFileStore } from "../../../modules/auth/local-identity-filesystem";
import { decodeLocalIdentityState } from "../../../modules/auth/local-identity-state.codec";
import {
  ancestry,
  assertRoot,
  exists,
  pin,
  privateRoot,
  regular,
  samePin,
  syncClosedFile,
  syncDirectory,
  unavailable,
  type RootPin,
} from "./sqlite-files";

const markerName = "complete.json";
const sha = (value: Buffer) => createHash("sha256").update(value).digest("hex");
const childPaths = (root: string) => ({
  databaseRoot: path.join(root, "data"),
  identityRoot: path.join(root, "identity"),
});
function disjoint(a: string, b: string): void {
  if (a === b || a.startsWith(b + path.sep) || b.startsWith(a + path.sep))
    unavailable();
}
function claim(root: string): RootPin {
  if (!path.isAbsolute(root) || path.resolve(root) !== root || exists(root))
    unavailable();
  const parent = privateRoot(path.dirname(root));
  assertRoot(parent);
  fs.mkdirSync(root, { mode: 0o700 });
  assertRoot(parent);
  syncDirectory(parent);
  return privateRoot(root);
}
function writeNew(root: RootPin, name: string, bytes: Buffer): void {
  assertRoot(root);
  const file = path.join(root.path, name);
  const fd = fs.openSync(
    file,
    fs.constants.O_WRONLY |
      fs.constants.O_CREAT |
      fs.constants.O_EXCL |
      fs.constants.O_NOFOLLOW,
    0o600,
  );
  try {
    const owned = pin(fs.fstatSync(fd));
    fs.writeFileSync(fd, bytes);
    fs.fsyncSync(fd);
    if (!samePin(regular(file), owned)) unavailable();
  } finally {
    fs.closeSync(fd);
  }
  assertRoot(root);
  syncDirectory(root);
}
/** Only a completed, closed backup inode is read; never the held source main file. */
function closedDigest(source: string, destination?: string): string {
  const before = regular(source),
    expected = pin(before);
  const input = fs.openSync(
    source,
    fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK,
  );
  let output: number | undefined;
  const digest = createHash("sha256");
  try {
    if (!samePin(fs.fstatSync(input), expected)) unavailable();
    if (destination)
      output = fs.openSync(
        destination,
        fs.constants.O_WRONLY |
          fs.constants.O_CREAT |
          fs.constants.O_EXCL |
          fs.constants.O_NOFOLLOW,
        0o600,
      );
    const block = Buffer.alloc(64 * 1024);
    let count: number;
    while ((count = fs.readSync(input, block, 0, block.length, null)) !== 0) {
      digest.update(block.subarray(0, count));
      if (output !== undefined) {
        let written = 0;
        while (written < count)
          written += fs.writeSync(output, block, written, count - written);
      }
    }
    const after = regular(source),
      opened = fs.fstatSync(input);
    for (const current of [after, opened])
      if (
        !samePin(current, expected) ||
        current.size !== before.size ||
        current.mtimeMs !== before.mtimeMs ||
        current.ctimeMs !== before.ctimeMs ||
        current.nlink !== 1
      )
        unavailable();
    if (output !== undefined) {
      fs.fsyncSync(output);
      if (!samePin(regular(destination!), pin(fs.fstatSync(output))))
        unavailable();
    }
    return digest.digest("hex");
  } finally {
    try {
      if (output !== undefined) fs.closeSync(output);
    } finally {
      fs.closeSync(input);
    }
  }
}
function exactEntries(root: RootPin, names: string[]): void {
  assertRoot(root);
  if (
    JSON.stringify(fs.readdirSync(root.path).sort()) !==
    JSON.stringify([...names].sort())
  )
    unavailable();
}
function readSmall(root: RootPin, name: string, maximum: number): Buffer {
  assertRoot(root);
  const file = path.join(root.path, name),
    before = regular(file);
  if (before.size > maximum) unavailable();
  const fd = fs.openSync(
    file,
    fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK,
  );
  try {
    if (!samePin(fs.fstatSync(fd), pin(before))) unavailable();
    const bytes = fs.readFileSync(fd);
    const after = regular(file);
    if (
      !samePin(after, pin(before)) ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      after.ctimeMs !== before.ctimeMs ||
      bytes.length !== before.size
    )
      unavailable();
    assertRoot(root);
    return bytes;
  } finally {
    fs.closeSync(fd);
  }
}
/** Internal Step 05 mechanism. Operator must stop and reap original runtime/admin processes before use. */
export class SqliteBackup {
  constructor(
    private readonly options: {
      workerFactory?: CoordinationWorkerFactory;
      deadlineMs?: number;
    } = {},
  ) {}
  private owner(database: SqliteDatabase) {
    return new SqliteLocalIdentityCoordination({ database, ...this.options });
  }
  async create(database: SqliteDatabase, bundlePath: string): Promise<void> {
    let session:
      | Awaited<ReturnType<SqliteLocalIdentityCoordination["acquire"]>>
      | undefined;
    try {
      disjoint(bundlePath, database.paths.databaseRoot);
      disjoint(bundlePath, database.paths.identityRoot);
      const store = new LocalIdentityFileStore({
        stateRoot: database.paths.identityRoot,
        databaseTargetId: database.targetId,
      });
      await store.openReadyState();
      session = await this.owner(database).acquire();
      const original = await store.openReadyState();
      await session.verify(original.state);
      const bundle = claim(bundlePath),
        paths = childPaths(bundlePath);
      const data = privateRoot(paths.databaseRoot, true),
        identity = privateRoot(paths.identityRoot, true);
      writeNew(data, "database.sqlite", Buffer.alloc(0));
      const destination = path.join(data.path, "database.sqlite"),
        destinationPin = pin(regular(destination));
      await session.backupTo(destination);
      session.assertHeld();
      assertRoot(bundle);
      assertRoot(data);
      if (!samePin(regular(destination), destinationPin)) unavailable();
      syncClosedFile(destination);
      syncDirectory(data);
      const databaseDigest = closedDigest(destination);
      if (!(await store.openReadyState()).bytes.equals(original.bytes))
        unavailable();
      writeNew(identity, "identity.json", original.bytes);
      if (!(await store.openReadyState()).bytes.equals(original.bytes))
        unavailable();
      session.assertHeld();
      const marker = Buffer.from(
        JSON.stringify({
          type: "context-router.local-database.backup",
          version: 1,
          databaseTargetId: database.targetId,
          principalId: original.state.principalId,
          databaseDigest,
          identityDigest: sha(original.bytes),
        }) + "\n",
      );
      writeNew(bundle, "complete.stage", marker);
      session.assertHeld();
      fs.linkSync(
        path.join(bundle.path, "complete.stage"),
        path.join(bundle.path, markerName),
      );
      syncDirectory(bundle);
      fs.unlinkSync(path.join(bundle.path, "complete.stage"));
      syncDirectory(bundle);
      session.assertHeld();
      await session.release();
      session = undefined;
    } catch {
      throw new Error("Local database backup failed");
    } finally {
      if (session) {
        try {
          await session.release();
        } catch {
          throw new Error("Local database backup failed");
        }
      }
    }
  }
  async restore(
    bundlePath: string,
    destinationPath: string,
  ): Promise<SqliteDatabase> {
    let session:
      | Awaited<ReturnType<SqliteLocalIdentityCoordination["acquire"]>>
      | undefined;
    try {
      requireNoNativeOwners();
      disjoint(bundlePath, destinationPath);
      const bundle = privateRoot(bundlePath),
        sourcePaths = childPaths(bundlePath),
        data = privateRoot(sourcePaths.databaseRoot),
        identity = privateRoot(sourcePaths.identityRoot);
      exactEntries(bundle, ["data", "identity", markerName]);
      exactEntries(data, ["database.sqlite"]);
      exactEntries(identity, ["identity.json"]);
      regular(path.join(data.path, "database.sqlite"));
      const markerBytes = readSmall(bundle, markerName, 1024),
        marker = JSON.parse(markerBytes.toString("utf8")),
        identityBytes = readSmall(identity, "identity.json", 4096),
        state = decodeLocalIdentityState(identityBytes);
      if (
        JSON.stringify(Object.keys(marker).sort()) !==
          JSON.stringify(
            [
              "type",
              "version",
              "databaseTargetId",
              "principalId",
              "databaseDigest",
              "identityDigest",
            ].sort(),
          ) ||
        marker.type !== "context-router.local-database.backup" ||
        marker.version !== 1 ||
        marker.databaseTargetId !== state.databaseTargetId ||
        marker.principalId !== state.principalId ||
        marker.identityDigest !== sha(identityBytes) ||
        typeof marker.databaseDigest !== "string" ||
        !/^[a-f0-9]{64}$/.test(marker.databaseDigest)
      )
        unavailable();
      const destination = claim(destinationPath),
        paths = childPaths(destination.path),
        copyData = privateRoot(paths.databaseRoot, true),
        copyIdentity = privateRoot(paths.identityRoot, true);
      if (
        closedDigest(
          path.join(data.path, "database.sqlite"),
          path.join(copyData.path, "database.sqlite"),
        ) !== marker.databaseDigest
      )
        unavailable();
      assertRoot(data);
      assertRoot(bundle);
      syncDirectory(copyData);
      const database = SqliteDatabase.open({
        ...paths,
        expectedTarget: state.databaseTargetId,
      });
      const connection = database.connect();
      try {
        if (
          connection.get("PRAGMA integrity_check")?.integrity_check !== "ok" ||
          connection.all("PRAGMA foreign_key_check").length !== 0
        )
          unavailable();
      } finally {
        connection.close();
      }
      session = await this.owner(database).acquire();
      await session.verify(state);
      if (
        !readSmall(bundle, markerName, 1024).equals(markerBytes) ||
        !readSmall(identity, "identity.json", 4096).equals(identityBytes)
      )
        unavailable();
      session.assertHeld();
      writeNew(copyIdentity, "identity.stage-restore.tmp", identityBytes);
      session.assertHeld();
      fs.linkSync(
        path.join(copyIdentity.path, "identity.stage-restore.tmp"),
        path.join(copyIdentity.path, "identity.json"),
      );
      syncDirectory(copyIdentity);
      fs.unlinkSync(path.join(copyIdentity.path, "identity.stage-restore.tmp"));
      syncDirectory(copyIdentity);
      if (
        !(
          await new LocalIdentityFileStore({
            stateRoot: paths.identityRoot,
            databaseTargetId: database.targetId,
          }).openReadyState()
        ).bytes.equals(identityBytes)
      )
        unavailable();
      assertRoot(destination);
      await session.release();
      session = undefined;
      return database;
    } catch {
      throw new Error("Local database restore failed");
    } finally {
      if (session) {
        try {
          await session.release();
        } catch {
          throw new Error("Local database restore failed");
        }
      }
    }
  }
}
