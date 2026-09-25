import { DynamicModule, Global, Module } from '@nestjs/common';
import { AI_STRUCTURED_OUTPUT_PORT, AI_TEXT_GENERATOR_PORT } from '../domains/shared/ports/ai.tokens';
import { LocalModelService, ManualModelConfiguration } from '../infrastructure/local-model/local-model.service';

@Global()
@Module({})
export class LocalConfiguredModelModule {
  static register(configuration: ManualModelConfiguration): DynamicModule {
    const snapshot = Object.freeze({ ...configuration });
    return {
      module: LocalConfiguredModelModule,
      providers: [
        { provide: LocalModelService, useFactory: () => new LocalModelService(snapshot) },
        { provide: AI_TEXT_GENERATOR_PORT, useExisting: LocalModelService },
        { provide: AI_STRUCTURED_OUTPUT_PORT, useExisting: LocalModelService },
      ],
      exports: [AI_TEXT_GENERATOR_PORT, AI_STRUCTURED_OUTPUT_PORT],
    };
  }
}
