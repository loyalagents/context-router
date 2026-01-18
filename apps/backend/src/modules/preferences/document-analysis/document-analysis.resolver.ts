import { Resolver, Mutation, Args, ID } from '@nestjs/graphql';
import { UseGuards, Logger } from '@nestjs/common';
import { GqlAuthGuard } from '../../../common/guards/gql-auth.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { PreferenceService } from '../preference/preference.service';
import { Preference } from '../preference/models/preference.model';
import { ApplyPreferenceSuggestionInput } from './dto/apply-suggestion.input';
import { PreferenceOperation } from './dto/preference-suggestion.dto';

@Resolver()
@UseGuards(GqlAuthGuard)
export class DocumentAnalysisResolver {
  private readonly logger = new Logger(DocumentAnalysisResolver.name);

  constructor(private readonly preferenceService: PreferenceService) {}

  @Mutation(() => [Preference])
  async applyPreferenceSuggestions(
    @Args('analysisId', { type: () => ID }) analysisId: string,
    @Args('input', { type: () => [ApplyPreferenceSuggestionInput] })
    input: ApplyPreferenceSuggestionInput[],
    @CurrentUser() user: { userId: string },
  ): Promise<Preference[]> {
    this.logger.log(
      `Applying ${input.length} suggestions from analysis ${analysisId} for user ${user.userId}`,
    );

    const results: Preference[] = [];

    for (const suggestion of input) {
      try {
        let preference: Preference;

        switch (suggestion.operation) {
          case PreferenceOperation.CREATE:
          case PreferenceOperation.UPDATE:
            // Both CREATE and UPDATE use setPreference (upsert)
            const result = await this.preferenceService.setPreference(
              user.userId,
              {
                slug: suggestion.slug,
                value: suggestion.newValue,
              },
            );
            preference = result as unknown as Preference;
            this.logger.log(
              `${suggestion.operation === PreferenceOperation.CREATE ? 'Created' : 'Updated'} preference ${suggestion.slug}`,
            );
            break;

          default:
            this.logger.warn(
              `Unknown operation ${suggestion.operation} for suggestion ${suggestion.suggestionId}`,
            );
            continue;
        }

        results.push(preference);
      } catch (error) {
        this.logger.error(
          `Failed to apply suggestion ${suggestion.suggestionId}: ${error.message}`,
          error.stack,
        );
        // Continue with other suggestions even if one fails
      }
    }

    this.logger.log(
      `Successfully applied ${results.length}/${input.length} suggestions`,
    );

    return results;
  }
}
