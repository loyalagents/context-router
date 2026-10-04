import { AiError, type AiExecutionOptions } from '../../../domains/shared/ports/ai-execution';
import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PreferenceExtractionService } from './preference-extraction.service';
import { ReviewedSuggestionService } from './reviewed-suggestion.service';
import {
  DocumentAnalysisResult,
  AnalysisStatus,
} from './dto/document-analysis-result.dto';

const AI_PROVIDER_FILE_TYPE_REJECTION_REASON =
  'AI could not analyze this uploaded file type. Please try converting it to plain text before uploading again.';

const AI_PROVIDER_FILE_TYPE_ERROR_PATTERNS = [
  'unsupported mime',
  'unsupported file',
  'invalid mime',
  'mime type',
  'file type',
];

@Injectable()
export class DocumentAnalysisService {
  private readonly logger = new Logger(DocumentAnalysisService.name);

  constructor(
    private readonly preferenceExtractionService: PreferenceExtractionService,
    private readonly reviewed: ReviewedSuggestionService,
  ) {}

  async analyzeDocument(
    userId: string,
    fileBuffer: Buffer,
    mimeType: string,
    filename: string,
    options?: AiExecutionOptions,
  ): Promise<DocumentAnalysisResult> {
    const analysisId = randomUUID();

    this.logger.log('Starting authenticated document analysis');

    try {
      this.checkExecution(options);
      const {
        suggestions,
        filteredSuggestions,
        documentSummary,
        filteredCount,
      } = await this.preferenceExtractionService.extractPreferences(
        userId,
        fileBuffer,
        mimeType,
        filename,
        ...(options ? [options] : []),
      );

      this.checkExecution(options);
      // Prefix stable extraction IDs with the analysisId without reindexing.
      const suggestionsWithIds = await this.reviewed.prepare(userId, suggestions.map((s) => ({
        ...s,
        id: `${analysisId}:${s.id}`,
      })));

      this.checkExecution(options);
      // Prefix filtered suggestion IDs as well without reindexing.
      const filteredWithIds = filteredSuggestions.map((s) => ({
        ...s,
        id: `${analysisId}:${s.id}`,
      }));

      if (suggestionsWithIds.length === 0) {
        this.logger.log(
          `Document analysis completed with no matches (filtered: ${filteredCount})`,
        );
        return {
          analysisId,
          suggestions: [],
          filteredSuggestions: filteredWithIds,
          documentSummary,
          status: AnalysisStatus.NO_MATCHES,
          statusReason: 'No preference-related information found in document',
          filteredCount,
        };
      }

      this.logger.log(
        `Document analysis completed with ${suggestionsWithIds.length} suggestions (filtered: ${filteredCount})`,
      );

      return {
        analysisId,
        suggestions: suggestionsWithIds,
        filteredSuggestions: filteredWithIds,
        documentSummary,
        status: AnalysisStatus.SUCCESS,
        statusReason: undefined,
        filteredCount,
      };
    } catch (error) {
      this.logger.error('Document analysis failed');

      // Distinguish between parse errors and AI service errors
      if (error instanceof Error) {
        if (error instanceof AiError ? error.kind === 'invalid_response' : error.message.includes('parse')) {
          return {
            analysisId,
            suggestions: [],
            filteredSuggestions: [],
            documentSummary: undefined,
            status: AnalysisStatus.PARSE_ERROR,
            ...(error instanceof AiError ? { failureCategory: error.kind } : {}),
            statusReason: 'AI response could not be parsed - please try again',
            filteredCount: 0,
          };
        }
      }

      if (this.isAiProviderFileTypeError(error)) {
        return {
          analysisId,
          suggestions: [],
          filteredSuggestions: [],
          documentSummary: undefined,
          status: AnalysisStatus.AI_ERROR,
          statusReason: AI_PROVIDER_FILE_TYPE_REJECTION_REASON,
          ...(error instanceof AiError ? { failureCategory: error.kind } : {}),
          filteredCount: 0,
        };
      }

      const localReasons = {
        cancelled: 'Document analysis cancelled. No proposals were published.',
        deadline: 'Document analysis reached its deadline. No proposals were published.',
        input_limit: 'Document analysis input is too large. Try a smaller document.',
        context_limit: 'Document analysis exceeds the local model context. Try a smaller document.',
        busy: 'The local model is busy. Wait for the current operation to finish.',
        unavailable: 'The local model is unavailable. Check its setup. If a model session is already configured, follow the manual recovery instructions.',
        unsafe_configuration: 'The local model configuration is unavailable. Check its setup. If a model session is already configured, follow the manual recovery instructions.',
      };
      return {
        analysisId,
        suggestions: [],
        filteredSuggestions: [],
        documentSummary: undefined,
        status: AnalysisStatus.AI_ERROR,
        ...(error instanceof AiError ? { failureCategory: error.kind } : {}),
        statusReason: error instanceof AiError && Object.prototype.hasOwnProperty.call(localReasons, error.kind)
          ? localReasons[error.kind]
          : 'AI service unavailable - please try again later',
        filteredCount: 0,
      };
    }
  }

  private checkExecution(options?: AiExecutionOptions): void {
    if (options?.signal?.aborted) throw new AiError('cancelled');
    if (options?.deadline !== undefined && (!Number.isFinite(options.deadline) || performance.now() >= options.deadline)) throw new AiError('deadline');
  }

  private isAiProviderFileTypeError(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }

    if (error instanceof AiError) return error.kind === 'unsupported';
    const message = error.message.toLowerCase();
    return AI_PROVIDER_FILE_TYPE_ERROR_PATTERNS.some((pattern) =>
      message.includes(pattern),
    );
  }
}
