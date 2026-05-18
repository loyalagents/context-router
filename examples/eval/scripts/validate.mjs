#!/usr/bin/env node

import Ajv2020 from 'ajv/dist/2020.js';
import { constants as fsConstants } from 'node:fs';
import {
  access,
  lstat,
  readdir,
  readFile,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultRepoRoot = path.resolve(__dirname, '../../..');

const SCHEMA_FILES = {
  profile: 'profile.schema.json',
  manifest: 'manifest.schema.json',
  scenario: 'scenario.schema.json',
  fieldMap: 'field-map.schema.json',
};

const SNAPSHOT_FILES = {
  'filled-form': 'filled-form.json',
  'written-preferences': 'written-preferences.json',
  'final-preferences': 'final-preferences.json',
};

const FIXTURE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export async function runValidation({
  repoRoot = defaultRepoRoot,
  args = [],
  writeReport = true,
} = {}) {
  const parsed = parseArgs(args);
  if (parsed.kind === 'usage-error') {
    return {
      exitCode: 2,
      usageError: parsed.message,
      usage: usage(),
      summary: emptySummary(),
      issues: [],
    };
  }

  const ctx = await createContext(repoRoot, parsed.options);

  if (parsed.options.scope === 'all') {
    const userIds = await listDirectories(path.join(ctx.evalRoot, 'users'));
    for (const userId of userIds) {
      const corpusIds = await listDirectories(
        path.join(ctx.evalRoot, 'users', userId, 'corpora'),
      );
      for (const corpusId of corpusIds) {
        await validateUserCorpus(ctx, userId, corpusId);
      }
    }

    const formIds = await listDirectories(path.join(ctx.evalRoot, 'forms'));
    for (const formId of formIds) {
      await validateForm(ctx, formId, { requireFieldMap: false });
    }

    const scenarioIds = await listDirectories(
      path.join(ctx.evalRoot, 'scenarios'),
    );
    for (const scenarioId of scenarioIds) {
      await validateScenario(ctx, scenarioId, { transitive: false });
    }
  } else if (parsed.options.scope === 'user') {
    const corpusIds = parsed.options.corpusId
      ? [parsed.options.corpusId]
      : await listDirectories(
          path.join(ctx.evalRoot, 'users', parsed.options.userId, 'corpora'),
        );
    for (const corpusId of corpusIds) {
      await validateUserCorpus(ctx, parsed.options.userId, corpusId);
    }
  } else if (parsed.options.scope === 'scenario') {
    await validateScenario(ctx, parsed.options.scenarioId, { transitive: true });
  } else if (parsed.options.scope === 'form') {
    await validateForm(ctx, parsed.options.formId, { requireFieldMap: false });
  }

  const summary = buildSummary(ctx);
  const report = {
    schemaVersion: 1,
    status: summary.errors > 0 ? 'fail' : 'pass',
    summary,
    issues: ctx.issues,
  };

  let reportPath = null;
  if (parsed.options.writeReport && writeReport) {
    reportPath = path.join(
      ctx.evalRoot,
      'users',
      parsed.options.userId,
      'corpora',
      parsed.options.corpusId,
      'validation-report.json',
    );
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  }

  return {
    exitCode: summary.errors > 0 ? 1 : 0,
    summary,
    issues: ctx.issues,
    report,
    reportPath,
  };
}

export function parseArgs(args) {
  const options = {
    scope: 'all',
    userId: null,
    corpusId: null,
    scenarioId: null,
    formId: null,
    writeReport: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--write-report') {
      options.writeReport = true;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      return { kind: 'usage-error', message: usage() };
    }
    if (!['--user', '--corpus', '--scenario', '--form'].includes(arg)) {
      return { kind: 'usage-error', message: `Unsupported argument: ${arg}` };
    }
    const value = args[index + 1];
    if (!value || value.startsWith('--')) {
      return { kind: 'usage-error', message: `Missing value for ${arg}` };
    }
    index += 1;
    if (arg === '--user') options.userId = value;
    if (arg === '--corpus') options.corpusId = value;
    if (arg === '--scenario') options.scenarioId = value;
    if (arg === '--form') options.formId = value;
  }

  const primaryScopes = [
    options.userId ? 'user' : null,
    options.scenarioId ? 'scenario' : null,
    options.formId ? 'form' : null,
  ].filter(Boolean);

  if (primaryScopes.length > 1) {
    return {
      kind: 'usage-error',
      message: 'Use only one validation scope: --user, --scenario, or --form.',
    };
  }

  if (options.corpusId && !options.userId) {
    return {
      kind: 'usage-error',
      message: '--corpus requires --user.',
    };
  }

  for (const [label, value] of [
    ['--user', options.userId],
    ['--corpus', options.corpusId],
    ['--scenario', options.scenarioId],
    ['--form', options.formId],
  ]) {
    if (value && !isFixtureId(value)) {
      return {
        kind: 'usage-error',
        message: `${label} value must be a fixture id such as elena-marquez.`,
      };
    }
  }

  if (options.writeReport && !(options.userId && options.corpusId)) {
    return {
      kind: 'usage-error',
      message: '--write-report requires --user <userId> --corpus <corpusId>.',
    };
  }

  if (options.scenarioId) options.scope = 'scenario';
  else if (options.formId) options.scope = 'form';
  else if (options.userId) options.scope = 'user';

  return { kind: 'ok', options };
}

