import { Resolver, Query, Mutation, Args, ID } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { PreferenceDefinitionModel, ExportSchemaScope } from './models/preference-definition.model';
import { PreferenceDefinitionRepository } from './preference-definition.repository';
import { PreferenceDefinitionService } from './preference-definition.service';
import { CreatePreferenceDefinitionInput } from './dto/create-preference-definition.input';
import { UpdatePreferenceDefinitionInput } from './dto/update-preference-definition.input';
import { ApiKeyGuard } from '@common/guards/api-key.guard';
import { OptionalGqlAuthGuard } from '@common/guards/optional-gql-auth.guard';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { User } from '@modules/user/models/user.model';

@Resolver(() => PreferenceDefinitionModel)
@UseGuards(ApiKeyGuard)
export class PreferenceDefinitionResolver {
  constructor(
    private defRepo: PreferenceDefinitionRepository,
    private defService: PreferenceDefinitionService,
  ) {}

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
    const schemaNamespace = (user as any)?.schemaNamespace ?? "GLOBAL";
    const defs = await this.defRepo.getAll(userId, schemaNamespace);
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
    const schemaNamespace = (user as any)?.schemaNamespace ?? "GLOBAL";
    const defs = await this.defRepo.getByScope(scope, user.userId, schemaNamespace);
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
    const schemaNamespace = (user as any)?.schemaNamespace ?? "GLOBAL";
    return this.defService.create(input, user.userId, schemaNamespace) as Promise<PreferenceDefinitionModel>;
  }

  @Mutation(() => PreferenceDefinitionModel, {
    description: 'Update an existing preference definition by id.',
  })
  async updatePreferenceDefinition(
    @CurrentUser() user: User,
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: UpdatePreferenceDefinitionInput,
  ): Promise<PreferenceDefinitionModel> {
    return this.defService.update(id, input, user.userId) as Promise<PreferenceDefinitionModel>;
  }

  @Mutation(() => PreferenceDefinitionModel, {
    description: 'Archive a user-owned preference definition.',
  })
  async archivePreferenceDefinition(
    @CurrentUser() user: User,
    @Args('id', { type: () => ID }) id: string,
  ): Promise<PreferenceDefinitionModel> {
    const archived = await this.defService.archiveDefinition(id, user.userId);
    return { ...archived, category: archived.slug.split('.')[0] } as PreferenceDefinitionModel;
  }
}
