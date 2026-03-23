import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { z } from 'zod';
import { VertexAiStructuredService } from '../../src/infrastructure/vertex-ai/vertex-ai-structured.service';
import { VertexAiService } from '../../src/infrastructure/vertex-ai/vertex-ai.service';

const TestSchema = z.object({
  name: z.string(),
  value: z.number(),
});

describe('VertexAiStructuredService', () => {
  let service: VertexAiStructuredService;
  let mockVertexAi: { generateText: jest.Mock; generateTextWithFile: jest.Mock };

  beforeEach(async () => {
    mockVertexAi = {
      generateText: jest.fn(),
      generateTextWithFile: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VertexAiStructuredService,
        { provide: VertexAiService, useValue: mockVertexAi },
      ],
    }).compile();

    service = module.get(VertexAiStructuredService);

    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    jest.spyOn(Logger.prototype, 'debug').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('generateStructured', () => {
    it('should parse valid JSON and return typed data', async () => {
      mockVertexAi.generateText.mockResolvedValue(
        JSON.stringify({ name: 'test', value: 42 }),
      );

      const result = await service.generateStructured('prompt', TestSchema);

      expect(result).toEqual({ name: 'test', value: 42 });
    });

    it('should strip markdown json fences before parsing', async () => {
      mockVertexAi.generateText.mockResolvedValue(
        '```json\n{"name": "test", "value": 42}\n```',
      );

      const result = await service.generateStructured('prompt', TestSchema);

      expect(result).toEqual({ name: 'test', value: 42 });
    });

    it('should strip plain markdown fences before parsing', async () => {
      mockVertexAi.generateText.mockResolvedValue(
        '```\n{"name": "test", "value": 42}\n```',
      );

      const result = await service.generateStructured('prompt', TestSchema);

      expect(result).toEqual({ name: 'test', value: 42 });
    });

    it('should escape literal newlines inside JSON strings', async () => {
      mockVertexAi.generateText.mockResolvedValue(
        '{"name": "hello\nworld", "value": 1}',
      );

      const result = await service.generateStructured('prompt', TestSchema);

      expect(result).toEqual({ name: 'hello\nworld', value: 1 });
    });

    it('should throw on non-JSON response when retries exhausted', async () => {
      mockVertexAi.generateText.mockResolvedValue('not json at all');

      await expect(
        service.generateStructured('prompt', TestSchema, { retries: 0 }),
      ).rejects.toThrow('Failed to parse AI response as JSON');
    });

    it('should throw on Zod validation failure when retries exhausted', async () => {
      mockVertexAi.generateText.mockResolvedValue(
        JSON.stringify({ name: 'test', value: 'not-a-number' }),
      );

      await expect(
        service.generateStructured('prompt', TestSchema, { retries: 0 }),
      ).rejects.toThrow('AI response failed validation');
    });

    it('should retry with correction prompt on JSON parse failure', async () => {
      mockVertexAi.generateText
        .mockResolvedValueOnce('invalid json')
        .mockResolvedValueOnce(JSON.stringify({ name: 'fixed', value: 1 }));

      const result = await service.generateStructured('prompt', TestSchema, {
        retries: 1,
      });

      expect(result).toEqual({ name: 'fixed', value: 1 });
      expect(mockVertexAi.generateText).toHaveBeenCalledTimes(2);
      // Verify correction prompt includes error context
      const correctionPrompt = mockVertexAi.generateText.mock.calls[1][0];
      expect(correctionPrompt).toContain('previous response was invalid');
      expect(correctionPrompt).toContain('invalid json');
    });

    it('should retry with correction prompt on Zod validation failure', async () => {
      mockVertexAi.generateText
        .mockResolvedValueOnce(
          JSON.stringify({ name: 'test', value: 'wrong-type' }),
        )
        .mockResolvedValueOnce(JSON.stringify({ name: 'test', value: 42 }));

      const result = await service.generateStructured('prompt', TestSchema, {
        retries: 1,
      });

      expect(result).toEqual({ name: 'test', value: 42 });
      expect(mockVertexAi.generateText).toHaveBeenCalledTimes(2);
    });

    it('should throw after exhausting all retries', async () => {
      mockVertexAi.generateText.mockResolvedValue('always invalid');

      await expect(
        service.generateStructured('prompt', TestSchema, { retries: 1 }),
      ).rejects.toThrow('Failed to parse AI response as JSON');

      // 1 original + 1 retry
      expect(mockVertexAi.generateText).toHaveBeenCalledTimes(2);
    });

    it('should pass operationName through to error messages', async () => {
      mockVertexAi.generateText.mockResolvedValue('bad');

      await expect(
        service.generateStructured('prompt', TestSchema, {
          retries: 0,
          operationName: 'myOp',
        }),
      ).rejects.toThrow('[myOp]');
    });

    it('should default retries to 1 when not specified', async () => {
      mockVertexAi.generateText
        .mockResolvedValueOnce('bad')
        .mockResolvedValueOnce('still bad');

      await expect(
        service.generateStructured('prompt', TestSchema),
      ).rejects.toThrow();

      // 1 original + 1 default retry
      expect(mockVertexAi.generateText).toHaveBeenCalledTimes(2);
    });
  });

  describe('generateStructuredWithFile', () => {
    const mockFile = { buffer: Buffer.from('test'), mimeType: 'text/plain' };

    it('should parse valid JSON from file-based call', async () => {
      mockVertexAi.generateTextWithFile.mockResolvedValue(
        JSON.stringify({ name: 'from-file', value: 99 }),
      );

      const result = await service.generateStructuredWithFile(
        'prompt',
        mockFile,
        TestSchema,
      );

      expect(result).toEqual({ name: 'from-file', value: 99 });
      expect(mockVertexAi.generateTextWithFile).toHaveBeenCalledWith(
        'prompt',
        mockFile,
      );
    });

    it('should strip fences from file-based call', async () => {
      mockVertexAi.generateTextWithFile.mockResolvedValue(
        '```json\n{"name": "fenced", "value": 7}\n```',
      );

      const result = await service.generateStructuredWithFile(
        'prompt',
        mockFile,
        TestSchema,
      );

      expect(result).toEqual({ name: 'fenced', value: 7 });
    });

    it('should retry via generateText (not generateTextWithFile) on failure', async () => {
      mockVertexAi.generateTextWithFile.mockResolvedValue('bad json');
      mockVertexAi.generateText.mockResolvedValue(
        JSON.stringify({ name: 'corrected', value: 5 }),
      );

      const result = await service.generateStructuredWithFile(
        'prompt',
        mockFile,
        TestSchema,
        { retries: 1 },
      );

      expect(result).toEqual({ name: 'corrected', value: 5 });
      expect(mockVertexAi.generateTextWithFile).toHaveBeenCalledTimes(1);
      expect(mockVertexAi.generateText).toHaveBeenCalledTimes(1);
    });
  });
});
