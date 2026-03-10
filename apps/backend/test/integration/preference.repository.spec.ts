/**
 * Preference Repository Integration Tests (definitionId + contextKey)
 *
 * Preferences are now identified by definitionId (UUID FK) + contextKey string.
 * contextKey = "GLOBAL" for global prefs, "LOCATION:<locationId>" for location-scoped.
 * EnrichedPreference.slug is derived from the joined definition record.
 */
import { PreferenceRepository } from "../../src/modules/preferences/preference/preference.repository";
import { PreferenceDefinitionRepository } from "../../src/modules/preferences/preference-definition/preference-definition.repository";
import { PrismaService } from "../../src/infrastructure/prisma/prisma.service";
import { getPrismaClient } from "../setup/test-db";
import {
  PreferenceStatus,
  SourceType,
} from "@infrastructure/prisma/generated-client";

describe("PreferenceRepository (integration)", () => {
  let repository: PreferenceRepository;
  let defRepo: PreferenceDefinitionRepository;
  let prisma: PrismaService;
  let testUserId: string;
  let testLocationId: string;
  // Definition IDs for seeded GLOBAL definitions
  let responseToneDefId: string;
  let responseLengthDefId: string;
  let dietaryRestrictionsDefId: string;
  let cuisinePrefsDefId: string;
  let spiceToleranceDefId: string;
  let defaultTempDefId: string;
  let quietHoursDefId: string;
  let seatPrefDefId: string;
  let techStackDefId: string;

  beforeAll(async () => {
    prisma = getPrismaClient() as unknown as PrismaService;
    defRepo = new PreferenceDefinitionRepository(prisma);
    repository = new PreferenceRepository(prisma, defRepo);
  });

  beforeEach(async () => {
    // Create a test user
    const user = await prisma.user.create({
      data: {
        email: "preftest@example.com",
        firstName: "Preference",
        lastName: "Test",
      },
    });
    testUserId = user.userId;

    // Create a test location
    const location = await prisma.location.create({
      data: {
        userId: testUserId,
        type: "HOME",
        label: "Test Home",
        address: "123 Test St",
      },
    });
    testLocationId = location.locationId;

    // Resolve definition IDs from seeded GLOBAL definitions
    responseToneDefId = (await defRepo.resolveSlugToDefinitionId(
      "system.response_tone",
    ))!;
    responseLengthDefId = (await defRepo.resolveSlugToDefinitionId(
      "system.response_length",
    ))!;
    dietaryRestrictionsDefId = (await defRepo.resolveSlugToDefinitionId(
      "food.dietary_restrictions",
    ))!;
    cuisinePrefsDefId = (await defRepo.resolveSlugToDefinitionId(
      "food.cuisine_preferences",
    ))!;
    spiceToleranceDefId = (await defRepo.resolveSlugToDefinitionId(
      "food.spice_tolerance",
    ))!;
    defaultTempDefId = (await defRepo.resolveSlugToDefinitionId(
      "location.default_temperature",
    ))!;
    quietHoursDefId = (await defRepo.resolveSlugToDefinitionId(
      "location.quiet_hours",
    ))!;
    seatPrefDefId = (await defRepo.resolveSlugToDefinitionId(
      "travel.seat_preference",
    ))!;
    techStackDefId = (await defRepo.resolveSlugToDefinitionId(
      "professional.skills",
    ))!;
  });

  // ──────────────────────────────────────────────
  // upsertActive
  // ──────────────────────────────────────────────
  describe("upsertActive", () => {
    it("should create a global ACTIVE preference with GLOBAL contextKey", async () => {
      const pref = await repository.upsertActive(
        testUserId,
        responseToneDefId,
        "casual",
      );

      expect(pref).toBeDefined();
      expect(pref.id).toBeDefined();
      expect(pref.userId).toBe(testUserId);
      expect(pref.definitionId).toBe(responseToneDefId);
      expect(pref.contextKey).toBe("GLOBAL");
      expect(pref.locationId).toBeNull();
      expect(pref.value).toBe("casual");
      expect(pref.status).toBe(PreferenceStatus.ACTIVE);
      expect(pref.sourceType).toBe(SourceType.USER);
      expect(pref.confidence).toBeNull();
      expect(pref.evidence).toBeNull();
      // Enriched fields from joined definition
      expect(pref.slug).toBe("system.response_tone");
      expect(pref.description).toBeDefined();
    });

    it("should create a location-scoped ACTIVE preference with LOCATION contextKey", async () => {
      const pref = await repository.upsertActive(
        testUserId,
        defaultTempDefId,
        "72",
        testLocationId,
      );

      expect(pref.locationId).toBe(testLocationId);
      expect(pref.contextKey).toBe(`LOCATION:${testLocationId}`);
      expect(pref.definitionId).toBe(defaultTempDefId);
      expect(pref.slug).toBe("location.default_temperature");
      expect(pref.value).toBe("72");
    });

    it("should store array values", async () => {
      const arrayValue = ["Italian", "Japanese", "Mexican"];
      const pref = await repository.upsertActive(
        testUserId,
        cuisinePrefsDefId,
        arrayValue,
      );
      expect(pref.value).toEqual(arrayValue);
    });

    it("should update existing ACTIVE preference (upsert)", async () => {
      await repository.upsertActive(testUserId, responseLengthDefId, "brief");
      const updated = await repository.upsertActive(
        testUserId,
        responseLengthDefId,
        "detailed",
      );

      expect(updated.value).toBe("detailed");

      const count = await repository.count(testUserId, PreferenceStatus.ACTIVE);
      expect(count).toBe(1);
    });

    it("should create an AGENT-authored ACTIVE preference with metadata", async () => {
      const evidence = {
        reason: "Agent applied directly",
        snippets: ["User said they prefer concise answers"],
      };

      const pref = await repository.upsertActive(
        testUserId,
        responseToneDefId,
        "professional",
        null,
        {
          sourceType: SourceType.AGENT,
          confidence: 0.93,
          evidence,
        },
      );

      expect(pref.status).toBe(PreferenceStatus.ACTIVE);
      expect(pref.sourceType).toBe(SourceType.AGENT);
      expect(pref.confidence).toBe(0.93);
      expect(pref.evidence).toEqual(evidence);
    });

    it("should clear AI metadata when a USER overwrite replaces an AGENT-authored row", async () => {
      await repository.upsertActive(
        testUserId,
        responseToneDefId,
        "professional",
        null,
        {
          sourceType: SourceType.AGENT,
          confidence: 0.88,
          evidence: { reason: "Agent inference" },
        },
      );

      const updated = await repository.upsertActive(
        testUserId,
        responseToneDefId,
        "casual",
      );

      expect(updated.sourceType).toBe(SourceType.USER);
      expect(updated.value).toBe("casual");
      expect(updated.confidence).toBeNull();
      expect(updated.evidence).toBeNull();
    });

    it("should handle global and location-scoped as separate preferences for same definition", async () => {
      const global = await repository.upsertActive(
        testUserId,
        defaultTempDefId,
        "70",
      );
      const locationScoped = await repository.upsertActive(
        testUserId,
        defaultTempDefId,
        "72",
        testLocationId,
      );

      expect(global.id).not.toBe(locationScoped.id);
      expect(global.contextKey).toBe("GLOBAL");
      expect(locationScoped.contextKey).toBe(`LOCATION:${testLocationId}`);

      const count = await repository.count(testUserId);
      expect(count).toBe(2);
    });
  });

  // ──────────────────────────────────────────────
  // upsertSuggested
  // ──────────────────────────────────────────────
  describe("upsertSuggested", () => {
    it("should create a SUGGESTED preference with confidence", async () => {
      const pref = await repository.upsertSuggested(
        testUserId,
        dietaryRestrictionsDefId,
        ["vegetarian"],
        0.85,
      );

      expect(pref.definitionId).toBe(dietaryRestrictionsDefId);
      expect(pref.slug).toBe("food.dietary_restrictions");
      expect(pref.value).toEqual(["vegetarian"]);
      expect(pref.status).toBe(PreferenceStatus.SUGGESTED);
      expect(pref.confidence).toBe(0.85);
      expect(pref.contextKey).toBe("GLOBAL");
    });

    it("should create SUGGESTED preference with evidence", async () => {
      const evidence = {
        snippets: ["I follow a vegan diet"],
        reason: "User mentioned dietary preference",
      };

      const pref = await repository.upsertSuggested(
        testUserId,
        dietaryRestrictionsDefId,
        ["vegan"],
        0.9,
        null,
        evidence,
      );

      expect(pref.evidence).toEqual(evidence);
    });

    it("should update existing SUGGESTED preference", async () => {
      await repository.upsertSuggested(
        testUserId,
        techStackDefId,
        ["JavaScript"],
        0.7,
      );

      const updated = await repository.upsertSuggested(
        testUserId,
        techStackDefId,
        ["TypeScript", "Node.js"],
        0.9,
      );

      expect(updated.value).toEqual(["TypeScript", "Node.js"]);
      expect(updated.confidence).toBe(0.9);

      const count = await repository.count(
        testUserId,
        PreferenceStatus.SUGGESTED,
      );
      expect(count).toBe(1);
    });
  });

  // ──────────────────────────────────────────────
  // upsertRejected / hasRejected
  // ──────────────────────────────────────────────
  describe("upsertRejected", () => {
    it("should create a REJECTED preference", async () => {
      const pref = await repository.upsertRejected(
        testUserId,
        seatPrefDefId,
        "middle",
      );

      expect(pref.status).toBe(PreferenceStatus.REJECTED);
      expect(pref.definitionId).toBe(seatPrefDefId);
      expect(pref.slug).toBe("travel.seat_preference");
      expect(pref.value).toBe("middle");
    });
  });

  describe("hasRejected", () => {
    it("should return true if REJECTED preference exists", async () => {
      await repository.upsertRejected(testUserId, seatPrefDefId, "middle");
      const result = await repository.hasRejected(testUserId, seatPrefDefId);
      expect(result).toBe(true);
    });

    it("should return false if no REJECTED preference exists", async () => {
      const result = await repository.hasRejected(testUserId, seatPrefDefId);
      expect(result).toBe(false);
    });

    it("should not find REJECTED if only ACTIVE exists", async () => {
      await repository.upsertActive(testUserId, seatPrefDefId, "window");
      const result = await repository.hasRejected(testUserId, seatPrefDefId);
      expect(result).toBe(false);
    });
  });

  // ──────────────────────────────────────────────
  // findByStatus
  // ──────────────────────────────────────────────
  describe("findByStatus", () => {
    it("should return empty array when no preferences exist", async () => {
      const prefs = await repository.findByStatus(
        testUserId,
        PreferenceStatus.ACTIVE,
      );
      expect(prefs).toEqual([]);
    });

    it("should return only ACTIVE preferences with enriched slug", async () => {
      await repository.upsertActive(testUserId, responseToneDefId, "casual");
      await repository.upsertSuggested(
        testUserId,
        dietaryRestrictionsDefId,
        ["vegan"],
        0.8,
      );

      const active = await repository.findByStatus(
        testUserId,
        PreferenceStatus.ACTIVE,
      );

      expect(active).toHaveLength(1);
      expect(active[0].slug).toBe("system.response_tone");
    });

    it("should return only SUGGESTED preferences", async () => {
      await repository.upsertActive(testUserId, responseToneDefId, "casual");
      await repository.upsertSuggested(
        testUserId,
        dietaryRestrictionsDefId,
        ["vegan"],
        0.8,
      );

      const suggested = await repository.findByStatus(
        testUserId,
        PreferenceStatus.SUGGESTED,
      );

      expect(suggested).toHaveLength(1);
      expect(suggested[0].slug).toBe("food.dietary_restrictions");
    });

    it("should return preferences ordered by updatedAt desc", async () => {
      await repository.upsertActive(testUserId, responseToneDefId, "casual");
      await repository.upsertActive(testUserId, responseLengthDefId, "brief");

      const prefs = await repository.findByStatus(
        testUserId,
        PreferenceStatus.ACTIVE,
      );

      expect(prefs[0].slug).toBe("system.response_length");
      expect(prefs[1].slug).toBe("system.response_tone");
    });

    it("should not return other users preferences", async () => {
      await repository.upsertActive(testUserId, responseToneDefId, "casual");

      const otherUser = await prisma.user.create({
        data: {
          email: "other@example.com",
          firstName: "Other",
          lastName: "User",
        },
      });
      await repository.upsertActive(
        otherUser.userId,
        responseToneDefId,
        "professional",
      );

      const prefs = await repository.findByStatus(
        testUserId,
        PreferenceStatus.ACTIVE,
      );
      expect(prefs).toHaveLength(1);
      expect(prefs[0].value).toBe("casual");
    });

    it("should filter by contextKey null (global only) when locationId=null", async () => {
      await repository.upsertActive(testUserId, responseToneDefId, "casual");
      await repository.upsertActive(
        testUserId,
        defaultTempDefId,
        "72",
        testLocationId,
      );

      const global = await repository.findByStatus(
        testUserId,
        PreferenceStatus.ACTIVE,
        null,
      );

      expect(global).toHaveLength(1);
      expect(global[0].slug).toBe("system.response_tone");
    });

    it("should filter by specific location when locationId provided", async () => {
      await repository.upsertActive(testUserId, responseToneDefId, "casual");
      await repository.upsertActive(
        testUserId,
        defaultTempDefId,
        "72",
        testLocationId,
      );

      const locationSpecific = await repository.findByStatus(
        testUserId,
        PreferenceStatus.ACTIVE,
        testLocationId,
      );

      expect(locationSpecific).toHaveLength(1);
      expect(locationSpecific[0].slug).toBe("location.default_temperature");
    });
  });

  // ──────────────────────────────────────────────
  // findById
  // ──────────────────────────────────────────────
  describe("findById", () => {
    it("should return enriched preference by ID", async () => {
      const created = await repository.upsertActive(
        testUserId,
        responseToneDefId,
        "casual",
      );

      const found = await repository.findById(created.id);

      expect(found).toBeDefined();
      expect(found!.id).toBe(created.id);
      expect(found!.slug).toBe("system.response_tone");
    });

    it("should return null for non-existent ID", async () => {
      const found = await repository.findById("non-existent-id");
      expect(found).toBeNull();
    });
  });

  // ──────────────────────────────────────────────
  // findActiveWithMerge (merge key = definitionId)
  // ──────────────────────────────────────────────
  describe("findActiveWithMerge", () => {
    it("should return global preferences when no location-specific exist", async () => {
      await repository.upsertActive(testUserId, responseToneDefId, "casual");
      await repository.upsertActive(testUserId, responseLengthDefId, "brief");

      const merged = await repository.findActiveWithMerge(
        testUserId,
        testLocationId,
      );

      expect(merged).toHaveLength(2);
    });

    it("should override global with location-specific for same definitionId", async () => {
      // Create global version
      await repository.upsertActive(testUserId, defaultTempDefId, "68");
      // Create location-specific version (same definitionId, different contextKey)
      await repository.upsertActive(
        testUserId,
        defaultTempDefId,
        "72",
        testLocationId,
      );

      const merged = await repository.findActiveWithMerge(
        testUserId,
        testLocationId,
      );

      // Only one entry for this definitionId, location-specific wins
      const tempPrefs = merged.filter(
        (p) => p.definitionId === defaultTempDefId,
      );
      expect(tempPrefs).toHaveLength(1);
      expect(tempPrefs[0].value).toBe("72");
      expect(tempPrefs[0].locationId).toBe(testLocationId);
    });
  });

  // ──────────────────────────────────────────────
  // findSuggestedUnion
  // ──────────────────────────────────────────────
  describe("findSuggestedUnion", () => {
    it("should return union of global and location-specific SUGGESTED", async () => {
      await repository.upsertSuggested(
        testUserId,
        dietaryRestrictionsDefId,
        ["vegetarian"],
        0.8,
      );
      await repository.upsertSuggested(
        testUserId,
        quietHoursDefId,
        "22:00-07:00",
        0.7,
        testLocationId,
      );

      const union = await repository.findSuggestedUnion(
        testUserId,
        testLocationId,
      );

      expect(union).toHaveLength(2);
    });
  });

  // ──────────────────────────────────────────────
  // updateStatus
  // ──────────────────────────────────────────────
  describe("updateStatus", () => {
    it("should update preference status", async () => {
      const created = await repository.upsertSuggested(
        testUserId,
        dietaryRestrictionsDefId,
        ["vegetarian"],
        0.8,
      );

      const updated = await repository.updateStatus(
        created.id,
        PreferenceStatus.ACTIVE,
      );

      expect(updated.status).toBe(PreferenceStatus.ACTIVE);
    });
  });

  // ──────────────────────────────────────────────
  // delete
  // ──────────────────────────────────────────────
  describe("delete", () => {
    it("should delete preference and return deleted preference", async () => {
      const created = await repository.upsertActive(
        testUserId,
        responseToneDefId,
        "casual",
      );

      const deleted = await repository.delete(created.id);
      expect(deleted.id).toBe(created.id);

      const found = await repository.findById(created.id);
      expect(found).toBeNull();
    });

    it("should fail to delete non-existent preference", async () => {
      await expect(repository.delete("non-existent-id")).rejects.toThrow();
    });
  });

  describe("deleteByStatusAndDefinition", () => {
    it("should delete a matching SUGGESTED preference by user, definition, and scope", async () => {
      await repository.upsertSuggested(
        testUserId,
        dietaryRestrictionsDefId,
        ["vegan"],
        0.8,
      );

      const deleted = await repository.deleteByStatusAndDefinition(
        testUserId,
        dietaryRestrictionsDefId,
        PreferenceStatus.SUGGESTED,
      );

      expect(deleted).toBe(true);
      const suggested = await repository.findByStatus(
        testUserId,
        PreferenceStatus.SUGGESTED,
      );
      expect(suggested).toEqual([]);
    });

    it("should return false when no matching preference exists", async () => {
      const deleted = await repository.deleteByStatusAndDefinition(
        testUserId,
        dietaryRestrictionsDefId,
        PreferenceStatus.SUGGESTED,
      );

      expect(deleted).toBe(false);
    });
  });

  // ──────────────────────────────────────────────
  // count
  // ──────────────────────────────────────────────
  describe("count", () => {
    it("should return 0 when no preferences exist", async () => {
      expect(await repository.count(testUserId)).toBe(0);
    });

    it("should return correct total count", async () => {
      await repository.upsertActive(testUserId, responseToneDefId, "casual");
      await repository.upsertSuggested(
        testUserId,
        dietaryRestrictionsDefId,
        ["vegan"],
        0.8,
      );
      await repository.upsertRejected(testUserId, seatPrefDefId, "middle");

      expect(await repository.count(testUserId)).toBe(3);
    });

    it("should return correct count filtered by status", async () => {
      await repository.upsertActive(testUserId, responseToneDefId, "casual");
      await repository.upsertActive(testUserId, responseLengthDefId, "brief");
      await repository.upsertSuggested(
        testUserId,
        dietaryRestrictionsDefId,
        ["vegan"],
        0.8,
      );

      expect(
        await repository.count(testUserId, PreferenceStatus.ACTIVE),
      ).toBe(2);
      expect(
        await repository.count(testUserId, PreferenceStatus.SUGGESTED),
      ).toBe(1);
    });
  });
});
