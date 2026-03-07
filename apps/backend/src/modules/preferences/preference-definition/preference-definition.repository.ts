import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import type { PreferenceDefinition as PrismaPreferenceDefinition } from "@infrastructure/prisma/prisma-models";
import { PrismaService } from "@infrastructure/prisma/prisma.service";
import {
  PreferenceValueType,
  PreferenceScope,
} from "@infrastructure/prisma/generated-client";

export interface PreferenceDefinitionData extends PrismaPreferenceDefinition {
  category: string;
}

@Injectable()
export class PreferenceDefinitionRepository implements OnModuleInit {
  private readonly logger = new Logger(PreferenceDefinitionRepository.name);
  private cache = new Map<string, PreferenceDefinitionData>();

  constructor(private prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    await this.refreshCache();
  }

  /**
   * Loads all definitions from the database into the in-memory cache.
   * Derives category from slug prefix (e.g., "food.dietary_restrictions" → "food").
   */
  async refreshCache(): Promise<void> {
    const defs = await this.prisma.preferenceDefinition.findMany();
    this.cache.clear();
    for (const def of defs) {
      this.cache.set(def.slug, {
        ...def,
        category: def.slug.split(".")[0],
      });
    }
    this.logger.log(`Loaded ${this.cache.size} preference definitions`);
  }

  isKnownSlug(slug: string): boolean {
    return this.cache.has(slug);
  }

  getDefinition(slug: string): PreferenceDefinitionData | undefined {
    return this.cache.get(slug);
  }

  getAllSlugs(): string[] {
    return Array.from(this.cache.keys());
  }

  getSlugsByCategory(category: string): string[] {
    return Array.from(this.cache.entries())
      .filter(([, def]) => def.category === category)
      .map(([slug]) => slug);
  }

  getAllCategories(): string[] {
    const categories = new Set(
      Array.from(this.cache.values()).map((def) => def.category),
    );
    return Array.from(categories).sort();
  }

  /**
   * Finds slugs similar to the given input (for "did you mean?" suggestions).
   */
  findSimilarSlugs(input: string, limit = 3): string[] {
    const normalized = input.toLowerCase();
    const allSlugs = this.getAllSlugs();

    const scored = allSlugs.map((slug) => {
      let score = 0;
      const def = this.cache.get(slug)!;

      // Exact category match
      const [category] = slug.split(".");
      if (normalized.startsWith(category)) score += 10;

      // Prefix match
      if (slug.startsWith(normalized)) score += 5;

      // Contains the input
      if (slug.includes(normalized)) score += 3;

      // Check definition description
      if (def.description.toLowerCase().includes(normalized)) score += 2;

      return { slug, score };
    });

    return scored
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((s) => s.slug);
  }

  getAll(): PreferenceDefinitionData[] {
    return Array.from(this.cache.values());
  }

  /**
   * Creates a new preference definition in the database and refreshes the cache.
   */
  async create(data: {
    slug: string;
    description: string;
    valueType: PreferenceValueType | string;
    scope: PreferenceScope | string;
    options?: unknown;
    isSensitive?: boolean;
    isCore?: boolean;
  }): Promise<PrismaPreferenceDefinition> {
    const created = await this.prisma.preferenceDefinition.create({
      data: {
        slug: data.slug,
        description: data.description,
        valueType: data.valueType as PreferenceValueType,
        scope: data.scope as PreferenceScope,
        options: (data.options as any) ?? undefined,
        isSensitive: data.isSensitive ?? false,
        isCore: data.isCore ?? false,
      },
    });
    await this.refreshCache();
    return created;
  }

  /**
   * Updates an existing preference definition in the database and refreshes the cache.
   */
  async update(
    slug: string,
    data: {
      description?: string;
      valueType?: PreferenceValueType | string;
      scope?: PreferenceScope | string;
      options?: unknown;
      isSensitive?: boolean;
      isCore?: boolean;
    },
  ): Promise<PrismaPreferenceDefinition> {
    const updateData: Record<string, unknown> = {};
    if (data.description !== undefined)
      updateData.description = data.description;
    if (data.valueType !== undefined) updateData.valueType = data.valueType;
    if (data.scope !== undefined) updateData.scope = data.scope;
    if (data.options !== undefined) updateData.options = data.options;
    if (data.isSensitive !== undefined)
      updateData.isSensitive = data.isSensitive;
    if (data.isCore !== undefined) updateData.isCore = data.isCore;

    const updated = await this.prisma.preferenceDefinition.update({
      where: { slug },
      data: updateData,
    });
    await this.refreshCache();
    return updated;
  }
}
