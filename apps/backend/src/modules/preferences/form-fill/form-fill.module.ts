import { Module } from '@nestjs/common';
import { VertexAiModule } from '../../vertex-ai/vertex-ai.module';
import { PreferenceModule } from '../preference/preference.module';
import { FormFillController } from './form-fill.controller';
import { FormFillService } from './form-fill.service';
import { FormFillPromptBuilderService } from './form-fill-prompt-builder.service';
import { FormFillValidatorService } from './form-fill-validator.service';
import { PdfFieldExtractorService } from './pdf-field-extractor.service';
import { PdfFieldFillerService } from './pdf-field-filler.service';

@Module({
  imports: [PreferenceModule, VertexAiModule],
  controllers: [FormFillController],
  providers: [
    FormFillService,
    FormFillPromptBuilderService,
    FormFillValidatorService,
    PdfFieldExtractorService,
    PdfFieldFillerService,
  ],
  exports: [FormFillService],
})
export class FormFillModule {}
