import { z } from 'zod';

const ConsolidatedSuggestionSchema = (slug: string) =>
  z.object({
    slug: z.literal(slug),
    operation: z.enum(['CREATE', 'UPDATE']),
    oldValue: z.any().optional(),
    newValue: z.any(),
    confidence: z.number().min(0).max(1),
    sourceSnippet: z.string(),
    sourceMeta: z
      .object({
        page: z.number().optional().nullable(),
        line: z.number().optional().nullable(),
      })
      .optional()
      .nullable(),
  });

export const buildDuplicateConsolidationSchema = (slug: string) =>
  z.object({
    suggestion: ConsolidatedSuggestionSchema(slug),
  });
