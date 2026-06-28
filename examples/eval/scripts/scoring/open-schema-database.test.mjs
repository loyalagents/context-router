import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  scoreOpenKnownFact,
  scoreOpenMissingFact,
  scoreOpenSchemaDatabaseToFile,
} from './open-schema-database.mjs';
import { jsonText } from '../shared.mjs';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), '../../../..');
const USER_ID = 'alex-i9-test';
const CORPUS_ID = 'realistic';
const MAYA_USER_ID = 'maya-chen-newhire';
const MAYA_HARD_OWNERSHIP_CORPUS_ID = 'packet-hard-ownership-v1';
const TIMESTAMP = '2026-06-17T00:00:00.000Z';

test('open-schema database scorer validates memory snapshots and classifies active-memory recovery', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'score-open-db-'));
  const snapshotPath = path.join(tmp, 'memory-snapshot.json');
  const reportPath = path.join(tmp, 'open-schema-database-score-report.json');
  const preferences = [
    preference('agent.zzz.note', 'outside fixture z'),
    preference('identity.legal_name', 'Wrong Legal Name'),
    preference('agent.zzz.full_name', 'Alex Jordan Rivera'),
    preference('profile.full_name', 'Alex Jordan Rivera'),
    preference('agent.aaa.full_name', 'Alex Jordan Rivera'),
    preference('agent.identity.given_name', 'Alex'),
    preference('profile.email', 'wrong@example.test'),
    preference('contact.phone', ''),
    preference('agent.aaa.note', 'outside fixture a'),
    preference('agent.missing.definition', 'outside fixture missing definition', {
      definitionId: 'def-not-exported',
    }),
    preference('agent.ignored', 'ignored value', { status: 'SUGGESTED' }),
  ];
  const suggestions = [
    preference('agent.identity.family_name', 'Rivera', { status: 'SUGGESTED' }),
    preference('contact.phone', '503-555-0199', { status: 'SUGGESTED' }),
    preference('agent.suggestion.missing.definition', 'outside suggestion', {
      status: 'SUGGESTED',
      definitionId: 'def-suggestion-not-exported',
    }),
  ];
  const definitions = [
    definition('profile.full_name'),
    definition('identity.legal_name'),
    definition('agent.aaa.full_name'),
    definition('agent.zzz.full_name'),
    definition('agent.identity.given_name'),
    definition('profile.email'),
    definition('contact.phone'),
    definition('agent.aaa.note'),
    definition('agent.zzz.note'),
    definition('agent.ignored'),
    definition('agent.identity.family_name'),
    definition('agent.empty.description', { description: '' }),
    definition('agent.duplicate', {
      id: 'def-duplicate-a',
      namespace: 'eval-agent-a',
    }),
    definition('agent.duplicate', {
      id: 'def-duplicate-b',
      namespace: 'eval-agent-b',
    }),
  ];
  await writeFile(
    snapshotPath,
    jsonText(memorySnapshot({ preferences, suggestions, definitions })),
  );

  const report = await scoreOpenSchemaDatabaseToFile({
    repoRoot,
    userId: USER_ID,
    corpusId: CORPUS_ID,
    memorySnapshotPath: snapshotPath,
    outPath: reportPath,
  });
  const written = JSON.parse(await readFile(reportPath, 'utf8'));

  assert.equal(written.scoreType, 'open-schema-database-storage');
  assert.equal(report.fixtureReadiness.scorable, true);
  assert.equal(
    row(report, 'identity.legalName').classification,
    'open_known_present_recovered_accepted_slug',
  );
  assert.equal(row(report, 'identity.legalName').conflict, true);
  assert.equal(report.summary.knownPresentConflict, 1);
  assert.deepEqual(
    row(report, 'identity.legalName').matchingActiveRows.map((candidate) => candidate.slug),
    ['agent.aaa.full_name', 'agent.zzz.full_name', 'profile.full_name'],
  );
  assert.deepEqual(
    row(report, 'identity.legalName').acceptedWrongRows.map((candidate) => candidate.slug),
    ['identity.legal_name'],
  );
  assert.equal(
    row(report, 'identity.firstName').classification,
    'open_known_present_recovered_novel_slug',
  );
  assert.equal(row(report, 'identity.firstName').matchingNovelRows[0].slug, 'agent.identity.given_name');
  assert.equal(
    row(report, 'identity.lastName').classification,
    'open_known_present_suggestion_only',
  );
  assert.equal(row(report, 'identity.lastName').matchingSuggestionRows[0].slug, 'agent.identity.family_name');
  assert.equal(
    row(report, 'contact.email').classification,
    'open_known_present_wrong_value',
  );
  assert.equal(row(report, 'contact.email').acceptedSlugHasWrongValue, true);
  assert.ok(
    report.knownPresent.some(
      (candidate) => candidate.classification === 'open_known_present_missing',
    ),
  );

  const missingPhone = missingRow(report, 'contact.phone');
  assert.equal(missingPhone.classification, 'open_missing_absent_correct');
  assert.equal(missingPhone.suggestionAcceptedSlugHasValue, true);
  assert.equal(missingPhone.activeAcceptedSlugHasValue, false);
  assert.equal(report.summary.missingActiveBothHallucinated, 0);
  assert.equal(report.summary.missingActiveHallucinatedTotal, 0);

  assert.equal(report.schemaDiagnostics.definitionCount, definitions.length);
  assert.equal(report.schemaDiagnostics.activePreferenceCount, 10);
  assert.equal(report.schemaDiagnostics.suggestionCount, 3);
  assert.deepEqual(report.schemaDiagnostics.definitionBaseline.newDefinitionIds, [
    'def-agent-identity-given-name',
    'def-duplicate-a',
  ]);
  assert.deepEqual(report.schemaDiagnostics.definitionBaseline.removedSlugs, [
    'removed.slug',
  ]);
  assert.deepEqual(report.schemaDiagnostics.duplicateSlugGroups, [
    {
      slug: 'agent.duplicate',
      count: 2,
      definitionIds: ['def-duplicate-a', 'def-duplicate-b'],
      namespaces: ['eval-agent-a', 'eval-agent-b'],
    },
  ]);
  assert.deepEqual(
    report.schemaDiagnostics.emptyDescriptionDefinitions.map((candidate) => candidate.slug),
    ['agent.empty.description'],
  );
  assert.deepEqual(
    report.schemaDiagnostics.preferencesMissingDefinitions.map((candidate) => candidate.slug),
    ['agent.missing.definition'],
  );
  assert.deepEqual(
    report.schemaDiagnostics.suggestionsMissingDefinitions.map((candidate) => candidate.slug),
    ['agent.suggestion.missing.definition'],
  );
  assert.deepEqual(
    report.ignoredMemoryPreferences.map((candidate) => candidate.slug),
    ['agent.ignored'],
  );
  assert.deepEqual(
    report.unscoredActivePreferences.map((candidate) => candidate.slug),
    ['agent.aaa.note', 'agent.missing.definition', 'agent.zzz.note'],
  );
  assert.equal(report.summary.ownershipDecoyTotal, 0);
  assert.equal(report.summary.ownershipDecoyClean, 0);
  assert.equal(report.summary.ownershipDecoyAllowedScoped, 0);
  assert.equal(report.summary.ownershipDecoyForbiddenActiveLeak, 0);
  assert.equal(report.summary.ownershipDecoyForbiddenSuggestionLeak, 0);
  assert.deepEqual(report.ownershipDecoyAudit, []);
});

