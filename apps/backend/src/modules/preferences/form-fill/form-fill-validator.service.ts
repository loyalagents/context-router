import { Injectable } from '@nestjs/common';
import {
  AiFillAction,
  FormFillFieldCondition,
  FormFillFieldPolicies,
  FormFillFieldPolicy,
  FormFillValidationEvent,
  FilledFieldSummary,
  PdfFieldMetadata,
  SkippedFieldSummary,
  ValidatedFillAction,
} from './form-fill.types';
import type {
  FormFactResolutionConflict,
  ResolvedFormFact,
} from './form-fact-resolution';
import { normalizeTextValueForPdfField } from './pdf-text-value-normalization';

export interface FormFillValidationResult {
  validActions: ValidatedFillAction[];
  filledFields: FilledFieldSummary[];
  skippedFields: SkippedFieldSummary[];
  warnings: string[];
  validationEvents: FormFillValidationEvent[];
}

export interface FormFillValidationOptions {
  fieldPolicies?: FormFillFieldPolicies;
  activePreferenceValues?: Map<string, unknown>;
  resolvedFacts?: ResolvedFormFact[];
  resolutionConflicts?: FormFactResolutionConflict[];
}

@Injectable()
export class FormFillValidatorService {
  validate(
    actions: AiFillAction[],
    fields: PdfFieldMetadata[],
    activePreferenceSlugs: Set<string>,
    confidenceThreshold: number,
    options: FormFillValidationOptions = {},
  ): FormFillValidationResult {
    const warnings: string[] = [];
    const fieldByName = new Map(fields.map((field) => [field.name, field]));
    const fieldOrder = new Map(fields.map((field, index) => [field.name, index]));
    const policyByFieldName = new Map(
      options.fieldPolicies?.fields.map((policy) => [policy.fieldName, policy]) ?? [],
    );
    const resolvedFactByKey = new Map(
      (options.resolvedFacts ?? []).map((fact) => [fact.factKey, fact]),
    );
    const conflictByFactKey = new Map(
      (options.resolutionConflicts ?? []).map((conflict) => [
        conflict.factKey,
        conflict,
      ]),
    );
    const actionByFieldName = new Map<string, AiFillAction>();
    const validationEvents: FormFillValidationEvent[] = [];

    for (const action of actions) {
      if (!fieldByName.has(action.fieldName)) {
        warnings.push(`AI returned unknown field "${action.fieldName}"; ignoring action`);
        continue;
      }

      if (actionByFieldName.has(action.fieldName)) {
        warnings.push(`AI returned duplicate action for "${action.fieldName}"; ignoring duplicate`);
        continue;
      }

      actionByFieldName.set(action.fieldName, action);
    }

    const validActions: ValidatedFillAction[] = [];
    const filledFields: FilledFieldSummary[] = [];
    const skippedFields: SkippedFieldSummary[] = [];

    for (const field of fields) {
      const action = actionByFieldName.get(field.name);

      if (!action) {
        skippedFields.push(this.skip(field, 'not returned by AI'));
        continue;
      }

      const invalidReason = this.invalidReason(
        action,
        field,
        activePreferenceSlugs,
        confidenceThreshold,
        policyByFieldName.get(field.name),
        options.activePreferenceValues ?? new Map(),
        resolvedFactByKey,
        conflictByFactKey,
        validationEvents,
      );

      if (invalidReason) {
        skippedFields.push(
          this.skip(field, invalidReason, action.confidence, action.sourceSlugs),
        );
        continue;
      }

      if (action.action === 'SKIP') {
        skippedFields.push(
          this.skip(
            field,
            action.skipReason?.trim() || 'AI skipped field',
            action.confidence,
            action.sourceSlugs,
          ),
        );
        continue;
      }

      validActions.push({
        fieldName: action.fieldName,
        fieldType: field.type,
        action: action.action,
        value: action.value,
        sourceSlugs: action.sourceSlugs,
        confidence: action.confidence,
      });
      filledFields.push({
        pdfFieldName: field.name,
        fieldType: field.type,
        sourceSlugs: action.sourceSlugs,
        confidence: action.confidence,
      });
    }

    const groupAdjusted = this.applyCheckboxGroupPolicies({
      validActions,
      filledFields,
      skippedFields,
      fieldsByName: fieldByName,
      fieldOrder,
      policyByFieldName,
      validationEvents,
    });

    return {
      validActions: groupAdjusted.validActions,
      filledFields: groupAdjusted.filledFields,
      skippedFields,
      warnings,
      validationEvents,
    };
  }

