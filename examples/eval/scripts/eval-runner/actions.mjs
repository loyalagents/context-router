import { getFactValue } from '../shared.mjs';
import {
  CONDITIONAL_INACTIVE_SKIP_KIND,
  fieldIsActive,
  renderFactValue as renderFactValueFromFieldMap,
  renderFieldValue as renderFieldValueFromFieldMap,
} from '../field-map.mjs';
import { optionValuesForField, seedSlugByFactKey } from './fixtures.mjs';

const SLUG_PATTERN = /^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+$/;

export const EXPECTED_ELENA_I9_EVAL_FACT_KEYS = [
  'identity.middleInitial',
  'identity.otherLastNames',
  'identity.dateOfBirth',
  'identity.ssn',
  'address.current.street',
  'address.current.unit',
  'address.current.city',
  'address.current.state',
  'address.current.postalCode',
  'workAuthorization.citizenshipStatus',
];

export const renderFactValue = renderFactValueFromFieldMap;
export const renderFieldValue = renderFieldValueFromFieldMap;

export function buildRunPlan(fixture) {
  const seedSlugs = seedSlugByFactKey(fixture.profile);
  const factPlans = new Map();
  const actions = [];

  for (const { fieldMap, generated } of fixture.joinedFields) {
    const actionPlan = buildActionPlan({
      fieldMap,
      generated,
      fixture,
      seedSlugs,
      factPlans,
    });
    actions.push(actionPlan);
  }

  const evalDefinitions = [...factPlans.values()]
    .filter((plan) => plan.kind === 'eval')
    .map(({ kind: _kind, ...definition }) => definition)
    .sort((left, right) =>
      left.factKey < right.factKey ? -1 : left.factKey > right.factKey ? 1 : 0,
    );

  const seedPreferences = fixture.seedPreferences
    .map((entry) => ({ slug: entry.slug, value: entry.value }))
    .sort((left, right) =>
      left.slug < right.slug ? -1 : left.slug > right.slug ? 1 : 0,
    );

  return {
    scenario: fixture.scenario,
    formPdfPath: fixture.formPdfPath,
    seedPreferences,
    evalDefinitions,
    fillActions: actions.map((action) => action.fillAction),
    actionPlans: actions,
  };
}

