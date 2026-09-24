import { randomUUID } from "node:crypto";
import type { ResetStorage } from "../../../domains/shared/storage/reset-storage";
import { SqliteAccess, insert, json, placeholders } from "./sqlite-records";
export class SqliteResetStorage extends SqliteAccess implements ResetStorage {
  deletePreferences(userId: string): Promise<number> {
    return this.call((c) =>
      Number(
        c.run("DELETE FROM user_preferences WHERE user_id=?", [userId]).changes,
      ),
    );
  }
  async appendMemoryResetAudit(
    userId: string,
    mode: string,
    preferencesDeleted: number,
    correlationId: string,
  ): Promise<void> {
    await this.call((c) =>
      insert(c, "preference_audit_events", {
        id: randomUUID(),
        user_id: userId,
        subject_slug: "*",
        occurred_at: Date.now(),
        target_type: "PREFERENCE",
        target_id: userId,
        event_type: "PREFERENCES_RESET",
        actor_type: "USER",
        origin: "GRAPHQL",
        correlation_id: correlationId,
        before_state: "null",
        after_state: "null",
        metadata: json({ mode, preferencesDeleted }),
      }),
    );
  }
  deleteAuditEvents(userId: string): Promise<number> {
    return this.call((c) =>
      Number(
        c.run("DELETE FROM preference_audit_events WHERE user_id=?", [userId])
          .changes,
      ),
    );
  }
  deleteAccessEvents(userId: string): Promise<number> {
    return this.call((c) =>
      Number(
        c.run("DELETE FROM mcp_access_events WHERE user_id=?", [userId])
          .changes,
      ),
    );
  }
  findOwnedDefinitionIds(userId: string): Promise<string[]> {
    return this.call((c) =>
      c
        .all(
          "SELECT id FROM preference_definitions WHERE namespace=? AND owner_user_id=?",
          [`USER:${userId}`, userId],
        )
        .map((row) => row.id),
    );
  }
  hasForeignDefinitionReference(
    userId: string,
    definitionIds: string[],
  ): Promise<boolean> {
    if (!definitionIds.length) return Promise.resolve(false);
    return this.call((c) =>
      Boolean(
        c.get(
          `SELECT id FROM user_preferences WHERE user_id<>? AND definition_id IN (${placeholders(definitionIds)}) LIMIT 1`,
          [userId, ...definitionIds],
        ),
      ),
    );
  }
  deleteDefinitions(definitionIds: string[]): Promise<number> {
    if (!definitionIds.length) return Promise.resolve(0);
    return this.call((c) =>
      Number(
        c.run(
          `DELETE FROM preference_definitions WHERE id IN (${placeholders(definitionIds)})`,
          definitionIds,
        ).changes,
      ),
    );
  }
  deleteLocations(userId: string): Promise<number> {
    return this.call((c) =>
      Number(c.run("DELETE FROM locations WHERE user_id=?", [userId]).changes),
    );
  }
  deleteGrants(userId: string): Promise<number> {
    return this.call((c) =>
      Number(
        c.run("DELETE FROM permission_grants WHERE user_id=?", [userId])
          .changes,
      ),
    );
  }
}
