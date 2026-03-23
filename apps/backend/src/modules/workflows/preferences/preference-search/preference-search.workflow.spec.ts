import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import {
  PreferenceSearchWorkflow,
  PreferenceSearchWorkflowInput,
} from './preference-search.workflow';
import { AiStructuredOutputPort } from '../../../../domains/shared/ports/ai-structured-output.port';
import { PreferenceSchemaSnapshotService } from '../../../preferences/preference-definition/preference-schema-snapshot.service';
import { PreferenceService } from '../../../preferences/preference/preference.service';
import { EnrichedPreference } from '../../../preferences/preference/preference.repository';
import {
  PreferenceStatus,
  SourceType,
} from '@infrastructure/prisma/generated-client';

const createMockPreference = (
  slug: string,
  status: PreferenceStatus = PreferenceStatus.ACTIVE,
): EnrichedPreference => ({
  id: `pref-${slug.replace('.', '-')}-${status}`,
  userId: 'user-1',
  slug,
  category: slug.split('.')[0],
  definitionId: `def-${slug.replace('.', '-')}`,
  contextKey: 'GLOBAL',
  value: `value-for-${slug}`,
  status,
  sourceType: SourceType.USER,
  locationId: null,
  confidence: null,
  evidence: null,
  createdAt: new Date(),
  updatedAt: new Date(),
});

const MOCK_SNAPSHOT = {
  definitions: [
    {
      slug: 'food.dietary_restrictions',
      category: 'food',
      description: 'Dietary restrictions',
      valueType: 'ARRAY',
      namespace: 'GLOBAL',
      scope: 'GLOBAL',
    },
    {
      slug: 'food.cuisine_preferences',
      category: 'food',
      description: 'Preferred cuisines',
      valueType: 'ARRAY',
      namespace: 'GLOBAL',
      scope: 'GLOBAL',
    },
    {
      slug: 'travel.seat_preference',
      category: 'travel',
      description: 'Airplane seat preference',
      valueType: 'ENUM',
      namespace: 'GLOBAL',
      scope: 'GLOBAL',
    },
  ],
  promptJson: '[]',
};

