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
    expect(prompt).toContain('treat them as authoritative');
    expect(prompt).toContain(
      "use only active memories whose slug is listed in that field policy's sourceSlugs",
    );
    expect(prompt).toContain('return SKIP for that field');
    expect(prompt).toContain('Do not substitute semantically similar memories');
    expect(prompt).toContain(
      'do not swap one email, address, name, identifier, status, date, or phone number for another',
    );
    expect(prompt).toContain('"fieldName": "CB_4"');
    expect(prompt).toContain('"groupId": "workAuthorization.citizenshipStatus"');
  });
});
