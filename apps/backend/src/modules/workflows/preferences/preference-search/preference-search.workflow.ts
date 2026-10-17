import { AiExecutionOptions, createAiWorkflow } from '../../../../domains/shared/ports/ai-execution';
import { Injectable, Inject } from '@nestjs/common';
import { WorkflowInput, IWorkflow } from '../../shared/workflow.interface';
import { WorkflowStepRecorder } from '../../shared/workflow-step-recorder';
import { AiStructuredOutputPort } from '../../../../domains/shared/ports/ai-structured-output.port';
import { AI_STRUCTURED_OUTPUT_PORT } from '../../../../domains/shared/ports/ai.tokens';
import { PreferenceSchemaSnapshotService } from '../../../preferences/preference-definition/preference-schema-snapshot.service';
import { PreferenceSlugAccessFilter } from '../../../preferences/preference-definition/preference-schema-snapshot.service';
import { PreferenceService } from '../../../preferences/preference/preference.service';
import { EnrichedPreference } from '../../../preferences/preference/preference.repository';
import { LocalRelevanceResponseSchema, RelevanceResponseSchema } from './preference-search.schema';
import { buildLocalPreferenceSearchPrompt, buildPreferenceSearchPrompt } from './preference-search.prompt';

export interface PreferenceSearchWorkflowInput extends WorkflowInput {
  clientKey: string;
  filterAccessibleSlugs?: PreferenceSlugAccessFilter;
  /** Values need definition-aware authorization in addition to visible slug metadata. */
  filterReadableValues?: (values: EnrichedPreference[]) => Promise<EnrichedPreference[]>;
  naturalLanguageQuery: string;
  locationId?: string;
  includeSuggestions?: boolean;
  maxResults?: number;
}

export interface PreferenceSearchWorkflowOutput {
  matchedDefinitions: Array<{
    slug: string;
    description: string;
    category: string;
  }>;
  matchedActivePreferences: EnrichedPreference[];
  matchedSuggestedPreferences: EnrichedPreference[];
  queryInterpretation: string;
}

