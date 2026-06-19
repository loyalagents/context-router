import {
  resolveFormFacts,
  ResolvedFormFact,
} from './form-fact-resolution';
import { FormFillFieldPolicies } from './form-fill.types';

describe('form fact resolution', () => {
  it('maps trusted open-schema work authorization slugs to canonical facts', () => {
    const result = resolveFormFacts({
      activePreferences: [
        {
          slug: 'work_auth.citizenship_status',
          value: 'alien authorized to work',
        },
        { slug: 'work_auth.expiration_date', value: '2028-09-30' },
        { slug: 'work_auth.uscis_number', value: '987654321' },
        { slug: 'work_auth.i94_admission_number', value: '11223344556' },
        { slug: 'work_auth.foreign_passport_number', value: 'XK1234567' },
      ],
    });

    expect(fact(result.facts, 'workAuthorization.citizenshipStatus')).toMatchObject({
      value: 'alien authorized to work',
      sourceSlugs: ['work_auth.citizenship_status'],
      resolutionKind: 'alias',
    });
    expect(
      fact(result.facts, 'workAuthorization.workAuthorizationExpirationDate'),
    ).toMatchObject({
      value: '2028-09-30',
      sourceSlugs: ['work_auth.expiration_date'],
      resolutionKind: 'alias',
    });
    expect(fact(result.facts, 'workAuthorization.uscisANumber')).toMatchObject({
      value: '987654321',
      sourceSlugs: ['work_auth.uscis_number'],
      resolutionKind: 'alias',
    });
    expect(fact(result.facts, 'workAuthorization.i94AdmissionNumber')).toMatchObject({
      value: '11223344556',
      sourceSlugs: ['work_auth.i94_admission_number'],
      resolutionKind: 'alias',
    });
    expect(fact(result.facts, 'workAuthorization.foreignPassportNumber')).toMatchObject({
      value: 'XK1234567',
      sourceSlugs: ['work_auth.foreign_passport_number'],
      resolutionKind: 'alias',
    });
    expect(result.conflicts).toEqual([]);
  });

  it('derives middle initial from a resolved middle name', () => {
    const result = resolveFormFacts({
      activePreferences: [{ slug: 'profile.middle_name', value: 'Jordan' }],
    });

    expect(fact(result.facts, 'identity.middleName')).toMatchObject({
      value: 'Jordan',
      sourceSlugs: ['profile.middle_name'],
      resolutionKind: 'alias',
    });
    expect(fact(result.facts, 'identity.middleInitial')).toMatchObject({
      value: 'J',
      sourceSlugs: ['profile.middle_name'],
      resolutionKind: 'derived',
      derivedFromFactKey: 'identity.middleName',
    });
  });

  it('does not derive middle initial when a direct middle initial is present', () => {
    const fieldPolicies: FormFillFieldPolicies = {
      schemaVersion: 1,
      fields: [
        {
          fieldName: 'Employee Middle Initial (if any)',
          mode: 'fact',
          factKey: 'identity.middleInitial',
          sourceSlugs: ['eval.identity.middle_initial'],
        },
      ],
    };

    const result = resolveFormFacts({
      activePreferences: [
        { slug: 'profile.middle_name', value: 'Jordan' },
        { slug: 'eval.identity.middle_initial', value: 'K' },
      ],
      fieldPolicies,
    });

    expect(fact(result.facts, 'identity.middleInitial')).toMatchObject({
      value: 'K',
      sourceSlugs: ['eval.identity.middle_initial'],
      resolutionKind: 'policy_source',
    });
  });

  it('does not resolve unrelated plausible slugs', () => {
    const result = resolveFormFacts({
      activePreferences: [
        {
          slug: 'profile.unexpected_status',
          value: 'alien authorized to work',
        },
      ],
    });

    expect(result.facts.map((entry) => entry.factKey)).not.toContain(
      'workAuthorization.citizenshipStatus',
    );
  });

  it('marks conflicting canonical facts as unusable', () => {
    const fieldPolicies: FormFillFieldPolicies = {
      schemaVersion: 1,
      fields: [
        {
          fieldName: 'CB_4',
          mode: 'fact',
          factKey: 'workAuthorization.citizenshipStatus',
          sourceSlugs: ['work_authorization.citizenship_status'],
          when: {
            factKey: 'workAuthorization.citizenshipStatus',
            sourceSlugs: ['work_authorization.citizenship_status'],
            equals: 'alien authorized to work',
          },
        },
      ],
    };

    const result = resolveFormFacts({
      activePreferences: [
        {
          slug: 'work_auth.citizenship_status',
          value: 'alien authorized to work',
        },
        {
          slug: 'work_authorization.citizenship_status',
          value: 'lawful permanent resident',
        },
      ],
      fieldPolicies,
    });

    expect(result.facts.map((entry) => entry.factKey)).not.toContain(
      'workAuthorization.citizenshipStatus',
    );
    expect(result.conflicts).toEqual([
      expect.objectContaining({
        factKey: 'workAuthorization.citizenshipStatus',
        sourceSlugs: [
          'work_auth.citizenship_status',
          'work_authorization.citizenship_status',
        ],
      }),
    ]);
  });
});

function fact(facts: ResolvedFormFact[], factKey: string): ResolvedFormFact {
  const match = facts.find((entry) => entry.factKey === factKey);
  if (!match) {
    throw new Error(`Missing resolved fact ${factKey}`);
  }
  return match;
}
