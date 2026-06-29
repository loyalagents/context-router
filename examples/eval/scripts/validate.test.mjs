import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { formatResult, parseArgs, runValidation } from './validate.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../..');

test('loads the backend preference catalog JSON used by the validator', async () => {
  const catalog = await readJson(
    path.join(repoRoot, 'apps/backend/src/config/preferences.catalog.json'),
  );

  assert.equal(catalog['profile.email'].valueType, 'string');
  assert.equal(catalog['profile.email'].isSensitive, true);
  assert.equal(catalog['communication.preferred_channels'].valueType, 'array');
});

test('passes the canonical Elena template-smoke corpus', async () => {
  const result = await runValidation({
    repoRoot,
    args: ['--user', 'elena-marquez', '--corpus', 'template-smoke'],
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.summary.errors, 0);
});

test('validates template metadata schema and manifest template references', async (t) => {
  const root = await copyRepo(t);
  const templatePath = path.join(
    root,
    'examples/eval/templates/identity/name-history-note.mjs',
  );
  const templateText = await readFile(templatePath, 'utf8');
  await writeFile(
    templatePath,
    templateText.replace("outputExtension: 'md'", "outputExtension: 'pdf'"),
  );

  const manifestPath = elenaManifestPath(root);
  const manifest = await readJson(manifestPath);
  manifest.documents[0].template = 'identity/not-real';
  await writeJson(manifestPath, manifest);

  const result = await validateElena(root);
  assertHasCode(result, 'SCHEMA_VALIDATION_FAILED');
  assertHasCode(result, 'DOCUMENT_TEMPLATE_MISSING');
});

test('validates template id and category path parity', async (t) => {
  const root = await copyRepo(t);
  const templatePath = path.join(
    root,
    'examples/eval/templates/identity/name-history-note.mjs',
  );
  const templateText = await readFile(templatePath, 'utf8');
  await writeFile(
    templatePath,
    templateText
      .replace(
        "templateId: 'identity/name-history-note'",
        "templateId: 'identity/wrong-note'",
      )
      .replace("category: 'identity'", "category: 'address-contact'"),
  );

  const result = await validateElena(root);
  assertHasCode(result, 'TEMPLATE_ID_PATH_MISMATCH');
  assertHasCode(result, 'TEMPLATE_CATEGORY_PATH_MISMATCH');
});

test('rejects stale generated seed preferences', async (t) => {
  const root = await copyRepo(t);
  await writeFile(
    path.join(
      root,
      'examples/eval/users/elena-marquez/seed-preferences.generated.json',
    ),
    '[]\n',
  );

  const result = await validateElena(root);
  assert.equal(result.exitCode, 1);
  assertHasCode(result, 'SEED_GENERATED_STALE');
  assert.match(formatResult(result), /\nprofiles:\n/);
});

test('validates seed slugs and catalog value types', async (t) => {
  const root = await copyRepo(t);
  const profilePath = path.join(
    root,
    'examples/eval/users/elena-marquez/profile.yaml',
  );
  const profile = await readFile(profilePath, 'utf8');
  await writeFile(
    profilePath,
    `${profile}
  - slug: profile.not_real
    factKey: identity.firstName
  - slug: profile.full_name
    factKey: communication.preferredChannels
`,
  );

  const result = await validateElena(root);
  assertHasCode(result, 'SEED_UNKNOWN_SLUG');
  assertHasCode(result, 'SEED_VALUE_TYPE_MISMATCH');
});

test('rejects missing and unlisted document paths', async (t) => {
  const root = await copyRepo(t);
  const manifestPath = elenaManifestPath(root);
  const manifest = await readJson(manifestPath);
  manifest.documents[0].path = 'documents/identity/missing.md';
  await writeJson(manifestPath, manifest);

  await writeFile(
    path.join(
      root,
      'examples/eval/users/elena-marquez/corpora/realistic/documents/identity/unlisted.md',
    ),
    'unlisted fixture file\n',
  );

  const result = await validateElena(root);
  assertHasCode(result, 'DOCUMENT_PATH_MISSING');
  assertHasCode(result, 'DOCUMENT_UNLISTED_FILE');
});

test('rejects area document facts and legacy noise detail tiers', async (t) => {
  const root = await copyRepo(t);
  const manifestPath = elenaManifestPath(root);
  const manifest = await readJson(manifestPath);
  manifest.documents[0].factContract.include = ['address.current'];
  manifest.documents[0].evaluationRole.detailTier = 'noise';
  await writeJson(manifestPath, manifest);

  const result = await validateElena(root);
  assertHasCode(result, 'DOCUMENT_FACT_AREA');
  assertHasCode(result, 'SCHEMA_VALIDATION_FAILED');
});

test('reports field-map pre-pass and exhaustiveness errors', async (t) => {
  const root = await copyRepo(t);
  const fieldMapPath = path.join(
    root,
    'examples/eval/forms/i-9/field-map.json',
  );
  const fieldMap = await readJson(fieldMapPath);
  fieldMap.fields[0].mode = 'mystery';
  fieldMap.fields[1].pdfFieldName = 'Wrong Field Name';
  await writeJson(fieldMapPath, fieldMap);

  const result = await validateElena(root);
  assertHasCode(result, 'FIELD_MAP_INVALID_MODE');
  assertHasCode(result, 'FIELD_MAP_NAME_MISMATCH');
});

test('reports invalid V2 field-map condition and render hints', async (t) => {
  const root = await copyRepo(t);
  const fieldMapPath = path.join(
    root,
    'examples/eval/forms/i-9/field-map.json',
  );
  const fieldMap = await readJson(fieldMapPath);
  fieldMap.fields[2].when = { factKey: 'identity.notReal', equals: 'x' };
  fieldMap.fields[15].render = 'slashes';
  fieldMap.fields[16].when = { factKey: 'identity.firstName', equals: [] };
  await writeJson(fieldMapPath, fieldMap);

  const result = await validateElena(root);
  assertHasCode(result, 'FIELD_MAP_CONDITION_FACT_MISSING');
  assertHasCode(result, 'SCHEMA_VALIDATION_FAILED');
});

test('reports I-9 citizenship checkbox group with no active branch for profile value', async (t) => {
  const root = await copyRepo(t);
  const profilePath = path.join(
    root,
    'examples/eval/users/elena-marquez/profile.yaml',
  );
  const profile = await readFile(profilePath, 'utf8');
  await writeFile(
    profilePath,
    profile.replace(
      'citizenshipStatus: U.S. citizen',
      'citizenshipStatus: US citizen',
    ),
  );

  const result = await validateElena(root);
  assertHasCode(result, 'FIELD_MAP_CONDITION_NO_MATCH');
});

test('reports I-9 citizenship checkbox group with multiple active branches for profile value', async (t) => {
  const root = await copyRepo(t);
  const fieldMapPath = path.join(root, 'examples/eval/forms/i-9/field-map.json');
  const fieldMap = await readJson(fieldMapPath);
  const secondCitizenshipCheckbox = fieldMap.fields.find(
    (field) => field.pdfFieldName === 'CB_2',
  );
  secondCitizenshipCheckbox.when.equals = 'U.S. citizen';
  await writeJson(fieldMapPath, fieldMap);

  const result = await validateElena(root);
  assertHasCode(result, 'FIELD_MAP_CONDITION_MULTIPLE_MATCHES');
});

test('rejects invalid intentionally missing form references', async (t) => {
  const root = await copyRepo(t);
  const manifestPath = elenaManifestPath(root);
  const manifest = await readJson(manifestPath);
  manifest.intentionallyMissing[0].forms = ['fw4'];
  await writeJson(manifestPath, manifest);

  const result = await validateElena(root);
  assertHasCode(result, 'MISSING_FORM_NOT_IN_MANIFEST');
});

test('rejects noise and ignore metadata violations', async (t) => {
  const root = await copyRepo(t);
  const manifestPath = elenaManifestPath(root);
  const manifest = await readJson(manifestPath);
  manifest.documents.find((doc) => doc.id === '081').evaluationRole.expectedUse = 'extract';
  const ignored = manifest.documents.find((doc) => doc.id === '082');
  ignored.evaluationRole.expectedUse = 'ignore';
  ignored.factContract.include = ['identity.firstName'];
  await writeJson(manifestPath, manifest);

  const result = await validateElena(root);
  assertHasCode(result, 'DOCUMENT_NOISE_EXPECTED_USE');
  assertHasCode(result, 'DOCUMENT_IGNORE_FACT_KEYS');
});

test('plan-only validates canonical manifests without document bodies', async (t) => {
  const root = await copyRepo(t);
  const corpusRoot = path.join(
    root,
    'examples/eval/users/samir-desai/corpora/realistic',
  );
  await mkdir(corpusRoot, { recursive: true });
  await writeJson(path.join(corpusRoot, 'manifest.json'), unitManifest({
    intentionallyMissing: [
      {
        factKey: 'contact.phone',
        forms: ['i-9'],
        reason: 'Phone intentionally missing.',
        expectedBehavior: 'Leave phone blank.',
      },
    ],
    documents: [
      planDoc({
        factContract: {
          include: ['identity.ssn'],
          forbid: ['contact.phone'],
        },
      }),
      planDoc({
        id: '002',
        path: 'documents/noise/002-noise.txt',
        category: 'noise',
        title: 'Noise Note',
        outputExtension: 'txt',
        factContract: { include: [], forbid: [] },
        evaluationRole: {
          detailTier: 'brief',
          authority: 'none',
          freshness: 'unknown',
          expectedUse: 'ignore',
          challengeTags: ['noise'],
        },
      }),
    ],
  }));

  const result = await runValidation({
    repoRoot: root,
    args: ['--user', 'samir-desai', '--corpus', 'realistic', '--plan-only'],
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.summary.errors, 0);
});

test('manifest validation rejects invalid forbidden fact references', async (t) => {
  const root = await copyRepo(t);
  const corpusRoot = path.join(
    root,
    'examples/eval/users/samir-desai/corpora/realistic',
  );
  await mkdir(corpusRoot, { recursive: true });
  await writeJson(path.join(corpusRoot, 'manifest.json'), unitManifest({
    factContractDefaults: {
      forbid: ['address.current', 'identity.notReal'],
    },
    intentionallyMissing: [],
    documents: [
      planDoc({
        factContract: {
          include: ['identity.ssn'],
          forbid: ['address.current', 'identity.notReal'],
        },
      }),
    ],
  }));

  const result = await runValidation({
    repoRoot: root,
    args: ['--user', 'samir-desai', '--corpus', 'realistic', '--plan-only'],
  });

  assertHasCode(result, 'MANIFEST_FORBIDDEN_FACT_AREA');
  assertHasCode(result, 'MANIFEST_FORBIDDEN_FACT_MISSING');
  assertHasCode(result, 'MANIFEST_DEFAULT_FORBIDDEN_FACT_AREA');
  assertHasCode(result, 'MANIFEST_DEFAULT_FORBIDDEN_FACT_MISSING');
});

test('manifest schema accepts default forbidden facts and rejects unexpected fields', async (t) => {
  const root = await copyRepo(t);
  const corpusRoot = path.join(
    root,
    'examples/eval/users/samir-desai/corpora/realistic',
  );
  await mkdir(corpusRoot, { recursive: true });
  await writeJson(path.join(corpusRoot, 'manifest.json'), unitManifest({
    ownershipAudit: [
      {
        ownerKey: 'noahKim',
        ownerName: 'Noah Kim',
        valueLabel: 'routingNumber',
        value: '122105278',
        allowedSlugPrefixes: ['payroll.other_employee.'],
        forbiddenFactKeys: ['banking.routingNumber'],
      },
    ],
    factContractDefaults: { forbid: ['contact.phone'] },
    intentionallyMissing: [],
    documents: [
      planDoc({
        factContract: {
          include: ['identity.ssn'],
          forbid: ['contact.phone'],
        },
      }),
    ],
  }));

  const validResult = await runValidation({
    repoRoot: root,
    args: ['--user', 'samir-desai', '--corpus', 'realistic', '--plan-only'],
  });
  assert.equal(validResult.exitCode, 0);
  assertNoCode(validResult, 'SCHEMA_VALIDATION_FAILED');

  const plan = await readJson(path.join(corpusRoot, 'manifest.json'));
  plan.unexpectedTopLevelField = true;
  plan.ownershipAudit[0].unsupportedAuditField = true;
  plan.documents[0].unsupportedPlanField = true;
  await writeJson(path.join(corpusRoot, 'manifest.json'), plan);

  const result = await runValidation({
    repoRoot: root,
    args: ['--user', 'samir-desai', '--corpus', 'realistic', '--plan-only'],
  });

  assertHasCode(result, 'SCHEMA_VALIDATION_FAILED');
  assertNoCode(result, 'MANIFEST_FORBIDDEN_FACT_MISSING');
});

test('manifest schema rejects V1 manifest fields', async (t) => {
  const root = await copyRepo(t);
  const corpusRoot = path.join(
    root,
    'examples/eval/users/samir-desai/corpora/realistic',
  );
  await mkdir(corpusRoot, { recursive: true });
  const plan = unitManifest();
  plan.schemaVersion = 1;
  plan.defaultForbiddenFactKeys = ['contact.phone'];
  plan.targetDocumentCount = 1;
  plan.categoryCounts = { identity: 1 };
  plan.documents[0].factKeys = ['identity.ssn'];
  plan.documents[0].brief = 'Legacy V1 brief.';
  await writeJson(path.join(corpusRoot, 'manifest.json'), plan);

  const result = await runValidation({
    repoRoot: root,
    args: ['--user', 'samir-desai', '--corpus', 'realistic', '--plan-only'],
  });

  assertHasCode(result, 'SCHEMA_VALIDATION_FAILED');
});

test('manifest schema rejects each legacy V1 planning field', async (t) => {
  const root = await copyRepo(t);
  const corpusRoot = path.join(
    root,
    'examples/eval/users/samir-desai/corpora/realistic',
  );
  await mkdir(corpusRoot, { recursive: true });

  const legacyFields = [
    ['defaultForbiddenFactKeys', (plan) => {
      plan.defaultForbiddenFactKeys = ['contact.phone'];
    }],
    ['targetDocumentCount', (plan) => {
      plan.targetDocumentCount = 1;
    }],
    ['categoryCounts', (plan) => {
      plan.categoryCounts = { identity: 1 };
    }],
    ['top-level challengeTags', (plan) => {
      plan.challengeTags = ['current-fact'];
    }],
    ['document factKeys', (plan) => {
      plan.documents[0].factKeys = ['identity.ssn'];
    }],
    ['document forbiddenFactKeys', (plan) => {
      plan.documents[0].forbiddenFactKeys = ['contact.phone'];
    }],
    ['document brief', (plan) => {
      plan.documents[0].brief = 'Legacy V1 brief.';
    }],
    ['document texture', (plan) => {
      plan.documents[0].texture = 'Legacy V1 texture.';
    }],
    ['document detailTier', (plan) => {
      plan.documents[0].detailTier = 'brief';
    }],
    ['document authority', (plan) => {
      plan.documents[0].authority = 'medium';
    }],
    ['document freshness', (plan) => {
      plan.documents[0].freshness = 'current';
    }],
    ['document expectedUse', (plan) => {
      plan.documents[0].expectedUse = 'extract';
    }],
    ['document challengeTags', (plan) => {
      plan.documents[0].challengeTags = ['current-fact'];
    }],
  ];

  for (const [fieldName, mutate] of legacyFields) {
    const plan = unitManifest();
    mutate(plan);
    await writeJson(path.join(corpusRoot, 'manifest.json'), plan);

    const result = await runValidation({
      repoRoot: root,
      args: ['--user', 'samir-desai', '--corpus', 'realistic', '--plan-only'],
    });

    assert.ok(
      result.issues.some((issue) => issue.code === 'SCHEMA_VALIDATION_FAILED'),
      `${fieldName} should be rejected`,
    );
  }
});

test('manifest schema rejects duplicate forbidden fact keys', async (t) => {
  const root = await copyRepo(t);
  const corpusRoot = path.join(
    root,
    'examples/eval/users/samir-desai/corpora/realistic',
  );
  await mkdir(corpusRoot, { recursive: true });
  await writeJson(path.join(corpusRoot, 'manifest.json'), unitManifest({
    factContractDefaults: { forbid: ['contact.phone', 'contact.phone'] },
    intentionallyMissing: [],
    documents: [
      planDoc({
        factContract: {
          include: ['identity.ssn'],
          forbid: ['contact.email', 'contact.email'],
        },
      }),
    ],
  }));

  const result = await runValidation({
    repoRoot: root,
    args: ['--user', 'samir-desai', '--corpus', 'realistic', '--plan-only'],
  });

  assertHasCode(result, 'SCHEMA_VALIDATION_FAILED');
});

test('manifest schema requires sourceSpec only for realistic-generated corpora', async (t) => {
  const root = await copyRepo(t);
  const templateManifestPath = path.join(
    root,
    'examples/eval/users/elena-marquez/corpora/template-smoke/manifest.json',
  );
  const templateManifest = await readJson(templateManifestPath);
  assert.equal(templateManifest.corpusKind, 'template-smoke');
  assert.equal(templateManifest.documents.some((doc) => doc.sourceSpec), false);

  const templateResult = await runValidation({
    repoRoot: root,
    args: ['--user', 'elena-marquez', '--corpus', 'template-smoke', '--plan-only'],
  });
  assert.equal(templateResult.exitCode, 0);

  templateManifest.documents[0].sourceSpec = sourceSpec();
  await writeJson(templateManifestPath, templateManifest);
  const templateWithSourceSpec = await runValidation({
    repoRoot: root,
    args: ['--user', 'elena-marquez', '--corpus', 'template-smoke', '--plan-only'],
  });
  assertHasCode(templateWithSourceSpec, 'SCHEMA_VALIDATION_FAILED');

  delete templateManifest.documents[0].sourceSpec;
  templateManifest.artifactWorld = {
    schemaVersion: 1,
    seed: 'elena-marquez__template-smoke',
    timeline: {},
  };
  await writeJson(templateManifestPath, templateManifest);
  const templateWithArtifactWorld = await runValidation({
    repoRoot: root,
    args: ['--user', 'elena-marquez', '--corpus', 'template-smoke', '--plan-only'],
  });
  assertHasCode(templateWithArtifactWorld, 'SCHEMA_VALIDATION_FAILED');

  delete templateManifest.artifactWorld;
  templateManifest.factContractDefaults = { forbid: [] };
  await writeJson(templateManifestPath, templateManifest);
  const templateWithDefaults = await runValidation({
    repoRoot: root,
    args: ['--user', 'elena-marquez', '--corpus', 'template-smoke', '--plan-only'],
  });
  assertHasCode(templateWithDefaults, 'SCHEMA_VALIDATION_FAILED');

  const realisticManifestPath = elenaManifestPath(root);
  const realisticManifest = await readJson(realisticManifestPath);
  delete realisticManifest.documents[0].sourceSpec;
  await writeJson(realisticManifestPath, realisticManifest);
  const realisticWithoutSourceSpec = await runValidation({
    repoRoot: root,
    args: ['--user', 'elena-marquez', '--corpus', 'realistic', '--plan-only'],
  });
  assertHasCode(realisticWithoutSourceSpec, 'SCHEMA_VALIDATION_FAILED');

  realisticManifest.documents[0].sourceSpec = sourceSpec();
  delete realisticManifest.artifactWorld;
  await writeJson(realisticManifestPath, realisticManifest);
  const realisticWithoutWorld = await runValidation({
    repoRoot: root,
    args: ['--user', 'elena-marquez', '--corpus', 'realistic', '--plan-only'],
  });
  assertHasCode(realisticWithoutWorld, 'SCHEMA_VALIDATION_FAILED');

  realisticManifest.artifactWorld = {
    schemaVersion: 1,
    seed: 'elena-marquez__realistic',
    timeline: {},
  };
  delete realisticManifest.factContractDefaults;
  await writeJson(realisticManifestPath, realisticManifest);
  const realisticWithoutDefaults = await runValidation({
    repoRoot: root,
    args: ['--user', 'elena-marquez', '--corpus', 'realistic', '--plan-only'],
  });
  assertHasCode(realisticWithoutDefaults, 'SCHEMA_VALIDATION_FAILED');
});

test('manifest validation rejects inverted source length targets', async (t) => {
  const root = await copyRepo(t);
  const manifestPath = elenaManifestPath(root);
  const manifest = await readJson(manifestPath);
  manifest.documents[0].sourceSpec.lengthTarget = { minChars: 800, maxChars: 200 };
  await writeJson(manifestPath, manifest);

  const result = await runValidation({
    repoRoot: root,
    args: ['--user', 'elena-marquez', '--corpus', 'realistic', '--plan-only'],
  });

  assertHasCode(result, 'MANIFEST_LENGTH_TARGET_INVALID');
});

test('manifest validation rejects document forbidden facts that conflict with declared facts', async (t) => {
  const root = await copyRepo(t);
  const manifestPath = elenaManifestPath(root);
  const manifest = await readJson(manifestPath);
  manifest.documents[0].factContract.include = ['identity.ssn'];
  manifest.documents[0].factContract.forbid = ['identity.ssn'];
  await writeJson(manifestPath, manifest);

  const result = await validateElena(root);
  assertHasCode(result, 'MANIFEST_FORBIDDEN_FACT_CONFLICT');
});

test('validator no longer reads split corpus-plan files', async (t) => {
  const root = await copyRepo(t);
  const manifestPath = elenaManifestPath(root);
  const corpusRoot = path.dirname(manifestPath);
  await writeJson(path.join(corpusRoot, 'corpus-plan.json'), {
    schemaVersion: 2,
    userId: 'wrong-user',
    documents: [],
  });

  const result = await validateElena(root);
  assert.equal(result.exitCode, 0);
  assertNoCode(result, 'MANIFEST_PLAN_MISMATCH');
  assertNoCode(result, 'MANIFEST_USER_ID_MISMATCH');
});

test('prose checks require high-confidence declared values in document bodies', async (t) => {
  const root = await copyRepo(t);
  const manifestPath = elenaManifestPath(root);
  const manifest = await readJson(manifestPath);
  manifest.documents[0].factContract.include = [
    'identity.ssn',
    'identity.dateOfBirth',
    'address.current.postalCode',
    'address.current.state',
    'workAuthorization.citizenshipStatus',
  ];
  manifest.documents[0].evaluationRole.expectedUse = 'extract';
  await writeJson(manifestPath, manifest);
  await writeFile(
    path.join(
      root,
      'examples/eval/users/elena-marquez/corpora/realistic',
      manifest.documents[0].path,
    ),
    'This document does not include the sensitive identifier.\n',
  );

  const result = await validateElena(root);
  assertHasCode(result, 'DOCUMENT_FACT_VALUE_MISSING');
});

test('unsupported include facts are visible warnings without failing validation', async (t) => {
  const root = await copyRepo(t);
  const manifestPath = path.join(
    root,
    'examples/eval/users/elena-marquez/corpora/template-smoke/manifest.json',
  );
  const manifest = await readJson(manifestPath);
  manifest.documents[0].factContract.include.push('communication.preferredChannels');
  await writeJson(manifestPath, manifest);

  const result = await runValidation({
    repoRoot: root,
    args: ['--user', 'elena-marquez', '--corpus', 'template-smoke'],
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.summary.errors, 0);
  assertHasCode(result, 'DOCUMENT_FACT_UNSUPPORTED_FOR_SCORING');
  assert.ok(
    result.issues.some(
      (issue) =>
        issue.code === 'DOCUMENT_FACT_UNSUPPORTED_FOR_SCORING' &&
        issue.level === 'warning',
    ),
  );
  assert.equal(result.report.corpusTruth.summary.unsupportedDeclaredFacts, 1);
});

test('prose checks prove declared work authorization document values deterministically', async (t) => {
  const root = await copyRepo(t);
  const manifestPath = alexManifestPath(root);
  const manifest = await readJson(manifestPath);
  const corpusRoot = path.dirname(manifestPath);
  const i9Doc = manifest.documents.find((doc) =>
    doc.path.endsWith('006-i9-section-one-field-export.yaml')
  );
  assert.ok(i9Doc);
  const docPath = path.join(corpusRoot, i9Doc.path);

  const validResult = await validateAlex(root);
  const validTruth = validResult.report.corpusTruth.documents.find(
    (entry) => entry.id === i9Doc.id,
  );
  for (const factKey of [
    'workAuthorization.workAuthorizationExpirationDate',
    'workAuthorization.i94AdmissionNumber',
    'workAuthorization.foreignPassportNumber',
  ]) {
    assert.ok(validTruth.declaredFacts.provenPresent.includes(factKey));
    assert.ok(!validTruth.declaredFacts.unsupported.includes(factKey));
  }

  const body = await readFile(docPath, 'utf8');
  const bodyWithoutI94 = body.replace(
    /(\n\s*(?:(?:"Form I-94 Admission Number"|form_i94_admission_number)\s*:\s*)?(?:field_id:\s*s1_i94_admission_number\s*\n\s*)?value:\s*)['"]?11223344556['"]?/,
    '$1null',
  );
  assert.notEqual(bodyWithoutI94, body);
  await writeFile(
    docPath,
    bodyWithoutI94,
  );

  const missingResult = await validateAlex(root);
  assertHasCode(missingResult, 'DOCUMENT_FACT_VALUE_MISSING');
  const missingTruth = missingResult.report.corpusTruth.documents.find(
    (entry) => entry.id === i9Doc.id,
  );
  assert.ok(
    missingTruth.declaredFacts.missing.includes(
      'workAuthorization.i94AdmissionNumber',
    ),
  );
});

test('prose checks prove date of birth from hyphenated US date variants', async (t) => {
  const root = await copyRepo(t);
  const manifestPath = alexManifestPath(root);
  const manifest = await readJson(manifestPath);
  const corpusRoot = path.dirname(manifestPath);
  const doc = manifest.documents.find((entry) =>
    entry.path.endsWith('001-driver-license-upload-ocr.txt')
  );
  doc.factContract.include = ['identity.dateOfBirth'];
  doc.evaluationRole.expectedUse = 'extract';
  await writeJson(manifestPath, manifest);
  await writeFile(
    path.join(corpusRoot, doc.path),
    [
      'OCR EXPORT RECORD',
      'Document status: front image received',
      'DOB 03-14-1992',
    ].join('\n'),
  );

  const result = await validateAlex(root);
  assertNoCode(result, 'DOCUMENT_FACT_VALUE_MISSING');
  const truth = result.report.corpusTruth.documents.find(
    (entry) => entry.id === doc.id,
  );
  assert.ok(truth.declaredFacts.provenPresent.includes('identity.dateOfBirth'));
});

test('prose checks prove legal names from labeled split OCR name fields', async (t) => {
  const root = await copyRepo(t);
  const manifestPath = alexManifestPath(root);
  const manifest = await readJson(manifestPath);
  const corpusRoot = path.dirname(manifestPath);
  const doc = manifest.documents.find((entry) =>
    entry.path.endsWith('001-driver-license-upload-ocr.txt')
  );
  doc.factContract.include = ['identity.legalName'];
  doc.evaluationRole.expectedUse = 'extract';
  await writeJson(manifestPath, manifest);
  await writeFile(
    path.join(corpusRoot, doc.path),
    [
      'OCR EXPORT RECORD',
      'Document status: front image received',
      'LN RIVERA',
      'FN ALEX JORDAN',
    ].join('\n'),
  );

  const result = await validateAlex(root);
  assertNoCode(result, 'DOCUMENT_FACT_VALUE_MISSING');
  const truth = result.report.corpusTruth.documents.find(
    (entry) => entry.id === doc.id,
  );
  assert.ok(truth.declaredFacts.provenPresent.includes('identity.legalName'));
});

test('prose checks prove legal names from labeled I-9 YAML name fields', async (t) => {
  const root = await copyRepo(t);
  const manifestPath = alexManifestPath(root);
  const manifest = await readJson(manifestPath);
  const corpusRoot = path.dirname(manifestPath);
  const doc = manifest.documents.find((entry) =>
    entry.path.endsWith('006-i9-section-one-field-export.yaml')
  );
  doc.factContract.include = ['identity.legalName'];
  doc.evaluationRole.expectedUse = 'extract';
  await writeJson(manifestPath, manifest);
  await writeFile(
    path.join(corpusRoot, doc.path),
    [
      'field_1a_last_name: Rivera',
      'field_1b_first_name: Alex',
      'field_1c_middle_initial: J',
    ].join('\n'),
  );

  const result = await validateAlex(root);
  assertNoCode(result, 'DOCUMENT_FACT_VALUE_MISSING');
  const truth = result.report.corpusTruth.documents.find(
    (entry) => entry.id === doc.id,
  );
  assert.ok(truth.declaredFacts.provenPresent.includes('identity.legalName'));
});

test('prose checks prove legal names from section-native I-9 field labels', async (t) => {
  const root = await copyRepo(t);
  const manifestPath = alexManifestPath(root);
  const manifest = await readJson(manifestPath);
  const corpusRoot = path.dirname(manifestPath);
  const doc = manifest.documents.find((entry) =>
    entry.path.endsWith('006-i9-section-one-field-export.yaml')
  );
  doc.factContract.include = ['identity.legalName'];
  doc.evaluationRole.expectedUse = 'extract';
  await writeJson(manifestPath, manifest);
  await writeFile(
    path.join(corpusRoot, doc.path),
    [
      'section_one_data:',
      '  employee_identity:',
      '    s1_last_name: "Rivera"',
      '    s1_first_name: "Alex"',
      '    s1_middle_initial: "J"',
    ].join('\n'),
  );

  const result = await validateAlex(root);
  assertNoCode(result, 'DOCUMENT_FACT_VALUE_MISSING');
  const truth = result.report.corpusTruth.documents.find(
    (entry) => entry.id === doc.id,
  );
  assert.ok(truth.declaredFacts.provenPresent.includes('identity.legalName'));
});

test('prose checks reject weak split-field legal name evidence', async (t) => {
  const cases = [
    {
      name: 'missing last-name label',
      body: ['FN ALEX JORDAN', 'name: Rivera'].join('\n'),
    },
    {
      name: 'wrong last name',
      body: ['FN ALEX JORDAN', 'LN RIVAS'].join('\n'),
    },
    {
      name: 'unrelated reviewer names',
      body: [
        'reviewer_first_name: Alex',
        'reviewer_middle_initial: J',
        'reviewer_last_name: Rivera',
      ].join('\n'),
    },
  ];

  for (const { name, body } of cases) {
    const root = await copyRepo(t);
    const manifestPath = alexManifestPath(root);
    const manifest = await readJson(manifestPath);
    const corpusRoot = path.dirname(manifestPath);
    const doc = manifest.documents.find((entry) =>
      entry.path.endsWith('001-driver-license-upload-ocr.txt')
    );
    doc.factContract.include = ['identity.legalName'];
    doc.evaluationRole.expectedUse = 'extract';
    await writeJson(manifestPath, manifest);
    await writeFile(path.join(corpusRoot, doc.path), `${body}\n`);

    const result = await validateAlex(root);
    assertHasCode(result, 'DOCUMENT_FACT_VALUE_MISSING');
    assert.ok(
      result.report.corpusTruth.documents
        .find((entry) => entry.id === doc.id)
        .declaredFacts.missing.includes('identity.legalName'),
      `${name} should not prove the legal name`,
    );
  }
});

test('prose checks require expanded deterministic declared facts in document bodies', async (t) => {
  const root = await copyRepo(t);
  const manifestPath = elenaManifestPath(root);
  const manifest = await readJson(manifestPath);
  const corpusRoot = path.dirname(manifestPath);
  const doc = manifest.documents[0];
  doc.factContract.include = [
    'identity.legalName',
    'identity.firstName',
    'identity.lastName',
    'identity.middleInitial',
    'identity.otherLastNames',
    'address.current.street',
    'address.current.unit',
    'address.current.city',
    'employment.company',
    'employment.title',
  ];
  doc.evaluationRole.expectedUse = 'extract';
  await writeJson(manifestPath, manifest);
  await writeJson(path.join(corpusRoot, 'manifest.json'), corpusPlanFromManifest(manifest));
  await writeFile(
    path.join(corpusRoot, doc.path),
    [
      'Employee: Elena Sofia Marquez, previous family name Ruiz.',
      'Initial on file: S.',
      'Address: 418 Cedar Glen Ave #12B',
      'Sacramento, CA 95819',
      'Employer: Cedar and Coast Analytics',
      'Title: Data Operations Analyst',
    ].join('\n'),
  );

  const result = await validateElena(root);
  assertNoCode(result, 'DOCUMENT_FACT_VALUE_MISSING');
  const truth = result.report.corpusTruth.documents.find(
    (entry) => entry.id === doc.id,
  );
  assert.deepEqual(truth.declaredFacts.missing, []);
  assert.ok(truth.declaredFacts.provenPresent.includes('address.current.street'));
  assert.ok(truth.declaredFacts.provenPresent.includes('identity.otherLastNames'));
});

test('employment start date requires a date variant near start or hire context', async (t) => {
  const root = await copyRepo(t);
  const manifestPath = elenaManifestPath(root);
  const manifest = await readJson(manifestPath);
  const corpusRoot = path.dirname(manifestPath);
  const doc = manifest.documents[0];
  doc.factContract.include = ['employment.startDate'];
  doc.evaluationRole.expectedUse = 'extract';
  await writeJson(manifestPath, manifest);
  await writeJson(path.join(corpusRoot, 'manifest.json'), corpusPlanFromManifest(manifest));
  const docPath = path.join(corpusRoot, doc.path);

  await writeFile(
    docPath,
    'Audit export date 6/3/2026. This is unrelated to employment timing.\n',
  );
  const missing = await validateElena(root);
  assertHasCode(missing, 'DOCUMENT_FACT_VALUE_MISSING');

  await writeFile(docPath, 'Hire date: June 3, 2026.\n');
  const present = await validateElena(root);
  assertNoCode(present, 'DOCUMENT_FACT_VALUE_MISSING');

  for (const body of [
    '{"employmentStartDate":"2026-06-03"}\n',
    'employment:\n  start_date: "2026-06-03"\n',
    '{"dateOfHire":"2026-06-03"}\n',
  ]) {
    await writeFile(docPath, body);
    const structuredPresent = await validateElena(root);
    assertNoCode(structuredPresent, 'DOCUMENT_FACT_VALUE_MISSING');
  }

  await writeFile(docPath, '{"exportedAt":"2026-06-03"}\n');
  const unrelatedStructuredDate = await validateElena(root);
  assertHasCode(unrelatedStructuredDate, 'DOCUMENT_FACT_VALUE_MISSING');
});

test('short name and address values do not match inside longer unrelated tokens', async (t) => {
  const root = await copyRepo(t);
  const manifestPath = elenaManifestPath(root);
  const manifest = await readJson(manifestPath);
  const corpusRoot = path.dirname(manifestPath);
  const doc = manifest.documents[0];
  doc.factContract.include = ['identity.firstName', 'address.current.city'];
  doc.evaluationRole.expectedUse = 'extract';
  await writeJson(manifestPath, manifest);
  await writeJson(path.join(corpusRoot, 'manifest.json'), corpusPlanFromManifest(manifest));
  await writeFile(
    path.join(corpusRoot, doc.path),
    'Internal identifiers: preelenapost and xsacramentoy. No person or city is named.\n',
  );

  const result = await validateElena(root);
  assertHasCode(result, 'DOCUMENT_FACT_VALUE_MISSING');
});

test('document prose checks reject forbidden fact values from canonical manifests', async (t) => {
  const root = await copyRepo(t);
  const manifestPath = elenaManifestPath(root);
  const manifest = await readJson(manifestPath);
  const corpusRoot = path.dirname(manifestPath);
  const doc = manifest.documents[0];
  doc.factContract.include = [];
  doc.evaluationRole.expectedUse = 'guardrail';
  const corpusPlan = corpusPlanFromManifest(manifest);
  corpusPlan.documents[0].factContract.forbid = ['identity.ssn'];
  await writeJson(manifestPath, manifest);
  await writeJson(path.join(corpusRoot, 'manifest.json'), corpusPlan);
  await writeFile(
    path.join(corpusRoot, doc.path),
    'This fixture body leaks SSN 000-00-0194 even though it is forbidden.\n',
  );

  const result = await validateElena(root);
  assertHasCode(result, 'DOCUMENT_FORBIDDEN_FACT_PRESENT');
});

test('document prose checks reject default forbidden fact variants', async (t) => {
  const root = await copyRepo(t);
  const manifestPath = elenaManifestPath(root);
  const manifest = await readJson(manifestPath);
  const corpusRoot = path.dirname(manifestPath);
  const doc = manifest.documents[0];
  doc.factContract.include = [];
  doc.evaluationRole.expectedUse = 'guardrail';
  const corpusPlan = corpusPlanFromManifest(manifest);
  corpusPlan.factContractDefaults.forbid = ['identity.ssn'];
  await writeJson(manifestPath, manifest);
  await writeJson(path.join(corpusRoot, 'manifest.json'), corpusPlan);
  await writeFile(
    path.join(corpusRoot, doc.path),
    'The forbidden SSN appears in compact form as 000000194.\n',
  );

  const result = await validateElena(root);
  assertHasCode(result, 'DOCUMENT_FORBIDDEN_FACT_PRESENT');
  assert.ok(
    result.issues.some(
      (issue) =>
        issue.code === 'DOCUMENT_FORBIDDEN_FACT_PRESENT' &&
        issue.pointer === '/factContractDefaults/forbid/0',
    ),
  );
});

test('document prose checks apply default forbidden facts and remove declared facts from the effective set', async (t) => {
  const root = await copyRepo(t);
  const manifestPath = elenaManifestPath(root);
  const manifest = await readJson(manifestPath);
  const corpusRoot = path.dirname(manifestPath);
  const doc = manifest.documents[0];
  doc.factContract.include = ['identity.ssn'];
  doc.evaluationRole.expectedUse = 'extract';
  const corpusPlan = corpusPlanFromManifest(manifest);
  corpusPlan.factContractDefaults.forbid = ['identity.ssn', 'employment.workEmail'];
  await writeJson(manifestPath, manifest);
  await writeJson(path.join(corpusRoot, 'manifest.json'), corpusPlan);
  await writeFile(
    path.join(corpusRoot, doc.path),
    [
      'Current identity note.',
      'SSN: 000-00-0194.',
      'Work email copied by mistake: elena.marquez@cedarcoast.example.test.',
    ].join('\n'),
  );

  const result = await validateElena(root);
  assertHasCode(result, 'DOCUMENT_FORBIDDEN_FACT_PRESENT');
  assert.ok(
    result.report.corpusTruth.documents[0].declaredFacts.provenPresent.includes(
      'identity.ssn',
    ),
  );
  assert.ok(
    result.report.corpusTruth.documents[0].forbiddenFacts.present.includes(
      'employment.workEmail',
    ),
  );
});

test('document prose checks do not match forbidden numeric facts inside longer ids', async (t) => {
  const root = await copyRepo(t);
  const manifestPath = elenaManifestPath(root);
  const manifest = await readJson(manifestPath);
  const corpusRoot = path.dirname(manifestPath);
  const doc = manifest.documents[0];
  doc.factContract.include = [];
  doc.evaluationRole.expectedUse = 'guardrail';
  const corpusPlan = corpusPlanFromManifest(manifest);
  corpusPlan.documents[0].factContract.forbid = ['identity.ssn'];
  await writeJson(manifestPath, manifest);
  await writeJson(path.join(corpusRoot, 'manifest.json'), corpusPlan);
  await writeFile(
    path.join(corpusRoot, doc.path),
    'Synthetic account export id: 9900000019400. This is not an SSN field.\n',
  );

  const result = await validateElena(root);
  assertNoCode(result, 'DOCUMENT_FORBIDDEN_FACT_PRESENT');
});

test('document prose checks leave null forbidden facts to conservative pattern warnings', async (t) => {
  const root = await copyRepo(t);
  const manifestPath = elenaManifestPath(root);
  const manifest = await readJson(manifestPath);
  const corpusRoot = path.dirname(manifestPath);
  const corpusPlan = corpusPlanFromManifest(manifest);
  corpusPlan.documents[0].factContract.forbid = ['contact.phone'];
  await writeJson(path.join(corpusRoot, 'manifest.json'), corpusPlan);
  await writeFile(
    path.join(corpusRoot, manifest.documents[0].path),
    [
      'License transcript for Elena Sofia Marquez.',
      'DOB: 07/18/1994.',
      'Address: 418 Cedar Glen Avenue Apt 12B, Sacramento, CA 95819.',
      'Temporary callback: 555-123-4567.',
    ].join('\n'),
  );

  const result = await validateElena(root);
  assertNoCode(result, 'DOCUMENT_FORBIDDEN_FACT_PRESENT');
  assertHasCode(result, 'DOCUMENT_MISSING_FACT_PRESENT');
  assertHasCode(result, 'DOCUMENT_SOURCE_PHONE_PRESENT');
  assert.ok(
    result.issues.some(
      (issue) =>
        issue.code === 'DOCUMENT_MISSING_FACT_PRESENT' &&
        issue.level === 'warning',
    ),
  );
});

test('document prose checks hard-fail when concrete withheld values appear', async (t) => {
  const root = await copyRepo(t);
  const manifestPath = elenaManifestPath(root);
  const manifest = await readJson(manifestPath);
  const corpusRoot = path.dirname(manifestPath);
  manifest.intentionallyMissing.find(
    (missing) => missing.factKey === 'contact.phone',
  ).withheldValue = '503-555-0199';
  const doc = manifest.documents[0];
  doc.factContract.include = [];
  doc.evaluationRole.expectedUse = 'extract';
  doc.evaluationRole.freshness = 'current';
  await writeJson(manifestPath, manifest);
  await writeFile(
    path.join(corpusRoot, doc.path),
    [
      'Current identity export for Elena Sofia Marquez.',
      'Date of birth: July 18, 1994.',
      'Current address: 418 Cedar Glen Avenue, Apt 12B, Sacramento, CA 95819.',
      'Telephone: 503-555-0199.',
    ].join('\n'),
  );

  const result = await validateElena(root);
  const truth = result.report.corpusTruth.documents.find(
    (entry) => entry.id === doc.id,
  );

  assertHasCode(result, 'DOCUMENT_WITHHELD_FACT_PRESENT');
  assert.ok(truth.withheldFacts.present.includes('contact.phone'));
  assert.equal(result.report.corpusTruth.summary.withheldValuesPresent, 1);
  assert.equal(result.report.corpusTruth.summary.hardFailures, 1);
});

test('document prose checks do not treat I-9 identifiers as missing phone values', async (t) => {
  const root = await copyRepo(t);
  const manifestPath = elenaManifestPath(root);
  const manifest = await readJson(manifestPath);
  const corpusRoot = path.dirname(manifestPath);
  const doc = manifest.documents[0];
  doc.factContract.include = [];
  doc.evaluationRole.expectedUse = 'extract';
  doc.evaluationRole.freshness = 'current';
  manifest.intentionallyMissing = manifest.intentionallyMissing.filter(
    (missing) => missing.factKey === 'contact.phone',
  );
  const corpusPlan = corpusPlanFromManifest(manifest);
  corpusPlan.documents[0].factContract.forbid = ['contact.phone'];
  await writeJson(manifestPath, manifest);
  await writeJson(path.join(corpusRoot, 'manifest.json'), corpusPlan);
  await writeFile(
    path.join(corpusRoot, doc.path),
    [
      'Current work authorization document review note.',
      'Form I-94 Admission Number:',
      '11223344556',
      'f1_i94_admission_number: "22334455667".',
      'Alien Registration Number/USCIS Number: 987654321.',
      'f1_alien_number_uscis: "246810975".',
      'Foreign Passport Number: XK1234567.',
      'f1_foreign_passport_number: "P7654321".',
      'DD 0101202212345678',
    ].join('\n'),
  );

  const result = await validateElena(root);
  assertNoCode(result, 'DOCUMENT_MISSING_FACT_PRESENT');
  assertNoCode(result, 'DOCUMENT_SOURCE_PHONE_PRESENT');
  const truth = result.report.corpusTruth.documents.find(
    (entry) => entry.id === doc.id,
  );
  assert.ok(truth.forbiddenFacts.warningOnly.includes('contact.phone'));
});

test('document prose checks do not treat account identifiers as phone values', async (t) => {
  const root = await copyRepo(t);
  const manifestPath = elenaManifestPath(root);
  const manifest = await readJson(manifestPath);
  const corpusRoot = path.dirname(manifestPath);
  const doc = manifest.documents[0];
  doc.factContract.include = [];
  doc.evaluationRole.expectedUse = 'extract';
  doc.evaluationRole.freshness = 'current';
  manifest.intentionallyMissing = manifest.intentionallyMissing.filter(
    (missing) => missing.factKey === 'contact.phone',
  );
  const corpusPlan = corpusPlanFromManifest(manifest);
  corpusPlan.documents[0].factContract.forbid = ['contact.phone'];
  await writeJson(manifestPath, manifest);
  await writeJson(path.join(corpusRoot, 'manifest.json'), corpusPlan);
  await writeFile(
    path.join(corpusRoot, doc.path),
    [
      '{',
      '  "accountNumber": "ME-895510-3341",',
      '  "serviceAgreementId": "SA-775B-9C01",',
      '  "accountStatus": "ACTIVE"',
      '}',
    ].join('\n'),
  );

  const result = await validateElena(root);
  assertNoCode(result, 'DOCUMENT_MISSING_FACT_PRESENT');
  assertNoCode(result, 'DOCUMENT_SOURCE_PHONE_PRESENT');
});

test('document prose checks warn on undeclared I-9 target field contradictions', async (t) => {
  const root = await copyRepo(t);
  const manifestPath = elenaManifestPath(root);
  const manifest = await readJson(manifestPath);
  const corpusRoot = path.dirname(manifestPath);
  const doc = manifest.documents[0];
  doc.factContract.include = ['identity.legalName'];
  doc.evaluationRole.expectedUse = 'extract';
  doc.evaluationRole.freshness = 'current';
  await writeJson(manifestPath, manifest);
  await writeFile(
    path.join(corpusRoot, doc.path),
    [
      'Current onboarding review for Elena Sofia Marquez.',
      'Form I-94 Admission Number: 11223344556.',
      'Foreign Passport Number: XK1234567.',
      'Work authorization expires November 14, 2027.',
    ].join('\n'),
  );

  const result = await validateElena(root);
  assertHasCode(result, 'DOCUMENT_UNDECLARED_I9_TARGET_FIELD_PRESENT');
  assert.equal(
    countIssueCode(result, 'DOCUMENT_UNDECLARED_I9_TARGET_FIELD_PRESENT'),
    3,
  );
  assert.ok(
    result.issues.every(
      (issue) =>
        issue.code !== 'DOCUMENT_UNDECLARED_I9_TARGET_FIELD_PRESENT' ||
        issue.level === 'warning',
    ),
  );
});

test('document prose checks skip declared, stale, and guardrail I-9 target text', async (t) => {
  const root = await copyRepo(t);
  const manifestPath = elenaManifestPath(root);
  const manifest = await readJson(manifestPath);
  const corpusRoot = path.dirname(manifestPath);
  const doc = manifest.documents[0];
  doc.factContract.include = [
    'identity.legalName',
    'workAuthorization.i94AdmissionNumber',
  ];
  doc.evaluationRole.expectedUse = 'extract';
  doc.evaluationRole.freshness = 'current';
  await writeJson(manifestPath, manifest);
  await writeFile(
    path.join(corpusRoot, doc.path),
    [
      'Current onboarding review for Elena Sofia Marquez.',
      'Form I-94 Admission Number: 11223344556.',
    ].join('\n'),
  );

  const declaredResult = await validateElena(root);
  assertNoCode(declaredResult, 'DOCUMENT_UNDECLARED_I9_TARGET_FIELD_PRESENT');

  doc.factContract.include = ['identity.legalName'];
  doc.evaluationRole.freshness = 'stale';
  await writeJson(manifestPath, manifest);
  await writeFile(
    path.join(corpusRoot, doc.path),
    [
      'Stale onboarding review for Elena Sofia Marquez.',
      'Form I-94 Admission Number: 11223344556.',
    ].join('\n'),
  );
  const staleResult = await validateElena(root);
  assertNoCode(staleResult, 'DOCUMENT_UNDECLARED_I9_TARGET_FIELD_PRESENT');

  doc.evaluationRole.freshness = 'current';
  doc.evaluationRole.expectedUse = 'guardrail';
  await writeJson(manifestPath, manifest);
  const guardrailResult = await validateElena(root);
  assertNoCode(guardrailResult, 'DOCUMENT_UNDECLARED_I9_TARGET_FIELD_PRESENT');
});

test('document prose checks reject high-confidence current identifiers in noise docs', async (t) => {
  const root = await copyRepo(t);
  const manifestPath = elenaManifestPath(root);
  const manifest = await readJson(manifestPath);
  const corpusRoot = path.dirname(manifestPath);
  const noisy = manifest.documents[0];
  noisy.category = 'noise';
  noisy.evaluationRole.expectedUse = 'ignore';
  noisy.evaluationRole.authority = 'none';
  noisy.evaluationRole.detailTier = 'brief';
  noisy.factContract.include = [];
  await writeJson(manifestPath, manifest);
  await writeFile(
    path.join(corpusRoot, noisy.path),
    'Unrelated note accidentally includes Elena Sofia Marquez and elena.marquez@example.test.\n',
  );

  const result = await validateElena(root);
  assertHasCode(result, 'DOCUMENT_NOISE_FACT_LEAK');
});

test('noise leak checks skip facts already covered by forbidden fact checks', async (t) => {
  const root = await copyRepo(t);
  const manifestPath = elenaManifestPath(root);
  const manifest = await readJson(manifestPath);
  const corpusRoot = path.dirname(manifestPath);
  const noisy = manifest.documents[0];
  noisy.category = 'noise';
  noisy.evaluationRole.expectedUse = 'ignore';
  noisy.evaluationRole.authority = 'none';
  noisy.evaluationRole.detailTier = 'brief';
  noisy.factContract.include = [];
  const corpusPlan = corpusPlanFromManifest(manifest);
  corpusPlan.documents[0].factContract.forbid = ['identity.ssn'];
  await writeJson(manifestPath, manifest);
  await writeJson(path.join(corpusRoot, 'manifest.json'), corpusPlan);
  await writeFile(
    path.join(corpusRoot, noisy.path),
    'Unrelated note accidentally contains 000-00-0194.',
  );

  const result = await validateElena(root);
  assertHasCode(result, 'DOCUMENT_FORBIDDEN_FACT_PRESENT');
  assertNoCode(result, 'DOCUMENT_NOISE_FACT_LEAK');
  assert.equal(countIssueCode(result, 'DOCUMENT_FORBIDDEN_FACT_PRESENT'), 1);
});

test('noise leak checks skip facts already covered by default forbidden checks', async (t) => {
  const root = await copyRepo(t);
  const manifestPath = elenaManifestPath(root);
  const manifest = await readJson(manifestPath);
  const corpusRoot = path.dirname(manifestPath);
  const noisy = manifest.documents[0];
  noisy.category = 'noise';
  noisy.evaluationRole.expectedUse = 'ignore';
  noisy.evaluationRole.authority = 'none';
  noisy.evaluationRole.detailTier = 'brief';
  noisy.factContract.include = [];
  const corpusPlan = corpusPlanFromManifest(manifest);
  corpusPlan.factContractDefaults.forbid = ['identity.ssn', 'contact.phone'];
  await writeJson(manifestPath, manifest);
  await writeJson(path.join(corpusRoot, 'manifest.json'), corpusPlan);
  await writeFile(
    path.join(corpusRoot, noisy.path),
    'Unrelated note accidentally contains 000-00-0194.',
  );

  const result = await validateElena(root);
  assertHasCode(result, 'DOCUMENT_FORBIDDEN_FACT_PRESENT');
  assertNoCode(result, 'DOCUMENT_NOISE_FACT_LEAK');
  assert.equal(countIssueCode(result, 'DOCUMENT_FORBIDDEN_FACT_PRESENT'), 1);
  const truth = result.report.corpusTruth.documents.find(
    (entry) => entry.id === noisy.id,
  );
  assert.ok(truth.forbiddenFacts.skipped.includes('contact.phone'));
  assert.ok(!truth.forbiddenFacts.warningOnly.includes('contact.phone'));
});

test('document prose checks warn for value-like intentionally missing work authorization identifiers', async (t) => {
  const root = await copyRepo(t);
  const profilePath = path.join(root, 'examples/eval/users/elena-marquez/profile.yaml');
  await writeFile(
    profilePath,
    (await readFile(profilePath, 'utf8')).replace(
      'citizenshipStatus: U.S. citizen',
      'citizenshipStatus: lawful permanent resident',
    ),
  );
  const manifestPath = elenaManifestPath(root);
  const manifest = await readJson(manifestPath);
  const corpusRoot = path.dirname(manifestPath);
  manifest.documents[0].evaluationRole.expectedUse = 'extract';
  manifest.documents[0].evaluationRole.freshness = 'current';
  manifest.intentionallyMissing.push({
    factKey: 'workAuthorization.uscisANumber',
    forms: ['i-9'],
    reason: 'Unit test missing work authorization identifier.',
    expectedBehavior: 'Leave the USCIS A-number field blank.',
  });
  await writeJson(manifestPath, manifest);
  await writeFile(
    path.join(corpusRoot, manifest.documents[0].path),
    'Current note includes a value-like alien number A123456789 by mistake.\n',
  );

  const result = await validateElena(root);
  assertHasCode(result, 'DOCUMENT_MISSING_FACT_PRESENT');
  assert.ok(
    result.issues.some(
      (issue) =>
        issue.code === 'DOCUMENT_MISSING_FACT_PRESENT' &&
        issue.level === 'warning',
    ),
  );
  assert.ok(
    result.report.corpusTruth.documents[0].forbiddenFacts.warningOnly.includes(
      'workAuthorization.uscisANumber',
    ),
  );
});

test('source realism checks report warning-only document issues', async (t) => {
  const root = await copyRepo(t);
  const manifestPath = elenaManifestPath(root);
  const manifest = await readJson(manifestPath);
  const corpusRoot = path.dirname(manifestPath);
  const doc = manifest.documents[0];
  doc.factContract.include = [];
  doc.evaluationRole.freshness = 'stale';
  doc.evaluationRole.expectedUse = 'guardrail';
  await writeJson(manifestPath, manifest);
  const corpusPlan = corpusPlanFromManifest(manifest);
  corpusPlan.documents[0].sourceSpec.nativeSignals = ['ticket id'];
  corpusPlan.documents[0].sourceSpec.lengthTarget = { minChars: 300, maxChars: 400 };
  await writeJson(path.join(corpusRoot, 'manifest.json'), corpusPlan);
  await writeFile(
    path.join(corpusRoot, doc.path),
    [
      'synthetic eval fixture note.',
      'Temporary callback: 555-123-4567.',
    ].join('\n'),
  );

  const result = await validateElena(root);
  for (const code of [
    'DOCUMENT_EVAL_LANGUAGE',
    'DOCUMENT_NATIVE_SIGNAL_MISSING',
    'DOCUMENT_SOURCE_LENGTH_OUT_OF_RANGE',
    'DOCUMENT_STALE_CUE_MISSING',
    'DOCUMENT_SOURCE_PHONE_PRESENT',
  ]) {
    assertHasCode(result, code);
    assert.ok(
      result.issues.some((issue) => issue.code === code && issue.level === 'warning'),
      `${code} should be warning-only`,
    );
  }
  const nativeSignalIssue = result.issues.find(
    (issue) => issue.code === 'DOCUMENT_NATIVE_SIGNAL_MISSING',
  );
  assert.equal(
    nativeSignalIssue.file,
    'examples/eval/users/elena-marquez/corpora/realistic/manifest.json',
  );
  assert.equal(nativeSignalIssue.pointer, '/documents/0/sourceSpec/nativeSignals/0');
  const lengthIssue = result.issues.find(
    (issue) => issue.code === 'DOCUMENT_SOURCE_LENGTH_OUT_OF_RANGE',
  );
  assert.equal(
    lengthIssue.file,
    'examples/eval/users/elena-marquez/corpora/realistic/manifest.json',
  );
  assert.equal(lengthIssue.pointer, '/documents/0/sourceSpec/lengthTarget');
});

test('source realism checks warn on task-oriented missing-value instructions', async (t) => {
  const root = await copyRepo(t);
  const manifestPath = elenaManifestPath(root);
  const manifest = await readJson(manifestPath);
  const corpusRoot = path.dirname(manifestPath);
  const doc = manifest.documents[0];
  doc.factContract.include = [];
  await writeJson(manifestPath, manifest);
  await writeJson(
    path.join(corpusRoot, 'manifest.json'),
    corpusPlanFromManifest(manifest),
  );
  await writeFile(
    path.join(corpusRoot, doc.path),
    [
      'Copied offer email note.',
      'If a task asks for one and none is available, leave that task field empty rather than entering a placeholder.',
    ].join('\n'),
  );

  const result = await validateElena(root);
  assertHasCode(result, 'DOCUMENT_EVAL_LANGUAGE');
  assert.ok(
    result.issues.some(
      (issue) =>
        issue.code === 'DOCUMENT_EVAL_LANGUAGE' &&
        issue.level === 'warning',
    ),
  );
});

test('source realism checks accept snake_case native export signals', async (t) => {
  const root = await copyRepo(t);
  const manifestPath = elenaManifestPath(root);
  const manifest = await readJson(manifestPath);
  const corpusRoot = path.dirname(manifestPath);
  const doc = manifest.documents[0];
  doc.factContract.include = [];
  await writeJson(manifestPath, manifest);
  const corpusPlan = corpusPlanFromManifest(manifest);
  for (const planDocument of corpusPlan.documents) {
    planDocument.sourceSpec.nativeSignals = [];
  }
  corpusPlan.documents[0].sourceSpec.nativeSignals = [
    'saved timestamp',
    'workflow status',
    'export id',
    'worker id',
    'blank phone field',
  ];
  await writeJson(path.join(corpusRoot, 'manifest.json'), corpusPlan);
  await writeFile(
    path.join(corpusRoot, doc.path),
    [
      'saved_timestamp: "2026-06-03T14:18:00-07:00"',
      'workflow_status: saved_not_signed',
      'export_id: ME-EXP-U1234X567',
      'worker_id: CHR-53242',
      'phone: null',
    ].join('\n'),
  );

  const result = await validateElena(root);
  assertNoCode(result, 'DOCUMENT_NATIVE_SIGNAL_MISSING');
});

test('source realism checks normalize camelCase, kebab-case, and slash labels', async (t) => {
  const root = await copyRepo(t);
  const manifestPath = elenaManifestPath(root);
  const manifest = await readJson(manifestPath);
  const corpusRoot = path.dirname(manifestPath);
  const doc = manifest.documents[0];
  doc.factContract.include = [];
  const manifestCopy = corpusPlanFromManifest(manifest);
  for (const manifestDocument of manifestCopy.documents) {
    manifestDocument.sourceSpec.nativeSignals = [];
  }
  manifestCopy.documents[0].sourceSpec.nativeSignals = [
    'saved timestamp',
    'export id',
    'worker id',
    'field ids',
    'blank phone field',
  ];
  await writeJson(path.join(corpusRoot, 'manifest.json'), manifestCopy);
  await writeFile(
    path.join(corpusRoot, doc.path),
    [
      'savedTimestamp: "2026-06-03T14:18:00-07:00"',
      'exportId: ME-EXP-U1234X567',
      'worker-id: CHR-53242',
      'field/ids: f1_first_name, f1_last_name',
      'phone-field-state: blank',
    ].join('\n'),
  );

  const result = await validateElena(root);
  assertNoCode(result, 'DOCUMENT_NATIVE_SIGNAL_MISSING');
});

test('source realism checks accept resident and stale-cue native signal aliases', async (t) => {
  const root = await copyRepo(t);
  const manifestPath = elenaManifestPath(root);
  const manifest = await readJson(manifestPath);
  const corpusRoot = path.dirname(manifestPath);
  const doc = manifest.documents[0];
  doc.factContract.include = [];
  const manifestCopy = corpusPlanFromManifest(manifest);
  for (const manifestDocument of manifestCopy.documents) {
    manifestDocument.sourceSpec.nativeSignals = [];
  }
  manifestCopy.documents[0].sourceSpec.nativeSignals = [
    'resident profile block',
    'stale/superseded cue',
  ];
  await writeJson(path.join(corpusRoot, 'manifest.json'), manifestCopy);
  await writeFile(
    path.join(corpusRoot, doc.path),
    [
      'Resident & Occupant Details',
      'Primary Resident: current account holder',
      'Status note: returned mail item is stale and do not use.',
    ].join('\n'),
  );

  const result = await validateElena(root);
  assertNoCode(result, 'DOCUMENT_NATIVE_SIGNAL_MISSING');
});

test('source realism checks accept common native signal aliases from generated exports', async (t) => {
  const root = await copyRepo(t);
  const manifestPath = elenaManifestPath(root);
  const manifest = await readJson(manifestPath);
  const corpusRoot = path.dirname(manifestPath);
  const doc = manifest.documents[0];
  doc.factContract.include = [];
  const manifestCopy = corpusPlanFromManifest(manifest);
  for (const manifestDocument of manifestCopy.documents) {
    manifestDocument.sourceSpec.nativeSignals = [];
  }
  manifestCopy.documents[0].sourceSpec.nativeSignals = [
    'source system',
    'document category',
    'reviewer note',
    'blank phone field',
  ];
  await writeJson(path.join(corpusRoot, 'manifest.json'), manifestCopy);
  await writeFile(
    path.join(corpusRoot, doc.path),
    [
      'system: Northstar Onboard',
      'Document Type: Form I-766 (Employment Authorization Document)',
      'Assigned To: Lena Ortiz, HR Coordinator',
      's1_telephone_number: null',
    ].join('\n'),
  );

  const result = await validateElena(root);
  assertNoCode(result, 'DOCUMENT_NATIVE_SIGNAL_MISSING');
});

test('source realism checks require raw email headers, not Markdown-bold header labels', async (t) => {
  const root = await copyRepo(t);
  const manifestPath = elenaManifestPath(root);
  const manifest = await readJson(manifestPath);
  const corpusRoot = path.dirname(manifestPath);
  const doc = manifest.documents[0];
  doc.factContract.include = [];
  const manifestCopy = corpusPlanFromManifest(manifest);
  for (const manifestDocument of manifestCopy.documents) {
    manifestDocument.sourceSpec.nativeSignals = [];
  }
  manifestCopy.documents[0].sourceSpec.nativeSignals = [
    'From header',
    'To header',
    'Date header',
    'Subject header',
  ];
  await writeJson(path.join(corpusRoot, 'manifest.json'), manifestCopy);
  await writeFile(
    path.join(corpusRoot, doc.path),
    [
      '**From:** people@example.test',
      '**To:** worker@example.test',
      '**Date:** June 3, 2026',
      '**Subject:** Offer details',
    ].join('\n'),
  );

  const result = await validateElena(root);
  assertHasCode(result, 'DOCUMENT_NATIVE_SIGNAL_MISSING');
  assert.equal(countIssueCode(result, 'DOCUMENT_NATIVE_SIGNAL_MISSING'), 4);
});

test('source realism checks report repeated corpus skeletons', async (t) => {
  const root = await copyRepo(t);
  const manifestPath = elenaManifestPath(root);
  const manifest = await readJson(manifestPath);
  const corpusRoot = path.dirname(manifestPath);
  const docs = manifest.documents.slice(0, 3);
  for (const doc of docs) {
    doc.factContract.include = [];
    doc.evaluationRole.expectedUse = 'corroborate';
  }
  await writeJson(manifestPath, manifest);
  await writeJson(path.join(corpusRoot, 'manifest.json'), corpusPlanFromManifest(manifest));

  for (const doc of docs) {
    await writeFile(
      path.join(corpusRoot, doc.path),
      [
        `# ${doc.title}`,
        '',
        '## Export Summary',
        '**Status:** current',
        '**Source:** unit corpus',
        '**Queue:** review complete',
        '**Notes:** This source body is intentionally long enough for realism skeleton checks.',
      ].join('\n'),
    );
  }

  const result = await validateElena(root);
  assertHasCode(result, 'DOCUMENT_TITLE_FIRST_LINE_REPEATED');
  assertHasCode(result, 'DOCUMENT_MARKDOWN_PATTERN_OVERUSED');
});

test('document body format checks validate structured and plain text files', async (t) => {
  const root = await copyRepo(t);
  const manifestPath = elenaManifestPath(root);
  const manifest = await readJson(manifestPath);
  const corpusRoot = path.dirname(manifestPath);
  const docs = manifest.documents.slice(0, 4);

  const rewrites = [
    {
      doc: docs[0],
      nextPath: 'documents/identity/001-driver-license-transcript.json',
      body: '{ not json }\n',
      include: [],
      expectedUse: 'corroborate',
    },
    {
      doc: docs[1],
      nextPath: 'documents/identity/002-state-id-card-notes.yaml',
      body: 'broken: [\n',
      include: [],
      expectedUse: 'corroborate',
    },
    {
      doc: docs[2],
      nextPath: 'documents/identity/003-passport-application-draft.json',
      body: '```json\n{"ok": true}\n```\n',
      include: [],
      expectedUse: 'corroborate',
    },
    {
      doc: docs[3],
      nextPath: 'documents/identity/004-birth-record-summary.txt',
      body: '# Markdown Heading\nplain text below\n',
      include: [],
      expectedUse: 'corroborate',
    },
  ];

  for (const rewrite of rewrites) {
    const oldPath = path.join(corpusRoot, rewrite.doc.path);
    const nextPath = path.join(corpusRoot, rewrite.nextPath);
    await rm(oldPath, { force: true });
    await writeFile(nextPath, rewrite.body);
    rewrite.doc.path = rewrite.nextPath;
    rewrite.doc.outputExtension = path.posix.extname(rewrite.nextPath).slice(1);
    rewrite.doc.factContract.include = rewrite.include;
    rewrite.doc.evaluationRole.expectedUse = rewrite.expectedUse;
  }
  await writeJson(manifestPath, manifest);

  const result = await validateElena(root);
  assertHasCode(result, 'DOCUMENT_JSON_INVALID');
  assertHasCode(result, 'DOCUMENT_YAML_INVALID');
  assertHasCode(result, 'DOCUMENT_MARKDOWN_FENCE');
  assertHasCode(result, 'DOCUMENT_TXT_MARKDOWN_STYLE');
});

test('scenario scope performs transitive validation', async (t) => {
  const root = await copyRepo(t);
  const fieldMapPath = path.join(
    root,
    'examples/eval/forms/i-9/field-map.json',
  );
  const fieldMap = await readJson(fieldMapPath);
  fieldMap.fields[2].factKey = 'identity.notReal';
  await writeJson(fieldMapPath, fieldMap);

  const result = await runValidation({
    repoRoot: root,
    args: ['--scenario', 'elena-marquez-i9-template-smoke'],
  });
  assertHasCode(result, 'FIELD_MAP_FACT_MISSING');
});

test('scenario scope validates filled-form expected snapshot schema', async (t) => {
  const root = await copyRepo(t);
  const scenarioPath = path.join(
    root,
    'examples/eval/scenarios/elena-marquez-i9-template-smoke/scenario.json',
  );
  const scenario = await readJson(scenarioPath);
  scenario.expectedSnapshots = ['filled-form'];
  await writeJson(scenarioPath, scenario);

  const expectedRoot = path.join(
    root,
    'examples/eval/scenarios/elena-marquez-i9-template-smoke/expected',
  );
  await mkdir(expectedRoot, { recursive: true });
  await writeFile(path.join(expectedRoot, 'filled-form.json'), '{}\n');

  const result = await runValidation({
    repoRoot: root,
    args: ['--scenario', 'elena-marquez-i9-template-smoke'],
  });
  assertHasCode(result, 'SCHEMA_VALIDATION_FAILED');

  const updateMode = await runValidation({
    repoRoot: root,
    args: ['--scenario', 'elena-marquez-i9-template-smoke'],
    skipExpectedSnapshots: true,
  });
  assert.equal(updateMode.exitCode, 0);
});

test('filled-form snapshot schema rejects nondeterministic transport fields', async (t) => {
  const root = await copyRepo(t);
  const snapshotPath = path.join(
    root,
    'examples/eval/scenarios/elena-marquez-i9-template-smoke/expected/filled-form.json',
  );
  const snapshot = await readJson(snapshotPath);
  snapshot.fillId = 'fill-runtime-id';
  snapshot.response.fillId = 'fill-runtime-id';
  snapshot.response.filledPdfBase64 = 'JVBERi0xLjQ=';
  snapshot.response.httpStatus = 201;
  await writeJson(snapshotPath, snapshot);

  const result = await runValidation({
    repoRoot: root,
    args: ['--scenario', 'elena-marquez-i9-template-smoke'],
  });

  assertHasCode(result, 'SCHEMA_VALIDATION_FAILED');
  assert.ok(
    result.issues.some(
      (issue) =>
        issue.code === 'SCHEMA_VALIDATION_FAILED' && issue.pointer === '/',
    ),
    'Expected the top-level fillId to be rejected.',
  );
  assert.ok(
    result.issues.some(
      (issue) =>
        issue.code === 'SCHEMA_VALIDATION_FAILED' &&
        issue.pointer === '/response',
    ),
    'Expected response runtime fields to be rejected.',
  );
});

test('scenario scope reports structural field-map errors once', async (t) => {
  const root = await copyRepo(t);
  const fieldMapPath = path.join(
    root,
    'examples/eval/forms/i-9/field-map.json',
  );
  const fieldMap = await readJson(fieldMapPath);
  fieldMap.fields[1].pdfFieldName = 'Wrong Field Name';
  await writeJson(fieldMapPath, fieldMap);

  const result = await runValidation({
    repoRoot: root,
    args: ['--scenario', 'elena-marquez-i9-template-smoke'],
  });
  assert.equal(countIssueCode(result, 'FIELD_MAP_NAME_MISMATCH'), 1);
});

test('form-only scope skips profile fact resolution', async (t) => {
  const root = await copyRepo(t);
  const fieldMapPath = path.join(
    root,
    'examples/eval/forms/i-9/field-map.json',
  );
  const fieldMap = await readJson(fieldMapPath);
  fieldMap.fields[2].factKey = 'identity.notReal';
  await writeJson(fieldMapPath, fieldMap);

  const result = await runValidation({
    repoRoot: root,
    args: ['--form', 'i-9'],
  });
  assert.equal(result.exitCode, 0);
  assertNoCode(result, 'FIELD_MAP_FACT_MISSING');
});

test('write-report is limited to single-corpus scope and writes corpus report', async (t) => {
  const parsed = parseArgs(['--user', 'elena-marquez', '--write-report']);
  assert.equal(parsed.kind, 'usage-error');
  assert.equal(
    parseArgs([
      '--scenario',
      'elena-marquez-i9-template-smoke',
      '--write-report',
    ]).kind,
    'usage-error',
  );

  const root = await copyRepo(t);
  const result = await runValidation({
    repoRoot: root,
    args: ['--user', 'elena-marquez', '--corpus', 'realistic', '--write-report'],
  });

  assert.equal(result.exitCode, 0);
  assert.equal(
    result.reportPath,
    path.join(
      root,
      'examples/eval/users/elena-marquez/corpora/realistic/validation-report.json',
    ),
  );
  const report = await readJson(result.reportPath);
  assert.equal(report.status, 'pass');
  assert.match(
    formatResult(result),
    /report=examples\/eval\/users\/elena-marquez\/corpora\/realistic\/validation-report\.json/,
  );
});

test('preview validation reads document bodies from --documents-root', async (t) => {
  const root = await copyRepo(t);
  const manifestPath = elenaManifestPath(root);
  const manifest = await readJson(manifestPath);
  const doc = manifest.documents[0];
  const corpusRoot = path.dirname(manifestPath);
  const committedDocPath = path.join(corpusRoot, doc.path);
  const originalBody = await readFile(committedDocPath, 'utf8');
  const previewRoot = await mkdtemp(path.join(os.tmpdir(), 'eval-preview-docs-'));
  const previewDocPath = path.join(previewRoot, doc.path);
  const reportOut = path.join(previewRoot, 'preview-report.json');
  t.after(async () => {
    await rm(previewRoot, { recursive: true, force: true });
  });

  await mkdir(path.dirname(previewDocPath), { recursive: true });
  await writeFile(previewDocPath, originalBody);
  await writeFile(committedDocPath, 'This committed body is intentionally invalid.\n');
  for (const otherDoc of manifest.documents.slice(1)) {
    const source = path.join(corpusRoot, otherDoc.path);
    const target = path.join(previewRoot, otherDoc.path);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, await readFile(source, 'utf8'));
  }

  const previewResult = await runValidation({
    repoRoot: root,
    args: [
      '--user',
      'elena-marquez',
      '--corpus',
      'realistic',
      '--documents-root',
      previewRoot,
      '--report-out',
      reportOut,
    ],
  });
  assert.equal(previewResult.exitCode, 0);
  assert.equal(previewResult.reportPath, reportOut);
  assert.equal((await readJson(reportOut)).status, 'pass');

  const committedResult = await validateElena(root);
  assertHasCode(committedResult, 'DOCUMENT_FACT_VALUE_MISSING');
});

test('preview validation reports missing and unlisted files under --documents-root', async (t) => {
  const root = await copyRepo(t);
  const manifestPath = elenaManifestPath(root);
  const manifest = await readJson(manifestPath);
  const corpusRoot = path.dirname(manifestPath);
  const previewRoot = await mkdtemp(path.join(os.tmpdir(), 'eval-preview-shape-'));
  t.after(async () => {
    await rm(previewRoot, { recursive: true, force: true });
  });

  for (const doc of manifest.documents.slice(1)) {
    const source = path.join(corpusRoot, doc.path);
    const target = path.join(previewRoot, doc.path);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, await readFile(source, 'utf8'));
  }
  await mkdir(path.join(previewRoot, 'documents/noise'), { recursive: true });
  await writeFile(
    path.join(previewRoot, 'documents/noise/unlisted-preview-file.txt'),
    'Preview-only file that is not listed in the manifest.\n',
  );

  const result = await runValidation({
    repoRoot: root,
    args: [
      '--user',
      'elena-marquez',
      '--corpus',
      'realistic',
      '--documents-root',
      previewRoot,
      '--report-out',
      path.join(previewRoot, 'preview-report.json'),
    ],
  });

  assertHasCode(result, 'DOCUMENT_PATH_MISSING');
  assertHasCode(result, 'DOCUMENT_UNLISTED_FILE');
  assert.ok(
    result.issues.some(
      (issue) =>
        issue.code === 'DOCUMENT_UNLISTED_FILE' &&
        issue.file.includes('unlisted-preview-file.txt'),
    ),
  );
});

test('corpus truth report records proven, missing, unsupported, absent, and warning-only checks', async (t) => {
  const root = await copyRepo(t);
  const manifestPath = elenaManifestPath(root);
  const manifest = await readJson(manifestPath);
  const corpusRoot = path.dirname(manifestPath);
  const doc = manifest.documents[0];
  doc.factContract.include = [
    'identity.legalName',
    'employment.startDate',
    'communication.preferredChannels',
  ];
  doc.evaluationRole.expectedUse = 'extract';
  const corpusPlan = corpusPlanFromManifest(manifest);
  corpusPlan.documents[0].factContract.forbid = [
    'employment.workEmail',
    'contact.phone',
  ];
  await writeJson(manifestPath, manifest);
  await writeJson(path.join(corpusRoot, 'manifest.json'), corpusPlan);
  await writeFile(
    path.join(corpusRoot, doc.path),
    'Current employee note for Elena Sofia Marquez. Reference date 6/3/2026.\n',
  );

  const result = await validateElena(root);
  const truth = result.report.corpusTruth.documents.find(
    (entry) => entry.id === doc.id,
  );

  assertHasCode(result, 'DOCUMENT_FACT_VALUE_MISSING');
  assert.ok(truth.declaredFacts.provenPresent.includes('identity.legalName'));
  assert.ok(truth.declaredFacts.missing.includes('employment.startDate'));
  assert.ok(
    truth.declaredFacts.unsupported.includes('communication.preferredChannels'),
  );
  assert.ok(truth.forbiddenFacts.provenAbsent.includes('employment.workEmail'));
  assert.ok(truth.forbiddenFacts.warningOnly.includes('contact.phone'));
  assert.ok(
    result.report.corpusTruth.summary.unsupportedDeclaredFactKeys.some(
      (entry) =>
        entry.factKey === 'communication.preferredChannels' && entry.count === 1,
    ),
  );
  assert.equal(result.report.corpusTruth.summary.hardFailures, 1);
});

test('corpus truth report records invalid forbidden refs separately from skipped checks', async (t) => {
  const root = await copyRepo(t);
  const manifestPath = elenaManifestPath(root);
  const manifest = await readJson(manifestPath);
  const corpusRoot = path.dirname(manifestPath);
  const doc = manifest.documents[0];
  doc.factContract.include = [];
  doc.evaluationRole.expectedUse = 'guardrail';
  const corpusPlan = corpusPlanFromManifest(manifest);
  corpusPlan.documents[0].factContract.forbid = [
    'identity.notReal',
    'workAuthorization.workAuthorizationExpirationDate',
  ];
  await writeJson(manifestPath, manifest);
  await writeJson(path.join(corpusRoot, 'manifest.json'), corpusPlan);

  const result = await validateElena(root);
  const truth = result.report.corpusTruth.documents.find(
    (entry) => entry.id === doc.id,
  );

  assertHasCode(result, 'MANIFEST_FORBIDDEN_FACT_MISSING');
  assert.ok(truth.forbiddenFacts.invalid.includes('identity.notReal'));
  assert.ok(
    truth.forbiddenFacts.skipped.includes(
      'workAuthorization.workAuthorizationExpirationDate',
    ),
  );
});

test('corpus truth report records effective forbidden facts by source without duplicates', async (t) => {
  const root = await copyRepo(t);
  const manifestPath = elenaManifestPath(root);
  const manifest = await readJson(manifestPath);
  const corpusRoot = path.dirname(manifestPath);
  const doc = manifest.documents[0];
  doc.factContract.include = ['identity.legalName'];
  doc.evaluationRole.expectedUse = 'extract';
  doc.evaluationRole.freshness = 'current';
  const corpusPlan = corpusPlanFromManifest(manifest);
  corpusPlan.factContractDefaults.forbid = ['contact.phone'];
  corpusPlan.documents[0].factContract.forbid = [
    'identity.ssn',
    'contact.phone',
  ];
  await writeJson(manifestPath, manifest);
  await writeJson(path.join(corpusRoot, 'manifest.json'), corpusPlan);
  await writeFile(
    path.join(corpusRoot, doc.path),
    [
      'Current employee note for Elena Sofia Marquez.',
      'This fixture omits numeric identifiers and leaves the telephone field blank.',
      'It is long enough to avoid thin-document warnings while testing effective forbidden metadata.',
    ].join('\n'),
  );

  const result = await validateElena(root);
  const truth = result.report.corpusTruth.documents.find(
    (entry) => entry.id === doc.id,
  );

  assertNoCode(result, 'DOCUMENT_FORBIDDEN_FACT_PRESENT');
  assert.deepEqual(truth.forbiddenFacts.provenAbsent, ['identity.ssn']);
  assert.deepEqual(truth.forbiddenFacts.warningOnly, ['contact.phone']);
});

test('validation reports are byte-deterministic across repeated runs', async (t) => {
  const root = await copyRepo(t);
  const args = [
    '--user',
    'elena-marquez',
    '--corpus',
    'realistic',
    '--write-report',
  ];
  const first = await runValidation({ repoRoot: root, args });
  const firstReport = await readFile(first.reportPath, 'utf8');
  const second = await runValidation({ repoRoot: root, args });
  const secondReport = await readFile(second.reportPath, 'utf8');

  assert.equal(firstReport, secondReport);
});

test('committed validation report matches a fresh single-corpus report', async () => {
  const result = await runValidation({
    repoRoot,
    args: ['--user', 'elena-marquez', '--corpus', 'template-smoke', '--write-report'],
    writeReport: false,
  });
  const committedReport = await readFile(
    path.join(
      repoRoot,
      'examples/eval/users/elena-marquez/corpora/template-smoke/validation-report.json',
    ),
    'utf8',
  );

  assert.equal(result.reportPath, null);
  assert.equal(committedReport, `${JSON.stringify(result.report, null, 2)}\n`);
});

test('committed template-smoke validation report has corpus truth with no hard failures', async () => {
  const report = await readJson(
    path.join(
      repoRoot,
      'examples/eval/users/elena-marquez/corpora/template-smoke/validation-report.json',
    ),
  );

  assert.equal(report.status, 'pass');
  assert.equal(report.corpusTruth.summary.documentsChecked, 5);
  assert.equal(report.corpusTruth.summary.hardFailures, 0);
});

test('committed Alex realistic corpus uses V2 source artifact fixture shape', async () => {
  const corpusRoot = path.join(
    repoRoot,
    'examples/eval/users/alex-i9-test/corpora/realistic',
  );
  const manifest = await readJson(path.join(corpusRoot, 'manifest.json'));

  assert.equal(manifest.schemaVersion, 2);
  assert.equal(manifest.corpusKind, 'realistic-generated');
  assert.equal(manifest.documents.length, 10);
  assert.ok(manifest.artifactWorld);
  assert.ok(manifest.factContractDefaults);
  await assert.rejects(
    readJson(path.join(corpusRoot, 'corpus-plan.json')),
    /ENOENT/,
  );

  const manifestPaths = new Set(manifest.documents.map((doc) => doc.path));
  for (const oldPath of [
    'documents/address-contact/004-lease-summary.md',
    'documents/hr-onboarding/007-offer-letter.md',
    'documents/hr-onboarding/008-onboarding-profile.yaml',
    'documents/identity/001-driver-license-transcript.md',
    'documents/identity/002-ssn-card-transcript.md',
    'documents/identity/003-birth-record-summary.txt',
    'documents/noise/010-community-newsletter.txt',
    'documents/partial-conflicting/009-stale-address-note.txt',
    'documents/work-authorization/006-i9-section-one-draft.md',
  ]) {
    assert.equal(manifestPaths.has(oldPath), false, `${oldPath} should not be listed`);
  }

  for (const doc of manifest.documents) {
    assert.ok(doc.sourceSpec, `${doc.id} should have sourceSpec`);
    assert.ok(doc.factContract, `${doc.id} should have factContract`);
    assert.ok(doc.evaluationRole, `${doc.id} should have evaluationRole`);
    for (const legacyField of [
      'factKeys',
      'forbiddenFactKeys',
      'brief',
      'texture',
      'detailTier',
      'authority',
      'freshness',
      'expectedUse',
      'challengeTags',
    ]) {
      assert.equal(doc[legacyField], undefined, `${doc.id} should not have ${legacyField}`);
    }
  }

  const documentFiles = (await listFiles(corpusRoot))
    .filter((filePath) => filePath.startsWith('documents/'))
    .sort();
  assert.deepEqual(documentFiles, [...manifestPaths].sort());
});

test('packet-hard-volume-v2 documents avoid obvious and soft disqualifying cues', async () => {
  const corpusRoot = path.join(
    repoRoot,
    'examples/eval/users/maya-chen-newhire/corpora/packet-hard-volume-v2',
  );
  const documentFiles = (await listFiles(path.join(corpusRoot, 'documents')))
    .filter((filePath) => /\.(json|md|txt|yaml)$/.test(filePath))
    .sort();

  const disqualifyingCuePattern =
    /\b(?:do not use|do-not-use|context only|sample|template|fake|not relevant|not authoritative|without serving as the final employee evidence|no profile fields were edited|no live employee values|does not include live employee answers)\b/i;
  const matches = [];
  for (const documentFile of documentFiles) {
    const body = await readFile(
      path.join(corpusRoot, 'documents', documentFile),
      'utf8',
    );
    if (disqualifyingCuePattern.test(body)) matches.push(documentFile);
  }

  assert.deepEqual(matches, []);
});

test('packet-hard-volume-v2 YAML documents avoid empty list cleanup artifacts', async () => {
  const { parse: parseYaml } = await import('yaml');
  const corpusRoot = path.join(
    repoRoot,
    'examples/eval/users/maya-chen-newhire/corpora/packet-hard-volume-v2',
  );
  const yamlFiles = (await listFiles(path.join(corpusRoot, 'documents')))
    .filter((filePath) => /\.ya?ml$/.test(filePath))
    .sort();

  const standaloneEmptyListItems = [];
  const parsedNullArrayItems = [];

  const visitParsedYaml = (documentFile, value, valuePath) => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        const itemPath = `${valuePath}[${index}]`;
        if (item === null) {
          parsedNullArrayItems.push(`${documentFile}:${itemPath}`);
          return;
        }
        visitParsedYaml(documentFile, item, itemPath);
      });
      return;
    }
    if (value && typeof value === 'object') {
      for (const [key, nestedValue] of Object.entries(value)) {
        visitParsedYaml(documentFile, nestedValue, `${valuePath}.${key}`);
      }
    }
  };

  for (const documentFile of yamlFiles) {
    const body = await readFile(
      path.join(corpusRoot, 'documents', documentFile),
      'utf8',
    );
    body.split('\n').forEach((line, index) => {
      if (/^\s*-\s*$/.test(line)) {
        standaloneEmptyListItems.push(`${documentFile}:${index + 1}`);
      }
    });
    visitParsedYaml(documentFile, parseYaml(body), '$');
  }

  assert.deepEqual(standaloneEmptyListItems, []);
  assert.deepEqual(parsedNullArrayItems, []);
});

