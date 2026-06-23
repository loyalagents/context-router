import type { FormFillFieldPolicies } from './form-fill.types';

export type FormFactResolutionKind = 'alias' | 'policy_source' | 'derived';

export interface FormFactResolutionPreference {
  slug: string;
  value: unknown;
  description?: string;
}

export interface ResolvedFormFact {
  factKey: string;
  value: unknown;
  sourceSlugs: string[];
  resolutionKind: FormFactResolutionKind;
  derivedFromFactKey?: string;
}

export interface FormFactResolutionConflict {
  factKey: string;
  sourceSlugs: string[];
  values: unknown[];
}

export interface FormFactResolutionResult {
  facts: ResolvedFormFact[];
  conflicts: FormFactResolutionConflict[];
}

interface CandidateFact {
  factKey: string;
  value: unknown;
  sourceSlug: string;
  resolutionKind: Exclude<FormFactResolutionKind, 'derived'>;
}

const EXPLICIT_ALIAS_FACT_KEYS = new Map<string, string>([
  ['direct_deposit.account_type', 'banking.accountType'],
  ['tax.federal_filing_status', 'tax.filingStatus'],
  [
    'work_authorization.citizenship_status',
    'workAuthorization.citizenshipStatus',
  ],
  ['work_auth.citizenship_status', 'workAuthorization.citizenshipStatus'],
  [
    'work_auth.expiration_date',
    'workAuthorization.workAuthorizationExpirationDate',
  ],
  ['work_auth.uscis_number', 'workAuthorization.uscisANumber'],
  ['work_auth.i94_admission_number', 'workAuthorization.i94AdmissionNumber'],
  [
    'work_auth.foreign_passport_number',
    'workAuthorization.foreignPassportNumber',
  ],
  ['profile.middle_name', 'identity.middleName'],
]);

export function resolveFormFacts({
  activePreferences,
  fieldPolicies,
}: {
  activePreferences: FormFactResolutionPreference[];
  fieldPolicies?: FormFillFieldPolicies;
}): FormFactResolutionResult {
  const policyFactKeysBySourceSlug = buildPolicyFactKeysBySourceSlug(fieldPolicies);
  const candidatesByFactKey = new Map<string, CandidateFact[]>();

  for (const preference of activePreferences) {
    const policyFactKeys = policyFactKeysBySourceSlug.get(preference.slug) ?? [];
    for (const factKey of policyFactKeys) {
      addCandidate(candidatesByFactKey, {
        factKey,
        value: preference.value,
        sourceSlug: preference.slug,
        resolutionKind: 'policy_source',
      });
    }

    const aliasFactKey = EXPLICIT_ALIAS_FACT_KEYS.get(preference.slug);
    if (aliasFactKey) {
      addCandidate(candidatesByFactKey, {
        factKey: aliasFactKey,
        value: preference.value,
        sourceSlug: preference.slug,
        resolutionKind: 'alias',
      });
    }
  }

  const facts: ResolvedFormFact[] = [];
  const conflicts: FormFactResolutionConflict[] = [];

  for (const [factKey, candidates] of candidatesByFactKey) {
    const uniqueCandidates = uniqueCandidatesForFact(candidates);
    const byValue = groupCandidatesByValue(uniqueCandidates);

    if (byValue.size > 1) {
      conflicts.push({
        factKey,
        sourceSlugs: unique(uniqueCandidates.map((candidate) => candidate.sourceSlug)),
        values: uniqueValues(uniqueCandidates.map((candidate) => candidate.value)),
      });
      continue;
    }

    const [first] = uniqueCandidates;
    facts.push({
      factKey,
      value: first.value,
      sourceSlugs: unique(uniqueCandidates.map((candidate) => candidate.sourceSlug)),
      resolutionKind: mergedResolutionKind(uniqueCandidates),
    });
  }

  addDerivedMiddleInitial({
    facts,
    conflicts,
  });

  return {
    facts: facts.sort((left, right) => left.factKey.localeCompare(right.factKey)),
    conflicts: conflicts.sort((left, right) =>
      left.factKey.localeCompare(right.factKey),
    ),
  };
}

