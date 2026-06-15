#!/usr/bin/env node

import { constants as fsConstants } from 'node:fs';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import {
  classifyFactKey,
  collectFactKeys,
  getFactValue,
  hashInt,
  isFixtureId,
  jsonText,
  toPosixPath,
} from './shared.mjs';
import { fieldIsActive } from './field-map.mjs';

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

const COMMON_RISKY_DETAILS = [
  'new user phone number',
  'extra user address',
  'extra SSN or tax identifier',
  'extra immigration identifier not listed in the fact contract',
  'signature or legal attestation',
];

const I9_BASE_SOURCE_SPECS = [
  {
    sequence: '001',
    slug: 'driver-license-upload-ocr',
    path: 'documents/identity/001-driver-license-upload-ocr.txt',
    category: 'identity',
    title: 'Driver License Upload OCR',
    outputExtension: 'txt',
    include: [
      'identity.legalName',
      'identity.dateOfBirth',
      'address.current.street',
      'address.current.unit',
      'address.current.city',
      'address.current.state',
      'address.current.postalCode',
    ],
    evaluationRole: {
      detailTier: 'hero',
      authority: 'high',
      freshness: 'current',
      expectedUse: 'extract',
      challengeTags: ['identity-evidence', 'address-evidence'],
    },
    sourceSpec: {
      artifactType: 'uploaded-id-ocr-transcript',
      sourceFamily: 'identity',
      captureMode: 'plain-text-ocr-export',
      timelineRefs: ['identityUploadAt'],
      worldRefs: [
        'identityCapture.uploadBatchId',
        'identityCapture.licenseImageName',
        'employer.onboardingSystem',
        'employer.workerId',
      ],
      nativeSignals: [
        'upload batch id',
        'source filename',
        'OCR confidence',
        'document status',
        'issuing state',
      ],
      safeDetailMenu: [
        'license class',
        'restriction code',
        'redacted license number',
        'processing queue status',
      ],
      riskyDetailMenu: COMMON_RISKY_DETAILS,
      lengthTarget: { minChars: 700, maxChars: 1800 },
    },
  },
  {
    sequence: '002',
    slug: 'ssn-card-upload-ocr',
    path: 'documents/identity/002-ssn-card-upload-ocr.txt',
    category: 'identity',
    title: 'SSN Card Upload OCR',
    outputExtension: 'txt',
    include: ['identity.legalName', 'identity.ssn'],
    evaluationRole: {
      detailTier: 'medium',
      authority: 'high',
      freshness: 'current',
      expectedUse: 'extract',
      challengeTags: ['identity-evidence', 'sensitive-identifier'],
    },
    sourceSpec: {
      artifactType: 'uploaded-ssn-card-ocr-transcript',
      sourceFamily: 'identity',
      captureMode: 'plain-text-ocr-export',
      timelineRefs: ['identityUploadAt'],
      worldRefs: [
        'identityCapture.uploadBatchId',
        'identityCapture.ssnImageName',
        'employer.onboardingSystem',
        'employer.workerId',
      ],
      nativeSignals: [
        'upload batch id',
        'source filename',
        'OCR confidence',
        'redaction status',
      ],
      safeDetailMenu: [
        'document category',
        'processing status',
        'review queue',
        'transcription confidence',
      ],
      riskyDetailMenu: COMMON_RISKY_DETAILS,
      lengthTarget: { minChars: 450, maxChars: 1300 },
    },
  },
  {
    sequence: '004',
    slug: 'resident-portal-lease-export',
    path: 'documents/address-contact/004-resident-portal-lease-export.md',
    category: 'address-contact',
    title: 'Resident Portal Lease Export',
    outputExtension: 'md',
    include: [
      'identity.legalName',
      'address.current.street',
      'address.current.unit',
      'address.current.city',
      'address.current.state',
      'address.current.postalCode',
      'contact.email',
    ],
    evaluationRole: {
      detailTier: 'hero',
      authority: 'high',
      freshness: 'current',
      expectedUse: 'extract',
      challengeTags: ['address-evidence', 'email-evidence'],
    },
    sourceSpec: {
      artifactType: 'resident-portal-lease-export',
      sourceFamily: 'address-contact',
      captureMode: 'portal-markdown-export',
      timelineRefs: ['addressProofExportAt'],
      worldRefs: [
        'housing.propertyManager',
        'housing.residentPortal',
        'housing.leaseAccountId',
      ],
      nativeSignals: [
        'portal export timestamp',
        'lease account id',
        'lease status',
        'resident profile block',
      ],
      safeDetailMenu: [
        'lease status',
        'notice preference',
        'redacted office phone',
        'renewal status',
      ],
      riskyDetailMenu: COMMON_RISKY_DETAILS,
      lengthTarget: { minChars: 900, maxChars: 2400 },
    },
  },
  {
    sequence: '005',
    slug: 'utility-account-export',
    path: 'documents/address-contact/005-utility-account-export.json',
    category: 'address-contact',
    title: 'Utility Account Export',
    outputExtension: 'json',
    include: [
      'identity.legalName',
      'address.current.street',
      'address.current.unit',
      'address.current.city',
      'address.current.state',
      'address.current.postalCode',
      'contact.email',
    ],
    evaluationRole: {
      detailTier: 'medium',
      authority: 'medium',
      freshness: 'current',
      expectedUse: 'corroborate',
      challengeTags: ['address-evidence', 'structured-export'],
    },
    sourceSpec: {
      artifactType: 'utility-portal-account-export',
      sourceFamily: 'address-contact',
      captureMode: 'json-export',
      timelineRefs: ['addressProofExportAt'],
      worldRefs: [
        'utility.provider',
        'utility.exportId',
        'utility.serviceAccountSuffix',
      ],
      nativeSignals: [
        'export id',
        'generated timestamp',
        'service agreement',
        'account status history',
      ],
      safeDetailMenu: [
        'billing cycle',
        'redacted account suffix',
        'mailing preference',
        'service agreement status',
      ],
      riskyDetailMenu: COMMON_RISKY_DETAILS,
      lengthTarget: { minChars: 750, maxChars: 2200 },
    },
  },
  {
    sequence: '006',
    slug: 'i9-section-one-field-export',
    path: 'documents/work-authorization/006-i9-section-one-field-export.yaml',
    category: 'work-authorization',
    title: 'I-9 Section 1 Field Export',
    outputExtension: 'yaml',
    include: [
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
    evaluationRole: {
      detailTier: 'hero',
      authority: 'high',
      freshness: 'current',
      expectedUse: 'extract',
      challengeTags: ['i9-draft', 'work-authorization'],
    },
    sourceSpec: {
      artifactType: 'saved-i9-section-one-field-export',
      sourceFamily: 'work-authorization',
      captureMode: 'yaml-field-export',
      timelineRefs: ['i9DraftSavedAt'],
      worldRefs: [
        'employer.onboardingSystem',
        'employer.workerId',
        'employer.hrCoordinator',
      ],
      nativeSignals: [
        'form version',
        'field ids',
        'saved timestamp',
        'workflow status',
        'blank phone field',
      ],
      safeDetailMenu: [
        'task status',
        'signature pending cue',
        'reviewer routing',
        'null phone field',
      ],
      riskyDetailMenu: COMMON_RISKY_DETAILS,
      lengthTarget: { minChars: 1200, maxChars: 3200 },
    },
  },
  {
    sequence: '007',
    slug: 'offer-email',
    path: 'documents/hr-onboarding/007-offer-email.md',
    category: 'hr-onboarding',
    title: 'Offer Email',
    outputExtension: 'md',
    include: [
      'identity.legalName',
      'employment.company',
      'employment.title',
      'employment.startDate',
      'employment.workEmail',
    ],
    evaluationRole: {
      detailTier: 'hero',
      authority: 'medium',
      freshness: 'current',
      expectedUse: 'corroborate',
      challengeTags: ['employment-context', 'work-email-vs-personal-email'],
    },
    sourceSpec: {
      artifactType: 'copied-offer-email',
      sourceFamily: 'hr-onboarding',
      captureMode: 'email-body',
      timelineRefs: ['offerSentAt', 'offerAcceptedAt'],
      worldRefs: [
        'employer.hrCoordinator',
        'employer.recruitingInbox',
        'employer.officeLabel',
      ],
      nativeSignals: [
        'From header',
        'To header',
        'Date header',
        'Subject header',
        'signature block',
      ],
      safeDetailMenu: [
        'acceptance deadline',
        'orientation timing',
        'contingency language',
        'work email provisioning',
      ],
      riskyDetailMenu: COMMON_RISKY_DETAILS,
      lengthTarget: { minChars: 1000, maxChars: 2800 },
    },
  },
  {
    sequence: '008',
    slug: 'onboarding-profile-export',
    path: 'documents/hr-onboarding/008-onboarding-profile-export.yaml',
    category: 'hr-onboarding',
    title: 'Onboarding Profile Export',
    outputExtension: 'yaml',
    include: [
      'identity.legalName',
      'identity.firstName',
      'identity.lastName',
      'employment.company',
      'employment.title',
      'employment.startDate',
      'contact.email',
      'employment.workEmail',
    ],
    evaluationRole: {
      detailTier: 'medium',
      authority: 'medium',
      freshness: 'current',
      expectedUse: 'corroborate',
      challengeTags: ['employment-context', 'structured-export'],
    },
    sourceSpec: {
      artifactType: 'onboarding-profile-export',
      sourceFamily: 'hr-onboarding',
      captureMode: 'yaml-export',
      timelineRefs: ['onboardingInviteAt', 'i9DraftSavedAt'],
      worldRefs: [
        'employer.onboardingSystem',
        'employer.workerId',
        'employer.hrCoordinator',
      ],
      nativeSignals: [
        'source system',
        'created timestamp',
        'updated timestamp',
        'worker id',
        'task status list',
      ],
      safeDetailMenu: [
        'provisioning status',
        'onboarding task names',
        'audit fields',
        'review queue',
      ],
      riskyDetailMenu: COMMON_RISKY_DETAILS,
      lengthTarget: { minChars: 800, maxChars: 3200 },
    },
  },
  {
    sequence: '009',
    slug: 'stale-contact-ticket',
    path: 'documents/partial-conflicting/009-stale-contact-ticket.txt',
    category: 'partial-conflicting',
    title: 'Stale Contact Ticket',
    outputExtension: 'txt',
    include: [],
    forbid: ['identity.legalName', 'address.current.street', 'contact.email'],
    evaluationRole: {
      detailTier: 'brief',
      authority: 'low',
      freshness: 'stale',
      expectedUse: 'guardrail',
      challengeTags: ['partial-or-conflicting', 'stale-address'],
    },
    sourceSpec: {
      artifactType: 'returned-mail-support-ticket',
      sourceFamily: 'partial-conflicting',
      captureMode: 'plain-text-ticket-export',
      timelineRefs: ['staleRecordAt'],
      worldRefs: ['employer.onboardingSystem', 'employer.workerId'],
      nativeSignals: [
        'ticket id',
        'status',
        'event log',
        'stale/superseded cue',
      ],
      safeDetailMenu: [
        'returned mail status',
        'superseded address cue',
        'redacted stale value',
        'do-not-use note',
      ],
      riskyDetailMenu: COMMON_RISKY_DETAILS,
      lengthTarget: { minChars: 350, maxChars: 1400 },
    },
  },
  {
    sequence: '010',
    slug: 'community-newsletter-email',
    path: 'documents/noise/010-community-newsletter-email.txt',
    category: 'noise',
    title: 'Community Newsletter Email',
    outputExtension: 'txt',
    include: [],
    forbid: [
      'identity.legalName',
      'address.current.street',
      'contact.email',
      'employment.workEmail',
    ],
    evaluationRole: {
      detailTier: 'medium',
      authority: 'none',
      freshness: 'unknown',
      expectedUse: 'ignore',
      challengeTags: ['noise'],
    },
    sourceSpec: {
      artifactType: 'community-newsletter-email',
      sourceFamily: 'noise',
      captureMode: 'email-body',
      timelineRefs: ['noiseReceivedAt'],
      worldRefs: ['noise.sender', 'noise.subject'],
      nativeSignals: [
        'From header',
        'To header',
        'Date header',
        'Subject header',
        'footer',
      ],
      safeDetailMenu: [
        'community event details',
        'unsubscribe footer',
        'generic resident audience',
        'no user-specific identifiers',
      ],
      riskyDetailMenu: COMMON_RISKY_DETAILS,
      lengthTarget: { minChars: 700, maxChars: 2600 },
    },
  },
];

const I9_DOCUMENT_COUNT = I9_BASE_SOURCE_SPECS.length + 1;

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
    const lines = await writeCorpusManifest(repoRoot, parsed.options);
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

async function writeCorpusManifest(repoRoot, options) {
  const evalRoot = path.join(repoRoot, 'examples/eval');
  const userRoot = path.join(evalRoot, 'users', options.userId);
  const corpusRoot = path.join(userRoot, 'corpora', options.corpusId);
  const manifestPath = path.join(corpusRoot, 'manifest.json');

  if (!options.force && (await fileExists(manifestPath))) {
    throw new Error(`Refusing to overwrite existing ${repoRelative(repoRoot, manifestPath)}.`);
  }

  const profile = parseYaml(await readFile(path.join(userRoot, 'profile.yaml'), 'utf8'));
  const fieldMap = JSON.parse(
    await readFile(
      path.join(evalRoot, 'forms', options.formId, 'field-map.json'),
      'utf8',
    ),
  );
  const manifest = buildCorpusManifest({
    userId: options.userId,
    corpusId: options.corpusId,
    formId: options.formId,
    profile,
    fieldMap,
  });

  await mkdir(corpusRoot, { recursive: true });
  await writeFile(manifestPath, jsonText(manifest), 'utf8');

  return [
    `wrote ${repoRelative(repoRoot, manifestPath)}`,
    `documents ${manifest.documents.length}`,
  ];
}

export function buildCorpusManifest({ userId, corpusId, formId, profile, fieldMap }) {
  const profileFacts = collectFactKeys(profile.facts ?? {});
  const formFactKeys = [
    ...new Set(
      (fieldMap.fields ?? [])
        .filter((field) => field.mode === 'fact')
        .filter((field) => fieldIsActive(field, profile.facts ?? {}))
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

  const artifactWorld = buildArtifactWorld({ userId, corpusId, profile });
  const documents = buildI9SourceSpecs(profile)
    .sort((left, right) => left.sequence.localeCompare(right.sequence))
    .map((spec) => planDocument({ userId, corpusId, spec, hasNonNullFact }));

  assertArtifactWorldHasNoProfileCollisions({ artifactWorld, profileFacts });

  return {
    schemaVersion: 2,
    userId,
    corpusId,
    seed: `${userId}__${corpusId}`,
    corpusKind: 'realistic-generated',
    forms: [formId],
    purpose:
      'Deterministic 10-document source-artifact corpus for I-9 realistic eval generation from a reviewed synthetic profile.',
    artifactWorld,
    factContractDefaults: {
      forbid: I9_DEFAULT_FORBIDDEN_FACT_KEYS.filter(hasLeafFact),
    },
    intentionallyMissing,
    documents,
  };
}

export function buildI9SourceSpecs(profile) {
  const workAuthorizationSpec = workAuthorizationSourceSpec(profile);
  return [
    ...I9_BASE_SOURCE_SPECS.filter((spec) => spec.sequence < '003'),
    workAuthorizationSpec,
    ...I9_BASE_SOURCE_SPECS.filter((spec) => spec.sequence > '003'),
  ];
}

function workAuthorizationSourceSpec(profile) {
  const statusKind = classifyWorkAuthorizationStatus(
    getFactValue(profile.facts ?? {}, 'workAuthorization.citizenshipStatus') ?? '',
  );

  if (statusKind === 'noncitizen-national') {
    return {
      sequence: '003',
      slug: 'noncitizen-national-evidence-upload',
      path: 'documents/work-authorization/003-noncitizen-national-evidence-upload.txt',
      category: 'work-authorization',
      title: 'Noncitizen National Evidence Upload',
      outputExtension: 'txt',
      include: [
        'identity.legalName',
        'identity.dateOfBirth',
        'workAuthorization.citizenshipStatus',
      ],
      evaluationRole: {
        detailTier: 'medium',
        authority: 'medium',
        freshness: 'current',
        expectedUse: 'corroborate',
        challengeTags: ['identity-evidence', 'noncitizen-national-work-authorization'],
      },
      sourceSpec: {
        artifactType: 'noncitizen-national-evidence-upload-note',
        sourceFamily: 'work-authorization',
        captureMode: 'plain-text-upload-note',
        timelineRefs: ['identityUploadAt'],
        worldRefs: [
          'identityCapture.uploadBatchId',
          'employer.onboardingSystem',
          'employer.workerId',
        ],
        nativeSignals: [
          'upload batch id',
          'document category',
          'review status',
          'employee-provided status',
        ],
        safeDetailMenu: [
          'noncitizen national evidence category',
          'review queue',
          'status confirmation note',
        ],
        riskyDetailMenu: COMMON_RISKY_DETAILS,
        lengthTarget: { minChars: 450, maxChars: 1300 },
      },
    };
  }

  if (statusKind === 'authorized-to-work') {
    return {
      sequence: '003',
      slug: 'work-authorization-upload-receipt',
      path: 'documents/work-authorization/003-work-authorization-upload-receipt.txt',
      category: 'work-authorization',
      title: 'Work Authorization Upload Receipt',
      outputExtension: 'txt',
      include: [
        'identity.legalName',
        'workAuthorization.citizenshipStatus',
        'workAuthorization.uscisANumber',
        'workAuthorization.workAuthorizationExpirationDate',
        'workAuthorization.i94AdmissionNumber',
        'workAuthorization.foreignPassportNumber',
      ],
      evaluationRole: {
        detailTier: 'medium',
        authority: 'high',
        freshness: 'current',
        expectedUse: 'extract',
        challengeTags: ['work-authorization', 'sensitive-identifier'],
      },
      sourceSpec: {
        artifactType: 'work-authorization-upload-receipt',
        sourceFamily: 'work-authorization',
        captureMode: 'plain-text-upload-receipt',
        timelineRefs: ['identityUploadAt'],
        worldRefs: [
          'identityCapture.uploadBatchId',
          'employer.onboardingSystem',
          'employer.workerId',
          'employer.hrCoordinator',
        ],
        nativeSignals: [
          'upload batch id',
          'document category',
          'processing status',
          'reviewer note',
        ],
        safeDetailMenu: [
          'uploaded document type',
          'review queue',
          'work authorization support status',
          'worker id',
        ],
        riskyDetailMenu: COMMON_RISKY_DETAILS,
        lengthTarget: { minChars: 700, maxChars: 2300 },
      },
    };
  }

  if (statusKind === 'lawful-permanent-resident') {
    return {
      sequence: '003',
      slug: 'permanent-resident-card-upload',
      path: 'documents/work-authorization/003-permanent-resident-card-upload.txt',
      category: 'work-authorization',
      title: 'Permanent Resident Card Upload',
      outputExtension: 'txt',
      include: [
        'identity.legalName',
        'workAuthorization.citizenshipStatus',
        'workAuthorization.uscisANumber',
      ],
      evaluationRole: {
        detailTier: 'medium',
        authority: 'high',
        freshness: 'current',
        expectedUse: 'extract',
        challengeTags: ['work-authorization', 'sensitive-identifier'],
      },
      sourceSpec: {
        artifactType: 'permanent-resident-card-upload-receipt',
        sourceFamily: 'work-authorization',
        captureMode: 'plain-text-upload-receipt',
        timelineRefs: ['identityUploadAt'],
        worldRefs: [
          'identityCapture.uploadBatchId',
          'employer.onboardingSystem',
          'employer.workerId',
          'employer.hrCoordinator',
        ],
        nativeSignals: [
          'upload batch id',
          'document category',
          'processing status',
          'reviewer note',
        ],
        safeDetailMenu: [
          'card side received',
          'review queue',
          'redacted card metadata',
          'worker id',
        ],
        riskyDetailMenu: COMMON_RISKY_DETAILS,
        lengthTarget: { minChars: 650, maxChars: 1700 },
      },
    };
  }

  if (statusKind === 'citizen') {
    return {
      sequence: '003',
      slug: 'citizenship-evidence-upload',
      path: 'documents/identity/003-citizenship-evidence-upload.txt',
      category: 'identity',
      title: 'Citizenship Evidence Upload',
      outputExtension: 'txt',
      include: [
        'identity.legalName',
        'identity.dateOfBirth',
        'workAuthorization.citizenshipStatus',
      ],
      evaluationRole: {
        detailTier: 'medium',
        authority: 'medium',
        freshness: 'current',
        expectedUse: 'corroborate',
        challengeTags: ['identity-evidence', 'citizen-work-authorization'],
      },
      sourceSpec: {
        artifactType: 'citizenship-evidence-upload-note',
        sourceFamily: 'identity',
        captureMode: 'plain-text-upload-note',
        timelineRefs: ['identityUploadAt'],
        worldRefs: [
          'identityCapture.uploadBatchId',
          'employer.onboardingSystem',
          'employer.workerId',
        ],
        nativeSignals: [
          'upload batch id',
          'document category',
          'review status',
          'employee-provided status',
        ],
        safeDetailMenu: [
          'citizenship evidence category',
          'review queue',
          'status confirmation note',
        ],
        riskyDetailMenu: COMMON_RISKY_DETAILS,
        lengthTarget: { minChars: 450, maxChars: 1300 },
      },
    };
  }

  return {
    sequence: '003',
    slug: 'work-authorization-review-note',
    path: 'documents/work-authorization/003-work-authorization-review-note.txt',
    category: 'work-authorization',
    title: 'Work Authorization Review Note',
    outputExtension: 'txt',
    include: ['identity.legalName', 'workAuthorization.citizenshipStatus'],
    evaluationRole: {
      detailTier: 'medium',
      authority: 'medium',
      freshness: 'current',
      expectedUse: 'corroborate',
      challengeTags: ['work-authorization'],
    },
    sourceSpec: {
      artifactType: 'work-authorization-review-note',
      sourceFamily: 'work-authorization',
      captureMode: 'plain-text-review-note',
      timelineRefs: ['i9DraftSavedAt'],
      worldRefs: [
        'employer.onboardingSystem',
        'employer.workerId',
        'employer.hrCoordinator',
      ],
      nativeSignals: [
        'review timestamp',
        'workflow status',
        'reviewer note',
        'employee-provided status',
      ],
      safeDetailMenu: [
        'review queue',
        'status confirmation note',
        'pending-document cue',
      ],
      riskyDetailMenu: COMMON_RISKY_DETAILS,
      lengthTarget: { minChars: 550, maxChars: 1400 },
    },
  };
}

function classifyWorkAuthorizationStatus(rawStatus) {
  const status = String(rawStatus).toLowerCase().replace(/\s+/g, ' ').trim();
  const compactStatus = status.replace(/[-\s]+/g, '');

  if (/\bnon[-\s]?citizen national\b/.test(status)) return 'noncitizen-national';
  if (
    /\bnot (?:currently )?authorized to work\b/.test(status) ||
    /\bunauthorized to work\b/.test(status) ||
    /\bno longer authorized to work\b/.test(status)
  ) {
    return 'unknown';
  }
  if (
    compactStatus.includes('alienauthorizedtowork') ||
    compactStatus.includes('noncitizenauthorizedtowork')
  ) {
    return 'authorized-to-work';
  }
  if (
    status.includes('lawful permanent resident') ||
    status.includes('permanent resident') ||
    status === 'lpr'
  ) {
    return 'lawful-permanent-resident';
  }
  if (
    status.includes('u.s. citizen') ||
    status.includes('us citizen') ||
    status.includes('united states citizen') ||
    /\bcitizen of the united states\b/.test(status)
  ) {
    return 'citizen';
  }
  return 'unknown';
}

function planDocument({ userId, corpusId, spec, hasNonNullFact }) {
  return {
    id: `${userId}-${corpusId}-${spec.sequence}`,
    path: spec.path,
    category: spec.category,
    title: spec.title,
    outputExtension: spec.outputExtension,
    sourceSpec: spec.sourceSpec,
    factContract: {
      include: spec.include.filter(hasNonNullFact),
      forbid: spec.forbid ?? [],
    },
    evaluationRole: spec.evaluationRole,
  };
}

export function buildArtifactWorld({ userId, corpusId, profile }) {
  const seed = `${userId}__${corpusId}`;
  const startDate =
    getFactValue(profile.facts ?? {}, 'employment.startDate') ?? '2026-06-17';
  const safeCompanySlug = truncateSlugAtBoundary(String(
    getFactValue(profile.facts ?? {}, 'employment.company') ?? 'onboarding',
  )
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  ) || 'onboarding';
  const utilityProvider = choose(seed, 'utilityProvider', [
    'Willamette Utility Services',
    'Metroline Energy',
    'Civic Water & Power',
  ]);
  const utilityExportPrefix = initialism(utilityProvider);

  return {
    schemaVersion: 1,
    seed,
    timeline: {
      offerSentAt: dateTimeBefore(startDate, 26, '09:13:00-07:00'),
      offerAcceptedAt: dateTimeBefore(startDate, 24, '16:02:00-07:00'),
      onboardingInviteAt: dateTimeBefore(startDate, 21, '08:44:00-07:00'),
      i9DraftSavedAt: dateTimeBefore(startDate, 14, '14:18:00-07:00'),
      identityUploadAt: dateTimeBefore(startDate, 14, '14:27:00-07:00'),
      addressProofExportAt: dateTimeBefore(startDate, 13, '18:06:00-07:00'),
      staleRecordAt: dateTimeBefore(startDate, 579, '10:20:00-08:00'),
      noiseReceivedAt: dateTimeBefore(startDate, 18, '07:19:00-07:00'),
    },
    employer: {
      hrCoordinator: choose(seed, 'hrCoordinator', [
        'Maya Chen',
        'Priya Nair',
        'Jon Bell',
        'Lena Ortiz',
      ]),
      onboardingSystem: choose(seed, 'onboardingSystem', [
        'Northstar Onboard',
        'PeopleBridge',
        'LaunchDesk HR',
      ]),
      recruitingInbox: `people-ops-${safeCompanySlug}@example.test`,
      workerId: `CHR-${10000 + (hashInt(seed, 'workerId') % 90000)}`,
      officeLabel: choose(seed, 'officeLabel', [
        'Regional Operations Desk',
        'New Hire Support Queue',
        'People Operations Hub',
      ]),
    },
    housing: {
      propertyManager: choose(seed, 'propertyManager', [
        'Evergreen Residential Services',
        'Cedarline Property Group',
        'Harbor & Hill Residential',
      ]),
      residentPortal: choose(seed, 'residentPortal', [
        'ResidentLink',
        'HomeLedger',
        'LeasePoint',
      ]),
      leaseAccountId: `RL-${10000 + (hashInt(seed, 'leaseAccountId') % 90000)}`,
    },
    utility: {
      provider: utilityProvider,
      exportId: `${utilityExportPrefix}-EXP-U${1000 + (hashInt(seed, 'utilityExportIdA') % 9000)}X${100 + (hashInt(seed, 'utilityExportIdB') % 900)}`,
      serviceAccountSuffix: String(1000 + (hashInt(seed, 'utilitySuffix') % 9000)),
    },
    identityCapture: {
      uploadBatchId: `UPL-${hashInt(seed, 'uploadBatchId').toString(16).slice(0, 6).toUpperCase()}`,
      licenseImageName: `IMG_${4000 + (hashInt(seed, 'licenseImage') % 5000)}_license_front.jpg`,
      ssnImageName: `IMG_${4000 + (hashInt(seed, 'ssnImage') % 5000)}_ssn_card.jpg`,
    },
    noise: {
      sender: choose(seed, 'noiseSender', [
        'announcements@example.test',
        'resident-news@example.test',
        'events@example.test',
      ]),
      subject: choose(seed, 'noiseSubject', [
        'Community notice: weekend events and maintenance reminders',
        'Monthly resident update and local event calendar',
        'Neighborhood bulletin: service notices and activities',
      ]),
    },
  };
}

function truncateSlugAtBoundary(slug, maxLength = 32) {
  if (slug.length <= maxLength) return slug;
  const truncated = slug.slice(0, maxLength);
  const boundary = truncated.lastIndexOf('-');
  if (boundary > 0) return truncated.slice(0, boundary);
  return truncated;
}

function initialism(value) {
  const letters = String(value)
    .split(/[^a-z0-9]+/i)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase())
    .join('');
  return letters.slice(0, 3) || 'SRC';
}

export function assertArtifactWorldHasNoProfileCollisions({ artifactWorld, profileFacts }) {
  const worldValues = flattenPrimitiveValues(artifactWorld);
  for (const [factKey, factValue] of profileFacts.leaves.entries()) {
    if (factValue == null) continue;
    const factValues = flattenPrimitiveValues(factValue);
    for (const factText of factValues) {
      for (const worldText of worldValues) {
        if (normalizedForCollision(factText) === normalizedForCollision(worldText)) {
          throw new Error(
            `artifactWorld value ${JSON.stringify(worldText)} collides with profile fact ${factKey}.`,
          );
        }
        if (
          digitCollisionFact(factKey) &&
          digitsOnly(factText).length >= 4 &&
          digitsOnly(factText) === digitsOnly(worldText)
        ) {
          throw new Error(
            `artifactWorld identifier ${JSON.stringify(worldText)} collides with profile fact ${factKey}.`,
          );
        }
      }
    }
  }
}

function flattenPrimitiveValues(value) {
  if (Array.isArray(value)) return value.flatMap(flattenPrimitiveValues);
  if (value && typeof value === 'object') {
    return Object.values(value).flatMap(flattenPrimitiveValues);
  }
  if (value == null) return [];
  return [String(value)];
}

function normalizedForCollision(value) {
  return String(value).normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
}

function digitCollisionFact(factKey) {
  return (
    factKey === 'identity.ssn' ||
    factKey.startsWith('workAuthorization.') ||
    factKey === 'contact.phone'
  );
}

function choose(seed, key, values) {
  return values[hashInt(seed, key) % values.length];
}

function dateTimeBefore(isoDate, daysBefore, timeWithOffset) {
  const [year, month, day] = String(isoDate).split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() - daysBefore);
  const yyyy = String(date.getUTCFullYear()).padStart(4, '0');
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}T${timeWithOffset}`;
}

function digitsOnly(value) {
  return String(value).replace(/\D/g, '');
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
