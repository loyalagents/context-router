import { Injectable, Inject } from '@nestjs/common';
import { WorkflowInput, IWorkflow } from '../../shared/workflow.interface';
import { WorkflowStepRecorder } from '../../shared/workflow-step-recorder';
import { AiStructuredOutputPort } from '../../../../domains/shared/ports/ai-structured-output.port';
import { PreferenceSchemaSnapshotService } from '../../../preferences/preference-definition/preference-schema-snapshot.service';
import { PreferenceService } from '../../../preferences/preference/preference.service';
import { EnrichedPreference } from '../../../preferences/preference/preference.repository';
import { RelevanceResponseSchema } from './preference-search.schema';
import { buildPreferenceSearchPrompt } from './preference-search.prompt';

export interface PreferenceSearchWorkflowInput extends WorkflowInput {
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
    @Inject('AiStructuredOutputPort')
    private readonly aiStructuredPort: AiStructuredOutputPort,
    private readonly snapshotService: PreferenceSchemaSnapshotService,
    private readonly preferenceService: PreferenceService,
  ) {}

  async run(
    input: PreferenceSearchWorkflowInput,
  ): Promise<PreferenceSearchWorkflowOutput> {
    const recorder = new WorkflowStepRecorder('PreferenceSearchWorkflow');

    // Step 1: Load catalog
    const snapshot = await recorder.record('loadCatalog', 'db', () =>
      this.snapshotService.getSnapshot(input.userId),
    );

    const knownSlugs = new Set(snapshot.definitions.map((d) => d.slug));

    // Step 2: AI slug identification
    const prompt = buildPreferenceSearchPrompt(
      snapshot.promptJson,
      input.naturalLanguageQuery,
    );

    const aiResult = await recorder.record('aiSlugIdentification', 'ai', () =>
      this.aiStructuredPort.generateStructured(
        prompt,
        RelevanceResponseSchema,
        { operationName: 'preferenceSearch.slugIdentification' },
      ),
    );

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
      const allActive = await this.preferenceService.getActivePreferences(
        input.userId,
        input.locationId,
      );
      let matchedActivePreferences = allActive.filter((p) =>
        slugSet.has(p.slug),
      );

      // Fetch suggested preferences if requested
      let matchedSuggestedPreferences: EnrichedPreference[] = [];
      if (input.includeSuggestions) {
        const allSuggested =
          await this.preferenceService.getSuggestedPreferences(
            input.userId,
            input.locationId,
          );
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

    recorder.logSummary();

    return {
      ...result,
      queryInterpretation: aiResult.queryInterpretation,
    };
  }
}
