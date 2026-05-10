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

export interface ExtractedPdfFields {
  hasXfa: boolean;
  fields: PdfFieldMetadata[];
}

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
