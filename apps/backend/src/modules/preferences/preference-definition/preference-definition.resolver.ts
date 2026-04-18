import { Resolver, Query, Mutation, Args, ID } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PreferenceDefinitionModel, ExportSchemaScope } from './models/preference-definition.model';
import { PreferenceDefinitionRepository } from './preference-definition.repository';
import { PreferenceDefinitionService } from './preference-definition.service';
import { CreatePreferenceDefinitionInput } from './dto/create-preference-definition.input';
import { UpdatePreferenceDefinitionInput } from './dto/update-preference-definition.input';
import { GqlAuthGuard } from '@common/guards/gql-auth.guard';
import { OptionalGqlAuthGuard } from '@common/guards/optional-gql-auth.guard';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { User } from '@modules/user/models/user.model';
import {
  AuditActorType,
  AuditOrigin,
  SourceType,
} from '@infrastructure/prisma/generated-client';
import { MutationContext } from '../audit/audit.types';

@Resolver(() => PreferenceDefinitionModel)
@UseGuards(GqlAuthGuard)
export class PreferenceDefinitionResolver {
  constructor(
    private defRepo: PreferenceDefinitionRepository,
    private defService: PreferenceDefinitionService,
  ) {}

  private buildMutationContext(): MutationContext {
    return {
      actorType: AuditActorType.USER,
      origin: AuditOrigin.GRAPHQL,
      correlationId: randomUUID(),
      sourceType: SourceType.USER,
    };
  }

  @Query(() => [PreferenceDefinitionModel], {
    name: 'preferenceCatalog',
    description:
      'List available preference definitions. Authenticated users also see their own definitions.',
  })
  @UseGuards(OptionalGqlAuthGuard)
  async getCatalog(
    @CurrentUser() user: User | undefined,
    @Args('category', { nullable: true }) category?: string,
  ): Promise<PreferenceDefinitionModel[]> {
    const userId = user?.userId;
    const defs = await this.defRepo.getAll(userId);
    const filtered = category
      ? defs.filter((d) => d.slug.split('.')[0] === category)
      : defs;
    return filtered.map((d) => ({
      ...d,
      category: d.slug.split('.')[0],
    })) as PreferenceDefinitionModel[];
  }

  @Query(() => [PreferenceDefinitionModel], {
    name: 'exportPreferenceSchema',
    description:
      'Export preference definitions filtered by scope: GLOBAL (system only), PERSONAL (user-owned only), or ALL.',
  })
  async exportPreferenceSchema(
    @CurrentUser() user: User,
    @Args('scope', { type: () => ExportSchemaScope }) scope: ExportSchemaScope,
  ): Promise<PreferenceDefinitionModel[]> {
    const defs = await this.defRepo.getByScope(scope, user.userId);
    return defs.map((d) => ({
      ...d,
      category: d.slug.split('.')[0],
    })) as PreferenceDefinitionModel[];
  }

  @Mutation(() => PreferenceDefinitionModel, {
    description: 'Create a new user-owned preference definition.',
  })
  async createPreferenceDefinition(
    @CurrentUser() user: User,
    @Args('input') input: CreatePreferenceDefinitionInput,
  ): Promise<PreferenceDefinitionModel> {
    return this.defService.create(
      input,
      user.userId,
      this.buildMutationContext(),
    ) as Promise<PreferenceDefinitionModel>;
  }

  @Mutation(() => PreferenceDefinitionModel, {
    description: 'Update an existing preference definition by id.',
  })
  async updatePreferenceDefinition(
    @CurrentUser() user: User,
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: UpdatePreferenceDefinitionInput,
  ): Promise<PreferenceDefinitionModel> {
    return this.defService.update(
      id,
      input,
      user.userId,
      this.buildMutationContext(),
    ) as Promise<PreferenceDefinitionModel>;
  }

  @Mutation(() => PreferenceDefinitionModel, {
    description: 'Archive a user-owned preference definition.',
  })
  async archivePreferenceDefinition(
    @CurrentUser() user: User,
    @Args('id', { type: () => ID }) id: string,
  ): Promise<PreferenceDefinitionModel> {
    const archived = await this.defService.archiveDefinition(
      id,
      user.userId,
      this.buildMutationContext(),
    );
    return { ...archived, category: archived.slug.split('.')[0] } as PreferenceDefinitionModel;
  }
}
