import { Injectable, Logger } from "@nestjs/common";
import type { Preference as PrismaPreference } from "@infrastructure/prisma/prisma-models";
import { PrismaService } from "@infrastructure/prisma/prisma.service";
import {
  Prisma,
  PreferenceStatus,
} from "@infrastructure/prisma/generated-client";
import { PreferenceDefinitionRepository } from "../preference-definition/preference-definition.repository";
import {
  PreferenceProvenanceOptions,
  PreferenceMutationAttribution,
  PreferenceWriteResult,
} from "../audit/audit.types";

// EnrichedPreference includes definition fields joined via Prisma include.
// slug/category/description are derived from the joined definition.
export interface EnrichedPreference extends PrismaPreference {
  slug: string;
  category: string;
  description?: string;
  lastModifiedBy: PreferenceMutationAttribution | null;
}

type PrefWithDefinition = PrismaPreference & {
  definition?: { slug: string; description: string } | null;
};

@Injectable()
export class PreferenceRepository {
  private readonly logger = new Logger(PreferenceRepository.name);

  constructor(
    private prisma: PrismaService,
    private defRepo: PreferenceDefinitionRepository,
  ) {}

  // ──────────────────────────────────────────────
  // Helpers
  // ──────────────────────────────────────────────

  private contextKeyFor(locationId?: string | null): string {
    return locationId ? `LOCATION:${locationId}` : "GLOBAL";
  }

  private enrich(pref: PrefWithDefinition): EnrichedPreference {
    const slug = pref.definition?.slug ?? "";
    return {
      ...pref,
      slug,
      category: slug.split(".")[0],
      description: pref.definition?.description,
      lastModifiedBy: this.toLastModifiedBy(pref),
    };
  }

  private enrichMany(prefs: PrefWithDefinition[]): EnrichedPreference[] {
    return prefs.map((p) => this.enrich(p));
  }

  private readonly includeDefinition = {
    definition: { select: { slug: true, description: true } },
  } as const;

  private toJsonValue(value: unknown) {
    return value == null ? Prisma.DbNull : (value as Prisma.InputJsonValue);
  }

  private toLastModifiedBy(
    pref: Pick<
      PrismaPreference,
      "lastActorType" | "lastActorClientKey" | "lastOrigin"
    >,
  ): PreferenceMutationAttribution | null {
    if (!pref.lastActorType || !pref.lastOrigin) {
      return null;
    }

    return {
      actorType: pref.lastActorType,
      actorClientKey: pref.lastActorClientKey,
      origin: pref.lastOrigin,
    };
  }

  private lastModifiedData(attribution?: PreferenceMutationAttribution) {
    if (!attribution) {
      return {};
    }

    return {
      lastActorType: attribution.actorType,
      lastActorClientKey: attribution.actorClientKey ?? null,
      lastOrigin: attribution.origin,
    };
  }

  // ──────────────────────────────────────────────
  // Upserts
  // ──────────────────────────────────────────────

  /**
   * Upserts an ACTIVE preference for a user.
   * @param definitionId - The UUID of the preference definition.
   * @param locationId   - Optional location; null/undefined means global.
   */
  async upsertActive(
    userId: string,
    definitionId: string,
    value: any,
    locationId?: string | null,
    provenance?: PreferenceProvenanceOptions,
    mutationAttribution?: PreferenceMutationAttribution,
    tx?: Prisma.TransactionClient,
  ): Promise<PreferenceWriteResult<EnrichedPreference>> {
    if (!provenance) {
      throw new Error("Preference provenance is required");
    }

    const client = tx ?? this.prisma;
    const normalizedLocationId = locationId ?? null;
    const contextKey = this.contextKeyFor(normalizedLocationId);

    const existing = await client.preference.findFirst({
      where: { userId, definitionId, contextKey, status: PreferenceStatus.ACTIVE },
      include: this.includeDefinition,
    });
    const beforeState = existing ? this.enrich(existing) : null;

    let result: PrefWithDefinition;

    if (existing) {
      result = await client.preference.update({
        where: { id: existing.id },
        data: {
          value,
          sourceType: provenance.sourceType,
          confidence: provenance.confidence ?? null,
          evidence: this.toJsonValue(provenance.evidence),
          ...this.lastModifiedData(mutationAttribution),
        },
        include: this.includeDefinition,
      });
    } else {
      result = await client.preference.create({
        data: {
          userId,
          locationId: normalizedLocationId,
          contextKey,
          definitionId,
          value,
          status: PreferenceStatus.ACTIVE,
          sourceType: provenance.sourceType,
          confidence: provenance.confidence ?? null,
          evidence: this.toJsonValue(provenance.evidence),
          ...this.lastModifiedData(mutationAttribution),
        },
        include: this.includeDefinition,
      });
    }

    return { result: this.enrich(result), beforeState };
  }

