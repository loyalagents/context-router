import { PDFDocument } from 'pdf-lib';
import { PdfFieldFillerService } from './pdf-field-filler.service';
import { ValidatedFillAction } from './form-fill.types';

async function createFillablePdf(): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([600, 700]);
  const form = pdfDoc.getForm();

  form
    .createTextField('profile.full_name')
    .addToPage(page, { x: 50, y: 620, width: 200, height: 24 });
  form
    .createTextField('US Social Security Number')
    .setMaxLength(9);
  form
    .getTextField('US Social Security Number')
    .addToPage(page, { x: 50, y: 600, width: 140, height: 24 });
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

describe('PdfFieldFillerService', () => {
  let service: PdfFieldFillerService;

  beforeEach(() => {
    service = new PdfFieldFillerService();
  });

  it('fills supported PDF field types and returns non-empty bytes', async () => {
    const actions: ValidatedFillAction[] = [
      {
        fieldName: 'profile.full_name',
        fieldType: 'text',
        action: 'SET_TEXT',
        value: 'Alex Rivera',
        sourceSlugs: ['profile.full_name'],
        confidence: 0.98,
      },
      {
        fieldName: 'newsletter_opt_in',
        fieldType: 'checkbox',
        action: 'CHECK',
        sourceSlugs: ['communication.preferred_channels'],
        confidence: 0.9,
      },
      {
        fieldName: 'travel.seat_preference',
        fieldType: 'radio',
        action: 'SELECT_OPTION',
        value: 'aisle',
        sourceSlugs: ['travel.seat_preference'],
        confidence: 0.95,
      },
      {
        fieldName: 'food.spice_tolerance',
        fieldType: 'dropdown',
        action: 'SELECT_OPTION',
        value: 'medium',
        sourceSlugs: ['food.spice_tolerance'],
        confidence: 0.95,
      },
      {
        fieldName: 'communication.preferred_channels',
        fieldType: 'option_list',
        action: 'SELECT_OPTION',
        value: 'email',
        sourceSlugs: ['communication.preferred_channels'],
        confidence: 0.95,
      },
    ];

    const filled = await service.fillPdf(await createFillablePdf(), actions);

    expect(filled.length).toBeGreaterThan(0);

    const filledDoc = await PDFDocument.load(filled);
    const form = filledDoc.getForm();

    expect(form.getTextField('profile.full_name').getText()).toBe(
      'Alex Rivera',
    );
    expect(form.getCheckBox('newsletter_opt_in').isChecked()).toBe(true);
    expect(form.getRadioGroup('travel.seat_preference').getSelected()).toBe(
      'aisle',
    );
    expect(form.getDropdown('food.spice_tolerance').getSelected()).toEqual([
      'medium',
    ]);
    expect(
      form.getOptionList('communication.preferred_channels').getSelected(),
    ).toEqual(['email']);
  });

  it('strips punctuation for the I-9 social security number field', async () => {
    const actions: ValidatedFillAction[] = [
      {
        fieldName: 'US Social Security Number',
        fieldType: 'text',
        action: 'SET_TEXT',
        value: '000-00-0292',
        sourceSlugs: ['eval.identity.ssn'],
        confidence: 0.98,
      },
    ];

    const filled = await service.fillPdf(await createFillablePdf(), actions);
    const filledDoc = await PDFDocument.load(filled);
    const form = filledDoc.getForm();

    expect(form.getTextField('US Social Security Number').getText()).toBe(
      '000000292',
    );
  });
});