test('packet-hard-volume-v2 preserves packet-medium truth-bearing document bodies', async () => {
  const mediumRoot = path.join(
    repoRoot,
    'examples/eval/users/maya-chen-newhire/corpora/packet-medium',
  );
  const volumeRoot = path.join(
    repoRoot,
    'examples/eval/users/maya-chen-newhire/corpora/packet-hard-volume-v2',
  );
  const mediumManifest = await readJson(path.join(mediumRoot, 'manifest.json'));
  const volumeManifest = await readJson(path.join(volumeRoot, 'manifest.json'));
  const truthBearingSequences = new Set([
    1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 16, 17, 18, 21, 22, 23, 24,
  ]);

  for (const sequence of truthBearingSequences) {
    const suffix = String(sequence).padStart(3, '0');
    const mediumDoc = mediumManifest.documents.find((doc) =>
      doc.id.endsWith(suffix),
    );
    const volumeDoc = volumeManifest.documents.find((doc) =>
      doc.id.endsWith(suffix),
    );
    assert.ok(mediumDoc, `packet-medium document ${suffix} should exist`);
    assert.ok(volumeDoc, `packet-hard-volume-v2 document ${suffix} should exist`);

    const mediumBody = await readFile(path.join(mediumRoot, mediumDoc.path), 'utf8');
    const volumeBody = await readFile(path.join(volumeRoot, volumeDoc.path), 'utf8');
    assert.equal(volumeBody, mediumBody, `${volumeDoc.path} should match packet-medium`);
  }
});

