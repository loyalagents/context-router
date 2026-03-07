import { Injectable, Logger } from "@nestjs/common";
import type { PreferenceDefinition as PrismaPreferenceDefinition } from "@infrastructure/prisma/prisma-models";
import { PrismaService } from "@infrastructure/prisma/prisma.service";
import {
  PreferenceValueType,
  PreferenceScope,
} from "@infrastructure/prisma/generated-client";

@Injectable()
export class PreferenceDefinitionRepository {
  private readonly logger = new Logger(PreferenceDefinitionRepository.name);

  constructor(private prisma: PrismaService) {}

  // ──────────────────────────────────────────────
  // Helpers
  // ──────────────────────────────────────────────

  private userNamespace(userId: string): string {
    return `USER:${userId}`;
  }

  private namespaceFor(ownerUserId: string | null | undefined): string {
    return ownerUserId ? this.userNamespace(ownerUserId) : "GLOBAL";
  }

  // ──────────────────────────────────────────────
  // Lookups
  // ──────────────────────────────────────────────

  /**
   * Resolves a slug to a definition id.
   * If userId is provided, prefers the user-owned definition over GLOBAL.
   * Returns null if no active definition is found.
   */
  async resolveSlugToDefinitionId(
    slug: string,
    userId?: string | null,
  ): Promise<string | null> {
    const def = await this.getDefinitionBySlug(slug, userId);
    return def?.id ?? null;
  }

  /**
   * Finds an active (non-archived) definition by slug.
   * User-first: if userId is provided, checks the user's namespace first.
   */
  async getDefinitionBySlug(
    slug: string,
    userId?: string | null,
  ): Promise<PrismaPreferenceDefinition | null> {
    if (userId) {
      const userDef = await this.prisma.preferenceDefinition.findFirst({
        where: {
          namespace: this.userNamespace(userId),
          slug,
          archivedAt: null,
        },
      });
      if (userDef) return userDef;
    }

    return this.prisma.preferenceDefinition.findFirst({
      where: { namespace: "GLOBAL", slug, archivedAt: null },
    });
  }

  /**
   * Finds a definition by id (including archived).
   */
  async getDefinitionById(
    id: string,
  ): Promise<PrismaPreferenceDefinition | null> {
    return this.prisma.preferenceDefinition.findUnique({ where: { id } });
  }

  /**
   * Returns active definitions filtered by export scope.
   * GLOBAL: system-owned only. PERSONAL: user-owned only. ALL: both.
   */
  async getByScope(
    scope: "GLOBAL" | "PERSONAL" | "ALL",
    userId: string,
  ): Promise<PrismaPreferenceDefinition[]> {
    const namespaces: string[] = [];
    if (scope === "GLOBAL" || scope === "ALL") namespaces.push("GLOBAL");
    if (scope === "PERSONAL" || scope === "ALL")
      namespaces.push(this.userNamespace(userId));

    return this.prisma.preferenceDefinition.findMany({
      where: { namespace: { in: namespaces }, archivedAt: null },
      orderBy: { slug: "asc" },
    });
  }

  /**
   * Returns all active definitions visible to the user:
   * GLOBAL definitions + user-owned definitions (if userId provided).
   * Archived definitions are excluded.
   */
  async getAll(userId?: string | null): Promise<PrismaPreferenceDefinition[]> {
    const namespaces: string[] = ["GLOBAL"];
    if (userId) namespaces.push(this.userNamespace(userId));

    return this.prisma.preferenceDefinition.findMany({
      where: {
        namespace: { in: namespaces },
        archivedAt: null,
      },
      orderBy: { slug: "asc" },
    });
  }

  // ──────────────────────────────────────────────
  // Slug/category helpers (direct DB, no cache)
  // ──────────────────────────────────────────────

  async isKnownSlug(slug: string, userId?: string | null): Promise<boolean> {
    const def = await this.getDefinitionBySlug(slug, userId);
    return def !== null;
  }