test('open-schema database summary distinguishes missing-fact hallucination buckets', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'score-open-db-missing-'));
  const snapshotPath = path.join(tmp, 'memory-snapshot.json');
  const reportPath = path.join(tmp, 'open-schema-database-score-report.json');
  await writeFile(
    snapshotPath,
    jsonText(
      memorySnapshot({
        preferences: [preference('contact.phone', '503-555-0199')],
        definitions: [definition('contact.phone')],
      }),
    ),
  );

  const report = await scoreOpenSchemaDatabaseToFile({
    repoRoot,
    userId: USER_ID,
    corpusId: CORPUS_ID,
    memorySnapshotPath: snapshotPath,
    outPath: reportPath,
  });

  assert.equal(
    missingRow(report, 'contact.phone').classification,
    'open_missing_active_key_hallucinated',
  );
  assert.equal(report.summary.missingActiveKeyHallucinated, 1);
  assert.equal(report.summary.missingActiveBothHallucinated, 0);
  assert.equal(report.summary.missingActiveHallucinatedTotal, 1);
});

test('open-schema database scorer rejects mismatched and malformed memory snapshots', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'score-open-db-invalid-'));
  const userMismatchPath = path.join(tmp, 'user-mismatched-memory-snapshot.json');
  const corpusMismatchPath = path.join(tmp, 'corpus-mismatched-memory-snapshot.json');
  const malformedPath = path.join(tmp, 'malformed-memory-snapshot.json');
  await writeFile(
    userMismatchPath,
    jsonText(memorySnapshot({ userId: 'other-user', definitions: [definition('profile.full_name')] })),
  );
  await writeFile(
    corpusMismatchPath,
    jsonText(memorySnapshot({ corpusId: 'other-corpus', definitions: [definition('profile.full_name')] })),
  );
  await writeFile(malformedPath, jsonText({ schemaVersion: 1 }));

  await assert.rejects(
    scoreOpenSchemaDatabaseToFile({
      repoRoot,
      userId: USER_ID,
      corpusId: CORPUS_ID,
      memorySnapshotPath: userMismatchPath,
      outPath: path.join(tmp, 'mismatch-report.json'),
    }),
    /memory-snapshot userId other-user does not match alex-i9-test/,
  );
  await assert.rejects(
    scoreOpenSchemaDatabaseToFile({
      repoRoot,
      userId: USER_ID,
      corpusId: CORPUS_ID,
      memorySnapshotPath: corpusMismatchPath,
      outPath: path.join(tmp, 'corpus-mismatch-report.json'),
    }),
    /memory-snapshot corpusId other-corpus does not match realistic/,
  );
  await assert.rejects(
    scoreOpenSchemaDatabaseToFile({
      repoRoot,
      userId: USER_ID,
      corpusId: CORPUS_ID,
      memorySnapshotPath: malformedPath,
      outPath: path.join(tmp, 'malformed-report.json'),
    }),
    /memory snapshot failed memory-snapshot.schema.json/,
  );
});

