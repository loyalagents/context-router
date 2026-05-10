import { Injectable } from '@nestjs/common';
import {
  AiFillAction,
  FilledFieldSummary,
  PdfFieldMetadata,
  SkippedFieldSummary,
  ValidatedFillAction,
} from './form-fill.types';

export interface FormFillValidationResult {
  validActions: ValidatedFillAction[];
  filledFields: FilledFieldSummary[];
  skippedFields: SkippedFieldSummary[];
  warnings: string[];
}

@Injectable()
export class FormFillValidatorService {
  validate(
    actions: AiFillAction[],
    fields: PdfFieldMetadata[],
    activePreferenceSlugs: Set<string>,
    confidenceThreshold: number,
  ): FormFillValidationResult {
    const warnings: string[] = [];
    const fieldByName = new Map(fields.map((field) => [field.name, field]));
    const actionByFieldName = new Map<string, AiFillAction>();

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

    return {
      validActions,
      filledFields,
      skippedFields,
      warnings,
    };
  }

  private invalidReason(
    action: AiFillAction,
    field: PdfFieldMetadata,
    activePreferenceSlugs: Set<string>,
    confidenceThreshold: number,
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

    if (action.confidence < confidenceThreshold) {
      return 'confidence below threshold';
    }

    return null;
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
