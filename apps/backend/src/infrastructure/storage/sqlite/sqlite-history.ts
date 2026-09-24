import type { HistoryCursor } from "../../../domains/shared/storage/history-storage";
/** Common inclusive date and exclusive tied-cursor predicate, before ordering/limit. */
export function historyWhere(
  userId: string,
  filter: { occurredFrom?: Date; occurredTo?: Date },
  cursor: HistoryCursor | null,
) {
  const clauses = ["user_id=?"];
  const values: Array<string | number> = [userId];
  if (filter.occurredFrom) {
    clauses.push("occurred_at>=?");
    values.push(filter.occurredFrom.getTime());
  }
  if (filter.occurredTo) {
    clauses.push("occurred_at<=?");
    values.push(filter.occurredTo.getTime());
  }
  if (cursor) {
    clauses.push("(occurred_at<? OR (occurred_at=? AND id<?))");
    values.push(
      cursor.occurredAt.getTime(),
      cursor.occurredAt.getTime(),
      cursor.id,
    );
  }
  return { clauses, values };
}
