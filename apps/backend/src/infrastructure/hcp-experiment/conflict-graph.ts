import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { authoritative } from "./entry-state";
import { conflictEffects, contradicts } from "./conflicts";
import { denied } from "./policy";
import { storedEntry } from "./writes";

type Emit = (event: any) => void;
/** Transitions without a conflict event (such as retaining a quarantine after
 * withdrawal) belong to the enclosing mutation/confirmation/expiry audit event.
 * Its relatedTransitions also invalidates prepared results for indirect peers. */
export function causalTransitions(changes: any[]): any[] {
  return changes.flatMap((change) =>
    change.data.before.map((before: any) => ({
      id: before.id,
      before: before.status,
      after: change.data.after.find((after: any) => after.id === before.id)
        .status,
    })),
  );
}
const live = (entry: any) =>
  ["active", "conflicted"].includes(entry.record.status);
const peer = (relation: any, id: string) =>
  relation.left_id === id ? relation.right_id : relation.left_id;
export function incident(db: DatabaseSync, id: string): any[] {
  return db
    .prepare(
      `SELECT * FROM relations WHERE type='contradicts' AND disposition IN ('open','held')
    AND (left_id=? OR right_id=?) ORDER BY id`,
    )
    .all(id, id);
}
export function snapshot(db: DatabaseSync, id: string): any[] {
  return incident(db, id).map((relation) => {
    const other = storedEntry(db, peer(relation, id));
    const held = db
      .prepare(
        "SELECT entry_id FROM quarantine_reasons WHERE relation_id=? ORDER BY entry_id",
      )
      .all(relation.id)
      .map((r) => r.entry_id);
    return {
      ...relation,
      document: JSON.parse(relation.document),
      peer: other,
      quarantined: held,
      canKeepBoth:
        relation.disposition === "open" &&
        held.length === 0 &&
        [storedEntry(db, id), other].every((e) => e.record.status === "active"),
    };
  });
}
export function keepBothSnapshot(db: DatabaseSync, relationId: string): any {
  const relation: any = db
    .prepare("SELECT * FROM relations WHERE id=?")
    .get(relationId);
  if (!relation) denied();
  const state = snapshot(db, relation.left_id).find((r) => r.id === relationId);
  if (!state?.canKeepBoth) denied();
  return { entry: storedEntry(db, relation.left_id), conflict: state };
}
function states(db: DatabaseSync, relation: any, override?: any): any[] {
  return [relation.left_id, relation.right_id].map((id) => {
    const entry = override?.id === id ? override : storedEntry(db, id);
    return {
      id,
      version: entry.record.version,
      status: entry.record.status,
      authoritative: authoritative(entry),
    };
  });
}
function audit(
  db: DatabaseSync,
  relation: any,
  eventType: string | undefined,
  transition: string,
  now: number,
  actor: any,
  emit: Emit,
  before = states(db, relation),
  data = {},
) {
  const [a, b] = before;
  const [entryId, relatedEntryId] =
    a.authoritative && !b.authoritative ? [b.id, a.id] : [a.id, b.id];
  emit({
    eventType,
    entryId,
    relatedEntryId,
    data: {
      relationId: relation.id,
      transition,
      versions: [relation.left_version, relation.right_version],
      relationship: JSON.parse(relation.document),
      actor,
      at: new Date(now).toISOString(),
      before,
      after: states(db, relation),
      ...data,
    },
  });
}
function refresh(db: DatabaseSync, id: string) {
  const entry = storedEntry(db, id);
  if (!entry || !live(entry)) return;
  const reasons = Number(
    db
      .prepare("SELECT count(*) n FROM quarantine_reasons WHERE entry_id=?")
      .get(id).n,
  );
  // Confirming standing never inherits from an opponent's removal.
  db.prepare("UPDATE entries SET status=? WHERE id=?").run(
    authoritative(entry) || reasons === 0 ? "active" : "conflicted",
    id,
  );
}
function end(
  db: DatabaseSync,
  relation: any,
  transition: string,
  now: number,
  actor: any,
  emit: Emit,
  before = states(db, relation),
) {
  db.prepare("UPDATE relations SET disposition=? WHERE id=?").run(
    transition === "asserter-superseded" ? "superseded" : "ended",
    relation.id,
  );
  db.prepare("DELETE FROM quarantine_reasons WHERE relation_id=?").run(
    relation.id,
  );
  refresh(db, relation.left_id);
  refresh(db, relation.right_id);
  audit(
    db,
    relation,
    "conflict.resolved",
    transition,
    now,
    actor,
    emit,
    before,
  );
}
function consequences(
  db: DatabaseSync,
  relation: any,
  newestId: string,
  now: number,
  actor: any,
  emit: Emit,
  detection?: string,
) {
  const a = storedEntry(db, relation.left_id),
    b = storedEntry(db, relation.right_id);
  const before = states(db, relation);
  const effects = conflictEffects(a, b, newestId);
  db.prepare("DELETE FROM quarantine_reasons WHERE relation_id=?").run(
    relation.id,
  );
  for (const entry of [a, b]) {
    if (effects.quarantine.includes(entry.id))
      db.prepare("INSERT OR IGNORE INTO quarantine_reasons VALUES(?,?)").run(
        entry.id,
        relation.id,
      );
    if (effects.deprecate.includes(entry.id))
      db.prepare("UPDATE entries SET status='deprecated' WHERE id=?").run(
        entry.id,
      );
  }
  refresh(db, a.id);
  refresh(db, b.id);
  if (detection)
    audit(
      db,
      relation,
      "conflict.detected",
      detection,
      now,
      actor,
      emit,
      before,
    );
  if (effects.deprecate.length) {
    db.prepare("UPDATE relations SET disposition='superseded' WHERE id=?").run(
      relation.id,
    );
    audit(
      db,
      relation,
      "conflict.resolved",
      "asserter-superseded",
      now,
      actor,
      emit,
      before,
      { effects },
    );
    for (const id of effects.deprecate)
      evaluateWrite(db, id, id === a.id ? a : b, now, actor, emit);
  }
}

