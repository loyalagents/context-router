import { DynamicModule, Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { PoolConfig } from 'pg';

import { buildLocalPrismaClientOptions } from './local-prisma-client-options';
import { buildPrismaClientOptions } from './prisma-client-options';
import { PrismaService } from './prisma.service';
import { PRISMA_SERVICE_CONFIGURATION } from './prisma.service';

@Global()
@Module({})
export class PrismaModule {
  static registerHosted(): DynamicModule {
    return {
      module: PrismaModule,
      global: true,
      providers: [
        {
          provide: PRISMA_SERVICE_CONFIGURATION,
          inject: [ConfigService],
          useFactory: (configService: ConfigService) => ({
            clientOptions: buildPrismaClientOptions({
              databaseUrl: configService.getOrThrow<string>('DATABASE_URL'),
            }),
            nodeEnvironment:
              configService.get<string>('app.nodeEnv') ?? 'development',
          }),
        },
        PrismaService,
      ],
      exports: [PrismaService],
    };
  }

  static registerLocal(poolConfig: PoolConfig): DynamicModule {
    return {
      module: PrismaModule,
      global: true,
      providers: [
        {
          provide: PRISMA_SERVICE_CONFIGURATION,
          useFactory: () => ({
            clientOptions: buildLocalPrismaClientOptions(poolConfig),
            nodeEnvironment: 'production',
          }),
        },
        PrismaService,
      ],
      exports: [PrismaService],
    };
  }
}