export function formatResult(result) {
  if (result.usageError) {
    return `${result.usageError}\n\n${result.usage}`;
  }

  const lines = [];
  const verb = result.summary.errors > 0 ? 'failed' : 'passed';
  lines.push(`eval validation ${verb}`);

  if (result.issues.length > 0) {
    lines.push('');
    const groups = groupIssuesByArea(result.issues);
    for (const [area, issues] of groups) {
      lines.push(`${area}:`);
      for (const issue of issues) {
        const location = [issue.file, issue.pointer].filter(Boolean).join(':');
        lines.push(
          `${issue.level.toUpperCase()} ${issue.code} ${location} - ${issue.message}`,
        );
        if (issue.fix) lines.push(`  fix: ${issue.fix}`);
      }
      lines.push('');
    }
  }

  if (lines.at(-1) !== '') lines.push('');
  lines.push(
    `profiles=${result.summary.profiles} corpora=${result.summary.corpora} forms=${result.summary.forms} scenarios=${result.summary.scenarios} errors=${result.summary.errors} warnings=${result.summary.warnings}`,
  );

  if (result.reportPath) {
    lines.push(
      `report=${toPosixPath(path.relative(defaultRepoRoot, result.reportPath))}`,
    );
  }

  return lines.join('\n');
}

function groupIssuesByArea(issues) {
  const labels = new Map([
    ['profiles', 'profiles'],
    ['corpora', 'corpora'],
    ['forms', 'forms'],
    ['scenarios', 'scenarios'],
    ['other', 'other'],
  ]);
  const groups = new Map([...labels.keys()].map((area) => [area, []]));

  for (const issue of issues) {
    groups.get(issueArea(issue.file)).push(issue);
  }

  return [...groups.entries()]
    .filter(([, areaIssues]) => areaIssues.length > 0)
    .map(([area, areaIssues]) => [labels.get(area), areaIssues]);
}

function issueArea(file) {
  if (file.includes('/profile.yaml') || file.includes('/seed-preferences.')) {
    return 'profiles';
  }
  if (file.includes('/corpora/')) return 'corpora';
  if (file.includes('/forms/')) return 'forms';
  if (file.includes('/scenarios/')) return 'scenarios';
  return 'other';
}

function usage() {
  return [
    'Usage:',
    '  pnpm eval:validate',
    '  pnpm eval:validate --user <userId> [--corpus <corpusId>]',
    '  pnpm eval:validate --scenario <scenarioId>',
    '  pnpm eval:validate --form <formId>',
    '  pnpm eval:validate --user <userId> --corpus <corpusId> --write-report',
  ].join('\n');
}

async function createContext(repoRoot, options) {
  const evalRoot = path.join(repoRoot, 'examples/eval');
  const schemasRoot = path.join(evalRoot, 'schemas');
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const validators = {};

  for (const [name, fileName] of Object.entries(SCHEMA_FILES)) {
    const schemaPath = path.join(schemasRoot, fileName);
    const schema = JSON.parse(await readFile(schemaPath, 'utf8'));
    validators[name] = ajv.compile(schema);
  }

  const catalogPath = path.join(
    repoRoot,
    'apps/backend/src/config/preferences.catalog.json',
  );
  const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));

  return {
    repoRoot,
    evalRoot,
    options,
    validators,
    catalog,
    issues: [],
    visited: {
      profiles: new Set(),
      corpora: new Set(),
      forms: new Set(),
      scenarios: new Set(),
    },
  };
}

async function validateUserCorpus(ctx, userId, corpusId) {
  const userRoot = path.join(ctx.evalRoot, 'users', userId);
  const corpusRoot = path.join(userRoot, 'corpora', corpusId);
  const profilePath = path.join(userRoot, 'profile.yaml');
  const manifestPath = path.join(corpusRoot, 'manifest.json');

  const profile = await validateProfile(ctx, userId, profilePath);
  const profileFacts = profile
    ? collectFactKeys(profile.facts ?? {})
    : { leaves: new Map(), areas: new Set() };

  if (profile) {
    await validateSeedPreferences(ctx, userRoot, profile, profileFacts);
  }

  const manifest = await readJsonFile(ctx, manifestPath);
  if (!manifest) return null;

  ctx.visited.corpora.add(`${userId}/${corpusId}`);
  validateSchema(ctx, 'manifest', manifest, manifestPath);

  if (manifest.userId !== userId) {
    addIssue(ctx, {
      code: 'MANIFEST_USER_ID_MISMATCH',
      file: manifestPath,
      pointer: '/userId',
      message: `Manifest userId ${JSON.stringify(manifest.userId)} does not match folder ${JSON.stringify(userId)}.`,
      fix: 'Update manifest.userId or move the corpus folder.',
    });
  }
  if (manifest.corpusId !== corpusId) {
    addIssue(ctx, {
      code: 'MANIFEST_CORPUS_ID_MISMATCH',
      file: manifestPath,
      pointer: '/corpusId',
      message: `Manifest corpusId ${JSON.stringify(manifest.corpusId)} does not match folder ${JSON.stringify(corpusId)}.`,
      fix: 'Update manifest.corpusId or move the corpus folder.',
    });
  }

  checkUnique(ctx, manifest.forms ?? [], manifestPath, '/forms', 'MANIFEST_DUPLICATE_FORM');
  const formMaps = new Map();
  for (const formId of manifest.forms ?? []) {
    const formResult = await validateForm(ctx, formId, {
      requireFieldMap: true,
      profileFacts,
      profileFile: profilePath,
    });
    if (formResult.fieldMap) formMaps.set(formId, formResult.fieldMap);
  }

  await validateDocuments(ctx, corpusRoot, manifest, profileFacts, manifestPath);
  validateIntentionallyMissing(
    ctx,
    manifest,
    manifestPath,
    profileFacts,
    formMaps,
  );
  validateCoverage(ctx, manifest, manifestPath, profile, profileFacts, formMaps);

  return { profile, manifest, profileFacts, formMaps };
}