@Injectable()
export class PreferenceSearchWorkflow
  implements IWorkflow<PreferenceSearchWorkflowInput, PreferenceSearchWorkflowOutput>
{
  constructor(
    @Inject(AI_STRUCTURED_OUTPUT_PORT)
    private readonly aiStructuredPort: AiStructuredOutputPort,
    private readonly snapshotService: PreferenceSchemaSnapshotService,
    private readonly preferenceService: PreferenceService,
  ) {}

  async run(
    input: PreferenceSearchWorkflowInput,
    options?: AiExecutionOptions,
  ): Promise<PreferenceSearchWorkflowOutput> {
    const execution = createAiWorkflow(this.aiStructuredPort.capabilities, options);
    const recorder = new WorkflowStepRecorder('PreferenceSearchWorkflow');

    // Step 1: Load catalog
    const snapshot = await recorder.record('loadCatalog', 'db', () =>
      this.snapshotService.getGrantFilteredSnapshot(
        input.userId,
        input.clientKey,
        'read',
        undefined,
        input.filterAccessibleSlugs,
      ),
    );
    execution.check();

    const knownSlugs = new Set(snapshot.definitions.map((d) => d.slug));
    const referenceSlugs = snapshot.definitions.map((d) => d.slug);
    let allActive: EnrichedPreference[] | undefined;
    let allSuggested: EnrichedPreference[] | undefined;

    // Step 2: AI slug identification
    const aiResult = await recorder.record('aiSlugIdentification', 'ai', async () => {
      const aiOptions = { ...execution.options, operationName: 'preferenceSearch.slugIdentification' };
      if (this.aiStructuredPort.localSearchData !== true) return this.aiStructuredPort.generateStructured(
        buildPreferenceSearchPrompt(snapshot.promptJson, input.naturalLanguageQuery), RelevanceResponseSchema, aiOptions);

      const readable = async (rows: EnrichedPreference[]) => {
        const allowed = rows.filter(row => knownSlugs.has(row.slug));
        const filtered = input.filterReadableValues ? await input.filterReadableValues(allowed) : [];
        execution.check();
        return filtered.filter(row => knownSlugs.has(row.slug));
      };
      allActive = await this.preferenceService.getActivePreferences(input.userId, input.locationId);
      execution.check();
      const activeContext = await readable(allActive);
      if (input.filterReadableValues) allActive = activeContext;
      let suggestedContext: EnrichedPreference[] = [];
      if (input.includeSuggestions) {
        allSuggested = await this.preferenceService.getSuggestedPreferences(input.userId, input.locationId);
        execution.check();
        suggestedContext = await readable(allSuggested);
        if (input.filterReadableValues) allSuggested = suggestedContext;
      }
      const result = await this.aiStructuredPort.generateStructured(buildLocalPreferenceSearchPrompt(
        snapshot.definitions, activeContext, suggestedContext, input.naturalLanguageQuery), LocalRelevanceResponseSchema, aiOptions);
      return { relevantSlugs: result.relevantReferences.filter(reference => Number.isSafeInteger(reference) && reference >= 0 && reference < referenceSlugs.length)
        .map(reference => referenceSlugs[reference]), queryInterpretation: result.queryInterpretation };
    });

    execution.check();

    // Step 3: Slug validation — discard hallucinated slugs, dedupe preserving order
    const validatedSlugs = await recorder.record(
      'slugValidation',
      'validation',
      async () => {
        const seen = new Set<string>();
        return aiResult.relevantSlugs.filter((slug) => {
          if (!knownSlugs.has(slug) || seen.has(slug)) return false;
          seen.add(slug);
          return true;
        });
      },
    );

    execution.check();

    // Step 4: Fetch preferences for validated slugs
    const result = await recorder.record('fetchPreferences', 'db', async () => {
      const slugSet = new Set(validatedSlugs);

      // Build matchedDefinitions preserving AI relevance order
      const defMap = new Map(
        snapshot.definitions.map((d) => [d.slug, d]),
      );
      const matchedDefinitions = validatedSlugs
        .map((slug) => defMap.get(slug))
        .filter((d): d is NonNullable<typeof d> => d != null)
        .map((d) => ({
          slug: d.slug,
          description: d.description,
          category: d.category,
        }));

      // Fetch active preferences and filter to matched slugs
      allActive ??= await this.preferenceService.getActivePreferences(
        input.userId,
        input.locationId,
      );
      execution.check();
      let matchedActivePreferences = allActive.filter((p) =>
        slugSet.has(p.slug),
      );

      // Fetch suggested preferences if requested
      let matchedSuggestedPreferences: EnrichedPreference[] = [];
      if (input.includeSuggestions) {
        allSuggested ??= await this.preferenceService.getSuggestedPreferences(
            input.userId,
            input.locationId,
          );
        execution.check();
        matchedSuggestedPreferences = allSuggested.filter((p) =>
          slugSet.has(p.slug),
        );
      }

      // Sort preference rows by AI relevance order before capping
      const slugRank = new Map(validatedSlugs.map((s, i) => [s, i]));
      const byRelevance = (a: EnrichedPreference, b: EnrichedPreference) =>
        (slugRank.get(a.slug) ?? Infinity) - (slugRank.get(b.slug) ?? Infinity);
      matchedActivePreferences.sort(byRelevance);
      matchedSuggestedPreferences.sort(byRelevance);

      // Apply maxResults if specified (definitions are never capped)
      if (input.maxResults !== undefined) {
        matchedActivePreferences = matchedActivePreferences.slice(
          0,
          input.maxResults,
        );
        matchedSuggestedPreferences = matchedSuggestedPreferences.slice(
          0,
          input.maxResults,
        );
      }

      return {
        matchedDefinitions,
        matchedActivePreferences,
        matchedSuggestedPreferences,
      };
    });

    execution.check();
    recorder.logSummary();

    return {
      ...result,
      queryInterpretation: aiResult.queryInterpretation,
    };
  }
}
