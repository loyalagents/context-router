import { BadRequestException } from '@nestjs/common';
import { FormFillController } from './form-fill.controller';

describe('FormFillController', () => {
  let service: { fillPdfForm: jest.Mock };
  let controller: FormFillController;

  beforeEach(() => {
    service = {
      fillPdfForm: jest.fn().mockResolvedValue({
        fillId: 'fill-1',
        status: 'success',
      }),
    };
    controller = new FormFillController(service as any);
  });

  it('rejects missing uploads', async () => {
    await expect(
      controller.fillPdf(undefined as any, { user: { userId: 'user-1' } }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects non-PDF uploads', async () => {
    await expect(
      controller.fillPdf(
        {
          mimetype: 'text/plain',
          size: 10,
          originalname: 'form.txt',
          buffer: Buffer.from('not pdf'),
        } as Express.Multer.File,
        { user: { userId: 'user-1' } },
      ),
    ).rejects.toThrow('Unsupported file type');
  });

  it('rejects oversized uploads', async () => {
    await expect(
      controller.fillPdf(
        {
          mimetype: 'application/pdf',
          size: 10 * 1024 * 1024 + 1,
          originalname: 'large.pdf',
          buffer: Buffer.from('pdf'),
        } as Express.Multer.File,
        { user: { userId: 'user-1' } },
      ),
    ).rejects.toThrow('File too large');
  });

  it('rejects requests without a user id', async () => {
    await expect(
      controller.fillPdf(
        {
          mimetype: 'application/pdf',
          size: 10,
          originalname: 'form.pdf',
          buffer: Buffer.from('pdf'),
        } as Express.Multer.File,
        { user: {} },
      ),
    ).rejects.toThrow('User ID not found');
  });

  it('delegates valid PDF uploads to the service', async () => {
    await controller.fillPdf(
      {
        mimetype: 'application/pdf',
        size: 10,
        originalname: 'form.pdf',
        buffer: Buffer.from('pdf'),
      } as Express.Multer.File,
      { user: { userId: 'user-1' } },
      undefined,
    );

    expect(service.fillPdfForm).toHaveBeenCalledWith(
      'user-1',
      Buffer.from('pdf'),
      'form.pdf',
      undefined,
    );
  });

  it('parses optional field policies and delegates them to the service', async () => {
    const rawPolicies = JSON.stringify({
      schemaVersion: 1,
      fields: [
        {
          fieldName: 'CB_4',
          mode: 'fact',
          factKey: 'workAuthorization.citizenshipStatus',
          sourceSlugs: ['profile.citizenship_status'],
        },
      ],
    });

    await controller.fillPdf(
      {
        mimetype: 'application/pdf',
        size: 10,
        originalname: 'form.pdf',
        buffer: Buffer.from('pdf'),
      } as Express.Multer.File,
      { user: { userId: 'user-1' } },
      rawPolicies,
    );

    expect(service.fillPdfForm).toHaveBeenCalledWith(
      'user-1',
      Buffer.from('pdf'),
      'form.pdf',
      expect.objectContaining({
        schemaVersion: 1,
        fields: [
          expect.objectContaining({
            fieldName: 'CB_4',
            mode: 'fact',
          }),
        ],
      }),
    );
  });

  it('rejects malformed field policies', async () => {
    await expect(
      controller.fillPdf(
        {
          mimetype: 'application/pdf',
          size: 10,
          originalname: 'form.pdf',
          buffer: Buffer.from('pdf'),
        } as Express.Multer.File,
        { user: { userId: 'user-1' } },
        '{not-json',
      ),
    ).rejects.toThrow('fieldPolicies must be valid JSON');
  });
});