describe('PreferenceSearchWorkflow', () => {
  let workflow: PreferenceSearchWorkflow;
  let mockAiPort: jest.Mocked<AiStructuredOutputPort>;
  let mockSnapshotService: jest.Mocked<PreferenceSchemaSnapshotService>;
  let mockPreferenceService: jest.Mocked<PreferenceService>;

  beforeEach(async () => {
    mockAiPort = {
      generateStructured: jest.fn(),
      generateStructuredWithFile: jest.fn(),
    };

    mockSnapshotService = {
      getSnapshot: jest.fn().mockResolvedValue(MOCK_SNAPSHOT),
    } as any;

    mockPreferenceService = {
      getActivePreferences: jest.fn().mockResolvedValue([]),
      getSuggestedPreferences: jest.fn().mockResolvedValue([]),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PreferenceSearchWorkflow,
        { provide: 'AiStructuredOutputPort', useValue: mockAiPort },
        {
          provide: PreferenceSchemaSnapshotService,
          useValue: mockSnapshotService,
        },
        { provide: PreferenceService, useValue: mockPreferenceService },
      ],
    }).compile();

    workflow = module.get(PreferenceSearchWorkflow);

    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'debug').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const baseInput: PreferenceSearchWorkflowInput = {
    userId: 'user-1',
    naturalLanguageQuery: 'what are my food preferences?',
  };

  it('should return matched definitions and preferences for valid slugs', async () => {
    mockAiPort.generateStructured.mockResolvedValue({
      relevantSlugs: ['food.dietary_restrictions', 'food.cuisine_preferences'],
      queryInterpretation: 'Looking for food-related preferences',
    });
    mockPreferenceService.getActivePreferences.mockResolvedValue([
      createMockPreference('food.dietary_restrictions'),
    ]);

    const result = await workflow.run(baseInput);

    expect(result.matchedDefinitions).toHaveLength(2);
    expect(result.matchedDefinitions.map((d) => d.slug)).toEqual([
      'food.dietary_restrictions',
      'food.cuisine_preferences',
    ]);
    expect(result.matchedActivePreferences).toHaveLength(1);
    expect(result.matchedActivePreferences[0].slug).toBe(
      'food.dietary_restrictions',
    );
    expect(result.matchedSuggestedPreferences).toHaveLength(0);
    expect(result.queryInterpretation).toBe(
      'Looking for food-related preferences',
    );
  });

  it('should include definitions without preference rows', async () => {
    mockAiPort.generateStructured.mockResolvedValue({
      relevantSlugs: ['food.cuisine_preferences'],
      queryInterpretation: 'Cuisine prefs',
    });
    // No active preferences for this slug
    mockPreferenceService.getActivePreferences.mockResolvedValue([]);

    const result = await workflow.run(baseInput);

    expect(result.matchedDefinitions).toHaveLength(1);
    expect(result.matchedDefinitions[0].slug).toBe(
      'food.cuisine_preferences',
    );
    expect(result.matchedActivePreferences).toHaveLength(0);
  });

  it('should silently discard hallucinated slugs', async () => {
    mockAiPort.generateStructured.mockResolvedValue({
      relevantSlugs: [
        'food.dietary_restrictions',
        'food.nonexistent_hallucinated',
        'totally.fake_slug',
      ],
      queryInterpretation: 'Food preferences',
    });
    mockPreferenceService.getActivePreferences.mockResolvedValue([
      createMockPreference('food.dietary_restrictions'),
    ]);

    const result = await workflow.run(baseInput);

    expect(result.matchedDefinitions).toHaveLength(1);
    expect(result.matchedDefinitions[0].slug).toBe(
      'food.dietary_restrictions',
    );
    expect(result.matchedActivePreferences).toHaveLength(1);
  });

  it('should return empty arrays when AI returns no relevant slugs', async () => {
    mockAiPort.generateStructured.mockResolvedValue({
      relevantSlugs: [],
      queryInterpretation: 'No matches found',
    });

    const result = await workflow.run(baseInput);

    expect(result.matchedDefinitions).toHaveLength(0);
    expect(result.matchedActivePreferences).toHaveLength(0);
    expect(result.matchedSuggestedPreferences).toHaveLength(0);
    expect(result.queryInterpretation).toBe('No matches found');
  });

  it('should include suggested preferences when includeSuggestions is true', async () => {
    mockAiPort.generateStructured.mockResolvedValue({
      relevantSlugs: ['food.dietary_restrictions'],
      queryInterpretation: 'Diet info',
    });
    mockPreferenceService.getActivePreferences.mockResolvedValue([
      createMockPreference('food.dietary_restrictions', PreferenceStatus.ACTIVE),
    ]);
    mockPreferenceService.getSuggestedPreferences.mockResolvedValue([
      createMockPreference(
        'food.dietary_restrictions',
        PreferenceStatus.SUGGESTED,
      ),
    ]);

    const result = await workflow.run({
      ...baseInput,
      includeSuggestions: true,
    });

    expect(result.matchedActivePreferences).toHaveLength(1);
    expect(result.matchedSuggestedPreferences).toHaveLength(1);
    expect(result.matchedSuggestedPreferences[0].status).toBe(
      PreferenceStatus.SUGGESTED,
    );
  });

  it('should not fetch suggested preferences when includeSuggestions is false', async () => {
    mockAiPort.generateStructured.mockResolvedValue({
      relevantSlugs: ['food.dietary_restrictions'],
      queryInterpretation: 'Diet info',
    });

    await workflow.run({ ...baseInput, includeSuggestions: false });

    expect(
      mockPreferenceService.getSuggestedPreferences,
    ).not.toHaveBeenCalled();
  });

  it('should apply maxResults to active and suggested preferences', async () => {
    mockAiPort.generateStructured.mockResolvedValue({
      relevantSlugs: [
        'food.dietary_restrictions',
        'food.cuisine_preferences',
        'travel.seat_preference',
      ],
      queryInterpretation: 'Everything',
    });
    mockPreferenceService.getActivePreferences.mockResolvedValue([
      createMockPreference('food.dietary_restrictions'),
      createMockPreference('food.cuisine_preferences'),
      createMockPreference('travel.seat_preference'),
    ]);
    mockPreferenceService.getSuggestedPreferences.mockResolvedValue([
      createMockPreference(
        'food.dietary_restrictions',
        PreferenceStatus.SUGGESTED,
      ),
      createMockPreference(
        'food.cuisine_preferences',
        PreferenceStatus.SUGGESTED,
      ),
    ]);

    const result = await workflow.run({
      ...baseInput,
      includeSuggestions: true,
      maxResults: 2,
    });

    // matchedDefinitions is never capped
    expect(result.matchedDefinitions).toHaveLength(3);
    // Preferences are capped at maxResults
    expect(result.matchedActivePreferences).toHaveLength(2);
    expect(result.matchedSuggestedPreferences).toHaveLength(2);
  });

  it('should sort preference rows by AI relevance before applying maxResults', async () => {
    // AI ranks travel first, then cuisine, then dietary
    mockAiPort.generateStructured.mockResolvedValue({
      relevantSlugs: [
        'travel.seat_preference',
        'food.cuisine_preferences',
        'food.dietary_restrictions',
      ],
      queryInterpretation: 'Travel then food',
    });
    // Repository returns in a different order (recency / alphabetical)
    mockPreferenceService.getActivePreferences.mockResolvedValue([
      createMockPreference('food.dietary_restrictions'),
      createMockPreference('food.cuisine_preferences'),
      createMockPreference('travel.seat_preference'),
    ]);

    const result = await workflow.run({
      ...baseInput,
      maxResults: 2,
    });

    // Should keep the top-2 by AI relevance: travel, then cuisine
    expect(result.matchedActivePreferences.map((p) => p.slug)).toEqual([
      'travel.seat_preference',
      'food.cuisine_preferences',
    ]);
  });

  it('should pass locationId to preference service', async () => {
    mockAiPort.generateStructured.mockResolvedValue({
      relevantSlugs: ['food.dietary_restrictions'],
      queryInterpretation: 'Diet info',
    });

    await workflow.run({ ...baseInput, locationId: 'loc-123' });

    expect(mockPreferenceService.getActivePreferences).toHaveBeenCalledWith(
      'user-1',
      'loc-123',
    );
  });

  it('should preserve AI relevance ordering in matchedDefinitions', async () => {
    // AI returns travel first, then food — opposite of snapshot's alphabetical order
    mockAiPort.generateStructured.mockResolvedValue({
      relevantSlugs: [
        'travel.seat_preference',
        'food.dietary_restrictions',
      ],
      queryInterpretation: 'Travel then food',
    });

    const result = await workflow.run(baseInput);

    expect(result.matchedDefinitions.map((d) => d.slug)).toEqual([
      'travel.seat_preference',
      'food.dietary_restrictions',
    ]);
  });

  it('should dedupe repeated slugs from AI while preserving relevance order', async () => {
    mockAiPort.generateStructured.mockResolvedValue({
      relevantSlugs: [
        'food.dietary_restrictions',
        'food.cuisine_preferences',
        'food.dietary_restrictions', // duplicate
      ],
      queryInterpretation: 'Food prefs',
    });
    mockPreferenceService.getActivePreferences.mockResolvedValue([
      createMockPreference('food.dietary_restrictions'),
      createMockPreference('food.cuisine_preferences'),
    ]);

    const result = await workflow.run(baseInput);

    expect(result.matchedDefinitions.map((d) => d.slug)).toEqual([
      'food.dietary_restrictions',
      'food.cuisine_preferences',
    ]);
    // Active preferences should also not be duplicated
    expect(result.matchedActivePreferences).toHaveLength(2);
  });

  it('should propagate errors from AI port', async () => {
    mockAiPort.generateStructured.mockRejectedValue(
      new Error('AI validation failed'),
    );

    await expect(workflow.run(baseInput)).rejects.toThrow(
      'AI validation failed',
    );
  });
});