test('open-schema database ownership audit allows scoped emergency contact values', async () => {
  const report = await scoreMayaOwnershipReport({
    preferences: [
      preference('identity.emergency_contact.primary_phone', '415-555-0182'),
    ],
  });

  const elenaPhone = ownershipRow(report, 'elenaChen', 'phone');
  assert.equal(elenaPhone.classification, 'allowed_scoped');
  assert.deepEqual(
    elenaPhone.allowedActiveRows.map((candidate) => candidate.slug),
    ['identity.emergency_contact.primary_phone'],
  );
  assert.deepEqual(elenaPhone.forbiddenActiveRows, []);
  assert.equal(report.summary.ownershipDecoyAllowedScoped, 1);
  assert.equal(report.summary.ownershipDecoyForbiddenActiveLeak, 0);
  assert.equal(report.summary.ownershipDecoyForbiddenSuggestionLeak, 0);
});

test('open-schema database ownership audit flags active and suggestion decoy leaks', async () => {
  const report = await scoreMayaOwnershipReport({
    preferences: [
      preference('contact.phone', '415-555-0182'),
      preference('eval.banking.routing_number', '122105278'),
      preference('banking.account_number', '663904228017'),
      preference('tax.extra_withholding', 75),
    ],
    suggestions: [
      preference('tax.filing_status', 'Head of Household', {
        status: 'SUGGESTED',
      }),
    ],
  });

  assert.equal(
    ownershipRow(report, 'elenaChen', 'phone').classification,
    'forbidden_active_leak',
  );
  assert.equal(
    ownershipRow(report, 'noahKim', 'routingNumber').classification,
    'forbidden_active_leak',
  );
  assert.equal(
    ownershipRow(report, 'noahKim', 'accountNumber').classification,
    'forbidden_active_leak',
  );
  assert.equal(
    ownershipRow(report, 'taylorBrooks', 'extraWithholding').classification,
    'forbidden_active_leak',
  );
  assert.equal(
    ownershipRow(report, 'taylorBrooks', 'filingStatus').classification,
    'forbidden_suggestion_leak',
  );
  assert.equal(
    ownershipRow(report, 'ariPatel', 'accountNumber').classification,
    'clean',
  );
  assert.equal(report.summary.ownershipDecoyForbiddenActiveLeak, 4);
  assert.equal(report.summary.ownershipDecoyForbiddenSuggestionLeak, 1);
});

