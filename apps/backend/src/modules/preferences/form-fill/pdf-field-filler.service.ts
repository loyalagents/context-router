import { Injectable } from '@nestjs/common';
import {
  PDFDocument,
  StandardFonts,
} from 'pdf-lib';
import { ValidatedFillAction } from './form-fill.types';

@Injectable()
export class PdfFieldFillerService {
  async fillPdf(
    fileBuffer: Buffer,
    actions: ValidatedFillAction[],
  ): Promise<Buffer> {
    const pdfDoc = await PDFDocument.load(fileBuffer);
    const form = pdfDoc.getForm();

    for (const action of actions) {
      switch (action.fieldType) {
        case 'text':
          form.getTextField(action.fieldName).setText(action.value ?? '');
          break;
        case 'checkbox':
          if (action.action === 'CHECK') {
            form.getCheckBox(action.fieldName).check();
          } else {
            form.getCheckBox(action.fieldName).uncheck();
          }
          break;
        case 'radio':
          form.getRadioGroup(action.fieldName).select(action.value ?? '');
          break;
        case 'dropdown':
          form.getDropdown(action.fieldName).select(action.value ?? '');
          break;
        case 'option_list':
          form.getOptionList(action.fieldName).select([action.value ?? '']);
          break;
        case 'button':
        case 'signature':
        case 'unknown':
          break;
      }
    }

    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    form.updateFieldAppearances(font);

    return Buffer.from(await pdfDoc.save());
  }
}
