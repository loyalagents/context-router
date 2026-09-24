import type {
  AuditHistoryStorage,
  AuditHistoryFilter,
  HistoryCursor,
} from "../../../domains/shared/storage/history-storage";
import type { PreferenceAuditEvent } from "../../../domains/shared/storage/storage-types";
import { SqliteAccess, decode } from "./sqlite-records";
import { historyWhere } from "./sqlite-history";
export class SqliteAuditHistoryStorage
  extends SqliteAccess
  implements AuditHistoryStorage
{
  findPage(
    userId: string,
    filter: AuditHistoryFilter,
    cursor: HistoryCursor | null,
    limit: number,
  ): Promise<PreferenceAuditEvent[]> {
    const { clauses, values } = historyWhere(userId, filter, cursor);
    if (filter.subjectSlug) {
      clauses.push("storage_like(?,subject_slug)");
      values.push(filter.subjectSlug + "%");
    }
    for (const [key, column] of [
      ["eventType", "event_type"],
      ["targetType", "target_type"],
      ["origin", "origin"],
      ["actorClientKey", "actor_client_key"],
      ["correlationId", "correlation_id"],
    ] as const)
      if (filter[key]) {
        clauses.push(column + "=?");
        values.push(filter[key]);
      }
    return this.call((c) =>
      c
        .all(
          `SELECT * FROM preference_audit_events WHERE ${clauses.join(" AND ")} ORDER BY occurred_at DESC,id DESC LIMIT ?`,
          [...values, limit],
        )
        .map((row) => decode<PreferenceAuditEvent>(row)!),
    );
  }
}
