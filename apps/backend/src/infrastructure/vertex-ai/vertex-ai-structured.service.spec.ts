import { Logger } from '@nestjs/common';
import { FormFillAiResponseSchema } from '../../modules/preferences/form-fill/form-fill.types';
import { VertexAiStructuredService } from './vertex-ai-structured.service';
import { VertexAiService } from './vertex-ai.service';

describe('VertexAiStructuredService', () => {
  let service: VertexAiStructuredService;
  let vertexAiService: { generateText: jest.Mock; generateTextWithFile: jest.Mock };

  beforeEach(() => {
    vertexAiService = {
      generateText: jest.fn(),
      generateTextWithFile: jest.fn(),
    };
    service = new VertexAiStructuredService(
      vertexAiService as unknown as VertexAiService,
    );

    jest.spyOn(Logger.prototype, 'debug').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('warns when form-fill actions contain null values that will be normalized', async () => {
    const warnSpy = jest.spyOn(Logger.prototype, 'warn');
    vertexAiService.generateText.mockResolvedValue(
      JSON.stringify({
        fillActions: [
          {
            fieldName: 'topmostSubform[0].Page1[0].xcheck[0]',
            action: 'CHECK',
            value: null,
            sourceSlugs: ['direct_deposit.account_type'],
            confidence: 0.95,
          },
          {
            fieldName: 'topmostSubform[0].Page1[0].inst[0]',
            action: 'SET_TEXT',
            value: 'Bay Harbor Credit Union',
            sourceSlugs: ['direct_deposit.bank_name'],
            confidence: 0.95,
          },
        ],
      }),
    );

    const result = await service.generateStructured(
      'prompt',
      FormFillAiResponseSchema,
      {
        operationName: 'formFill.fillActions',
        retries: 0,
      },
    );

    expect(result.fillActions[0].value).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        '[formFill.fillActions] Normalized null fill action value(s) to omitted values: count=1',
      ),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        '0:CHECK:"topmostSubform[0].Page1[0].xcheck[0]"',
      ),
    );
  });

  it('does not warn about null values for unrelated structured operations', async () => {
    const warnSpy = jest.spyOn(Logger.prototype, 'warn');
    vertexAiService.generateText.mockResolvedValue(
      JSON.stringify({
        fillActions: [
          {
            fieldName: 'field',
            action: 'CHECK',
            value: null,
          },
        ],
      }),
    );

    await service.generateStructured('prompt', FormFillAiResponseSchema, {
      operationName: 'otherOperation',
      retries: 0,
    });

    expect(warnSpy).not.toHaveBeenCalled();
  });
});
