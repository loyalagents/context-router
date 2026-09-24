import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { repoRoot } from './cases.mjs';
const backend = resolve(repoRoot, 'apps/backend');
const req = createRequire(resolve(backend, 'package.json'));
req('reflect-metadata');
req('tsconfig-paths').register({ baseUrl: resolve(backend, 'dist'), paths: {
  '@/*': ['*'], '@config/*': ['config/*'], '@common/*': ['common/*'], '@infrastructure/*': ['infrastructure/*'], '@graphql/*': ['graphql/*'], '@modules/*': ['modules/*'],
} });
const load = (relative) => req(resolve(backend, 'dist', relative));
const { z } = req('zod');
req('@nestjs/common').Logger.overrideLogger(false);
const { PreferenceSchemaSnapshotService } = load('modules/preferences/preference-definition/preference-schema-snapshot.service.js');
const { PreferenceExtractionService } = load('modules/preferences/document-analysis/preference-extraction.service.js');
const { PreferenceSearchWorkflow } = load('modules/workflows/preferences/preference-search/preference-search.workflow.js');
const { SchemaConsolidationWorkflow } = load('modules/workflows/preferences/schema-consolidation/schema-consolidation.workflow.js');
const { FormFillPromptBuilderService } = load('modules/preferences/form-fill/form-fill-prompt-builder.service.js');
const { FormFillValidatorService } = load('modules/preferences/form-fill/form-fill-validator.service.js');
const { resolveFormFacts } = load('modules/preferences/form-fill/form-fact-resolution.js');
const { FormFillAiResponseSchema, FormFillFieldPoliciesSchema, FillActionSchema } = load('modules/preferences/form-fill/form-fill.types.js');
export function grammarSchema(schema) {
  return z.toJSONSchema(schema, { target: 'draft-7', io: 'input', unrepresentable: 'throw', reused: 'inline', cycles: 'throw',
    override({ zodSchema, jsonSchema }) {
      if (zodSchema === FillActionSchema.shape.value) {
        for (const key of Object.keys(jsonSchema)) delete jsonSchema[key];
        Object.assign(jsonSchema, { anyOf: [{ type: 'string' }, { type: 'null' }] });
      }
    } });
}
export async function runConsumer(entry, ai) {
  const definitions = entry.definitions;
  const allowed = new Set(entry.allowedSlugs ?? definitions.map((d) => d.slug));
  const filterAccessibleSlugs = async (slugs) => slugs.filter((slug) => allowed.has(slug));
  const definitionRepo = { getAll: async () => definitions, getByScope: async () => definitions.filter((d) => d.namespace === 'USER'), getDefinitionBySlug: async (slug) => definitions.find((d) => d.slug === slug) ?? null };
  const grants = { filterSlugsByAccess: async (_user, _client, _action, slugs) => filterAccessibleSlugs(slugs) };
  const preferences = { getActivePreferences: async () => entry.activePreferences ?? [], getSuggestedPreferences: async () => [] };
  const snapshots = new PreferenceSchemaSnapshotService(definitionRepo, grants);
  const config = { getOrThrow(key) { if (key === 'documentUpload.maxSuggestions') return 25; throw new Error('Unexpected fixture configuration'); } };
  const userId = 'synthetic-quality-user';
  if (entry.family === 'extraction') return new PreferenceExtractionService(ai, preferences, definitionRepo, snapshots, config).extractPreferences(userId, Buffer.from(entry.documentText), entry.mimeType ?? 'text/plain', `${entry.id}.txt`);
  if (entry.family === 'search') return new PreferenceSearchWorkflow(ai, snapshots, preferences).run({ userId, clientKey: 'synthetic-quality-client', naturalLanguageQuery: entry.query, filterAccessibleSlugs, includeSuggestions: false, maxResults: 25 });
  if (entry.family === 'consolidation') return new SchemaConsolidationWorkflow(ai, snapshots).run({ userId, clientKey: 'synthetic-quality-client', scope: 'ALL', filterAccessibleSlugs });
  const activePreferences = entry.activePreferences ?? [];
  const fieldPolicies = entry.fieldPolicies ? FormFillFieldPoliciesSchema.parse(entry.fieldPolicies) : undefined;
  const resolution = resolveFormFacts({ activePreferences, fieldPolicies });
  const prompt = new FormFillPromptBuilderService().buildPrompt(entry.fields, activePreferences, fieldPolicies, resolution.facts);
  const proposed = await ai.generateStructured(prompt, FormFillAiResponseSchema, { operationName: 'formFill.fillActions' });
  return new FormFillValidatorService().validate(proposed.fillActions, entry.fields, new Set(activePreferences.map((p) => p.slug)), 0.7,
    { fieldPolicies, activePreferenceValues: new Map(activePreferences.map((p) => [p.slug, p.value])), resolvedFacts: resolution.facts, resolutionConflicts: resolution.conflicts });
}

export function semanticUnits(entry, result, stage) {
  if (entry.family === 'extraction') return result.suggestions.map((s) => ({ slug: s.slug, value: s.newValue }));
  if (entry.family === 'search') return stage === 'proposal' ? result.relevantSlugs : result.matchedDefinitions.map((d) => d.slug);
  if (entry.family === 'consolidation') return result.consolidationGroups.map((group) => {
    const slugs = [...group.slugs].sort(); const expected = entry.definitions.map((d) => d.slug).sort();
    if (entry.oracleAlternatives && JSON.stringify(slugs) === JSON.stringify(expected) &&
      entry.oracleAlternatives.suggestions.includes(group.suggestion) &&
      (group.recommendedSlug === undefined || expected.includes(group.recommendedSlug))) return { equivalence: entry.id };
    return { slugs, suggestion: group.suggestion, recommendedSlug: group.recommendedSlug ?? null };
  });
  return (stage === 'proposal' ? result.fillActions.filter((a) => a.action !== 'SKIP') : result.validActions)
    .map((a) => ({ fieldName: a.fieldName, action: a.action, value: a.value ?? null, sourceSlugs: [...a.sourceSlugs].sort() }));
}

export function criticalViolations(entry, validatedUnits) {
  if (!entry.criticalUnexpected) return 0;
  const expected = new Set(entry.expectedUnits.map((unit) => JSON.stringify(unit)));
  return validatedUnits.filter((unit) => !expected.has(JSON.stringify(unit))).length;
}

// Golden responses validate the fixture plumbing only, never model quality.
export function fixtureReply(entry) {
  if (entry.family === 'extraction') return { documentSummary: 'Synthetic fixture', suggestions: entry.expectedUnits.map((unit) => {
    const previous = entry.activePreferences?.find((p) => p.slug === unit.slug);
    return { slug: unit.slug, newValue: unit.value, operation: previous ? 'UPDATE' : 'CREATE', oldValue: previous?.value ?? null, confidence: 0.99, sourceSnippet: JSON.stringify(unit.value) };
  }) };
  if (entry.family === 'search') return { relevantSlugs: entry.expectedUnits, queryInterpretation: 'Synthetic fixture' };
  if (entry.family === 'consolidation') return { consolidationGroups: entry.expectedUnits.length ? [{ slugs: entry.definitions.map((d) => d.slug), suggestion: 'MERGE', recommendedSlug: entry.definitions[0].slug, reason: 'Identical aliases' }] : [], summary: 'Synthetic fixture' };
  return { fillActions: entry.expectedUnits.map((unit) => ({ ...unit, confidence: 0.99 })) };
}