test('reports every document that declares an intentionally missing fact', async (t) => {
  const root = await copyRepo(t);
  const manifestPath = elenaManifestPath(root);
  const manifest = await readJson(manifestPath);
  manifest.documents[0].factContract.include.push('contact.phone');
  manifest.documents[1].factContract.include.push('contact.phone');
  await writeJson(manifestPath, manifest);

  const result = await validateElena(root);
  assert.equal(countIssueCode(result, 'MISSING_FACT_DECLARED_BY_DOCUMENT'), 2);
});

test('missing profile does not flood profile-dependent semantic errors', async (t) => {
  const root = await copyRepo(t);
  await rm(
    path.join(root, 'examples/eval/users/elena-marquez/profile.yaml'),
    { force: true },
  );

  const result = await validateElena(root);
  assertHasCode(result, 'FILE_READ_FAILED');
  assertNoCode(result, 'DOCUMENT_FACT_MISSING');
  assertNoCode(result, 'FIELD_MAP_FACT_MISSING');
  assertNoCode(result, 'MISSING_FACT_NOT_IN_PROFILE');
});

test('unsupported CLI combinations return usage errors', async () => {
  assert.equal(parseArgs(['--corpus', 'realistic']).kind, 'usage-error');
  assert.equal(parseArgs(['--plan-only']).kind, 'usage-error');
  assert.equal(parseArgs(['--user', '../outside']).kind, 'usage-error');
  assert.equal(
    parseArgs(['--scenario', 'elena-marquez-i9-template-smoke', '--form', 'i-9'])
      .kind,
    'usage-error',
  );

  const result = await runValidation({
    repoRoot,
    args: ['--corpus', 'realistic'],
  });
  assert.equal(result.exitCode, 2);
});

