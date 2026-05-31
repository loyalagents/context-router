#!/usr/bin/env node

import { constants as fsConstants } from 'node:fs';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import {
  classifyFactKey,
  collectFactKeys,
  isFixtureId,
  jsonText,
  toPosixPath,
} from './shared.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultRepoRoot = path.resolve(__dirname, '../../..');

const I9_DEFAULT_FORBIDDEN_FACT_KEYS = [
  'identity.ssn',
  'contact.email',
  'employment.workEmail',
  'contact.phone',
  'workAuthorization.uscisANumber',
  'workAuthorization.workAuthorizationExpirationDate',
  'workAuthorization.i94AdmissionNumber',
  'workAuthorization.foreignPassportNumber',
];

const I9_ARCHETYPES = [
  {
    sequence: '001',
    slug: 'driver-license-transcript',
    path: 'documents/identity/001-driver-license-transcript.md',
    category: 'identity',
    title: 'Driver License Transcript',
    outputExtension: 'md',
    factKeys: [
      'identity.legalName',
      'identity.dateOfBirth',
      'address.current.street',
      'address.current.unit',
      'address.current.city',
      'address.current.state',
      'address.current.postalCode',
    ],
    detailTier: 'hero',
    authority: 'high',
    freshness: 'current',
    expectedUse: 'extract',
    challengeTags: ['identity-evidence', 'address-evidence'],
    texture:
      'Write as a DMV-style transcript with realistic headers, status dates, and export artifacts.',
  },
  {
    sequence: '002',
    slug: 'ssn-card-transcript',
    path: 'documents/identity/002-ssn-card-transcript.md',
    category: 'identity',
    title: 'SSN Card Transcript',
    outputExtension: 'md',
    factKeys: ['identity.legalName', 'identity.ssn'],
    detailTier: 'medium',
    authority: 'high',
    freshness: 'current',
    expectedUse: 'extract',
    challengeTags: ['identity-evidence', 'sensitive-identifier'],
    texture:
      'Write as a careful transcript of a Social Security card, with limited surrounding context.',
  },
  {
    sequence: '003',
    slug: 'birth-record-summary',
    path: 'documents/identity/003-birth-record-summary.txt',
    category: 'identity',
    title: 'Birth Record Summary',
    outputExtension: 'txt',
    factKeys: [
      'identity.legalName',
      'identity.dateOfBirth',
      'workAuthorization.citizenshipStatus',
    ],
    detailTier: 'medium',
    authority: 'medium',
    freshness: 'current',
    expectedUse: 'corroborate',
    challengeTags: ['identity-evidence', 'citizen-work-authorization'],
    texture:
      'Write as plain text copied from a vital-records folder note, not as Markdown.',
  },
  {
    sequence: '004',
    slug: 'lease-summary',
    path: 'documents/address-contact/004-lease-summary.md',
    category: 'address-contact',
    title: 'Lease Summary',
    outputExtension: 'md',
    factKeys: [
      'identity.legalName',
      'address.current.street',
      'address.current.unit',
      'address.current.city',
      'address.current.state',
      'address.current.postalCode',
      'contact.email',
    ],
    detailTier: 'hero',
    authority: 'high',
    freshness: 'current',
    expectedUse: 'extract',
    challengeTags: ['address-evidence', 'email-evidence'],
    texture:
      'Write as a current residential lease summary with notice contact details and realistic lease metadata.',
  },
  {
    sequence: '005',
    slug: 'utility-account-export',
    path: 'documents/address-contact/005-utility-account-export.json',
    category: 'address-contact',
    title: 'Utility Account Export',
    outputExtension: 'json',
    factKeys: [
      'identity.legalName',
      'address.current.street',
      'address.current.unit',
      'address.current.city',
      'address.current.state',
      'address.current.postalCode',
      'contact.email',
    ],
    detailTier: 'medium',
    authority: 'medium',
    freshness: 'current',
    expectedUse: 'corroborate',
    challengeTags: ['address-evidence', 'structured-export'],
    texture:
      'Write as valid JSON from a utility portal export with realistic field names.',
  },
  {
    sequence: '006',
    slug: 'i9-section-one-draft',
    path: 'documents/work-authorization/006-i9-section-one-draft.md',
    category: 'work-authorization',
    title: 'I-9 Section One Draft',
    outputExtension: 'md',
    factKeys: [
      'identity.legalName',
      'identity.firstName',
      'identity.middleInitial',
      'identity.lastName',
      'identity.otherLastNames',
      'identity.dateOfBirth',
      'identity.ssn',
      'address.current.street',
      'address.current.unit',
      'address.current.city',
      'address.current.state',
      'address.current.postalCode',
      'contact.email',
      'workAuthorization.citizenshipStatus',
      'workAuthorization.uscisANumber',
      'workAuthorization.workAuthorizationExpirationDate',
      'workAuthorization.i94AdmissionNumber',
      'workAuthorization.foreignPassportNumber',
    ],
    detailTier: 'hero',
    authority: 'high',
    freshness: 'current',
    expectedUse: 'extract',
    challengeTags: ['i9-draft', 'citizen-work-authorization'],
    texture:
      'Write as a pre-fill draft for I-9 Section 1. Include a separate exact legal-name line even if the form also splits first, middle, and last name fields.',
  },
  {
    sequence: '007',
    slug: 'offer-letter',
    path: 'documents/hr-onboarding/007-offer-letter.md',
    category: 'hr-onboarding',
    title: 'Offer Letter',
    outputExtension: 'md',
    factKeys: [
      'identity.legalName',
      'employment.company',
      'employment.title',
      'employment.startDate',
      'employment.workEmail',
    ],
    detailTier: 'hero',
    authority: 'medium',
    freshness: 'current',
    expectedUse: 'corroborate',
    challengeTags: ['employment-context', 'work-email-vs-personal-email'],
    texture:
      'Write as an offer letter excerpt with realistic HR language, start-date context, and work email provisioning.',
  },
  {
    sequence: '008',
    slug: 'onboarding-profile',
    path: 'documents/hr-onboarding/008-onboarding-profile.yaml',
    category: 'hr-onboarding',
    title: 'Onboarding Profile',
    outputExtension: 'yaml',
    factKeys: [
      'identity.legalName',
      'identity.firstName',
      'identity.lastName',
      'employment.company',
      'employment.title',
      'employment.startDate',
      'contact.email',
      'employment.workEmail',
    ],
    detailTier: 'medium',
    authority: 'medium',
    freshness: 'current',
    expectedUse: 'corroborate',
    challengeTags: ['employment-context', 'structured-export'],
    texture:
      'Write as valid YAML from an onboarding system export with realistic keys and no Markdown fence.',
  },
  {
    sequence: '009',
    slug: 'stale-address-note',
    path: 'documents/partial-conflicting/009-stale-address-note.txt',
    category: 'partial-conflicting',
    title: 'Stale Address Note',
    outputExtension: 'txt',
    factKeys: [],
    detailTier: 'brief',
    authority: 'low',
    freshness: 'stale',
    expectedUse: 'guardrail',
    challengeTags: ['partial-or-conflicting', 'stale-address'],
    texture:
      'Write as a plainly stale address note. Make the stale status explicit and avoid current canonical user fact values.',
  },
  {
    sequence: '010',
    slug: 'community-newsletter',
    path: 'documents/noise/010-community-newsletter.txt',
    category: 'noise',
    title: 'Community Newsletter',
    outputExtension: 'txt',
    factKeys: [],
    detailTier: 'medium',
    authority: 'none',
    freshness: 'unknown',
    expectedUse: 'ignore',
    challengeTags: ['noise'],
    texture:
      'Write as an unrelated community newsletter excerpt with no canonical user facts.',
  },
];