  private invalidReason(
    action: AiFillAction,
    field: PdfFieldMetadata,
    activePreferenceSlugs: Set<string>,
    confidenceThreshold: number,
    policy: FormFillFieldPolicy | undefined,
    activePreferenceValues: Map<string, unknown>,
    resolvedFactByKey: Map<string, ResolvedFormFact>,
    conflictByFactKey: Map<string, FormFactResolutionConflict>,
    validationEvents: FormFillValidationEvent[],
  ): string | null {
    if (!field.supported) {
      return field.unsupportedReason || 'field type is not supported';
    }

    if (action.action !== 'SKIP' && !this.isCompatible(action.action, field)) {
      return `action ${action.action} is not compatible with ${field.type} fields`;
    }

    if (
      (action.action === 'SET_TEXT' || action.action === 'SELECT_OPTION') &&
      !action.value?.trim()
    ) {
      return 'missing value';
    }

    if (action.action === 'SELECT_OPTION' && action.value) {
      const values = new Set(field.options.map((option) => option.value));
      if (!values.has(action.value)) {
        return `selected option "${action.value}" is not available`;
      }
    }

    if (action.action === 'SKIP') {
      return null;
    }

    if (policy?.mode === 'skip') {
      const reason = `field policy skip: ${policy.reason ?? 'structural_skip'}`;
      validationEvents.push({
        kind: 'policy_structural_skip_blocked',
        fieldName: field.name,
        message: reason,
      });
      return reason;
    }

    if (
      policy?.when &&
      !this.conditionIsActive(
        policy.when,
        activePreferenceValues,
        resolvedFactByKey,
        conflictByFactKey,
        field.name,
        validationEvents,
      )
    ) {
      const reason = `field policy inactive: ${policy.when.factKey}`;
      validationEvents.push({
        kind: 'policy_inactive_blocked',
        fieldName: field.name,
        message: reason,
      });
      return reason;
    }

    if (policy?.mode === 'fact' && policy.factKey) {
      const conflict = conflictByFactKey.get(policy.factKey);
      if (conflict) {
        const reason = `field policy conflict: ${policy.factKey}`;
        validationEvents.push({
          kind: 'policy_fact_conflict_blocked',
          fieldName: field.name,
          factKey: policy.factKey,
          message: reason,
        });
        return reason;
      }
    }

    if (action.sourceSlugs.length === 0) {
      return 'missing source slug';
    }

    for (const slug of action.sourceSlugs) {
      if (!activePreferenceSlugs.has(slug)) {
        return `source slug "${slug}" is not an active preference`;
      }
    }

    if (typeof action.confidence !== 'number') {
      return 'missing confidence';
    }

    if (action.action === 'SET_TEXT' && typeof field.maxLength === 'number') {
      const valueLength = normalizeTextValueForPdfField(action).length;
      if (valueLength > field.maxLength) {
        const reason = `text length ${valueLength} exceeds PDF field maxLength ${field.maxLength}`;
        validationEvents.push({
          kind: 'pdf_text_max_length_blocked',
          fieldName: field.name,
          message: reason,
          confidence: action.confidence,
          maxLength: field.maxLength,
          valueLength,
        });
        return reason;
      }
    }

    if (policy?.mode === 'fact' && policy.factKey) {
      const resolvedFact = resolvedFactByKey.get(policy.factKey);
      for (const slug of action.sourceSlugs) {
        if (resolvedFact?.sourceSlugs.includes(slug)) {
          validationEvents.push({
            kind: 'policy_source_slug_resolved',
            fieldName: field.name,
            factKey: policy.factKey,
            sourceSlug: slug,
            resolutionKind: resolvedFact.resolutionKind,
            message: `source slug resolved to field policy fact ${policy.factKey}: ${slug}`,
          });
        }
      }
    }

    if (action.confidence < confidenceThreshold) {
      validationEvents.push({
        kind: 'low_confidence_applied',
        fieldName: field.name,
        confidence: action.confidence,
        message: `confidence ${action.confidence} below threshold ${confidenceThreshold}`,
      });
    }

    return null;
  }

