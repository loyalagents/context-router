import { Resolver, Query, Mutation, Args } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { PreferenceDefinitionModel } from './models/preference-definition.model';
import { PreferenceDefinitionRepository } from './preference-definition.repository';
import { PreferenceDefinitionService } from './preference-definition.service';
import { CreatePreferenceDefinitionInput } from './dto/create-preference-definition.input';
import { UpdatePreferenceDefinitionInput } from './dto/update-preference-definition.input';
import { GqlAuthGuard } from '@common/guards/gql-auth.guard';

// NOTE: Delete is intentionally not supported. The `slug` field is the primary key
// and is referenced as a foreign key by the Preference table. Deleting a definition
// would either break existing user preferences or require cascading deletes.
// If delete is needed in the future, add a check that no Preferences reference the slug.

@Resolver(() => PreferenceDefinitionModel)
@UseGuards(GqlAuthGuard)
export class PreferenceDefinitionResolver {
  constructor(
    private defRepo: PreferenceDefinitionRepository,
    private defService: PreferenceDefinitionService,
  ) {}

  @Query(() => [PreferenceDefinitionModel], {
    name: 'preferenceCatalog',
    description:
      'List available preference definitions. Optionally filter by category.',
  })
  getCatalog(
    @Args('category', { nullable: true }) category?: string,
  ): PreferenceDefinitionModel[] {
    if (category) {
      return this.defRepo
        .getSlugsByCategory(category)
        .map((slug) => this.defRepo.getDefinition(slug)!)
        .filter(Boolean) as PreferenceDefinitionModel[];
    }
    return this.defRepo.getAll() as PreferenceDefinitionModel[];
  }

  @Mutation(() => PreferenceDefinitionModel, {
    description: 'Create a new preference definition.',
  })
  async createPreferenceDefinition(
    @Args('input') input: CreatePreferenceDefinitionInput,
  ): Promise<PreferenceDefinitionModel> {
    return this.defService.create(input) as Promise<PreferenceDefinitionModel>;
  }

  @Mutation(() => PreferenceDefinitionModel, {
    description: 'Update an existing preference definition.',
  })
  async updatePreferenceDefinition(
    @Args('slug') slug: string,
    @Args('input') input: UpdatePreferenceDefinitionInput,
  ): Promise<PreferenceDefinitionModel> {
    return this.defService.update(slug, input) as Promise<PreferenceDefinitionModel>;
  }
}
