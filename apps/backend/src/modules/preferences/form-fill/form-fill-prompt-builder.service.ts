import { Injectable } from '@nestjs/common';
import { FormFillFieldPolicies, PdfFieldMetadata } from './form-fill.types';

export interface FormFillPromptPreference {
  slug: string;
  value: unknown;
  description?: string;
}

@Injectable()
export class FormFillPromptBuilderService {
  buildPrompt(
    fields: PdfFieldMetadata[],
    activePreferences: FormFillPromptPreference[],
    fieldPolicies?: FormFillFieldPolicies,
  ): string {
    return `You are filling a fillable PDF form from the user's active memory.

Return JSON only. Return exactly one fill action for every PDF field in the metadata list.
Use exact case-sensitive fieldName values from the field metadata. Do not invent field names.
For dropdown, radio, and option-list fields, use exact option value strings from the metadata.
For text fields with maxLength metadata, return a value whose final text length is at or below maxLength.
Every action must include sourceSlugs and confidence. Use sourceSlugs: [] only for SKIP actions.
Use SKIP with sourceSlugs: [] and confidence: 0 when memory is missing, confidence is low, a field is unsupported, or a field should not be filled.
Do not fill signatures, certification/declaration fields, submit buttons, or fields that require unsupported personal/legal assertions.
When field policies are provided, treat mode=skip fields and inactive conditional branches as not fillable.
For grouped checkbox policies, choose only the applicable checkbox and leave the other checkboxes unchecked or skipped.

Allowed response shape:
{
  "fillActions": [
    {
      "fieldName": "exact PDF field name",
      "action": "SET_TEXT" | "CHECK" | "UNCHECK" | "SELECT_OPTION" | "SKIP",
      "value": "required only for SET_TEXT and SELECT_OPTION",
      "sourceSlugs": ["active.preference_slug"],
      "confidence": 0.0,
      "skipReason": "required when action is SKIP"
    }
  ]
}

PDF fields:
${JSON.stringify(fields, null, 2)}

Active user memories:
${JSON.stringify(activePreferences, null, 2)}

Field policies:
${fieldPolicies ? JSON.stringify(fieldPolicies, null, 2) : 'null'}
`;
  }
}
