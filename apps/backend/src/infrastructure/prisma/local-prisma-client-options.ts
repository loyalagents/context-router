import { PrismaPg } from '@prisma/adapter-pg';
import { Pool, type PoolConfig } from 'pg';

import { Prisma } from './generated-client';

type DirectPrismaClientOptions = Extract<
  Prisma.PrismaClientOptions,
  { adapter: unknown }
>;

export function buildLocalPrismaClientOptions(
  poolConfig: PoolConfig,
): DirectPrismaClientOptions {
  return {
    adapter: new PrismaPg(new Pool(poolConfig), {
      disposeExternalPool: true,
      schema: 'public',
    }),
  };
}
