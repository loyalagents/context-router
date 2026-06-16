import { z } from 'zod';

export type FormFillStatus =
  | 'success'
  | 'partial'
  | 'no_fillable_fields'
  | 'unsupported_format'
  | 'failed';

export type PdfFieldType =
  | 'text'
  | 'checkbox'
  | 'radio'
  | 'dropdown'
  | 'option_list'
  | 'button'
  | 'signature'
  | 'unknown';

export type FillActionType =
  | 'SET_TEXT'
  | 'CHECK'
  | 'UNCHECK'
  | 'SELECT_OPTION'
  | 'SKIP';

export interface PdfFieldOption {
  label: string;
  value: string;
}

export interface PdfFieldMetadata {
  name: string;
  type: PdfFieldType;
  options: PdfFieldOption[];
  supported: boolean;
  unsupportedReason?: string;
}

export interface FormFillValidationEvent {
  kind:
    | 'low_confidence_applied'
    | 'policy_inactive_blocked'
    | 'policy_structural_skip_blocked'
    | 'checkbox_group_conflict';
  fieldName: string;
  message: string;
  confidence?: number;
  groupId?: string;
}

export interface ExtractedPdfFields {
  hasXfa: boolean;
  fields: PdfFieldMetadata[];
}

const FieldConditionSchema = z.object({
  factKey: z.string(),
  sourceSlugs: z.array(z.string()).optional().default([]),
  equals: z.union([z.string(), z.array(z.string())]),
});

const FieldPolicySchema = z.object({
  fieldName: z.string(),
  mode: z.enum(['fact', 'skip']),
  factKey: z.string().optional(),
  sourceSlugs: z.array(z.string()).optional().default([]),
  when: FieldConditionSchema.optional(),
  // Checkbox policies sharing a groupId are treated as mutually exclusive.
  groupId: z.string().optional(),
  reason: z.string().optional(),
});

export const FormFillFieldPoliciesSchema = z.object({
  schemaVersion: z.literal(1),
  fields: z.array(FieldPolicySchema),
});

export type FormFillFieldCondition = z.infer<typeof FieldConditionSchema>;
export type FormFillFieldPolicy = z.infer<typeof FieldPolicySchema>;
export type FormFillFieldPolicies = z.infer<
  typeof FormFillFieldPoliciesSchema
>;

export const FillActionSchema = z.object({
  fieldName: z.string(),
  action: z.enum(['SET_TEXT', 'CHECK', 'UNCHECK', 'SELECT_OPTION', 'SKIP']),
  value: z.string().optional(),
  sourceSlugs: z.array(z.string()).optional().default([]),
  confidence: z.number().min(0).max(1).optional(),
  skipReason: z.string().optional(),
});

export const FormFillAiResponseSchema = z.object({
  fillActions: z.array(FillActionSchema),
});

export type AiFillAction = z.infer<typeof FillActionSchema>;
export type FormFillAiResponse = z.infer<typeof FormFillAiResponseSchema>;

export interface ValidatedFillAction {
  fieldName: string;
  fieldType: PdfFieldType;
  action: Exclude<FillActionType, 'SKIP'>;
  value?: string;
  sourceSlugs: string[];
  confidence: number;
}

export interface FilledFieldSummary {
  pdfFieldName: string;
  fieldType: string;
  sourceSlugs: string[];
  confidence: number;
}

export interface SkippedFieldSummary {
  pdfFieldName: string;
  fieldType: string;
  reason: string;
  confidence?: number;
  sourceSlugs?: string[];
}

export interface FormFillSummary {
  totalFields: number;
  filledCount: number;
  skippedCount: number;
  filledFields: FilledFieldSummary[];
  skippedFields: SkippedFieldSummary[];
  warnings: string[];
  validationEvents?: FormFillValidationEvent[];
}

export interface FormFillResponse {
  fillId: string;
  status: FormFillStatus;
  originalFilename: string;
  outputFilename: string;
  outputMimeType: 'application/pdf';
  filledPdfBase64: string | null;
  summary: FormFillSummary;
}