/** Called inside the content/lifecycle transaction. Collect peers before any
 * quarantine so the first edge cannot hide the rest of this write's candidates. */
export function evaluateWrite(
  db: DatabaseSync,
  id: string,
  previous: any,
  now: number,
  actor: any,
  emit: Emit,
): void {
  const current = storedEntry(db, id);
  const old: any[] = db
    .prepare(
      `SELECT * FROM relations WHERE (left_id=? OR right_id=?)
    AND disposition IN ('open','dismissed','held') ORDER BY id`,
    )
    .all(id, id);
  const candidates = new Set<string>(
    db
      .prepare(
        "SELECT id FROM entries WHERE status='active' AND id<>? ORDER BY id",
      )
      .all(id)
      .map((r) => String(r.id)),
  );
  for (const relation of old) candidates.add(peer(relation, id));
  const revised =
    previous && previous.record.version !== current.record.version;
  const retained = new Set<string>();
  for (const relation of old) {
    const other = storedEntry(db, peer(relation, id));
    if (relation.type !== "contradicts") {
      // Informational provenance belongs to its source assertion. A target's
      // revision does not erase an unchanged source's relationship to that entry.
      if (revised && relation.owner_id === id)
        db.prepare("UPDATE relations SET disposition='ended' WHERE id=?").run(
          relation.id,
        );
      continue;
    }
    if (!live(current) || !live(other)) {
      // Lifecycle removal is not a human rejection or evidence of compatibility.
      // Preserve remaining quarantine until a revision or explicit human act.
      if (!revised) {
        if (relation.disposition === "dismissed") continue;
        const held = Number(
          db
            .prepare(
              "SELECT count(*) n FROM quarantine_reasons WHERE relation_id=?",
            )
            .get(relation.id).n,
        );
        if (!held) {
          end(
            db,
            relation,
            "ended",
            now,
            actor,
            emit,
            states(db, relation, previous),
          );
          continue;
        }
        db.prepare("UPDATE relations SET disposition='held' WHERE id=?").run(
          relation.id,
        );
        audit(
          db,
          relation,
          undefined,
          "held",
          now,
          actor,
          emit,
          states(db, relation, previous),
        );
        continue;
      }
      const held = Number(
        db
          .prepare(
            "SELECT count(*) n FROM quarantine_reasons WHERE relation_id=?",
          )
          .get(relation.id).n,
      );
      if (
        held &&
        relation.origin === "provider" &&
        contradicts(current, other)
      ) {
        // A retained historical cause still contradicts the new assertion. A
        // no-op revision cannot wash away quarantine by relying on withdrawal.
        db.prepare(
          "UPDATE relations SET left_version=?,right_version=?,disposition='held' WHERE id=?",
        ).run(
          storedEntry(db, relation.left_id).record.version,
          storedEntry(db, relation.right_id).record.version,
          relation.id,
        );
        if (authoritative(current))
          db.prepare(
            "DELETE FROM quarantine_reasons WHERE entry_id=? AND relation_id=?",
          ).run(id, relation.id);
        if (
          !Number(
            db
              .prepare(
                "SELECT count(*) n FROM quarantine_reasons WHERE relation_id=?",
              )
              .get(relation.id).n,
          )
        ) {
          end(
            db,
            relation,
            "superseded",
            now,
            actor,
            emit,
            states(db, relation, previous),
          );
          continue;
        }
        refresh(db, id);
        audit(
          db,
          relation,
          undefined,
          "held-re-evaluated",
          now,
          actor,
          emit,
          states(db, relation, previous),
        );
        retained.add(other.id);
        continue;
      }
    }
    if (
      relation.origin !== "provider" ||
      !live(current) ||
      !live(other) ||
      !contradicts(current, other)
    ) {
      const held = Number(
        db
          .prepare(
            "SELECT count(*) n FROM quarantine_reasons WHERE relation_id=?",
          )
          .get(relation.id).n,
      );
      end(
        db,
        relation,
        revised && held ? "superseded" : "ended",
        now,
        actor,
        emit,
        states(db, relation, previous),
      );
      continue;
    }
    retained.add(other.id);
    if (relation.disposition === "dismissed" && !revised) continue;
    db.prepare(
      "UPDATE relations SET left_version=?,right_version=?,disposition='open' WHERE id=?",
    ).run(
      storedEntry(db, relation.left_id).record.version,
      storedEntry(db, relation.right_id).record.version,
      relation.id,
    );
    relation.left_version = storedEntry(db, relation.left_id).record.version;
    relation.right_version = storedEntry(db, relation.right_id).record.version;
    consequences(
      db,
      relation,
      id,
      now,
      actor,
      emit,
      revised ? "re-evaluated" : undefined,
    );
  }
  if (!live(current)) return;
  // Evaluate against snapshots: status changes from preceding pairs do not alter standing.
  for (const otherId of candidates) {
    if (retained.has(otherId)) continue;
    const other = storedEntry(db, otherId);
    if (!live(other) || !contradicts(current, other)) continue;
    const [left, right] = [current, other].sort((a, b) =>
      a.id.localeCompare(b.id),
    );
    const relation = {
      id: `urn:uuid:${randomUUID()}`,
      left_id: left.id,
      right_id: right.id,
      left_version: left.record.version,
      right_version: right.record.version,
      type: "contradicts",
      origin: "provider",
      owner_id: id,
      disposition: "open",
      document: JSON.stringify({
        assertedBy: actor,
        recordedAt: new Date(now).toISOString(),
      }),
    };
    db.prepare("INSERT INTO relations VALUES(?,?,?,?,?,?,?,?,?,?)").run(
      ...Object.values(relation),
    );
    consequences(db, relation, id, now, actor, emit, "detected");
  }
}