async function validateProfile(ctx, userId, profilePath) {
  const profile = await readYamlFile(ctx, profilePath);
  if (!profile) return null;

  ctx.visited.profiles.add(userId);
  validateSchema(ctx, 'profile', profile, profilePath);

  if (profile.userId !== userId) {
    addIssue(ctx, {
      code: 'PROFILE_USER_ID_MISMATCH',
      file: profilePath,
      pointer: 'userId',
      message: `Profile userId ${JSON.stringify(profile.userId)} does not match folder ${JSON.stringify(userId)}.`,
      fix: 'Update profile.userId or move the user folder.',
    });
  }

  return profile;
}

async function validateSeedPreferences(ctx, userRoot, profile, profileFacts) {
  const profilePath = path.join(userRoot, 'profile.yaml');
  const generatedPath = path.join(userRoot, 'seed-preferences.generated.json');
  const slugs = new Set();

  for (const [index, entry] of (profile.seedPreferences ?? []).entries()) {
    if (slugs.has(entry.slug)) {
      addIssue(ctx, {
        code: 'SEED_DUPLICATE_SLUG',
        file: profilePath,
        pointer: `seedPreferences.${index}.slug`,
        message: `Duplicate seed preference slug ${entry.slug}.`,
        fix: 'Keep one seedPreferences entry per backend slug.',
      });
    }
    slugs.add(entry.slug);

    const factState = classifyFactKey(profileFacts, entry.factKey);
    if (factState.kind !== 'leaf') {
      addIssue(ctx, {
        code: factState.kind === 'area' ? 'SEED_FACT_AREA' : 'SEED_FACT_MISSING',
        file: profilePath,
        pointer: `seedPreferences.${index}.factKey`,
        message: `Seed factKey ${entry.factKey} does not resolve to a profile leaf fact.`,
        fix: 'Point seedPreferences[].factKey at a concrete leaf under facts.',
      });
      continue;
    }

    const catalogEntry = ctx.catalog[entry.slug];
    if (!catalogEntry) {
      addIssue(ctx, {
        code: 'SEED_UNKNOWN_SLUG',
        file: profilePath,
        pointer: `seedPreferences.${index}.slug`,
        message: `Seed slug ${entry.slug} is not in the backend preference catalog.`,
        fix: 'Use an existing backend preference slug or add the backend catalog entry first.',
      });
      continue;
    }

    const value = factState.value;
    if (value != null) {
      validateCatalogValue(ctx, {
        value,
        catalogEntry,
        file: profilePath,
        pointer: `seedPreferences.${index}.factKey`,
        slug: entry.slug,
      });
    }
  }

  const rows = deriveSeedPreferences(profile);
  const expected = `${JSON.stringify(rows, null, 2)}\n`;
  let actual = null;
  try {
    actual = await readFile(generatedPath, 'utf8');
  } catch (error) {
    addIssue(ctx, {
      code: 'SEED_GENERATED_MISSING',
      file: generatedPath,
      pointer: '',
      message: `Generated seed preferences could not be read: ${error.message}.`,
      fix: 'Run pnpm eval:derive-seeds.',
    });
  }

  if (actual != null && actual !== expected) {
    addIssue(ctx, {
      code: 'SEED_GENERATED_STALE',
      file: generatedPath,
      pointer: '',
      message: 'Generated seed preferences do not match profile.yaml.',
      fix: 'Run pnpm eval:derive-seeds.',
    });
  }
}

