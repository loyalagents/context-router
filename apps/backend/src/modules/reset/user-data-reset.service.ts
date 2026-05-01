import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import {
  AuditActorType,
  AuditEventType,
  AuditOrigin,
  AuditTargetType,
  Prisma,
} from '@infrastructure/prisma/generated-client';
import { PrismaService } from '@infrastructure/prisma/prisma.service';
import { ResetMemoryMode } from './models/reset-memory-mode.enum';
import { ResetMyMemoryPayload } from './models/reset-my-memory-payload.model';

@Injectable()
export class UserDataResetService {
  private readonly logger = new Logger(UserDataResetService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async resetMyMemory(
    userId: string,
    mode: ResetMemoryMode,
  ): Promise<ResetMyMemoryPayload> {
    if (mode !== ResetMemoryMode.MEMORY_ONLY && !this.demoResetEnabled()) {
      throw new ForbiddenException(
        'Demo reset modes are disabled. Set ENABLE_DEMO_RESET=true and restart the backend to enable them.',
      );
    }

    this.logger.log(`Resetting user data for ${userId} with mode ${mode}`);

    return this.prisma.$transaction(async (tx) => {
      const preferencesDeleted = await tx.preference.deleteMany({
        where: { userId },
      });

      let preferenceAuditEventsDeleted = { count: 0 };
      let mcpAccessEventsDeleted = { count: 0 };
      let preferenceDefinitionsDeleted = { count: 0 };
      let locationsDeleted = { count: 0 };
      let permissionGrantsDeleted = { count: 0 };

      if (mode === ResetMemoryMode.MEMORY_ONLY) {
        await tx.preferenceAuditEvent.create({
          data: {
            userId,
            subjectSlug: '*',
            targetType: AuditTargetType.PREFERENCE,
            targetId: userId,
            eventType: AuditEventType.PREFERENCES_RESET,
            actorType: AuditActorType.USER,
            origin: AuditOrigin.GRAPHQL,
            correlationId: randomUUID(),
            beforeState: null,
            afterState: null,
            metadata: {
              mode,
              preferencesDeleted: preferencesDeleted.count,
            },
          },
        });
      }

      if (mode !== ResetMemoryMode.MEMORY_ONLY) {
        preferenceAuditEventsDeleted =
          await tx.preferenceAuditEvent.deleteMany({
            where: { userId },
          });

        mcpAccessEventsDeleted = await tx.mcpAccessEvent.deleteMany({
          where: { userId },
        });

        const userDefinitionIds = await this.getUserDefinitionIds(tx, userId);
        await this.assertNoCrossUserDefinitionReferences(
          tx,
          userId,
          userDefinitionIds,
        );

        if (userDefinitionIds.length > 0) {
          preferenceDefinitionsDeleted =
            await tx.preferenceDefinition.deleteMany({
              where: { id: { in: userDefinitionIds } },
            });
        }

        locationsDeleted = await tx.location.deleteMany({
          where: { userId },
        });
      }

      if (mode === ResetMemoryMode.FULL_USER_DATA) {
        permissionGrantsDeleted = await tx.permissionGrant.deleteMany({
          where: { userId },
        });
      }

      return {
        mode,
        preferencesDeleted: preferencesDeleted.count,
        preferenceDefinitionsDeleted: preferenceDefinitionsDeleted.count,
        locationsDeleted: locationsDeleted.count,
        preferenceAuditEventsDeleted: preferenceAuditEventsDeleted.count,
        mcpAccessEventsDeleted: mcpAccessEventsDeleted.count,
        permissionGrantsDeleted: permissionGrantsDeleted.count,
      };
    });
  }

  private demoResetEnabled(): boolean {
    return (
      this.configService.get<string>('ENABLE_DEMO_RESET') === 'true' ||
      process.env.ENABLE_DEMO_RESET === 'true'
    );
  }

  private async getUserDefinitionIds(
    tx: Prisma.TransactionClient,
    userId: string,
  ): Promise<string[]> {
    const definitions = await tx.preferenceDefinition.findMany({
      where: {
        namespace: `USER:${userId}`,
        ownerUserId: userId,
      },
      select: { id: true },
    });

    return definitions.map((definition) => definition.id);
  }

  private async assertNoCrossUserDefinitionReferences(
    tx: Prisma.TransactionClient,
    userId: string,
    definitionIds: string[],
  ): Promise<void> {
    if (definitionIds.length === 0) {
      return;
    }

    const crossUserReference = await tx.preference.findFirst({
      where: {
        definitionId: { in: definitionIds },
        userId: { not: userId },
      },
      select: {
        userId: true,
        definitionId: true,
      },
    });

    if (crossUserReference) {
      throw new ConflictException(
        'Cannot reset user-owned preference definitions because at least one is referenced by another user.',
      );
    }
  }
}
