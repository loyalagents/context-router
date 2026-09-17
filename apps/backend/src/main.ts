import { Logger } from '@nestjs/common';
import { resolve } from 'path';
import { bootstrapHostedApplication } from './bootstrap/hosted-bootstrap';

const logger = new Logger('Bootstrap');

void bootstrapHostedApplication({
  packageRoot: resolve(__dirname, '..'),
  logger,
}).catch(() => {
  logger.error('Application failed to start');
  process.exit(1);
});