async function validateDocuments(ctx, corpusRoot, manifest, profileFacts, manifestPath) {
  const documentsRoot = path.join(corpusRoot, 'documents');
  const listedPaths = new Set();
  const ids = new Set();

  if ((manifest.distribution?.documentCount ?? null) !== manifest.documents?.length) {
    addIssue(ctx, {
      code: 'MANIFEST_DOCUMENT_COUNT_MISMATCH',
      file: manifestPath,
      pointer: '/distribution/documentCount',
      message: `distribution.documentCount is ${manifest.distribution?.documentCount}, but documents has ${manifest.documents?.length ?? 0} entries.`,
      fix: 'Update distribution.documentCount to match documents.length.',
    });
  }

  for (const [index, doc] of (manifest.documents ?? []).entries()) {
    const pointer = `/documents/${index}`;
    if (ids.has(doc.id)) {
      addIssue(ctx, {
        code: 'DOCUMENT_DUPLICATE_ID',
        file: manifestPath,
        pointer: `${pointer}/id`,
        message: `Duplicate document id ${doc.id}.`,
        fix: 'Give every manifest document a unique id.',
      });
    }
    ids.add(doc.id);

    const normalized = normalizeDocumentPath(doc.path);
    if (!normalized.ok) {
      addIssue(ctx, {
        code: 'DOCUMENT_INVALID_PATH',
        file: manifestPath,
        pointer: `${pointer}/path`,
        message: normalized.message,
        fix: 'Use a repo-stable relative path under documents/.',
      });
      continue;
    }

    if (listedPaths.has(normalized.path)) {
      addIssue(ctx, {
        code: 'DOCUMENT_DUPLICATE_PATH',
        file: manifestPath,
        pointer: `${pointer}/path`,
        message: `Duplicate document path ${normalized.path}.`,
        fix: 'List each document path once.',
      });
    }
    listedPaths.add(normalized.path);

    const absoluteDocPath = path.join(corpusRoot, normalized.path);
    await requireFile(ctx, absoluteDocPath, manifestPath, `${pointer}/path`, {
      code: 'DOCUMENT_PATH_MISSING',
      fix: 'Create the document file or remove the manifest entry.',
    });

    if (doc.category === 'noise' && doc.expectedUse !== 'ignore') {
      addIssue(ctx, {
        code: 'DOCUMENT_NOISE_EXPECTED_USE',
        file: manifestPath,
        pointer: `${pointer}/expectedUse`,
        message: `Noise document ${doc.id} must have expectedUse "ignore".`,
        fix: 'Set expectedUse to "ignore" or change the category.',
      });
    }

    if (doc.expectedUse === 'ignore' && (doc.factKeys ?? []).length > 0) {
      addIssue(ctx, {
        code: 'DOCUMENT_IGNORE_FACT_KEYS',
        file: manifestPath,
        pointer: `${pointer}/factKeys`,
        message: `Ignored document ${doc.id} must not declare factKeys.`,
        fix: 'Clear factKeys or change expectedUse.',
      });
    }

    for (const [factIndex, factKey] of (doc.factKeys ?? []).entries()) {
      const factState = classifyFactKey(profileFacts, factKey);
      if (factState.kind !== 'leaf' || factState.value == null) {
        addIssue(ctx, {
          code:
            factState.kind === 'area'
              ? 'DOCUMENT_FACT_AREA'
              : factState.kind === 'leaf'
                ? 'DOCUMENT_FACT_NULL'
                : 'DOCUMENT_FACT_MISSING',
          file: manifestPath,
          pointer: `${pointer}/factKeys/${factIndex}`,
          message: `Document factKey ${factKey} must resolve to a non-null profile leaf fact.`,
          fix: 'Use a concrete non-null profile fact leaf or remove the factKey.',
        });
      }
    }
  }

  const actualPaths = await listDocumentFiles(ctx, documentsRoot, manifestPath);
  for (const actualPath of actualPaths) {
    if (!listedPaths.has(actualPath)) {
      addIssue(ctx, {
        code: 'DOCUMENT_UNLISTED_FILE',
        file: path.join(corpusRoot, actualPath),
        pointer: '',
        message: `Document file ${actualPath} is not listed in manifest.json.`,
        fix: 'Add the file to manifest.documents or remove it from documents/.',
      });
    }
  }
}

async function validateForm(ctx, formId, options = {}) {
  const formRoot = path.join(ctx.evalRoot, 'forms', formId);
  const fieldsPath = path.join(formRoot, 'fields.generated.json');
  const fieldMapPath = path.join(formRoot, 'field-map.json');
  const profileFacts = options.profileFacts ?? null;

  ctx.visited.forms.add(formId);

  const generated = await readJsonFile(ctx, fieldsPath);
  let fieldMap = null;

  if (generated) {
    if (generated.formId !== formId) {
      addIssue(ctx, {
        code: 'FIELDS_FORM_ID_MISMATCH',
        file: fieldsPath,
        pointer: '/formId',
        message: `Generated fields formId ${JSON.stringify(generated.formId)} does not match folder ${JSON.stringify(formId)}.`,
        fix: 'Regenerate field manifests or move the form folder.',
      });
    }
  }

  const fieldMapExists = await fileExists(fieldMapPath);
  if (!fieldMapExists) {
    if (options.requireFieldMap) {
      addIssue(ctx, {
        code: 'FIELD_MAP_MISSING',
        file: fieldMapPath,
        pointer: '',
        message: `Form ${formId} is referenced by a corpus or scenario but has no field-map.json.`,
        fix: `Add examples/eval/forms/${formId}/field-map.json.`,
      });
    }
    return { generated, fieldMap: null };
  }

  fieldMap = await readJsonFile(ctx, fieldMapPath);
  if (!fieldMap) return { generated, fieldMap: null };

  prepassFieldMap(ctx, fieldMap, fieldMapPath);
  validateSchema(ctx, 'fieldMap', fieldMap, fieldMapPath);

  if (fieldMap.formId !== formId) {
    addIssue(ctx, {
      code: 'FIELD_MAP_FORM_ID_MISMATCH',
      file: fieldMapPath,
      pointer: '/formId',
      message: `Field map formId ${JSON.stringify(fieldMap.formId)} does not match folder ${JSON.stringify(formId)}.`,
      fix: 'Update field-map.json formId or move the form folder.',
    });
  }

  if (generated?.extraction?.status === 'ok') {
    validateFieldMapExhaustiveness(ctx, generated, fieldMap, fieldMapPath);
  }

  if (profileFacts) {
    for (const [index, field] of (fieldMap.fields ?? []).entries()) {
      if (field.mode !== 'fact') continue;
      const factState = classifyFactKey(profileFacts, field.factKey);
      if (factState.kind !== 'leaf') {
        addIssue(ctx, {
          code:
            factState.kind === 'area'
              ? 'FIELD_MAP_FACT_AREA'
              : 'FIELD_MAP_FACT_MISSING',
          file: fieldMapPath,
          pointer: `/fields/${index}/factKey`,
          message: `Field map factKey ${field.factKey} does not resolve to a profile leaf fact.`,
          fix: 'Map the field to a concrete profile fact leaf; null leaf values are allowed.',
        });
      }
    }
  }

  return { generated, fieldMap };
}

