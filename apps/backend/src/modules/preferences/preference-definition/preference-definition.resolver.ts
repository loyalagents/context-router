import { Resolver, Query, Args } from '@nestjs/graphql';
import { PreferenceDefinitionModel } from './models/preference-definition.model';
import { PreferenceDefinitionRepository } from './preference-definition.repository';

@Resolver(() => PreferenceDefinitionModel)
export class PreferenceDefinitionResolver {
  constructor(private defRepo: PreferenceDefinitionRepository) {}

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
}