  /**
   * Upserts a SUGGESTED preference for a user.
   */
  async upsertSuggested(
    userId: string,
    definitionId: string,
    value: any,
    locationId?: string | null,
    provenance?: PreferenceProvenanceOptions,
    mutationAttribution?: PreferenceMutationAttribution,
    tx?: Prisma.TransactionClient,
  ): Promise<PreferenceWriteResult<EnrichedPreference>> {
    if (!provenance) {
      throw new Error("Preference provenance is required");
    }

    const client = tx ?? this.prisma;
    const normalizedLocationId = locationId ?? null;
    const contextKey = this.contextKeyFor(normalizedLocationId);

    const existing = await client.preference.findFirst({
      where: { userId, definitionId, contextKey, status: PreferenceStatus.SUGGESTED },
      include: this.includeDefinition,
    });
    const beforeState = existing ? this.enrich(existing) : null;

    let result: PrefWithDefinition;

    if (existing) {
      result = await client.preference.update({
        where: { id: existing.id },
        data: {
          value,
          confidence: provenance.confidence ?? null,
          evidence: this.toJsonValue(provenance.evidence),
          sourceType: provenance.sourceType,
          ...this.lastModifiedData(mutationAttribution),
        },
        include: this.includeDefinition,
      });
    } else {
      result = await client.preference.create({
        data: {
          userId,
          locationId: normalizedLocationId,
          contextKey,
          definitionId,
          value,
          status: PreferenceStatus.SUGGESTED,
          sourceType: provenance.sourceType,
          confidence: provenance.confidence ?? null,
          evidence: this.toJsonValue(provenance.evidence),
          ...this.lastModifiedData(mutationAttribution),
        },
        include: this.includeDefinition,
      });
    }

    return { result: this.enrich(result), beforeState };
  }

  /**
   * Upserts a REJECTED preference for a user.
   */
  async upsertRejected(
    userId: string,
    definitionId: string,
    value: any,
    locationId?: string | null,
    provenance?: PreferenceProvenanceOptions,
    tx?: Prisma.TransactionClient,
  ): Promise<PreferenceWriteResult<EnrichedPreference>> {
    if (!provenance) {
      throw new Error("Preference provenance is required");
    }

    const client = tx ?? this.prisma;
    const normalizedLocationId = locationId ?? null;
    const contextKey = this.contextKeyFor(normalizedLocationId);

    const existing = await client.preference.findFirst({
      where: { userId, definitionId, contextKey, status: PreferenceStatus.REJECTED },
      include: this.includeDefinition,
    });
    const beforeState = existing ? this.enrich(existing) : null;

    let result: PrefWithDefinition;

    if (existing) {
      result = await client.preference.update({
        where: { id: existing.id },
        data: {
          value,
          sourceType: provenance.sourceType,
          confidence: provenance.confidence ?? null,
          evidence: this.toJsonValue(provenance.evidence),
          updatedAt: new Date(),
        },
        include: this.includeDefinition,
      });
    } else {
      result = await client.preference.create({
        data: {
          userId,
          locationId: normalizedLocationId,
          contextKey,
          definitionId,
          value,
          status: PreferenceStatus.REJECTED,
          sourceType: provenance.sourceType,
          confidence: provenance.confidence ?? null,
          evidence: this.toJsonValue(provenance.evidence),
        },
        include: this.includeDefinition,
      });
    }

    return { result: this.enrich(result), beforeState };
  }

