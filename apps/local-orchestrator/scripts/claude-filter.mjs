#!/usr/bin/env node

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
  const schema = JSON.stringify(buildProviderSchema(request));
  const prompt = buildPrompt(request);

  const args = [
    '-p',
    '--bare',
    '--no-session-persistence',
    '--tools',
    '',
    '--json-schema',
    schema,
  ];

  if (options.model) {
    args.push('--model', options.model);
  }

  const output = await runProviderCommand('claude', args, prompt);
  const parsed = parseProviderJson(output, 'Claude');
  const validated = validateProviderResponse(request, parsed);

  writeWrapperResponse({
    promptVersion: buildPromptVersion('claude-filter', request.stage),
    ...validated,
  });
}

main().catch((error) => {
  fail(
    `Claude filter failed: ${error instanceof Error ? error.message : 'unknown error'}`,
  );
});
