import { z } from 'zod';

export const ConsolidationGroupSchema = z.object({
  slugs: z.array(z.string()),
  reason: z.string(),
  suggestion: z.enum(['MERGE', 'RENAME', 'DELETE_ONE', 'REVIEW']),
  recommendedSlug: z.string().optional(),
});

export const ConsolidationResponseSchema = z.object({
  consolidationGroups: z.array(ConsolidationGroupSchema),
  summary: z.string(),
});

export type ConsolidationResponse = z.infer<typeof ConsolidationResponseSchema>;