  // ──────────────────────────────────────────────
  // Queries
  // ──────────────────────────────────────────────

  async hasRejected(
    userId: string,
    definitionId: string,
    locationId?: string | null,
  ): Promise<boolean> {
    const count = await this.prisma.preference.count({
      where: {
        userId,
        definitionId,
        contextKey: this.contextKeyFor(locationId),
        status: PreferenceStatus.REJECTED,
      },
    });
    return count > 0;
  }

  async findById(id: string): Promise<EnrichedPreference | null> {
    const result = await this.prisma.preference.findUnique({
      where: { id },
      include: this.includeDefinition,
    });
    return result ? this.enrich(result) : null;
  }

  /**
   * Finds preferences for a user with a specific status.
   * @param locationId - undefined = all; null = global only; string = that location only.
   */
  async findByStatus(
    userId: string,
    status: PreferenceStatus,
    locationId?: string | null,
  ): Promise<EnrichedPreference[]> {
    const locationFilter =
      locationId === undefined
        ? {}
        : locationId === null
          ? { locationId: null }
          : { locationId };

    const results = await this.prisma.preference.findMany({
      where: { userId, status, ...locationFilter },
      orderBy: { updatedAt: "desc" },
      include: this.includeDefinition,
    });

    return this.enrichMany(results);
  }

  /**
   * Returns merged ACTIVE preferences: location-specific overrides global for same definitionId.
   */
  async findActiveWithMerge(
    userId: string,
    locationId: string,
  ): Promise<EnrichedPreference[]> {
    const [globalPrefs, locationPrefs] = await Promise.all([
      this.prisma.preference.findMany({
        where: { userId, locationId: null, status: PreferenceStatus.ACTIVE },
        include: this.includeDefinition,
      }),
      this.prisma.preference.findMany({
        where: { userId, locationId, status: PreferenceStatus.ACTIVE },
        include: this.includeDefinition,
      }),
    ]);

    const mergedMap = new Map<string, PrefWithDefinition>();

    for (const pref of globalPrefs) {
      mergedMap.set(pref.definitionId, pref);
    }
    for (const pref of locationPrefs) {
      mergedMap.set(pref.definitionId, pref); // location-specific wins
    }

    const merged = Array.from(mergedMap.values());
    merged.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

    return this.enrichMany(merged);
  }

  /**
   * Returns union of global + location-specific SUGGESTED preferences (no merge).
   */
  async findSuggestedUnion(
    userId: string,
    locationId: string,
  ): Promise<EnrichedPreference[]> {
    const results = await this.prisma.preference.findMany({
      where: {
        userId,
        status: PreferenceStatus.SUGGESTED,
        OR: [{ locationId: null }, { locationId }],
      },
      orderBy: { updatedAt: "desc" },
      include: this.includeDefinition,
    });

    return this.enrichMany(results);
  }

  async delete(
    id: string,
    tx?: Prisma.TransactionClient,
  ): Promise<EnrichedPreference> {
    const client = tx ?? this.prisma;
    const result = await client.preference.delete({
      where: { id },
      include: this.includeDefinition,
    });
    return this.enrich(result);
  }

  async updateStatus(
    id: string,
    status: PreferenceStatus,
  ): Promise<EnrichedPreference> {
    const result = await this.prisma.preference.update({
      where: { id },
      data: { status },
      include: this.includeDefinition,
    });
    return this.enrich(result);
  }

  async count(userId: string, status?: PreferenceStatus): Promise<number> {
    return this.prisma.preference.count({
      where: { userId, ...(status ? { status } : {}) },
    });
  }
}