  async getAllSlugs(userId?: string | null): Promise<string[]> {
    const defs = await this.getAll(userId);
    return defs.map((d) => d.slug);
  }

  async getSlugsByCategory(
    category: string,
    userId?: string | null,
  ): Promise<string[]> {
    const defs = await this.getAll(userId);
    return defs
      .filter((d) => d.slug.split(".")[0] === category)
      .map((d) => d.slug);
  }

  async getAllCategories(userId?: string | null): Promise<string[]> {
    const defs = await this.getAll(userId);
    const categories = new Set(defs.map((d) => d.slug.split(".")[0]));
    return Array.from(categories).sort();
  }

  async findSimilarSlugs(
    input: string,
    limit = 3,
    userId?: string | null,
  ): Promise<string[]> {
    const normalized = input.toLowerCase();
    const defs = await this.getAll(userId);

    const scored = defs.map((def) => {
      let score = 0;
      const slug = def.slug;
      const category = slug.split(".")[0];

      if (normalized.startsWith(category)) score += 10;
      if (slug.startsWith(normalized)) score += 5;
      if (slug.includes(normalized)) score += 3;
      if (def.description.toLowerCase().includes(normalized)) score += 2;

      return { slug, score };
    });

    return scored
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((s) => s.slug);
  }

  // ──────────────────────────────────────────────
  // Mutations
  // ──────────────────────────────────────────────

  /**
   * Creates a new preference definition.
   * If ownerUserId is provided, namespace = "USER:<userId>".
   * Otherwise, namespace = "GLOBAL".
   */
  async create(data: {
    slug: string;
    displayName?: string;
    description: string;
    valueType: PreferenceValueType | string;
    scope: PreferenceScope | string;
    options?: unknown;
    isSensitive?: boolean;
    isCore?: boolean;
    ownerUserId?: string | null;
  }): Promise<PrismaPreferenceDefinition> {
    const namespace = this.namespaceFor(data.ownerUserId);

    const created = await this.prisma.preferenceDefinition.create({
      data: {
        namespace,
        slug: data.slug,
        displayName: data.displayName ?? null,
        description: data.description,
        valueType: data.valueType as PreferenceValueType,
        scope: data.scope as PreferenceScope,
        options: (data.options as any) ?? undefined,
        isSensitive: data.isSensitive ?? false,
        isCore: data.isCore ?? false,
        ownerUserId: data.ownerUserId ?? null,
      },
    });

    this.logger.log(`Created definition: ${namespace}/${data.slug}`);
    return created;
  }

  /**
   * Updates a definition by id.
   */
  async update(
    id: string,
    data: {
      displayName?: string;
      description?: string;
      valueType?: PreferenceValueType | string;
      scope?: PreferenceScope | string;
      options?: unknown;
      isSensitive?: boolean;
      isCore?: boolean;
    },
  ): Promise<PrismaPreferenceDefinition> {
    const updateData: Record<string, unknown> = {};
    if (data.displayName !== undefined) updateData.displayName = data.displayName;
    if (data.description !== undefined)
      updateData.description = data.description;
    if (data.valueType !== undefined) updateData.valueType = data.valueType;
    if (data.scope !== undefined) updateData.scope = data.scope;
    if (data.options !== undefined) updateData.options = data.options;
    if (data.isSensitive !== undefined)
      updateData.isSensitive = data.isSensitive;
    if (data.isCore !== undefined) updateData.isCore = data.isCore;

    return this.prisma.preferenceDefinition.update({
      where: { id },
      data: updateData,
    });
  }

  /**
   * Archives a definition by setting archivedAt.
   * After archiving, a new definition with the same (namespace, slug) can be created.
   */
  async archive(id: string): Promise<PrismaPreferenceDefinition> {
    const archived = await this.prisma.preferenceDefinition.update({
      where: { id },
      data: { archivedAt: new Date() },
    });
    this.logger.log(`Archived definition: ${id}`);
    return archived;
  }
}