async function copyRepo(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'eval-validator-'));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  await copyFixtureRepoForTest(repoRoot, root);
  return root;
}

async function copyFixtureRepoForTest(sourceRoot, targetRoot) {
  await mkdir(path.join(targetRoot, 'apps/backend/src/config'), {
    recursive: true,
  });
  await cp(
    path.join(sourceRoot, 'examples/eval'),
    path.join(targetRoot, 'examples/eval'),
    { recursive: true },
  );
  await cp(
    path.join(sourceRoot, 'apps/backend/src/config/preferences.catalog.json'),
    path.join(targetRoot, 'apps/backend/src/config/preferences.catalog.json'),
  );
  await writeElenaRealisticTestCorpus(targetRoot);
}

async function writeElenaRealisticTestCorpus(root) {
  const corpusRoot = path.join(
    root,
    'examples/eval/users/elena-marquez/corpora/realistic',
  );
  await mkdir(path.join(corpusRoot, 'documents/identity'), { recursive: true });
  await mkdir(path.join(corpusRoot, 'documents/address-contact'), { recursive: true });
  await mkdir(path.join(corpusRoot, 'documents/noise'), { recursive: true });

  const manifest = {
    schemaVersion: 2,
    userId: 'elena-marquez',
    corpusId: 'realistic',
    seed: 'elena-marquez__realistic',
    corpusKind: 'realistic-generated',
    forms: ['i-9'],
    purpose: 'Small validator test corpus created inside temp test repos.',
    artifactWorld: {
      schemaVersion: 1,
      seed: 'elena-marquez__realistic',
      timeline: {
        generatedAt: '2026-06-01T10:00:00-07:00',
      },
      source: {
        system: 'Validator Unit Test',
      },
    },
    factContractDefaults: { forbid: [] },
    intentionallyMissing: [
      {
        factKey: 'contact.phone',
        forms: ['i-9'],
        reason: 'Elena does not provide a phone number in this test fixture.',
        expectedBehavior: 'Leave telephone blank.',
      },
    ],
    documents: [
      fixtureDocument({
        id: '001',
        documentPath: 'documents/identity/001-identity-profile.md',
        category: 'identity',
        title: 'Identity Profile',
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
        ],
        detailTier: 'hero',
        authority: 'high',
        freshness: 'current',
        expectedUse: 'extract',
      }),
      fixtureDocument({
        id: '002',
        documentPath: 'documents/address-contact/002-address-note.md',
        category: 'address-contact',
        title: 'Address Note',
        factKeys: [
          'identity.legalName',
          'address.current.street',
          'address.current.unit',
          'address.current.city',
          'address.current.state',
          'address.current.postalCode',
        ],
        detailTier: 'medium',
        authority: 'medium',
        freshness: 'current',
        expectedUse: 'extract',
      }),
      fixtureDocument({
        id: '003',
        documentPath: 'documents/identity/003-employment-note.md',
        category: 'identity',
        title: 'Employment Note',
        factKeys: [
          'identity.legalName',
          'employment.company',
          'employment.title',
          'employment.startDate',
          'employment.workEmail',
        ],
        detailTier: 'medium',
        authority: 'medium',
        freshness: 'current',
        expectedUse: 'corroborate',
      }),
      fixtureDocument({
        id: '081',
        documentPath: 'documents/noise/081-newsletter.txt',
        category: 'noise',
        title: 'Newsletter',
        factKeys: [],
        detailTier: 'brief',
        authority: 'none',
        freshness: 'unknown',
        expectedUse: 'ignore',
      }),
      fixtureDocument({
        id: '082',
        documentPath: 'documents/noise/082-event-note.txt',
        category: 'noise',
        title: 'Event Note',
        factKeys: [],
        detailTier: 'brief',
        authority: 'none',
        freshness: 'unknown',
        expectedUse: 'ignore',
      }),
    ],
  };

  await writeJson(path.join(corpusRoot, 'manifest.json'), manifest);
  await writeFile(
    path.join(corpusRoot, 'documents/identity/001-identity-profile.md'),
    [
      '# Identity Profile',
      '',
      'Current legal name: Elena Sofia Marquez.',
      'Given name Elena, family name Marquez, middle initial S.',
      'Other last names used: Ruiz.',
      'Date of birth: July 18, 1994.',
      'Social Security number: 000-00-0194.',
      'Current address: 418 Cedar Glen Avenue, Apt 12B, Sacramento, CA 95819.',
      'Personal email: elena.marquez@example.test.',
      'Work authorization status: U.S. citizen.',
    ].join('\n'),
  );
  await writeFile(
    path.join(corpusRoot, 'documents/address-contact/002-address-note.md'),
    [
      '# Address Note',
      '',
      'Elena Sofia Marquez receives current tenant notices at 418 Cedar Glen Avenue, Apt 12B.',
      'The mailing city is Sacramento, state CA, ZIP Code 95819.',
    ].join('\n'),
  );
  await writeFile(
    path.join(corpusRoot, 'documents/identity/003-employment-note.md'),
    [
      '# Employment Note',
      '',
      'Employee Elena Sofia Marquez works for Cedar & Coast Analytics.',
      'Title: Data Operations Analyst.',
      'Hire date: June 3, 2026.',
      'Work email: elena.marquez@cedarcoast.example.test.',
    ].join('\n'),
  );
  await writeFile(
    path.join(corpusRoot, 'documents/noise/081-newsletter.txt'),
    'Community newsletter about local library hours and transit reminders.\n',
  );
  await writeFile(
    path.join(corpusRoot, 'documents/noise/082-event-note.txt'),
    'Event note for a neighborhood cleanup with no personal identifiers.\n',
  );
}