  private conditionIsActive(
    condition: FormFillFieldCondition,
    activePreferenceValues: Map<string, unknown>,
    resolvedFactByKey: Map<string, ResolvedFormFact>,
    conflictByFactKey: Map<string, FormFactResolutionConflict>,
    fieldName: string,
    validationEvents: FormFillValidationEvent[],
  ): boolean {
    const conflict = conflictByFactKey.get(condition.factKey);
    if (conflict) {
      validationEvents.push({
        kind: 'policy_condition_conflict_blocked',
        fieldName,
        factKey: condition.factKey,
        message: `field policy condition conflict: ${condition.factKey}`,
      });
      return false;
    }

    const expected = Array.isArray(condition.equals)
      ? condition.equals
      : [condition.equals];

    const resolvedFact = resolvedFactByKey.get(condition.factKey);
    if (resolvedFact) {
      const active = this.valueMatchesExpected(
        condition.factKey,
        resolvedFact.value,
        expected,
      );
      if (active) {
        validationEvents.push({
          kind: 'policy_condition_resolved',
          fieldName,
          factKey: condition.factKey,
          sourceSlug: resolvedFact.sourceSlugs[0],
          resolutionKind: resolvedFact.resolutionKind,
          message: `field policy condition resolved from canonical fact ${condition.factKey}`,
        });
      }
      return active;
    }

    const sourceSlugs = condition.sourceSlugs ?? [];
    if (sourceSlugs.length > 0) {
      let checkedActiveListedSlug = false;
      for (const slug of sourceSlugs) {
        if (!activePreferenceValues.has(slug)) {
          continue;
        }
        checkedActiveListedSlug = true;
        if (
          this.valueMatchesExpected(
            condition.factKey,
            activePreferenceValues.get(slug),
            expected,
          )
        ) {
          return true;
        }
      }

      if (checkedActiveListedSlug) {
        return false;
      }
    }

    return this.conditionMatchesAnyActivePreferenceValue(
      condition,
      expected,
      activePreferenceValues,
      fieldName,
      validationEvents,
    );
  }

  private valueMatchesExpected(
    factKey: string,
    value: unknown,
    expected: string[],
  ): boolean {
    if (Array.isArray(value)) {
      return value.some((entry) =>
        this.valueMatchesExpected(factKey, entry, expected),
      );
    }

    const normalizedValue = this.normalizedConditionValue(factKey, value);
    return expected.some(
      (candidate) =>
        this.normalizedConditionValue(factKey, candidate) === normalizedValue,
    );
  }

  private conditionMatchesAnyActivePreferenceValue(
    condition: FormFillFieldCondition,
    expected: string[],
    activePreferenceValues: Map<string, unknown>,
    fieldName: string,
    validationEvents: FormFillValidationEvent[],
  ): boolean {
    for (const [sourceSlug, value] of activePreferenceValues) {
      if (!this.valueMatchesExpected(condition.factKey, value, expected)) {
        continue;
      }
      validationEvents.push({
        kind: 'policy_condition_active_value_matched',
        fieldName,
        factKey: condition.factKey,
        sourceSlug,
        message: `field policy condition matched active memory value for ${condition.factKey}`,
      });
      return true;
    }

    return false;
  }

