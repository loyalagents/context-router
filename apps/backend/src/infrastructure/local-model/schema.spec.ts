import { z } from 'zod';
import { localJsonSchema } from './schema';
import { FillActionSchema, FormFillAiResponseSchema } from '../../modules/preferences/form-fill/form-fill.types';

describe('local JSON grammar retains real input shapes', () => {
  it('retains arbitrary JSON, nullable/default input and a dynamic literal, then uses actual Zod semantics', () => {
    const arbitrary = localJsonSchema(z.object({ value: z.any(), slug: z.literal('profile.email') }));
    expect(arbitrary.properties.value).toEqual({});
    expect(arbitrary.properties.slug.const).toBe('profile.email');
    const form = localJsonSchema(FormFillAiResponseSchema);
    expect(form.properties.fillActions.items.properties.value).toEqual({ anyOf: [{ type: 'string' }, { type: 'null' }] });
    expect(form.properties.fillActions.items.required).not.toContain('value');
    expect(form.properties.fillActions.items.required).not.toContain('sourceSlugs');
    expect(FormFillAiResponseSchema.parse({ fillActions: [{ fieldName: 'name', action: 'SKIP', value: null }] }).fillActions[0]).toEqual({ fieldName: 'name', action: 'SKIP', value: undefined, sourceSlugs: [] });
  });
  it('rejects unqualified transforms and oversized schemas without provider diagnostics', () => {
    expect(() => localJsonSchema(z.preprocess((value) => value, z.string()))).toThrow('AI capability unsupported');
    expect(() => localJsonSchema(z.literal('x'.repeat(33000)))).toThrow('Local model input limit');
  });
  it('preserves the original preprocess input/output contract including key presence and defaults', () => {
    const previous = z.object({ fieldName: z.string(), action: z.enum(['SET_TEXT', 'CHECK', 'UNCHECK', 'SELECT_OPTION', 'SKIP']),
      value: z.preprocess((value) => value === null ? undefined : value, z.string().optional()),
      sourceSlugs: z.array(z.string()).optional().default([]), confidence: z.number().min(0).max(1).optional(), skipReason: z.string().optional() });
    for (const extra of [{}, { value: undefined }, { value: null }, { value: '00123' }, { value: 123 }, { value: [] }]) {
      const input = { fieldName: 'name', action: 'SET_TEXT', ...extra };
      const before = previous.safeParse(input); const after = FillActionSchema.safeParse(input);
      expect(after.success).toBe(before.success);
      if (before.success && after.success) {
        expect(after.data).toEqual(before.data);
        expect(Object.keys(after.data)).toEqual(Object.keys(before.data));
      }
    }
  });
});