async function validateElena(root) {
  return runValidation({
    repoRoot: root,
    args: ['--user', 'elena-marquez', '--corpus', 'realistic'],
  });
}

async function validateAlex(root) {
  return runValidation({
    repoRoot: root,
    args: ['--user', 'alex-i9-test', '--corpus', 'realistic'],
  });
}

function elenaManifestPath(root) {
  return path.join(
    root,
    'examples/eval/users/elena-marquez/corpora/realistic/manifest.json',
  );
}

function alexManifestPath(root) {
  return path.join(
    root,
    'examples/eval/users/alex-i9-test/corpora/realistic/manifest.json',
  );
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function listFiles(directory, baseDirectory = directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(absolutePath, baseDirectory)));
      continue;
    }
    if (entry.isFile()) {
      files.push(path.relative(baseDirectory, absolutePath).split(path.sep).join('/'));
    }
  }
  return files;
}

function assertHasCode(result, code) {
  assert.ok(
    result.issues.some((issue) => issue.code === code),
    `Expected issue code ${code}. Got ${result.issues
      .map((issue) => issue.code)
      .join(', ')}`,
  );
}

function assertNoCode(result, code) {
  assert.ok(
    !result.issues.some((issue) => issue.code === code),
    `Did not expect issue code ${code}.`,
  );
}

