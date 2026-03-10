import { Injectable, Logger } from "@nestjs/common";
import { PreferenceDefinitionRepository } from "@modules/preferences/preference-definition/preference-definition.repository";

interface ListPreferencesParams {
  category?: string; // Optional filter by category
}

interface CatalogEntry {
  slug: string;
  category: string;
  description: string;
  valueType: string;
  options?: unknown;
  scope: string;
}

@Injectable()
export class PreferenceListTool {
  private readonly logger = new Logger(PreferenceListTool.name);

  constructor(private defRepo: PreferenceDefinitionRepository) {}

  /**
   * List all valid preference slugs from the catalog.
   * Helps LLMs discover what preferences exist before attempting to write.
   * When context is provided, user-owned definitions are included alongside global ones.
   */
  async list(params: ListPreferencesParams = {}, userId?: string, schemaNamespace?: string) {
    this.logger.log(
      `Listing preference catalog${params.category ? ` for category: ${params.category}` : ""}`,
    );

    try {
      const allDefs = await this.defRepo.getAll(userId, schemaNamespace);

      const filtered = params.category
        ? allDefs.filter((d) => d.slug.split(".")[0] === params.category)
        : allDefs;

      const entries: CatalogEntry[] = filtered.map((def) => ({
        slug: def.slug,
        category: def.slug.split(".")[0],
        description: def.description,
        valueType: def.valueType,
        options: def.options,
        scope: def.scope,
      }));

      // Get all categories for reference
      const categories = await this.defRepo.getAllCategories(userId, schemaNamespace);

      return {
        success: true,
        categories,
        count: entries.length,
        preferences: entries,
      };
    } catch (error) {
      this.logger.error(`Error listing preference catalog: ${error.message}`);

      return {
        success: false,
        error: error.message,
      };
    }
  }
}
