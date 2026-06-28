import { FormFillAiResponseSchema } from './form-fill.types';

describe('FormFillAiResponseSchema', () => {
  it('normalizes null fill action values to omitted values', () => {
    const parsed = FormFillAiResponseSchema.parse({
      fillActions: [
        {
          fieldName: 'checkbox-field',
          action: 'CHECK',
          value: null,
          sourceSlugs: ['direct_deposit.account_type'],
          confidence: 0.9,
        },
        {
          fieldName: 'text-field',
          action: 'SET_TEXT',
          value: null,
          sourceSlugs: ['direct_deposit.bank_name'],
          confidence: 0.7,
        },
      ],
    });

    expect(parsed.fillActions[0].value).toBeUndefined();
    expect(parsed.fillActions[1].value).toBeUndefined();
  });

  it('still rejects non-null non-string fill action values', () => {
    expect(() =>
      FormFillAiResponseSchema.parse({
        fillActions: [
          {
            fieldName: 'text-field',
            action: 'SET_TEXT',
            value: 123,
            sourceSlugs: ['direct_deposit.bank_name'],
            confidence: 0.7,
          },
        ],
      }),
    ).toThrow();
  });
});
