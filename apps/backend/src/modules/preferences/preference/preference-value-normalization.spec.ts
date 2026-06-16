import { PreferenceValueType } from '@infrastructure/prisma/generated-client';
import { canonicalizePreferenceValue } from './preference-value-normalization';

describe('canonicalizePreferenceValue', () => {
  it('trims string values without changing case', () => {
    const events: unknown[] = [];

    const value = canonicalizePreferenceValue(
      { valueType: PreferenceValueType.STRING },
      '  Alex Rivera  ',
      { slug: 'profile.full_name', onEvent: (event) => events.push(event) },
    );

    expect(value).toBe('Alex Rivera');
    expect(events).toEqual([
      expect.objectContaining({
        kind: 'trimmed_string',
        slug: 'profile.full_name',
      }),
    ]);
  });

  it('canonicalizes enum values by matching configured options case-insensitively', () => {
    const events: unknown[] = [];

    const value = canonicalizePreferenceValue(
      {
        valueType: PreferenceValueType.ENUM,
        options: ['alien authorized to work', 'lawful permanent resident'],
      },
      ' Alien Authorized To Work ',
      {
        slug: 'eval.work_authorization.citizenship_status',
        onEvent: (event) => events.push(event),
      },
    );

    expect(value).toBe('alien authorized to work');
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'canonicalized_enum',
        slug: 'eval.work_authorization.citizenship_status',
      }),
    ]));
  });

  it('leaves unmatched enum values trimmed so validation can fail clearly', () => {
    const value = canonicalizePreferenceValue(
      {
        valueType: PreferenceValueType.ENUM,
        options: ['alien authorized to work'],
      },
      ' unknown status ',
    );

    expect(value).toBe('unknown status');
  });

  it('coerces a scalar string to a singleton array for array definitions', () => {
    const events: unknown[] = [];

    const value = canonicalizePreferenceValue(
      { valueType: PreferenceValueType.ARRAY },
      ' Santos ',
      {
        slug: 'eval.identity.other_last_names',
        onEvent: (event) => events.push(event),
      },
    );

    expect(value).toEqual(['Santos']);
    expect(events).toEqual([
      expect.objectContaining({
        kind: 'coerced_array_scalar',
        slug: 'eval.identity.other_last_names',
      }),
    ]);
  });

  it('leaves blank scalar strings invalid for array definitions', () => {
    const value = canonicalizePreferenceValue(
      { valueType: PreferenceValueType.ARRAY },
      '   ',
    );

    expect(value).toBe('');
  });

  it('trims, drops blank strings, and dedupes string array entries', () => {
    const value = canonicalizePreferenceValue(
      { valueType: PreferenceValueType.ARRAY },
      [' email ', '', 'email', 'sms'],
    );

    expect(value).toEqual(['email', 'sms']);
  });

  it('leaves booleans unchanged', () => {
    const value = canonicalizePreferenceValue(
      { valueType: PreferenceValueType.BOOLEAN },
      true,
    );

    expect(value).toBe(true);
  });
});
