import { FormFillAiResponseSchema } from './form-fill.types';

describe('FormFillAiResponseSchema', () => {
  it('normalizes null action values from model output to missing values', () => {
    const parsed = FormFillAiResponseSchema.parse({
      fillActions: [
        {
          fieldName: 'payphone',
          action: 'SET_TEXT',
          value: null,
          sourceSlugs: ['profile.phone'],
          confidence: 0.8,
        },
      ],
    });

    expect(parsed.fillActions[0]).toMatchObject({
      fieldName: 'payphone',
      action: 'SET_TEXT',
      sourceSlugs: ['profile.phone'],
      confidence: 0.8,
    });
    expect(parsed.fillActions[0].value).toBeUndefined();
  });
});
