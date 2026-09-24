import type { PreferenceDefinitionRepository } from "../../../modules/preferences/preference-definition/preference-definition.repository";
import type { PreferenceDefinition } from "../../../domains/shared/storage/storage-types";
import {
  SqliteAccess,
  decode,
  insert,
  update,
  optionalJson,
  json,
  timestamped,
  placeholders,
} from "./sqlite-records";

type Create = Parameters<PreferenceDefinitionRepository["create"]>[0];
type Update = Parameters<PreferenceDefinitionRepository["update"]>[1];
export class SqlitePreferenceDefinitionRepository
  extends SqliteAccess
  implements PreferenceDefinitionRepository
{
  async resolveSlugToDefinitionId(slug: string, userId?: string | null) {
    return (await this.getDefinitionBySlug(slug, userId))?.id ?? null;
  }
  getDefinitionBySlug(
    slug: string,
    userId?: string | null,
  ): Promise<PreferenceDefinition | null> {
    return this.call((c) => {
      const personal = userId
        ? c.get(
            "SELECT * FROM preference_definitions WHERE namespace=? AND slug=? AND archived_at IS NULL",
            [`USER:${userId}`, slug],
          )
        : undefined;
      return decode<PreferenceDefinition>(
        personal ??
          c.get(
            "SELECT * FROM preference_definitions WHERE namespace='GLOBAL' AND slug=? AND archived_at IS NULL",
            [slug],
          ),
      );
    });
  }
  getUserDefinitionBySlugIncludingArchived(
    slug: string,
    userId: string,
  ): Promise<PreferenceDefinition | null> {
    return this.call((c) =>
      decode<PreferenceDefinition>(
        c.get(
          "SELECT * FROM preference_definitions WHERE namespace=? AND slug=? ORDER BY updated_at DESC LIMIT 1",
          [`USER:${userId}`, slug],
        ),
      ),
    );
  }
  getDefinitionById(id: string): Promise<PreferenceDefinition | null> {
    return this.call((c) =>
      decode<PreferenceDefinition>(
        c.get("SELECT * FROM preference_definitions WHERE id=?", [id]),
      ),
    );
  }
  getByScope(
    scope: "GLOBAL" | "PERSONAL" | "ALL",
    userId: string,
  ): Promise<PreferenceDefinition[]> {
    return this.visible(
      scope === "GLOBAL"
        ? ["GLOBAL"]
        : scope === "PERSONAL"
          ? [`USER:${userId}`]
          : ["GLOBAL", `USER:${userId}`],
    );
  }
  getAll(userId?: string | null): Promise<PreferenceDefinition[]> {
    return this.visible(userId ? ["GLOBAL", `USER:${userId}`] : ["GLOBAL"]);
  }
  private visible(namespaces: string[]): Promise<PreferenceDefinition[]> {
    return this.call((c) =>
      c
        .all(
          `SELECT * FROM preference_definitions WHERE namespace IN (${placeholders(namespaces)}) AND archived_at IS NULL ORDER BY slug ASC`,
          namespaces,
        )
        .map((row) => decode<PreferenceDefinition>(row)!),
    );
  }
  async isKnownSlug(slug: string, userId?: string | null): Promise<boolean> {
    return (await this.getDefinitionBySlug(slug, userId)) !== null;
  }
  async getAllSlugs(userId?: string | null): Promise<string[]> {
    return (await this.getAll(userId)).map((d) => d.slug);
  }
  async getSlugsByCategory(
    category: string,
    userId?: string | null,
  ): Promise<string[]> {
    return (await this.getAll(userId))
      .filter((d) => d.slug.split(".")[0] === category)
      .map((d) => d.slug);
  }
  async getAllCategories(userId?: string | null): Promise<string[]> {
    return Array.from(
      new Set((await this.getAll(userId)).map((d) => d.slug.split(".")[0])),
    ).sort();
  }
  async findSimilarSlugs(
    input: string,
    limit = 3,
    userId?: string | null,
  ): Promise<string[]> {
    const normalized = input.toLowerCase();
    return (await this.getAll(userId))
      .map((d) => ({
        slug: d.slug,
        score:
          (normalized.startsWith(d.slug.split(".")[0]) ? 10 : 0) +
          (d.slug.startsWith(normalized) ? 5 : 0) +
          (d.slug.includes(normalized) ? 3 : 0) +
          (d.description.toLowerCase().includes(normalized) ? 2 : 0),
      }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((x) => x.slug);
  }
  create(data: Create): Promise<PreferenceDefinition> {
    return this.call((c) =>
      insert<PreferenceDefinition>(
        c,
        "preference_definitions",
        timestamped({
          namespace: data.ownerUserId ? `USER:${data.ownerUserId}` : "GLOBAL",
          slug: data.slug,
          display_name: data.displayName ?? null,
          description: data.description,
          value_type: data.valueType,
          scope: data.scope,
          options: optionalJson(data.options),
          is_sensitive: Number(data.isSensitive ?? false),
          is_core: Number(data.isCore ?? false),
          owner_user_id: data.ownerUserId ?? null,
        }),
      ),
    );
  }
  update(id: string, data: Update): Promise<PreferenceDefinition> {
    const values: Record<string, any> = {};
    for (const [key, column] of [
      ["displayName", "display_name"],
      ["description", "description"],
      ["valueType", "value_type"],
      ["scope", "scope"],
    ] as const)
      if (data[key] !== undefined) values[column] = data[key];
    if (data.options !== undefined) values.options = json(data.options);
    if (data.isSensitive !== undefined)
      values.is_sensitive =
        data.isSensitive === null ? null : Number(data.isSensitive);
    if (data.isCore !== undefined)
      values.is_core = data.isCore === null ? null : Number(data.isCore);
    return this.call((c) =>
      update<PreferenceDefinition>(
        c,
        "preference_definitions",
        "id",
        id,
        values,
      ),
    );
  }
  archive(id: string): Promise<PreferenceDefinition> {
    return this.call((c) =>
      update<PreferenceDefinition>(c, "preference_definitions", "id", id, {
        archived_at: Date.now(),
      }),
    );
  }
}
