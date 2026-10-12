import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import type { z } from 'zod';
import { PREFERENCE_CATALOG } from '../../../config/preferences.catalog';
import { LOCAL_AI_CAPABILITIES } from '../../../domains/shared/ports/ai-execution';
import type { AiStructuredOutputPort } from '../../../domains/shared/ports/ai-structured-output.port';
import type { StorageUnitOfWork } from '../../../domains/shared/storage/storage-unit-of-work';
import type { PreferenceDefinition } from '../../../domains/shared/storage/storage-types';
import type { PreferenceService } from '../preference/preference.service';
import type { PreferenceDefinitionRepository } from '../preference-definition/preference-definition.repository';
import { PreferenceSchemaSnapshotService } from '../preference-definition/preference-schema-snapshot.service';
import { DocumentAnalysisService } from './document-analysis.service';
import { AnalysisStatus } from './dto/document-analysis-result.dto';
import { FilterReason, PreferenceOperation } from './dto/preference-suggestion.dto';
import { PreferenceExtractionService } from './preference-extraction.service';
import { ReviewedSuggestionService } from './reviewed-suggestion.service';
import fixtures from './__fixtures__/attribution-cases.json';

type Fixture = (typeof fixtures.cases)[number];
type Proposal = Fixture['expectedProposals'][number];
type ScriptedSuggestion = ReturnType<typeof scriptedSuggestion>;
const ownerId = 'synthetic-attribution-owner';

function scriptedSuggestion(proposal: Proposal, documentText: string) {
  return {
    slug: proposal.slug,
    operation: PreferenceOperation.CREATE,
    oldValue: null,
    newValue: proposal.value,
    confidence: 0.95,
    sourceSnippet: proposal.sourceSnippet,
    sourceMeta: {
      page: null,
      line: documentText.split('\n').indexOf(proposal.sourceSnippet) + 1,
    },
  };
}

/** All AI replies and storage below are scripted; no inference or persistence occurs. */
function pipeline(
  fixture: Fixture,
  initial = fixture.expectedProposals.map((value) => scriptedSuggestion(value, fixture.documentText)),
  consolidated?: ScriptedSuggestion,
) {
  const definitions: PreferenceDefinition[] = fixtures.schemaSlugs.map((slug) => {
    const catalog = PREFERENCE_CATALOG[slug];
    return {
      id: `definition:${slug}`,
      slug,
      namespace: 'GLOBAL',
      displayName: catalog.displayName ?? null,
      description: catalog.description,
      valueType: 'STRING',
      scope: 'GLOBAL',
      options: null,
      isSensitive: catalog.isSensitive ?? false,
      isCore: true,
      ownerUserId: null,
      archivedAt: null,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    };
  });
  const definitionRepo = {
    getAll: jest.fn(async () => definitions),
    getDefinitionBySlug: jest.fn(async (slug: string) => definitions.find((value) => value.slug === slug) ?? null),
  };
  const preferences = { getActivePreferences: jest.fn(async () => fixture.activePreferences) };
  const write = jest.fn(async () => { throw new Error('Analysis must not write'); });
  const savedRows = fixture.activePreferences.map((preference) => ({ ...preference,
    id: `saved:${preference.slug}`, userId: ownerId, definitionId: `definition:${preference.slug}`, locationId: null,
    contextKey: 'GLOBAL', status: 'ACTIVE', sourceType: 'USER', confidence: null, evidence: null,
    lastActorType: null, lastActorClientKey: null, lastOrigin: null, createdAt: new Date(0), updatedAt: new Date(0),
  }));
  const tx = {
    definitions: definitionRepo,
    preferences: { findActiveExact: jest.fn(async (key) => savedRows.find((row) => row.userId === key.userId && row.definitionId === key.definitionId && key.locationId === null) ?? null), compareAndSetActive: write, upsertActive: write },
    audit: { record: write },
  };
  const unit = { serializable: jest.fn(async (operation) => operation(tx)) };
  const calls: Array<{ stage: 'extraction' | 'consolidation'; prompt: string; parsed: unknown }> = [];
  const ai = {
    capabilities: LOCAL_AI_CAPABILITIES,
    getStatus: jest.fn(),
    generateStructuredWithFile: jest.fn(async (prompt: string, _file, schema: z.ZodType) => {
      const parsed = schema.parse({ documentSummary: 'Synthetic attribution fixture', suggestions: initial });
      calls.push({ stage: 'extraction', prompt, parsed });
      return parsed;
    }),
    generateStructured: jest.fn(async (prompt: string, schema: z.ZodType) => {
      if (!consolidated) throw new Error('Unexpected consolidation');
      const parsed = schema.parse({ suggestion: consolidated });
      calls.push({ stage: 'consolidation', prompt, parsed });
      return parsed;
    }),
  };
  const config = new ConfigService({ documentUpload: { maxSuggestions: 25 } });
  const snapshots = new PreferenceSchemaSnapshotService(definitionRepo as unknown as PreferenceDefinitionRepository, null);
  const extraction = new PreferenceExtractionService(
    ai as unknown as AiStructuredOutputPort,
    preferences as unknown as PreferenceService,
    definitionRepo as unknown as PreferenceDefinitionRepository,
    snapshots,
    config,
  );
  const reviewed = new ReviewedSuggestionService(unit as unknown as StorageUnitOfWork, config);
  const analysis = new DocumentAnalysisService(extraction, reviewed);
  return { analysis, ai, calls, preferences, definitionRepo, tx, write };
}

