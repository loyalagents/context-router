import { PDFDocument, PDFName, PDFString, PDFTextField } from 'pdf-lib';
import { HOSTED_AI_CAPABILITIES } from '../../../domains/shared/ports/ai-execution';
import { FormFillService } from './form-fill.service';
import { PdfFieldExtractorService } from './pdf-field-extractor.service';
import { PdfFieldFillerService } from './pdf-field-filler.service';
import { FormFillPromptBuilderService } from './form-fill-prompt-builder.service';
import { FormFillValidatorService } from './form-fill-validator.service';
import { FormFillFieldPoliciesSchema } from './form-fill.types';

async function richTextFixture() {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage();
  const form = pdf.getForm();
  const rich = form.createTextField('rich');
  rich.addToPage(page);
  rich.enableRichFormatting();
  rich.acroField.dict.set(
    PDFName.of('RV'),
    PDFString.of('private-rich-canary'),
  );
  // Missing /V makes getText throw; missing /AP also makes appearance generation read it.
  rich.acroField.getWidgets()[0].dict.delete(PDFName.of('AP'));
  form.createTextField('ordinary').addToPage(page);
  const occupied = form.createTextField('occupied');
  occupied.addToPage(page);
  occupied.setText('private-existing-canary');
  return Buffer.from(await pdf.save({ updateFieldAppearances: false }));
}

describe('rich-text compatibility through the real form-fill pipeline', () => {
  afterEach(() => jest.restoreAllMocks());

  it('legacy extraction does not read existing values', async () => {
    const bytes = await richTextFixture();
    const read = jest.spyOn(PDFTextField.prototype, 'getText');
    const extracted = await new PdfFieldExtractorService().extractFields(bytes);
    expect(extracted.fields).toHaveLength(3);
    expect(read).not.toHaveBeenCalled();
    expect(extracted.fields.every((field) => !('existingValue' in field))).toBe(
      true,
    );
  });

  it.each([
    'absent',
    'v1',
    'v2',
    'v2-no-action',
    'overwrite',
    'invalid-overwrite',
  ])(
    '%s retains fill behavior without reading or rewriting preserved rich text',
    async (mode) => {
      const bytes = await richTextFixture();
      const generateStructured = jest.fn().mockResolvedValue({
        fillActions: (mode === 'v2-no-action'
          ? ['ordinary']
          : ['rich', 'ordinary']
        ).map((fieldName) => ({
          fieldName,
          action: 'SET_TEXT',
          value: 'synthetic filled value',
          confidence: 1,
          sourceSlugs:
            mode === 'invalid-overwrite' && fieldName === 'rich'
              ? ['missing.source']
              : ['synthetic.source'],
        })),
      });
      const service = new FormFillService(
        { capabilities: HOSTED_AI_CAPABILITIES, generateStructured } as any,
        {
          getActivePreferences: async () => [
            { slug: 'synthetic.source', value: 'synthetic filled value' },
          ],
        } as any,
        new PdfFieldExtractorService(),
        new FormFillPromptBuilderService(),
        new FormFillValidatorService(),
        new PdfFieldFillerService(),
        { getOrThrow: () => 0.75 } as any,
      );
      const policies =
        mode === 'absent'
          ? undefined
          : FormFillFieldPoliciesSchema.parse({
              schemaVersion: mode === 'v1' ? 1 : 2,
              fields: mode.includes('overwrite')
                ? [{ fieldName: 'rich', overwrite: true }]
                : [],
            });
      const result = await service.fillPdfForm(
        'synthetic-user',
        bytes,
        'synthetic.pdf',
        policies,
      );
      expect(result.status).toBe('partial'); // The occupied field has no proposed action.
      expect(result.filledPdfBase64).not.toBeNull();
      const output = (
        await PDFDocument.load(Buffer.from(result.filledPdfBase64!, 'base64'))
      ).getForm();
      expect(output.getTextField('ordinary').getText()).toBe(
        'synthetic filled value',
      );
      expect(output.getTextField('occupied').getText()).toBe(
        'private-existing-canary',
      );
      const preserved = mode.startsWith('v2') || mode === 'invalid-overwrite';
      const rich = output.getTextField('rich');
      expect(result.summary.filledCount).toBe(preserved ? 1 : 2);
      if (preserved) {
        const original = (await PDFDocument.load(bytes))
          .getForm()
          .getTextField('rich');
        for (const key of ['Ff', 'RV', 'V'])
          expect(rich.acroField.dict.get(PDFName.of(key))?.toString()).toBe(
            original.acroField.dict.get(PDFName.of(key))?.toString(),
          );
        expect(rich.acroField.getWidgets()[0].dict.has(PDFName.of('AP'))).toBe(
          false,
        );
        expect(
          result.summary.skippedFields.find(
            (field) => field.pdfFieldName === 'rich',
          )?.reason,
        ).toMatch(
          mode.startsWith('v2') ? /preserved/ : /not an active preference/,
        );
      } else {
        expect(rich.isRichFormatted()).toBe(false);
        expect(rich.getText()).toBe('synthetic filled value');
        expect(rich.acroField.getWidgets()[0].dict.has(PDFName.of('AP'))).toBe(
          true,
        );
      }
      const prompt = generateStructured.mock.calls[0][0];
      expect(prompt).not.toMatch(
        /private-rich-canary|private-existing-canary|existingValue|existingValueUnknown/,
      );
    },
  );

  it('an unreadable checkbox conservatively blocks a conflicting group selection', () => {
    const fields = ['unknown', 'alternate'].map((name) => ({
      name,
      type: 'checkbox',
      options: [],
      supported: true,
      ...(name === 'unknown'
        ? { existingValueUnknown: true }
        : { existingValue: false }),
    }));
    const result = new FormFillValidatorService().validate(
      [
        {
          fieldName: 'alternate',
          action: 'CHECK',
          sourceSlugs: ['synthetic.source'],
          confidence: 1,
        },
      ],
      fields as any,
      new Set(['synthetic.source']),
      0.75,
      {
        fieldPolicies: FormFillFieldPoliciesSchema.parse({
          schemaVersion: 2,
          fields: fields.map(({ name }) => ({
            fieldName: name,
            groupId: 'exclusive',
          })),
        }),
      },
    );
    expect(result.validActions).toEqual([]);
    expect(result.skippedFields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          pdfFieldName: 'unknown',
          reason: expect.stringContaining('preserved'),
        }),
        expect.objectContaining({
          pdfFieldName: 'alternate',
          reason: expect.stringContaining('group conflict'),
        }),
      ]),
    );
  });
});
