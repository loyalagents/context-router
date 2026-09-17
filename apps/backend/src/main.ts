import { Logger } from '@nestjs/common';
import { resolve } from 'path';
import { bootstrapHostedApplication } from './bootstrap/hosted-bootstrap';
import { formatHostedStartupFailure } from './bootstrap/startup-diagnostics';

const logger = new Logger('Bootstrap');

void bootstrapHostedApplication({
  packageRoot: resolve(__dirname, '..'),
  logger,
}).catch((error: unknown) => {
  logger.error(formatHostedStartupFailure(error));
  process.exit(1);
});
