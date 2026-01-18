import { Resolver, Query, Mutation, Args, ID } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { PreferenceService } from './preference.service';
import { Preference } from './models/preference.model';
import { SetPreferenceInput } from './dto/set-preference.input';
import { SuggestPreferenceInput } from './dto/suggest-preference.input';
import { GqlAuthGuard } from '@common/guards/gql-auth.guard';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { User } from '@modules/user/models/user.model';

@Resolver(() => Preference)
@UseGuards(GqlAuthGuard)
export class PreferenceResolver {
  constructor(private preferenceService: PreferenceService) {}

  // ========== Queries ==========

  /**
   * Get all ACTIVE preferences for the current user.
   * If locationId is provided, returns merged view (global + location-specific).
   * If locationId is null/not provided, returns only global preferences.
   */
  @Query(() => [Preference], {
    description:
      'Get active preferences. With locationId: merged global + location. Without: global only.',
  })
  async activePreferences(
    @CurrentUser() user: User,
    @Args('locationId', { type: () => ID, nullable: true }) locationId?: string,
  ): Promise<Preference[]> {
    const prefs = await this.preferenceService.getActivePreferences(
      user.userId,
      locationId,
    );
    return prefs as unknown as Preference[];
  }

  /**
   * Get all SUGGESTED preferences for the current user (inbox).
   * If locationId is provided, returns union of global + location-specific.
   * If locationId is null/not provided, returns only global suggestions.
   */
  @Query(() => [Preference], {
    description:
      'Get suggested preferences (inbox). With locationId: union of global + location. Without: global only.',
  })
  async suggestedPreferences(
    @CurrentUser() user: User,
    @Args('locationId', { type: () => ID, nullable: true }) locationId?: string,
  ): Promise<Preference[]> {
    const prefs = await this.preferenceService.getSuggestedPreferences(
      user.userId,
      locationId,
    );
    return prefs as unknown as Preference[];
  }

  /**
   * Get a single preference by ID.
   */
  @Query(() => Preference, { description: 'Get a single preference by ID' })
  async preference(
    @Args('id', { type: () => ID }) id: string,
    @CurrentUser() user: User,
  ): Promise<Preference> {
    const pref = await this.preferenceService.getPreference(id, user.userId);
    return pref as unknown as Preference;
  }

  // ========== Mutations ==========

  /**
   * Set (create or update) an ACTIVE preference.
   * This is the primary way for users to manage their preferences.
   */
  @Mutation(() => Preference, {
    description: 'Set an active preference (creates or updates)',
  })
  async setPreference(
    @Args('input') input: SetPreferenceInput,
    @CurrentUser() user: User,
  ): Promise<Preference> {
    const pref = await this.preferenceService.setPreference(user.userId, input);
    return pref as unknown as Preference;
  }

  /**
   * Suggest a preference (creates SUGGESTED status).
   * Primarily used by internal systems, but exposed for flexibility.
   * Returns null if the suggestion was skipped (e.g., previously rejected).
   */
  @Mutation(() => Preference, {
    nullable: true,
    description:
      'Suggest a preference (creates SUGGESTED status). Returns null if skipped.',
  })
  async suggestPreference(
    @Args('input') input: SuggestPreferenceInput,
    @CurrentUser() user: User,
  ): Promise<Preference | null> {
    const pref = await this.preferenceService.suggestPreference(
      user.userId,
      input,
    );
    return pref as unknown as Preference | null;
  }

  /**
   * Accept a suggested preference, promoting it to ACTIVE.
   */
  @Mutation(() => Preference, {
    description: 'Accept a suggestion, promoting it to ACTIVE',
  })
  async acceptSuggestedPreference(
    @Args('id', { type: () => ID }) id: string,
    @CurrentUser() user: User,
  ): Promise<Preference> {
    const pref = await this.preferenceService.acceptSuggestion(id, user.userId);
    return pref as unknown as Preference;
  }

  /**
   * Reject a suggested preference.
   * Creates a REJECTED record to prevent future suggestions for the same slug.
   */
  @Mutation(() => Boolean, {
    description:
      'Reject a suggestion (prevents future suggestions for this slug)',
  })
  async rejectSuggestedPreference(
    @Args('id', { type: () => ID }) id: string,
    @CurrentUser() user: User,
  ): Promise<boolean> {
    return this.preferenceService.rejectSuggestion(id, user.userId);
  }

  /**
   * Delete a preference by ID.
   */
  @Mutation(() => Preference, { description: 'Delete a preference' })
  async deletePreference(
    @Args('id', { type: () => ID }) id: string,
    @CurrentUser() user: User,
  ): Promise<Preference> {
    const pref = await this.preferenceService.deletePreference(id, user.userId);
    return pref as unknown as Preference;
  }
}
