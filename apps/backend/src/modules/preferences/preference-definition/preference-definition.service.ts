import {
  Injectable,
  Logger,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@infrastructure/prisma/prisma.service';
import {
  AuditEventType,
  AuditTargetType,
} from '@infrastructure/prisma/generated-client';
import { PreferenceDefinitionRepository } from './preference-definition.repository';
import { CreatePreferenceDefinitionInput } from './dto/create-preference-definition.input';
import { UpdatePreferenceDefinitionInput } from './dto/update-preference-definition.input';
import { validateSlugFormat } from '../preference/preference.validation';
import { MutationContext } from '../audit/audit.types';
import { PreferenceAuditService } from '../audit/preference-audit.service';
import { buildPreferenceDefinitionAuditSnapshot } from '../audit/snapshot-builders';

@Injectable()
export class PreferenceDefinitionService {
  private readonly logger = new Logger(PreferenceDefinitionService.name);

  constructor(
    private defRepo: PreferenceDefinitionRepository,
    private prisma: PrismaService,
    private preferenceAuditService: PreferenceAuditService,
  ) {}

  /**
   * Create a new user-owned preference definition.
   * Namespace and ownerUserId are derived from the authenticated userId.
   */
  async create(
    input: CreatePreferenceDefinitionInput,
    userId: string,
    _context: MutationContext,
  ) {
    if (!validateSlugFormat(input.slug)) {
      throw new BadRequestException(
        `Invalid slug format: "${input.slug}". Slugs must be lowercase with dots (e.g., "food.dietary_restrictions")`,
      );
    }

    // Block user def if slug already exists in GLOBAL namespace
    const globalExists = await this.defRepo.isKnownSlug(input.slug);
    if (globalExists) {
      throw new ConflictException(
        `A global preference definition with slug "${input.slug}" already exists`,
      );
    }

    // Also block if user already has an active def with this slug
    const userExists = await this.defRepo.isKnownSlug(input.slug, userId);
    if (userExists) {
      throw new ConflictException(
        `You already have an active preference definition with slug "${input.slug}"`,
      );
    }

    this.logger.log(`Creating user preference definition: ${input.slug} for user ${userId}`);

    const created = await this.prisma.$transaction(async (tx) => {
      const createdDefinition = await this.defRepo.create(
        {
          slug: input.slug,
          displayName: input.displayName,
          description: input.description,
          valueType: input.valueType,
          scope: input.scope,
          options: input.options,
          isSensitive: input.isSensitive,
          isCore: input.isCore,
          ownerUserId: userId,
        },
        tx,
      );

      await this.preferenceAuditService.record(
        {
          userId,
          subjectSlug: createdDefinition.slug,
          targetType: AuditTargetType.PREFERENCE_DEFINITION,
          targetId: createdDefinition.id,
          eventType: AuditEventType.DEFINITION_CREATED,
          actorType: _context.actorType,
          actorClientKey: _context.actorClientKey,
          origin: _context.origin,
          correlationId: _context.correlationId,
          beforeState: null,
          afterState: buildPreferenceDefinitionAuditSnapshot(createdDefinition),
        },
        tx,
      );

      return createdDefinition;
    });

    return { ...created, category: created.slug.split('.')[0] };
  }

  /**
   * Update an existing preference definition by id.
   * Only the owner can update their definition.
   */
  async update(
    id: string,
    input: UpdatePreferenceDefinitionInput,
    userId: string,
    _context: MutationContext,
  ) {
    const def = await this.defRepo.getDefinitionById(id);
    if (!def) {
      throw new NotFoundException(`Preference definition with id "${id}" not found`);
    }

    if (def.ownerUserId !== userId) {
      throw new ForbiddenException(
        `You do not have permission to update this preference definition`,
      );
    }

    this.logger.log(`Updating preference definition: ${id}`);

    const updated = await this.prisma.$transaction(async (tx) => {
      const updatedDefinition = await this.defRepo.update(
        id,
        {
          displayName: input.displayName,
          description: input.description,
          valueType: input.valueType,
          scope: input.scope,
          options: input.options,
          isSensitive: input.isSensitive,
          isCore: input.isCore,
        },
        tx,
      );

      await this.preferenceAuditService.record(
        {
          userId,
          subjectSlug: updatedDefinition.slug,
          targetType: AuditTargetType.PREFERENCE_DEFINITION,
          targetId: updatedDefinition.id,
          eventType: AuditEventType.DEFINITION_UPDATED,
          actorType: _context.actorType,
          actorClientKey: _context.actorClientKey,
          origin: _context.origin,
          correlationId: _context.correlationId,
          beforeState: buildPreferenceDefinitionAuditSnapshot(def),
          afterState: buildPreferenceDefinitionAuditSnapshot(updatedDefinition),
        },
        tx,
      );

      return updatedDefinition;
    });

    return { ...updated, category: updated.slug.split('.')[0] };
  }

  /**
   * Archive a user-owned preference definition by id.
   * After archiving, a new definition with the same slug can be created.
   */
  async archiveDefinition(
    id: string,
    userId: string,
    _context: MutationContext,
  ) {
    const def = await this.defRepo.getDefinitionById(id);
    if (!def) {
      throw new NotFoundException(`Preference definition with id "${id}" not found`);
    }

    if (def.ownerUserId !== userId) {
      throw new ForbiddenException(
        `You do not have permission to archive this preference definition`,
      );
    }

    this.logger.log(`Archiving preference definition: ${id}`);
    return this.prisma.$transaction(async (tx) => {
      const archivedDefinition = await this.defRepo.archive(id, tx);

      await this.preferenceAuditService.record(
        {
          userId,
          subjectSlug: archivedDefinition.slug,
          targetType: AuditTargetType.PREFERENCE_DEFINITION,
          targetId: archivedDefinition.id,
          eventType: AuditEventType.DEFINITION_ARCHIVED,
          actorType: _context.actorType,
          actorClientKey: _context.actorClientKey,
          origin: _context.origin,
          correlationId: _context.correlationId,
          beforeState: buildPreferenceDefinitionAuditSnapshot(def),
          afterState: buildPreferenceDefinitionAuditSnapshot(archivedDefinition),
        },
        tx,
      );

      return archivedDefinition;
    });
  }
}
