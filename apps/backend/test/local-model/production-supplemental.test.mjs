import assert from 'node:assert/strict';
import test from 'node:test';
import { assertNativeDuplicateChain } from '../../../../scripts/local-migration/fixtures/local-model-feasibility/production-quality.mjs';

const slug = 'profile.last_name';
const valid = () => ({ seededInitialResponses: 1, calls: [{ failed: false }], result: {
  suggestions: [{ id: `consolidated:${slug}`, slug, newValue: 'Lovelace' }],
  filteredSuggestions: [0, 1].map(index => ({ id: `filtered:duplicate:${slug}:${index}`,
    filterReason: 'DUPLICATE_KEY', filterDetails: `Merged into consolidated suggestion for ${slug}` })),
} });

test('native duplicate evidence requires the merged application outcome, not an identical fallback value', () => {
  assert.equal(assertNativeDuplicateChain(valid()).passed, true);
  for (const mutate of [
    value => { value.result.suggestions[0].id = 'candidate:0'; },
    value => { value.result.filteredSuggestions.pop(); },
    value => { value.result.filteredSuggestions[0].filterDetails = 'Retained first valid candidate'; },
    value => { value.result.filteredSuggestions[0].id = 'wrong'; },
    value => { value.result.filteredSuggestions[0].filterReason = 'NO_CHANGE'; },
    value => { value.calls[0].failed = true; },
    value => { value.calls.push({ failed: false }); },
    value => { value.seededInitialResponses = 2; },
  ]) {
    const value = valid(); mutate(value); assert.throws(() => assertNativeDuplicateChain(value));
  }
});
