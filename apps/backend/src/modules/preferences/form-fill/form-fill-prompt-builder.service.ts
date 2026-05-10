import { Injectable } from '@nestjs/common';
import { PdfFieldMetadata } from './form-fill.types';

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
  ): string {
    return `You are filling a fillable PDF form from the user's active memory.

Return JSON only. Return exactly one fill action for every PDF field in the metadata list.
Use exact case-sensitive fieldName values from the field metadata. Do not invent field names.
For dropdown, radio, and option-list fields, use exact option value strings from the metadata.
Use SKIP with sourceSlugs: [] when memory is missing, confidence is low, a field is unsupported, or a field should not be filled.
Do not fill signatures, certification/declaration fields, submit buttons, or fields that require unsupported personal/legal assertions.

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
`;
  }
}