test('open-schema missing fact scoring detects withheld active-memory value leaks', () => {
  const baseEntry = {
    factKey: 'contact.phone',
    missingKind: 'withheld_value_missing',
    withheldValue: '503-555-0199',
    source: 'test',
  };
  const storageMap = {
    facts: {
      'contact.phone': {
        canonicalSlugs: ['contact.phone'],
        acceptedAliasSlugs: [],
      },
    },
  };

  assert.equal(
    scoreOpenMissingFact({
      entry: baseEntry,
      profile: { facts: {} },
      storageMap,
      activePreferences: [preference('agent.phone.note', '503-555-0199')],
      suggestions: [],
      usedPreferenceIndexes: new Set(),
      usedSuggestionIndexes: new Set(),
    }).classification,
    'open_missing_active_value_hallucinated',
  );
  assert.equal(
    scoreOpenMissingFact({
      entry: baseEntry,
      profile: { facts: {} },
      storageMap,
      activePreferences: [preference('contact.phone', '503-555-0199')],
      suggestions: [],
      usedPreferenceIndexes: new Set(),
      usedSuggestionIndexes: new Set(),
    }).classification,
    'open_missing_active_hallucinated',
  );
});

test('open-schema known fact scoring derives address composites from active component facts', () => {
  const profile = {
    facts: {
      address: {
        current: {
          street: '2846 Ashbury Street',
          unit: 'Apt 3D',
          streetLine: '2846 Ashbury Street Apt 3D',
          city: 'Oakland',
          state: 'CA',
          postalCode: '94609',
          cityStateZip: 'Oakland, CA 94609',
        },
      },
    },
  };
  const storageMap = {
    facts: {
      'address.current.streetLine': {
        canonicalSlugs: ['profile.address.street_line'],
        acceptedAliasSlugs: [],
      },
      'address.current.cityStateZip': {
        canonicalSlugs: ['profile.address.city_state_zip'],
        acceptedAliasSlugs: [],
      },
    },
  };
  const activePreferences = [
    preference('profile.address_street', '2846 Ashbury Street'),
    preference('profile.address_apt', 'Apt 3D'),
    preference('profile.address_city', 'Oakland'),
    preference('profile.address_state', 'CA'),
    preference('profile.address_zip', '94609'),
  ];

  const streetLine = scoreOpenKnownFact({
    factKey: 'address.current.streetLine',
    profile,
    storageMap,
    activePreferences,
    suggestions: [],
    usedPreferenceIndexes: new Set(),
    usedSuggestionIndexes: new Set(),
  });
  const cityStateZip = scoreOpenKnownFact({
    factKey: 'address.current.cityStateZip',
    profile,
    storageMap,
    activePreferences,
    suggestions: [],
    usedPreferenceIndexes: new Set(),
    usedSuggestionIndexes: new Set(),
  });

  assert.equal(
    streetLine.classification,
    'open_known_present_recovered_novel_slug',
  );
  assert.equal(streetLine.matchingNovelRows[0].slug, 'derived.address.current.streetLine');
  assert.equal(
    cityStateZip.classification,
    'open_known_present_recovered_novel_slug',
  );
  assert.equal(
    cityStateZip.matchingNovelRows[0].slug,
    'derived.address.current.cityStateZip',
  );
});

