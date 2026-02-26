import {
  Injectable,
  Logger,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import {
  PreferenceDefinitionRepository,
  PreferenceDefinitionData,
} from './preference-definition.repository';
import { CreatePreferenceDefinitionInput } from './dto/create-preference-definition.input';
import { UpdatePreferenceDefinitionInput } from './dto/update-preference-definition.input';
import { validateSlugFormat } from '../preference/preference.validation';

@Injectable()
export class PreferenceDefinitionService {
  private readonly logger = new Logger(PreferenceDefinitionService.name);

  constructor(private defRepo: PreferenceDefinitionRepository) {}

  /**
   * Create a new preference definition.
   */
  async create(
    input: CreatePreferenceDefinitionInput,
  ): Promise<PreferenceDefinitionData> {
    if (!validateSlugFormat(input.slug)) {
      throw new BadRequestException(
        `Invalid slug format: "${input.slug}". Slugs must be lowercase with dots (e.g., "food.dietary_restrictions")`,
      );
    }

    if (this.defRepo.isKnownSlug(input.slug)) {
      throw new ConflictException(
        `Preference definition with slug "${input.slug}" already exists`,
      );
    }

    this.logger.log(`Creating preference definition: ${input.slug}`);

    const created = await this.defRepo.create({
      slug: input.slug,
      description: input.description,
      valueType: input.valueType,
      scope: input.scope,
      options: input.options,
      isSensitive: input.isSensitive,
      isCore: input.isCore,
    });

    return {
      ...created,
      category: created.slug.split('.')[0],
    };
  }

  /**
   * Update an existing preference definition.
   */
  async update(
    slug: string,
    input: UpdatePreferenceDefinitionInput,
  ): Promise<PreferenceDefinitionData> {
    if (!this.defRepo.isKnownSlug(slug)) {
      throw new NotFoundException(
        `Preference definition with slug "${slug}" not found`,
      );
    }

    this.logger.log(`Updating preference definition: ${slug}`);

    const updated = await this.defRepo.update(slug, {
      description: input.description,
      valueType: input.valueType,
      scope: input.scope,
      options: input.options,
      isSensitive: input.isSensitive,
      isCore: input.isCore,
    });

    return {
      ...updated,
      category: updated.slug.split('.')[0],
    };
  }
}
