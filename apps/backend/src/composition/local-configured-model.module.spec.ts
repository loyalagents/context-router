import { Test } from '@nestjs/testing';
import { AI_STRUCTURED_OUTPUT_PORT, AI_TEXT_GENERATOR_PORT } from '../domains/shared/ports/ai.tokens';
import { LocalModelService } from '../infrastructure/local-model/local-model.service';
import { LocalConfiguredModelModule } from './local-configured-model.module';

describe('manual model composition', () => {
  it('aliases both ports to one lazy session without requiring available credentials or runtime at startup', async () => {
    const module = await Test.createTestingModule({ imports: [LocalConfiguredModelModule.register({
      root: '/private/missing-session', identityRoot: '/private/missing-identity', databaseRoot: '/private/missing-data', port: 18090,
    })] }).compile();
    await module.init();
    const text = module.get(AI_TEXT_GENERATOR_PORT);
    expect(text).toBeInstanceOf(LocalModelService);
    expect(module.get(AI_STRUCTURED_OUTPUT_PORT)).toBe(text);
    expect(text.capabilities.strictExecutionControls).toBe(true);
    expect(text.initialization).toBeUndefined();
    const close = jest.spyOn(text, 'onModuleDestroy');
    await module.close();
    expect(close).toHaveBeenCalledTimes(1);
  });
});