const I9_DOCUMENT_COUNT = I9_ARCHETYPES.length;

export async function runPlanCorpus({
  repoRoot = defaultRepoRoot,
  args = [],
} = {}) {
  const parsed = parseArgs(args);
  if (parsed.kind === 'usage-error') {
    return {
      exitCode: 2,
      repoRoot,
      usageError: parsed.message,
      usage: usage(),
      lines: [],
    };
  }

  try {
    const lines = await writeCorpusPlan(repoRoot, parsed.options);
    return { exitCode: 0, repoRoot, lines };
  } catch (error) {
    return {
      exitCode: 1,
      repoRoot,
      lines: [],
      errorMessage: error.message,
    };
  }
}

export function parseArgs(args) {
  const options = {
    userId: null,
    corpusId: null,
    formId: null,
    count: null,
    force: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--force') {
      options.force = true;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      return { kind: 'usage-error', message: usage() };
    }
    if (!['--user', '--corpus', '--form', '--count'].includes(arg)) {
      return { kind: 'usage-error', message: `Unsupported argument: ${arg}` };
    }

    const value = args[index + 1];
    if (!value || value.startsWith('--')) {
      return { kind: 'usage-error', message: `Missing value for ${arg}` };
    }
    index += 1;

    if (arg === '--user') options.userId = value;
    if (arg === '--corpus') options.corpusId = value;
    if (arg === '--form') options.formId = value;
    if (arg === '--count') options.count = Number(value);
  }

  if (!options.userId || !isFixtureId(options.userId)) {
    return { kind: 'usage-error', message: '--user must be a fixture id.' };
  }
  if (!options.corpusId || !isFixtureId(options.corpusId)) {
    return { kind: 'usage-error', message: '--corpus must be a fixture id.' };
  }
  if (options.formId !== 'i-9') {
    return { kind: 'usage-error', message: '--form currently supports only i-9.' };
  }
  if (options.count !== I9_DOCUMENT_COUNT) {
    return {
      kind: 'usage-error',
      message: `--count currently supports only ${I9_DOCUMENT_COUNT}.`,
    };
  }

  return { kind: 'ok', options };
}

