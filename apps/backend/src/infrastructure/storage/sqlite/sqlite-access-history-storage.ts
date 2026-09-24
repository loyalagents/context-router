import { randomUUID } from "node:crypto";
import type {
  AccessHistoryStorage,
  AccessHistoryFilter,
  HistoryCursor,
  AccessEvent,
} from "../../../domains/shared/storage/history-storage";
import type { McpAccessEvent } from "../../../domains/shared/storage/storage-types";
import { SqliteAccess, decode, insert, optionalJson } from "./sqlite-records";
import { historyWhere } from "./sqlite-history";
export class SqliteAccessHistoryStorage
  extends SqliteAccess
  implements AccessHistoryStorage
{
  async append(event: AccessEvent): Promise<void> {
    await this.call((c) =>
      insert(c, "mcp_access_events", {
        id: randomUUID(),
        user_id: event.userId,
        client_key: event.clientKey,
        occurred_at: Date.now(),
        surface: event.surface,
        operation_name: event.operationName,
        outcome: event.outcome,
        correlation_id: event.correlationId,
        latency_ms: event.latencyMs,
        request_metadata: optionalJson(event.requestMetadata),
        response_metadata: optionalJson(event.responseMetadata),
        error_metadata: optionalJson(event.errorMetadata),
      }),
    );
  }
  findPage(
    userId: string,
    filter: AccessHistoryFilter,
    cursor: HistoryCursor | null,
    limit: number,
  ): Promise<McpAccessEvent[]> {
    const { clauses, values } = historyWhere(userId, filter, cursor);
    for (const [key, column] of [
      ["clientKey", "client_key"],
      ["operationName", "operation_name"],
      ["correlationId", "correlation_id"],
    ] as const)
      if (filter[key]?.trim()) {
        clauses.push(column + "=?");
        values.push(filter[key].trim());
      }
    for (const key of ["surface", "outcome"] as const)
      if (filter[key]) {
        clauses.push(key + "=?");
        values.push(filter[key]);
      }
    return this.call((c) =>
      c
        .all(
          `SELECT * FROM mcp_access_events WHERE ${clauses.join(" AND ")} ORDER BY occurred_at DESC,id DESC LIMIT ?`,
          [...values, limit],
        )
        .map((row) => decode<McpAccessEvent>(row)!),
    );
  }
}