test('open-schema address composite derivation stays missing when a required component is absent', () => {
  const profile = {
    facts: {
      address: {
        current: {
          street: '2846 Ashbury Street',
          unit: 'Apt 3D',
          streetLine: '2846 Ashbury Street Apt 3D',
        },
      },
    },
  };
  const result = scoreOpenKnownFact({
    factKey: 'address.current.streetLine',
    profile,
    storageMap: {
      facts: {
        'address.current.streetLine': {
          canonicalSlugs: ['profile.address.street_line'],
          acceptedAliasSlugs: [],
        },
      },
    },
    activePreferences: [preference('profile.address_street', '2846 Ashbury Street')],
    suggestions: [],
    usedPreferenceIndexes: new Set(),
    usedSuggestionIndexes: new Set(),
  });

  assert.equal(result.classification, 'open_known_present_missing');
});

test('open-schema database scorer accepts packet-medium alias and semantic equivalents', () => {
  const profile = {
    facts: {
      banking: {
        accountType: 'checking',
      },
      identity: {
        firstName: 'Maya',
        middleName: 'Lin',
        lastName: 'Chen',
        legalName: 'Maya Lin Chen',
        middleInitial: 'L',
      },
      tax: {
        filingStatus: 'single or married filing separately',
      },
      workAuthorization: {
        citizenshipStatus: 'U.S. citizen',
      },
    },
  };
  const storageMap = {
    facts: {
      'banking.accountType': {
        canonicalSlugs: ['eval.banking.account_type'],
        acceptedAliasSlugs: ['direct_deposit.account_type'],
      },
      'identity.middleInitial': {
        canonicalSlugs: ['profile.middle_initial'],
        acceptedAliasSlugs: [],
      },
      'identity.legalName': {
        canonicalSlugs: ['profile.full_name'],
        acceptedAliasSlugs: [],
      },
      'tax.filingStatus': {
        canonicalSlugs: ['eval.tax.filing_status'],
        acceptedAliasSlugs: ['tax.federal_filing_status'],
      },
      'workAuthorization.citizenshipStatus': {
        canonicalSlugs: ['eval.work_authorization.citizenship_status'],
        acceptedAliasSlugs: ['work_authorization.citizenship_status'],
      },
    },
  };
  const activePreferences = [
    preference('direct_deposit.account_type', 'Checking'),
    preference('personal.name.first', 'Maya'),
    preference('personal.name.middle', 'Lin'),
    preference('personal.name.last', 'Chen'),
    preference('tax.federal_filing_status', 'Single or Married Filing Separately'),
    preference(
      'work_authorization.citizenship_status',
      'A citizen of the United States',
    ),
  ];

  const accountType = scoreOpenKnownFact({
    factKey: 'banking.accountType',
    profile,
    storageMap,
    activePreferences,
    suggestions: [],
    usedPreferenceIndexes: new Set(),
    usedSuggestionIndexes: new Set(),
  });
  const middleInitial = scoreOpenKnownFact({
    factKey: 'identity.middleInitial',
    profile,
    storageMap,
    activePreferences,
    suggestions: [],
    usedPreferenceIndexes: new Set(),
    usedSuggestionIndexes: new Set(),
  });
  const legalName = scoreOpenKnownFact({
    factKey: 'identity.legalName',
    profile,
    storageMap,
    activePreferences,
    suggestions: [],
    usedPreferenceIndexes: new Set(),
    usedSuggestionIndexes: new Set(),
  });
  const filingStatus = scoreOpenKnownFact({
    factKey: 'tax.filingStatus',
    profile,
    storageMap,
    activePreferences,
    suggestions: [],
    usedPreferenceIndexes: new Set(),
    usedSuggestionIndexes: new Set(),
  });
  const citizenshipStatus = scoreOpenKnownFact({
    factKey: 'workAuthorization.citizenshipStatus',
    profile,
    storageMap,
    activePreferences,
    suggestions: [],
    usedPreferenceIndexes: new Set(),
    usedSuggestionIndexes: new Set(),
  });

  assert.equal(
    accountType.classification,
    'open_known_present_recovered_accepted_slug',
  );
  assert.equal(
    middleInitial.classification,
    'open_known_present_recovered_novel_slug',
  );
  assert.equal(middleInitial.matchingNovelRows[0].slug, 'derived.identity.middleInitial');
  assert.equal(
    legalName.classification,
    'open_known_present_recovered_novel_slug',
  );
  assert.equal(legalName.matchingNovelRows[0].slug, 'derived.identity.legalName');
  assert.equal(
    filingStatus.classification,
    'open_known_present_recovered_accepted_slug',
  );
  assert.equal(
    citizenshipStatus.classification,
    'open_known_present_recovered_accepted_slug',
  );
});