export function formatResult(result) {
  if (result.usageError) return `${result.usageError}\n\n${result.usage}`;
  if (result.errorMessage) return `eval plan-corpus failed\n\n${result.errorMessage}`;
  return ['eval plan-corpus passed', ...result.lines].join('\n');
}

async function writeCorpusPlan(repoRoot, options) {
  const evalRoot = path.join(repoRoot, 'examples/eval');
  const userRoot = path.join(evalRoot, 'users', options.userId);
  const corpusRoot = path.join(userRoot, 'corpora', options.corpusId);
  const planPath = path.join(corpusRoot, 'corpus-plan.json');

  if (!options.force && (await fileExists(planPath))) {
    throw new Error(`Refusing to overwrite existing ${repoRelative(repoRoot, planPath)}.`);
  }

  const profile = parseYaml(await readFile(path.join(userRoot, 'profile.yaml'), 'utf8'));
  const fieldMap = JSON.parse(
    await readFile(
      path.join(evalRoot, 'forms', options.formId, 'field-map.json'),
      'utf8',
    ),
  );
  const corpusPlan = buildCorpusPlan({
    userId: options.userId,
    corpusId: options.corpusId,
    formId: options.formId,
    profile,
    fieldMap,
  });

  await mkdir(corpusRoot, { recursive: true });
  await writeFile(planPath, jsonText(corpusPlan), 'utf8');

  return [
    `wrote ${repoRelative(repoRoot, planPath)}`,
    `documents ${corpusPlan.documents.length}`,
  ];
}

