import { PDFDocument } from 'pdf-lib';
import { DocumentAnalysisController } from '../modules/preferences/document-analysis/document-analysis.controller';
import { FormFillController } from '../modules/preferences/form-fill/form-fill.controller';
import {
  LOCAL_AI_CAPABILITIES,
  UNAVAILABLE_AI_CAPABILITIES,
} from '../domains/shared/ports/ai-execution';
import { createLocalUiAiPolicy, validateLocalUpload } from './local-ui-ai';
import { UI_EXECUTION, UI_UPLOAD_POLICY } from './local-ui-request';
import { PreferenceSearchResolver } from '../modules/workflows/preferences/preference-search/preference-search.resolver';

const configuration = {
  getOrThrow: (key: string) =>
    ({
      'documentUpload.allowedMimeTypes': [
        ...LOCAL_AI_CAPABILITIES.fileMimeTypes,
        'image/png',
      ],
      'documentUpload.maxFileSizeBytes': 1024,
      'formFill.allowedMimeTypes': ['application/pdf'],
      'formFill.maxFileSizeBytes': 2048,
      'mcp.tools.preferences.maxSearchResults': 20,
    })[key],
} as any;
const file = (
  mimetype: string,
  buffer: Buffer = Buffer.from('synthetic text'),
) =>
  ({
    mimetype,
    buffer,
    size: buffer.length,
    originalname: 'synthetic',
  }) as Express.Multer.File;

describe('local UI AI request admission and controls', () => {
  it('intersects selected ports and upload configuration, retaining all qualified local formats', () => {
    const policy = createLocalUiAiPolicy(
      LOCAL_AI_CAPABILITIES,
      LOCAL_AI_CAPABILITIES,
      configuration,
    );
    expect(policy.analysis.mimeTypes).toEqual(
      LOCAL_AI_CAPABILITIES.fileMimeTypes,
    );
    expect(policy.analysis.maxFileSizeBytes).toBe(1024);
    expect(policy.formFill.maxFileSizeBytes).toBe(2048);
    expect(
      createLocalUiAiPolicy(
        UNAVAILABLE_AI_CAPABILITIES,
        UNAVAILABLE_AI_CAPABILITIES,
        configuration,
      ).analysis.mimeTypes,
    ).toEqual([]);
    const restricted = createLocalUiAiPolicy(
      LOCAL_AI_CAPABILITIES,
      { ...LOCAL_AI_CAPABILITIES, fileMimeTypes: ['text/markdown'] },
      configuration,
    );
    expect(restricted.analysis.mimeTypes).toEqual(['text/markdown']);
  });
  it.each(LOCAL_AI_CAPABILITIES.fileMimeTypes)(
    'admits %s and preserves the request signal/deadline through document control',
    async (mime) => {
      const buffer =
        mime === 'application/pdf'
          ? Buffer.from(await (await PDFDocument.create()).save())
          : Buffer.from('synthetic: text');
      const options = Object.freeze({
        signal: new AbortController().signal,
        deadline: performance.now() + 10000,
      });
      const service = { analyzeDocument: jest.fn().mockResolvedValue({}) };
      const controller = new DocumentAnalysisController(
        service as any,
        configuration,
      );
      await controller.analyzeDocument(file(mime, buffer), {
        user: { userId: 'owner' },
        [UI_EXECUTION]: options,
        [UI_UPLOAD_POLICY]: createLocalUiAiPolicy(
          LOCAL_AI_CAPABILITIES,
          LOCAL_AI_CAPABILITIES,
          configuration,
        ),
      });
      expect(service.analyzeDocument.mock.calls[0][4]).toBe(options);
    },
  );
  it.each([
    ['image/png', Buffer.from('synthetic')],
    ['text/plain', Buffer.from([0xc0, 0xaf])],
    ['text/plain', Buffer.from('a\0b')],
    ['application/pdf', Buffer.from('fake PDF')],
    ['application/pdf', Buffer.from('%PDF-1.7\nmalformed')],
    ['text/plain', Buffer.alloc(1025, 65)],
  ])(
    'rejects invalid local %s input before any model/use-case call',
    async (mime, buffer) => {
      const service = { analyzeDocument: jest.fn() };
      const controller = new DocumentAnalysisController(
        service as any,
        configuration,
      );
      await expect(
        controller.analyzeDocument(file(mime as string, buffer as Buffer), {
          user: { userId: 'owner' },
          [UI_UPLOAD_POLICY]: createLocalUiAiPolicy(
            LOCAL_AI_CAPABILITIES,
            LOCAL_AI_CAPABILITIES,
            configuration,
          ),
        }),
      ).rejects.toThrow();
      expect(service.analyzeDocument).not.toHaveBeenCalled();
    },
  );
  it('performs only envelope checks before handing PDF bytes to the bounded parser', async () => {
    const load = jest
      .spyOn(PDFDocument, 'load')
      .mockRejectedValue(new Error('shared parser must not run'));
    try {
      await expect(
        validateLocalUpload(
          file(
            'application/pdf',
            Buffer.from(
              '%PDF-1.7\nstructural checking belongs in the child\n%%EOF',
            ),
          ),
          {
            mimeTypes: ['application/pdf'],
            maxFileSizeBytes: 1024,
          },
        ),
      ).resolves.toBeUndefined();
      expect(load).not.toHaveBeenCalled();
    } finally {
      load.mockRestore();
    }
  });
  it('uses real buffer size, forwards form controls/v2, and forwards GraphQL search controls', async () => {
    const options = Object.freeze({
      signal: new AbortController().signal,
      deadline: performance.now() + 10000,
    });
    const request = {
      user: { userId: 'owner' },
      [UI_EXECUTION]: options,
      [UI_UPLOAD_POLICY]: createLocalUiAiPolicy(
        LOCAL_AI_CAPABILITIES,
        LOCAL_AI_CAPABILITIES,
        configuration,
      ),
    };
    const formService = { fillPdfForm: jest.fn().mockResolvedValue({}) };
    const form = new FormFillController(formService as any, configuration);
    const upload = file(
      'application/pdf',
      Buffer.from(await (await PDFDocument.create()).save()),
    );
    await form.fillPdf(
      upload,
      request,
      JSON.stringify({ schemaVersion: 2, fields: [] }),
    );
    expect(formService.fillPdfForm.mock.calls[0][4]).toBe(options);
    expect(formService.fillPdfForm.mock.calls[0][3]).toEqual({
      schemaVersion: 2,
      fields: [],
    });
    await expect(
      form.fillPdf({ ...upload, size: 1 }, request),
    ).rejects.toThrow();
    const workflow = { run: jest.fn().mockResolvedValue({}) };
    await new PreferenceSearchResolver(
      workflow as any,
      configuration,
    ).smartSearchPreferences(
      { userId: 'owner' } as any,
      { query: 'synthetic' },
      { req: request as any },
    );
    expect(workflow.run.mock.calls[0][1]).toBe(options);
  });
});
