#!/usr/bin/env node

import Ajv2020 from 'ajv/dist/2020.js';
import { constants as fsConstants } from 'node:fs';
import {
  access,
  lstat,
  mkdir,
  readdir,
  readFile,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import {
  classifyFactKey,
  collectFactKeys,
  deriveSeedPreferences,
  effectiveForbiddenFactKeys,
  getFactValue,
  isHighConfidenceFactKey,
  isFixtureId,
  jsonText,
  planDocumentAuthority,
  planDocumentDetailTier,
  planDocumentExpectedUse,
  planDocumentFactKeys,
  planDocumentForbiddenFactKeys,
  planDocumentFreshness,
  shouldDeriveMissingFactAsForbidden,
  textContainsDeclaredFactValue,
  textContainsFactValue,
  textContainsSplitLegalName,
  toPosixPath,
} from './shared.mjs';
import { fieldIsActive, isConditionalField } from './field-map.mjs';
import { discoverTemplates } from './template-renderer.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultRepoRoot = path.resolve(__dirname, '../../..');

const SCHEMA_FILES = {
  profile: 'profile.schema.json',
  manifest: 'manifest.schema.json',
  scenario: 'scenario.schema.json',
  fieldMap: 'field-map.schema.json',
  template: 'template.schema.json',
  filledFormSnapshot: 'filled-form-snapshot.schema.json',
};

const SNAPSHOT_FILES = {
  'filled-form': 'filled-form.json',
  'written-preferences': 'written-preferences.json',
  'final-preferences': 'final-preferences.json',
};

const NOISE_LEAK_FACT_KEYS = [
  'identity.legalName',
  'contact.email',
  'employment.workEmail',
  'identity.ssn',
  'workAuthorization.uscisANumber',
  'address.current.street',
];

const WORK_AUTH_MISSING_PATTERN_KEYS = new Set([
  'workAuthorization.uscisANumber',
  'workAuthorization.i94AdmissionNumber',
  'workAuthorization.foreignPassportNumber',
]);

export async function runValidation({
  repoRoot = defaultRepoRoot,
  args = [],
  writeReport = true,
  skipExpectedSnapshots = false,
} = {}) {
  const parsed = parseArgs(args);
  if (parsed.kind === 'usage-error') {
    return {
      exitCode: 2,
      repoRoot,
      usageError: parsed.message,
      usage: usage(),
      summary: emptySummary(),
      issues: [],
    };
  }

  const ctx = await createContext(repoRoot, {
    ...parsed.options,
    skipExpectedSnapshots,
  });
  await validateTemplates(ctx);

  if (parsed.options.scope === 'all') {
    const userIds = await listDirectories(path.join(ctx.evalRoot, 'users'));
    for (const userId of userIds) {
      const corpusIds = await listDirectories(
        path.join(ctx.evalRoot, 'users', userId, 'corpora'),
      );
      if (corpusIds.length === 0) {
        await validateUserProfile(ctx, userId);
      }
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
    if (corpusIds.length === 0) {
      await validateUserProfile(ctx, parsed.options.userId);
    }
    for (const corpusId of corpusIds) {
      await validateUserCorpus(ctx, parsed.options.userId, corpusId);
    }
  } else if (parsed.options.scope === 'scenario') {
    await validateScenario(ctx, parsed.options.scenarioId, { transitive: true });
  } else if (parsed.options.scope === 'form') {
    await validateForm(ctx, parsed.options.formId, { requireFieldMap: false });
  }

  const summary = buildSummary(ctx);
  const corpusTruth = buildCorpusTruth(ctx);
  const report = {
    schemaVersion: 1,
    status: summary.errors > 0 ? 'fail' : 'pass',
    summary,
    corpusTruth,
    issues: ctx.issues,
  };

  let reportPath = null;
  if ((parsed.options.writeReport || parsed.options.reportOut) && writeReport) {
    reportPath = parsed.options.reportOut
      ? path.resolve(repoRoot, parsed.options.reportOut)
      : path.join(
          ctx.evalRoot,
          'users',
          parsed.options.userId,
          'corpora',
          parsed.options.corpusId,
          'validation-report.json',
        );
    await mkdir(path.dirname(reportPath), { recursive: true });
    await writeFile(reportPath, jsonText(report));
  }

  return {
    exitCode: summary.errors > 0 ? 1 : 0,
    repoRoot: ctx.repoRoot,
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
    documentsRoot: null,
    reportOut: null,
    writeReport: false,
    planOnly: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--write-report') {
      options.writeReport = true;
      continue;
    }
    if (arg === '--plan-only') {
      options.planOnly = true;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      return { kind: 'usage-error', message: usage() };
    }
    if (
      ![
        '--user',
        '--corpus',
        '--scenario',
        '--form',
        '--documents-root',
        '--report-out',
      ].includes(arg)
    ) {
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
    if (arg === '--documents-root') options.documentsRoot = value;
    if (arg === '--report-out') options.reportOut = value;
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

  if (options.documentsRoot && !(options.userId && options.corpusId)) {
    return {
      kind: 'usage-error',
      message: '--documents-root requires --user <userId> --corpus <corpusId>.',
    };
  }

  if (options.reportOut && !(options.userId && options.corpusId)) {
    return {
      kind: 'usage-error',
      message: '--report-out requires --user <userId> --corpus <corpusId>.',
    };
  }

  if (options.writeReport && options.reportOut) {
    return {
      kind: 'usage-error',
      message: 'Use either --write-report or --report-out, not both.',
    };
  }

  if (options.planOnly && !(options.userId && options.corpusId)) {
    return {
      kind: 'usage-error',
      message: '--plan-only requires --user <userId> --corpus <corpusId>.',
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
    `profiles=${result.summary.profiles} corpora=${result.summary.corpora} forms=${result.summary.forms} scenarios=${result.summary.scenarios} templates=${result.summary.templates} errors=${result.summary.errors} warnings=${result.summary.warnings}`,
  );

  if (result.reportPath) {
    const repoRoot = result.repoRoot ?? defaultRepoRoot;
    lines.push(
      `report=${toPosixPath(path.relative(repoRoot, result.reportPath))}`,
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
    ['templates', 'templates'],
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
  if (file.includes('/templates/')) return 'templates';
  return 'other';
}

function usage() {
  return [
    'Usage:',
    '  pnpm eval:validate',
    '  pnpm eval:validate --user <userId> [--corpus <corpusId>]',
    '  pnpm eval:validate --scenario <scenarioId>',
    '  pnpm eval:validate --form <formId>',
    '  pnpm eval:validate --user <userId> --corpus <corpusId> --plan-only',
    '  pnpm eval:validate --user <userId> --corpus <corpusId> --write-report',
    '  pnpm eval:validate --user <userId> --corpus <corpusId> --documents-root <previewRoot> [--report-out <file>]',
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
      templates: new Set(),
    },
    templates: new Map(),
    corpusTruth: {
      documents: [],
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
    : null;

  if (profile) {
    await validateSeedPreferences(ctx, userRoot, profile, profileFacts);
  }

  const manifest = await readJsonFile(ctx, manifestPath);
  if (!manifest) return null;

  ctx.visited.corpora.add(`${userId}/${corpusId}`);
  validateSchema(ctx, 'manifest', manifest, manifestPath);
  validateManifestContract(ctx, {
    userId,
    corpusId,
    manifest,
    manifestPath,
    profileFacts,
  });

  const formMaps = new Map();
  for (const formId of manifest.forms ?? []) {
    const formResult = await validateForm(ctx, formId, {
      requireFieldMap: true,
      profileFacts,
      profileFile: profilePath,
    });
    if (formResult.fieldMap) formMaps.set(formId, formResult.fieldMap);
  }

  if (ctx.options.planOnly) {
    return { profile, manifest, profileFacts, formMaps };
  }

  await validateDocuments(ctx, {
    corpusRoot,
    documentsSourceRoot: ctx.options.documentsRoot
      ? path.resolve(ctx.repoRoot, ctx.options.documentsRoot)
      : corpusRoot,
    manifest,
    profileFacts,
    manifestPath,
  });
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

async function validateUserProfile(ctx, userId) {
  const userRoot = path.join(ctx.evalRoot, 'users', userId);
  const profilePath = path.join(userRoot, 'profile.yaml');
  const profile = await validateProfile(ctx, userId, profilePath);
  if (profile) {
    await validateSeedPreferences(ctx, userRoot, profile, collectFactKeys(profile.facts ?? {}));
  }
  return profile;
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

async function validateTemplates(ctx) {
  let templates;
  try {
    templates = await discoverTemplates({ evalRoot: ctx.evalRoot });
  } catch (error) {
    addIssue(ctx, {
      code: 'TEMPLATE_DISCOVERY_FAILED',
      file: path.join(ctx.evalRoot, 'templates'),
      pointer: '',
      message: `Could not discover templates: ${error.message}.`,
      fix: 'Fix template module syntax or exports.',
    });
    return;
  }

  for (const template of templates) {
    const templateFile = template.filePath;
    const meta = template.meta;
    const expectedCategory = template.expectedTemplateId.split('/')[0];
    ctx.visited.templates.add(template.expectedTemplateId);

    if (!meta || typeof meta !== 'object') {
      addIssue(ctx, {
        code: 'TEMPLATE_META_MISSING',
        file: templateFile,
        pointer: 'meta',
        message: 'Template module must export a meta object.',
        fix: 'Export const meta = {...} from the template module.',
      });
      continue;
    }

    validateSchema(ctx, 'template', meta, templateFile);

    if (ctx.templates.has(meta.templateId)) {
      addIssue(ctx, {
        code: 'TEMPLATE_DUPLICATE_ID',
        file: templateFile,
        pointer: 'templateId',
        message: `Duplicate templateId ${meta.templateId}.`,
        fix: 'Use one template module per templateId.',
      });
    } else if (typeof meta.templateId === 'string') {
      ctx.templates.set(meta.templateId, template);
    }

    if (meta.templateId !== template.expectedTemplateId) {
      addIssue(ctx, {
        code: 'TEMPLATE_ID_PATH_MISMATCH',
        file: templateFile,
        pointer: 'templateId',
        message: `Template id ${JSON.stringify(meta.templateId)} does not match path ${JSON.stringify(template.expectedTemplateId)}.`,
        fix: 'Update meta.templateId or move the template file.',
      });
    }

    if (meta.category !== expectedCategory) {
      addIssue(ctx, {
        code: 'TEMPLATE_CATEGORY_PATH_MISMATCH',
        file: templateFile,
        pointer: 'category',
        message: `Template category ${JSON.stringify(meta.category)} does not match path category ${JSON.stringify(expectedCategory)}.`,
        fix: 'Update meta.category or move the template file.',
      });
    }

    if (typeof template.render !== 'function') {
      addIssue(ctx, {
        code: 'TEMPLATE_RENDER_MISSING',
        file: templateFile,
        pointer: 'render',
        message: 'Template module must export render().',
        fix: 'Export function render(helpers) from the template module.',
      });
    }
  }
}

async function validateSeedPreferences(ctx, userRoot, profile, profileFacts) {
  const profilePath = path.join(userRoot, 'profile.yaml');
  const generatedPath = path.join(userRoot, 'seed-preferences.generated.json');
  const slugs = new Set();
  const entries = profile.seedPreferences;

  if (!Array.isArray(entries)) {
    return;
  }

  for (const [index, entry] of entries.entries()) {
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
  const expected = jsonText(rows);
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

function validateManifestContract(ctx, {
  userId,
  corpusId,
  manifest,
  manifestPath,
  profileFacts,
}) {
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
  if (profileFacts) {
    for (const [factIndex, factKey] of (
      manifest.factContractDefaults?.forbid ?? []
    ).entries()) {
      const factState = classifyFactKey(profileFacts, factKey);
      if (factState.kind !== 'leaf') {
        addIssue(ctx, {
          code:
            factState.kind === 'area'
              ? 'MANIFEST_DEFAULT_FORBIDDEN_FACT_AREA'
              : 'MANIFEST_DEFAULT_FORBIDDEN_FACT_MISSING',
          file: manifestPath,
          pointer: `/factContractDefaults/forbid/${factIndex}`,
          message: `Default forbidden fact path ${factKey} must resolve to a profile leaf fact.`,
          fix: 'Use a concrete profile fact leaf or remove the default forbidden path.',
        });
      }
    }
  }

  const documents = manifest.documents ?? [];
  const ids = new Set();
  const paths = new Set();

  for (const [index, doc] of documents.entries()) {
    const pointer = `/documents/${index}`;
    const expectedUse = planDocumentExpectedUse(doc);
    const authority = planDocumentAuthority(doc);
    const freshness = planDocumentFreshness(doc);
    const factKeys = planDocumentFactKeys(doc);
    const forbiddenFactKeys = planDocumentForbiddenFactKeys(doc);

    if (ids.has(doc.id)) {
      addIssue(ctx, {
        code: 'MANIFEST_DUPLICATE_DOCUMENT_ID',
        file: manifestPath,
        pointer: `${pointer}/id`,
        message: `Duplicate document id ${doc.id}.`,
        fix: 'Give every document a unique id.',
      });
    }
    ids.add(doc.id);

    const normalized = normalizeDocumentPath(doc.path);
    if (!normalized.ok) {
      addIssue(ctx, {
        code: 'MANIFEST_INVALID_DOCUMENT_PATH',
        file: manifestPath,
        pointer: `${pointer}/path`,
        message: normalized.message,
        fix: 'Use a repo-stable relative path under documents/.',
      });
    } else {
      if (paths.has(normalized.path)) {
        addIssue(ctx, {
          code: 'MANIFEST_DUPLICATE_DOCUMENT_PATH',
          file: manifestPath,
          pointer: `${pointer}/path`,
          message: `Duplicate document path ${normalized.path}.`,
          fix: 'List each path once.',
        });
      }
      paths.add(normalized.path);
      const extension = path.posix.extname(normalized.path).slice(1);
      if (doc.outputExtension && extension !== doc.outputExtension) {
        addIssue(ctx, {
          code: 'MANIFEST_EXTENSION_MISMATCH',
          file: manifestPath,
          pointer: `${pointer}/outputExtension`,
          message: `outputExtension ${doc.outputExtension} does not match path extension ${extension}.`,
          fix: 'Update outputExtension or the document path extension.',
        });
      }
    }

    for (const [refIndex, ref] of (doc.sourceSpec?.timelineRefs ?? []).entries()) {
      if (getWorldValue(manifest.artifactWorld, `timeline.${ref}`) === undefined) {
        addIssue(ctx, {
          code: 'MANIFEST_WORLD_REF_MISSING',
          file: manifestPath,
          pointer: `${pointer}/sourceSpec/timelineRefs/${refIndex}`,
          message: `Document ${doc.id} references missing artifactWorld timeline value ${ref}.`,
          fix: 'Use an existing artifactWorld timeline ref or add it to artifactWorld.',
        });
      }
    }

    for (const [refIndex, ref] of (doc.sourceSpec?.worldRefs ?? []).entries()) {
      if (getWorldValue(manifest.artifactWorld, ref) === undefined) {
        addIssue(ctx, {
          code: 'MANIFEST_WORLD_REF_MISSING',
          file: manifestPath,
          pointer: `${pointer}/sourceSpec/worldRefs/${refIndex}`,
          message: `Document ${doc.id} references missing artifactWorld value ${ref}.`,
          fix: 'Use an existing artifactWorld ref or add it to artifactWorld.',
        });
      }
    }

    const lengthTarget = doc.sourceSpec?.lengthTarget;
    if (
      lengthTarget &&
      Number.isInteger(lengthTarget.minChars) &&
      Number.isInteger(lengthTarget.maxChars) &&
      lengthTarget.maxChars < lengthTarget.minChars
    ) {
      addIssue(ctx, {
        code: 'MANIFEST_LENGTH_TARGET_INVALID',
        file: manifestPath,
        pointer: `${pointer}/sourceSpec/lengthTarget`,
        message: `Document ${doc.id} sourceSpec lengthTarget maxChars must be greater than or equal to minChars.`,
        fix: 'Set sourceSpec.lengthTarget.maxChars greater than or equal to minChars.',
      });
    }

    if (doc.category === 'noise' && expectedUse !== 'ignore') {
      addIssue(ctx, {
        code: 'MANIFEST_NOISE_EXPECTED_USE',
        file: manifestPath,
        pointer: `${pointer}/evaluationRole/expectedUse`,
        message: `Noise document ${doc.id} must have expectedUse "ignore".`,
        fix: 'Set expectedUse to "ignore" or change the category.',
      });
    }

    if (expectedUse === 'ignore' && factKeys.length > 0) {
      addIssue(ctx, {
        code: 'MANIFEST_IGNORE_FACT_KEYS',
        file: manifestPath,
        pointer: `${pointer}/factContract/include`,
        message: `Ignored document ${doc.id} must not include person facts.`,
        fix: 'Clear factContract.include or change expectedUse.',
      });
    }

    if (
      doc.category === 'partial-conflicting' &&
      authority === 'high' &&
      freshness === 'current' &&
      expectedUse === 'extract'
    ) {
      addIssue(ctx, {
        code: 'MANIFEST_CONFLICTING_HIGH_AUTHORITY_EXTRACT',
        file: manifestPath,
        pointer,
        message: `Partial/conflicting document ${doc.id} should not be high-authority current extract material.`,
        fix: 'Lower authority, mark stale/mixed, or change expectedUse.',
      });
    }

    if (profileFacts) {
      for (const [factIndex, factKey] of factKeys.entries()) {
        const factState = classifyFactKey(profileFacts, factKey);
        if (factState.kind !== 'leaf') {
          addIssue(ctx, {
            code:
              factState.kind === 'area'
                ? 'MANIFEST_FACT_AREA'
                : 'MANIFEST_FACT_MISSING',
            file: manifestPath,
            pointer: `${pointer}/factContract/include/${factIndex}`,
            message: `Document include path ${factKey} must resolve to a profile leaf fact.`,
            fix: 'Use a concrete profile fact leaf or remove the include path.',
          });
        }
      }

      const declaredFactKeys = new Set(factKeys);
      for (const [factIndex, factKey] of forbiddenFactKeys.entries()) {
        if (declaredFactKeys.has(factKey)) {
          addIssue(ctx, {
            code: 'MANIFEST_FORBIDDEN_FACT_CONFLICT',
            file: manifestPath,
            pointer: `${pointer}/factContract/forbid/${factIndex}`,
            message: `Document ${doc.id} lists ${factKey} in both include and forbid.`,
            fix: 'Remove the path from factContract.forbid or factContract.include.',
          });
        }

        const factState = classifyFactKey(profileFacts, factKey);
        if (factState.kind !== 'leaf') {
          addIssue(ctx, {
            code:
              factState.kind === 'area'
                ? 'MANIFEST_FORBIDDEN_FACT_AREA'
                : 'MANIFEST_FORBIDDEN_FACT_MISSING',
            file: manifestPath,
            pointer: `${pointer}/factContract/forbid/${factIndex}`,
            message: `Document forbid path ${factKey} must resolve to a profile leaf fact.`,
            fix: 'Use a concrete profile fact leaf or remove the forbid path.',
          });
        }
      }
    }
  }
}

async function validateDocuments(ctx, {
  corpusRoot,
  documentsSourceRoot,
  manifest,
  profileFacts,
  manifestPath,
}) {
  const documentsRoot = path.join(documentsSourceRoot, 'documents');
  const listedPaths = new Set();
  const ids = new Set();
  const bodyRecords = [];

  for (const [index, doc] of (manifest.documents ?? []).entries()) {
    const pointer = `/documents/${index}`;
    const expectedUse = planDocumentExpectedUse(doc);
    const factKeys = planDocumentFactKeys(doc);
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

    const absoluteDocPath = path.join(documentsSourceRoot, normalized.path);
    await requireFile(ctx, absoluteDocPath, manifestPath, `${pointer}/path`, {
      code: 'DOCUMENT_PATH_MISSING',
      fix: 'Create the document file or remove the manifest entry.',
    });

    if (doc.category === 'noise' && expectedUse !== 'ignore') {
      addIssue(ctx, {
        code: 'DOCUMENT_NOISE_EXPECTED_USE',
        file: manifestPath,
        pointer: `${pointer}/evaluationRole/expectedUse`,
        message: `Noise document ${doc.id} must have expectedUse "ignore".`,
        fix: 'Set expectedUse to "ignore" or change the category.',
      });
    }

    if (expectedUse === 'ignore' && factKeys.length > 0) {
      addIssue(ctx, {
        code: 'DOCUMENT_IGNORE_FACT_KEYS',
        file: manifestPath,
        pointer: `${pointer}/factContract/include`,
        message: `Ignored document ${doc.id} must not include person facts.`,
        fix: 'Clear factContract.include or change expectedUse.',
      });
    }

    if (doc.template && !ctx.templates.has(doc.template)) {
      addIssue(ctx, {
        code: 'DOCUMENT_TEMPLATE_MISSING',
        file: manifestPath,
        pointer: `${pointer}/template`,
        message: `Document template ${doc.template} does not exist in examples/eval/templates.`,
        fix: 'Use an existing templateId or omit template for hand-authored documents.',
      });
    }

    if (profileFacts) {
      for (const [factIndex, factKey] of factKeys.entries()) {
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
            pointer: `${pointer}/factContract/include/${factIndex}`,
            message: `Document include path ${factKey} must resolve to a non-null profile leaf fact.`,
            fix: 'Use a concrete non-null profile fact leaf or remove the include path.',
          });
        }
      }
    }

    if (profileFacts && (await fileExists(absoluteDocPath))) {
      const body = await readFile(absoluteDocPath, 'utf8');
      bodyRecords.push({ doc, body, pointer });
      validateDocumentProse(ctx, {
        doc,
        body,
        manifest,
        manifestPath,
        pointer,
        profileFacts,
      });
    }
  }

  validateCorpusRealismSkeletons(ctx, {
    bodyRecords,
    manifestPath,
  });

  const actualPaths = await listDocumentFiles(ctx, documentsRoot, manifestPath);
  for (const actualPath of actualPaths) {
    if (!listedPaths.has(actualPath)) {
      addIssue(ctx, {
        code: 'DOCUMENT_UNLISTED_FILE',
        file: path.join(documentsSourceRoot, actualPath),
        pointer: '',
        message: `Document file ${actualPath} is not listed in manifest.json.`,
        fix: 'Add the file to manifest.documents or remove it from documents/.',
      });
    }
  }
}

function getWorldValue(artifactWorld, ref) {
  return String(ref)
    .split('.')
    .reduce((value, segment) => {
      if (value == null || typeof value !== 'object') return undefined;
      return value[segment];
    }, artifactWorld);
}

function createCorpusTruthDocument(doc) {
  return {
    id: doc.id,
    path: doc.path,
    declaredFacts: {
      provenPresent: [],
      missing: [],
      unsupported: [],
    },
    forbiddenFacts: {
      provenAbsent: [],
      present: [],
      warningOnly: [],
      skipped: [],
      invalid: [],
    },
    withheldFacts: {
      provenAbsent: [],
      present: [],
      skipped: [],
    },
  };
}

function getEffectiveForbiddenEntries({
  manifest,
  doc,
  manifestPath,
  pointer,
}) {
  // Keep the effective key set aligned with shared.mjs while attaching
  // validator-specific provenance for error pointers.
  const effectiveKeys = new Set(effectiveForbiddenFactKeys(manifest, doc));
  const entries = [];
  const seen = new Set();

  function add({ factKey, file, pointer }) {
    if (!effectiveKeys.has(factKey) || seen.has(factKey)) return;
    seen.add(factKey);
    entries.push({ factKey, file, pointer });
  }

  for (const [index, factKey] of (
    manifest.factContractDefaults?.forbid ?? []
  ).entries()) {
    add({
      factKey,
      file: manifestPath,
      pointer: `/factContractDefaults/forbid/${index}`,
    });
  }

  for (const [index, factKey] of planDocumentForbiddenFactKeys(doc).entries()) {
    add({
      factKey,
      file: manifestPath,
      pointer: `${pointer}/factContract/forbid/${index}`,
    });
  }

  if (shouldDeriveMissingFactAsForbidden(doc)) {
    for (const [index, missing] of (
      manifest.intentionallyMissing ?? []
    ).entries()) {
      add({
        factKey: missing.factKey,
        file: manifestPath,
        pointer: `/intentionallyMissing/${index}/factKey`,
      });
    }
  }

  return entries;
}

function validateDocumentProse(ctx, {
  doc,
  body,
  manifest,
  manifestPath,
  pointer,
  profileFacts,
}) {
  validateDocumentBodyFormat(ctx, { doc, body, manifestPath, pointer });

  const truth = createCorpusTruthDocument(doc);
  ctx.corpusTruth.documents.push(truth);
  const expectedUse = planDocumentExpectedUse(doc);
  const freshness = planDocumentFreshness(doc);
  const detailTier = planDocumentDetailTier(doc);
  const factKeys = planDocumentFactKeys(doc);
  const checksBodyForDeclaredFacts = ['extract', 'corroborate'].includes(
    expectedUse,
  );
  const effectiveForbiddenEntries = getEffectiveForbiddenEntries({
    manifest,
    doc,
    manifestPath,
    pointer,
  });
  const forbiddenFactKeys = new Set(
    effectiveForbiddenEntries.map((entry) => entry.factKey),
  );

  for (const [factIndex, factKey] of factKeys.entries()) {
    if (!checksBodyForDeclaredFacts || !isHighConfidenceFactKey(factKey)) {
      truth.declaredFacts.unsupported.push(factKey);
      continue;
    }

    const factState = classifyFactKey(profileFacts, factKey);
    if (factState.kind !== 'leaf' || factState.value == null) continue;
    if (
      textContainsDeclaredFactValue(body, factKey, factState.value) ||
      (factKey === 'identity.legalName' &&
        textContainsSplitLegalName(body, profileFacts))
    ) {
      truth.declaredFacts.provenPresent.push(factKey);
      continue;
    }

    truth.declaredFacts.missing.push(factKey);
    addIssue(ctx, {
      code: 'DOCUMENT_FACT_VALUE_MISSING',
      file: manifestPath,
      pointer: `${pointer}/factContract/include/${factIndex}`,
      message: `Document ${doc.id} declares ${factKey}, but a deterministic value variant was not found in the document body.`,
      fix: 'Add the declared fact value to the document body or remove the factContract include path.',
    });
  }

  for (const entry of effectiveForbiddenEntries) {
    const factState = classifyFactKey(profileFacts, entry.factKey);
    if (factState.kind !== 'leaf') {
      truth.forbiddenFacts.invalid.push(entry.factKey);
      continue;
    }

    if (factState.value == null) {
      if (isMissingFactPatternCheckEligible(doc, entry.factKey)) {
        truth.forbiddenFacts.warningOnly.push(entry.factKey);
      } else {
        truth.forbiddenFacts.skipped.push(entry.factKey);
      }
      continue;
    }

    if (textContainsFactValue(body, entry.factKey, factState.value)) {
      truth.forbiddenFacts.present.push(entry.factKey);
      addIssue(ctx, {
        code: 'DOCUMENT_FORBIDDEN_FACT_PRESENT',
        file: entry.file,
        pointer: entry.pointer,
        message: `Document ${doc.id} contains a value for forbidden fact ${entry.factKey}.`,
        fix: 'Remove the forbidden value from the document body or remove the fact from the effective forbidden contract.',
      });
      continue;
    }

    truth.forbiddenFacts.provenAbsent.push(entry.factKey);
  }

  for (const [missingIndex, missing] of (
    manifest.intentionallyMissing ?? []
  ).entries()) {
    if (missing.withheldValue == null) continue;
    if (!(checksBodyForDeclaredFacts && freshness === 'current')) {
      truth.withheldFacts.skipped.push(missing.factKey);
      continue;
    }
    if (textContainsFactValue(body, missing.factKey, missing.withheldValue)) {
      truth.withheldFacts.present.push(missing.factKey);
      addIssue(ctx, {
        code: 'DOCUMENT_WITHHELD_FACT_PRESENT',
        file: manifestPath,
        pointer: `/intentionallyMissing/${missingIndex}/withheldValue`,
        message: `Document ${doc.id} contains the concrete withheld value for intentionally missing fact ${missing.factKey}.`,
        fix: 'Remove the withheld value from document bodies or remove the intentionallyMissing withheldValue contract.',
      });
      continue;
    }
    truth.withheldFacts.provenAbsent.push(missing.factKey);
  }

  validateNoiseFactLeaks(ctx, {
    doc,
    body,
    manifestPath,
    pointer,
    profileFacts,
    skippedFactKeys: forbiddenFactKeys,
  });

  for (const missing of manifest.intentionallyMissing ?? []) {
    if (!checksForMissingFactPattern(doc, missing.factKey, body)) continue;
    addIssue(ctx, {
      level: 'warning',
      code: 'DOCUMENT_MISSING_FACT_PRESENT',
      file: manifestPath,
      pointer,
      message: `Document ${doc.id} may contain value-like text even though ${missing.factKey} is intentionally missing.`,
      fix: 'Remove the value-like text or mark the document stale, mixed, guardrail, or third-party if appropriate.',
    });
  }

  validateUndeclaredI9TargetFields(ctx, {
    doc,
    body,
    manifestPath,
    pointer,
    declaredFactKeys: new Set(factKeys),
    expectedUse,
    freshness,
  });

  const nonWhitespaceLength = body.replace(/\s/g, '').length;
  const minimumByTier = { hero: 120, medium: 60, brief: 20 };
  if (nonWhitespaceLength < minimumByTier[detailTier]) {
    addIssue(ctx, {
      level: 'warning',
      code: 'DOCUMENT_THIN',
      file: manifestPath,
      pointer,
      message: `Document ${doc.id} is short for detailTier ${detailTier}.`,
      fix: 'Add realistic surrounding text or lower the detailTier.',
    });
  }

  validateSourceRealism(ctx, {
    doc,
    body,
    manifest,
    manifestPath,
    pointer,
    freshness,
    expectedUse,
  });
}

function validateSourceRealism(ctx, {
  doc,
  body,
  manifest,
  manifestPath,
  pointer,
  freshness,
  expectedUse,
}) {
  const sourceSpec = doc.sourceSpec;
  if (!sourceSpec) return;
  const sourceSpecPointer = `${pointer}/sourceSpec`;

  if (EVAL_LANGUAGE_RE.test(body)) {
    addIssue(ctx, {
      level: 'warning',
      code: 'DOCUMENT_EVAL_LANGUAGE',
      file: manifestPath,
      pointer,
      message: `Document ${doc.id} contains evaluation-oriented language in the body.`,
      fix: 'Rewrite the body as a native source artifact without meta commentary.',
    });
  }

  for (const [signalIndex, signal] of (sourceSpec.nativeSignals ?? []).entries()) {
    if (nativeSignalPresent(body, signal)) continue;
    addIssue(ctx, {
      level: 'warning',
      code: 'DOCUMENT_NATIVE_SIGNAL_MISSING',
      file: manifestPath,
      pointer: `${sourceSpecPointer}/nativeSignals/${signalIndex}`,
      message: `Document ${doc.id} is missing native source signal ${JSON.stringify(signal)}.`,
      fix: 'Add the native signal in a way that matches the artifact source and format.',
    });
  }

  const lengthTarget = sourceSpec.lengthTarget;
  if (
    lengthTarget &&
    (body.length < lengthTarget.minChars || body.length > lengthTarget.maxChars)
  ) {
    addIssue(ctx, {
      level: 'warning',
      code: 'DOCUMENT_SOURCE_LENGTH_OUT_OF_RANGE',
      file: manifestPath,
      pointer: `${sourceSpecPointer}/lengthTarget`,
      message: `Document ${doc.id} length ${body.length} is outside sourceSpec target ${lengthTarget.minChars}-${lengthTarget.maxChars}.`,
      fix: 'Adjust body density or sourceSpec.lengthTarget.',
    });
  }

  if (
    (freshness === 'stale' ||
      expectedUse === 'guardrail' ||
      doc.category === 'partial-conflicting') &&
    !STALE_CUE_RE.test(body)
  ) {
    addIssue(ctx, {
      level: 'warning',
      code: 'DOCUMENT_STALE_CUE_MISSING',
      file: manifestPath,
      pointer,
      message: `Document ${doc.id} is stale or guardrail material but lacks a clear stale cue.`,
      fix: 'Add wording that marks the information stale, superseded, inactive, returned, or not for current use.',
    });
  }

  if (
    (manifest.intentionallyMissing ?? []).some(
      (missing) => missing.factKey === 'contact.phone',
    ) &&
    containsPhoneLikeText(body)
  ) {
    addIssue(ctx, {
      level: 'warning',
      code: 'DOCUMENT_SOURCE_PHONE_PRESENT',
      file: manifestPath,
      pointer,
      message: `Document ${doc.id} contains phone-like text while contact.phone is intentionally missing.`,
      fix: 'Redact source phone values or add source-fact ownership metadata before using them.',
    });
  }
}

function nativeSignalPresent(body, signal) {
  const normalized = normalizeTextForRealism(body);
  const signalText = normalizeTextForRealism(signal);
  const hasNormalizedTerm = (term) =>
    normalized.includes(normalizeTextForRealism(term));
  if (signalText.includes('from header')) return /^from\s*:/im.test(body);
  if (signalText.includes('to header')) return /^to\s*:/im.test(body);
  if (signalText.includes('date header')) return /^date\s*:/im.test(body);
  if (signalText.includes('subject header')) return /^subject\s*:/im.test(body);
  if (signalText.includes('resident profile block')) {
    return hasNormalizedTerm('resident profile') ||
      hasNormalizedTerm('resident occupant details') ||
      hasNormalizedTerm('resident and occupant details') ||
      hasNormalizedTerm('resident details') ||
      hasNormalizedTerm('primary resident');
  }
  if (signalText.includes('stale') && signalText.includes('superseded')) {
    return STALE_CUE_RE.test(body);
  }
  if (signalText.includes('document category')) {
    return hasNormalizedTerm('document category') ||
      hasNormalizedTerm('document type') ||
      hasNormalizedTerm('document set');
  }
  if (signalText.includes('reviewer note')) {
    return hasNormalizedTerm('reviewer note') ||
      hasNormalizedTerm('reviewer assigned') ||
      hasNormalizedTerm('assigned reviewer') ||
      hasNormalizedTerm('assigned to');
  }
  if (signalText.includes('source system')) {
    return hasNormalizedTerm('source system') ||
      /^\s*(?:source[_ -]?system|system)\s*:/im.test(body);
  }
  if (signalText.includes('footer')) return hasNormalizedTerm('unsubscribe') ||
    hasNormalizedTerm('privacy') ||
    hasNormalizedTerm('footer') ||
    hasNormalizedTerm('all rights reserved');
  if (signalText.includes('ocr confidence')) return hasNormalizedTerm('ocr') &&
    hasNormalizedTerm('confidence');
  if (signalText.includes('upload batch')) return hasNormalizedTerm('upload batch') ||
    hasNormalizedTerm('batch id') ||
    hasNormalizedTerm('batch');
  if (signalText.includes('filename') || signalText.includes('source filename')) {
    return hasNormalizedTerm('filename') ||
      hasNormalizedTerm('file name') ||
      hasNormalizedTerm('source file') ||
      hasNormalizedTerm('original filename');
  }
  if (signalText.includes('timestamp')) return hasNormalizedTerm('timestamp') ||
    hasNormalizedTerm('generated') ||
    hasNormalizedTerm('exported') ||
    hasNormalizedTerm('saved') ||
    hasNormalizedTerm('received') ||
    hasNormalizedTerm('updated') ||
    hasNormalizedTerm('created');
  if (signalText.includes('status')) return hasNormalizedTerm('status');
  if (signalText.includes('field ids')) return hasNormalizedTerm('field id') ||
    hasNormalizedTerm('field ids') ||
    hasNormalizedTerm('fields') ||
    hasNormalizedTerm('field');
  if (signalText.includes('worker id')) return hasNormalizedTerm('worker id');
  if (signalText.includes('ticket id')) return hasNormalizedTerm('ticket id');
  if (signalText.includes('export id')) return hasNormalizedTerm('export id');
  if (signalText.includes('blank phone') || signalText.includes('phone state')) {
    return hasNormalizedTerm('phone null') ||
      hasNormalizedTerm('phone blank') ||
      hasNormalizedTerm('phone field blank') ||
      hasNormalizedTerm('phone field state blank') ||
      hasNormalizedTerm('telephone number null') ||
      hasNormalizedTerm('telephone number blank') ||
      /^\s*(?:[a-z0-9_.-]*_)?(?:phone|telephone)(?:[_ -]?(?:number|field))?\s*:\s*(?:null|["']{2})\s*$/im.test(body);
  }
  if (signalText.includes('signature block')) {
    return /\n(?:sincerely|regards|best|thanks|thank you),?\s*\n[A-Z][A-Za-z .'-]+/i.test(body);
  }

  const terms = signalText
    .split(' ')
    .filter((term) => term.length > 2 && !['the', 'and'].includes(term));
  return terms.every((term) => normalized.includes(term));
}

function normalizeTextForRealism(value) {
  return String(value)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function validateCorpusRealismSkeletons(ctx, { bodyRecords, manifestPath }) {
  const sourceRecords = bodyRecords.filter((record) => record.doc?.sourceSpec);
  const titleFirstLineRecords = sourceRecords.filter(({ doc, body }) => {
    const firstLine = body.split(/\r?\n/).find((line) => line.trim());
    return firstLine && normalizeTextForRealism(firstLine).includes(normalizeTextForRealism(doc.title));
  });
  if (titleFirstLineRecords.length >= 3) {
    addIssue(ctx, {
      level: 'warning',
      code: 'DOCUMENT_TITLE_FIRST_LINE_REPEATED',
      file: manifestPath,
      pointer: '/documents',
      message: `${titleFirstLineRecords.length} source-artifact documents start with their manifest title.`,
      fix: 'Use native headers, envelopes, or export records instead of repeating the manifest title as the first line.',
    });
  }

  const markdownSkeletons = sourceRecords.filter(({ body }) => {
    const boldLabels = body.match(/\*\*[^*\n]+:\*\*/g) ?? [];
    const markdownHeadings = body.match(/(^|\n)\s{0,3}#{1,3}\s+\S/g) ?? [];
    return boldLabels.length >= 4 || markdownHeadings.length >= 2;
  });
  if (markdownSkeletons.length >= 3) {
    addIssue(ctx, {
      level: 'warning',
      code: 'DOCUMENT_MARKDOWN_PATTERN_OVERUSED',
      file: manifestPath,
      pointer: '/documents',
      message: `${markdownSkeletons.length} source-artifact documents use similar Markdown heading or bold-label skeletons.`,
      fix: 'Vary source formats and prefer native email, export, OCR, ticket, or portal structures.',
    });
  }
}

function validateDocumentBodyFormat(ctx, { doc, body, manifestPath, pointer }) {
  const extension = path.posix.extname(doc.path ?? '').slice(1);

  if (['json', 'yaml'].includes(extension) && /^\s*```/.test(body)) {
    addIssue(ctx, {
      code: 'DOCUMENT_MARKDOWN_FENCE',
      file: manifestPath,
      pointer,
      message: `Document ${doc.id} is a .${extension} file but appears to be wrapped in a Markdown code fence.`,
      fix: 'Remove Markdown fences from structured document bodies.',
    });
  }

  if (extension === 'json') {
    try {
      JSON.parse(body);
    } catch (error) {
      addIssue(ctx, {
        code: 'DOCUMENT_JSON_INVALID',
        file: manifestPath,
        pointer,
        message: `Document ${doc.id} is a .json file but does not contain valid JSON: ${error.message}`,
        fix: 'Write valid JSON or change the planned file extension.',
      });
    }
  }

  if (extension === 'yaml') {
    try {
      parseYaml(body);
    } catch (error) {
      addIssue(ctx, {
        code: 'DOCUMENT_YAML_INVALID',
        file: manifestPath,
        pointer,
        message: `Document ${doc.id} is a .yaml file but does not contain valid YAML: ${error.message}`,
        fix: 'Write valid YAML or change the planned file extension.',
      });
    }
  }

  if (extension === 'txt' && looksLikeMarkdown(body)) {
    addIssue(ctx, {
      level: 'warning',
      code: 'DOCUMENT_TXT_MARKDOWN_STYLE',
      file: manifestPath,
      pointer,
      message: `Document ${doc.id} is a .txt file but contains Markdown-like formatting.`,
      fix: 'Use plain text formatting or change the planned file extension.',
    });
  }
}

function looksLikeMarkdown(text) {
  return /(^|\n)\s{0,3}#{1,6}\s+\S/.test(text) ||
    /(^|\n)\s*```/.test(text) ||
    /(^|\n)\s*\|.+\|\s*(\n|$)/.test(text);
}

const PHONE_LIKE_TEXT_RE =
  /(^|[^\d])(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}(?=$|[^\d])/;
const EVAL_LANGUAGE_RE =
  /\b(?:synthetic eval fixture|fact key|validator|benchmark|profile slice|fixture document|if a task asks|leave (?:the )?.*field empty|enter(?:ing)? a placeholder|downstream task)\b/i;
const I9_IDENTIFIER_CONTEXT_RE =
  /(^|[^a-z0-9])(?:i[-_\s]?94|uscis|alien[-_\s]?registration|a[-_\s]?number|foreign[-_\s]?passport|passport[-_\s]?number|admission[-_\s]?number)(?=$|[^a-z0-9])/i;
const STALE_CUE_RE =
  /\b(?:stale|superseded|former|old|inactive|returned|do not use|do-not-use|outdated)\b/i;
const PHONE_CONTACT_CONTEXT_RE =
  /\b(?:phone|telephone|mobile|cell|fax|callback|call back|sms|text)\b/i;
const SOURCE_IDENTIFIER_CONTEXT_RE =
  /\b(?:account number|account no|account id|account data|agreement id|service agreement|export id|case id|task id|transaction id|license number|document id|worker id)\b/i;

function containsPhoneLikeText(text) {
  const candidateLines = [];
  let skipNextIdentifierLine = false;
  for (const line of String(text).split(/\r?\n/)) {
    if (I9_IDENTIFIER_CONTEXT_RE.test(line)) {
      skipNextIdentifierLine = true;
      continue;
    }
    if (skipNextIdentifierLine && isIdentifierContinuationLine(line)) {
      skipNextIdentifierLine = false;
      continue;
    }
    if (isNonPhoneIdentifierLine(line)) {
      skipNextIdentifierLine = false;
      continue;
    }
    skipNextIdentifierLine = false;
    candidateLines.push(line);
  }
  const phoneCandidateText = candidateLines.join('\n');
  return PHONE_LIKE_TEXT_RE.test(phoneCandidateText);
}

function isIdentifierContinuationLine(line) {
  const compact = String(line)
    .trim()
    .replace(/^[-*]\s+/, '')
    .replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '')
    .replace(/\s+/g, '');
  return (
    compact.length >= 6 &&
    compact.length <= 20 &&
    /[0-9]/.test(compact) &&
    /^[A-Z0-9-]+$/i.test(compact)
  );
}

function isNonPhoneIdentifierLine(line) {
  const normalized = normalizeTextForRealism(line);
  return (
    SOURCE_IDENTIFIER_CONTEXT_RE.test(normalized) &&
    !PHONE_CONTACT_CONTEXT_RE.test(normalized)
  );
}

function hasMissingFactPatternRule(factKey) {
  return factKey === 'contact.phone' || WORK_AUTH_MISSING_PATTERN_KEYS.has(factKey);
}

function isMissingFactPatternCheckEligible(doc, factKey) {
  return (
    hasMissingFactPatternRule(factKey) &&
    ['extract', 'corroborate'].includes(planDocumentExpectedUse(doc)) &&
    !['stale', 'mixed'].includes(planDocumentFreshness(doc))
  );
}

function checksForMissingFactPattern(doc, factKey, body) {
  if (!isMissingFactPatternCheckEligible(doc, factKey)) return false;
  if (factKey === 'contact.phone') return containsPhoneLikeText(body);
  if (WORK_AUTH_MISSING_PATTERN_KEYS.has(factKey)) {
    return containsMissingWorkAuthIdentifierLikeText(body, factKey);
  }
  return false;
}

function validateUndeclaredI9TargetFields(ctx, {
  doc,
  body,
  manifestPath,
  pointer,
  declaredFactKeys,
  expectedUse,
  freshness,
}) {
  if (!['extract', 'corroborate'].includes(expectedUse)) return;
  if (['stale', 'mixed'].includes(freshness)) return;

  for (const factKey of [
    'workAuthorization.uscisANumber',
    'workAuthorization.workAuthorizationExpirationDate',
    'workAuthorization.i94AdmissionNumber',
    'workAuthorization.foreignPassportNumber',
  ]) {
    if (declaredFactKeys.has(factKey)) continue;
    if (!containsWorkAuthTargetLikeText(body, factKey)) continue;
    addIssue(ctx, {
      level: 'warning',
      code: 'DOCUMENT_UNDECLARED_I9_TARGET_FIELD_PRESENT',
      file: manifestPath,
      pointer,
      message: `Document ${doc.id} contains I-9-like text for undeclared target field ${factKey}.`,
      fix: 'Remove the undeclared target value or add the fact to factContract.include if this source should carry it.',
    });
  }
}

function containsWorkAuthTargetLikeText(text, factKey) {
  const normalized = normalizeTextForRealism(text);
  if (factKey === 'workAuthorization.uscisANumber') {
    return /\b(?:uscis|alien registration|a number)\b.{0,80}\ba?\s?\d{7,9}\b/.test(normalized);
  }
  if (factKey === 'workAuthorization.workAuthorizationExpirationDate') {
    return /\b(?:work authorization|employment authorization|authorization|ead)\b.{0,90}\b(?:expiration|expires|expiry|valid until)\b.{0,90}\b(?:\d{4}\s\d{2}\s\d{2}|\d{1,2}\s\d{1,2}\s\d{4}|(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}\s+\d{4})\b/.test(normalized);
  }
  if (factKey === 'workAuthorization.i94AdmissionNumber') {
    return /\bi\s?94\b.{0,80}\b(?=[a-z0-9]*\d)[a-z0-9]{7,11}\b/.test(normalized);
  }
  if (factKey === 'workAuthorization.foreignPassportNumber') {
    return /\b(?:foreign passport|passport number|passport no)\b.{0,80}\b(?=[a-z0-9]*\d)[a-z0-9]{6,12}\b/.test(normalized);
  }
  return false;
}

function containsMissingWorkAuthIdentifierLikeText(text, factKey) {
  if (factKey === 'workAuthorization.uscisANumber') {
    return /\bA[-\s]?\d{7,9}\b/i.test(text);
  }
  if (factKey === 'workAuthorization.i94AdmissionNumber') {
    return /\bI[-\s]?94\b[^\n]{0,60}\b(?=[A-Z0-9]*\d)[A-Z0-9]{7,11}\b/i.test(text);
  }
  if (factKey === 'workAuthorization.foreignPassportNumber') {
    return /\b(?:foreign\s+passport|passport\s+(?:number|no\.?))\b[^\n]{0,60}\b(?=[A-Z0-9]*\d)[A-Z0-9]{6,12}\b/i.test(text);
  }
  return false;
}

function validateNoiseFactLeaks(ctx, {
  doc,
  body,
  manifestPath,
  pointer,
  profileFacts,
  skippedFactKeys = new Set(),
}) {
  if (doc.category !== 'noise' && planDocumentExpectedUse(doc) !== 'ignore') return;

  for (const factKey of NOISE_LEAK_FACT_KEYS) {
    if (skippedFactKeys.has(factKey)) continue;
    const factState = classifyFactKey(profileFacts, factKey);
    if (factState.kind !== 'leaf' || factState.value == null) continue;
    if (!textContainsFactValue(body, factKey, factState.value)) continue;
    addIssue(ctx, {
      code: 'DOCUMENT_NOISE_FACT_LEAK',
      file: manifestPath,
      pointer,
      message: `Document ${doc.id} is ignored/noise but contains current identifier ${factKey}.`,
      fix: 'Remove current user facts from ignored/noise documents or reclassify the document.',
    });
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
      if (isConditionalField(field)) {
        const conditionState = classifyFactKey(profileFacts, field.when.factKey);
        if (conditionState.kind !== 'leaf') {
          addIssue(ctx, {
            code:
              conditionState.kind === 'area'
                ? 'FIELD_MAP_CONDITION_FACT_AREA'
                : 'FIELD_MAP_CONDITION_FACT_MISSING',
            file: fieldMapPath,
            pointer: `/fields/${index}/when/factKey`,
            message: `Field map condition factKey ${field.when.factKey} does not resolve to a profile leaf fact.`,
            fix: 'Point when.factKey at a concrete profile fact leaf.',
          });
        }
      }
    }
    validateI9CitizenshipCheckboxGroup(ctx, formId, fieldMap, fieldMapPath, profileFacts);
  }

  return { generated, fieldMap };
}

const I9_CITIZENSHIP_FACT_KEY = 'workAuthorization.citizenshipStatus';
const I9_CITIZENSHIP_CHECKBOX_NAMES = new Set(['CB_1', 'CB_2', 'CB_3', 'CB_4']);

function validateI9CitizenshipCheckboxGroup(ctx, formId, fieldMap, fieldMapPath, profileFacts) {
  if (formId !== 'i-9') return;

  const factState = classifyFactKey(profileFacts, I9_CITIZENSHIP_FACT_KEY);
  if (factState.kind !== 'leaf' || factState.value == null) return;

  const facts = profileFactsToObject(profileFacts);
  const entries = (fieldMap.fields ?? [])
    .map((field, index) => ({ field, index }))
    .filter(({ field }) => I9_CITIZENSHIP_CHECKBOX_NAMES.has(field.pdfFieldName));
  if (entries.length === 0) return;

  const conditionEntries = entries.filter(
    ({ field }) =>
      field.mode === 'fact' &&
      field.factKey === I9_CITIZENSHIP_FACT_KEY &&
      isConditionalField(field) &&
      field.when.factKey === I9_CITIZENSHIP_FACT_KEY,
  );
  const active = conditionEntries.filter(({ field }) => fieldIsActive(field, facts));
  if (active.length === 1) return;

  addIssue(ctx, {
    code:
      active.length === 0
        ? 'FIELD_MAP_CONDITION_NO_MATCH'
        : 'FIELD_MAP_CONDITION_MULTIPLE_MATCHES',
    file: fieldMapPath,
    pointer: `/fields/${entries[0].index}/when/equals`,
    message:
      active.length === 0
        ? `I-9 citizenship checkbox group has no active field for ${I9_CITIZENSHIP_FACT_KEY} value ${JSON.stringify(factState.value)}.`
        : `I-9 citizenship checkbox group has ${active.length} active fields for ${I9_CITIZENSHIP_FACT_KEY} value ${JSON.stringify(factState.value)}.`,
    fix: 'Update the profile value or the I-9 CB_1 through CB_4 when.equals branches so exactly one citizenship checkbox is active.',
  });
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
    '',
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

  const formValidatedThroughCorpus = Boolean(
    transitiveResult?.formMaps?.has(scenario.formId),
  );
  if (isFixtureId(scenario.formId) && !formValidatedThroughCorpus) {
    await validateForm(ctx, scenario.formId, { requireFieldMap: true });
  }

  if (ctx.options.skipExpectedSnapshots) {
    return scenario;
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
      continue;
    }

    if (snapshot === 'filled-form') {
      validateSchema(ctx, 'filledFormSnapshot', parsed, snapshotPath);
    }
  }

  return scenario;
}

function validateIntentionallyMissing(ctx, manifest, manifestPath, profileFacts, formMaps) {
  for (const [index, missing] of (manifest.intentionallyMissing ?? []).entries()) {
    const pointer = `/intentionallyMissing/${index}`;
    if (profileFacts) {
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
        (field) =>
          field.mode === 'fact' &&
          field.factKey === missing.factKey &&
          fieldIsActive(field, profileFactsToObject(profileFacts)),
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

    for (const [docIndex, doc] of (manifest.documents ?? []).entries()) {
      if (planDocumentFactKeys(doc).includes(missing.factKey)) {
        addIssue(ctx, {
          code: 'MISSING_FACT_DECLARED_BY_DOCUMENT',
          file: manifestPath,
          pointer: `/documents/${docIndex}/factContract/include`,
          message: `Intentionally missing factKey ${missing.factKey} must not appear in document factContract.include[].`,
          fix: 'Remove the include path from documents or remove the intentionallyMissing entry.',
        });
      }
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
    (manifest.documents ?? []).flatMap((doc) => planDocumentFactKeys(doc)),
  );

  for (const [formIndex, formId] of (manifest.forms ?? []).entries()) {
    const fieldMap = formMaps.get(formId);
    if (!fieldMap) continue;
    for (const [index, field] of (fieldMap.fields ?? []).entries()) {
      if (field.mode !== 'fact') continue;
      if (!fieldIsActive(field, profile.facts ?? {})) continue;
      const factState = classifyFactKey(profileFacts, field.factKey);
      if (factState.kind !== 'leaf' || factState.value == null) continue;
      if (seedCovered.has(field.factKey) || documentCovered.has(field.factKey)) {
        continue;
      }
      addIssue(ctx, {
        code: 'FIELD_FACT_UNCOVERED',
        file: manifestPath,
        pointer: `/forms/${formIndex}`,
        message: `Form ${formId} field ${field.fieldIndex} (${field.pdfFieldName}) maps to ${field.factKey}, but no seed preference or document factContract.include[] covers it.`,
        fix: `Add ${field.factKey} to a document factContract.include[] entry or seedPreferences[].`,
      });
    }
  }
}

function profileFactsToObject(profileFacts) {
  const facts = {};
  for (const [factKey, value] of profileFacts?.leaves ?? []) {
    setObjectPath(facts, factKey, value);
  }
  return facts;
}

function setObjectPath(target, factKey, value) {
  const segments = factKey.split('.');
  let current = target;
  for (const segment of segments.slice(0, -1)) {
    current[segment] ??= {};
    current = current[segment];
  }
  current[segments.at(-1)] = value;
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
    templates: ctx.visited.templates.size,
    errors,
    warnings,
  };
}

function buildCorpusTruth(ctx) {
  const documents = ctx.corpusTruth.documents.map((doc) => ({
    id: doc.id,
    path: doc.path,
    declaredFacts: {
      provenPresent: [...doc.declaredFacts.provenPresent],
      missing: [...doc.declaredFacts.missing],
      unsupported: [...doc.declaredFacts.unsupported],
    },
    forbiddenFacts: {
      provenAbsent: [...doc.forbiddenFacts.provenAbsent],
      present: [...doc.forbiddenFacts.present],
      warningOnly: [...doc.forbiddenFacts.warningOnly],
      skipped: [...doc.forbiddenFacts.skipped],
      invalid: [...doc.forbiddenFacts.invalid],
    },
    withheldFacts: {
      provenAbsent: [...doc.withheldFacts.provenAbsent],
      present: [...doc.withheldFacts.present],
      skipped: [...doc.withheldFacts.skipped],
    },
  }));

  const unsupportedDeclaredFactKeys = countFactKeys(
    documents.flatMap((doc) => doc.declaredFacts.unsupported),
  );

  const summary = documents.reduce(
    (totals, doc) => {
      totals.factsProvenPresent += doc.declaredFacts.provenPresent.length;
      totals.factsMissing += doc.declaredFacts.missing.length;
      totals.unsupportedDeclaredFacts += doc.declaredFacts.unsupported.length;
      totals.factsProvenAbsent += doc.forbiddenFacts.provenAbsent.length;
      totals.forbiddenFactsPresent += doc.forbiddenFacts.present.length;
      totals.warningOnlyAbsenceChecks += doc.forbiddenFacts.warningOnly.length;
      totals.skippedAbsenceChecks += doc.forbiddenFacts.skipped.length;
      totals.invalidAbsenceChecks += doc.forbiddenFacts.invalid.length;
      totals.withheldValuesProvenAbsent += doc.withheldFacts.provenAbsent.length;
      totals.withheldValuesPresent += doc.withheldFacts.present.length;
      totals.withheldValuesSkipped += doc.withheldFacts.skipped.length;
      return totals;
    },
    {
      documentsChecked: documents.length,
      factsProvenPresent: 0,
      factsMissing: 0,
      unsupportedDeclaredFacts: 0,
      factsProvenAbsent: 0,
      forbiddenFactsPresent: 0,
      warningOnlyAbsenceChecks: 0,
      skippedAbsenceChecks: 0,
      invalidAbsenceChecks: 0,
      withheldValuesProvenAbsent: 0,
      withheldValuesPresent: 0,
      withheldValuesSkipped: 0,
      hardFailures: 0,
      unsupportedDeclaredFactKeys,
    },
  );
  summary.hardFailures =
    summary.factsMissing +
    summary.forbiddenFactsPresent +
    summary.withheldValuesPresent;

  return { summary, documents };
}

function countFactKeys(factKeys) {
  const counts = new Map();
  for (const factKey of factKeys) {
    counts.set(factKey, (counts.get(factKey) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([factKey, count]) => ({ factKey, count }));
}

function emptySummary() {
  return {
    profiles: 0,
    corpora: 0,
    forms: 0,
    scenarios: 0,
    templates: 0,
    errors: 0,
    warnings: 0,
  };
}

function repoRelative(ctx, absolutePath) {
  if (!absolutePath) return '';
  return toPosixPath(path.relative(ctx.repoRoot, absolutePath));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await runValidation({ args: process.argv.slice(2) });
  const output = formatResult(result);
  console.log(output);
  process.exitCode = result.exitCode;
}
