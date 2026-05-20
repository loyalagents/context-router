import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  classifyFactKey,
  hashInt,
  isPlainObject,
  toPosixPath,
} from './shared.mjs';

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export async function discoverTemplates({ evalRoot }) {
  const templatesRoot = path.join(evalRoot, 'templates');
  const files = await listTemplateFiles(templatesRoot);
  const templates = [];

  for (const filePath of files) {
    const module = await import(pathToFileURL(filePath).href);
    const expectedTemplateId = templateIdFromPath(templatesRoot, filePath);
    templates.push({
      filePath,
      expectedTemplateId,
      module,
      meta: module.meta,
      render: module.render,
    });
  }

  return templates.sort((left, right) =>
    left.expectedTemplateId < right.expectedTemplateId
      ? -1
      : left.expectedTemplateId > right.expectedTemplateId
        ? 1
        : 0,
  );
}

export async function listTemplateFiles(templatesRoot) {
  const files = [];

  async function walk(directory) {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }

    for (const entry of entries.sort((left, right) =>
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
    )) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(absolute);
      } else if (entry.isFile() && entry.name.endsWith('.mjs')) {
        files.push(absolute);
      }
    }
  }

  await walk(templatesRoot);
  return files.sort();
}

export function templateIdFromPath(templatesRoot, filePath) {
  const relative = toPosixPath(path.relative(templatesRoot, filePath));
  return relative.replace(/\.mjs$/, '');
}

export function renderTemplate({ template, profileFacts, seed }) {
  validateDeclaredFacts({ template, profileFacts });

  const first = renderOnce({ template, profileFacts, seed });
  const second = renderOnce({ template, profileFacts, seed });

  if (first.content !== second.content) {
    throw new Error(
      `Template ${template.meta.templateId} did not render byte-identically for the same seed.`,
    );
  }

  for (const factKey of template.meta.requiredFactKeys ?? []) {
    if (!first.accessedFacts.has(factKey)) {
      throw new Error(
        `Template ${template.meta.templateId} declares required fact ${factKey} but did not access it during render.`,
      );
    }
  }

  return {
    content: first.content,
    factKeys: [...first.manifestFactKeys].sort(),
  };
}

function validateDeclaredFacts({ template, profileFacts }) {
  const meta = template.meta;
  const requiredFacts = new Set(meta.requiredFactKeys ?? []);
  const declaredFacts = new Set([
    ...(meta.requiredFactKeys ?? []),
    ...(meta.optionalFactKeys ?? []),
  ]);

  for (const factKey of declaredFacts) {
    const factState = classifyFactKey(profileFacts, factKey);
    if (factState.kind === 'area') {
      throw new Error(`Template ${meta.templateId} fact ${factKey} is an area ref.`);
    }
    if (!requiredFacts.has(factKey)) continue;
    if (factState.kind === 'missing') {
      throw new Error(`Template ${meta.templateId} fact ${factKey} is missing.`);
    }
    if (factState.value == null) {
      throw new Error(`Template ${meta.templateId} fact ${factKey} is null.`);
    }
  }
}

function renderOnce({ template, profileFacts, seed }) {
  if (typeof template.render !== 'function') {
    throw new Error(`Template ${template.expectedTemplateId} must export render().`);
  }

  const meta = template.meta;
  const declaredFacts = new Set([
    ...(meta.requiredFactKeys ?? []),
    ...(meta.optionalFactKeys ?? []),
  ]);
  const requiredFacts = new Set(meta.requiredFactKeys ?? []);
  const accessedFacts = new Set();
  const manifestFactKeys = new Set();

  function readFact(factKey, { optional, allowArray }) {
    if (!declaredFacts.has(factKey)) {
      throw new Error(
        `Template ${meta.templateId} accessed undeclared fact ${factKey}.`,
      );
    }

    const factState = classifyFactKey(profileFacts, factKey);
    if (factState.kind === 'area') {
      throw new Error(`Template ${meta.templateId} fact ${factKey} is an area ref.`);
    }
    if (factState.kind === 'missing') {
      if (optional && !requiredFacts.has(factKey)) return undefined;
      throw new Error(`Template ${meta.templateId} fact ${factKey} is missing.`);
    }

    const value = factState.value;
    accessedFacts.add(factKey);
    if (value != null) manifestFactKeys.add(factKey);

    if (value == null) {
      if (optional && !requiredFacts.has(factKey)) return undefined;
      throw new Error(`Template ${meta.templateId} fact ${factKey} is null.`);
    }
    if (isPlainObject(value)) {
      throw new Error(`Template ${meta.templateId} fact ${factKey} is an object.`);
    }
    if (Array.isArray(value) && !allowArray) {
      throw new Error(
        `Template ${meta.templateId} fact ${factKey} is an array; use joinFact().`,
      );
    }
    if (!Array.isArray(value) && allowArray) {
      throw new Error(`Template ${meta.templateId} fact ${factKey} is not an array.`);
    }

    return value;
  }

  const helpers = {
    fact(factKey) {
      return String(readFact(factKey, { optional: false, allowArray: false }));
    },
    maybeFact(factKey, formatter) {
      const value = readFact(factKey, { optional: true, allowArray: false });
      if (value == null) return '';
      if (formatter) return formatter(value);
      return String(value);
    },
    joinFact(factKey, separator) {
      const value = readFact(factKey, { optional: false, allowArray: true });
      return value.map((item) => String(item)).join(separator);
    },
    dateFact(factKey, format) {
      const value = readFact(factKey, { optional: false, allowArray: false });
      if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        throw new Error(
          `Template ${meta.templateId} fact ${factKey} must be an ISO date string.`,
        );
      }
      return formatDate(value, format);
    },
    choose(key, values) {
      if (
        typeof key !== 'string' ||
        !Array.isArray(values) ||
        values.length === 0 ||
        values.some((value) => typeof value !== 'string')
      ) {
        throw new Error(
          `Template ${meta.templateId} choose() requires a string key and non-empty string array.`,
        );
      }
      return values[hashInt(seed, meta.templateId, key) % values.length];
    },
  };

  const content = template.render(helpers);
  if (typeof content !== 'string') {
    throw new Error(`Template ${meta.templateId} render() must return a string.`);
  }

  return { content, accessedFacts, manifestFactKeys };
}

function formatDate(value, format) {
  const [year, month, day] = value.split('-');
  if (format === 'iso') return value;
  if (format === 'us') return `${month}/${day}/${year}`;
  if (format === 'long') {
    return `${MONTH_NAMES[Number(month) - 1]} ${Number(day)}, ${year}`;
  }
  throw new Error(`Unsupported date format ${format}.`);
}
