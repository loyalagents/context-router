import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AiStructuredOutputPort } from '../../../domains/shared/ports/ai-structured-output.port';
import { getFormFillConfig } from '../../../config/form-fill.config';
import { PreferenceService } from '../preference/preference.service';
import { PdfFieldExtractorService } from './pdf-field-extractor.service';
import { FormFillPromptBuilderService } from './form-fill-prompt-builder.service';
import { FormFillValidatorService } from './form-fill-validator.service';
import { PdfFieldFillerService } from './pdf-field-filler.service';
import {
  FormFillFieldPolicies,
  FormFillAiResponseSchema,
  FormFillResponse,
  FormFillStatus,
  FormFillSummary,
} from './form-fill.types';

@Injectable()
export class FormFillService {
  private readonly logger = new Logger(FormFillService.name);
  private readonly config = getFormFillConfig();

  constructor(
    @Inject('AiStructuredOutputPort')
    private readonly aiStructuredService: AiStructuredOutputPort,
    private readonly preferenceService: PreferenceService,
    private readonly fieldExtractor: PdfFieldExtractorService,
    private readonly promptBuilder: FormFillPromptBuilderService,
    private readonly validator: FormFillValidatorService,
    private readonly pdfFiller: PdfFieldFillerService,
  ) {}

  async fillPdfForm(
    userId: string,
    fileBuffer: Buffer,
    filename: string,
    fieldPolicies?: FormFillFieldPolicies,
  ): Promise<FormFillResponse> {
    const fillId = randomUUID();
    const outputFilename = this.outputFilename(filename);

    this.logger.log(
      `Starting form fill ${fillId} for user ${userId}: ${filename}`,
    );

    try {
      const extracted = await this.fieldExtractor.extractFields(fileBuffer);

      if (extracted.hasXfa) {
        return this.emptyResponse(
          fillId,
          'unsupported_format',
          filename,
          outputFilename,
          ['XFA forms are not supported.'],
        );
      }

      if (extracted.fields.length === 0) {
        return this.emptyResponse(
          fillId,
          'no_fillable_fields',
          filename,
          outputFilename,
          ['No AcroForm fields were found in the PDF.'],
        );
      }

      const preferences =
        await this.preferenceService.getActivePreferences(userId);
      const prompt = this.promptBuilder.buildPrompt(
        extracted.fields,
        preferences.map((preference) => ({
          slug: preference.slug,
          value: preference.value,
          description: preference.description,
        })),
        fieldPolicies,
      );

      const aiResult = await this.aiStructuredService.generateStructured(
        prompt,
        FormFillAiResponseSchema,
        { operationName: 'formFill.fillActions' },
      );

      const validation = this.validator.validate(
        aiResult.fillActions,
        extracted.fields,
        new Set(preferences.map((preference) => preference.slug)),
        this.config.confidenceThreshold,
        {
          fieldPolicies,
          activePreferenceValues: new Map(
            preferences.map((preference) => [
              preference.slug,
              preference.value,
            ]),
          ),
        },
      );

      const filledPdf = await this.pdfFiller.fillPdf(
        fileBuffer,
        validation.validActions,
      );

      const summary: FormFillSummary = {
        totalFields: extracted.fields.length,
        filledCount: validation.filledFields.length,
        skippedCount: validation.skippedFields.length,
        filledFields: validation.filledFields,
        skippedFields: validation.skippedFields,
        warnings: validation.warnings,
        validationEvents: validation.validationEvents,
      };

      const status: FormFillStatus =
        summary.skippedCount === 0 && summary.filledCount > 0
          ? 'success'
          : 'partial';

      this.logger.log(
        `Form fill ${fillId} completed with status ${status}: ${summary.filledCount} filled, ${summary.skippedCount} skipped`,
      );

      return {
        fillId,
        status,
        originalFilename: filename,
        outputFilename,
        outputMimeType: 'application/pdf',
        filledPdfBase64: filledPdf.toString('base64'),
        summary,
      };
    } catch (error) {
      this.logger.error(`Form fill ${fillId} failed`, error);
      return this.emptyResponse(fillId, 'failed', filename, outputFilename, [
        'Form fill failed. Please try again.',
      ]);
    }
  }

  private emptyResponse(
    fillId: string,
    status: Extract<FormFillStatus, 'no_fillable_fields' | 'unsupported_format' | 'failed'>,
    originalFilename: string,
    outputFilename: string,
    warnings: string[],
  ): FormFillResponse {
    return {
      fillId,
      status,
      originalFilename,
      outputFilename,
      outputMimeType: 'application/pdf',
      filledPdfBase64: null,
      summary: {
        totalFields: 0,
        filledCount: 0,
        skippedCount: 0,
        filledFields: [],
        skippedFields: [],
        warnings,
      },
    };
  }

  private outputFilename(filename: string): string {
    const baseName =
      filename.replace(/\.pdf$/i, '').replace(/[^a-zA-Z0-9._-]+/g, '-') ||
      'form';
    const trimmed = baseName.replace(/^-+|-+$/g, '') || 'form';
    return `filled-${trimmed}.pdf`;
  }
}
