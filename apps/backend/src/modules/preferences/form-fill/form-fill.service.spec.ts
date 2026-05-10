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

  it('returns unsupported_format for XFA without calling AI', async () => {
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
      status: 'unsupported_format',
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
      },
    });
  });
});
