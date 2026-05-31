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
  manifest.documents[0].factKeys = ['address.current'];
  manifest.documents[0].detailTier = 'noise';
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
  manifest.documents.find((doc) => doc.id === '081').expectedUse = 'extract';
  const ignored = manifest.documents.find((doc) => doc.id === '082');
  ignored.expectedUse = 'ignore';
  ignored.factKeys = ['identity.firstName'];
  await writeJson(manifestPath, manifest);

  const result = await validateElena(root);
  assertHasCode(result, 'DOCUMENT_NOISE_EXPECTED_USE');
  assertHasCode(result, 'DOCUMENT_IGNORE_FACT_KEYS');
});

test('plan-only validates corpus plans without manifest or document bodies', async (t) => {
  const root = await copyRepo(t);
  const corpusRoot = path.join(
    root,
    'examples/eval/users/samir-desai/corpora/realistic',
  );
  await mkdir(corpusRoot, { recursive: true });
  await writeJson(path.join(corpusRoot, 'corpus-plan.json'), unitCorpusPlan({
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

test('corpus plan validation rejects invalid forbidden fact references', async (t) => {
  const root = await copyRepo(t);
  const corpusRoot = path.join(
    root,
    'examples/eval/users/samir-desai/corpora/realistic',
  );
  await mkdir(corpusRoot, { recursive: true });
  await writeJson(path.join(corpusRoot, 'corpus-plan.json'), unitCorpusPlan({
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

  assertHasCode(result, 'CORPUS_PLAN_FORBIDDEN_FACT_AREA');
  assertHasCode(result, 'CORPUS_PLAN_FORBIDDEN_FACT_MISSING');
  assertHasCode(result, 'CORPUS_PLAN_DEFAULT_FORBIDDEN_FACT_AREA');
  assertHasCode(result, 'CORPUS_PLAN_DEFAULT_FORBIDDEN_FACT_MISSING');
});

test('corpus plan schema accepts default forbidden facts and rejects unexpected fields', async (t) => {
  const root = await copyRepo(t);
  const corpusRoot = path.join(
    root,
    'examples/eval/users/samir-desai/corpora/realistic',
  );
  await mkdir(corpusRoot, { recursive: true });
  await writeJson(path.join(corpusRoot, 'corpus-plan.json'), unitCorpusPlan({
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

  const plan = await readJson(path.join(corpusRoot, 'corpus-plan.json'));
  plan.unexpectedTopLevelField = true;
  plan.documents[0].unsupportedPlanField = true;
  await writeJson(path.join(corpusRoot, 'corpus-plan.json'), plan);

  const result = await runValidation({
    repoRoot: root,
    args: ['--user', 'samir-desai', '--corpus', 'realistic', '--plan-only'],
  });

  assertHasCode(result, 'SCHEMA_VALIDATION_FAILED');
  assertNoCode(result, 'CORPUS_PLAN_FORBIDDEN_FACT_MISSING');
});

test('corpus plan schema rejects V1 corpus-plan fields', async (t) => {
  const root = await copyRepo(t);
  const corpusRoot = path.join(
    root,
    'examples/eval/users/samir-desai/corpora/realistic',
  );
  await mkdir(corpusRoot, { recursive: true });
  const plan = unitCorpusPlan();
  plan.schemaVersion = 1;
  plan.defaultForbiddenFactKeys = ['contact.phone'];
  plan.targetDocumentCount = 1;
  plan.categoryCounts = { identity: 1 };
  plan.documents[0].factKeys = ['identity.ssn'];
  plan.documents[0].brief = 'Legacy V1 brief.';
  await writeJson(path.join(corpusRoot, 'corpus-plan.json'), plan);

  const result = await runValidation({
    repoRoot: root,
    args: ['--user', 'samir-desai', '--corpus', 'realistic', '--plan-only'],
  });

  assertHasCode(result, 'SCHEMA_VALIDATION_FAILED');
});

test('corpus plan schema rejects each legacy V1 planning field', async (t) => {
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
    const plan = unitCorpusPlan();
    mutate(plan);
    await writeJson(path.join(corpusRoot, 'corpus-plan.json'), plan);

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

test('corpus plan schema rejects duplicate forbidden fact keys', async (t) => {
  const root = await copyRepo(t);
  const corpusRoot = path.join(
    root,
    'examples/eval/users/samir-desai/corpora/realistic',
  );
  await mkdir(corpusRoot, { recursive: true });
  await writeJson(path.join(corpusRoot, 'corpus-plan.json'), unitCorpusPlan({
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

test('corpus plan validation rejects document forbidden facts that conflict with declared facts', async (t) => {
  const root = await copyRepo(t);
  const manifestPath = elenaManifestPath(root);
  const manifest = await readJson(manifestPath);
  const corpusRoot = path.dirname(manifestPath);
  const corpusPlan = corpusPlanFromManifest(manifest);
  corpusPlan.documents[0].factContract.include = ['identity.ssn'];
  corpusPlan.documents[0].factContract.forbid = ['identity.ssn'];
  await writeJson(path.join(corpusRoot, 'corpus-plan.json'), corpusPlan);

  const result = await validateElena(root);
  assertHasCode(result, 'CORPUS_PLAN_FORBIDDEN_FACT_CONFLICT');
});

test('corpus plan validation reports manifest projection drift', async (t) => {
  const root = await copyRepo(t);
  const manifestPath = elenaManifestPath(root);
  const manifest = await readJson(manifestPath);
  const corpusRoot = path.dirname(manifestPath);
  const corpusPlan = corpusPlanFromManifest(manifest);
  corpusPlan.documents[0].factContract.include = ['identity.ssn'];
  await writeJson(path.join(corpusRoot, 'corpus-plan.json'), corpusPlan);

  const result = await validateElena(root);
  assertHasCode(result, 'MANIFEST_PLAN_MISMATCH');
});

test('corpus plan validation reports manifest drift for every projected document field', async (t) => {
  const root = await copyRepo(t);
  const manifestPath = elenaManifestPath(root);
  const manifest = await readJson(manifestPath);
  const corpusRoot = path.dirname(manifestPath);
  const planPath = path.join(corpusRoot, 'corpus-plan.json');

  const driftCases = [
    ['id', (doc) => {
      doc.id = `${doc.id}-drift`;
    }],
    ['path', (doc) => {
      doc.path = 'documents/identity/001-plan-drift.md';
    }],
    ['category', (doc) => {
      doc.category = 'address-contact';
    }],
    ['title', (doc) => {
      doc.title = `${doc.title} Drift`;
    }],
    ['factKeys', (doc) => {
      doc.factContract.include = ['identity.legalName'];
    }],
    ['detailTier', (doc) => {
      doc.evaluationRole.detailTier = 'brief';
    }],
    ['authority', (doc) => {
      doc.evaluationRole.authority = 'low';
    }],
    ['freshness', (doc) => {
      doc.evaluationRole.freshness = 'mixed';
    }],
    ['expectedUse', (doc) => {
      doc.evaluationRole.expectedUse = 'corroborate';
    }],
  ];

  for (const [fieldName, mutate] of driftCases) {
    const corpusPlan = corpusPlanFromManifest(manifest);
    mutate(corpusPlan.documents[0]);
    await writeJson(planPath, corpusPlan);

    const result = await validateElena(root);
    assert.ok(
      result.issues.some((issue) => issue.code === 'MANIFEST_PLAN_MISMATCH'),
      `${fieldName} drift should be reported`,
    );
  }
});

test('prose checks require high-confidence declared values in document bodies', async (t) => {
  const root = await copyRepo(t);
  const manifestPath = elenaManifestPath(root);
  const manifest = await readJson(manifestPath);
  manifest.documents[0].factKeys = [
    'identity.ssn',
    'identity.dateOfBirth',
    'address.current.postalCode',
    'address.current.state',
    'workAuthorization.citizenshipStatus',
  ];
  manifest.documents[0].expectedUse = 'extract';
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

test('prose checks require expanded deterministic declared facts in document bodies', async (t) => {
  const root = await copyRepo(t);
  const manifestPath = elenaManifestPath(root);
  const manifest = await readJson(manifestPath);
  const corpusRoot = path.dirname(manifestPath);
  const doc = manifest.documents[0];
  doc.factKeys = [
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
  doc.expectedUse = 'extract';
  await writeJson(manifestPath, manifest);
  await writeJson(path.join(corpusRoot, 'corpus-plan.json'), corpusPlanFromManifest(manifest));
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
  doc.factKeys = ['employment.startDate'];
  doc.expectedUse = 'extract';
  await writeJson(manifestPath, manifest);
  await writeJson(path.join(corpusRoot, 'corpus-plan.json'), corpusPlanFromManifest(manifest));
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
  doc.factKeys = ['identity.firstName', 'address.current.city'];
  doc.expectedUse = 'extract';
  await writeJson(manifestPath, manifest);
  await writeJson(path.join(corpusRoot, 'corpus-plan.json'), corpusPlanFromManifest(manifest));
  await writeFile(
    path.join(corpusRoot, doc.path),
    'Internal identifiers: preelenapost and xsacramentoy. No person or city is named.\n',
  );

  const result = await validateElena(root);
  assertHasCode(result, 'DOCUMENT_FACT_VALUE_MISSING');
});

test('document prose checks reject forbidden fact values from corpus plans', async (t) => {
  const root = await copyRepo(t);
  const manifestPath = elenaManifestPath(root);
  const manifest = await readJson(manifestPath);
  const corpusRoot = path.dirname(manifestPath);
  const doc = manifest.documents[0];
  doc.factKeys = [];
  doc.expectedUse = 'guardrail';
  const corpusPlan = corpusPlanFromManifest(manifest);
  corpusPlan.documents[0].factContract.forbid = ['identity.ssn'];
  await writeJson(manifestPath, manifest);
  await writeJson(path.join(corpusRoot, 'corpus-plan.json'), corpusPlan);
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
  doc.factKeys = [];
  doc.expectedUse = 'guardrail';
  const corpusPlan = corpusPlanFromManifest(manifest);
  corpusPlan.factContractDefaults.forbid = ['identity.ssn'];
  await writeJson(manifestPath, manifest);
  await writeJson(path.join(corpusRoot, 'corpus-plan.json'), corpusPlan);
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
  doc.factKeys = ['identity.ssn'];
  doc.expectedUse = 'extract';
  const corpusPlan = corpusPlanFromManifest(manifest);
  corpusPlan.factContractDefaults.forbid = ['identity.ssn', 'employment.workEmail'];
  await writeJson(manifestPath, manifest);
  await writeJson(path.join(corpusRoot, 'corpus-plan.json'), corpusPlan);
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
  doc.factKeys = [];
  doc.expectedUse = 'guardrail';
  const corpusPlan = corpusPlanFromManifest(manifest);
  corpusPlan.documents[0].factContract.forbid = ['identity.ssn'];
  await writeJson(manifestPath, manifest);
  await writeJson(path.join(corpusRoot, 'corpus-plan.json'), corpusPlan);
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
  await writeJson(path.join(corpusRoot, 'corpus-plan.json'), corpusPlan);
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
  assert.ok(
    result.issues.some(
      (issue) =>
        issue.code === 'DOCUMENT_MISSING_FACT_PRESENT' &&
        issue.level === 'warning',
    ),
  );
});

test('document prose checks do not treat I-9 identifiers as missing phone values', async (t) => {
  const root = await copyRepo(t);
  const manifestPath = elenaManifestPath(root);
  const manifest = await readJson(manifestPath);
  const corpusRoot = path.dirname(manifestPath);
  const doc = manifest.documents[0];
  doc.factKeys = [];
  doc.expectedUse = 'extract';
  doc.freshness = 'current';
  manifest.intentionallyMissing = manifest.intentionallyMissing.filter(
    (missing) => missing.factKey === 'contact.phone',
  );
  const corpusPlan = corpusPlanFromManifest(manifest);
  corpusPlan.documents[0].factContract.forbid = ['contact.phone'];
  await writeJson(manifestPath, manifest);
  await writeJson(path.join(corpusRoot, 'corpus-plan.json'), corpusPlan);
  await writeFile(
    path.join(corpusRoot, doc.path),
    [
      'Current work authorization document review note.',
      'Form I-94 Admission Number: 11223344556.',
      'Alien Registration Number/USCIS Number: 987654321.',
      'Foreign Passport Number: XK1234567.',
    ].join('\n'),
  );

  const result = await validateElena(root);
  assertNoCode(result, 'DOCUMENT_MISSING_FACT_PRESENT');
  const truth = result.report.corpusTruth.documents.find(
    (entry) => entry.id === doc.id,
  );
  assert.ok(truth.forbiddenFacts.warningOnly.includes('contact.phone'));
});

test('document prose checks reject high-confidence current identifiers in noise docs', async (t) => {
  const root = await copyRepo(t);
  const manifestPath = elenaManifestPath(root);
  const manifest = await readJson(manifestPath);
  const corpusRoot = path.dirname(manifestPath);
  const noisy = manifest.documents[0];
  noisy.category = 'noise';
  noisy.expectedUse = 'ignore';
  noisy.authority = 'none';
  noisy.detailTier = 'brief';
  noisy.factKeys = [];
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
  noisy.expectedUse = 'ignore';
  noisy.authority = 'none';
  noisy.detailTier = 'brief';
  noisy.factKeys = [];
  const corpusPlan = corpusPlanFromManifest(manifest);
  corpusPlan.documents[0].factContract.forbid = ['identity.ssn'];
  await writeJson(manifestPath, manifest);
  await writeJson(path.join(corpusRoot, 'corpus-plan.json'), corpusPlan);
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
  noisy.expectedUse = 'ignore';
  noisy.authority = 'none';
  noisy.detailTier = 'brief';
  noisy.factKeys = [];
  const corpusPlan = corpusPlanFromManifest(manifest);
  corpusPlan.factContractDefaults.forbid = ['identity.ssn', 'contact.phone'];
  await writeJson(manifestPath, manifest);
  await writeJson(path.join(corpusRoot, 'corpus-plan.json'), corpusPlan);
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
  const manifestPath = elenaManifestPath(root);
  const manifest = await readJson(manifestPath);
  const corpusRoot = path.dirname(manifestPath);
  manifest.documents[0].expectedUse = 'extract';
  manifest.documents[0].freshness = 'current';
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
  doc.factKeys = [];
  doc.freshness = 'stale';
  doc.expectedUse = 'guardrail';
  await writeJson(manifestPath, manifest);
  const corpusPlan = corpusPlanFromManifest(manifest);
  corpusPlan.documents[0].sourceSpec.nativeSignals = ['ticket id'];
  corpusPlan.documents[0].sourceSpec.lengthTarget = { minChars: 300, maxChars: 400 };
  await writeJson(path.join(corpusRoot, 'corpus-plan.json'), corpusPlan);
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
    'examples/eval/users/elena-marquez/corpora/realistic/corpus-plan.json',
  );
  assert.equal(nativeSignalIssue.pointer, '/documents/0/sourceSpec/nativeSignals/0');
  const lengthIssue = result.issues.find(
    (issue) => issue.code === 'DOCUMENT_SOURCE_LENGTH_OUT_OF_RANGE',
  );
  assert.equal(
    lengthIssue.file,
    'examples/eval/users/elena-marquez/corpora/realistic/corpus-plan.json',
  );
  assert.equal(lengthIssue.pointer, '/documents/0/sourceSpec/lengthTarget');
});

test('source realism checks report repeated corpus skeletons', async (t) => {
  const root = await copyRepo(t);
  const manifestPath = elenaManifestPath(root);
  const manifest = await readJson(manifestPath);
  const corpusRoot = path.dirname(manifestPath);
  const docs = manifest.documents.slice(0, 3);
  for (const doc of docs) {
    doc.factKeys = [];
    doc.expectedUse = 'corroborate';
  }
  await writeJson(manifestPath, manifest);
  await writeJson(path.join(corpusRoot, 'corpus-plan.json'), corpusPlanFromManifest(manifest));

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
      factKeys: [],
      expectedUse: 'corroborate',
    },
    {
      doc: docs[1],
      nextPath: 'documents/identity/002-state-id-card-notes.yaml',
      body: 'broken: [\n',
      factKeys: [],
      expectedUse: 'corroborate',
    },
    {
      doc: docs[2],
      nextPath: 'documents/identity/003-passport-application-draft.json',
      body: '```json\n{"ok": true}\n```\n',
      factKeys: [],
      expectedUse: 'corroborate',
    },
    {
      doc: docs[3],
      nextPath: 'documents/identity/004-birth-record-summary.txt',
      body: '# Markdown Heading\nplain text below\n',
      factKeys: [],
      expectedUse: 'corroborate',
    },
  ];

  for (const rewrite of rewrites) {
    const oldPath = path.join(corpusRoot, rewrite.doc.path);
    const nextPath = path.join(corpusRoot, rewrite.nextPath);
    await rm(oldPath, { force: true });
    await writeFile(nextPath, rewrite.body);
    rewrite.doc.path = rewrite.nextPath;
    rewrite.doc.factKeys = rewrite.factKeys;
    rewrite.doc.expectedUse = rewrite.expectedUse;
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
  doc.factKeys = [
    'identity.legalName',
    'employment.startDate',
    'communication.preferredChannels',
  ];
  doc.expectedUse = 'extract';
  const corpusPlan = corpusPlanFromManifest(manifest);
  corpusPlan.documents[0].factContract.forbid = [
    'employment.workEmail',
    'contact.phone',
  ];
  await writeJson(manifestPath, manifest);
  await writeJson(path.join(corpusRoot, 'corpus-plan.json'), corpusPlan);
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
  doc.factKeys = [];
  doc.expectedUse = 'guardrail';
  const corpusPlan = corpusPlanFromManifest(manifest);
  corpusPlan.documents[0].factContract.forbid = [
    'identity.notReal',
    'workAuthorization.workAuthorizationExpirationDate',
  ];
  await writeJson(manifestPath, manifest);
  await writeJson(path.join(corpusRoot, 'corpus-plan.json'), corpusPlan);

  const result = await validateElena(root);
  const truth = result.report.corpusTruth.documents.find(
    (entry) => entry.id === doc.id,
  );

  assertHasCode(result, 'CORPUS_PLAN_FORBIDDEN_FACT_MISSING');
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
  doc.factKeys = ['identity.legalName'];
  doc.expectedUse = 'extract';
  doc.freshness = 'current';
  const corpusPlan = corpusPlanFromManifest(manifest);
  corpusPlan.factContractDefaults.forbid = ['contact.phone'];
  corpusPlan.documents[0].factContract.forbid = [
    'identity.ssn',
    'contact.phone',
  ];
  await writeJson(manifestPath, manifest);
  await writeJson(path.join(corpusRoot, 'corpus-plan.json'), corpusPlan);
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
  assert.deepEqual(truth.forbiddenFacts.warningOnly, [
    'contact.phone',
    'workAuthorization.uscisANumber',
    'workAuthorization.i94AdmissionNumber',
    'workAuthorization.foreignPassportNumber',
  ]);
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
  const plan = await readJson(path.join(corpusRoot, 'corpus-plan.json'));
  const manifest = await readJson(path.join(corpusRoot, 'manifest.json'));

  assert.equal(plan.schemaVersion, 2);
  assert.equal(plan.documents.length, 10);
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.documents.length, 10);
  assert.ok(plan.artifactWorld);
  assert.ok(plan.factContractDefaults);

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

  for (const doc of plan.documents) {
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

test('reports every document that declares an intentionally missing fact', async (t) => {
  const root = await copyRepo(t);
  const manifestPath = elenaManifestPath(root);
  const manifest = await readJson(manifestPath);
  manifest.documents[0].factKeys.push('contact.phone');
  manifest.documents[1].factKeys.push('contact.phone');
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
    schemaVersion: 1,
    userId: 'elena-marquez',
    corpusId: 'realistic',
    seed: 'elena-marquez__realistic',
    forms: ['i-9'],
    purpose: 'Small validator test corpus created inside temp test repos.',
    intentionallyMissing: [
      {
        factKey: 'contact.phone',
        forms: ['i-9'],
        reason: 'Elena does not provide a phone number in this test fixture.',
        expectedBehavior: 'Leave telephone blank.',
      },
      {
        factKey: 'workAuthorization.uscisANumber',
        forms: ['i-9'],
        reason: 'Elena uses the U.S. citizen I-9 path.',
        expectedBehavior: 'Leave USCIS A-number blank.',
      },
      {
        factKey: 'workAuthorization.workAuthorizationExpirationDate',
        forms: ['i-9'],
        reason: 'Elena uses the U.S. citizen I-9 path.',
        expectedBehavior: 'Leave work authorization expiration blank.',
      },
      {
        factKey: 'workAuthorization.i94AdmissionNumber',
        forms: ['i-9'],
        reason: 'Elena uses the U.S. citizen I-9 path.',
        expectedBehavior: 'Leave I-94 admission number blank.',
      },
      {
        factKey: 'workAuthorization.foreignPassportNumber',
        forms: ['i-9'],
        reason: 'Elena uses the U.S. citizen I-9 path.',
        expectedBehavior: 'Leave foreign passport number blank.',
      },
    ],
    documents: [
      {
        id: '001',
        path: 'documents/identity/001-identity-profile.md',
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
        ],
        detailTier: 'hero',
        authority: 'high',
        freshness: 'current',
        expectedUse: 'extract',
      },
      {
        id: '002',
        path: 'documents/address-contact/002-address-note.md',
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
      },
      {
        id: '003',
        path: 'documents/identity/003-employment-note.md',
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
      },
      {
        id: '081',
        path: 'documents/noise/081-newsletter.txt',
        category: 'noise',
        title: 'Newsletter',
        factKeys: [],
        detailTier: 'brief',
        authority: 'none',
        freshness: 'unknown',
        expectedUse: 'ignore',
      },
      {
        id: '082',
        path: 'documents/noise/082-event-note.txt',
        category: 'noise',
        title: 'Event Note',
        factKeys: [],
        detailTier: 'brief',
        authority: 'none',
        freshness: 'unknown',
        expectedUse: 'ignore',
      },
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

function elenaManifestPath(root) {
  return path.join(
    root,
    'examples/eval/users/elena-marquez/corpora/realistic/manifest.json',
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

// Minimal corpus-plan stand-in for validator plumbing tests. This intentionally
// derives only the plan fields those tests need, rather than replacing the real
// manifest projection path used by generation.
function corpusPlanFromManifest(manifest) {
  return {
    schemaVersion: 2,
    userId: manifest.userId,
    corpusId: manifest.corpusId,
    forms: manifest.forms,
    purpose: manifest.purpose,
    artifactWorld: {
      schemaVersion: 1,
      seed: `${manifest.userId}__${manifest.corpusId}`,
      timeline: {
        generatedAt: '2026-06-01T10:00:00-07:00',
      },
      source: {
        system: 'Validator Unit Test',
      },
    },
    factContractDefaults: { forbid: [] },
    intentionallyMissing: manifest.intentionallyMissing,
    documents: manifest.documents.map((doc) => ({
      id: doc.id,
      path: doc.path,
      category: doc.category,
      title: doc.title,
      outputExtension: path.posix.extname(doc.path).slice(1),
      sourceSpec: sourceSpec(),
      factContract: {
        include: doc.factKeys,
        forbid: [],
      },
      evaluationRole: evaluationRole({
        detailTier: doc.detailTier,
        authority: doc.authority,
        freshness: doc.freshness,
        expectedUse: doc.expectedUse,
      }),
    })),
  };
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

function unitCorpusPlan(overrides = {}) {
  return {
    schemaVersion: 2,
    userId: 'samir-desai',
    corpusId: 'realistic',
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