function countIssueCode(result, code) {
  return result.issues.filter((issue) => issue.code === code).length;
}

function fixtureDocument({
  id,
  documentPath,
  category,
  title,
  factKeys,
  detailTier,
  authority,
  freshness,
  expectedUse,
}) {
  return {
    id,
    path: documentPath,
    category,
    title,
    outputExtension: path.posix.extname(documentPath).slice(1),
    sourceSpec: sourceSpec(),
    factContract: {
      include: factKeys,
      forbid: [],
    },
    evaluationRole: evaluationRole({
      detailTier,
      authority,
      freshness,
      expectedUse,
    }),
  };
}

// Minimal unified-manifest clone for validator plumbing tests.
function corpusPlanFromManifest(manifest) {
  return JSON.parse(JSON.stringify(manifest));
}

function sourceSpec(overrides = {}) {
  return {
    artifactType: 'validator-unit-artifact',
    sourceFamily: 'validator-unit',
    captureMode: 'plain-text-export',
    timelineRefs: [],
    worldRefs: [],
    nativeSignals: ['status'],
    safeDetailMenu: ['unit test metadata'],
    riskyDetailMenu: ['new phone number'],
    lengthTarget: { minChars: 20, maxChars: 8000 },
    ...overrides,
  };
}

function evaluationRole(overrides = {}) {
  return {
    detailTier: 'brief',
    authority: 'medium',
    freshness: 'current',
    expectedUse: 'extract',
    challengeTags: ['current-fact'],
    ...overrides,
  };
}

