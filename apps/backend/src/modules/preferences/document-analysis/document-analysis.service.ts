import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PreferenceExtractionService } from './preference-extraction.service';
import {
  DocumentAnalysisResult,
  AnalysisStatus,
} from './dto/document-analysis-result.dto';

@Injectable()
export class DocumentAnalysisService {
  private readonly logger = new Logger(DocumentAnalysisService.name);

  constructor(
    private readonly preferenceExtractionService: PreferenceExtractionService,
  ) {}

  async analyzeDocument(
    userId: string,
    fileBuffer: Buffer,
    mimeType: string,
    filename: string,
  ): Promise<DocumentAnalysisResult> {
    const analysisId = randomUUID();

    this.logger.log(
      `Starting document analysis ${analysisId} for user ${userId}`,
    );

    try {
      const { suggestions, filteredSuggestions, documentSummary, filteredCount } =
        await this.preferenceExtractionService.extractPreferences(
          userId,
          fileBuffer,
          mimeType,
          filename,
        );

      // Prefix stable extraction IDs with the analysisId without reindexing.
      const suggestionsWithIds = suggestions.map((s) => ({
        ...s,
        id: `${analysisId}:${s.id}`,
      }));

      // Prefix filtered suggestion IDs as well without reindexing.
      const filteredWithIds = filteredSuggestions.map((s) => ({
        ...s,
        id: `${analysisId}:${s.id}`,
      }));

      if (suggestionsWithIds.length === 0) {
        this.logger.log(
          `Analysis ${analysisId} completed with no matches found (filtered: ${filteredCount})`,
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
        `Analysis ${analysisId} completed with ${suggestionsWithIds.length} suggestions (filtered: ${filteredCount})`,
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
      this.logger.error(`Analysis ${analysisId} failed`, error);

      // Distinguish between parse errors and AI service errors
      if (error instanceof Error) {
        if (error.message.includes('parse')) {
          return {
            analysisId,
            suggestions: [],
            filteredSuggestions: [],
            documentSummary: undefined,
            status: AnalysisStatus.PARSE_ERROR,
            statusReason: 'AI response could not be parsed - please try again',
            filteredCount: 0,
          };
        }
      }

      return {
        analysisId,
        suggestions: [],
        filteredSuggestions: [],
        documentSummary: undefined,
        status: AnalysisStatus.AI_ERROR,
        statusReason: 'AI service unavailable - please try again later',
        filteredCount: 0,
      };
    }
  }
}
