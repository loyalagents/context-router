import type { DatabaseSync } from "node:sqlite";

/** Immutable assertion documents plus append-only, version-bound endorsements. */
export function withConfirmations(db: DatabaseSync, entry: any): any {
  const appended = db
    .prepare(
      "SELECT document FROM confirmations WHERE entry_id=? AND version=? ORDER BY sequence",
    )
    .all(entry.id, entry.record.version)
    .map((row) => JSON.parse(String(row.document)));
  return {
    ...entry,
    record: {
      ...entry.record,
      relationships: [
        ...entry.record.relationships,
        ...db
          .prepare(
            `SELECT * FROM relations WHERE disposition IN ('open','dismissed','held')
          AND ((left_id=? AND left_version=?) OR (right_id=? AND right_version=? AND type='contradicts')) ORDER BY id`,
          )
          .all(entry.id, entry.record.version, entry.id, entry.record.version)
          .map((row) => ({
            ...JSON.parse(String(row.document)),
            type: row.type,
            target: row.left_id === entry.id ? row.right_id : row.left_id,
          })),
      ],
      provenance: {
        ...entry.record.provenance,
        confirmations: [...entry.record.provenance.confirmations, ...appended],
      },
    },
  };
}
export function confirmed(entry: any): boolean {
  return (
    entry.record.provenance.confirmations.at(-1)?.disposition === "confirmed"
  );
}
export function authoritative(entry: any): boolean {
  return (
    confirmed(entry) ||
    (entry.assertion.declarationType === "person-declared" &&
      ["authenticated", "cryptographically-verified"].includes(
        entry.record.provenance.assertedBy.assurance,
      ))
  );
}
