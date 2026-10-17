import { createHash } from "node:crypto";
import type { LocalMcpClientSummary } from "../../../mcp/local/local-mcp-credentials";
import type { SqliteConnection } from "./sqlite-database";

const columns = [
  "id",
  "user_id",
  "client_key",
  "target",
  "action",
  "effect",
  "created_at",
  "updated_at",
] as const;
const chunkBytes = 1024;
const projection = columns
  .map(
    (column) => `typeof(${column}) ${column}_type,
  length(CAST(${column} AS BLOB)) ${column}_size,
  substr(CAST(${column} AS BLOB),1,${chunkBytes}) ${column}_bytes`,
  )
  .join(",");

/** Caller owns a consistent read/write transaction. Memory is bounded even for corrupt rows.
 * Framed raw SQLite values include every grant byte and type, without exposing them.
 * Row IDs locate subsequent chunks only; the hash is ordered by the stable grant ID.
 */
export function mcpAdministrationRevision(
  c: SqliteConnection,
  store: string,
  principal: string,
  client: LocalMcpClientSummary,
): string {
  const hash = createHash("sha256");
  hash.update(JSON.stringify(["local-mcp-admin-v2", store, principal, client]));
  for (let offset = 0; ; offset += 8) {
    const rows = c.all(
      `SELECT rowid cursor,${projection} FROM permission_grants
      WHERE user_id=? AND client_key=? ORDER BY id COLLATE BINARY LIMIT 8 OFFSET ?`,
      [principal, `local:${client.id}`, offset],
    );
    for (const row of rows) {
      hash.update("\nrow\n");
      for (const column of columns) {
        const size = row[`${column}_size`] ?? 0;
        hash.update(JSON.stringify([column, row[`${column}_type`], size]));
        if (size) hash.update(Buffer.from(row[`${column}_bytes`]));
        for (let start = chunkBytes + 1; start <= size; start += chunkBytes) {
          const part = c.get(
            `SELECT substr(CAST(${column} AS BLOB),?,?) bytes FROM permission_grants WHERE rowid=?`,
            [start, chunkBytes, row.cursor],
          );
          hash.update(Buffer.from(part.bytes));
        }
      }
    }
    if (rows.length < 8) return hash.digest("hex");
  }
}