async function validateScenario(ctx, scenarioId, { transitive }) {
  const scenarioRoot = path.join(ctx.evalRoot, 'scenarios', scenarioId);
  const scenarioPath = path.join(scenarioRoot, 'scenario.json');
  const scenario = await readJsonFile(ctx, scenarioPath);
  if (!scenario) return null;

  ctx.visited.scenarios.add(scenarioId);
  validateSchema(ctx, 'scenario', scenario, scenarioPath);

  if (scenario.scenarioId !== scenarioId) {
    addIssue(ctx, {
      code: 'SCENARIO_ID_MISMATCH',
      file: scenarioPath,
      pointer: '/scenarioId',
      message: `Scenario id ${JSON.stringify(scenario.scenarioId)} does not match folder ${JSON.stringify(scenarioId)}.`,
      fix: 'Update scenarioId or move the scenario folder.',
    });
  }

  await requireFile(
    ctx,
    path.join(scenarioRoot, 'start/prompt.md'),
    scenarioPath,
    '/start/prompt.md',
    {
      code: 'SCENARIO_PROMPT_MISSING',
      fix: 'Add start/prompt.md for the scenario.',
    },
  );

  let transitiveResult = null;
  const hasValidReferences =
    isFixtureId(scenario.userId) &&
    isFixtureId(scenario.corpusId) &&
    isFixtureId(scenario.formId);

  if (transitive && hasValidReferences) {
    transitiveResult = await validateUserCorpus(
      ctx,
      scenario.userId,
      scenario.corpusId,
    );
  }

  const manifest = hasValidReferences
    ? transitiveResult?.manifest ??
      (await readJsonFile(
        ctx,
        path.join(
          ctx.evalRoot,
          'users',
          scenario.userId,
          'corpora',
          scenario.corpusId,
          'manifest.json',
        ),
      ))
    : null;

  if (manifest && !manifest.forms?.includes(scenario.formId)) {
    addIssue(ctx, {
      code: 'SCENARIO_FORM_NOT_IN_CORPUS',
      file: scenarioPath,
      pointer: '/formId',
      message: `Scenario formId ${scenario.formId} is not listed in the referenced corpus forms[].`,
      fix: 'Add the form to manifest.forms or point the scenario at a listed form.',
    });
  }

  if (isFixtureId(scenario.formId)) {
    await validateForm(ctx, scenario.formId, { requireFieldMap: true });
  }

  for (const [index, snapshot] of (scenario.expectedSnapshots ?? []).entries()) {
    const fileName = SNAPSHOT_FILES[snapshot];
    if (!fileName) continue;
    const snapshotPath = path.join(scenarioRoot, 'expected', fileName);
    const parsed = await readJsonFile(ctx, snapshotPath);
    if (!parsed) {
      addIssue(ctx, {
        code: 'SCENARIO_EXPECTED_SNAPSHOT_MISSING',
        file: scenarioPath,
        pointer: `/expectedSnapshots/${index}`,
        message: `Expected snapshot ${snapshot} could not be read from expected/${fileName}.`,
        fix: 'Create the expected snapshot JSON file or remove it from expectedSnapshots.',
      });
    }
  }

  return scenario;
}

function validateIntentionallyMissing(ctx, manifest, manifestPath, profileFacts, formMaps) {
  for (const [index, missing] of (manifest.intentionallyMissing ?? []).entries()) {
    const pointer = `/intentionallyMissing/${index}`;
    const factState = classifyFactKey(profileFacts, missing.factKey);
    if (factState.kind !== 'leaf') {
      addIssue(ctx, {
        code:
          factState.kind === 'area'
            ? 'MISSING_FACT_AREA'
            : 'MISSING_FACT_NOT_IN_PROFILE',
        file: manifestPath,
        pointer: `${pointer}/factKey`,
        message: `Intentionally missing factKey ${missing.factKey} must resolve to a profile leaf fact.`,
        fix: 'Use a concrete nullable profile fact leaf.',
      });
    } else if (factState.value !== null) {
      addIssue(ctx, {
        code: 'MISSING_FACT_NOT_NULL',
        file: manifestPath,
        pointer: `${pointer}/factKey`,
        message: `Intentionally missing factKey ${missing.factKey} must be null in profile.yaml.`,
        fix: 'Set the profile fact to null or remove the intentionallyMissing entry.',
      });
    }

    for (const [formIndex, formId] of (missing.forms ?? []).entries()) {
      if (!manifest.forms?.includes(formId)) {
        addIssue(ctx, {
          code: 'MISSING_FORM_NOT_IN_MANIFEST',
          file: manifestPath,
          pointer: `${pointer}/forms/${formIndex}`,
          message: `Intentionally missing form ${formId} is not listed in manifest.forms[].`,
          fix: 'Use a form listed in manifest.forms[].',
        });
      }
    }

    const mapped = (missing.forms ?? []).some((formId) => {
      const fieldMap = formMaps.get(formId);
      return (fieldMap?.fields ?? []).some(
        (field) => field.mode === 'fact' && field.factKey === missing.factKey,
      );
    });
    if (!mapped) {
      addIssue(ctx, {
        code: 'MISSING_FACT_NOT_MAPPED',
        file: manifestPath,
        pointer: `${pointer}/factKey`,
        message: `Intentionally missing factKey ${missing.factKey} is not mapped by any listed form field map.`,
        fix: 'Map a form field to the fact or remove the intentionallyMissing entry.',
      });
    }

    const declaringDocIndex = (manifest.documents ?? []).findIndex((doc) =>
      (doc.factKeys ?? []).includes(missing.factKey),
    );
    if (declaringDocIndex !== -1) {
      addIssue(ctx, {
        code: 'MISSING_FACT_DECLARED_BY_DOCUMENT',
        file: manifestPath,
        pointer: `/documents/${declaringDocIndex}/factKeys`,
        message: `Intentionally missing factKey ${missing.factKey} must not appear in document factKeys[].`,
        fix: 'Remove the factKey from documents or remove the intentionallyMissing entry.',
      });
    }
  }
}

