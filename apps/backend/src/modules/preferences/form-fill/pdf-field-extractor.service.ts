import { Injectable } from '@nestjs/common';
import {
  PDFButton,
  PDFCheckBox,
  PDFDict,
  PDFDocument,
  PDFDropdown,
  PDFField,
  PDFName,
  PDFOptionList,
  PDFRadioGroup,
  PDFSignature,
  PDFTextField,
} from 'pdf-lib';
import {
  ExtractedPdfFields,
  PdfFieldMetadata,
  PdfFieldOption,
  PdfFieldType,
} from './form-fill.types';

@Injectable()
export class PdfFieldExtractorService {
  async extractFields(
    fileBuffer: Buffer,
    options: { readExistingValues?: boolean } = {},
  ): Promise<ExtractedPdfFields> {
    const pdfDoc = await PDFDocument.load(fileBuffer);
    const hasXfa = this.hasXfa(pdfDoc);
    const form = pdfDoc.getForm();

    return {
      hasXfa,
      fields: form.getFields().map((field) => this.toMetadata(field, options.readExistingValues === true)),
    };
  }

  private hasXfa(pdfDoc: PDFDocument): boolean {
    const acroForm = pdfDoc.catalog.lookup(PDFName.of('AcroForm'));
    if (!(acroForm instanceof PDFDict)) {
      return false;
    }

    return acroForm.has(PDFName.of('XFA'));
  }

  private toMetadata(field: PDFField, readExistingValues: boolean): PdfFieldMetadata {
    const name = field.getName();
    const type = this.fieldType(field);
    const options = this.fieldOptions(field);
    const unsupportedReason = this.unsupportedReason(type);

    return {
      name,
      type,
      options,
      supported: !unsupportedReason,
      ...(readExistingValues ? this.existingValue(field) : {}),
      ...(field instanceof PDFTextField && field.getMaxLength() !== undefined
        ? { maxLength: field.getMaxLength() }
        : {}),
      unsupportedReason,
    };
  }

  private existingValue(field: PDFField): Pick<PdfFieldMetadata, 'existingValue' | 'existingValueUnknown'> {
    try {
      if (field instanceof PDFTextField) return { existingValue: field.getText() ?? '' };
      if (field instanceof PDFCheckBox) return { existingValue: field.isChecked() };
      if (field instanceof PDFRadioGroup) return { existingValue: field.getSelected() ?? '' };
      if (field instanceof PDFDropdown || field instanceof PDFOptionList) return { existingValue: field.getSelected() };
      return {};
    } catch {
      // Rich text and other unreadable values are occupied, never inferred empty.
      return { existingValueUnknown: true };
    }
  }

  private fieldType(field: PDFField): PdfFieldType {
    if (field instanceof PDFTextField) {
      return 'text';
    }
    if (field instanceof PDFCheckBox) {
      return 'checkbox';
    }
    if (field instanceof PDFRadioGroup) {
      return 'radio';
    }
    if (field instanceof PDFDropdown) {
      return 'dropdown';
    }
    if (field instanceof PDFOptionList) {
      return 'option_list';
    }
    if (field instanceof PDFSignature) {
      return 'signature';
    }
    if (field instanceof PDFButton) {
      return 'button';
    }

    return 'unknown';
  }

  private fieldOptions(field: PDFField): PdfFieldOption[] {
    if (
      field instanceof PDFDropdown ||
      field instanceof PDFOptionList ||
      field instanceof PDFRadioGroup
    ) {
      return field.getOptions().map((value) => ({
        label: value,
        value,
      }));
    }

    return [];
  }

  private unsupportedReason(type: PdfFieldType): string | undefined {
    switch (type) {
      case 'text':
      case 'checkbox':
      case 'radio':
      case 'dropdown':
      case 'option_list':
        return undefined;
      case 'button':
        return 'button fields are not supported';
      case 'signature':
        return 'signature fields are not supported';
      case 'unknown':
        return 'unknown PDF field type is not supported';
    }
  }
}
