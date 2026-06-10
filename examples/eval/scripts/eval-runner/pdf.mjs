import { createRequire } from 'node:module';
import path from 'node:path';

const pdfLibByRepoRoot = new Map();

export function loadBackendPdfLib(repoRoot) {
  const key = path.resolve(repoRoot);
  const cached = pdfLibByRepoRoot.get(key);
  if (cached) return cached;

  const backendRequire = createRequire(
    path.join(key, 'apps/backend/package.json'),
  );
  const pdfLib = backendRequire('pdf-lib');
  pdfLibByRepoRoot.set(key, pdfLib);
  return pdfLib;
}

export async function readFilledPdfFields({
  repoRoot,
  pdfBytes,
  pdfLib = loadBackendPdfLib(repoRoot),
}) {
  const {
    PDFCheckBox,
    PDFDocument,
    PDFDropdown,
    PDFOptionList,
    PDFRadioGroup,
    PDFTextField,
  } = pdfLib;

  const bytes = Buffer.isBuffer(pdfBytes) ? pdfBytes : Buffer.from(pdfBytes);
  const pdfDoc = await PDFDocument.load(bytes);
  const fields = {};

  for (const field of pdfDoc.getForm().getFields()) {
    const name = field.getName();
    if (field instanceof PDFTextField) {
      fields[name] = { value: field.getText() ?? '' };
    } else if (field instanceof PDFCheckBox) {
      fields[name] = { checked: field.isChecked() };
    } else if (field instanceof PDFDropdown) {
      fields[name] = { selected: field.getSelected() };
    } else if (field instanceof PDFOptionList) {
      fields[name] = { selected: field.getSelected() };
    } else if (field instanceof PDFRadioGroup) {
      fields[name] = {
        selected: field.getSelected() ? [field.getSelected()] : [],
      };
    } else {
      fields[name] = {};
    }
  }

  return fields;
}

export async function readFilledPdfFieldsFromBase64({
  repoRoot,
  base64,
  pdfLib,
}) {
  return readFilledPdfFields({
    repoRoot,
    pdfBytes: Buffer.from(base64, 'base64'),
    pdfLib,
  });
}
