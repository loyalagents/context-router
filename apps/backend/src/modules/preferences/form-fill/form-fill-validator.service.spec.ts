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

  it('skips actions with missing values, unknown slugs, or low confidence', () => {
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

    expect(result.validActions).toEqual([]);
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
          pdfFieldName: 'food.spice_tolerance',
          reason: 'confidence below threshold',
        }),
        expect.objectContaining({
          pdfFieldName: 'signature',
          reason: 'signature fields are not supported',
        }),
      ]),
    );
  });
});