function validateCoverage(ctx, manifest, manifestPath, profile, profileFacts, formMaps) {
  if (!profile) return;
  const seedCovered = new Set();
  for (const entry of profile.seedPreferences ?? []) {
    const value = getFactValue(profile.facts, entry.factKey);
    if (value != null) seedCovered.add(entry.factKey);
  }

  const documentCovered = new Set(
    (manifest.documents ?? []).flatMap((doc) => doc.factKeys ?? []),
  );

  for (const formId of manifest.forms ?? []) {
    const fieldMap = formMaps.get(formId);
    if (!fieldMap) continue;
    for (const [index, field] of (fieldMap.fields ?? []).entries()) {
      if (field.mode !== 'fact') continue;
      const factState = classifyFactKey(profileFacts, field.factKey);
      if (factState.kind !== 'leaf' || factState.value == null) continue;
      if (seedCovered.has(field.factKey) || documentCovered.has(field.factKey)) {
        continue;
      }
      addIssue(ctx, {
        code: 'FIELD_FACT_UNCOVERED',
        file: manifestPath,
        pointer: `/forms/${manifest.forms.indexOf(formId)}`,
        message: `Form ${formId} field ${field.fieldIndex} (${field.pdfFieldName}) maps to ${field.factKey}, but no seed preference or document factKeys[] covers it.`,
        fix: `Add ${field.factKey} to a document factKeys[] entry or seedPreferences[].`,
      });
    }
  }
}

function validateFieldMapExhaustiveness(ctx, generated, fieldMap, fieldMapPath) {
  const fields = fieldMap.fields ?? [];
  const byIndex = new Map();
  for (const [entryIndex, field] of fields.entries()) {
    if (!Number.isInteger(field.fieldIndex)) continue;
    if (byIndex.has(field.fieldIndex)) {
      addIssue(ctx, {
        code: 'FIELD_MAP_DUPLICATE_INDEX',
        file: fieldMapPath,
        pointer: `/fields/${entryIndex}/fieldIndex`,
        message: `Duplicate fieldIndex ${field.fieldIndex}.`,
        fix: 'Map each generated PDF field index exactly once.',
      });
    }
    byIndex.set(field.fieldIndex, { field, entryIndex });
  }

  if (fields.length !== generated.fields?.length) {
    addIssue(ctx, {
      code: 'FIELD_MAP_FIELD_COUNT_MISMATCH',
      file: fieldMapPath,
      pointer: '/fields',
      message: `Field map has ${fields.length} entries, but fields.generated.json has ${generated.fields?.length ?? 0} fields.`,
      fix: 'Add exactly one field-map entry per generated PDF field.',
    });
  }

  for (const generatedField of generated.fields ?? []) {
    const mapped = byIndex.get(generatedField.index);
    if (!mapped) {
      addIssue(ctx, {
        code: 'FIELD_MAP_MISSING_INDEX',
        file: fieldMapPath,
        pointer: '/fields',
        message: `Field map is missing generated field index ${generatedField.index} (${generatedField.pdfFieldName}).`,
        fix: 'Add a field-map entry for the missing generated field.',
      });
      continue;
    }
    if (mapped.field.pdfFieldName !== generatedField.pdfFieldName) {
      addIssue(ctx, {
        code: 'FIELD_MAP_NAME_MISMATCH',
        file: fieldMapPath,
        pointer: `/fields/${mapped.entryIndex}/pdfFieldName`,
        message: `Field index ${generatedField.index} maps ${JSON.stringify(mapped.field.pdfFieldName)}, but generated field name is ${JSON.stringify(generatedField.pdfFieldName)}.`,
        fix: 'Update pdfFieldName to match fields.generated.json.',
      });
    }
  }
}