function planDoc(overrides = {}) {
  const {
    sourceSpec: sourceSpecOverrides,
    factContract: factContractOverrides,
    evaluationRole: evaluationRoleOverrides,
    ...fields
  } = overrides;
  return {
    id: '001',
    path: 'documents/identity/001-id.md',
    category: 'identity',
    title: 'Identity Note',
    outputExtension: 'md',
    sourceSpec: sourceSpec(sourceSpecOverrides),
    factContract: {
      include: ['identity.ssn'],
      forbid: [],
      ...factContractOverrides,
    },
    evaluationRole: evaluationRole(evaluationRoleOverrides),
    ...fields,
  };
}

function unitManifest(overrides = {}) {
  return {
    schemaVersion: 2,
    userId: 'samir-desai',
    corpusId: 'realistic',
    seed: 'samir-desai__realistic',
    corpusKind: 'realistic-generated',
    forms: ['i-9'],
    purpose: 'Unit-test plan.',
    artifactWorld: {
      schemaVersion: 1,
      seed: 'samir-desai__realistic',
      timeline: {
        generatedAt: '2026-06-01T10:00:00-07:00',
      },
      source: {
        system: 'Validator Unit Test',
      },
    },
    factContractDefaults: { forbid: [] },
    intentionallyMissing: [],
    documents: [planDoc()],
    ...overrides,
  };
}