/** Confirmation itself is appended by the authority service in this transaction. */
export function resolveEntry(
  db: DatabaseSync,
  id: string,
  disposition: "confirmed" | "rejected",
  now: number,
  actor: any,
  emit: Emit,
  previous?: any,
): void {
  const current = previous ?? storedEntry(db, id);
  if (!current || !live(current)) denied();
  // An ordinary endorsement of an active statement is not acceptance of a
  // quarantined alternative, and cannot deprecate a surfaced authoritative peer.
  if (disposition === "confirmed" && current.record.status !== "conflicted")
    return;
  const edges = incident(db, id);
  db.prepare("UPDATE entries SET status=? WHERE id=?").run(
    disposition === "confirmed" ? "active" : "deleted",
    id,
  );
  for (const relation of edges) {
    const other = storedEntry(db, peer(relation, id));
    const before = states(db, relation, current);
    const held = Number(
      db
        .prepare(
          "SELECT count(*) n FROM quarantine_reasons WHERE relation_id=?",
        )
        .get(relation.id).n,
    );
    // Resolving one quarantine does not authorize settling a separate pair that
    // changed no status. It remains surfaced for an explicit keep-both act.
    if (disposition === "confirmed" && !held) continue;
    if (disposition === "rejected") {
      if (current.record.status === "conflicted")
        end(
          db,
          relation,
          held ? "rejected" : "ended",
          now,
          actor,
          emit,
          before,
        );
      else if (
        Number(
          db
            .prepare(
              "SELECT count(*) n FROM quarantine_reasons WHERE relation_id=?",
            )
            .get(relation.id).n,
        )
      ) {
        db.prepare("UPDATE relations SET disposition='held' WHERE id=?").run(
          relation.id,
        );
        audit(db, relation, undefined, "held", now, actor, emit, before);
      } else end(db, relation, "ended", now, actor, emit, before);
    } else if (
      authoritative(other) &&
      other.assertion.declarationType !== "issuer-attested"
    ) {
      if (live(other))
        db.prepare("UPDATE entries SET status='deprecated' WHERE id=?").run(
          other.id,
        );
      end(db, relation, "accepted", now, actor, emit, before);
      if (live(other)) evaluateWrite(db, other.id, other, now, actor, emit);
    } else {
      db.prepare(
        "DELETE FROM quarantine_reasons WHERE entry_id=? AND relation_id=?",
      ).run(id, relation.id);
      refresh(db, id);
      audit(
        db,
        relation,
        "conflict.resolved",
        "accepted",
        now,
        actor,
        emit,
        before,
        { remainingPeerStatus: other.record.status },
      );
    }
  }
}
export function dismiss(
  db: DatabaseSync,
  relationId: string,
  now: number,
  actor: any,
  emit: Emit,
): void {
  const relation: any = db
    .prepare(
      "SELECT * FROM relations WHERE id=? AND disposition='open' AND type='contradicts'",
    )
    .get(relationId);
  if (
    !relation ||
    Number(
      db
        .prepare(
          "SELECT count(*) n FROM quarantine_reasons WHERE relation_id=?",
        )
        .get(relationId).n,
    ) ||
    ![relation.left_id, relation.right_id].every(
      (id) => storedEntry(db, id).record.status === "active",
    )
  )
    denied();
  db.prepare("UPDATE relations SET disposition='dismissed' WHERE id=?").run(
    relationId,
  );
  audit(db, relation, "conflict.resolved", "dismissed", now, actor, emit);
}

