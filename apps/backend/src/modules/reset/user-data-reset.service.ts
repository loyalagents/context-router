import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { StorageUnitOfWork } from '@/domains/shared/storage/storage-unit-of-work';
import type { ResetStorage } from '@/domains/shared/storage/reset-storage';
import { ResetMemoryMode } from './models/reset-memory-mode.enum';
import { ResetMyMemoryPayload } from './models/reset-my-memory-payload.model';

@Injectable()
export class UserDataResetService {
  private readonly logger = new Logger(UserDataResetService.name);

  constructor(
    private readonly unitOfWork: StorageUnitOfWork,
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

    this.logger.log(`Resetting authenticated user data with mode ${mode}`);

    return this.unitOfWork.run(async ({ reset }) => {
      const preferencesDeleted = await reset.deletePreferences(userId);
      let preferenceAuditEventsDeleted = 0;
      let mcpAccessEventsDeleted = 0;
      let preferenceDefinitionsDeleted = 0;
      let locationsDeleted = 0;
      let permissionGrantsDeleted = 0;
      if (mode === ResetMemoryMode.MEMORY_ONLY) {
        await reset.appendMemoryResetAudit(userId, mode, preferencesDeleted, randomUUID());
      }
      if (mode !== ResetMemoryMode.MEMORY_ONLY) {
        preferenceAuditEventsDeleted = await reset.deleteAuditEvents(userId);
        mcpAccessEventsDeleted = await reset.deleteAccessEvents(userId);
        const userDefinitionIds = await reset.findOwnedDefinitionIds(userId);
        await this.assertNoCrossUserDefinitionReferences(reset, userId, userDefinitionIds);
        if (userDefinitionIds.length > 0) preferenceDefinitionsDeleted = await reset.deleteDefinitions(userDefinitionIds);
        locationsDeleted = await reset.deleteLocations(userId);
      }
      if (mode === ResetMemoryMode.FULL_USER_DATA) permissionGrantsDeleted = await reset.deleteGrants(userId);
      return { mode, preferencesDeleted, preferenceDefinitionsDeleted, locationsDeleted, preferenceAuditEventsDeleted, mcpAccessEventsDeleted, permissionGrantsDeleted };
    });
  }

  private demoResetEnabled(): boolean {
    return this.configService.get<boolean>('app.enableDemoReset') === true;
  }

  private async assertNoCrossUserDefinitionReferences(storage: ResetStorage, userId: string, definitionIds: string[]): Promise<void> {
    if (definitionIds.length === 0) return;
    if (await storage.hasForeignDefinitionReference(userId, definitionIds)) {
      throw new ConflictException('Cannot reset user-owned preference definitions because at least one is referenced by another user.');
    }
  }
}
