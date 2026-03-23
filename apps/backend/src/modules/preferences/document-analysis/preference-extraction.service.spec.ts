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

const healthDefinition = {
  id: "def-identification-name",
  namespace: "health",
  slug: "identification.name",
  displayName: null,
  description: "Patient name",
  valueType: PreferenceValueType.STRING,
  scope: PreferenceScope.GLOBAL,
  options: null,
  isSensitive: false,
  isCore: true,
  archivedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ownerUserId: null,
  category: "identification",
};

const personalDefinition = {
  id: "def-workshop-team-name",
  namespace: "USER:user-1",
  slug: "workshop.team_name",
  displayName: "Team Name",
  description: "Workshop team name",
  valueType: PreferenceValueType.STRING,
  scope: PreferenceScope.GLOBAL,
  options: null,
  isSensitive: false,
  isCore: false,
  archivedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ownerUserId: "user-1",
  category: "workshop",
};

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
      getDefinitionBySlug: jest.fn().mockResolvedValue(null),
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
          "GLOBAL",
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
          "GLOBAL",
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

    describe("filtering duplicate slug", () => {
      it("should filter duplicate slug and keep first", async () => {
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

        const result = await service.extractPreferences(
          "user-1",
          "GLOBAL",
          mockFileBuffer,
          mockMimeType,
          mockFilename,
        );

        expect(result.suggestions).toHaveLength(1);
        expect(result.suggestions[0].newValue).toEqual(["peanuts"]);
        expect(result.filteredCount).toBe(1);
        expect(result.filteredSuggestions[0].filterReason).toBe(
          "DUPLICATE_KEY",
        );
      });
    });

    describe("correcting operation type", () => {
      it("should correct CREATE to UPDATE when preference exists", async () => {
        mockPreferenceService.getActivePreferences.mockResolvedValue([
          createMockPreference("food.dietary_restrictions", ["nuts"]),
        ]);
        mockAiStructuredService.generateStructuredWithFile.mockResolvedValue(
          createAiResponse([
            {
              slug: "food.dietary_restrictions",
              operation: "CREATE", // wrong, should be UPDATE
              oldValue: ["nuts"],
              newValue: ["peanuts"],
              confidence: 0.9,
              sourceSnippet: "allergic to peanuts",
            },
          ]),
        );

        const result = await service.extractPreferences(
          "user-1",
          "GLOBAL",
          mockFileBuffer,
          mockMimeType,
          mockFilename,
        );

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
              operation: "UPDATE", // wrong, should be CREATE
              oldValue: ["old"],
              newValue: ["peanuts"],
              confidence: 0.9,
              sourceSnippet: "allergic to peanuts",
            },
          ]),
        );

        const result = await service.extractPreferences(
          "user-1",
          "GLOBAL",
          mockFileBuffer,
          mockMimeType,
          mockFilename,
        );

        expect(result.suggestions[0].operation).toBe(
          PreferenceOperation.CREATE,
        );
        expect(result.suggestions[0].wasCorrected).toBe(true);
        expect(result.suggestions[0].oldValue).toBeUndefined(); // cleared for CREATE
      });
    });

    describe("correcting oldValue", () => {
      it("should correct oldValue when it doesn't match DB", async () => {
        mockPreferenceService.getActivePreferences.mockResolvedValue([
          createMockPreference("food.dietary_restrictions", ["actual-value"]),
        ]);
        mockAiStructuredService.generateStructuredWithFile.mockResolvedValue(
          createAiResponse([
            {
              slug: "food.dietary_restrictions",
              operation: "UPDATE",
              oldValue: ["wrong-value"], // doesn't match DB
              newValue: ["new-value"],
              confidence: 0.9,
              sourceSnippet: "updated allergies",
            },
          ]),
        );

        const result = await service.extractPreferences(
          "user-1",
          "GLOBAL",
          mockFileBuffer,
          mockMimeType,
          mockFilename,
        );

        expect(result.suggestions[0].oldValue).toEqual(["actual-value"]);
        expect(result.suggestions[0].wasCorrected).toBe(true);
      });
    });

    describe("filtering no-change updates", () => {
      it("should filter UPDATE when newValue equals existing value", async () => {
        mockPreferenceService.getActivePreferences.mockResolvedValue([
          createMockPreference("food.dietary_restrictions", ["peanuts"]),
        ]);
        mockAiStructuredService.generateStructuredWithFile.mockResolvedValue(
          createAiResponse([
            {
              slug: "food.dietary_restrictions",
              operation: "UPDATE",
              oldValue: ["peanuts"],
              newValue: ["peanuts"], // same as existing
              confidence: 0.9,
              sourceSnippet: "allergic to peanuts",
            },
          ]),
        );

        const result = await service.extractPreferences(
          "user-1",
          "GLOBAL",
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
          "GLOBAL",
          mockFileBuffer,
          mockMimeType,
          mockFilename,
        );

        expect(result.suggestions).toHaveLength(1);
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
          "GLOBAL",
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
          "GLOBAL",
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
            // 2. Duplicate slug - should be filtered
            {
              slug: "food.dietary_restrictions",
              operation: "CREATE",
              newValue: ["duplicate"],
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
          "GLOBAL",
          mockFileBuffer,
          mockMimeType,
          mockFilename,
        );

        expect(result.suggestions).toHaveLength(1);
        expect(result.filteredCount).toBe(2); // 2 filtered: duplicate, no-change
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
          "GLOBAL",
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
          "GLOBAL",
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

      it("uses schemaNamespace-visible system and personal definitions during extraction", async () => {
        mockPreferenceService.getActivePreferences.mockResolvedValue([]);
        mockDefRepo.getAll.mockImplementation((userId?: string, schemaNamespace = "GLOBAL") =>
          Promise.resolve(
            (schemaNamespace === "health"
              ? [healthDefinition, personalDefinition]
              : Array.from(mockDefinitions.values())) as any,
          ),
        );
        mockDefRepo.isKnownSlug.mockImplementation(
          (slug: string, userId?: string, schemaNamespace = "GLOBAL") =>
            Promise.resolve(
              schemaNamespace === "health"
                ? slug === healthDefinition.slug || slug === personalDefinition.slug
                : mockDefinitions.has(slug),
            ),
        );
        mockSnapshotService.getSnapshot.mockResolvedValue({
          definitions: [healthDefinition, personalDefinition].map((d) => ({
            slug: d.slug,
            category: d.category,
            description: d.description,
            valueType: d.valueType,
            options: d.options as string[] | undefined,
            namespace: d.namespace,
            scope: d.scope,
          })),
          promptJson: JSON.stringify([
            { slug: healthDefinition.slug, description: healthDefinition.description },
            { slug: personalDefinition.slug, description: personalDefinition.description },
          ]),
        });
        mockAiStructuredService.generateStructuredWithFile.mockResolvedValue(
          createAiResponse([
            {
              slug: "identification.name",
              operation: "CREATE",
              newValue: "Alex Morgan",
              confidence: 0.94,
              sourceSnippet: "Patient: Alex Morgan",
            },
            {
              slug: "workshop.team_name",
              operation: "CREATE",
              newValue: "Care Tigers",
              confidence: 0.88,
              sourceSnippet: "Team: Care Tigers",
            },
          ], "Health intake form"),
        );

        const result = await service.extractPreferences(
          "user-1",
          "health",
          mockFileBuffer,
          mockMimeType,
          mockFilename,
        );

        expect(mockSnapshotService.getSnapshot).toHaveBeenCalledWith("user-1", "health");
        expect(mockDefRepo.isKnownSlug).toHaveBeenCalledWith(
          "identification.name",
          "user-1",
          "health",
        );
        expect(mockDefRepo.isKnownSlug).toHaveBeenCalledWith(
          "workshop.team_name",
          "user-1",
          "health",
        );

        expect(result.suggestions).toHaveLength(2);
        expect(result.suggestions.map((suggestion) => suggestion.slug)).toEqual([
          "identification.name",
          "workshop.team_name",
        ]);
      });

      it("should use PreferenceSchemaSnapshotService for prompt building", async () => {
        mockPreferenceService.getActivePreferences.mockResolvedValue([]);
        mockAiStructuredService.generateStructuredWithFile.mockResolvedValue(
          createAiResponse([]),
        );

        await service.extractPreferences(
          "user-1",
          "GLOBAL",
          mockFileBuffer,
          mockMimeType,
          mockFilename,
        );

        expect(mockSnapshotService.getSnapshot).toHaveBeenCalledWith("user-1", "GLOBAL");
      });
    });
  });
});
