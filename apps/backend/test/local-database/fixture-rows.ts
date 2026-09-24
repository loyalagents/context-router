import { randomUUID } from "node:crypto";
import type { SqliteDatabase } from "@/infrastructure/storage/sqlite/sqlite-database";

/** Test-only table setup/inspection, independent of production repository methods. */
export function fixtureRows(database: SqliteDatabase) {
  const tables = {
    user: "users",
    externalIdentity: "external_identities",
    location: "locations",
    preferenceDefinition: "preference_definitions",
    preference: "user_preferences",
    preferenceAuditEvent: "preference_audit_events",
    mcpAccessEvent: "mcp_access_events",
    permissionGrant: "permission_grants",
  };
  const json = new Set([
    "metadata",
    "options",
    "value",
    "evidence",
    "beforeState",
    "afterState",
    "requestMetadata",
    "responseMetadata",
    "errorMetadata",
  ]);
  const date = new Set(["createdAt", "updatedAt", "occurredAt", "archivedAt"]);
  const column = (key: string) =>
    key.replace(/[A-Z]/g, (letter) => "_" + letter.toLowerCase());
  const bind = (key: string, value: any) =>
    value == null
      ? null
      : json.has(key)
        ? JSON.stringify(value)
        : date.has(key)
          ? value.getTime()
          : typeof value === "boolean"
            ? Number(value)
            : value;
  const decode = (row: any) =>
    row
      ? Object.fromEntries(
          Object.entries(row).map(([key, value]) => {
            const camel = key.replace(/_([a-z])/g, (_match, letter) =>
              letter.toUpperCase(),
            );
            return [
              camel,
              value === null
                ? null
                : json.has(camel)
                  ? JSON.parse(String(value))
                  : date.has(camel)
                    ? new Date(Number(value))
                    : ["isSensitive", "isCore"].includes(camel)
                      ? Boolean(value)
                      : value,
            ];
          }),
        )
      : null;
  const result: any = {};
  for (const [model, table] of Object.entries(tables)) {
    const call = (sql: string, values: any[] = []) => {
      const c = database.connect();
      try {
        return c.all(sql, values);
      } finally {
        c.close();
      }
    };
    const predicate = (where: Record<string, any> = {}) => {
      const keys = Object.keys(where);
      return {
        sql: keys.length
          ? " WHERE " +
            keys
              .map(
                (key) =>
                  column(key) + (where[key] === null ? " IS NULL" : "=?"),
              )
              .join(" AND ")
          : "",
        values: keys
          .filter((key) => where[key] !== null)
          .map((key) => bind(key, where[key])),
      };
    };
    const many = async ({ where = {}, orderBy }: any = {}) => {
      const filter = predicate(where);
      const order = orderBy
        ? " ORDER BY " +
          Object.entries(orderBy)
            .map(([key, direction]) => column(key) + " " + direction)
            .join(",")
        : "";
      return call(
        `SELECT * FROM ${table}${filter.sql}${order}`,
        filter.values,
      ).map(decode);
    };
    const first = async (args: any = {}) => (await many(args))[0] ?? null;
    const required = async (args: any = {}) => {
      const row = await first(args);
      if (!row) throw new Error("Fixture row missing");
      return row;
    };
    result[model] = {
      findMany: many,
      findFirst: first,
      findUnique: first,
      findUniqueOrThrow: required,
      findFirstOrThrow: required,
      count: async ({ where = {} }: any = {}) => {
        const f = predicate(where);
        return call(`SELECT count(*) n FROM ${table}${f.sql}`, f.values)[0].n;
      },
      create: async ({ data }: any) => {
        const key =
          model === "user"
            ? "userId"
            : model === "location"
              ? "locationId"
              : "id";
        const history =
          model === "preferenceAuditEvent" || model === "mcpAccessEvent";
        const complete = {
          [key]: randomUUID(),
          ...(history
            ? { occurredAt: new Date() }
            : { createdAt: new Date(), updatedAt: new Date() }),
          ...data,
        };
        const keys = Object.keys(complete).filter(
          (key) => complete[key] !== undefined,
        );
        return decode(
          call(
            `INSERT INTO ${table}(${keys.map(column).join(",")}) VALUES(${keys.map(() => "?").join(",")}) RETURNING *`,
            keys.map((key) => bind(key, complete[key])),
          )[0],
        );
      },
      update: async ({ where, data }: any) => {
        const f = predicate(where),
          keys = Object.keys(data);
        return decode(
          call(
            `UPDATE ${table} SET ${keys.map((key) => column(key) + "=?").join(",")}${f.sql} RETURNING *`,
            [...keys.map((key) => bind(key, data[key])), ...f.values],
          )[0],
        );
      },
      delete: async ({ where }: any) => {
        const f = predicate(where);
        return decode(
          call(`DELETE FROM ${table}${f.sql} RETURNING *`, f.values)[0],
        );
      },
    };
  }
  return result;
}
