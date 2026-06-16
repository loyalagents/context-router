import { Injectable } from '@nestjs/common';
import {
  PDFDocument,
  StandardFonts,
} from 'pdf-lib';
import { ValidatedFillAction } from './form-fill.types';
import { normalizeTextValueForPdfField } from './pdf-text-value-normalization';

@Injectable()
export class PdfFieldFillerService {
  async fillPdf(
    fileBuffer: Buffer,
    actions: ValidatedFillAction[],
  ): Promise<Buffer> {
    const pdfDoc = await PDFDocument.load(fileBuffer);
    const form = pdfDoc.getForm();

    for (const action of actions) {
      try {
        switch (action.fieldType) {
          case 'text':
            form
              .getTextField(action.fieldName)
              .setText(normalizeTextValueForPdfField(action));
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
      } catch (error) {
        throw this.fieldWriteError(action, error);
      }
    }

    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    form.updateFieldAppearances(font);

    return Buffer.from(await pdfDoc.save());
  }

  private fieldWriteError(
    action: ValidatedFillAction,
    error: unknown,
  ): Error {
    const message =
      error instanceof Error
        ? error.message
        : typeof error === 'string'
          ? error
          : 'unknown error';
    const wrapped = new Error(
      `Failed to apply ${action.action} to PDF field "${action.fieldName}": ${message}`,
    ) as Error & { cause?: unknown };
    wrapped.cause = error;
    return wrapped;
  }
}
