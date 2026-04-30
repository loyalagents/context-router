#!/usr/bin/env node

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  buildPrompt,
  buildPromptVersion,
  buildProviderSchema,
  fail,
  parseProviderJson,
  parseWrapperArgs,
  readRequestFromStdin,
  runProviderCommand,
  validateProviderResponse,
  writeWrapperResponse,
} from './filter-common.mjs';

async function main() {
  const options = parseWrapperArgs(process.argv.slice(2));
  const request = await readRequestFromStdin();
  const prompt = buildPrompt(request);

  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-filter-'));
  const schemaPath = path.join(tempRoot, 'schema.json');
  const outputPath = path.join(tempRoot, 'response.json');

  try {
    await writeFile(
      schemaPath,
      `${JSON.stringify(buildProviderSchema(request), null, 2)}\n`,
      'utf8',
    );

    const args = [
      'exec',
      '--sandbox',
      'read-only',
      '--color',
      'never',
      '--ephemeral',
      '--output-schema',
      schemaPath,
      '-o',
      outputPath,
      '-',
    ];

    if (options.model) {
      args.splice(args.length - 1, 0, '--model', options.model);
    }

    await runProviderCommand('codex', args, prompt);
    const output = await readFile(outputPath, 'utf8');
    const parsed = parseProviderJson(output, 'Codex');
    const validated = validateProviderResponse(request, parsed);

    writeWrapperResponse({
      promptVersion: buildPromptVersion('codex-filter', request.stage),
      ...validated,
    });
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  fail(
    `Codex filter failed: ${error instanceof Error ? error.message : 'unknown error'}`,
  );
});