test('open-schema legal-name derivation stays missing without a required name component', () => {
  const result = scoreOpenKnownFact({
    factKey: 'identity.legalName',
    profile: {
      facts: {
        identity: {
          firstName: 'Maya',
          middleName: 'Lin',
          lastName: 'Chen',
          legalName: 'Maya Lin Chen',
        },
      },
    },
    storageMap: {
      facts: {
        'identity.legalName': {
          canonicalSlugs: ['profile.full_name'],
          acceptedAliasSlugs: [],
        },
      },
    },
    activePreferences: [
      preference('personal.name.first', 'Maya'),
      preference('personal.name.last', 'Chen'),
    ],
    suggestions: [],
    usedPreferenceIndexes: new Set(),
    usedSuggestionIndexes: new Set(),
  });

  assert.equal(result.classification, 'open_known_present_missing');
});

test('open-schema middle-initial derivation stays missing without middle-name memory', () => {
  const result = scoreOpenKnownFact({
    factKey: 'identity.middleInitial',
    profile: {
      facts: {
        identity: {
          middleName: 'Lin',
          middleInitial: 'L',
        },
      },
    },
    storageMap: {
      facts: {
        'identity.middleInitial': {
          canonicalSlugs: ['profile.middle_initial'],
          acceptedAliasSlugs: [],
        },
      },
    },
    activePreferences: [preference('identity.middle_name', 'Wrong')],
    suggestions: [],
    usedPreferenceIndexes: new Set(),
    usedSuggestionIndexes: new Set(),
  });

  assert.equal(result.classification, 'open_known_present_missing');
});

