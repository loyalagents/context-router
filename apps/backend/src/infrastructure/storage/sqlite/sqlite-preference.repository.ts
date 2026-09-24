import type {
  PreferenceRepository,
  EnrichedPreference,
} from "../../../modules/preferences/preference/preference.repository";
import type {
  PreferenceProvenanceOptions,
  PreferenceMutationAttribution,
  PreferenceWriteResult,
} from "../../../modules/preferences/audit/audit.types";
import type {
  Preference,
  PreferenceStatus,
} from "../../../domains/shared/storage/storage-types";
import { SqliteConnection, type SqliteRow } from "./sqlite-database";
import {
  SqliteAccess,
  decode,
  insert,
  update,
  json,
  optionalJson,
  timestamped,
} from "./sqlite-records";
import { unavailable } from "./sqlite-files";
const joined =
  "SELECT p.*,d.slug AS definition_slug,d.description AS definition_description FROM user_preferences p JOIN preference_definitions d ON d.id=p.definition_id";
const context = (locationId?: string | null) =>
  locationId ? `LOCATION:${locationId}` : "GLOBAL";
function enrich(row: SqliteRow | undefined): EnrichedPreference | null {
  if (!row) return null;
  const {
    definition_slug: slug,
    definition_description: description,
    ...stored
  } = row;
  const pref = decode<Preference>(stored)!;
  return {
    ...pref,
    definition: { slug, description },
    slug,
    category: slug.split(".")[0],
    description,
    lastModifiedBy:
      pref.lastActorType && pref.lastOrigin
        ? {
            actorType: pref.lastActorType,
            actorClientKey: pref.lastActorClientKey,
            origin: pref.lastOrigin,
          }
        : null,
  } as EnrichedPreference;
}
const find = (c: SqliteConnection, id: string) =>
  enrich(c.get(joined + " WHERE p.id=?", [id]));
export class SqlitePreferenceRepository
  extends SqliteAccess
  implements PreferenceRepository
{
  upsertActive(
    userId: string,
    definitionId: string,
    value: unknown,
    locationId?: string | null,
    provenance?: PreferenceProvenanceOptions,
    attribution?: PreferenceMutationAttribution,
  ) {
    return this.upsert(
      "ACTIVE",
      userId,
      definitionId,
      value,
      locationId,
      provenance,
      attribution,
    );
  }
  upsertSuggested(
    userId: string,
    definitionId: string,
    value: unknown,
    locationId?: string | null,
    provenance?: PreferenceProvenanceOptions,
    attribution?: PreferenceMutationAttribution,
  ) {
    return this.upsert(
      "SUGGESTED",
      userId,
      definitionId,
      value,
      locationId,
      provenance,
      attribution,
    );
  }
  upsertRejected(
    userId: string,
    definitionId: string,
    value: unknown,
    locationId?: string | null,
    provenance?: PreferenceProvenanceOptions,
  ) {
    return this.upsert(
      "REJECTED",
      userId,
      definitionId,
      value,
      locationId,
      provenance,
    );
  }
  private async upsert(
    status: PreferenceStatus,
    userId: string,
    definitionId: string,
    value: unknown,
    locationId: string | null | undefined,
    provenance: PreferenceProvenanceOptions | undefined,
    attribution?: PreferenceMutationAttribution,
  ): Promise<PreferenceWriteResult<EnrichedPreference>> {
    if (!provenance) throw new Error("Preference provenance is required");
    return this.mutate((c) => {
      const beforeState = enrich(
        c.get(
          joined +
            " WHERE p.user_id=? AND p.definition_id=? AND p.context_key=? AND p.status=?",
          [userId, definitionId, context(locationId), status],
        ),
      );
      const values: Record<string, any> = {
        ...(beforeState && value === undefined ? {} : { value: json(value) }),
        source_type: provenance.sourceType,
        confidence: provenance.confidence ?? null,
        evidence: optionalJson(provenance.evidence),
      };
      if (attribution)
        Object.assign(values, {
          last_actor_type: attribution.actorType,
          last_actor_client_key: attribution.actorClientKey ?? null,
          last_origin: attribution.origin,
        });
      const result = beforeState
        ? update<Preference>(
            c,
            "user_preferences",
            "id",
            beforeState.id,
            values,
          )
        : insert<Preference>(
            c,
            "user_preferences",
            timestamped({
              user_id: userId,
              definition_id: definitionId,
              location_id: locationId ?? null,
              context_key: context(locationId),
              status,
              ...values,
            }),
          );
      return { beforeState, result: find(c, result.id)! };
    });
  }
  hasRejected(
    userId: string,
    definitionId: string,
    locationId?: string | null,
  ): Promise<boolean> {
    return this.call((c) =>
      Boolean(
        c.get(
          "SELECT id FROM user_preferences WHERE user_id=? AND definition_id=? AND context_key=? AND status='REJECTED'",
          [userId, definitionId, context(locationId)],
        ),
      ),
    );
  }
  findById(id: string): Promise<EnrichedPreference | null> {
    return this.call((c) => find(c, id));
  }
  findByStatus(
    userId: string,
    status: PreferenceStatus,
    locationId?: string | null,
  ): Promise<EnrichedPreference[]> {
    const filter =
      locationId === undefined
        ? ""
        : locationId === null
          ? " AND p.location_id IS NULL"
          : " AND p.location_id=?";
    return this.call((c) =>
      c
        .all(
          joined +
            " WHERE p.user_id=? AND p.status=?" +
            filter +
            " ORDER BY p.updated_at DESC",
          [
            userId,
            status,
            ...(typeof locationId === "string" ? [locationId] : []),
          ],
        )
        .map(enrich),
    );
  }
  async findActiveWithMerge(
    userId: string,
    locationId: string,
  ): Promise<EnrichedPreference[]> {
    const [globals, locals] = await Promise.all([
      this.findByStatus(userId, "ACTIVE", null),
      this.findByStatus(userId, "ACTIVE", locationId),
    ]);
    const result = new Map(globals.map((row) => [row.definitionId, row]));
    for (const row of locals) result.set(row.definitionId, row);
    return [...result.values()].sort(
      (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime(),
    );
  }
  findSuggestedUnion(
    userId: string,
    locationId: string,
  ): Promise<EnrichedPreference[]> {
    return this.call((c) =>
      c
        .all(
          joined +
            " WHERE p.user_id=? AND p.status='SUGGESTED' AND (p.location_id IS NULL OR p.location_id=?) ORDER BY p.updated_at DESC",
          [userId, locationId],
        )
        .map(enrich),
    );
  }
  delete(id: string): Promise<EnrichedPreference> {
    return this.mutate((c) => {
      const row = find(c, id);
      if (!row) unavailable();
      c.run("DELETE FROM user_preferences WHERE id=?", [id]);
      return row;
    });
  }
  updateStatus(
    id: string,
    status: PreferenceStatus,
  ): Promise<EnrichedPreference> {
    return this.mutate((c) => {
      update(c, "user_preferences", "id", id, { status });
      return find(c, id)!;
    });
  }
  count(userId: string, status?: PreferenceStatus): Promise<number> {
    return this.call(
      (c) =>
        c.get(
          "SELECT count(*) n FROM user_preferences WHERE user_id=?" +
            (status ? " AND status=?" : ""),
          [userId, ...(status ? [status] : [])],
        ).n,
    );
  }
}
