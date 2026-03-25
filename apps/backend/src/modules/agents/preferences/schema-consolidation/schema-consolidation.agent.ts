import { Injectable, Inject } from '@nestjs/common';
import { AgentInput, IAgent } from '../../shared/agent.interface';
import { AgentStepRecorder } from '../../shared/agent-step-recorder';
import { AiStructuredOutputPort } from '../../../../domains/shared/ports/ai-structured-output.port';
import {
  PreferenceSchemaSnapshotService,
  PreferenceDefinitionSnapshot,
} from '../../../preferences/preference-definition/preference-schema-snapshot.service';
import { ConsolidationResponseSchema } from './schema-consolidation.schema';
import { buildSchemaConsolidationPrompt } from './schema-consolidation.prompt';

export interface SchemaConsolidationAgentInput extends AgentInput {
  scope?: 'PERSONAL' | 'ALL';
}

export interface ConsolidationGroup {
  slugs: string[];
  reason: string;
  suggestion: 'MERGE' | 'RENAME' | 'DELETE_ONE' | 'REVIEW';
  recommendedSlug?: string;
  slugScopes: Record<string, 'GLOBAL' | 'USER'>;
}

export interface SchemaConsolidationAgentOutput {
  totalDefinitionsAnalyzed: number;
  consolidationGroups: ConsolidationGroup[];
  summary: string;
}

@Injectable()
export class SchemaConsolidationAgent
  implements
    IAgent<SchemaConsolidationAgentInput, SchemaConsolidationAgentOutput>
{
  constructor(
    @Inject('AiStructuredOutputPort')
    private readonly aiStructuredPort: AiStructuredOutputPort,
    private readonly snapshotService: PreferenceSchemaSnapshotService,
  ) {}

  async run(
    input: SchemaConsolidationAgentInput,
  ): Promise<SchemaConsolidationAgentOutput> {
    const recorder = new AgentStepRecorder('SchemaConsolidationAgent');

    // Step 1: Load definitions
    const snapshot = await recorder.record('loadDefinitions', 'db', () =>
      this.snapshotService.getSnapshot(input.userId, input.scope),
    );

    // Short-circuit: < 2 definitions means nothing to consolidate
    if (snapshot.definitions.length < 2) {
      recorder.logSummary();
      return {
        totalDefinitionsAnalyzed: snapshot.definitions.length,
        consolidationGroups: [],
        summary:
          snapshot.definitions.length === 0
            ? 'No definitions to analyze.'
            : 'Only one definition exists — nothing to consolidate.',
      };
    }

    const knownSlugs = new Set(snapshot.definitions.map((d) => d.slug));
    const defMap = new Map<string, PreferenceDefinitionSnapshot>(
      snapshot.definitions.map((d) => [d.slug, d]),
    );

    // Step 2: AI consolidation analysis
    // Build enriched JSON that includes ownership metadata for the model
    const enrichedJson = JSON.stringify(
      snapshot.definitions.map((d) => ({
        slug: d.slug,
        category: d.category,
        description: d.description,
        valueType: d.valueType,
        ...(d.options ? { options: d.options } : {}),
        ownership: d.namespace === 'GLOBAL' ? 'GLOBAL' : 'USER',
        definitionScope: d.scope,
      })),
      null,
      2,
    );
    const prompt = buildSchemaConsolidationPrompt(enrichedJson);

    const aiResult = await recorder.record(
      'aiConsolidationAnalysis',
      'ai',
      () =>
        this.aiStructuredPort.generateStructured(
          prompt,
          ConsolidationResponseSchema,
          { operationName: 'schemaConsolidation.analysis' },
        ),
    );

    // Step 3: Group validation
    const validatedGroups = await recorder.record(
      'groupValidation',
      'validation',
      async () => {
        const groups: ConsolidationGroup[] = [];

        for (const group of aiResult.consolidationGroups) {
          // Filter and dedupe slugs to only known ones, preserving order
          const seen = new Set<string>();
          const validSlugs = group.slugs.filter((slug) => {
            if (!knownSlugs.has(slug) || seen.has(slug)) return false;
            seen.add(slug);
            return true;
          });

          // Drop groups with < 2 valid unique slugs
          if (validSlugs.length < 2) {
            continue;
          }

          // Clear recommendedSlug unless it is one of the group's valid slugs
          const validSlugSet = seen;
          const recommendedSlug =
            group.recommendedSlug && validSlugSet.has(group.recommendedSlug)
              ? group.recommendedSlug
              : undefined;

          // Populate slugScopes from definitions
          const slugScopes: Record<string, 'GLOBAL' | 'USER'> = {};
          for (const slug of validSlugs) {
            const def = defMap.get(slug);
            slugScopes[slug] =
              def?.namespace === 'GLOBAL' ? 'GLOBAL' : 'USER';
          }

          groups.push({
            slugs: validSlugs,
            reason: group.reason,
            suggestion: group.suggestion,
            recommendedSlug,
            slugScopes,
          });
        }

        return groups;
      },
    );

    recorder.logSummary();

    // Override summary if validation dropped every group the AI proposed
    const summary =
      validatedGroups.length === 0 &&
      aiResult.consolidationGroups.length > 0
        ? 'No overlapping or duplicate definitions found after validation.'
        : aiResult.summary;

    return {
      totalDefinitionsAnalyzed: snapshot.definitions.length,
      consolidationGroups: validatedGroups,
      summary,
    };
  }
}
