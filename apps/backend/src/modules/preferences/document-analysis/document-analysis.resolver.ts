import { Resolver, Mutation, Args, ID } from '@nestjs/graphql';
import { UseGuards, Logger } from '@nestjs/common';
import { GqlAuthGuard } from '../../../common/guards/gql-auth.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { PreferenceService } from '../preference/preference.service';
import { Preference } from '../preference/models/preference.model';
import { ApplyPreferenceSuggestionInput } from './dto/apply-suggestion.input';
import { PreferenceOperation } from './dto/preference-suggestion.dto';
import {
  AuditActorType,
  AuditOrigin,
  SourceType,
} from '@/domains/shared/storage/storage-types';

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
    this.logger.log(`Applying ${input.length} authenticated suggestions`);

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
              {
                actorType: AuditActorType.USER,
                origin: AuditOrigin.DOCUMENT_ANALYSIS,
                correlationId: analysisId,
                sourceType: SourceType.INFERRED,
                confidence: suggestion.confidence,
                evidence: suggestion.evidence,
              },
            );
            preference = result as unknown as Preference;
            this.logger.log('Applied one authenticated preference suggestion');
            break;

          default:
            this.logger.warn('Rejected an unknown suggestion operation');
            continue;
        }

        results.push(preference);
      } catch {
        this.logger.error('Failed to apply one preference suggestion');
        // Continue with other suggestions even if one fails
      }
    }

    this.logger.log(
      `Successfully applied ${results.length}/${input.length} suggestions`,
    );

    return results;
  }
}
