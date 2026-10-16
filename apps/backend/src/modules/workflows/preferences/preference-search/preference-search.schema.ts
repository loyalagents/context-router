import { z } from 'zod';

export const RelevanceResponseSchema = z.object({
  relevantSlugs: z.array(z.string()),
  queryInterpretation: z.string(),
});

export type RelevanceResponse = z.infer<typeof RelevanceResponseSchema>;

export const LocalRelevanceResponseSchema = z.object({
  relevantReferences: z.array(z.number().int().nonnegative()),
  queryInterpretation: z.string(),
});
