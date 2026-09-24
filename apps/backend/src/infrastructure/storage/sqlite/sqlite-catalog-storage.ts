import type {
  CatalogStorage,
  CatalogDefinitionData,
} from "../../../domains/shared/storage/catalog-storage";
import {
  SqliteAccess,
  insert,
  update,
  timestamped,
  json,
} from "./sqlite-records";
const data = (value: CatalogDefinitionData) => ({
  display_name: value.displayName,
  description: value.description,
  value_type: value.valueType,
  scope: value.scope,
  options: json(value.options),
  is_sensitive: Number(value.isSensitive),
  is_core: Number(value.isCore),
});
export class SqliteCatalogStorage
  extends SqliteAccess
  implements CatalogStorage
{
  findActiveGlobal(slug: string): Promise<{ id: string } | null> {
    return this.call((c) => {
      const row = c.get(
        "SELECT id FROM preference_definitions WHERE namespace='GLOBAL' AND slug=? AND archived_at IS NULL",
        [slug],
      );
      return row ? { id: String(row.id) } : null;
    });
  }
  async updateGlobal(id: string, value: CatalogDefinitionData): Promise<void> {
    await this.call((c) =>
      update(c, "preference_definitions", "id", id, data(value)),
    );
  }
  countActivePersonalCollisions(slug: string): Promise<number> {
    return this.call(
      (c) =>
        c.get(
          "SELECT count(*) n FROM preference_definitions WHERE namespace<>'GLOBAL' AND slug=? AND archived_at IS NULL",
          [slug],
        ).n,
    );
  }
  async createGlobal(
    slug: string,
    value: CatalogDefinitionData,
  ): Promise<void> {
    await this.call((c) =>
      insert(
        c,
        "preference_definitions",
        timestamped({
          namespace: "GLOBAL",
          slug,
          owner_user_id: null,
          ...data(value),
        }),
      ),
    );
  }
}