  private normalizedConditionValue(factKey: string, value: unknown): string {
    const normalized = String(value ?? '')
      .trim()
      .toLocaleLowerCase()
      .replace(/[.]/g, '')
      .replace(/\s+/g, ' ');

    if (factKey === 'workAuthorization.citizenshipStatus') {
      const withoutArticle = normalized.replace(/^an?\s+/, '');
      if (
        withoutArticle.includes('us citizen') ||
        withoutArticle.includes('united states citizen') ||
        withoutArticle.includes('citizen of the united states')
      ) {
        return 'us citizen';
      }
      return withoutArticle;
    }

    if (factKey === 'tax.filingStatus') {
      return normalized;
    }

    return normalized;
  }

  private applyCheckboxGroupPolicies({
    validActions,
    filledFields,
    skippedFields,
    fieldsByName,
    fieldOrder,
    policyByFieldName,
    validationEvents,
  }: {
    validActions: ValidatedFillAction[];
    filledFields: FilledFieldSummary[];
    skippedFields: SkippedFieldSummary[];
    fieldsByName: Map<string, PdfFieldMetadata>;
    fieldOrder: Map<string, number>;
    policyByFieldName: Map<string, FormFillFieldPolicy>;
    validationEvents: FormFillValidationEvent[];
  }): {
    validActions: ValidatedFillAction[];
    filledFields: FilledFieldSummary[];
  } {
    const checkedByGroup = new Map<string, ValidatedFillAction[]>();
    for (const action of validActions) {
      const policy = policyByFieldName.get(action.fieldName);
      if (
        policy?.groupId &&
        action.fieldType === 'checkbox' &&
        action.action === 'CHECK'
      ) {
        const group = checkedByGroup.get(policy.groupId) ?? [];
        group.push(action);
        checkedByGroup.set(policy.groupId, group);
      }
    }

    const blockedFieldNames = new Set<string>();
    for (const [groupId, actions] of checkedByGroup) {
      if (actions.length <= 1) {
        continue;
      }

      const [winner, ...losers] = [...actions].sort((left, right) => {
        const confidenceDelta = right.confidence - left.confidence;
        if (confidenceDelta !== 0) return confidenceDelta;
        return (
          (fieldOrder.get(left.fieldName) ?? Number.MAX_SAFE_INTEGER) -
          (fieldOrder.get(right.fieldName) ?? Number.MAX_SAFE_INTEGER)
        );
      });

      for (const loser of losers) {
        blockedFieldNames.add(loser.fieldName);
        const field = fieldsByName.get(loser.fieldName);
        if (field) {
          const reason = `checkbox group conflict: ${groupId}`;
          skippedFields.push(
            this.skip(field, reason, loser.confidence, loser.sourceSlugs),
          );
          validationEvents.push({
            kind: 'checkbox_group_conflict',
            fieldName: loser.fieldName,
            groupId,
            confidence: loser.confidence,
            message: `checkbox group conflict: kept ${winner.fieldName}`,
          });
        }
      }
    }

    if (blockedFieldNames.size > 0) {
      for (let index = validationEvents.length - 1; index >= 0; index -= 1) {
        const event = validationEvents[index];
        if (
          event.kind === 'low_confidence_applied' &&
          blockedFieldNames.has(event.fieldName)
        ) {
          validationEvents.splice(index, 1);
        }
      }
    }

    return {
      validActions: validActions.filter(
        (action) => !blockedFieldNames.has(action.fieldName),
      ),
      filledFields: filledFields.filter(
        (field) => !blockedFieldNames.has(field.pdfFieldName),
      ),
    };
  }

  private isCompatible(
    action: AiFillAction['action'],
    field: PdfFieldMetadata,
  ): boolean {
    switch (field.type) {
      case 'text':
        return action === 'SET_TEXT';
      case 'checkbox':
        return action === 'CHECK' || action === 'UNCHECK';
      case 'radio':
      case 'dropdown':
      case 'option_list':
        return action === 'SELECT_OPTION';
      case 'button':
      case 'signature':
      case 'unknown':
        return false;
    }
  }

  private skip(
    field: PdfFieldMetadata,
    reason: string,
    confidence?: number,
    sourceSlugs?: string[],
  ): SkippedFieldSummary {
    return {
      pdfFieldName: field.name,
      fieldType: field.type,
      reason,
      confidence,
      sourceSlugs,
    };
  }
}
