import { Injectable } from '@nestjs/common';
import { FormFillFieldPolicies, PdfFieldMetadata } from './form-fill.types';
import type { ResolvedFormFact } from './form-fact-resolution';

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
    resolvedFacts: ResolvedFormFact[] = [],
  ): string {
    return `You are filling a fillable PDF form from the user's active memory.

Return JSON only. Return exactly one fill action for every PDF field in the metadata list.
Use exact case-sensitive fieldName values from the field metadata. Do not invent field names.
For dropdown, radio, and option-list fields, use exact option value strings from the metadata.
For text fields with maxLength metadata, return a value whose final text length is at or below maxLength.
Every action must include sourceSlugs and confidence. Use sourceSlugs: [] only for SKIP actions.
Use SKIP with sourceSlugs: [] and confidence: 0 when memory is missing, confidence is low, a field is unsupported, or a field should not be filled.
Do not fill signatures, certification/declaration fields, submit buttons, or fields that require unsupported personal/legal assertions.
When field policies are provided, treat them as authoritative for field intent and skip rules.
For mode=fact field policies, factKey, field notes, and policy metadata describe the target value. sourceSlugs are hints/examples/aliases and are not exhaustive.
You may use any active memory whose value supports the target field, including multiple active memories when the field requires a composed value.
Use sourceSlugs from the raw active memories actually used. Do not cite canonical factKeys, resolved form facts, or any sourceSlug that is not present in active memory.
When Resolved form facts lists the target factKey, prefer its sourceSlugs exactly; those are active memory slugs that already resolved to the form fact.
Do not invent memories, values, or resolved form facts. If active memory is missing, contradicted, stale, ambiguous, or insufficient, return SKIP for that field.
Do not fill mode=skip fields, inactive conditional branches, signatures, manual attestations, out-of-scope fields, or unsupported fields.
For employee email fields, use the user's personal/contact email. Do not use employer-issued work email unless the field explicitly asks for work email.
For fields named like mmddyyyy, render dates as MMDDYYYY.
For address.current.streetLine fields, combine street plus unit/apartment when both active memories exist, and cite all component sourceSlugs.
For address.current.cityStateZip fields, render as City, ST ZIP, and cite city, state, and postal code sourceSlugs.
For grouped checkbox policies, choose only the applicable checkbox and leave the other checkboxes unchecked or skipped.
Never return null for any property. Omit value for CHECK, UNCHECK, and SKIP actions. If a text or option field has no supported value, return SKIP with skipReason instead of returning null.

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

Resolved form facts:
${JSON.stringify(resolvedFacts, null, 2)}

Field policies:
${fieldPolicies ? JSON.stringify(fieldPolicies, null, 2) : 'null'}
`;
  }
}