function buildPolicyFactKeysBySourceSlug(
  fieldPolicies: FormFillFieldPolicies | undefined,
): Map<string, string[]> {
  const bySourceSlug = new Map<string, string[]>();
  for (const policy of fieldPolicies?.fields ?? []) {
    if (policy.mode !== 'fact') continue;
    if (policy.factKey) {
      for (const slug of policy.sourceSlugs) {
        addPolicyFactKey(bySourceSlug, slug, policy.factKey);
      }
    }
    if (policy.when) {
      for (const slug of policy.when.sourceSlugs) {
        addPolicyFactKey(bySourceSlug, slug, policy.when.factKey);
      }
    }
  }
  return bySourceSlug;
}

function addPolicyFactKey(
  bySourceSlug: Map<string, string[]>,
  sourceSlug: string,
  factKey: string,
): void {
  const factKeys = bySourceSlug.get(sourceSlug) ?? [];
  if (!factKeys.includes(factKey)) {
    factKeys.push(factKey);
    bySourceSlug.set(sourceSlug, factKeys);
  }
}

function addCandidate(
  candidatesByFactKey: Map<string, CandidateFact[]>,
  candidate: CandidateFact,
): void {
  const candidates = candidatesByFactKey.get(candidate.factKey) ?? [];
  candidates.push(candidate);
  candidatesByFactKey.set(candidate.factKey, candidates);
}

function uniqueCandidatesForFact(candidates: CandidateFact[]): CandidateFact[] {
  const seen = new Set<string>();
  const uniqueCandidates: CandidateFact[] = [];
  for (const candidate of candidates) {
    const key = [
      candidate.factKey,
      candidate.sourceSlug,
      candidate.resolutionKind,
      normalizedValueKey(candidate.value),
    ].join('\0');
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueCandidates.push(candidate);
  }
  return uniqueCandidates;
}

function groupCandidatesByValue(
  candidates: CandidateFact[],
): Map<string, CandidateFact[]> {
  const byValue = new Map<string, CandidateFact[]>();
  for (const candidate of candidates) {
    const key = normalizedValueKey(candidate.value);
    const values = byValue.get(key) ?? [];
    values.push(candidate);
    byValue.set(key, values);
  }
  return byValue;
}

function mergedResolutionKind(candidates: CandidateFact[]): FormFactResolutionKind {
  return candidates.some((candidate) => candidate.resolutionKind === 'policy_source')
    ? 'policy_source'
    : 'alias';
}

function addDerivedMiddleInitial({
  facts,
  conflicts,
}: {
  facts: ResolvedFormFact[];
  conflicts: FormFactResolutionConflict[];
}): void {
  if (facts.some((fact) => fact.factKey === 'identity.middleInitial')) {
    return;
  }
  if (
    conflicts.some((conflict) => conflict.factKey === 'identity.middleInitial')
  ) {
    return;
  }

  const middleName = facts.find((fact) => fact.factKey === 'identity.middleName');
  if (!middleName) return;

  const initial = firstAlphabeticCharacter(middleName.value);
  if (!initial) return;

  facts.push({
    factKey: 'identity.middleInitial',
    value: initial,
    sourceSlugs: middleName.sourceSlugs,
    resolutionKind: 'derived',
    derivedFromFactKey: middleName.factKey,
  });
}

function firstAlphabeticCharacter(value: unknown): string | null {
  const match = String(value ?? '').match(/[A-Za-z]/);
  return match ? match[0].toUpperCase() : null;
}

function normalizedValueKey(value: unknown): string {
  if (typeof value === 'string') {
    return `string:${value.trim().toLocaleLowerCase()}`;
  }
  return `json:${JSON.stringify(value)}`;
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function uniqueValues(values: unknown[]): unknown[] {
  const seen = new Set<string>();
  const uniqueEntries: unknown[] = [];
  for (const value of values) {
    const key = normalizedValueKey(value);
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueEntries.push(value);
  }
  return uniqueEntries;
}
