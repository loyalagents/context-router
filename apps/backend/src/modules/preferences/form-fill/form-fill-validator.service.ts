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

    if (policy?.when && !this.conditionIsActive(policy.when, activePreferenceValues)) {
      const reason = `field policy inactive: ${policy.when.factKey}`;
      validationEvents.push({
        kind: 'policy_inactive_blocked',
        fieldName: field.name,
        message: reason,
      });
      return reason;
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

    if (policy?.mode === 'fact' && policy.sourceSlugs.length > 0) {
      const allowedSlugs = new Set(policy.sourceSlugs);
      const offPolicySlugs = action.sourceSlugs.filter(
        (slug) => !allowedSlugs.has(slug),
      );
      if (offPolicySlugs.length > 0) {
        validationEvents.push({
          kind: 'policy_source_slug_off_policy',
          fieldName: field.name,
          message: `source slug not listed in field policy: ${offPolicySlugs.join(', ')}`,
        });
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
  ): boolean {
    const sourceSlugs = condition.sourceSlugs ?? [];
    if (sourceSlugs.length === 0) {
      return false;
    }

    const expected = Array.isArray(condition.equals)
      ? condition.equals
      : [condition.equals];

    return sourceSlugs.some((slug) => {
      if (!activePreferenceValues.has(slug)) {
        // Conditional policies fail closed when the gating fact is unavailable.
        return false;
      }
      return this.valueMatchesExpected(activePreferenceValues.get(slug), expected);
    });
  }

  private valueMatchesExpected(value: unknown, expected: string[]): boolean {
    if (Array.isArray(value)) {
      return value.some((entry) => this.valueMatchesExpected(entry, expected));
    }

    const normalizedValue = String(value).trim().toLocaleLowerCase();
    return expected.some(
      (candidate) => candidate.trim().toLocaleLowerCase() === normalizedValue,
    );
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
          (event.kind === 'low_confidence_applied' ||
            event.kind === 'policy_source_slug_off_policy') &&
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
