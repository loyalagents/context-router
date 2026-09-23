import {
  BadRequestException,
  Body,
  Controller,
  Logger,
  Post,
  Request,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import type { FormFillConfig } from '../../../config/form-fill.config';
import { FormFillService } from './form-fill.service';
import {
  FormFillFieldPolicies,
  FormFillFieldPoliciesSchema,
  FormFillResponse,
} from './form-fill.types';

@Controller('api/form-fill')
@UseGuards(JwtAuthGuard)
export class FormFillController {
  private readonly logger = new Logger(FormFillController.name);
  private readonly config: Pick<
    FormFillConfig,
    'allowedMimeTypes' | 'maxFileSizeBytes'
  >;

  constructor(
    private readonly formFillService: FormFillService,
    configService: ConfigService,
  ) {
    this.config = {
      allowedMimeTypes: configService.getOrThrow<string[]>(
        'formFill.allowedMimeTypes',
      ),
      maxFileSizeBytes: configService.getOrThrow<number>(
        'formFill.maxFileSizeBytes',
      ),
    };
  }

  @Post('pdf')
  @UseInterceptors(FileInterceptor('file'))
  async fillPdf(
    @UploadedFile() file: Express.Multer.File,
    @Request() req: any,
    @Body('fieldPolicies') fieldPoliciesRaw?: string,
  ): Promise<FormFillResponse> {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    if (!this.config.allowedMimeTypes.includes(file.mimetype)) {
      throw new BadRequestException(
        `Unsupported file type: ${file.mimetype}. Allowed types: ${this.config.allowedMimeTypes.join(', ')}`,
      );
    }

    if (file.size > this.config.maxFileSizeBytes) {
      throw new BadRequestException(
        `File too large: ${file.size} bytes. Maximum size: ${this.config.maxFileSizeBytes} bytes`,
      );
    }

    const userId = req.user?.userId;
    if (!userId) {
      throw new BadRequestException('User ID not found in request');
    }

    this.logger.log('Filling an authenticated PDF upload');

    return this.formFillService.fillPdfForm(
      userId,
      file.buffer,
      file.originalname,
      this.parseFieldPolicies(fieldPoliciesRaw),
    );
  }

  private parseFieldPolicies(
    raw: string | undefined,
  ): FormFillFieldPolicies | undefined {
    if (!raw) {
      return undefined;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new BadRequestException('fieldPolicies must be valid JSON');
    }

    const result = FormFillFieldPoliciesSchema.safeParse(parsed);
    if (!result.success) {
      throw new BadRequestException(
        `fieldPolicies are invalid: ${result.error.message}`,
      );
    }

    return result.data;
  }
}
