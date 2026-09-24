import * as path from "node:path";
export interface LocalDatabaseConfiguration {
  kind: "sqlite";
  databaseRoot: string;
  stateRoot: string;
}
function invalid(): never {
  throw new Error("Invalid local database configuration");
}
export function createLocalDatabaseConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
): LocalDatabaseConfiguration {
  const databaseRoot = environment.LOCAL_DATABASE_ROOT,
    stateRoot = environment.LOCAL_IDENTITY_STATE_ROOT;
  for (const value of [databaseRoot, stateRoot]) {
    if (
      typeof value !== "string" ||
      !value ||
      Buffer.byteLength(value, "utf8") > 4096 ||
      /[\u0000-\u001f\u007f]/u.test(value) ||
      !path.isAbsolute(value) ||
      path.resolve(value) !== value ||
      value === path.parse(value).root
    )
      invalid();
  }
  if (
    databaseRoot === stateRoot ||
    databaseRoot.startsWith(stateRoot + path.sep) ||
    stateRoot.startsWith(databaseRoot + path.sep)
  )
    invalid();
  return Object.freeze({ kind: "sqlite", databaseRoot, stateRoot });
}
export function requireLocalDatabaseConfiguration(
  value: unknown,
): LocalDatabaseConfiguration {
  const config = value as LocalDatabaseConfiguration;
  if (config?.kind !== "sqlite") invalid();
  return createLocalDatabaseConfiguration({
    LOCAL_DATABASE_ROOT: config.databaseRoot,
    LOCAL_IDENTITY_STATE_ROOT: config.stateRoot,
  });
}
