import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
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
    const analysisId = uuidv4();

    this.logger.log(
      `Starting document analysis ${analysisId} for user ${userId}`,
    );

    try {
      const { suggestions, documentSummary, filteredCount } =
        await this.preferenceExtractionService.extractPreferences(
          userId,
          fileBuffer,
          mimeType,
          filename,
        );

      // Update suggestion IDs to include analysisId
      const suggestionsWithIds = suggestions.map((s, index) => ({
        ...s,
        id: `${analysisId}:${index}`,
      }));

      if (suggestionsWithIds.length === 0) {
        this.logger.log(
          `Analysis ${analysisId} completed with no matches found (filtered: ${filteredCount})`,
        );
        return {
          analysisId,
          suggestions: [],
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
        documentSummary: undefined,
        status: AnalysisStatus.AI_ERROR,
        statusReason: 'AI service unavailable - please try again later',
        filteredCount: 0,
      };
    }
  }
}
