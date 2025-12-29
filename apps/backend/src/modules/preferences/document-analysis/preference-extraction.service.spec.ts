import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { PreferenceExtractionService } from './preference-extraction.service';
import { PreferenceService } from '../preference/preference.service';
import { AiTextGeneratorPort } from '../../../domains/shared/ports/ai-text-generator.port';
import { PreferenceOperation } from './dto/preference-suggestion.dto';
import { Preference } from '../preference/models/preference.model';

// Helper to create mock Preference objects
const createMockPreference = (
  category: string,
  key: string,
  value: any,
): Preference => ({
  preferenceId: `pref-${category}-${key}`,
  userId: 'user-1',
  category,
  key,
  value,
  createdAt: new Date(),
  updatedAt: new Date(),
});

describe('PreferenceExtractionService', () => {
  let service: PreferenceExtractionService;
  let mockAiService: jest.Mocked<AiTextGeneratorPort>;
  let mockPreferenceService: jest.Mocked<PreferenceService>;

  beforeEach(async () => {
    mockAiService = {
      generateText: jest.fn(),
      generateTextWithFile: jest.fn(),
    };

    mockPreferenceService = {
      findAll: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PreferenceExtractionService,
        {
          provide: 'AiTextGeneratorPort',
          useValue: mockAiService,
        },
        {
          provide: PreferenceService,
          useValue: mockPreferenceService,
        },
      ],
    }).compile();

    service = module.get<PreferenceExtractionService>(
      PreferenceExtractionService,
    );

    // Suppress logger output during tests
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    jest.spyOn(Logger.prototype, 'debug').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('validateAndSanitizeSuggestions (via extractPreferences)', () => {
    const mockFileBuffer = Buffer.from('test document content');
    const mockMimeType = 'text/plain';
    const mockFilename = 'test.txt';

    // Helper to create AI response JSON
    const createAiResponse = (suggestions: any[], documentSummary = 'Test document') => {
      return JSON.stringify({ suggestions, documentSummary });
    };

    describe('rejecting malformed AI responses', () => {
      it('should throw error when suggestion is missing category', async () => {
        mockPreferenceService.findAll.mockResolvedValue([]);
        mockAiService.generateTextWithFile.mockResolvedValue(
          createAiResponse([
            {
              key: 'allergies',
              // category is missing
              operation: 'CREATE',
              newValue: ['peanuts'],
              confidence: 0.9,
              sourceSnippet: 'allergic to peanuts',
            },
          ]),
        );

        await expect(
          service.extractPreferences(
            'user-1',
            mockFileBuffer,
            mockMimeType,
            mockFilename,
          ),
        ).rejects.toThrow('Failed to parse AI response: validation failed at suggestions.0.category');
      });

      it('should throw error when suggestion is missing key', async () => {
        mockPreferenceService.findAll.mockResolvedValue([]);
        mockAiService.generateTextWithFile.mockResolvedValue(
          createAiResponse([
            {
              category: 'dietary',
              // key is missing
              operation: 'CREATE',
              newValue: ['peanuts'],
              confidence: 0.9,
              sourceSnippet: 'allergic to peanuts',
            },
          ]),
        );

        await expect(
          service.extractPreferences(
            'user-1',
            mockFileBuffer,
            mockMimeType,
            mockFilename,
          ),
        ).rejects.toThrow('Failed to parse AI response: validation failed at suggestions.0.key');
      });

      it('should filter out suggestions missing newValue', async () => {
        mockPreferenceService.findAll.mockResolvedValue([]);
        mockAiService.generateTextWithFile.mockResolvedValue(
          createAiResponse([
            {
              category: 'dietary',
              key: 'allergies',
              operation: 'CREATE',
              // newValue is missing
              confidence: 0.9,
              sourceSnippet: 'allergic to peanuts',
            },
          ]),
        );

        const result = await service.extractPreferences(
          'user-1',
          mockFileBuffer,
          mockMimeType,
          mockFilename,
        );

        // newValue is optional in Zod schema, so it passes validation
        // but gets filtered out due to missing required fields
        expect(result.suggestions).toHaveLength(0);
        expect(result.filteredCount).toBe(1);
        expect(result.filteredSuggestions[0].filterReason).toBe('MISSING_FIELDS');
      });
    });

    describe('filtering duplicate category/key', () => {
      it('should filter duplicate category/key and keep first', async () => {
        mockPreferenceService.findAll.mockResolvedValue([]);
        mockAiService.generateTextWithFile.mockResolvedValue(
          createAiResponse([
            {
              category: 'dietary',
              key: 'allergies',
              operation: 'CREATE',
              newValue: ['peanuts'],
              confidence: 0.9,
              sourceSnippet: 'allergic to peanuts',
            },
            {
              category: 'dietary',
              key: 'allergies',
              operation: 'CREATE',
              newValue: ['shellfish'], // duplicate key, different value
              confidence: 0.8,
              sourceSnippet: 'allergic to shellfish',
            },
          ]),
        );

        const result = await service.extractPreferences(
          'user-1',
          mockFileBuffer,
          mockMimeType,
          mockFilename,
        );

        expect(result.suggestions).toHaveLength(1);
        expect(result.suggestions[0].newValue).toEqual(['peanuts']); // first one kept
        expect(result.filteredCount).toBe(1);
      });
    });

    describe('correcting operation type based on DB state', () => {
      it('should correct CREATE to UPDATE when preference exists', async () => {
        mockPreferenceService.findAll.mockResolvedValue([
          createMockPreference('dietary', 'allergies', ['nuts']),
        ]);
        mockAiService.generateTextWithFile.mockResolvedValue(
          createAiResponse([
            {
              category: 'dietary',
              key: 'allergies',
              operation: 'CREATE', // AI says CREATE but should be UPDATE
              newValue: ['peanuts', 'shellfish'],
              confidence: 0.9,
              sourceSnippet: 'allergic to peanuts and shellfish',
            },
          ]),
        );

        const result = await service.extractPreferences(
          'user-1',
          mockFileBuffer,
          mockMimeType,
          mockFilename,
        );

        expect(result.suggestions).toHaveLength(1);
        expect(result.suggestions[0].operation).toBe(PreferenceOperation.UPDATE);
        expect(result.suggestions[0].wasCorrected).toBe(true);
      });

      it('should correct UPDATE to CREATE when preference does not exist', async () => {
        mockPreferenceService.findAll.mockResolvedValue([]);
        mockAiService.generateTextWithFile.mockResolvedValue(
          createAiResponse([
            {
              category: 'dietary',
              key: 'allergies',
              operation: 'UPDATE', // AI says UPDATE but should be CREATE
              oldValue: ['something'],
              newValue: ['peanuts'],
              confidence: 0.9,
              sourceSnippet: 'allergic to peanuts',
            },
          ]),
        );

        const result = await service.extractPreferences(
          'user-1',
          mockFileBuffer,
          mockMimeType,
          mockFilename,
        );

        expect(result.suggestions).toHaveLength(1);
        expect(result.suggestions[0].operation).toBe(PreferenceOperation.CREATE);
        expect(result.suggestions[0].wasCorrected).toBe(true);
      });
    });

    describe('correcting oldValue based on DB state', () => {
      it('should correct oldValue to match actual DB value', async () => {
        const actualDbValue = ['nuts', 'shellfish'];
        mockPreferenceService.findAll.mockResolvedValue([
          createMockPreference('dietary', 'allergies', actualDbValue),
        ]);
        mockAiService.generateTextWithFile.mockResolvedValue(
          createAiResponse([
            {
              category: 'dietary',
              key: 'allergies',
              operation: 'UPDATE',
              oldValue: ['nuts'], // AI says wrong oldValue
              newValue: ['peanuts', 'shellfish', 'dairy'],
              confidence: 0.9,
              sourceSnippet: 'allergic to many things',
            },
          ]),
        );

        const result = await service.extractPreferences(
          'user-1',
          mockFileBuffer,
          mockMimeType,
          mockFilename,
        );

        expect(result.suggestions).toHaveLength(1);
        expect(result.suggestions[0].oldValue).toEqual(actualDbValue);
        expect(result.suggestions[0].wasCorrected).toBe(true);
      });

      it('should remove oldValue for CREATE operations', async () => {
        mockPreferenceService.findAll.mockResolvedValue([]);
        mockAiService.generateTextWithFile.mockResolvedValue(
          createAiResponse([
            {
              category: 'dietary',
              key: 'allergies',
              operation: 'CREATE',
              oldValue: ['something'], // should not have oldValue for CREATE
              newValue: ['peanuts'],
              confidence: 0.9,
              sourceSnippet: 'allergic to peanuts',
            },
          ]),
        );

        const result = await service.extractPreferences(
          'user-1',
          mockFileBuffer,
          mockMimeType,
          mockFilename,
        );

        expect(result.suggestions).toHaveLength(1);
        expect(result.suggestions[0].oldValue).toBeUndefined();
        expect(result.suggestions[0].wasCorrected).toBe(true);
      });
    });

    describe('filtering no-change updates', () => {
      it('should filter out updates where newValue equals existing value', async () => {
        const existingValue = ['peanuts', 'shellfish'];
        mockPreferenceService.findAll.mockResolvedValue([
          createMockPreference('dietary', 'allergies', existingValue),
        ]);
        mockAiService.generateTextWithFile.mockResolvedValue(
          createAiResponse([
            {
              category: 'dietary',
              key: 'allergies',
              operation: 'UPDATE',
              oldValue: existingValue,
              newValue: existingValue, // same as existing - no change
              confidence: 0.9,
              sourceSnippet: 'allergic to peanuts and shellfish',
            },
          ]),
        );

        const result = await service.extractPreferences(
          'user-1',
          mockFileBuffer,
          mockMimeType,
          mockFilename,
        );

        expect(result.suggestions).toHaveLength(0);
        expect(result.filteredCount).toBe(1);
      });
    });

    describe('wasCorrected flag', () => {
      it('should set wasCorrected=false when no corrections needed', async () => {
        mockPreferenceService.findAll.mockResolvedValue([]);
        mockAiService.generateTextWithFile.mockResolvedValue(
          createAiResponse([
            {
              category: 'dietary',
              key: 'allergies',
              operation: 'CREATE',
              newValue: ['peanuts'],
              confidence: 0.9,
              sourceSnippet: 'allergic to peanuts',
            },
          ]),
        );

        const result = await service.extractPreferences(
          'user-1',
          mockFileBuffer,
          mockMimeType,
          mockFilename,
        );

        expect(result.suggestions).toHaveLength(1);
        expect(result.suggestions[0].wasCorrected).toBe(false);
      });

      it('should set wasCorrected=true when operation is corrected', async () => {
        mockPreferenceService.findAll.mockResolvedValue([
          createMockPreference('dietary', 'allergies', ['nuts']),
        ]);
        mockAiService.generateTextWithFile.mockResolvedValue(
          createAiResponse([
            {
              category: 'dietary',
              key: 'allergies',
              operation: 'CREATE', // wrong, should be UPDATE
              newValue: ['peanuts'],
              confidence: 0.9,
              sourceSnippet: 'allergic to peanuts',
            },
          ]),
        );

        const result = await service.extractPreferences(
          'user-1',
          mockFileBuffer,
          mockMimeType,
          mockFilename,
        );

        expect(result.suggestions[0].wasCorrected).toBe(true);
      });

      it('should set wasCorrected=true when oldValue is corrected', async () => {
        mockPreferenceService.findAll.mockResolvedValue([
          createMockPreference('dietary', 'allergies', ['actual-value']),
        ]);
        mockAiService.generateTextWithFile.mockResolvedValue(
          createAiResponse([
            {
              category: 'dietary',
              key: 'allergies',
              operation: 'UPDATE',
              oldValue: ['wrong-value'], // wrong oldValue
              newValue: ['new-value'],
              confidence: 0.9,
              sourceSnippet: 'updated allergies',
            },
          ]),
        );

        const result = await service.extractPreferences(
          'user-1',
          mockFileBuffer,
          mockMimeType,
          mockFilename,
        );

        expect(result.suggestions[0].wasCorrected).toBe(true);
        expect(result.suggestions[0].oldValue).toEqual(['actual-value']);
      });
    });

    describe('filteredCount accuracy', () => {
      it('should return correct filteredCount with multiple filtered items', async () => {
        mockPreferenceService.findAll.mockResolvedValue([
          createMockPreference('dietary', 'existing', 'same-value'),
        ]);
        mockAiService.generateTextWithFile.mockResolvedValue(
          createAiResponse([
            // 1. Valid suggestion - should pass
            {
              category: 'dietary',
              key: 'allergies',
              operation: 'CREATE',
              newValue: ['peanuts'],
              confidence: 0.9,
              sourceSnippet: 'allergic to peanuts',
            },
            // 2. Duplicate key - should be filtered
            {
              category: 'dietary',
              key: 'allergies',
              operation: 'CREATE',
              newValue: ['duplicate'],
              confidence: 0.8,
              sourceSnippet: 'duplicate',
            },
            // 3. No-change update - should be filtered
            {
              category: 'dietary',
              key: 'existing',
              operation: 'UPDATE',
              oldValue: 'same-value',
              newValue: 'same-value',
              confidence: 0.9,
              sourceSnippet: 'no change',
            },
          ]),
        );

        const result = await service.extractPreferences(
          'user-1',
          mockFileBuffer,
          mockMimeType,
          mockFilename,
        );

        expect(result.suggestions).toHaveLength(1);
        expect(result.filteredCount).toBe(2); // 2 filtered: duplicate, no-change
      });
    });

    describe('edge cases', () => {
      it('should handle empty suggestions array from AI', async () => {
        mockPreferenceService.findAll.mockResolvedValue([]);
        mockAiService.generateTextWithFile.mockResolvedValue(
          createAiResponse([]),
        );

        const result = await service.extractPreferences(
          'user-1',
          mockFileBuffer,
          mockMimeType,
          mockFilename,
        );

        expect(result.suggestions).toHaveLength(0);
        expect(result.filteredCount).toBe(0);
      });

      it('should handle AI response with markdown code blocks', async () => {
        mockPreferenceService.findAll.mockResolvedValue([]);
        mockAiService.generateTextWithFile.mockResolvedValue(
          '```json\n' +
            JSON.stringify({
              suggestions: [
                {
                  category: 'dietary',
                  key: 'allergies',
                  operation: 'CREATE',
                  newValue: ['peanuts'],
                  confidence: 0.9,
                  sourceSnippet: 'allergic to peanuts',
                },
              ],
              documentSummary: 'Test',
            }) +
            '\n```',
        );

        const result = await service.extractPreferences(
          'user-1',
          mockFileBuffer,
          mockMimeType,
          mockFilename,
        );

        expect(result.suggestions).toHaveLength(1);
      });

      it('should handle complex nested newValue objects', async () => {
        mockPreferenceService.findAll.mockResolvedValue([]);
        mockAiService.generateTextWithFile.mockResolvedValue(
          createAiResponse([
            {
              category: 'travel',
              key: 'hotel_amenities',
              operation: 'CREATE',
              newValue: {
                required: ['wifi', 'gym'],
                preferred: ['pool', 'spa'],
                notes: 'Near downtown',
              },
              confidence: 0.85,
              sourceSnippet: 'hotel preferences from document',
            },
          ]),
        );

        const result = await service.extractPreferences(
          'user-1',
          mockFileBuffer,
          mockMimeType,
          mockFilename,
        );

        expect(result.suggestions).toHaveLength(1);
        expect(result.suggestions[0].newValue).toEqual({
          required: ['wifi', 'gym'],
          preferred: ['pool', 'spa'],
          notes: 'Near downtown',
        });
      });
    });
  });
});