export function assertRelationships(
  db: DatabaseSync,
  id: string,
  assertions: any[],
  now: number,
  actor: any,
  emit: Emit,
): void {
  for (const item of assertions) {
    const { target, type, maySupersede, ...document } = item;
    const current = storedEntry(db, id),
      other = storedEntry(db, target);
    const [left, right] =
      type === "contradicts"
        ? [current, other].sort((a, b) => a.id.localeCompare(b.id))
        : [current, other];
    const relation = {
      id: `urn:uuid:${randomUUID()}`,
      left_id: left.id,
      right_id: right.id,
      left_version: left.record.version,
      right_version: right.record.version,
      type,
      origin: actor.role === "management-client" ? "management" : "client",
      owner_id: id,
      disposition: "open",
      document: JSON.stringify(document),
    };
    db.prepare("INSERT INTO relations VALUES(?,?,?,?,?,?,?,?,?,?)").run(
      ...Object.values(relation),
    );
    if (type === "contradicts") {
      if (!live(current) || !live(other)) {
        // Targets were admitted before this atomic write. Earlier detector or
        // client edges may already have superseded one of them; retain the new
        // assertion's attribution without exposing an unresolvable open edge.
        const superseded = db
          .prepare(
            `SELECT id FROM relations WHERE type='contradicts'
          AND left_id=? AND right_id=? AND left_version=? AND right_version=?
          AND disposition='superseded' LIMIT 1`,
          )
          .get(left.id, right.id, left.record.version, right.record.version);
        audit(db, relation, "conflict.detected", "asserted", now, actor, emit);
        end(
          db,
          relation,
          superseded ? "asserter-superseded" : "ended",
          now,
          actor,
          emit,
        );
      } else consequences(db, relation, id, now, actor, emit, "asserted");
      if (document.proposal)
        audit(
          db,
          relation,
          "conflict.proposed",
          "proposed",
          now,
          actor,
          emit,
          undefined,
          {
            act: document.proposal.act,
            entry: document.proposal.entry,
            weighed: document.proposal.weighed,
            proposedBy: document.proposal.proposedBy,
          },
        );
    } else if (type === "supersedes" && maySupersede && live(other)) {
      db.prepare("UPDATE entries SET status='deprecated' WHERE id=?").run(
        other.id,
      );
      // The revision/create audit carries the asserting relation; retained graph
      // holds prevent a superseded opponent from implicitly endorsing its peers.
      evaluateWrite(db, other.id, other, now, actor, emit);
    }
  }
}