function prepassFieldMap(ctx, fieldMap, fieldMapPath) {
  if (!Array.isArray(fieldMap.fields)) return;
  for (const [index, field] of fieldMap.fields.entries()) {
    if (field.mode !== 'fact' && field.mode !== 'skip') {
      addIssue(ctx, {
        code: 'FIELD_MAP_INVALID_MODE',
        file: fieldMapPath,
        pointer: `/fields/${index}/mode`,
        message: `Field map entry mode must be "fact" or "skip".`,
        fix: 'Set mode to "fact" with factKey or "skip" with reason.',
      });
    }
    if (!Number.isInteger(field.fieldIndex)) {
      addIssue(ctx, {
        code: 'FIELD_MAP_INVALID_INDEX',
        file: fieldMapPath,
        pointer: `/fields/${index}/fieldIndex`,
        message: 'Field map entry fieldIndex must be an integer.',
        fix: 'Use the generated PDF field index.',
      });
    }
    if (typeof field.pdfFieldName !== 'string') {
      addIssue(ctx, {
        code: 'FIELD_MAP_MISSING_PDF_FIELD_NAME',
        file: fieldMapPath,
        pointer: `/fields/${index}/pdfFieldName`,
        message: 'Field map entry pdfFieldName must be a string.',
        fix: 'Copy the field name from fields.generated.json.',
      });
    }
    if (field.mode === 'fact' && typeof field.factKey !== 'string') {
      addIssue(ctx, {
        code: 'FIELD_MAP_MISSING_FACT_KEY',
        file: fieldMapPath,
        pointer: `/fields/${index}/factKey`,
        message: 'Fact field-map entries require factKey.',
        fix: 'Add a profile factKey or change mode to skip.',
      });
    }
    if (field.mode === 'skip' && typeof field.reason !== 'string') {
      addIssue(ctx, {
        code: 'FIELD_MAP_MISSING_SKIP_REASON',
        file: fieldMapPath,
        pointer: `/fields/${index}/reason`,
        message: 'Skip field-map entries require reason.',
        fix: 'Add a valid skip reason.',
      });
    }
  }
}

function validateCatalogValue(ctx, { value, catalogEntry, file, pointer, slug }) {
  const valueType = catalogEntry.valueType;
  const ok =
    (valueType === 'array' && Array.isArray(value)) ||
    (valueType === 'boolean' && typeof value === 'boolean') ||
    (valueType === 'string' && typeof value === 'string') ||
    (valueType === 'enum' &&
      typeof value === 'string' &&
      (catalogEntry.options ?? []).includes(value));

  if (!ok) {
    addIssue(ctx, {
      code: 'SEED_VALUE_TYPE_MISMATCH',
      file,
      pointer,
      message: `Seed value for ${slug} does not match backend catalog valueType ${valueType}.`,
      fix: 'Use a fact with the backend catalog value type or update the catalog intentionally.',
    });
  }
}

function validateSchema(ctx, schemaName, data, filePath) {
  const validate = ctx.validators[schemaName];
  if (!validate(data)) {
    for (const error of validate.errors ?? []) {
      addIssue(ctx, {
        code: 'SCHEMA_VALIDATION_FAILED',
        file: filePath,
        pointer: schemaPointer(schemaName, error),
        message: `${schemaName} schema ${error.message ?? 'validation failed'}.`,
      });
    }
  }
}

function schemaPointer(schemaName, error) {
  const pointer = error.instancePath || '/';
  if (schemaName !== 'profile') return pointer;

  if (pointer === '/') {
    return error.params?.missingProperty ?? '';
  }

  return pointer
    .slice(1)
    .split('/')
    .map((segment) => segment.replace(/~1/g, '/').replace(/~0/g, '~'))
    .join('.');
}

function collectFactKeys(value, prefix = '') {
  const leaves = new Map();
  const areas = new Set();

  function visit(current, currentPath) {
    if (isPlainObject(current)) {
      if (currentPath) areas.add(currentPath);
      for (const [key, child] of Object.entries(current)) {
        visit(child, currentPath ? `${currentPath}.${key}` : key);
      }
      return;
    }
    if (currentPath) leaves.set(currentPath, current);
  }

  visit(value, prefix);
  return { leaves, areas };
}

function classifyFactKey(profileFacts, factKey) {
  if (profileFacts.leaves.has(factKey)) {
    return { kind: 'leaf', value: profileFacts.leaves.get(factKey) };
  }
  if (profileFacts.areas.has(factKey)) return { kind: 'area' };
  return { kind: 'missing' };
}

function deriveSeedPreferences(profile) {
  const rows = [];
  for (const entry of profile.seedPreferences ?? []) {
    const value = getFactValue(profile.facts, entry.factKey);
    if (value == null) continue;
    rows.push({ slug: entry.slug, value });
  }
  return rows.sort((left, right) =>
    left.slug < right.slug ? -1 : left.slug > right.slug ? 1 : 0,
  );
}

function getFactValue(facts, factKey) {
  return factKey.split('.').reduce((value, segment) => {
    if (!isPlainObject(value)) return undefined;
    return value[segment];
  }, facts);
}

function checkUnique(ctx, values, filePath, pointer, code) {
  const seen = new Set();
  for (const [index, value] of values.entries()) {
    if (seen.has(value)) {
      addIssue(ctx, {
        code,
        file: filePath,
        pointer: `${pointer}/${index}`,
        message: `Duplicate value ${value}.`,
        fix: 'Keep each value unique.',
      });
    }
    seen.add(value);
  }
}

