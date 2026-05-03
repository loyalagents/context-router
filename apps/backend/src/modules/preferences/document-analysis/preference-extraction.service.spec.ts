import { Test, TestingModule } from "@nestjs/testing";
import { Logger } from "@nestjs/common";
import { PreferenceExtractionService } from "./preference-extraction.service";
import { PreferenceService } from "../preference/preference.service";
import { AiStructuredOutputPort } from "../../../domains/shared/ports/ai-structured-output.port";
import { PreferenceOperation } from "./dto/preference-suggestion.dto";
import { EnrichedPreference } from "../preference/preference.repository";
import {
  PreferenceStatus,
  SourceType,
  PreferenceValueType,
  PreferenceScope,
} from "@infrastructure/prisma/generated-client";
import { PreferenceDefinitionRepository } from "../preference-definition/preference-definition.repository";
import { PreferenceSchemaSnapshotService } from "../preference-definition/preference-schema-snapshot.service";
import { PREFERENCE_CATALOG } from "../../../config/preferences.catalog";

// Helper to create mock Preference objects using the new definitionId-based model
const createMockPreference = (
  slug: string,
  value: any,
): EnrichedPreference => ({
  id: `pref-${slug.replace(".", "-")}`,
  userId: "user-1",
  slug,
  category: slug.split(".")[0],
  definitionId: `def-${slug.replace(".", "-")}`,
  contextKey: "GLOBAL",
  value,
  status: PreferenceStatus.ACTIVE,
  sourceType: SourceType.USER,
  lastActorType: null,
  lastActorClientKey: null,
  lastOrigin: null,
  lastModifiedBy: null,
  locationId: null,
  confidence: null,
  evidence: null,
  createdAt: new Date(),
  updatedAt: new Date(),
});

// Build mock definition data from catalog
const VALUE_TYPE_MAP: Record<string, PreferenceValueType> = {
  string: PreferenceValueType.STRING,
  boolean: PreferenceValueType.BOOLEAN,
  enum: PreferenceValueType.ENUM,
  array: PreferenceValueType.ARRAY,
};
const SCOPE_MAP: Record<string, PreferenceScope> = {
  global: PreferenceScope.GLOBAL,
  location: PreferenceScope.LOCATION,
};
const mockDefinitions = new Map(
  Object.entries(PREFERENCE_CATALOG).map(([slug, def]) => [
    slug,
    {
      slug,
      description: def.description,
      valueType: VALUE_TYPE_MAP[def.valueType],
      scope: SCOPE_MAP[def.scope],
      options: def.options ?? null,
      isSensitive: def.isSensitive ?? false,
      isCore: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      category: slug.split(".")[0],
    },
  ]),
);

