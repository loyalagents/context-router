import { INestApplication } from '@nestjs/common';
import { PDFDocument } from 'pdf-lib';
import request from 'supertest';
import { createTestApp, createTestUser, TestUser } from '../setup/test-app';

async function createUploadPdf(): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([600, 500]);
  const form = pdfDoc.getForm();

  form
    .createTextField('profile.full_name')
    .addToPage(page, { x: 50, y: 420, width: 200, height: 24 });
  form
    .createCheckBox('newsletter_opt_in')
    .addToPage(page, { x: 50, y: 380, width: 18, height: 18 });

  const dropdown = form.createDropdown('food.spice_tolerance');
  dropdown.addOptions(['mild', 'medium', 'hot']);
  dropdown.addToPage(page, { x: 50, y: 330, width: 160, height: 24 });

  return Buffer.from(await pdfDoc.save());
}

describe('Form Fill API (e2e)', () => {
  let app: INestApplication;
  let testUser: TestUser;
  let setTestUser: (user: TestUser) => void;
  let structuredAi: {
    generateStructured: jest.Mock;
    generateStructuredWithFile: jest.Mock;
  };

  beforeAll(async () => {
    const testApp = await createTestApp();
    app = testApp.app;
    setTestUser = testApp.setTestUser;
    structuredAi = testApp.mocks.structuredAi;
  });

  beforeEach(async () => {
    testUser = await createTestUser();
    setTestUser(testUser);
    structuredAi.generateStructured.mockReset();
    structuredAi.generateStructuredWithFile.mockReset();

    await setPreference('profile.full_name', 'Alex Rivera');
    await setPreference('food.spice_tolerance', 'medium');
    await setPreference('communication.preferred_channels', ['email']);
  });

  afterAll(async () => {
    await app.close();
  });

  async function setPreference(slug: string, value: unknown) {
    const response = await request(app.getHttpServer())
      .post('/graphql')
      .send({
        query: `
          mutation SetPreference($input: SetPreferenceInput!) {
            setPreference(input: $input) {
              id
              slug
            }
          }
        `,
        variables: {
          input: { slug, value },
        },
      })
      .expect(200);

    expect(response.body.errors).toBeUndefined();
  }

  it('fills a PDF from active preferences and returns a filled artifact summary', async () => {
    structuredAi.generateStructured.mockResolvedValue({
      fillActions: [
        {
          fieldName: 'profile.full_name',
          action: 'SET_TEXT',
          value: 'Alex Rivera',
          sourceSlugs: ['profile.full_name'],
          confidence: 0.98,
        },
        {
          fieldName: 'newsletter_opt_in',
          action: 'CHECK',
          sourceSlugs: ['communication.preferred_channels'],
          confidence: 0.9,
        },
        {
          fieldName: 'food.spice_tolerance',
          action: 'SELECT_OPTION',
          value: 'medium',
          sourceSlugs: ['food.spice_tolerance'],
          confidence: 0.95,
        },
      ],
    });

    const response = await request(app.getHttpServer())
      .post('/api/form-fill/pdf')
      .attach('file', await createUploadPdf(), {
        filename: 'registration.pdf',
        contentType: 'application/pdf',
      })
      .expect(201);

    expect(response.body).toMatchObject({
      status: 'success',
      originalFilename: 'registration.pdf',
      outputFilename: 'filled-registration.pdf',
      outputMimeType: 'application/pdf',
      summary: {
        totalFields: 3,
        filledCount: 3,
        skippedCount: 0,
      },
    });
    expect(response.body.filledPdfBase64).toEqual(expect.any(String));
    expect(
      response.body.summary.filledCount + response.body.summary.skippedCount,
    ).toBe(response.body.summary.totalFields);
    expect(structuredAi.generateStructured).toHaveBeenCalledTimes(1);
    expect(structuredAi.generateStructuredWithFile).not.toHaveBeenCalled();

    const filledBuffer = Buffer.from(response.body.filledPdfBase64, 'base64');
    const filledDoc = await PDFDocument.load(filledBuffer);
    const form = filledDoc.getForm();

    expect(form.getTextField('profile.full_name').getText()).toBe(
      'Alex Rivera',
    );
    expect(form.getCheckBox('newsletter_opt_in').isChecked()).toBe(true);
    expect(form.getDropdown('food.spice_tolerance').getSelected()).toEqual([
      'medium',
    ]);
  });

  it('returns null artifact for PDFs without AcroForm fields', async () => {
    const pdfDoc = await PDFDocument.create();
    pdfDoc.addPage([300, 300]);

    const response = await request(app.getHttpServer())
      .post('/api/form-fill/pdf')
      .attach('file', Buffer.from(await pdfDoc.save()), {
        filename: 'flat.pdf',
        contentType: 'application/pdf',
      })
      .expect(201);

    expect(response.body).toMatchObject({
      status: 'no_fillable_fields',
      filledPdfBase64: null,
      summary: {
        totalFields: 0,
        filledCount: 0,
        skippedCount: 0,
      },
    });
    expect(structuredAi.generateStructured).not.toHaveBeenCalled();
  });
});
