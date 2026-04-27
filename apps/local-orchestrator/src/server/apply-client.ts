import { URL } from 'node:url';
import {
  AppliedPreferenceRecord,
  ApplyBatchResult,
  ApplyInputSuggestion,
} from '../types';
import { RequestError } from './request-error';

const APPLY_SUGGESTIONS_MUTATION = `
  mutation ApplyPreferenceSuggestions(
    $analysisId: ID!
    $input: [ApplyPreferenceSuggestionInput!]!
  ) {
    applyPreferenceSuggestions(analysisId: $analysisId, input: $input) {
      id
      slug
      value
      status
      sourceType
    }
  }
`;

interface GraphqlResponse {
  data?: {
    applyPreferenceSuggestions?: Array<{
      id: string;
      slug: string;
      value: unknown;
      status?: string;
      sourceType?: string;
    }>;
  };
  errors?: Array<{ message?: string }>;
}

export interface ApplyClientOptions {
  backendUrl: string;
  token: string;
}

export interface ApplySuggestionBatch {
  analysisId: string;
  suggestions: ApplyInputSuggestion[];
}

export class ApplyClient {
  constructor(private readonly options: ApplyClientOptions) {}

  async applySuggestions(
    batch: ApplySuggestionBatch,
  ): Promise<ApplyBatchResult> {
    let response: Response;

    try {
      response = await fetch(new URL('/graphql', this.options.backendUrl), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.options.token}`,
        },
        body: JSON.stringify({
          query: APPLY_SUGGESTIONS_MUTATION,
          variables: {
            analysisId: batch.analysisId,
            input: batch.suggestions,
          },
        }),
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') {
        throw new RequestError(error.message, 'timeout');
      }
      throw new RequestError(
        error instanceof Error ? error.message : 'GraphQL request failed',
        'network',
      );
    }

    if (!response.ok) {
      const kind =
        response.status === 401 || response.status === 403 ? 'auth' : 'http';
      throw new RequestError(
        `GraphQL apply request failed with status ${response.status}`,
        kind,
        response.status,
      );
    }

    const parsed = (await response.json()) as GraphqlResponse;
    if (parsed.errors && parsed.errors.length > 0) {
      throw new RequestError(
        parsed.errors
          .map((error) => error.message ?? 'Unknown GraphQL error')
          .join('; '),
        'graphql',
      );
    }

    const appliedPreferences =
      parsed.data?.applyPreferenceSuggestions?.map<AppliedPreferenceRecord>(
        (preference) => ({
          id: preference.id,
          slug: preference.slug,
          value: preference.value,
          status: preference.status,
          sourceType: preference.sourceType,
        }),
      ) ?? [];

    const slugToSuggestionIds = new Map<string, string[]>();
    for (const suggestion of batch.suggestions) {
      const existing = slugToSuggestionIds.get(suggestion.slug) ?? [];
      existing.push(suggestion.suggestionId);
      slugToSuggestionIds.set(suggestion.slug, existing);
    }

    const matchedSuggestionIds: string[] = [];
    const ambiguousSuggestionIds = new Set<string>();

    for (const preference of appliedPreferences) {
      const candidates = slugToSuggestionIds.get(preference.slug) ?? [];
      if (candidates.length === 1) {
        matchedSuggestionIds.push(candidates[0]);
        slugToSuggestionIds.delete(preference.slug);
        continue;
      }

      if (candidates.length > 1) {
        for (const suggestionId of candidates) {
          ambiguousSuggestionIds.add(suggestionId);
        }
        slugToSuggestionIds.delete(preference.slug);
      }
    }

    const unmatchedSuggestionIds: string[] = [];
    for (const [slug, suggestionIds] of slugToSuggestionIds.entries()) {
      if (appliedPreferences.some((preference) => preference.slug === slug)) {
        continue;
      }
      for (const suggestionId of suggestionIds) {
        if (!ambiguousSuggestionIds.has(suggestionId)) {
          unmatchedSuggestionIds.push(suggestionId);
        }
      }
    }

    return {
      analysisId: batch.analysisId,
      requestedCount: batch.suggestions.length,
      appliedCount: appliedPreferences.length,
      matchedSuggestionIds,
      unmatchedSuggestionIds,
      ambiguousSuggestionIds: Array.from(ambiguousSuggestionIds),
      appliedPreferences,
    };
  }
}
