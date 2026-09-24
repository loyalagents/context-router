import { randomUUID } from "node:crypto";
import {
  SqliteDatabase,
  SqliteConnection,
  type SqliteRow,
} from "./sqlite-database";
import { unavailable } from "./sqlite-files";
import { SQLITE_TABLES } from "./sqlite-schema";

type Table = (typeof SQLITE_TABLES)[number];
export type SqliteSource = SqliteDatabase | SqliteConnection;
const jsonColumns = new Set([
  "metadata",
  "options",
  "value",
  "evidence",
  "before_state",
  "after_state",
  "request_metadata",
  "response_metadata",
  "error_metadata",
]);
const dateColumns = new Set([
  "created_at",
  "updated_at",
  "occurred_at",
  "archived_at",
]);
const booleanColumns = new Set(["is_sensitive", "is_core"]);
export function decode<T>(row: SqliteRow | undefined): T | null {
  if (!row) return null;
  try {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      const name = key.replace(/_([a-z])/g, (_match, letter) =>
        letter.toUpperCase(),
      );
      result[name] =
        value === null
          ? null
          : jsonColumns.has(key)
            ? JSON.parse(value)
            : dateColumns.has(key)
              ? new Date(value)
              : booleanColumns.has(key)
                ? Boolean(value)
                : value;
    }
    return result as T;
  } catch {
    unavailable();
  }
}
export function json(value: unknown): string {
  try {
    const result = JSON.stringify(value);
    if (result === undefined) unavailable();
    return result;
  } catch {
    unavailable();
  }
}
export const optionalJson = (value: unknown): string | null =>
  value == null ? null : json(value);
export const placeholders = (values: readonly unknown[]): string =>
  values.map(() => "?").join(",");
export class SqliteAccess {
  constructor(protected readonly source: SqliteSource) {}
  /** Multi-statement root mutations keep their result within the same one-attempt transaction. */
  protected mutate<T>(
    operation: (connection: SqliteConnection) => T,
  ): Promise<T> {
    if (!(this.source instanceof SqliteDatabase)) return this.call(operation);
    return this.call((connection) => {
      try {
        connection.exec("BEGIN IMMEDIATE");
        const result = operation(connection);
        connection.assertTransactionHealthy();
        connection.exec("COMMIT");
        return result;
      } catch (error) {
        try {
          if (connection.inTransaction) connection.exec("ROLLBACK");
        } catch {
          unavailable();
        }
        throw error;
      }
    });
  }
  protected async call<T>(
    operation: (connection: SqliteConnection) => T,
  ): Promise<T> {
    const owned = this.source instanceof SqliteDatabase;
    const connection = owned
      ? this.source.connect()
      : (this.source as SqliteConnection);
    try {
      return operation(connection);
    } finally {
      if (owned) connection.close();
    }
  }
}
/** Identifiers originate only in adapter code; values are always bound parameters. */
export function insert<T>(
  c: SqliteConnection,
  table: Table,
  data: Record<string, any>,
): T {
  const keys = Object.keys(data);
  return decode<T>(
    c.get(
      `INSERT INTO ${table}(${keys.join(",")}) VALUES(${placeholders(keys)}) RETURNING *`,
      keys.map((key) => data[key]),
    ),
  )!;
}
export function update<T>(
  c: SqliteConnection,
  table: Table,
  key: string,
  id: string,
  data: Record<string, any>,
): T {
  const values = { ...data };
  const keys = Object.keys(values);
  let row: SqliteRow | undefined;
  if (keys.length) {
    values.updated_at = Date.now();
    const fields = Object.keys(values);
    row = c.get(
      `UPDATE ${table} SET ${fields.map((field) => field + "=?").join(",")} WHERE ${key}=? RETURNING *`,
      [...fields.map((field) => values[field]), id],
    );
  } else row = c.get(`SELECT * FROM ${table} WHERE ${key}=?`, [id]);
  if (!row) unavailable();
  return decode<T>(row)!;
}
export function remove<T>(
  c: SqliteConnection,
  table: Table,
  key: string,
  id: string,
): T {
  const row = c.get(`DELETE FROM ${table} WHERE ${key}=? RETURNING *`, [id]);
  if (!row) unavailable();
  return decode<T>(row)!;
}
export const timestamped = (
  data: Record<string, any>,
  key = "id",
): Record<string, any> => ({
  [key]: randomUUID(),
  ...data,
  created_at: Date.now(),
  updated_at: Date.now(),
});
