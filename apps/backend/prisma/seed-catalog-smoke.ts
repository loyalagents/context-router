/**
 * Test-only catalog seed entry point used by the local-migration restart smoke.
 * Unlike the normal seed command, this deliberately does not create sample
 * users or print database records.
 */
import { PrismaClient } from '../src/infrastructure/prisma/generated-client';
import { buildPrismaClientOptions } from '../src/infrastructure/prisma/prisma-client-options';
import { seedPreferenceDefinitions } from './seed';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { PreferenceDefinition } from '../src/config/preferences.catalog';

const prisma = new PrismaClient(
  buildPrismaClientOptions({ databaseUrl: process.env.DATABASE_URL ?? '' }),
);
const catalog = JSON.parse(
  readFileSync(resolve(__dirname, '../src/config/preferences.catalog.json'), 'utf8'),
) as Record<string, PreferenceDefinition>;

seedPreferenceDefinitions(prisma, catalog)
  .catch((error) => {
    console.error('Catalog-only smoke seed failed:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