export function assertElenaTemplateSmokeEvalFacts(evalDefinitions) {
  const actual = evalDefinitions.map((definition) => definition.factKey).sort();
  const expected = [...EXPECTED_ELENA_I9_EVAL_FACT_KEYS].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Unexpected Elena I-9 eval-only facts.\nexpected=${expected.join(', ')}\nactual=${actual.join(', ')}`,
    );
  }
}

export function evalSlugForFactKey(factKey) {
  const segments = factKey.split('.').map((segment) =>
    segment
      .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
      .toLowerCase(),
  );
  const slug = `eval.${segments.join('.')}`;
  if (!SLUG_PATTERN.test(slug)) {
    throw new Error(`Derived eval slug ${slug} is not a valid backend slug.`);
  }
  return slug;
}

export function valueTypeFor(value) {
  if (Array.isArray(value)) return 'ARRAY';
  if (typeof value === 'boolean') return 'BOOLEAN';
  return 'STRING';
}

function buildActionPlan({ fieldMap, generated, fixture, seedSlugs, factPlans }) {
  if (fieldMap.mode === 'skip') {
    return skippedAction({
      fieldMap,
      generated,
      reason: `field-map:${fieldMap.reason}`,
      expectedValue: null,
      factKey: null,
      sourceSlug: null,
    });
  }

  if (!fieldIsActive(fieldMap, fixture.profile.facts ?? {})) {
    return skippedAction({
      fieldMap,
      generated,
      reason: 'field-map:conditional_inactive',
      expectedValue: null,
      factKey: fieldMap.factKey,
      sourceSlug: null,
      expectedSkipKind: CONDITIONAL_INACTIVE_SKIP_KIND,
    });
  }

  const value = getFactValue(fixture.profile.facts ?? {}, fieldMap.factKey);
  if (value == null) {
    return skippedAction({
      fieldMap,
      generated,
      reason: `profile fact ${fieldMap.factKey} is null`,
      expectedValue: null,
      factKey: fieldMap.factKey,
      sourceSlug: null,
    });
  }

  const renderedValue = renderFieldValue(value, fieldMap);
  const sourceSlug =
    seedSlugs.get(fieldMap.factKey) ?? ensureEvalFactPlan(factPlans, fieldMap.factKey, value);

  switch (generated.type) {
    case 'text':
      return filledAction({
        fieldMap,
        generated,
        action: 'SET_TEXT',
        value: renderedValue,
        sourceSlug,
      });
    case 'dropdown':
    case 'radio':
    case 'option_list': {
      const options = optionValuesForField(generated, fixture.fieldsGenerated);
      if (!options.includes(renderedValue)) {
        return skippedAction({
          fieldMap,
          generated,
          reason: `rendered value ${JSON.stringify(renderedValue)} is not an available option`,
          expectedValue: renderedValue,
          factKey: fieldMap.factKey,
          sourceSlug,
        });
      }
      return filledAction({
        fieldMap,
        generated,
        action: 'SELECT_OPTION',
        value: renderedValue,
        sourceSlug,
      });
    }
    case 'checkbox':
      if (fieldMap.when) {
        return filledAction({
          fieldMap,
          generated,
          action: 'CHECK',
          value: undefined,
          sourceSlug,
        });
      }
      if (typeof value !== 'boolean') {
        return skippedAction({
          fieldMap,
          generated,
          reason: `profile fact ${fieldMap.factKey} is not boolean`,
          expectedValue: renderedValue,
          factKey: fieldMap.factKey,
          sourceSlug,
        });
      }
      return filledAction({
        fieldMap,
        generated,
        action: value ? 'CHECK' : 'UNCHECK',
        value: undefined,
        sourceSlug,
      });
    default:
      return skippedAction({
        fieldMap,
        generated,
        reason: `field type ${generated.type} is not supported by the deterministic runner`,
        expectedValue: renderedValue,
        factKey: fieldMap.factKey,
        sourceSlug,
        expectedClassification: 'unsupported',
      });
  }
}

function ensureEvalFactPlan(factPlans, factKey, value) {
  const existing = factPlans.get(factKey);
  if (existing) return existing.slug;

  const slug = evalSlugForFactKey(factKey);
  factPlans.set(factKey, {
    kind: 'eval',
    factKey,
    slug,
    value,
    valueType: valueTypeFor(value),
  });
  return slug;
}

function filledAction({ fieldMap, generated, action, value, sourceSlug }) {
  const fillAction = {
    fieldName: fieldMap.pdfFieldName,
    action,
    sourceSlugs: [sourceSlug],
    confidence: 0.99,
  };
  if (value !== undefined) fillAction.value = value;

  return {
    fieldIndex: fieldMap.fieldIndex,
    pdfFieldName: fieldMap.pdfFieldName,
    fieldType: generated.type,
    factKey: fieldMap.factKey,
    expectedValue: value ?? true,
    sourceSlug,
    fillAction,
  };
}

function skippedAction({
  fieldMap,
  generated,
  reason,
  expectedValue,
  factKey,
  sourceSlug,
  expectedClassification = 'skipped-correctly',
  expectedSkipKind = null,
}) {
  return {
    fieldIndex: fieldMap.fieldIndex,
    pdfFieldName: fieldMap.pdfFieldName,
    fieldType: generated.type,
    factKey,
    expectedValue,
    sourceSlug,
    expectedClassification,
    expectedSkipKind,
    fillAction: {
      fieldName: fieldMap.pdfFieldName,
      action: 'SKIP',
      sourceSlugs: sourceSlug ? [sourceSlug] : [],
      confidence: 0.99,
      skipReason: reason,
    },
  };
}
