import { Injectable, Logger } from '@nestjs/common';
import { PreferenceDefinitionRepository } from '@modules/preferences/preference-definition/preference-definition.repository';

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
   */
  async list(params: ListPreferencesParams) {
    this.logger.log(
      `Listing preference catalog${params.category ? ` for category: ${params.category}` : ''}`,
    );

    try {
      // Get slugs (filtered by category if provided)
      const slugs = params.category
        ? this.defRepo.getSlugsByCategory(params.category)
        : this.defRepo.getAllSlugs();

      // Map to full catalog entries
      const entries: CatalogEntry[] = slugs.map((slug) => {
        const def = this.defRepo.getDefinition(slug)!;
        return {
          slug,
          category: def.category,
          description: def.description,
          valueType: def.valueType,
          options: def.options,
          scope: def.scope,
        };
      });

      // Get all categories for reference
      const categories = this.defRepo.getAllCategories();

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
