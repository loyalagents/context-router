import { FormFillValidatorService } from './form-fill-validator.service';
import { AiFillAction, PdfFieldMetadata } from './form-fill.types';

const fields: PdfFieldMetadata[] = [
  {
    name: 'profile.full_name',
    type: 'text',
    options: [],
    supported: true,
  },
  {
    name: 'newsletter_opt_in',
    type: 'checkbox',
    options: [],
    supported: true,
  },
  {
    name: 'food.spice_tolerance',
    type: 'dropdown',
    options: [
      { label: 'mild', value: 'mild' },
      { label: 'medium', value: 'medium' },
    ],
    supported: true,
  },
  {
    name: 'signature',
    type: 'signature',
    options: [],
    supported: false,
    unsupportedReason: 'signature fields are not supported',
  },
];

describe('FormFillValidatorService', () => {
  let service: FormFillValidatorService;

  beforeEach(() => {
    service = new FormFillValidatorService();
  });

  it('validates supported actions and adds implicit skips for omitted fields', () => {
    const result = service.validate(
      [
        {
          fieldName: 'profile.full_name',
          action: 'SET_TEXT',
          value: 'Alex Rivera',
          sourceSlugs: ['profile.full_name'],
          confidence: 0.95,
        },
      ],
      fields,
      new Set(['profile.full_name']),
      0.75,
    );

    expect(result.validActions).toEqual([
      expect.objectContaining({
        fieldName: 'profile.full_name',
        action: 'SET_TEXT',
        value: 'Alex Rivera',
      }),
    ]);
    expect(result.skippedFields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          pdfFieldName: 'newsletter_opt_in',
          reason: 'not returned by AI',
        }),
        expect.objectContaining({
          pdfFieldName: 'food.spice_tolerance',
          reason: 'not returned by AI',
        }),
        expect.objectContaining({
          pdfFieldName: 'signature',
          reason: 'not returned by AI',
        }),
      ]),
    );
    expect(result.filledFields).toHaveLength(1);
    expect(result.filledFields.length + result.skippedFields.length).toBe(
      fields.length,
    );
  });

  it('skips invalid actions without blocking valid actions', () => {
    const actions: AiFillAction[] = [
      {
        fieldName: 'profile.full_name',
        action: 'SET_TEXT',
        value: 'Alex Rivera',
        sourceSlugs: ['profile.full_name'],
        confidence: 0.95,
      },
      {
        fieldName: 'newsletter_opt_in',
        action: 'SET_TEXT',
        value: 'yes',
        sourceSlugs: ['profile.full_name'],
        confidence: 0.95,
      },
      {
        fieldName: 'food.spice_tolerance',
        action: 'SELECT_OPTION',
        value: 'extra_hot',
        sourceSlugs: ['food.spice_tolerance'],
        confidence: 0.95,
      },
      {
        fieldName: 'unknown_field',
        action: 'SET_TEXT',
        value: 'Ignored',
        sourceSlugs: ['profile.full_name'],
        confidence: 0.95,
      },
    ];

    const result = service.validate(
      actions,
      fields,
      new Set(['profile.full_name', 'food.spice_tolerance']),
      0.75,
    );

    expect(result.validActions).toEqual([
      expect.objectContaining({ fieldName: 'profile.full_name' }),
    ]);
    expect(result.skippedFields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          pdfFieldName: 'newsletter_opt_in',
          reason: 'action SET_TEXT is not compatible with checkbox fields',
        }),
        expect.objectContaining({
          pdfFieldName: 'food.spice_tolerance',
          reason: 'selected option "extra_hot" is not available',
        }),
        expect.objectContaining({
          pdfFieldName: 'signature',
          reason: 'not returned by AI',
        }),
      ]),
    );
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        'AI returned unknown field "unknown_field"; ignoring action',
      ]),
    );
  });

  it('uses explicit SKIP reasons and ignores checkbox values', () => {
    const result = service.validate(
      [
        {
          fieldName: 'profile.full_name',
          action: 'SKIP',
          sourceSlugs: [],
          confidence: 0.7,
          skipReason: 'missing memory',
        },
        {
          fieldName: 'newsletter_opt_in',
          action: 'UNCHECK',
          value: 'ignored',
          sourceSlugs: ['communication.preferred_channels'],
          confidence: 0.95,
        },
      ],
      fields,
      new Set(['communication.preferred_channels']),
      0.75,
    );

    expect(result.validActions).toEqual([
      expect.objectContaining({
        fieldName: 'newsletter_opt_in',
        action: 'UNCHECK',
        value: 'ignored',
      }),
    ]);
    expect(result.skippedFields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          pdfFieldName: 'profile.full_name',
          reason: 'missing memory',
        }),
      ]),
    );
    expect(result.filledFields.length + result.skippedFields.length).toBe(
      fields.length,
    );
  });

  it('skips actions with missing values or unknown slugs and records low confidence', () => {
    const result = service.validate(
      [
        {
          fieldName: 'profile.full_name',
          action: 'SET_TEXT',
          sourceSlugs: ['profile.full_name'],
          confidence: 0.95,
        },
        {
          fieldName: 'newsletter_opt_in',
          action: 'CHECK',
          sourceSlugs: ['unknown.slug'],
          confidence: 0.95,
        },
        {
          fieldName: 'food.spice_tolerance',
          action: 'SELECT_OPTION',
          value: 'medium',
          sourceSlugs: ['food.spice_tolerance'],
          confidence: 0.4,
        },
        {
          fieldName: 'signature',
          action: 'SET_TEXT',
          value: 'Alex',
          sourceSlugs: ['profile.full_name'],
          confidence: 0.99,
        },
      ],
      fields,
      new Set(['profile.full_name', 'food.spice_tolerance']),
      0.75,
    );

    expect(result.validActions).toEqual([
      expect.objectContaining({
        fieldName: 'food.spice_tolerance',
        action: 'SELECT_OPTION',
      }),
    ]);
    expect(result.skippedFields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          pdfFieldName: 'profile.full_name',
          reason: 'missing value',
        }),
        expect.objectContaining({
          pdfFieldName: 'newsletter_opt_in',
          reason: 'source slug "unknown.slug" is not an active preference',
        }),
        expect.objectContaining({
          pdfFieldName: 'signature',
          reason: 'signature fields are not supported',
        }),
      ]),
    );
    expect(result.validationEvents).toEqual([
      expect.objectContaining({
        kind: 'low_confidence_applied',
        fieldName: 'food.spice_tolerance',
        confidence: 0.4,
      }),
    ]);
  });

  it('skips non-SKIP actions missing source slugs or confidence from permissive AI parsing', () => {
    const result = service.validate(
      [
        {
          fieldName: 'profile.full_name',
          action: 'SET_TEXT',
          value: 'Alex Rivera',
          sourceSlugs: [],
          confidence: 0.95,
        },
        {
          fieldName: 'newsletter_opt_in',
          action: 'CHECK',
          sourceSlugs: ['communication.preferred_channels'],
        } as AiFillAction,
        {
          fieldName: 'food.spice_tolerance',
          action: 'SKIP',
          sourceSlugs: [],
          skipReason: 'missing memory',
        } as AiFillAction,
      ],
      fields,
      new Set(['communication.preferred_channels']),
      0.75,
    );

    expect(result.validActions).toEqual([]);
    expect(result.skippedFields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          pdfFieldName: 'profile.full_name',
          reason: 'missing source slug',
        }),
        expect.objectContaining({
          pdfFieldName: 'newsletter_opt_in',
          reason: 'missing confidence',
        }),
        expect.objectContaining({
          pdfFieldName: 'food.spice_tolerance',
          reason: 'missing memory',
        }),
      ]),
    );
    expect(result.filledFields.length + result.skippedFields.length).toBe(
      fields.length,
    );
  });

  it('applies source-backed low-confidence actions and records a validation event', () => {
    const result = service.validate(
      [
        {
          fieldName: 'profile.full_name',
          action: 'SET_TEXT',
          value: 'Alex Rivera',
          sourceSlugs: ['profile.full_name'],
          confidence: 0.4,
        },
      ],
      fields,
      new Set(['profile.full_name']),
      0.75,
    );

    expect(result.validActions).toEqual([
      expect.objectContaining({
        fieldName: 'profile.full_name',
        action: 'SET_TEXT',
      }),
    ]);
    expect(result.validationEvents).toEqual([
      expect.objectContaining({
        kind: 'low_confidence_applied',
        fieldName: 'profile.full_name',
        confidence: 0.4,
      }),
    ]);
  });

  it('skips text actions that exceed the PDF field max length', () => {
    const result = service.validate(
      [
        {
          fieldName: 'profile.full_name',
          action: 'SET_TEXT',
          value: 'Alex Rivera',
          sourceSlugs: ['profile.full_name'],
          confidence: 0.95,
        },
        {
          fieldName: 'ZIP Code',
          action: 'SET_TEXT',
          value: 'Address collection pending task completion',
          sourceSlugs: ['eval.address.current.postal_code'],
          confidence: 0.95,
        },
      ],
      [
        ...fields,
        {
          name: 'ZIP Code',
          type: 'text',
          options: [],
          supported: true,
          maxLength: 6,
        },
      ],
      new Set(['profile.full_name', 'eval.address.current.postal_code']),
      0.75,
    );

    expect(result.validActions).toEqual([
      expect.objectContaining({ fieldName: 'profile.full_name' }),
    ]);
    expect(result.skippedFields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          pdfFieldName: 'ZIP Code',
          reason: 'text length 42 exceeds PDF field maxLength 6',
        }),
      ]),
    );
    expect(result.validationEvents).toEqual([
      expect.objectContaining({
        kind: 'pdf_text_max_length_blocked',
        fieldName: 'ZIP Code',
        valueLength: 42,
        maxLength: 6,
      }),
    ]);
  });

  it('checks PDF text max length after applying built-in text normalization', () => {
    const result = service.validate(
      [
        {
          fieldName: 'US Social Security Number',
          action: 'SET_TEXT',
          value: '000-00-0292',
          sourceSlugs: ['eval.identity.ssn'],
          confidence: 0.95,
        },
      ],
      [
        {
          name: 'US Social Security Number',
          type: 'text',
          options: [],
          supported: true,
          maxLength: 9,
        },
      ],
      new Set(['eval.identity.ssn']),
      0.75,
    );

    expect(result.validActions).toEqual([
      expect.objectContaining({
        fieldName: 'US Social Security Number',
        action: 'SET_TEXT',
      }),
    ]);
    expect(result.skippedFields).toEqual([]);
    expect(result.validationEvents).toEqual([]);
  });

  it('blocks structural-skip policy fields even when the AI returns a fill action', () => {
    const result = service.validate(
      [
        {
          fieldName: 'profile.full_name',
          action: 'SET_TEXT',
          value: 'Alex Rivera',
          sourceSlugs: ['profile.full_name'],
          confidence: 0.95,
        },
      ],
      fields,
      new Set(['profile.full_name']),
      0.75,
      {
        fieldPolicies: {
          schemaVersion: 1,
          fields: [
            {
              fieldName: 'profile.full_name',
              mode: 'skip',
              sourceSlugs: [],
              reason: 'manual_attestation',
            },
          ],
        },
      },
    );

    expect(result.validActions).toEqual([]);
    expect(result.skippedFields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          pdfFieldName: 'profile.full_name',
          reason: 'field policy skip: manual_attestation',
        }),
      ]),
    );
    expect(result.validationEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'policy_structural_skip_blocked',
          fieldName: 'profile.full_name',
        }),
      ]),
    );
  });

  it('blocks inactive conditional policy fields using active preference values', () => {
    const result = service.validate(
      [
        {
          fieldName: 'newsletter_opt_in',
          action: 'CHECK',
          sourceSlugs: ['profile.citizenship_status'],
          confidence: 0.95,
        },
      ],
      fields,
      new Set(['profile.citizenship_status']),
      0.75,
      {
        activePreferenceValues: new Map<string, unknown>([
          ['profile.citizenship_status', 'alien authorized to work'],
        ]),
        fieldPolicies: {
          schemaVersion: 1,
          fields: [
            {
              fieldName: 'newsletter_opt_in',
              mode: 'fact',
              factKey: 'workAuthorization.citizenshipStatus',
              sourceSlugs: ['profile.citizenship_status'],
              when: {
                factKey: 'workAuthorization.citizenshipStatus',
                sourceSlugs: ['profile.citizenship_status'],
                equals: 'lawful permanent resident',
              },
            },
          ],
        },
      },
    );

    expect(result.validActions).toEqual([]);
    expect(result.skippedFields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          pdfFieldName: 'newsletter_opt_in',
          reason: 'field policy inactive: workAuthorization.citizenshipStatus',
        }),
      ]),
    );
    expect(result.validationEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'policy_inactive_blocked',
          fieldName: 'newsletter_opt_in',
        }),
      ]),
    );
  });

  it('matches non-string active preference values for conditional policies', () => {
    const result = service.validate(
      [
        {
          fieldName: 'newsletter_opt_in',
          action: 'CHECK',
          sourceSlugs: ['preferences.newsletter_opt_in'],
          confidence: 0.95,
        },
        {
          fieldName: 'profile.full_name',
          action: 'SET_TEXT',
          value: '1',
          sourceSlugs: ['preferences.household_size'],
          confidence: 0.95,
        },
      ],
      fields,
      new Set(['preferences.newsletter_opt_in', 'preferences.household_size']),
      0.75,
      {
        activePreferenceValues: new Map<string, unknown>([
          ['preferences.newsletter_opt_in', true],
          ['preferences.household_size', 1],
        ]),
        fieldPolicies: {
          schemaVersion: 1,
          fields: [
            {
              fieldName: 'newsletter_opt_in',
              mode: 'fact',
              factKey: 'preferences.newsletterOptIn',
              sourceSlugs: ['preferences.newsletter_opt_in'],
              when: {
                factKey: 'preferences.newsletterOptIn',
                sourceSlugs: ['preferences.newsletter_opt_in'],
                equals: 'true',
              },
            },
            {
              fieldName: 'profile.full_name',
              mode: 'fact',
              factKey: 'preferences.householdSize',
              sourceSlugs: ['preferences.household_size'],
              when: {
                factKey: 'preferences.householdSize',
                sourceSlugs: ['preferences.household_size'],
                equals: '1',
              },
            },
          ],
        },
      },
    );

    expect(result.validActions).toEqual([
      expect.objectContaining({ fieldName: 'profile.full_name' }),
      expect.objectContaining({ fieldName: 'newsletter_opt_in' }),
    ]);
    expect(result.validationEvents).toEqual([]);
  });

  it('activates conditional policies from resolved canonical facts', () => {
    const result = service.validate(
      [
        {
          fieldName: 'newsletter_opt_in',
          action: 'CHECK',
          sourceSlugs: ['work_auth.citizenship_status'],
          confidence: 0.95,
        },
      ],
      fields,
      new Set(['work_auth.citizenship_status']),
      0.75,
      {
        activePreferenceValues: new Map<string, unknown>([
          ['work_auth.citizenship_status', 'alien authorized to work'],
        ]),
        resolvedFacts: [
          {
            factKey: 'workAuthorization.citizenshipStatus',
            value: 'alien authorized to work',
            sourceSlugs: ['work_auth.citizenship_status'],
            resolutionKind: 'alias',
          },
        ],
        fieldPolicies: {
          schemaVersion: 1,
          fields: [
            {
              fieldName: 'newsletter_opt_in',
              mode: 'fact',
              factKey: 'workAuthorization.citizenshipStatus',
              sourceSlugs: ['work_authorization.citizenship_status'],
              when: {
                factKey: 'workAuthorization.citizenshipStatus',
                sourceSlugs: ['work_authorization.citizenship_status'],
                equals: [
                  'alien authorized to work',
                  'noncitizen authorized to work',
                ],
              },
            },
          ],
        },
      },
    );

    expect(result.validActions).toEqual([
      expect.objectContaining({ fieldName: 'newsletter_opt_in' }),
    ]);
    expect(result.validationEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'policy_condition_resolved',
          fieldName: 'newsletter_opt_in',
          factKey: 'workAuthorization.citizenshipStatus',
          sourceSlug: 'work_auth.citizenship_status',
        }),
        expect.objectContaining({
          kind: 'policy_source_slug_resolved',
          fieldName: 'newsletter_opt_in',
          factKey: 'workAuthorization.citizenshipStatus',
          sourceSlug: 'work_auth.citizenship_status',
        }),
      ]),
    );
  });

  it('activates conditional policies from normalized active values when listed source slugs are absent', () => {
    const workAuthorizationFields: PdfFieldMetadata[] = [
      {
        name: 'CB_4',
        type: 'checkbox',
        options: [],
        supported: true,
      },
      {
        name: 'USCIS ANumber',
        type: 'text',
        options: [],
        supported: true,
      },
    ];

    const result = service.validate(
      [
        {
          fieldName: 'CB_4',
          action: 'CHECK',
          sourceSlugs: ['profile.citizenship_immigration_status'],
          confidence: 0.95,
        },
        {
          fieldName: 'USCIS ANumber',
          action: 'SET_TEXT',
          value: '987654321',
          sourceSlugs: ['profile.uscis_number'],
          confidence: 0.95,
        },
      ],
      workAuthorizationFields,
      new Set([
        'profile.citizenship_immigration_status',
        'profile.uscis_number',
      ]),
      0.75,
      {
        activePreferenceValues: new Map<string, unknown>([
          [
            'profile.citizenship_immigration_status',
            'An alien authorized to work',
          ],
          ['profile.uscis_number', '987654321'],
        ]),
        fieldPolicies: {
          schemaVersion: 1,
          fields: [
            {
              fieldName: 'CB_4',
              mode: 'fact',
              factKey: 'workAuthorization.citizenshipStatus',
              sourceSlugs: ['work_auth.citizenship_status'],
              when: {
                factKey: 'workAuthorization.citizenshipStatus',
                sourceSlugs: ['work_auth.citizenship_status'],
                equals: 'alien authorized to work',
              },
            },
            {
              fieldName: 'USCIS ANumber',
              mode: 'fact',
              factKey: 'workAuthorization.uscisANumber',
              sourceSlugs: ['work_auth.uscis_number'],
              when: {
                factKey: 'workAuthorization.citizenshipStatus',
                sourceSlugs: ['work_auth.citizenship_status'],
                equals: 'alien authorized to work',
              },
            },
          ],
        },
      },
    );

    expect(result.validActions).toEqual([
      expect.objectContaining({ fieldName: 'CB_4', action: 'CHECK' }),
      expect.objectContaining({
        fieldName: 'USCIS ANumber',
        action: 'SET_TEXT',
      }),
    ]);
    expect(result.validationEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'policy_condition_active_value_matched',
          fieldName: 'CB_4',
          factKey: 'workAuthorization.citizenshipStatus',
          sourceSlug: 'profile.citizenship_immigration_status',
        }),
        expect.objectContaining({
          kind: 'policy_condition_active_value_matched',
          fieldName: 'USCIS ANumber',
          factKey: 'workAuthorization.citizenshipStatus',
          sourceSlug: 'profile.citizenship_immigration_status',
        }),
      ]),
    );
  });

  it('does not activate active-value condition fallback when no active value matches', () => {
    const result = service.validate(
      [
        {
          fieldName: 'newsletter_opt_in',
          action: 'CHECK',
          sourceSlugs: ['profile.newsletter_opt_in'],
          confidence: 0.95,
        },
      ],
      fields,
      new Set(['profile.newsletter_opt_in', 'profile.citizenship_status']),
      0.75,
      {
        activePreferenceValues: new Map<string, unknown>([
          ['profile.newsletter_opt_in', true],
          ['profile.citizenship_status', 'lawful permanent resident'],
        ]),
        fieldPolicies: {
          schemaVersion: 1,
          fields: [
            {
              fieldName: 'newsletter_opt_in',
              mode: 'fact',
              factKey: 'preferences.newsletterOptIn',
              sourceSlugs: ['profile.newsletter_opt_in'],
              when: {
                factKey: 'preferences.newsletterOptIn',
                sourceSlugs: [],
                equals: 'alien authorized to work',
              },
            },
          ],
        },
      },
    );

    expect(result.validActions).toEqual([]);
    expect(result.skippedFields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          pdfFieldName: 'newsletter_opt_in',
          reason: 'field policy inactive: preferences.newsletterOptIn',
        }),
      ]),
    );
    expect(result.validationEvents).toEqual(
      expect.not.arrayContaining([
        expect.objectContaining({
          kind: 'policy_condition_active_value_matched',
        }),
      ]),
    );
  });

  it('fails conditional policies closed when a resolved canonical fact conflicts', () => {
    const result = service.validate(
      [
        {
          fieldName: 'newsletter_opt_in',
          action: 'CHECK',
          sourceSlugs: ['work_auth.citizenship_status'],
          confidence: 0.95,
        },
      ],
      fields,
      new Set(['work_auth.citizenship_status']),
      0.75,
      {
        activePreferenceValues: new Map<string, unknown>([
          ['work_auth.citizenship_status', 'alien authorized to work'],
        ]),
        resolvedFacts: [],
        resolutionConflicts: [
          {
            factKey: 'workAuthorization.citizenshipStatus',
            sourceSlugs: [
              'work_auth.citizenship_status',
              'work_authorization.citizenship_status',
            ],
            values: ['alien authorized to work', 'lawful permanent resident'],
          },
        ],
        fieldPolicies: {
          schemaVersion: 1,
          fields: [
            {
              fieldName: 'newsletter_opt_in',
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
        },
      },
    );

    expect(result.validActions).toEqual([]);
    expect(result.skippedFields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          pdfFieldName: 'newsletter_opt_in',
          reason: 'field policy inactive: workAuthorization.citizenshipStatus',
        }),
      ]),
    );
    expect(result.validationEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'policy_condition_conflict_blocked',
          fieldName: 'newsletter_opt_in',
          factKey: 'workAuthorization.citizenshipStatus',
        }),
        expect.objectContaining({
          kind: 'policy_inactive_blocked',
          fieldName: 'newsletter_opt_in',
        }),
      ]),
    );
  });

  it('allows derived source slugs for the resolved field policy fact', () => {
    const result = service.validate(
      [
        {
          fieldName: 'profile.full_name',
          action: 'SET_TEXT',
          value: 'J',
          sourceSlugs: ['profile.middle_name'],
          confidence: 0.95,
        },
      ],
      fields,
      new Set(['profile.middle_name']),
      0.75,
      {
        activePreferenceValues: new Map<string, unknown>([
          ['profile.middle_name', 'Jordan'],
        ]),
        resolvedFacts: [
          {
            factKey: 'identity.middleInitial',
            value: 'J',
            sourceSlugs: ['profile.middle_name'],
            resolutionKind: 'derived',
            derivedFromFactKey: 'identity.middleName',
          },
        ],
        fieldPolicies: {
          schemaVersion: 1,
          fields: [
            {
              fieldName: 'profile.full_name',
              mode: 'fact',
              factKey: 'identity.middleInitial',
              sourceSlugs: ['eval.identity.middle_initial'],
            },
          ],
        },
      },
    );

    expect(result.validActions).toEqual([
      expect.objectContaining({
        fieldName: 'profile.full_name',
        action: 'SET_TEXT',
      }),
    ]);
    expect(result.validationEvents).toEqual([
      expect.objectContaining({
        kind: 'policy_source_slug_resolved',
        fieldName: 'profile.full_name',
        factKey: 'identity.middleInitial',
        sourceSlug: 'profile.middle_name',
        resolutionKind: 'derived',
      }),
    ]);
  });

  it('accepts applied active slugs outside field policy slugs without recording an off-policy warning', () => {
    const result = service.validate(
      [
        {
          fieldName: 'profile.full_name',
          action: 'SET_TEXT',
          value: 'Alex Rivera',
          sourceSlugs: ['profile.legal_name'],
          confidence: 0.95,
        },
      ],
      fields,
      new Set(['profile.legal_name']),
      0.75,
      {
        fieldPolicies: {
          schemaVersion: 1,
          fields: [
            {
              fieldName: 'profile.full_name',
              mode: 'fact',
              factKey: 'identity.legalName',
              sourceSlugs: ['profile.full_name'],
            },
          ],
        },
      },
    );

    expect(result.validActions).toEqual([
      expect.objectContaining({
        fieldName: 'profile.full_name',
        action: 'SET_TEXT',
      }),
    ]);
    expect(result.validationEvents).toEqual([]);
  });

  it('keeps the highest-confidence checkbox action in a policy group', () => {
    const checkboxFields: PdfFieldMetadata[] = [
      {
        name: 'CB_1',
        type: 'checkbox',
        options: [],
        supported: true,
      },
      {
        name: 'CB_4',
        type: 'checkbox',
        options: [],
        supported: true,
      },
    ];

    const result = service.validate(
      [
        {
          fieldName: 'CB_1',
          action: 'CHECK',
          sourceSlugs: ['profile.citizenship_status'],
          confidence: 0.8,
        },
        {
          fieldName: 'CB_4',
          action: 'CHECK',
          sourceSlugs: ['profile.citizenship_status'],
          confidence: 0.95,
        },
      ],
      checkboxFields,
      new Set(['profile.citizenship_status']),
      0.75,
      {
        fieldPolicies: {
          schemaVersion: 1,
          fields: [
            {
              fieldName: 'CB_1',
              mode: 'fact',
              factKey: 'workAuthorization.citizenshipStatus',
              sourceSlugs: ['profile.citizenship_status'],
              groupId: 'workAuthorization.citizenshipStatus',
            },
            {
              fieldName: 'CB_4',
              mode: 'fact',
              factKey: 'workAuthorization.citizenshipStatus',
              sourceSlugs: ['profile.citizenship_status'],
              groupId: 'workAuthorization.citizenshipStatus',
            },
          ],
        },
      },
    );

    expect(result.validActions).toEqual([
      expect.objectContaining({ fieldName: 'CB_4', action: 'CHECK' }),
    ]);
    expect(result.skippedFields).toEqual([
      expect.objectContaining({
        pdfFieldName: 'CB_1',
        reason: 'checkbox group conflict: workAuthorization.citizenshipStatus',
      }),
    ]);
    expect(result.validationEvents).toEqual([
      expect.objectContaining({
        kind: 'checkbox_group_conflict',
        fieldName: 'CB_1',
        groupId: 'workAuthorization.citizenshipStatus',
      }),
    ]);
  });

  it('does not report low-confidence applied for checkbox actions blocked by group conflict', () => {
    const checkboxFields: PdfFieldMetadata[] = [
      {
        name: 'CB_1',
        type: 'checkbox',
        options: [],
        supported: true,
      },
      {
        name: 'CB_4',
        type: 'checkbox',
        options: [],
        supported: true,
      },
    ];

    const result = service.validate(
      [
        {
          fieldName: 'CB_1',
          action: 'CHECK',
          sourceSlugs: ['profile.citizenship_status'],
          confidence: 0.4,
        },
        {
          fieldName: 'CB_4',
          action: 'CHECK',
          sourceSlugs: ['profile.citizenship_status'],
          confidence: 0.95,
        },
      ],
      checkboxFields,
      new Set(['profile.citizenship_status']),
      0.75,
      {
        fieldPolicies: {
          schemaVersion: 1,
          fields: [
            {
              fieldName: 'CB_1',
              mode: 'fact',
              factKey: 'workAuthorization.citizenshipStatus',
              sourceSlugs: ['profile.citizenship_status'],
              groupId: 'workAuthorization.citizenshipStatus',
            },
            {
              fieldName: 'CB_4',
              mode: 'fact',
              factKey: 'workAuthorization.citizenshipStatus',
              sourceSlugs: ['profile.citizenship_status'],
              groupId: 'workAuthorization.citizenshipStatus',
            },
          ],
        },
      },
    );

    expect(result.validActions).toEqual([
      expect.objectContaining({ fieldName: 'CB_4', action: 'CHECK' }),
    ]);
    expect(result.validationEvents).toEqual([
      expect.objectContaining({
        kind: 'checkbox_group_conflict',
        fieldName: 'CB_1',
      }),
    ]);
  });

  it('does not report off-policy slugs for checkbox actions blocked by group conflict', () => {
    const checkboxFields: PdfFieldMetadata[] = [
      {
        name: 'CB_1',
        type: 'checkbox',
        options: [],
        supported: true,
      },
      {
        name: 'CB_4',
        type: 'checkbox',
        options: [],
        supported: true,
      },
    ];

    const result = service.validate(
      [
        {
          fieldName: 'CB_1',
          action: 'CHECK',
          sourceSlugs: ['profile.unexpected_status'],
          confidence: 0.8,
        },
        {
          fieldName: 'CB_4',
          action: 'CHECK',
          sourceSlugs: ['profile.citizenship_status'],
          confidence: 0.95,
        },
      ],
      checkboxFields,
      new Set(['profile.citizenship_status', 'profile.unexpected_status']),
      0.75,
      {
        fieldPolicies: {
          schemaVersion: 1,
          fields: [
            {
              fieldName: 'CB_1',
              mode: 'fact',
              factKey: 'workAuthorization.citizenshipStatus',
              sourceSlugs: ['profile.citizenship_status'],
              groupId: 'workAuthorization.citizenshipStatus',
            },
            {
              fieldName: 'CB_4',
              mode: 'fact',
              factKey: 'workAuthorization.citizenshipStatus',
              sourceSlugs: ['profile.citizenship_status'],
              groupId: 'workAuthorization.citizenshipStatus',
            },
          ],
        },
      },
    );

    expect(result.validActions).toEqual([
      expect.objectContaining({ fieldName: 'CB_4', action: 'CHECK' }),
    ]);
    expect(result.validationEvents).toEqual([
      expect.objectContaining({
        kind: 'checkbox_group_conflict',
        fieldName: 'CB_1',
      }),
    ]);
  });
});