async function readJsonFile(ctx, filePath) {
  let source;
  try {
    source = await readFile(filePath, 'utf8');
  } catch (error) {
    addIssue(ctx, {
      code: 'FILE_READ_FAILED',
      file: filePath,
      pointer: '',
      message: `Could not read file: ${error.message}.`,
    });
    return null;
  }

  try {
    return JSON.parse(source);
  } catch (error) {
    addIssue(ctx, {
      code: 'JSON_PARSE_FAILED',
      file: filePath,
      pointer: '',
      message: `Could not parse JSON: ${error.message}.`,
    });
    return null;
  }
}

async function readYamlFile(ctx, filePath) {
  let source;
  try {
    source = await readFile(filePath, 'utf8');
  } catch (error) {
    addIssue(ctx, {
      code: 'FILE_READ_FAILED',
      file: filePath,
      pointer: '',
      message: `Could not read file: ${error.message}.`,
    });
    return null;
  }

  try {
    return parseYaml(source);
  } catch (error) {
    addIssue(ctx, {
      code: 'YAML_PARSE_FAILED',
      file: filePath,
      pointer: '',
      message: `Could not parse YAML: ${error.message}.`,
    });
    return null;
  }
}

async function requireFile(ctx, targetPath, sourceFile, pointer, { code, fix }) {
  try {
    const stat = await lstat(targetPath);
    if (stat.isSymbolicLink()) {
      addIssue(ctx, {
        code: 'FILE_IS_SYMLINK',
        file: sourceFile,
        pointer,
        message: `Referenced path ${repoRelative(ctx, targetPath)} is a symlink.`,
        fix: 'Use committed regular files inside the fixture tree.',
      });
      return false;
    }
    if (!stat.isFile()) {
      addIssue(ctx, {
        code,
        file: sourceFile,
        pointer,
        message: `Referenced path ${repoRelative(ctx, targetPath)} is not a file.`,
        fix,
      });
      return false;
    }
    return true;
  } catch {
    addIssue(ctx, {
      code,
      file: sourceFile,
      pointer,
      message: `Referenced file ${repoRelative(ctx, targetPath)} does not exist.`,
      fix,
    });
    return false;
  }
}

async function listDocumentFiles(ctx, documentsRoot, manifestPath) {
  const files = [];
  async function walk(directory) {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      addIssue(ctx, {
        code: 'DOCUMENTS_DIR_READ_FAILED',
        file: manifestPath,
        pointer: '/documents',
        message: `Could not read documents directory: ${error.message}.`,
        fix: 'Create the documents/ directory for this corpus.',
      });
      return;
    }

    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        addIssue(ctx, {
          code: 'DOCUMENT_FILE_SYMLINK',
          file: absolute,
          pointer: '',
          message: `Document path ${repoRelative(ctx, absolute)} is a symlink.`,
          fix: 'Use regular committed document files.',
        });
        continue;
      }
      if (entry.isDirectory()) {
        await walk(absolute);
        continue;
      }
      if (entry.isFile()) {
        files.push(
          toPosixPath(path.relative(path.dirname(documentsRoot), absolute)),
        );
      }
    }
  }

  await walk(documentsRoot);
  return files.sort();
}

function normalizeDocumentPath(value) {
  if (typeof value !== 'string' || value.length === 0) {
    return { ok: false, message: 'Document path must be a non-empty string.' };
  }
  if (value.includes('\\')) {
    return { ok: false, message: 'Document path must use POSIX separators.' };
  }
  if (path.isAbsolute(value)) {
    return { ok: false, message: 'Document path must be relative.' };
  }
  const normalized = path.posix.normalize(value);
  if (normalized !== value || normalized.startsWith('../') || normalized === '..') {
    return { ok: false, message: 'Document path must not contain traversal.' };
  }
  if (!normalized.startsWith('documents/')) {
    return { ok: false, message: 'Document path must be under documents/.' };
  }
  return { ok: true, path: normalized };
}

async function listDirectories(directory) {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

async function fileExists(filePath) {
  try {
    await access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function addIssue(ctx, issue) {
  ctx.issues.push({
    level: issue.level ?? 'error',
    code: issue.code,
    file: repoRelative(ctx, issue.file),
    pointer: issue.pointer ?? '',
    message: issue.message,
    ...(issue.fix ? { fix: issue.fix } : {}),
  });
}

function buildSummary(ctx) {
  const errors = ctx.issues.filter((issue) => issue.level === 'error').length;
  const warnings = ctx.issues.filter((issue) => issue.level === 'warning').length;
  return {
    profiles: ctx.visited.profiles.size,
    corpora: ctx.visited.corpora.size,
    forms: ctx.visited.forms.size,
    scenarios: ctx.visited.scenarios.size,
    errors,
    warnings,
  };
}

function emptySummary() {
  return {
    profiles: 0,
    corpora: 0,
    forms: 0,
    scenarios: 0,
    errors: 0,
    warnings: 0,
  };
}

function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function isFixtureId(value) {
  return typeof value === 'string' && FIXTURE_ID_PATTERN.test(value);
}

function repoRelative(ctx, absolutePath) {
  if (!absolutePath) return '';
  return toPosixPath(path.relative(ctx.repoRoot, absolutePath));
}

function toPosixPath(value) {
  return value.split(path.sep).join(path.posix.sep);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await runValidation({ args: process.argv.slice(2) });
  const output = formatResult(result);
  console.log(output);
  process.exitCode = result.exitCode;
}
