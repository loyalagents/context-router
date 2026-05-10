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
    expect(prompt).toContain('"name": "profile.full_name"');
    expect(prompt).toContain('"value": "medium"');
    expect(prompt).toContain('"slug": "food.spice_tolerance"');
    expect(prompt).toContain('"value": "Alex Rivera"');
  });
});
