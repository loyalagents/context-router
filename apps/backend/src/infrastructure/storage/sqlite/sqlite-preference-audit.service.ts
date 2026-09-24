import { randomUUID } from "node:crypto";
import type { PreferenceAuditService } from "../../../modules/preferences/audit/preference-audit.service";
import type { AuditEventInput } from "../../../modules/preferences/audit/audit.types";
import { SqliteAccess, insert, optionalJson } from "./sqlite-records";
export class SqlitePreferenceAuditService
  extends SqliteAccess
  implements PreferenceAuditService
{
  async record(event: AuditEventInput): Promise<void> {
    const subjectSlug = event.subjectSlug.trim();
    if (!subjectSlug) throw new Error("Audit event subjectSlug is required");
    await this.call((c) =>
      insert(c, "preference_audit_events", {
        id: randomUUID(),
        user_id: event.userId,
        subject_slug: subjectSlug,
        occurred_at: Date.now(),
        target_type: event.targetType,
        target_id: event.targetId,
        event_type: event.eventType,
        actor_type: event.actorType,
        actor_client_key: event.actorClientKey ?? null,
        origin: event.origin,
        correlation_id: event.correlationId,
        before_state: optionalJson(event.beforeState),
        after_state: optionalJson(event.afterState),
        metadata: optionalJson(event.metadata),
      }),
    );
  }
}