export function buildCorpusPlan({ userId, corpusId, formId, profile, fieldMap }) {
  const profileFacts = collectFactKeys(profile.facts ?? {});
  const formFactKeys = [
    ...new Set(
      (fieldMap.fields ?? [])
        .filter((field) => field.mode === 'fact')
        .map((field) => field.factKey)
        .filter(Boolean),
    ),
  ].sort();

  const hasNonNullFact = (factKey) => {
    const state = classifyFactKey(profileFacts, factKey);
    return state.kind === 'leaf' && state.value != null;
  };

  const hasLeafFact = (factKey) => classifyFactKey(profileFacts, factKey).kind === 'leaf';
  const intentionallyMissing = formFactKeys
    .filter((factKey) => {
      const state = classifyFactKey(profileFacts, factKey);
      return state.kind === 'leaf' && state.value == null;
    })
    .map((factKey) => ({
      factKey,
      forms: [formId],
      reason: `The reviewed ${userId} profile declares ${factKey} as null for ${formId}.`,
      expectedBehavior: 'Leave the corresponding form field blank; do not guess or synthesize a value.',
    }));

  const documents = I9_ARCHETYPES.map((archetype) => {
    const factKeys = archetype.factKeys.filter(hasNonNullFact);
    return {
      id: `${userId}-${corpusId}-${archetype.sequence}`,
      path: archetype.path,
      category: archetype.category,
      title: archetype.title,
      outputExtension: archetype.outputExtension,
      factKeys,
      detailTier: archetype.detailTier,
      authority: archetype.authority,
      freshness: archetype.freshness,
      expectedUse: archetype.expectedUse,
      challengeTags: archetype.challengeTags,
      brief: buildBrief(archetype, factKeys, intentionallyMissing),
    };
  });

  return {
    schemaVersion: 1,
    userId,
    corpusId,
    forms: [formId],
    purpose:
      'Deterministic 10-document realistic starter corpus for I-9 eval generation from a reviewed synthetic profile.',
    targetDocumentCount: documents.length,
    categoryCounts: categoryCounts(documents),
    challengeTags: [
      ...new Set(documents.flatMap((doc) => doc.challengeTags ?? [])),
    ].sort(),
    defaultForbiddenFactKeys: I9_DEFAULT_FORBIDDEN_FACT_KEYS.filter(hasLeafFact),
    intentionallyMissing,
    documents,
  };
}

function buildBrief(archetype, factKeys, intentionallyMissing) {
  const lines = [
    `${archetype.title}: ${archetype.texture}`,
    'Use only the supplied profile slice for canonical current facts.',
  ];
  if (factKeys.length) {
    lines.push(
      `Declared facts: ${factKeys.join(', ')}. Include every declared fact at least once using the exact profile value or a validator-supported value variant, even if the document also uses realistic alternate formatting.`,
    );
  } else {
    lines.push('Do not include canonical current user fact values.');
  }
  if (intentionallyMissing.length) {
    lines.push(
      `Do not invent intentionally missing facts: ${intentionallyMissing
        .map((entry) => entry.factKey)
        .join(', ')}.`,
    );
  }
  lines.push(
    'Avoid placeholder text such as Current Date, To Be Completed, or fake bracketed values.',
  );
  return lines.join(' ');
}

function categoryCounts(documents) {
  return documents.reduce((counts, doc) => {
    counts[doc.category] = (counts[doc.category] ?? 0) + 1;
    return counts;
  }, {});
}

async function fileExists(filePath) {
  try {
    await access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function repoRelative(repoRoot, absolutePath) {
  return toPosixPath(path.relative(repoRoot, absolutePath));
}

function usage() {
  return [
    'Usage:',
    `  pnpm eval:plan-corpus --user <userId> --corpus <corpusId> --form i-9 --count ${I9_DOCUMENT_COUNT} [--force]`,
  ].join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await runPlanCorpus({ args: process.argv.slice(2) });
  const output = formatResult(result);
  console.log(output);
  process.exitCode = result.exitCode;
}
