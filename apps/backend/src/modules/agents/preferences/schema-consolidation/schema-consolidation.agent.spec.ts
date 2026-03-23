import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import {
  SchemaConsolidationAgent,
  SchemaConsolidationAgentInput,
} from './schema-consolidation.agent';
import { AiStructuredOutputPort } from '../../../../domains/shared/ports/ai-structured-output.port';
import { PreferenceSchemaSnapshotService } from '../../../preferences/preference-definition/preference-schema-snapshot.service';

const makeSnapshot = (
  defs: Array<{
    slug: string;
    namespace?: string;
    description?: string;
  }>,
) => ({
  definitions: defs.map((d) => ({
    slug: d.slug,
    category: d.slug.split('.')[0],
    description: d.description ?? `Description for ${d.slug}`,
    valueType: 'STRING',
    namespace: d.namespace ?? 'GLOBAL',
  })),
  promptJson: '[]',
});

describe('SchemaConsolidationAgent', () => {
  let agent: SchemaConsolidationAgent;
  let mockAiPort: jest.Mocked<AiStructuredOutputPort>;
  let mockSnapshotService: jest.Mocked<PreferenceSchemaSnapshotService>;

  beforeEach(async () => {
    mockAiPort = {
      generateStructured: jest.fn(),
      generateStructuredWithFile: jest.fn(),
    };

    mockSnapshotService = {
      getSnapshot: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SchemaConsolidationAgent,
        { provide: 'AiStructuredOutputPort', useValue: mockAiPort },
        {
          provide: PreferenceSchemaSnapshotService,
          useValue: mockSnapshotService,
        },
      ],
    }).compile();

    agent = module.get(SchemaConsolidationAgent);

    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'debug').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const baseInput: SchemaConsolidationAgentInput = {
    userId: 'user-1',
  };

  describe('short-circuit with < 2 definitions', () => {
    it('should return empty groups when 0 definitions exist', async () => {
      mockSnapshotService.getSnapshot.mockResolvedValue(makeSnapshot([]));

      const result = await agent.run(baseInput);

      expect(result.totalDefinitionsAnalyzed).toBe(0);
      expect(result.consolidationGroups).toHaveLength(0);
      expect(result.summary).toContain('No definitions');
      expect(mockAiPort.generateStructured).not.toHaveBeenCalled();
    });

    it('should return empty groups when 1 definition exists', async () => {
      mockSnapshotService.getSnapshot.mockResolvedValue(
        makeSnapshot([{ slug: 'food.dietary_restrictions' }]),
      );

      const result = await agent.run(baseInput);

      expect(result.totalDefinitionsAnalyzed).toBe(1);
      expect(result.consolidationGroups).toHaveLength(0);
      expect(result.summary).toContain('nothing to consolidate');
      expect(mockAiPort.generateStructured).not.toHaveBeenCalled();
    });
  });

  describe('happy path', () => {
    it('should return consolidation groups with validated slugs', async () => {
      mockSnapshotService.getSnapshot.mockResolvedValue(
        makeSnapshot([
          { slug: 'food.dietary_restrictions', namespace: 'USER:user-1' },
          { slug: 'food.diet_requirements', namespace: 'USER:user-1' },
          { slug: 'travel.seat_preference' },
        ]),
      );

      mockAiPort.generateStructured.mockResolvedValue({
        consolidationGroups: [
          {
            slugs: ['food.dietary_restrictions', 'food.diet_requirements'],
            reason: 'Both refer to dietary needs',
            suggestion: 'MERGE',
            recommendedSlug: 'food.dietary_restrictions',
          },
        ],
        summary: 'Found 1 group of overlapping definitions',
      });

      const result = await agent.run(baseInput);

      expect(result.totalDefinitionsAnalyzed).toBe(3);
      expect(result.consolidationGroups).toHaveLength(1);

      const group = result.consolidationGroups[0];
      expect(group.slugs).toEqual([
        'food.dietary_restrictions',
        'food.diet_requirements',
      ]);
      expect(group.suggestion).toBe('MERGE');
      expect(group.recommendedSlug).toBe('food.dietary_restrictions');
      expect(group.slugScopes).toEqual({
        'food.dietary_restrictions': 'USER',
        'food.diet_requirements': 'USER',
      });
    });
  });

  describe('slug validation', () => {
    it('should silently drop hallucinated slugs from groups', async () => {
      mockSnapshotService.getSnapshot.mockResolvedValue(
        makeSnapshot([
          { slug: 'food.dietary_restrictions' },
          { slug: 'food.cuisine_preferences' },
        ]),
      );

      mockAiPort.generateStructured.mockResolvedValue({
        consolidationGroups: [
          {
            slugs: [
              'food.dietary_restrictions',
              'food.nonexistent',
              'food.cuisine_preferences',
            ],
            reason: 'Overlap',
            suggestion: 'REVIEW',
          },
        ],
        summary: 'Found overlaps',
      });

      const result = await agent.run(baseInput);

      expect(result.consolidationGroups).toHaveLength(1);
      expect(result.consolidationGroups[0].slugs).toEqual([
        'food.dietary_restrictions',
        'food.cuisine_preferences',
      ]);
    });

    it('should drop groups with < 2 valid slugs after filtering', async () => {
      mockSnapshotService.getSnapshot.mockResolvedValue(
        makeSnapshot([
          { slug: 'food.dietary_restrictions' },
          { slug: 'food.cuisine_preferences' },
        ]),
      );

      mockAiPort.generateStructured.mockResolvedValue({
        consolidationGroups: [
          {
            slugs: ['food.dietary_restrictions', 'food.hallucinated_slug'],
            reason: 'Fake overlap',
            suggestion: 'MERGE',
          },
        ],
        summary: 'Found overlaps',
      });

      const result = await agent.run(baseInput);

      expect(result.consolidationGroups).toHaveLength(0);
    });

    it('should clear invalid recommendedSlug', async () => {
      mockSnapshotService.getSnapshot.mockResolvedValue(
        makeSnapshot([
          { slug: 'food.dietary_restrictions' },
          { slug: 'food.cuisine_preferences' },
        ]),
      );

      mockAiPort.generateStructured.mockResolvedValue({
        consolidationGroups: [
          {
            slugs: ['food.dietary_restrictions', 'food.cuisine_preferences'],
            reason: 'Overlap',
            suggestion: 'MERGE',
            recommendedSlug: 'food.nonexistent_recommendation',
          },
        ],
        summary: 'Found overlaps',
      });

      const result = await agent.run(baseInput);

      expect(result.consolidationGroups[0].recommendedSlug).toBeUndefined();
    });
  });

  describe('scope handling', () => {
    it('should pass scope to snapshot service', async () => {
      mockSnapshotService.getSnapshot.mockResolvedValue(makeSnapshot([]));

      await agent.run({ ...baseInput, scope: 'PERSONAL' });

      expect(mockSnapshotService.getSnapshot).toHaveBeenCalledWith(
        'user-1',
        'PERSONAL',
      );
    });

    it('should correctly identify GLOBAL vs USER scopes', async () => {
      mockSnapshotService.getSnapshot.mockResolvedValue(
        makeSnapshot([
          { slug: 'food.dietary_restrictions', namespace: 'GLOBAL' },
          { slug: 'food.my_diet', namespace: 'USER:user-1' },
        ]),
      );

      mockAiPort.generateStructured.mockResolvedValue({
        consolidationGroups: [
          {
            slugs: ['food.dietary_restrictions', 'food.my_diet'],
            reason: 'Both about diet',
            suggestion: 'REVIEW',
          },
        ],
        summary: 'Mixed scope overlap',
      });

      const result = await agent.run({ ...baseInput, scope: 'ALL' });

      expect(result.consolidationGroups[0].slugScopes).toEqual({
        'food.dietary_restrictions': 'GLOBAL',
        'food.my_diet': 'USER',
      });
    });
  });

  it('should propagate errors from AI port', async () => {
    mockSnapshotService.getSnapshot.mockResolvedValue(
      makeSnapshot([
        { slug: 'food.dietary_restrictions' },
        { slug: 'food.cuisine_preferences' },
      ]),
    );

    mockAiPort.generateStructured.mockRejectedValue(
      new Error('AI validation failed'),
    );

    await expect(agent.run(baseInput)).rejects.toThrow(
      'AI validation failed',
    );
  });
});
