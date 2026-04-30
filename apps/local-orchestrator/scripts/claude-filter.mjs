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
    '--no-session-persistence',
    '--tools',
    '',
    '--disable-slash-commands',
    '--strict-mcp-config',
    '--mcp-config',
    '{"mcpServers":{}}',
    '--output-format',
    'json',
    '--json-schema',
    schema,
  ];

  if (options.model) {
    args.push('--model', options.model);
  }

  const output = await runProviderCommand('claude', args, prompt);
  const parsed = normalizeClaudeResponse(output);
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

function normalizeClaudeResponse(output) {
  const candidate = parseProviderJson(output, 'Claude');

  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw new Error('Claude returned an invalid JSON response');
  }

  if ('decision' in candidate || 'decisions' in candidate) {
    return candidate;
  }

  if (
    'structured_output' in candidate &&
    candidate.structured_output &&
    typeof candidate.structured_output === 'object' &&
    !Array.isArray(candidate.structured_output)
  ) {
    return candidate.structured_output;
  }

  if (candidate.is_error) {
    throw new Error(
      typeof candidate.result === 'string' && candidate.result.length > 0
        ? candidate.result
        : 'Claude returned an error result',
    );
  }

  if (typeof candidate.result === 'string' && candidate.result.trim().length > 0) {
    return parseProviderJson(candidate.result, 'Claude');
  }

  if (candidate.result && typeof candidate.result === 'object' && !Array.isArray(candidate.result)) {
    return candidate.result;
  }

  if (candidate.subtype === 'error_max_structured_output_retries') {
    throw new Error('Claude could not produce valid structured output');
  }

  throw new Error('Claude returned an unsupported JSON response shape');
}
