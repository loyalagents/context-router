import { registerAs } from '@nestjs/config';
import type { RuntimeConfiguration } from './runtime-config';

export function appConfigLoader(
  configuration: RuntimeConfiguration,
  environment: NodeJS.ProcessEnv,
) {
  const rawNodeEnv = environment.NODE_ENV;
  const nodeEnv = rawNodeEnv || 'development';

  return registerAs('app', () => ({
    nodeEnv,
    port: configuration.port,
    isDevelopment: rawNodeEnv === 'development',
    isProduction: rawNodeEnv === 'production',
    enableDemoReset: environment.ENABLE_DEMO_RESET === 'true',
  }));
}