function memorySnapshot({
  userId = USER_ID,
  corpusId = CORPUS_ID,
  preferences = [],
  suggestions = [],
  definitions = [],
} = {}) {
  return {
    schemaVersion: 1,
    artifactType: 'memory-snapshot',
    runId: 'open-schema-static-test',
    evaluationMode: 'open-schema-static',
    userId,
    corpusId,
    storageInput: {
      schemaMode: 'open',
      producer: 'unit-test',
      statusesScored: ['ACTIVE'],
      suggestionsWereAutoApplied: false,
    },
    preferences,
    suggestions,
    definitions,
    definitionBaseline: {
      capturedBeforeRun: true,
      capturedAt: TIMESTAMP,
      strategy: 'baseline-only',
      preexistingDefinitionIds: ['def-profile-full-name', 'def-removed'],
      preexistingSlugs: ['profile.full_name', 'removed.slug'],
      newDefinitionIds: ['def-agent-identity-given-name', 'def-duplicate-a'],
      newSlugs: ['agent.identity.given_name', 'agent.duplicate'],
      removedDefinitionIds: ['def-removed'],
      removedSlugs: ['removed.slug'],
    },
    diagnostics: {
      exportedAt: TIMESTAMP,
      graphqlUrl: 'http://localhost:3000/graphql',
      queryName: 'EvalMemorySnapshotExport',
      locationMode: 'global-only',
      locationId: null,
      preferencesMergedWithLocation: false,
      includeSuggestions: true,
      activePreferenceCount: preferences.filter((candidate) => candidate.status === 'ACTIVE').length,
      suggestedPreferenceCount: suggestions.length,
      definitionCount: definitions.length,
      backendUserId: 'backend-alex',
      schemaMode: 'open',
      schemaResetMode: 'baseline-only',
    },
  };
}

function preference(slug, value, options = {}) {
  return {
    id: options.id ?? `pref-${slug.replace(/[^a-z0-9]+/gi, '-')}`,
    userId: USER_ID,
    locationId: null,
    slug,
    definitionId: options.definitionId ?? definitionIdForSlug(slug),
    value,
    status: options.status ?? 'ACTIVE',
    sourceType: 'INFERRED',
    confidence: 0.9,
    evidence: null,
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
  };
}

function definition(slug, options = {}) {
  return {
    id: options.id ?? definitionIdForSlug(slug),
    namespace: options.namespace ?? 'eval-agent',
    slug,
    displayName: options.displayName ?? slug,
    ownerUserId: options.ownerUserId ?? USER_ID,
    archivedAt: options.archivedAt ?? null,
    description: options.description ?? `Definition for ${slug}`,
    valueType: options.valueType ?? 'STRING',
    scope: options.scope ?? 'USER',
    options: options.options ?? null,
    isSensitive: options.isSensitive ?? false,
    isCore: options.isCore ?? false,
    category: options.category ?? 'profile',
  };
}

function definitionIdForSlug(slug) {
  return `def-${slug.replace(/[^a-z0-9]+/gi, '-')}`;
}

function row(report, factKey) {
  return report.knownPresent.find((candidate) => candidate.factKey === factKey);
}

function missingRow(report, factKey) {
  return report.intentionallyMissing.find((candidate) => candidate.factKey === factKey);
}

function ownershipRow(report, ownerKey, valueLabel) {
  const row = report.ownershipDecoyAudit.find(
    (candidate) =>
      candidate.ownerKey === ownerKey && candidate.valueLabel === valueLabel,
  );
  assert.ok(row, `missing ownership row ${ownerKey}.${valueLabel}`);
  return row;
}

async function scoreMayaOwnershipReport({ preferences = [], suggestions = [] } = {}) {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'score-open-db-ownership-'));
  const snapshotPath = path.join(tmp, 'memory-snapshot.json');
  const reportPath = path.join(tmp, 'open-schema-database-score-report.json');
  const definitions = [...preferences, ...suggestions].map((candidate) =>
    definition(candidate.slug),
  );
  await writeFile(
    snapshotPath,
    jsonText(
      memorySnapshot({
        userId: MAYA_USER_ID,
        corpusId: MAYA_HARD_OWNERSHIP_CORPUS_ID,
        preferences,
        suggestions,
        definitions,
      }),
    ),
  );

  return scoreOpenSchemaDatabaseToFile({
    repoRoot,
    userId: MAYA_USER_ID,
    corpusId: MAYA_HARD_OWNERSHIP_CORPUS_ID,
    memorySnapshotPath: snapshotPath,
    outPath: reportPath,
  });
}
