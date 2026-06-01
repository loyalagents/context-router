import Ajv2020 from 'ajv/dist/2020.js';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { jsonText } from '../shared.mjs';

export async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

export async function readYaml(filePath) {
  return parseYaml(await readFile(filePath, 'utf8'));
}

export async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, jsonText(value));
}

export async function loadSchema(repoRoot, schemaFile) {
  return readJson(path.join(repoRoot, 'examples/eval/schemas', schemaFile));
}

export async function validateWithSchema(repoRoot, schemaFile, value, label) {
  const schema = await loadSchema(repoRoot, schemaFile);
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const validate = ajv.compile(schema);
  if (validate(value)) return;
  const details = validate.errors
    .map((error) => `${error.instancePath || '/'} ${error.message}`)
    .join('; ');
  throw new Error(`${label} failed ${schemaFile}: ${details}`);
}

export function relativePath(repoRoot, filePath) {
  return path.relative(repoRoot, filePath).split(path.sep).join('/');
}
