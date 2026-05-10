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
  async extractFields(fileBuffer: Buffer): Promise<ExtractedPdfFields> {
    const pdfDoc = await PDFDocument.load(fileBuffer);
    const hasXfa = this.hasXfa(pdfDoc);

    if (hasXfa) {
      return {
        hasXfa,
        fields: [],
      };
    }

    return {
      hasXfa,
      fields: pdfDoc
        .getForm()
        .getFields()
        .map((field) => this.toMetadata(field)),
    };
  }

  private hasXfa(pdfDoc: PDFDocument): boolean {
    const acroForm = pdfDoc.catalog.lookup(PDFName.of('AcroForm'));
    if (!(acroForm instanceof PDFDict)) {
      return false;
    }

    return acroForm.has(PDFName.of('XFA'));
  }

  private toMetadata(field: PDFField): PdfFieldMetadata {
    const name = field.getName();
    const type = this.fieldType(field);
    const options = this.fieldOptions(field);
    const unsupportedReason = this.unsupportedReason(type);

    return {
      name,
      type,
      options,
      supported: !unsupportedReason,
      unsupportedReason,
    };
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
