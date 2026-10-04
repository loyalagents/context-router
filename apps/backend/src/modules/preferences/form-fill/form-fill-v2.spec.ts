import { PDFDocument } from 'pdf-lib';
import { PdfFieldExtractorService } from './pdf-field-extractor.service';
import { PdfFieldFillerService } from './pdf-field-filler.service';
import { FormFillValidatorService } from './form-fill-validator.service';
import { FormFillPromptBuilderService } from './form-fill-prompt-builder.service';
import {
  FormFillFieldPoliciesSchema,
  type AiFillAction,
} from './form-fill.types';

async function fixture(occupied = true) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage();
  const form = pdf.getForm();
  const text = form.createTextField('text');
  text.addToPage(page);
  if (occupied) text.setText('0');
  const checkbox = form.createCheckBox('checkbox');
  checkbox.addToPage(page);
  if (occupied) checkbox.check();
  const radio = form.createRadioGroup('radio');
  radio.addOptionToPage('before', page);
  radio.addOptionToPage('after', page);
  if (occupied) radio.select('before');
  const dropdown = form.createDropdown('dropdown');
  dropdown.setOptions(['before', 'after']);
  dropdown.addToPage(page);
  if (occupied) dropdown.select('before');
  const list = form.createOptionList('list');
  list.setOptions(['before', 'after']);
  list.addToPage(page);
  if (occupied) list.select('before');
  return Buffer.from(await pdf.save());
}
const actions: AiFillAction[] = [
  {
    fieldName: 'text',
    action: 'SET_TEXT',
    value: 'after',
    sourceSlugs: ['synthetic.value'],
    confidence: 1,
  },
  {
    fieldName: 'checkbox',
    action: 'UNCHECK',
    sourceSlugs: ['synthetic.value'],
    confidence: 1,
  },
  ...['radio', 'dropdown', 'list'].map((fieldName) => ({
    fieldName,
    action: 'SELECT_OPTION' as const,
    value: 'after',
    sourceSlugs: ['synthetic.value'],
    confidence: 1,
  })),
];
async function values(buffer: Buffer) {
  const form = (await PDFDocument.load(buffer)).getForm();
  return [
    form.getTextField('text').getText(),
    form.getCheckBox('checkbox').isChecked(),
    form.getRadioGroup('radio').getSelected(),
    form.getDropdown('dropdown').getSelected(),
    form.getOptionList('list').getSelected(),
  ];
}
describe('form-fill policy v2 preserves existing real PDF field values', () => {
  it.each(['absent', 'v1', 'v2', 'overwrite', 'explicit-false'])(
    '%s has explicit compatibility semantics for all five supported field types',
    async (mode) => {
      const buffer = await fixture();
      const extracted = await new PdfFieldExtractorService().extractFields(
        buffer,
      );
      const policies =
        mode === 'absent'
          ? undefined
          : FormFillFieldPoliciesSchema.parse({
              schemaVersion: mode === 'v1' ? 1 : 2,
              fields: ['overwrite', 'explicit-false'].includes(mode)
                ? extracted.fields.map((field) => ({
                    fieldName: field.name,
                    overwrite: mode === 'overwrite',
                  }))
                : [],
            });
      const result = new FormFillValidatorService().validate(
        actions,
        extracted.fields,
        new Set(['synthetic.value']),
        0.75,
        { fieldPolicies: policies },
      );
      const output = await new PdfFieldFillerService().fillPdf(
        buffer,
        result.validActions,
      );
      const preserved = ['v2', 'explicit-false'].includes(mode);
      expect(await values(output)).toEqual(
        preserved
          ? ['0', true, 'before', ['before'], ['before']]
          : ['after', false, 'after', ['after'], ['after']],
      );
      expect(result.filledFields).toHaveLength(preserved ? 0 : 5);
      if (preserved)
        expect(
          result.skippedFields.every((field) =>
            field.reason.includes('preserved'),
          ),
        ).toBe(true);
    },
  );
  it('v2 fills empty fields and explicit overwrite still undergoes ordinary validation', async () => {
    const buffer = await fixture(false);
    const fields = (await new PdfFieldExtractorService().extractFields(buffer))
      .fields;
    const result = new FormFillValidatorService().validate(
      actions,
      fields,
      new Set(['synthetic.value']),
      0.75,
      {
        fieldPolicies: FormFillFieldPoliciesSchema.parse({
          schemaVersion: 2,
          fields: [],
        }),
      },
    );
    expect(
      await values(
        await new PdfFieldFillerService().fillPdf(buffer, result.validActions),
      ),
    ).toEqual(['after', false, 'after', ['after'], ['after']]);
    const occupied = (
      await new PdfFieldExtractorService().extractFields(await fixture())
    ).fields;
    const invalid = new FormFillValidatorService().validate(
      [{ ...actions[2], value: 'not an option' }],
      occupied,
      new Set(['synthetic.value']),
      0.75,
      {
        fieldPolicies: FormFillFieldPoliciesSchema.parse({
          schemaVersion: 2,
          fields: [{ fieldName: 'radio', overwrite: true }],
        }),
      },
    );
    expect(invalid.validActions).toHaveLength(0);
  });
  it('preserved checkbox occupancy blocks policy synthesis and conflicting group choices', () => {
    const fields: any[] = [
      {
        name: 'checked',
        type: 'checkbox',
        supported: true,
        options: [],
        existingValue: true,
      },
      {
        name: 'alternate',
        type: 'checkbox',
        supported: true,
        options: [],
        existingValue: false,
      },
    ];
    const policies = FormFillFieldPoliciesSchema.parse({
      schemaVersion: 2,
      fields: fields.map((field) => ({
        fieldName: field.name,
        mode: 'fact',
        factKey: 'choice',
        sourceSlugs: ['synthetic.value'],
        when: {
          factKey: 'choice',
          sourceSlugs: ['synthetic.value'],
          equals: 'yes',
        },
        groupId: 'exclusive',
      })),
    });
    const result = new FormFillValidatorService().validate(
      [],
      fields,
      new Set(['synthetic.value']),
      0.75,
      {
        fieldPolicies: policies,
        resolvedFacts: [
          {
            factKey: 'choice',
            value: 'yes',
            sourceSlugs: ['synthetic.value'],
            resolutionKind: 'exact',
          } as any,
        ],
      },
    );
    expect(result.validActions).toEqual([]);
    expect(result.skippedFields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          pdfFieldName: 'checked',
          reason: expect.stringContaining('preserved'),
        }),
        expect.objectContaining({
          pdfFieldName: 'alternate',
          reason: expect.stringContaining('group conflict'),
        }),
      ]),
    );
  });
  it('keeps existing values internal and never serializes them into inference prompts', async () => {
    const fields = (
      await new PdfFieldExtractorService().extractFields(await fixture())
    ).fields;
    expect((fields[0] as any).existingValue).toBe('0');
    const prompt = new FormFillPromptBuilderService().buildPrompt(
      fields.map((field) => ({
        ...field,
        existingValue: 'private-existing-canary',
      })),
      [],
    );
    expect(prompt).not.toContain('private-existing-canary');
    expect(prompt).not.toContain('existingValue');
  });
});
