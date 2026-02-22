import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '@infrastructure/prisma/prisma.service';
import {
  PreferenceDefinition as PrismaPreferenceDefinition,
  PreferenceValueType,
  PreferenceScope,
} from '@prisma/client';

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
        category: def.slug.split('.')[0],
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
      const [category] = slug.split('.');
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
}
