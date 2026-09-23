import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { DocumentAnalysisController } from './document-analysis.controller';
import { DocumentAnalysisService } from './document-analysis.service';
import { DocumentAnalysisResolver } from './document-analysis.resolver';
import { PreferenceExtractionService } from './preference-extraction.service';
import { PreferenceModule } from '../preference/preference.module';
import { PreferenceDefinitionModule } from '../preference-definition/preference-definition.module';

@Module({
  imports: [
    MulterModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        limits: {
          fileSize: configService.getOrThrow<number>(
            'documentUpload.maxFileSizeBytes',
          ),
        },
      }),
    }),
    PreferenceModule,
    PreferenceDefinitionModule,
  ],
  controllers: [DocumentAnalysisController],
  providers: [
    DocumentAnalysisService,
    DocumentAnalysisResolver,
    PreferenceExtractionService,
  ],
  exports: [DocumentAnalysisService],
})
export class DocumentAnalysisModule {}
