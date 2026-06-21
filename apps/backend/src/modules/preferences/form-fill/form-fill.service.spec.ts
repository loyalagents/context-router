import { FormFillService } from './form-fill.service';

describe('FormFillService', () => {
  let service: FormFillService;
  let aiStructuredService: { generateStructured: jest.Mock };
  let preferenceService: { getActivePreferences: jest.Mock };
  let fieldExtractor: { extractFields: jest.Mock };
  let promptBuilder: { buildPrompt: jest.Mock };
  let validator: { validate: jest.Mock };
  let pdfFiller: { fillPdf: jest.Mock };

  beforeEach(() => {
    aiStructuredService = {
      generateStructured: jest.fn(),
    };
    preferenceService = {
      getActivePreferences: jest.fn(),
    };
    fieldExtractor = {
      extractFields: jest.fn(),
    };
    promptBuilder = {
      buildPrompt: jest.fn(),
    };
    validator = {
      validate: jest.fn(),
    };
    pdfFiller = {
      fillPdf: jest.fn(),
    };

    service = new FormFillService(
      aiStructuredService as any,
      preferenceService as any,
      fieldExtractor as any,
      promptBuilder as any,
      validator as any,
      pdfFiller as any,
    );
  });

  it('returns success with a non-null filled PDF artifact', async () => {
    const pdfBytes = Buffer.from('filled pdf');
    fieldExtractor.extractFields.mockResolvedValue({
      hasXfa: false,
      fields: [
        {
          name: 'profile.full_name',
          type: 'text',
          options: [],
          supported: true,
        },
      ],
    });
    preferenceService.getActivePreferences.mockResolvedValue([
      {
        slug: 'profile.full_name',
        value: 'Alex Rivera',
        description: 'Full name',
      },
    ]);
    promptBuilder.buildPrompt.mockReturnValue('prompt');
    aiStructuredService.generateStructured.mockResolvedValue({
      fillActions: [
        {
          fieldName: 'profile.full_name',
          action: 'SET_TEXT',
          value: 'Alex Rivera',
          sourceSlugs: ['profile.full_name'],
          confidence: 0.95,
        },
      ],
    });
    validator.validate.mockReturnValue({
      validActions: [
        {
          fieldName: 'profile.full_name',
          fieldType: 'text',
          action: 'SET_TEXT',
          value: 'Alex Rivera',
          sourceSlugs: ['profile.full_name'],
          confidence: 0.95,
        },
      ],
      filledFields: [
        {
          pdfFieldName: 'profile.full_name',
          fieldType: 'text',
          sourceSlugs: ['profile.full_name'],
          confidence: 0.95,
        },
      ],
      skippedFields: [],
      warnings: [],
    });
    pdfFiller.fillPdf.mockResolvedValue(pdfBytes);

    const result = await service.fillPdfForm(
      'user-1',
      Buffer.from('input pdf'),
      'registration.pdf',
    );

    expect(result).toMatchObject({
      status: 'success',
      originalFilename: 'registration.pdf',
      outputFilename: 'filled-registration.pdf',
      filledPdfBase64: pdfBytes.toString('base64'),
      summary: {
        totalFields: 1,
        filledCount: 1,
        skippedCount: 0,
      },
    });
    expect(aiStructuredService.generateStructured).toHaveBeenCalledTimes(1);
    expect(pdfFiller.fillPdf).toHaveBeenCalledTimes(1);
  });

  it('passes field policies through prompt and validation and returns validation events', async () => {
    const pdfBytes = Buffer.from('filled pdf');
    const fieldPolicies = {
      schemaVersion: 1 as const,
      fields: [
        {
          fieldName: 'CB_4',
          mode: 'fact' as const,
          factKey: 'workAuthorization.citizenshipStatus',
          sourceSlugs: ['profile.citizenship_status'],
          groupId: 'workAuthorization.citizenshipStatus',
        },
      ],
    };
    fieldExtractor.extractFields.mockResolvedValue({
      hasXfa: false,
      fields: [
        {
          name: 'CB_4',
          type: 'checkbox',
          options: [],
          supported: true,
        },
      ],
    });
    preferenceService.getActivePreferences.mockResolvedValue([
      {
        slug: 'profile.citizenship_status',
        value: 'alien authorized to work',
        description: 'Citizenship status',
      },
    ]);
    promptBuilder.buildPrompt.mockReturnValue('prompt');
    aiStructuredService.generateStructured.mockResolvedValue({
      fillActions: [
        {
          fieldName: 'CB_4',
          action: 'CHECK',
          sourceSlugs: ['profile.citizenship_status'],
          confidence: 0.4,
        },
      ],
    });
    validator.validate.mockReturnValue({
      validActions: [
        {
          fieldName: 'CB_4',
          fieldType: 'checkbox',
          action: 'CHECK',
          sourceSlugs: ['profile.citizenship_status'],
          confidence: 0.4,
        },
      ],
      filledFields: [
        {
          pdfFieldName: 'CB_4',
          fieldType: 'checkbox',
          sourceSlugs: ['profile.citizenship_status'],
          confidence: 0.4,
        },
      ],
      skippedFields: [],
      warnings: [],
      validationEvents: [
        {
          kind: 'low_confidence_applied',
          fieldName: 'CB_4',
          confidence: 0.4,
        },
      ],
    });
    pdfFiller.fillPdf.mockResolvedValue(pdfBytes);

    const result = await service.fillPdfForm(
      'user-1',
      Buffer.from('input pdf'),
      'registration.pdf',
      fieldPolicies,
    );

    expect(promptBuilder.buildPrompt).toHaveBeenCalledWith(
      expect.any(Array),
      expect.any(Array),
      fieldPolicies,
      expect.arrayContaining([
        expect.objectContaining({
          factKey: 'workAuthorization.citizenshipStatus',
          value: 'alien authorized to work',
          sourceSlugs: ['profile.citizenship_status'],
          resolutionKind: 'policy_source',
        }),
      ]),
    );
    expect(validator.validate).toHaveBeenCalledWith(
      expect.any(Array),
      expect.any(Array),
      new Set(['profile.citizenship_status']),
      expect.any(Number),
      expect.objectContaining({
        fieldPolicies,
        activePreferenceValues: new Map([
          ['profile.citizenship_status', 'alien authorized to work'],
        ]),
        resolvedFacts: expect.arrayContaining([
          expect.objectContaining({
            factKey: 'workAuthorization.citizenshipStatus',
            sourceSlugs: ['profile.citizenship_status'],
          }),
        ]),
        resolutionConflicts: [],
      }),
    );
    expect(result.summary.validationEvents).toEqual([
      expect.objectContaining({
        kind: 'low_confidence_applied',
        fieldName: 'CB_4',
      }),
    ]);
  });

  it('passes derived middle initial facts to prompt and validation', async () => {
    const pdfBytes = Buffer.from('filled pdf');
    const fieldPolicies = {
      schemaVersion: 1 as const,
      fields: [
        {
          fieldName: 'Employee Middle Initial (if any)',
          mode: 'fact' as const,
          factKey: 'identity.middleInitial',
          sourceSlugs: ['eval.identity.middle_initial'],
        },
      ],
    };
    fieldExtractor.extractFields.mockResolvedValue({
      hasXfa: false,
      fields: [
        {
          name: 'Employee Middle Initial (if any)',
          type: 'text',
          options: [],
          supported: true,
        },
      ],
    });
    preferenceService.getActivePreferences.mockResolvedValue([
      {
        slug: 'profile.middle_name',
        value: 'Jordan',
        description: 'Middle name',
      },
    ]);
    promptBuilder.buildPrompt.mockReturnValue('prompt');
    aiStructuredService.generateStructured.mockResolvedValue({
      fillActions: [
        {
          fieldName: 'Employee Middle Initial (if any)',
          action: 'SET_TEXT',
          value: 'J',
          sourceSlugs: ['profile.middle_name'],
          confidence: 0.95,
        },
      ],
    });
    validator.validate.mockReturnValue({
      validActions: [
        {
          fieldName: 'Employee Middle Initial (if any)',
          fieldType: 'text',
          action: 'SET_TEXT',
          value: 'J',
          sourceSlugs: ['profile.middle_name'],
          confidence: 0.95,
        },
      ],
      filledFields: [
        {
          pdfFieldName: 'Employee Middle Initial (if any)',
          fieldType: 'text',
          sourceSlugs: ['profile.middle_name'],
          confidence: 0.95,
        },
      ],
      skippedFields: [],
      warnings: [],
      validationEvents: [
        {
          kind: 'policy_source_slug_resolved',
          fieldName: 'Employee Middle Initial (if any)',
          factKey: 'identity.middleInitial',
          sourceSlug: 'profile.middle_name',
          resolutionKind: 'derived',
          message:
            'source slug resolved to field policy fact identity.middleInitial: profile.middle_name',
        },
      ],
    });
    pdfFiller.fillPdf.mockResolvedValue(pdfBytes);

    await service.fillPdfForm(
      'user-1',
      Buffer.from('input pdf'),
      'i9.pdf',
      fieldPolicies,
    );

    expect(promptBuilder.buildPrompt.mock.calls[0][3]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          factKey: 'identity.middleInitial',
          value: 'J',
          sourceSlugs: ['profile.middle_name'],
          resolutionKind: 'derived',
          derivedFromFactKey: 'identity.middleName',
        }),
      ]),
    );
    expect(validator.validate).toHaveBeenCalledWith(
      expect.any(Array),
      expect.any(Array),
      new Set(['profile.middle_name']),
      expect.any(Number),
      expect.objectContaining({
        resolvedFacts: expect.arrayContaining([
          expect.objectContaining({
            factKey: 'identity.middleInitial',
            sourceSlugs: ['profile.middle_name'],
            resolutionKind: 'derived',
          }),
        ]),
      }),
    );
  });

  it('returns partial with a non-null filled PDF artifact when fields are skipped', async () => {
    const pdfBytes = Buffer.from('partially filled pdf');
    fieldExtractor.extractFields.mockResolvedValue({
      hasXfa: false,
      fields: [
        {
          name: 'profile.full_name',
          type: 'text',
          options: [],
          supported: true,
        },
        {
          name: 'phone',
          type: 'text',
          options: [],
          supported: true,
        },
      ],
    });
    preferenceService.getActivePreferences.mockResolvedValue([]);
    promptBuilder.buildPrompt.mockReturnValue('prompt');
    aiStructuredService.generateStructured.mockResolvedValue({ fillActions: [] });
    validator.validate.mockReturnValue({
      validActions: [],
      filledFields: [],
      skippedFields: [
        {
          pdfFieldName: 'profile.full_name',
          fieldType: 'text',
          reason: 'not returned by AI',
        },
        {
          pdfFieldName: 'phone',
          fieldType: 'text',
          reason: 'not returned by AI',
        },
      ],
      warnings: [],
    });
    pdfFiller.fillPdf.mockResolvedValue(pdfBytes);

    const result = await service.fillPdfForm(
      'user-1',
      Buffer.from('input pdf'),
      'blank-heavy.pdf',
    );

    expect(result.status).toBe('partial');
    expect(result.filledPdfBase64).toBe(pdfBytes.toString('base64'));
    expect(result.summary).toMatchObject({
      totalFields: 2,
      filledCount: 0,
      skippedCount: 2,
    });
  });

  it('fills AcroForm fields when the source PDF also contains XFA data', async () => {
    const pdfBytes = Buffer.from('filled xfa hybrid pdf');
    fieldExtractor.extractFields.mockResolvedValue({
      hasXfa: true,
      fields: [
        {
          name: 'profile.full_name',
          type: 'text',
          options: [],
          supported: true,
        },
      ],
    });
    preferenceService.getActivePreferences.mockResolvedValue([
      {
        slug: 'profile.full_name',
        value: 'Alex Rivera',
        description: 'Full name',
      },
    ]);
    promptBuilder.buildPrompt.mockReturnValue('prompt');
    aiStructuredService.generateStructured.mockResolvedValue({
      fillActions: [
        {
          fieldName: 'profile.full_name',
          action: 'SET_TEXT',
          value: 'Alex Rivera',
          sourceSlugs: ['profile.full_name'],
          confidence: 0.95,
        },
      ],
    });
    validator.validate.mockReturnValue({
      validActions: [
        {
          fieldName: 'profile.full_name',
          fieldType: 'text',
          action: 'SET_TEXT',
          value: 'Alex Rivera',
          sourceSlugs: ['profile.full_name'],
          confidence: 0.95,
        },
      ],
      filledFields: [
        {
          pdfFieldName: 'profile.full_name',
          fieldType: 'text',
          sourceSlugs: ['profile.full_name'],
          confidence: 0.95,
        },
      ],
      skippedFields: [],
      warnings: [],
    });
    pdfFiller.fillPdf.mockResolvedValue(pdfBytes);

    const result = await service.fillPdfForm(
      'user-1',
      Buffer.from('xfa hybrid pdf'),
      'xfa-hybrid.pdf',
    );

    expect(result.status).toBe('success');
    expect(result.filledPdfBase64).toBe(pdfBytes.toString('base64'));
    expect(aiStructuredService.generateStructured).toHaveBeenCalledTimes(1);
    expect(pdfFiller.fillPdf).toHaveBeenCalledTimes(1);
  });

  it('returns no_fillable_fields for XFA PDFs without AcroForm fields', async () => {
    fieldExtractor.extractFields.mockResolvedValue({
      hasXfa: true,
      fields: [],
    });

    const result = await service.fillPdfForm(
      'user-1',
      Buffer.from('xfa pdf'),
      'xfa.pdf',
    );

    expect(result).toMatchObject({
      status: 'no_fillable_fields',
      filledPdfBase64: null,
      summary: {
        totalFields: 0,
        filledCount: 0,
        skippedCount: 0,
      },
    });
    expect(aiStructuredService.generateStructured).not.toHaveBeenCalled();
    expect(pdfFiller.fillPdf).not.toHaveBeenCalled();
  });

  it('returns no_fillable_fields without calling AI', async () => {
    fieldExtractor.extractFields.mockResolvedValue({
      hasXfa: false,
      fields: [],
    });

    const result = await service.fillPdfForm(
      'user-1',
      Buffer.from('flat pdf'),
      'flat.pdf',
    );

    expect(result).toMatchObject({
      status: 'no_fillable_fields',
      filledPdfBase64: null,
      summary: {
        totalFields: 0,
        filledCount: 0,
        skippedCount: 0,
      },
    });
    expect(aiStructuredService.generateStructured).not.toHaveBeenCalled();
    expect(pdfFiller.fillPdf).not.toHaveBeenCalled();
  });

  it('returns failed when an unrecoverable error occurs', async () => {
    fieldExtractor.extractFields.mockRejectedValue(new Error('bad pdf'));

    const result = await service.fillPdfForm(
      'user-1',
      Buffer.from('bad pdf'),
      'bad.pdf',
    );

    expect(result).toMatchObject({
      status: 'failed',
      filledPdfBase64: null,
      summary: {
        totalFields: 0,
        filledCount: 0,
        skippedCount: 0,
        warnings: [
          'Form fill failed. Please try again.',
          'Form fill failed during field_extraction: bad pdf',
        ],
      },
    });
  });

  it('returns failed with pdf_fill detail when PDF writing fails', async () => {
    fieldExtractor.extractFields.mockResolvedValue({
      hasXfa: false,
      fields: [
        {
          name: 'ZIP Code',
          type: 'text',
          options: [],
          supported: true,
        },
      ],
    });
    preferenceService.getActivePreferences.mockResolvedValue([
      {
        slug: 'eval.address.current.postal_code',
        value: '97214',
        description: 'Postal code',
      },
    ]);
    promptBuilder.buildPrompt.mockReturnValue('prompt');
    aiStructuredService.generateStructured.mockResolvedValue({
      fillActions: [
        {
          fieldName: 'ZIP Code',
          action: 'SET_TEXT',
          value: '97214',
          sourceSlugs: ['eval.address.current.postal_code'],
          confidence: 0.95,
        },
      ],
    });
    validator.validate.mockReturnValue({
      validActions: [
        {
          fieldName: 'ZIP Code',
          fieldType: 'text',
          action: 'SET_TEXT',
          value: '97214',
          sourceSlugs: ['eval.address.current.postal_code'],
          confidence: 0.95,
        },
      ],
      filledFields: [
        {
          pdfFieldName: 'ZIP Code',
          fieldType: 'text',
          sourceSlugs: ['eval.address.current.postal_code'],
          confidence: 0.95,
        },
      ],
      skippedFields: [],
      warnings: [],
      validationEvents: [],
    });
    pdfFiller.fillPdf.mockRejectedValue(
      new Error('Failed to apply SET_TEXT to PDF field "ZIP Code": text length 42 exceeds PDF field maxLength 6'),
    );

    const result = await service.fillPdfForm(
      'user-1',
      Buffer.from('input pdf'),
      'i9.pdf',
    );

    expect(result.status).toBe('failed');
    expect(result.filledPdfBase64).toBeNull();
    expect(result.summary.warnings).toEqual([
      'Form fill failed. Please try again.',
      'Form fill failed during pdf_fill: Failed to apply SET_TEXT to PDF field "ZIP Code": text length 42 exceeds PDF field maxLength 6',
    ]);
  });
});
