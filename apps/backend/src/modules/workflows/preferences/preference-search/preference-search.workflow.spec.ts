import { HOSTED_AI_CAPABILITIES, LOCAL_AI_CAPABILITIES, AiError } from '../../../../domains/shared/ports/ai-execution';
import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import {
  PreferenceSearchWorkflow,
  PreferenceSearchWorkflowInput,
} from './preference-search.workflow';
import { AiStructuredOutputPort } from '../../../../domains/shared/ports/ai-structured-output.port';
import { AI_STRUCTURED_OUTPUT_PORT } from '../../../../domains/shared/ports/ai.tokens';
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
      capabilities: HOSTED_AI_CAPABILITIES,
      getStatus: jest.fn().mockResolvedValue({ state: 'unsupported', configured: true }),
      generateStructured: jest.fn(),
      generateStructuredWithFile: jest.fn(),
    };

    mockSnapshotService = {
      getGrantFilteredSnapshot: jest.fn().mockResolvedValue(MOCK_SNAPSHOT),
    } as any;

    mockPreferenceService = {
      getActivePreferences: jest.fn().mockResolvedValue([]),
      getSuggestedPreferences: jest.fn().mockResolvedValue([]),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PreferenceSearchWorkflow,
        { provide: AI_STRUCTURED_OUTPUT_PORT, useValue: mockAiPort },
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

  it('propagates one local deadline and rejects late repository cancellation before success', async () => {
    Object.defineProperty(mockAiPort, 'capabilities', { value: LOCAL_AI_CAPABILITIES });
    const controller = new AbortController(); const deadline = performance.now() + 10000;
    mockAiPort.generateStructured.mockResolvedValue({ relevantSlugs: [], queryInterpretation: 'synthetic' });
    mockPreferenceService.getActivePreferences.mockImplementation(async () => { controller.abort(); return []; });
    await expect(workflow.run({ userId: 'user', clientKey: 'test', naturalLanguageQuery: 'synthetic', includeSuggestions: true }, { signal: controller.signal, deadline })).rejects.toMatchObject({ kind: 'cancelled' });
    expect(mockAiPort.generateStructured.mock.calls[0][2]).toMatchObject({ signal: controller.signal, deadline });
    expect(mockPreferenceService.getSuggestedPreferences).not.toHaveBeenCalled();
  });

  it('checks cancellation after catalog loading before inference', async () => {
    Object.defineProperty(mockAiPort, 'capabilities', { value: LOCAL_AI_CAPABILITIES });
    const controller = new AbortController();
    mockSnapshotService.getGrantFilteredSnapshot.mockImplementation(async () => { controller.abort(); return MOCK_SNAPSHOT; });
    await expect(workflow.run({ userId: 'user', clientKey: 'test', naturalLanguageQuery: 'synthetic' }, { signal: controller.signal })).rejects.toMatchObject({ kind: 'cancelled' });
    expect(mockAiPort.generateStructured).not.toHaveBeenCalled();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('uses compact local references with authorized values and preserves ordinary definition meaning', async () => {
    Object.assign(mockAiPort, { localSearchData: true });
    const ordinary = { ...MOCK_SNAPSHOT.definitions[0], displayName: 'Setting', description: 'Whether peanuts must be avoided.' };
    const slug = 'leisure.otherdata.memory_12345678123412341234123456789abc';
    const boilerplate = 'Imported leisure context. Retrieve the stored value for details. Source ID: urn:uuid:12345678-1234-1234-1234-123456789abc.';
    mockSnapshotService.getGrantFilteredSnapshot.mockResolvedValue({ definitions: [ordinary,
      { ...ordinary, slug, category: 'leisure', displayName: 'Leisure memory 2', description: boilerplate }], promptJson: 'old-definition-prompt' });
    const rows = [Object.assign(createMockPreference(ordinary.slug), { value: true, evidence: { secret: 'NEVER_EVIDENCE' } }),
      Object.assign(createMockPreference(slug), { value: 'My favorite hobbies are pottery and cycling.' }),
      Object.assign(createMockPreference('private.hidden'), { value: 'NEVER_DENIED_SLUG' }),
      Object.assign(createMockPreference(ordinary.slug), { definitionId: 'archived-sensitive', value: 'NEVER_ARCHIVED_VALUE' })];
    mockPreferenceService.getActivePreferences.mockResolvedValue(rows);
    mockAiPort.generateStructured.mockImplementation(async prompt => {
      expect(prompt).toContain('pottery and cycling'); expect(prompt).toContain(ordinary.description);
      expect(prompt).not.toContain(boilerplate); expect(prompt).not.toContain('Leisure memory 2');
      expect(prompt).not.toMatch(/NEVER_|archived-sensitive|12345678|old-definition-prompt/);
      return { relevantReferences: [1, 1, 500, 0], queryInterpretation: 'Hobbies and settings' } as any;
    });
    const filterReadableValues = jest.fn(async (values: EnrichedPreference[]) => values.filter(p => p.definitionId !== 'archived-sensitive'));
    const result = await workflow.run({ userId: 'user-1', clientKey: 'local', naturalLanguageQuery: 'hobbies', locationId: 'owned-location',
      filterReadableValues } as any);
    expect(filterReadableValues).toHaveBeenCalledWith(rows.filter(p => p.slug !== 'private.hidden'));
    expect(mockPreferenceService.getActivePreferences).toHaveBeenCalledWith('user-1', 'owned-location');
    expect(mockPreferenceService.getActivePreferences).toHaveBeenCalledTimes(1);
    expect(result.matchedDefinitions.map(d => d.slug)).toEqual([slug, ordinary.slug]);
    expect(result.matchedActivePreferences.map(p => p.value)).toEqual(['My favorite hobbies are pottery and cycling.', true]);
    expect(mockAiPort.generateStructured).toHaveBeenCalledTimes(1);
  });

  it('keeps near-match importer descriptions and fails closed without value permission', async () => {
    Object.assign(mockAiPort, { localSearchData: true });
    const description = 'Imported leisure context. Retrieve the stored value for details. Source ID: urn:uuid:12345678-1234-1234-1234-123456789abc. Only on weekends.';
    mockSnapshotService.getGrantFilteredSnapshot.mockResolvedValue({ definitions: [{ ...MOCK_SNAPSHOT.definitions[0],
      slug: 'leisure.demo001.memory_12345678123412341234123456789abc', category: 'leisure', description }], promptJson: 'old' });
    mockPreferenceService.getActivePreferences.mockResolvedValue([Object.assign(createMockPreference('leisure.demo001.memory_12345678123412341234123456789abc'), { value: 'NEVER_WITHOUT_PERMISSION' })]);
    mockAiPort.generateStructured.mockImplementation(async prompt => {
      expect(prompt).toContain(description); expect(prompt).not.toContain('NEVER_WITHOUT_PERMISSION');
      return { relevantReferences: [], queryInterpretation: 'None' } as any;
    });
    await workflow.run({ userId: 'user-1', clientKey: 'local', naturalLanguageQuery: 'hobbies' });
  });

  it('does not enrich a hosted or undeclared adapter even when a value filter exists', async () => {
    const filterReadableValues = jest.fn(async rows => rows);
    mockAiPort.generateStructured.mockResolvedValue({ relevantSlugs: [], queryInterpretation: 'None' });
    mockPreferenceService.getActivePreferences.mockResolvedValue([Object.assign(createMockPreference('food.dietary_restrictions'), { value: 'NEVER_HOSTED_VALUE' })]);
    await workflow.run({ userId: 'user-1', clientKey: 'hosted', naturalLanguageQuery: 'hobbies', filterReadableValues } as any);
    expect(mockAiPort.generateStructured.mock.calls[0][0]).not.toContain('NEVER_HOSTED_VALUE');
    expect(filterReadableValues).not.toHaveBeenCalled();
  });

  it('keeps one local budget through value permission and cancels before inference', async () => {
    Object.assign(mockAiPort, { localSearchData: true, capabilities: LOCAL_AI_CAPABILITIES });
    const controller = new AbortController();
    await expect(workflow.run({ userId: 'user-1', clientKey: 'local', naturalLanguageQuery: 'settings',
      filterReadableValues: async rows => { controller.abort(); return rows; } },
    { signal: controller.signal, deadline: performance.now() + 10000 })).rejects.toMatchObject({ kind: 'cancelled' });
    expect(mockAiPort.generateStructured).not.toHaveBeenCalled();
    expect(mockPreferenceService.getSuggestedPreferences).not.toHaveBeenCalled();
  });

  it('includes requested authorized suggestions, retains options, and caps rows after reference order', async () => {
    Object.assign(mockAiPort, { localSearchData: true, capabilities: LOCAL_AI_CAPABILITIES });
    const deadline = performance.now() + 10000;
    const defs = MOCK_SNAPSHOT.definitions.map(d => ({ ...d, options: ['quiet', 'social'] }));
    mockSnapshotService.getGrantFilteredSnapshot.mockResolvedValue({ definitions: defs, promptJson: 'old' });
    const row = createMockPreference(defs[2].slug, PreferenceStatus.SUGGESTED); row.value = 'Prefer social outings';
    mockPreferenceService.getSuggestedPreferences.mockResolvedValue([row]);
    mockAiPort.generateStructured.mockImplementation(async (prompt, _schema, controls) => {
      expect(prompt).toContain('Prefer social outings'); expect(prompt).toContain('["quiet","social"]');
      expect(controls.deadline).toBe(deadline);
      return { relevantReferences: [2, 0], queryInterpretation: 'Outings' } as any;
    });
    const result = await workflow.run({ userId: 'user-1', clientKey: 'local', naturalLanguageQuery: 'outings', includeSuggestions: true,
      maxResults: 0, filterReadableValues: async rows => rows }, { deadline });
    expect(result.matchedDefinitions.map(d => d.slug)).toEqual([defs[2].slug, defs[0].slug]);
    expect(result.matchedSuggestedPreferences).toEqual([]);
    expect(mockPreferenceService.getSuggestedPreferences).toHaveBeenCalledTimes(1);
  });

  const baseInput: PreferenceSearchWorkflowInput = {
    userId: 'user-1',
    clientKey: 'claude',
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

  it('should return profile preferences for natural-language identity queries', async () => {
    mockSnapshotService.getGrantFilteredSnapshot.mockResolvedValueOnce({
      definitions: [
        {
          slug: 'profile.full_name',
          category: 'profile',
          description: "The user's preferred full name",
          valueType: 'STRING',
          namespace: 'GLOBAL',
          scope: 'GLOBAL',
        },
        {
          slug: 'profile.email',
          category: 'profile',
          description: "The user's contact email",
          valueType: 'STRING',
          namespace: 'GLOBAL',
          scope: 'GLOBAL',
        },
      ],
      promptJson: JSON.stringify([
        {
          slug: 'profile.full_name',
          description: "The user's preferred full name",
        },
        {
          slug: 'profile.email',
          description: "The user's contact email",
        },
      ]),
    });
    mockAiPort.generateStructured.mockResolvedValue({
      relevantSlugs: ['profile.full_name', 'profile.email'],
      queryInterpretation: 'Identity and contact profile fields',
    });
    mockPreferenceService.getActivePreferences.mockResolvedValue([
      {
        ...createMockPreference('profile.full_name'),
        value: 'Ada Lovelace',
      },
      {
        ...createMockPreference('profile.email'),
        value: 'ada@example.test',
      },
    ]);

    const result = await workflow.run({
      ...baseInput,
      naturalLanguageQuery: "what is the user's name and form email?",
    });

    const prompt = mockAiPort.generateStructured.mock.calls[0][0] as string;
    expect(prompt).toContain('profile.full_name');
    expect(prompt).toContain('profile.email');
    expect(result.matchedDefinitions.map((definition) => definition.slug)).toEqual([
      'profile.full_name',
      'profile.email',
    ]);
    expect(result.matchedActivePreferences.map((preference) => preference.slug)).toEqual([
      'profile.full_name',
      'profile.email',
    ]);
    expect(result.queryInterpretation).toBe(
      'Identity and contact profile fields',
    );
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

  it('should pass a tool-provided access filter through to the snapshot service', async () => {
    const filterAccessibleSlugs = jest.fn().mockResolvedValue([
      'food.dietary_restrictions',
    ]);
    mockAiPort.generateStructured.mockResolvedValue({
      relevantSlugs: [],
      queryInterpretation: 'No matches found',
    });

    await workflow.run({
      ...baseInput,
      filterAccessibleSlugs,
    } as PreferenceSearchWorkflowInput);

    expect(mockSnapshotService.getGrantFilteredSnapshot).toHaveBeenCalledWith(
      'user-1',
      'claude',
      'read',
      undefined,
      filterAccessibleSlugs,
    );
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