describe('synthetic attribution pipeline plumbing (no model inference)', () => {
  beforeEach(() => {
    for (const method of ['log', 'warn', 'error', 'debug'] as const) {
      jest.spyOn(Logger.prototype, method).mockImplementation();
    }
  });
  afterEach(() => jest.restoreAllMocks());

  it('keeps owner identity, unknown identity and positive oracles explicit', () => {
    expect(fixtures.cases).toHaveLength(5);
    expect(new Set(fixtures.cases.map((fixture) => fixture.id)).size).toBe(5);
    for (const fixture of fixtures.cases) {
      expect(fixture.activePreferences.some((value) => value.slug === 'profile.email')).toBe(false);
      for (const proposal of fixture.expectedProposals) {
        expect(fixture.documentText).toContain(proposal.sourceSnippet);
        expect(proposal.sourceSnippet).toContain(proposal.value);
        expect(fixture.forbiddenValues).not.toContain(proposal.value);
      }
    }
    const ambiguous = fixtures.cases.find((fixture) => fixture.id === 'ambiguous-two-person-directory');
    expect(ambiguous.activePreferences).toEqual([]);
    expect(ambiguous.expectedProposals).toEqual([]);
    const selfIdentifying = fixtures.cases.find((fixture) => fixture.id === 'self-identifying-no-saved-profile');
    expect(selfIdentifying.activePreferences).toEqual([]);
    expect(selfIdentifying.expectedProposals.map((value) => value.slug)).toContain('profile.email');
  });

  it.each(fixtures.cases.filter((fixture) => ['known-owner-email', 'ambiguous-two-person-directory'].includes(fixture.id)))(
    'sends the reviewed subject-attribution contract with unchanged $identityBasis context', async (fixture) => {
      const harness = pipeline(fixture);
      await harness.analysis.analyzeDocument(ownerId, Buffer.from(fixture.documentText), 'text/plain', fixtures.filename);
      const prompt = harness.calls[0].prompt;
      // These assertions prove instruction delivery, not model compliance.
      const attributionRules = [
        "Determine whom each person-specific fact describes before assigning it to a preference. For slugs about the user's own identity, contact details, role, or other personal facts, the evidence must concern the user. A fact about another person is eligible only when the slug explicitly describes that relationship or contact.",
        'Use identifying information in current preferences as context for identifying the user. When that context is absent, clear self-identification or a clearly identified subject in a single-person document can establish whom the document describes. Missing saved profile information alone is not a reason to omit those facts.',
        'When multiple people appear and neither current preferences nor the document identifies which person is the user, omit only ambiguous facts about the user. Do not choose a person by order, prominence, or confidence. Continue extracting facts whose subject and relationship to the user are clear.',
        "Keep each proposed value and its quoted evidence associated with the same person. Text that proves another person's value does not prove that value belongs to the user.",
      ];
      for (const rule of attributionRules) expect(prompt).toContain(`- ${rule}`);
      expect(prompt).toContain(JSON.stringify(fixture.activePreferences, null, 2));
      if (!fixture.activePreferences.length) expect(prompt).not.toContain(fixture.accountOwner);
      expect(prompt).toContain('sourceSnippet must quote the text containing the actual value');
      expect(harness.ai.generateStructuredWithFile).toHaveBeenCalledTimes(1);
      expect(harness.write).not.toHaveBeenCalled();
    },
  );

  it.each(fixtures.cases)('carries scripted $id proposals and quoted evidence to review without writes', async (fixture) => {
    const harness = pipeline(fixture);
    const file = Buffer.from(fixture.documentText, 'utf8');
    const result = await harness.analysis.analyzeDocument(ownerId, file, 'text/plain', fixtures.filename);

    expect(harness.preferences.getActivePreferences).toHaveBeenCalledWith(ownerId);
    expect(harness.definitionRepo.getAll).toHaveBeenCalledWith(ownerId);
    for (const preference of fixture.activePreferences) {
      expect(await (harness.tx.preferences.findActiveExact as jest.Mock)({ userId: ownerId, definitionId: `definition:${preference.slug}`, locationId: null })).toMatchObject({
        userId: ownerId, value: preference.value, definitionId: `definition:${preference.slug}`,
      });
    }
    expect(harness.ai.generateStructuredWithFile).toHaveBeenCalledTimes(1);
    expect(harness.ai.generateStructuredWithFile.mock.calls[0][1]).toEqual({ buffer: file, mimeType: 'text/plain' });
    const prompt = harness.calls[0].prompt;
    expect(prompt).toContain(`The document "${fixtures.filename}" is attached above.`);
    expect(prompt).not.toContain(fixture.id);
    expect(prompt).toContain(JSON.stringify(fixture.activePreferences, null, 2));
    for (const slug of fixtures.schemaSlugs) expect(prompt).toContain(PREFERENCE_CATALOG[slug].description);
    // The hidden oracle owner must not become additional model identity context.
    if (fixture.identityBasis !== 'saved-profile') expect(prompt).not.toContain(fixture.accountOwner);
    expect(harness.calls.map((call) => call.stage)).toEqual(['extraction']);
    expect(result.status).toBe(fixture.expectedProposals.length ? AnalysisStatus.SUCCESS : AnalysisStatus.NO_MATCHES);
    expect(result.filteredSuggestions).toEqual([]);
    expect(result.filteredCount).toBe(0);
    expect(result.suggestions).toHaveLength(fixture.expectedProposals.length);
    fixture.expectedProposals.forEach((expected, index) => {
      expect(result.suggestions[index]).toMatchObject({
        id: `${result.analysisId}:candidate:${index}`,
        slug: expected.slug,
        operation: PreferenceOperation.CREATE,
        newValue: expected.value,
        confidence: 0.95,
        sourceSnippet: expected.sourceSnippet,
        sourceMeta: { line: fixture.documentText.split('\n').indexOf(expected.sourceSnippet) + 1 },
        review: { definitionId: `definition:${expected.slug}`, locationId: null, expectedPreferenceId: null, expectedRevision: null },
      });
    });
    expect(harness.write).not.toHaveBeenCalled();
  });

  it('retains initial and consolidation evidence for scripted mixed emails while preserving the useful owner title', async () => {
    const fixture = fixtures.cases.find((value) => value.id === 'mixed-owner-and-colleague-emails');
    const ownerEmail = scriptedSuggestion(fixture.expectedProposals[0], fixture.documentText);
    const title = scriptedSuggestion(fixture.expectedProposals[1], fixture.documentText);
    const otherEmail = scriptedSuggestion({
      slug: 'profile.email',
      value: 'jordan.avery@example.test',
      sourceSnippet: 'Preferred contact email for Jordan Avery: jordan.avery@example.test.',
    }, fixture.documentText);
    const harness = pipeline(fixture, [ownerEmail, otherEmail, title], ownerEmail);
    const result = await harness.analysis.analyzeDocument(ownerId, Buffer.from(fixture.documentText), 'text/plain', fixtures.filename);

    expect(harness.calls.map((call) => call.stage)).toEqual(['extraction', 'consolidation']);
    expect(harness.calls[0].parsed).toMatchObject({ suggestions: [ownerEmail, otherEmail, title] });
    expect(harness.calls[1].parsed).toEqual({ suggestion: ownerEmail });
    expect(harness.calls[1].prompt).toContain(ownerEmail.sourceSnippet);
    expect(harness.calls[1].prompt).toContain(otherEmail.sourceSnippet);
    expect(result.status).toBe(AnalysisStatus.SUCCESS);
    expect(result.suggestions.map((value) => [value.slug, value.newValue, value.sourceSnippet])).toEqual([
      [ownerEmail.slug, ownerEmail.newValue, ownerEmail.sourceSnippet],
      [title.slug, title.newValue, title.sourceSnippet],
    ]);
    expect(result.suggestions[0].id).toBe(`${result.analysisId}:consolidated:profile.email`);
    expect(result.suggestions[0].review).toMatchObject({ definitionId: 'definition:profile.email' });
    expect(result.filteredCount).toBe(2);
    expect(result.filteredSuggestions.map((value) => [value.newValue, value.sourceSnippet, value.filterReason])).toEqual([
      [ownerEmail.newValue, ownerEmail.sourceSnippet, FilterReason.DUPLICATE_KEY],
      [otherEmail.newValue, otherEmail.sourceSnippet, FilterReason.DUPLICATE_KEY],
    ]);
    expect(result.filteredSuggestions.map((value) => value.id)).toEqual([
      `${result.analysisId}:filtered:duplicate:profile.email:0`,
      `${result.analysisId}:filtered:duplicate:profile.email:1`,
    ]);
    expect(harness.write).not.toHaveBeenCalled();
  });
});
