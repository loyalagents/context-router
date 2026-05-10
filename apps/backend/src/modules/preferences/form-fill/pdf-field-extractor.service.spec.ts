import { PDFDocument, PDFName } from 'pdf-lib';
import { PdfFieldExtractorService } from './pdf-field-extractor.service';

async function createFillablePdf(): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([600, 700]);
  const form = pdfDoc.getForm();

  form
    .createTextField('profile.full_name')
    .addToPage(page, { x: 50, y: 620, width: 200, height: 24 });
  form
    .createCheckBox('newsletter_opt_in')
    .addToPage(page, { x: 50, y: 580, width: 18, height: 18 });

  const radio = form.createRadioGroup('travel.seat_preference');
  radio.addOptionToPage('aisle', page, {
    x: 50,
    y: 540,
    width: 18,
    height: 18,
  });
  radio.addOptionToPage('window', page, {
    x: 90,
    y: 540,
    width: 18,
    height: 18,
  });

  const dropdown = form.createDropdown('food.spice_tolerance');
  dropdown.addOptions(['mild', 'medium', 'hot']);
  dropdown.addToPage(page, { x: 50, y: 500, width: 160, height: 24 });

  const optionList = form.createOptionList('communication.preferred_channels');
  optionList.addOptions(['email', 'slack']);
  optionList.addToPage(page, { x: 50, y: 440, width: 160, height: 48 });

  return Buffer.from(await pdfDoc.save());
}

async function createXfaPdf(): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.addPage([300, 300]);
  pdfDoc.catalog.set(
    PDFName.of('AcroForm'),
    pdfDoc.context.obj({
      XFA: ['template', '<xdp:xdp />'],
    }),
  );

  return Buffer.from(await pdfDoc.save());
}

describe('PdfFieldExtractorService', () => {
  let service: PdfFieldExtractorService;

  beforeEach(() => {
    service = new PdfFieldExtractorService();
  });

  it('extracts supported AcroForm field metadata', async () => {
    const result = await service.extractFields(await createFillablePdf());

    expect(result.hasXfa).toBe(false);
    expect(result.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'profile.full_name',
          type: 'text',
          supported: true,
        }),
        expect.objectContaining({
          name: 'newsletter_opt_in',
          type: 'checkbox',
          supported: true,
        }),
        expect.objectContaining({
          name: 'travel.seat_preference',
          type: 'radio',
          options: [
            { label: 'aisle', value: 'aisle' },
            { label: 'window', value: 'window' },
          ],
          supported: true,
        }),
        expect.objectContaining({
          name: 'food.spice_tolerance',
          type: 'dropdown',
          options: [
            { label: 'mild', value: 'mild' },
            { label: 'medium', value: 'medium' },
            { label: 'hot', value: 'hot' },
          ],
          supported: true,
        }),
        expect.objectContaining({
          name: 'communication.preferred_channels',
          type: 'option_list',
          options: [
            { label: 'email', value: 'email' },
            { label: 'slack', value: 'slack' },
          ],
          supported: true,
        }),
      ]),
    );
  });

  it('detects XFA forms separately from flat PDFs', async () => {
    const result = await service.extractFields(await createXfaPdf());

    expect(result.hasXfa).toBe(true);
    expect(result.fields).toEqual([]);
  });
});
