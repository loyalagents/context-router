import {
  Controller,
  Post,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  Request,
  Logger,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { DocumentAnalysisService } from './document-analysis.service';
import { DocumentAnalysisResult } from './dto/document-analysis-result.dto';
import { getDocumentUploadConfig } from '../../../config/document-upload.config';

// TODO: Implement rate limiting per user to prevent abuse and control Vertex AI costs

@Controller('api/preferences')
@UseGuards(JwtAuthGuard)
export class DocumentAnalysisController {
  private readonly logger = new Logger(DocumentAnalysisController.name);
  private readonly config = getDocumentUploadConfig();

  constructor(
    private readonly documentAnalysisService: DocumentAnalysisService,
  ) {}

  @Post('analysis')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        fileSize: getDocumentUploadConfig().maxFileSizeBytes,
      },
    }),
  )
  async analyzeDocument(
    @UploadedFile() file: Express.Multer.File,
    @Request() req: any,
  ): Promise<DocumentAnalysisResult> {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    // Validate MIME type server-side
    if (!this.config.allowedMimeTypes.includes(file.mimetype)) {
      throw new BadRequestException(
        `Unsupported file type: ${file.mimetype}. Allowed types: ${this.config.allowedMimeTypes.join(', ')}`,
      );
    }

    // Additional size check (belt and suspenders)
    if (file.size > this.config.maxFileSizeBytes) {
      throw new BadRequestException(
        `File too large: ${file.size} bytes. Maximum size: ${this.config.maxFileSizeBytes} bytes`,
      );
    }

    const userId = req.user?.userId;
    if (!userId) {
      throw new BadRequestException('User ID not found in request');
    }

    this.logger.log(
      `Analyzing document for user ${userId}: ${file.originalname} (${file.mimetype}, ${file.size} bytes)`,
    );

    return this.documentAnalysisService.analyzeDocument(
      userId,
      file.buffer,
      file.mimetype,
      file.originalname,
    );
  }
}
