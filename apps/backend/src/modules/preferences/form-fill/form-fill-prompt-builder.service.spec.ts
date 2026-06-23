import { FormFillPromptBuilderService } from './form-fill-prompt-builder.service';
import { PdfFieldMetadata } from './form-fill.types';

describe('FormFillPromptBuilderService', () => {
  let service: FormFillPromptBuilderService;

  beforeEach(() => {
    service = new FormFillPromptBuilderService();
  });

  it('builds a prompt with exact field names, options, active preferences, and per-field instructions', () => {
    const fields: PdfFieldMetadata[] = [
      {
        name: 'profile.full_name',
        type: 'text',
        options: [],
        supported: true,
        maxLength: 12,
      },
      {
        name: 'food.spice_tolerance',
        type: 'dropdown',
        options: [
          { label: 'Mild', value: 'mild' },
          { label: 'Medium', value: 'medium' },
        ],
        supported: true,
      },
    ];

    const prompt = service.buildPrompt(fields, [
      {
        slug: 'profile.full_name',
        value: 'Alex Rivera',
        description: 'The user full name.',
      },
      {
        slug: 'food.spice_tolerance',
        value: 'medium',
        description: 'How much spice the user prefers.',
      },
    ]);

    expect(prompt).toContain('Return exactly one fill action for every PDF field');
    expect(prompt).toContain('Use exact case-sensitive fieldName values');
    expect(prompt).toContain('final text length is at or below maxLength');
    expect(prompt).toContain('"name": "profile.full_name"');
    expect(prompt).toContain('"maxLength": 12');
    expect(prompt).toContain('"value": "medium"');
    expect(prompt).toContain('"slug": "food.spice_tolerance"');
    expect(prompt).toContain('"value": "Alex Rivera"');
  });

  it('includes optional field policies when provided', () => {
    const fields: PdfFieldMetadata[] = [
      {
        name: 'CB_4',
        type: 'checkbox',
        options: [],
        supported: true,
      },
    ];

    const prompt = service.buildPrompt(
      fields,
      [
        {
          slug: 'profile.citizenship_status',
          value: 'alien authorized to work',
        },
      ],
      {
        schemaVersion: 1,
        fields: [
          {
            fieldName: 'CB_4',
            mode: 'fact',
            factKey: 'workAuthorization.citizenshipStatus',
            sourceSlugs: ['profile.citizenship_status'],
            groupId: 'workAuthorization.citizenshipStatus',
          },
        ],
      },
    );

    expect(prompt).toContain('Field policies');
    expect(prompt).toContain('field intent and skip rules');
    expect(prompt).toContain(
      'sourceSlugs are hints/examples/aliases and are not exhaustive',
    );
    expect(prompt).toContain(
      'You may use any active memory whose value supports the target field',
    );
    expect(prompt).toContain('including multiple active memories');
    expect(prompt).toContain('raw active memories actually used');
    expect(prompt).toContain('prefer its sourceSlugs exactly');
    expect(prompt).toContain('personal/contact email');
    expect(prompt).toContain('Do not use employer-issued work email');
    expect(prompt).toContain('Do not fill mode=skip fields');
    expect(prompt).toContain('render dates as MMDDYYYY');
    expect(prompt).toContain('combine street plus unit/apartment');
    expect(prompt).toContain('render as City, ST ZIP');
    expect(prompt).toContain('return SKIP for that field');
    expect(prompt).not.toContain('use only active memories whose slug is listed');
    expect(prompt).not.toContain('Do not substitute semantically similar memories');
    expect(prompt).toContain('"fieldName": "CB_4"');
    expect(prompt).toContain('"groupId": "workAuthorization.citizenshipStatus"');
  });

  it('includes resolved form facts when provided', () => {
    const fields: PdfFieldMetadata[] = [
      {
        name: 'Employee Middle Initial (if any)',
        type: 'text',
        options: [],
        supported: true,
      },
    ];

    const prompt = service.buildPrompt(
      fields,
      [
        {
          slug: 'profile.middle_name',
          value: 'Jordan',
        },
      ],
      {
        schemaVersion: 1,
        fields: [
          {
            fieldName: 'Employee Middle Initial (if any)',
            mode: 'fact',
            factKey: 'identity.middleInitial',
            sourceSlugs: ['eval.identity.middle_initial'],
          },
        ],
      },
      [
        {
          factKey: 'identity.middleInitial',
          value: 'J',
          sourceSlugs: ['profile.middle_name'],
          resolutionKind: 'derived',
          derivedFromFactKey: 'identity.middleName',
        },
      ],
    );

    expect(prompt).toContain('Resolved form facts');
    expect(prompt).toContain('"factKey": "identity.middleInitial"');
    expect(prompt).toContain('"value": "J"');
    expect(prompt).toContain('"sourceSlugs": [');
    expect(prompt).toContain('"profile.middle_name"');
    expect(prompt).toContain('"resolutionKind": "derived"');
    expect(prompt).toContain('"derivedFromFactKey": "identity.middleName"');
  });
});