describe("PreferenceExtractionService", () => {
  let service: PreferenceExtractionService;
  let mockAiStructuredService: jest.Mocked<AiStructuredOutputPort>;
  let mockPreferenceService: jest.Mocked<PreferenceService>;
  let mockDefRepo: jest.Mocked<PreferenceDefinitionRepository>;
  let mockSnapshotService: jest.Mocked<PreferenceSchemaSnapshotService>;

  beforeEach(async () => {
    mockAiStructuredService = {
      generateStructured: jest.fn(),
      generateStructuredWithFile: jest.fn(),
    };

    mockPreferenceService = {
      getActivePreferences: jest.fn(),
      getSuggestedPreferences: jest.fn(),
      setPreference: jest.fn(),
      suggestPreference: jest.fn(),
      acceptSuggestion: jest.fn(),
      rejectSuggestion: jest.fn(),
      deletePreference: jest.fn(),
    } as any;

    mockDefRepo = {
      isKnownSlug: jest
        .fn()
        .mockResolvedValue(true)
        .mockImplementation((slug: string) =>
          Promise.resolve(mockDefinitions.has(slug)),
        ),
      getAll: jest
        .fn()
        .mockResolvedValue(Array.from(mockDefinitions.values())),
      getSlugsByCategory: jest.fn(),
      getAllCategories: jest.fn(),
      findSimilarSlugs: jest.fn(),
      getDefinitionBySlug: jest
        .fn()
        .mockImplementation((slug: string) =>
          Promise.resolve(mockDefinitions.get(slug) ?? null),
        ),
      resolveSlugToDefinitionId: jest.fn().mockResolvedValue(null),
    } as any;

    mockSnapshotService = {
      getSnapshot: jest.fn().mockResolvedValue({
        definitions: Array.from(mockDefinitions.values()).map((d) => ({
          slug: d.slug,
          category: d.category,
          description: d.description,
          valueType: d.valueType,
          options: d.options,
          namespace: "GLOBAL",
        })),
        promptJson: "[]",
      }),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PreferenceExtractionService,
        {
          provide: "AiStructuredOutputPort",
          useValue: mockAiStructuredService,
        },
        {
          provide: PreferenceService,
          useValue: mockPreferenceService,
        },
        {
          provide: PreferenceDefinitionRepository,
          useValue: mockDefRepo,
        },
        {
          provide: PreferenceSchemaSnapshotService,
          useValue: mockSnapshotService,
        },
      ],
    }).compile();

    service = module.get<PreferenceExtractionService>(
      PreferenceExtractionService,
    );

    // Suppress logger output during tests
    jest.spyOn(Logger.prototype, "log").mockImplementation();
    jest.spyOn(Logger.prototype, "warn").mockImplementation();
    jest.spyOn(Logger.prototype, "error").mockImplementation();
    jest.spyOn(Logger.prototype, "debug").mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("validateAndSanitizeSuggestions (via extractPreferences)", () => {
    const mockFileBuffer = Buffer.from("test document content");
    const mockMimeType = "text/plain";
    const mockFilename = "test.txt";

    // Helper to create AI response object (port returns parsed objects directly)
    const createAiResponse = (
      suggestions: any[],
      documentSummary = "Test document",
    ) => ({ suggestions, documentSummary });

    const createConsolidationResponse = (suggestion: any) => ({
      suggestion,
    });

    describe("filtering unknown slugs", () => {
      it("should filter out suggestions with unknown slugs", async () => {
        mockPreferenceService.getActivePreferences.mockResolvedValue([]);
        mockAiStructuredService.generateStructuredWithFile.mockResolvedValue(
          createAiResponse([
            {
              slug: "unknown.invalid_slug",
              operation: "CREATE",
              newValue: ["peanuts"],
              confidence: 0.9,
              sourceSnippet: "allergic to peanuts",
            },
          ]),
        );

        const result = await service.extractPreferences(
          "user-1",
          mockFileBuffer,
          mockMimeType,
          mockFilename,
        );

        expect(result.suggestions).toHaveLength(0);
        expect(result.filteredCount).toBe(1);
        expect(result.filteredSuggestions[0].filterReason).toBe("UNKNOWN_SLUG");
      });

      it("should filter out suggestions missing newValue", async () => {
        mockPreferenceService.getActivePreferences.mockResolvedValue([]);
        mockAiStructuredService.generateStructuredWithFile.mockResolvedValue(
          createAiResponse([
            {
              slug: "food.dietary_restrictions",
              operation: "CREATE",
              // newValue is missing
              confidence: 0.9,
              sourceSnippet: "allergic to peanuts",
            },
          ]),
        );

        const result = await service.extractPreferences(
          "user-1",
          mockFileBuffer,
          mockMimeType,
          mockFilename,
        );

        // newValue is optional in Zod schema, so it passes validation
        // but gets filtered out due to missing required fields
        expect(result.suggestions).toHaveLength(0);
        expect(result.filteredCount).toBe(1);
        expect(result.filteredSuggestions[0].filterReason).toBe(
          "MISSING_FIELDS",
        );
      });
    });

    describe("duplicate slug consolidation", () => {
      it("should consolidate duplicate slug groups into one merged suggestion", async () => {
        mockPreferenceService.getActivePreferences.mockResolvedValue([]);
        mockAiStructuredService.generateStructuredWithFile.mockResolvedValue(
          createAiResponse([
            {
              slug: "food.dietary_restrictions",
              operation: "CREATE",
              newValue: ["peanuts"],
              confidence: 0.9,
              sourceSnippet: "allergic to peanuts",
            },
            {
              slug: "food.dietary_restrictions",
              operation: "CREATE",
              newValue: ["shellfish"], // duplicate slug, different value
              confidence: 0.8,
              sourceSnippet: "allergic to shellfish",
            },
          ]),
        );
        mockAiStructuredService.generateStructured.mockResolvedValue(
          createConsolidationResponse({
            slug: "food.dietary_restrictions",
            operation: "CREATE",
            newValue: ["peanuts", "shellfish"],
            confidence: 0.95,
            sourceSnippet: "allergic to shellfish",
            sourceMeta: { page: 2, line: 4 },
          }),
        );

        const result = await service.extractPreferences(
          "user-1",
          mockFileBuffer,
          mockMimeType,
          mockFilename,
        );

        expect(result.suggestions).toHaveLength(1);
        expect(result.suggestions[0]).toMatchObject({
          id: "consolidated:food.dietary_restrictions",
          slug: "food.dietary_restrictions",
          newValue: ["peanuts", "shellfish"],
          confidence: 0.95,
          sourceSnippet: "allergic to shellfish",
        });
        expect(result.filteredCount).toBe(2);
        expect(result.filteredSuggestions).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: "filtered:duplicate:food.dietary_restrictions:0",
              filterReason: "DUPLICATE_KEY",
              sourceSnippet: "allergic to peanuts",
            }),
            expect.objectContaining({
              id: "filtered:duplicate:food.dietary_restrictions:1",
              filterReason: "DUPLICATE_KEY",
              sourceSnippet: "allergic to shellfish",
            }),
          ]),
        );
        expect(mockAiStructuredService.generateStructured).toHaveBeenCalledTimes(
          1,
        );
      });

      it("should preserve a later duplicate when the first would become no-change", async () => {
        mockPreferenceService.getActivePreferences.mockResolvedValue([
          createMockPreference("food.dietary_restrictions", ["peanuts"]),
        ]);
        mockAiStructuredService.generateStructuredWithFile.mockResolvedValue(
          createAiResponse([
            {
              slug: "food.dietary_restrictions",
              operation: "UPDATE",
              oldValue: ["peanuts"],
              newValue: ["peanuts"],
              confidence: 0.7,
              sourceSnippet: "still allergic to peanuts",
            },
            {
              slug: "food.dietary_restrictions",
              operation: "UPDATE",
              oldValue: ["peanuts"],
              newValue: ["peanuts", "shellfish"],
              confidence: 0.92,
              sourceSnippet: "allergic to peanuts and shellfish",
            },
          ]),
        );
        mockAiStructuredService.generateStructured.mockResolvedValue(
          createConsolidationResponse({
            slug: "food.dietary_restrictions",
            operation: "UPDATE",
            oldValue: ["peanuts"],
            newValue: ["peanuts", "shellfish"],
            confidence: 0.91,
            sourceSnippet: "allergic to peanuts and shellfish",
          }),
        );

        const result = await service.extractPreferences(
          "user-1",
          mockFileBuffer,
          mockMimeType,
          mockFilename,
        );

        expect(result.suggestions).toHaveLength(1);
        expect(result.suggestions[0]).toMatchObject({
          id: "consolidated:food.dietary_restrictions",
          newValue: ["peanuts", "shellfish"],
        });
      });

      it("should fall back to the first valid candidate when consolidation fails", async () => {
        mockPreferenceService.getActivePreferences.mockResolvedValue([]);
        mockAiStructuredService.generateStructuredWithFile.mockResolvedValue(
          createAiResponse([
            {
              slug: "food.dietary_restrictions",
              operation: "CREATE",
              newValue: ["peanuts"],
              confidence: 0.9,
              sourceSnippet: "allergic to peanuts",
            },
            {
              slug: "food.dietary_restrictions",
              operation: "CREATE",
              newValue: ["shellfish"],
              confidence: 0.8,
              sourceSnippet: "allergic to shellfish",
            },
          ]),
        );
        mockAiStructuredService.generateStructured.mockRejectedValue(
          new Error("consolidation failed"),
        );

        const result = await service.extractPreferences(
          "user-1",
          mockFileBuffer,
          mockMimeType,
          mockFilename,
        );

        expect(result.suggestions).toHaveLength(1);
        expect(result.suggestions[0]).toMatchObject({
          id: "candidate:0",
          newValue: ["peanuts"],
        });
        expect(result.filteredSuggestions).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: "filtered:duplicate:food.dietary_restrictions:1",
              filterReason: "DUPLICATE_KEY",
            }),
          ]),
        );
        expect(Logger.prototype.warn).toHaveBeenCalledWith(
          expect.stringContaining("[DUPLICATE_GROUP_FALLBACK_FIRST]"),
        );
      });

      it("should add a synthetic no-change filtered item when consolidation matches the DB value", async () => {
        mockPreferenceService.getActivePreferences.mockResolvedValue([
          createMockPreference("food.dietary_restrictions", [
            "peanuts",
            "shellfish",
          ]),
        ]);
        mockAiStructuredService.generateStructuredWithFile.mockResolvedValue(
          createAiResponse([
            {
              slug: "food.dietary_restrictions",
              operation: "UPDATE",
              oldValue: ["peanuts"],
              newValue: ["peanuts"],
              confidence: 0.7,
              sourceSnippet: "allergic to peanuts",
            },
            {
              slug: "food.dietary_restrictions",
              operation: "UPDATE",
              oldValue: ["peanuts"],
              newValue: ["peanuts", "shellfish"],
              confidence: 0.9,
              sourceSnippet: "also allergic to shellfish",
              sourceMeta: { page: 3, line: 8 },
            },
          ]),
        );
        mockAiStructuredService.generateStructured.mockResolvedValue(
          createConsolidationResponse({
            slug: "food.dietary_restrictions",
            operation: "UPDATE",
            oldValue: ["peanuts"],
            newValue: ["peanuts", "shellfish"],
            confidence: 0.88,
            sourceSnippet: "also allergic to shellfish",
            sourceMeta: { page: 3, line: 8 },
          }),
        );

        const result = await service.extractPreferences(
          "user-1",
          mockFileBuffer,
          mockMimeType,
          mockFilename,
        );

        expect(result.suggestions).toHaveLength(0);
        expect(result.filteredCount).toBe(3);
        expect(result.filteredSuggestions).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: "filtered:consolidated-no-change:food.dietary_restrictions",
              filterReason: "NO_CHANGE",
              confidence: 0.88,
              sourceSnippet: "also allergic to shellfish",
              filterDetails:
                "Consolidated 2 candidates for food.dietary_restrictions, but the merged value matches the existing preference.",
            }),
            expect.objectContaining({
              id: "filtered:duplicate:food.dietary_restrictions:0",
              filterReason: "DUPLICATE_KEY",
            }),
            expect.objectContaining({
              id: "filtered:duplicate:food.dietary_restrictions:1",
              filterReason: "DUPLICATE_KEY",
            }),
          ]),
        );
      });

      it("should skip consolidation when only one candidate survives pre-filtering", async () => {
        mockPreferenceService.getActivePreferences.mockResolvedValue([]);
        mockAiStructuredService.generateStructuredWithFile.mockResolvedValue(
          createAiResponse([
            {
              slug: "food.dietary_restrictions",
              operation: "CREATE",
              confidence: 0.9,
              sourceSnippet: "missing value",
            },
            {
              slug: "food.dietary_restrictions",
              operation: "CREATE",
              newValue: ["peanuts"],
              confidence: 0.92,
              sourceSnippet: "allergic to peanuts",
            },
          ]),
        );

        const result = await service.extractPreferences(
          "user-1",
          mockFileBuffer,
          mockMimeType,
          mockFilename,
        );

        expect(result.suggestions).toHaveLength(1);
        expect(result.suggestions[0]).toMatchObject({
          id: "candidate:1",
          newValue: ["peanuts"],
        });
        expect(result.filteredSuggestions).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: "filtered:invalid:0",
              filterReason: "MISSING_FIELDS",
            }),
          ]),
        );
        expect(mockAiStructuredService.generateStructured).not.toHaveBeenCalled();
      });
    });

    describe("correcting operation type based on DB state", () => {
      it("should correct CREATE to UPDATE when preference exists", async () => {
        mockPreferenceService.getActivePreferences.mockResolvedValue([
          createMockPreference("food.dietary_restrictions", ["nuts"]),
        ]);
        mockAiStructuredService.generateStructuredWithFile.mockResolvedValue(
          createAiResponse([
            {
              slug: "food.dietary_restrictions",
              operation: "CREATE", // AI says CREATE but should be UPDATE
              newValue: ["peanuts", "shellfish"],
              confidence: 0.9,
              sourceSnippet: "allergic to peanuts and shellfish",
            },
          ]),
        );

        const result = await service.extractPreferences(
          "user-1",
          mockFileBuffer,
          mockMimeType,
          mockFilename,
        );

        expect(result.suggestions).toHaveLength(1);
        expect(result.suggestions[0].operation).toBe(
          PreferenceOperation.UPDATE,
        );
        expect(result.suggestions[0].wasCorrected).toBe(true);
      });

      it("should correct UPDATE to CREATE when preference does not exist", async () => {
        mockPreferenceService.getActivePreferences.mockResolvedValue([]);
        mockAiStructuredService.generateStructuredWithFile.mockResolvedValue(
          createAiResponse([
            {
              slug: "food.dietary_restrictions",
              operation: "UPDATE", // AI says UPDATE but should be CREATE
              oldValue: ["something"],
              newValue: ["peanuts"],
              confidence: 0.9,
              sourceSnippet: "allergic to peanuts",
            },
          ]),
        );

        const result = await service.extractPreferences(
          "user-1",
          mockFileBuffer,
          mockMimeType,
          mockFilename,
        );

        expect(result.suggestions).toHaveLength(1);
        expect(result.suggestions[0].operation).toBe(
          PreferenceOperation.CREATE,
        );
        expect(result.suggestions[0].wasCorrected).toBe(true);
      });
    });

    describe("correcting oldValue based on DB state", () => {
      it("should correct oldValue to match actual DB value", async () => {
        const actualDbValue = ["nuts", "shellfish"];
        mockPreferenceService.getActivePreferences.mockResolvedValue([
          createMockPreference("food.dietary_restrictions", actualDbValue),
        ]);
        mockAiStructuredService.generateStructuredWithFile.mockResolvedValue(
          createAiResponse([
            {
              slug: "food.dietary_restrictions",
              operation: "UPDATE",
              oldValue: ["nuts"], // AI says wrong oldValue
              newValue: ["peanuts", "shellfish", "dairy"],
              confidence: 0.9,
              sourceSnippet: "allergic to many things",
            },
          ]),
        );

        const result = await service.extractPreferences(
          "user-1",
          mockFileBuffer,
          mockMimeType,
          mockFilename,
        );

        expect(result.suggestions).toHaveLength(1);
        expect(result.suggestions[0].oldValue).toEqual(actualDbValue);
        expect(result.suggestions[0].wasCorrected).toBe(true);
      });

      it("should correct operation and oldValue after duplicate consolidation", async () => {
        const actualDbValue = ["nuts"];
        mockPreferenceService.getActivePreferences.mockResolvedValue([
          createMockPreference("food.dietary_restrictions", actualDbValue),
        ]);
        mockAiStructuredService.generateStructuredWithFile.mockResolvedValue(
          createAiResponse([
            {
              slug: "food.dietary_restrictions",
              operation: "UPDATE",
              oldValue: ["nuts"],
              newValue: ["nuts", "shellfish"],
              confidence: 0.85,
              sourceSnippet: "allergic to shellfish",
            },
            {
              slug: "food.dietary_restrictions",
              operation: "UPDATE",
              oldValue: ["nuts"],
              newValue: ["nuts", "peanuts"],
              confidence: 0.8,
              sourceSnippet: "allergic to peanuts",
            },
          ]),
        );
        mockAiStructuredService.generateStructured.mockResolvedValue(
          createConsolidationResponse({
            slug: "food.dietary_restrictions",
            operation: "CREATE",
            oldValue: ["wrong-old"],
            newValue: ["nuts", "shellfish", "peanuts"],
            confidence: 0.93,
            sourceSnippet: "allergic to peanuts",
          }),
        );

        const result = await service.extractPreferences(
          "user-1",
          mockFileBuffer,
          mockMimeType,
          mockFilename,
        );

        expect(result.suggestions).toHaveLength(1);
        expect(result.suggestions[0]).toMatchObject({
          id: "consolidated:food.dietary_restrictions",
          operation: PreferenceOperation.UPDATE,
          oldValue: actualDbValue,
          newValue: ["nuts", "shellfish", "peanuts"],
          confidence: 0.93,
          wasCorrected: true,
        });
      });

      it("should remove oldValue for CREATE operations", async () => {
        mockPreferenceService.getActivePreferences.mockResolvedValue([]);
        mockAiStructuredService.generateStructuredWithFile.mockResolvedValue(
          createAiResponse([
            {
              slug: "food.dietary_restrictions",
              operation: "CREATE",
              oldValue: ["something"], // should not have oldValue for CREATE
              newValue: ["peanuts"],
              confidence: 0.9,
              sourceSnippet: "allergic to peanuts",
            },
          ]),
        );

        const result = await service.extractPreferences(
          "user-1",
          mockFileBuffer,
          mockMimeType,
          mockFilename,
        );

        expect(result.suggestions).toHaveLength(1);
        expect(result.suggestions[0].oldValue).toBeUndefined();
        expect(result.suggestions[0].wasCorrected).toBe(true);
      });
    });

    describe("filtering no-change updates", () => {
      it("should filter out updates where newValue equals existing value", async () => {
        const existingValue = ["peanuts", "shellfish"];
        mockPreferenceService.getActivePreferences.mockResolvedValue([
          createMockPreference("food.dietary_restrictions", existingValue),
        ]);
        mockAiStructuredService.generateStructuredWithFile.mockResolvedValue(
          createAiResponse([
            {
              slug: "food.dietary_restrictions",
              operation: "UPDATE",
              oldValue: existingValue,
              newValue: existingValue, // same as existing - no change
              confidence: 0.9,
              sourceSnippet: "allergic to peanuts and shellfish",
            },
          ]),
        );

        const result = await service.extractPreferences(
          "user-1",
          mockFileBuffer,
          mockMimeType,
          mockFilename,
        );

        expect(result.suggestions).toHaveLength(0);
        expect(result.filteredCount).toBe(1);
      });
    });

    describe("wasCorrected flag", () => {
      it("should set wasCorrected=false when no corrections needed", async () => {
        mockPreferenceService.getActivePreferences.mockResolvedValue([]);
        mockAiStructuredService.generateStructuredWithFile.mockResolvedValue(
          createAiResponse([
            {
              slug: "food.dietary_restrictions",
              operation: "CREATE",
              newValue: ["peanuts"],
              confidence: 0.9,
              sourceSnippet: "allergic to peanuts",
            },
          ]),
        );

        const result = await service.extractPreferences(
          "user-1",
          mockFileBuffer,
          mockMimeType,
          mockFilename,
        );

        expect(result.suggestions).toHaveLength(1);
        expect(result.suggestions[0].id).toBe("candidate:0");
        expect(result.suggestions[0].wasCorrected).toBe(false);
      });

      it("should set wasCorrected=true when operation is corrected", async () => {
        mockPreferenceService.getActivePreferences.mockResolvedValue([
          createMockPreference("food.dietary_restrictions", ["nuts"]),
        ]);
        mockAiStructuredService.generateStructuredWithFile.mockResolvedValue(
          createAiResponse([
            {
              slug: "food.dietary_restrictions",
              operation: "CREATE", // wrong, should be UPDATE
              newValue: ["peanuts"],
              confidence: 0.9,
              sourceSnippet: "allergic to peanuts",
            },
          ]),
        );

        const result = await service.extractPreferences(
          "user-1",
          mockFileBuffer,
          mockMimeType,
          mockFilename,
        );

        expect(result.suggestions[0].wasCorrected).toBe(true);
      });

      it("should set wasCorrected=true when oldValue is corrected", async () => {
        mockPreferenceService.getActivePreferences.mockResolvedValue([
          createMockPreference("food.dietary_restrictions", ["actual-value"]),
        ]);
        mockAiStructuredService.generateStructuredWithFile.mockResolvedValue(
          createAiResponse([
            {
              slug: "food.dietary_restrictions",
              operation: "UPDATE",
              oldValue: ["wrong-value"], // wrong oldValue
              newValue: ["new-value"],
              confidence: 0.9,
              sourceSnippet: "updated allergies",
            },
          ]),
        );

        const result = await service.extractPreferences(
          "user-1",
          mockFileBuffer,
          mockMimeType,
          mockFilename,
        );

        expect(result.suggestions[0].wasCorrected).toBe(true);
        expect(result.suggestions[0].oldValue).toEqual(["actual-value"]);
      });
    });

    describe("filteredCount accuracy", () => {
      it("should return correct filteredCount with multiple filtered items", async () => {
        mockPreferenceService.getActivePreferences.mockResolvedValue([
          createMockPreference("food.cuisine_preferences", "same-value"),
        ]);
        mockAiStructuredService.generateStructuredWithFile.mockResolvedValue(
          createAiResponse([
            // 1. Valid suggestion - should pass
            {
              slug: "food.dietary_restrictions",
              operation: "CREATE",
              newValue: ["peanuts"],
              confidence: 0.9,
              sourceSnippet: "allergic to peanuts",
            },
            // 2. Hard invalid - should be filtered before grouping
            {
              slug: "food.dietary_restrictions",
              operation: "CREATE",
              confidence: 0.8,
              sourceSnippet: "duplicate",
            },
            // 3. No-change update - should be filtered
            {
              slug: "food.cuisine_preferences",
              operation: "UPDATE",
              oldValue: "same-value",
              newValue: "same-value",
              confidence: 0.9,
              sourceSnippet: "no change",
            },
          ]),
        );

        const result = await service.extractPreferences(
          "user-1",
          mockFileBuffer,
          mockMimeType,
          mockFilename,
        );

        expect(result.suggestions).toHaveLength(1);
        expect(result.filteredCount).toBe(2); // 2 filtered: invalid, no-change
      });
    });

    describe("edge cases", () => {
      it("should handle empty suggestions array from AI", async () => {
        mockPreferenceService.getActivePreferences.mockResolvedValue([]);
        mockAiStructuredService.generateStructuredWithFile.mockResolvedValue(
          createAiResponse([]),
        );

        const result = await service.extractPreferences(
          "user-1",
          mockFileBuffer,
          mockMimeType,
          mockFilename,
        );

        expect(result.suggestions).toHaveLength(0);
        expect(result.filteredCount).toBe(0);
      });

      it("should handle array newValue with multiple items", async () => {
        mockPreferenceService.getActivePreferences.mockResolvedValue([]);
        mockAiStructuredService.generateStructuredWithFile.mockResolvedValue(
          createAiResponse([
            {
              slug: "food.cuisine_preferences",
              operation: "CREATE",
              newValue: ["Italian", "Japanese", "Mexican", "Thai"],
              confidence: 0.85,
              sourceSnippet: "cuisine preferences from document",
            },
          ]),
        );

        const result = await service.extractPreferences(
          "user-1",
          mockFileBuffer,
          mockMimeType,
          mockFilename,
        );

        expect(result.suggestions).toHaveLength(1);
        expect(result.suggestions[0].newValue).toEqual([
          "Italian",
          "Japanese",
          "Mexican",
          "Thai",
        ]);
      });

      it("should canonicalize duplicate and whitespace-padded array entries", async () => {
        mockPreferenceService.getActivePreferences.mockResolvedValue([]);
        mockAiStructuredService.generateStructuredWithFile.mockResolvedValue(
          createAiResponse([
            {
              slug: "dev.tech_stack",
              operation: "CREATE",
              newValue: ["AI", " software engineering ", "AI", " "],
              confidence: 0.93,
              sourceSnippet: "works on AI and software engineering",
            },
          ]),
        );

        const result = await service.extractPreferences(
          "user-1",
          mockFileBuffer,
          mockMimeType,
          mockFilename,
        );

        expect(result.suggestions).toHaveLength(1);
        expect(result.suggestions[0].newValue).toEqual([
          "AI",
          "software engineering",
        ]);
      });

      it("should filter updates that only add duplicate array entries after canonicalization", async () => {
        const existingValue = [
          "distributed systems",
          "security",
          "AI",
          "software engineering",
        ];
        mockPreferenceService.getActivePreferences.mockResolvedValue([
          createMockPreference("dev.tech_stack", existingValue),
        ]);
        mockAiStructuredService.generateStructuredWithFile.mockResolvedValue(
          createAiResponse([
            {
              slug: "dev.tech_stack",
              operation: "UPDATE",
              oldValue: existingValue,
              newValue: [
                "distributed systems",
                "security",
                "AI",
                "software engineering",
                "software engineering",
              ],
              confidence: 0.87,
              sourceSnippet: "still focused on software engineering",
            },
          ]),
        );

        const result = await service.extractPreferences(
          "user-1",
          mockFileBuffer,
          mockMimeType,
          mockFilename,
        );

        expect(result.suggestions).toHaveLength(0);
        expect(result.filteredCount).toBe(1);
        expect(result.filteredSuggestions[0]).toMatchObject({
          slug: "dev.tech_stack",
          filterReason: "NO_CHANGE",
          newValue: existingValue,
        });
      });

      it("should treat whitespace-only array differences as no change", async () => {
        const existingValue = ["AI", "software engineering"];
        mockPreferenceService.getActivePreferences.mockResolvedValue([
          createMockPreference("dev.tech_stack", existingValue),
        ]);
        mockAiStructuredService.generateStructuredWithFile.mockResolvedValue(
          createAiResponse([
            {
              slug: "dev.tech_stack",
              operation: "UPDATE",
              oldValue: existingValue,
              newValue: ["AI", " software engineering "],
              confidence: 0.84,
              sourceSnippet: "focuses on software engineering",
            },
          ]),
        );

        const result = await service.extractPreferences(
          "user-1",
          mockFileBuffer,
          mockMimeType,
          mockFilename,
        );

        expect(result.suggestions).toHaveLength(0);
        expect(result.filteredCount).toBe(1);
        expect(result.filteredSuggestions[0]).toMatchObject({
          slug: "dev.tech_stack",
          filterReason: "NO_CHANGE",
          newValue: existingValue,
        });
      });

      it("should use PreferenceSchemaSnapshotService for prompt building", async () => {
        mockPreferenceService.getActivePreferences.mockResolvedValue([]);
        mockAiStructuredService.generateStructuredWithFile.mockResolvedValue(
          createAiResponse([]),
        );

        await service.extractPreferences(
          "user-1",
          mockFileBuffer,
          mockMimeType,
          mockFilename,
        );

        expect(mockSnapshotService.getSnapshot).toHaveBeenCalledWith("user-1");
      });

      it.each([
        "application/yaml",
        "text/yaml",
        "application/x-yaml",
      ])(
        "should normalize YAML MIME %s to text/plain before AI file extraction",
        async (mimeType) => {
          mockPreferenceService.getActivePreferences.mockResolvedValue([]);
          mockAiStructuredService.generateStructuredWithFile.mockResolvedValue(
            createAiResponse([]),
          );

          await service.extractPreferences(
            "user-1",
            mockFileBuffer,
            mimeType,
            "prefs.yaml",
          );

          expect(
            mockAiStructuredService.generateStructuredWithFile,
          ).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({
              buffer: mockFileBuffer,
              mimeType: "text/plain",
            }),
            expect.anything(),
            { operationName: "preferenceExtraction" },
          );
        },
      );
    });
  });
});
