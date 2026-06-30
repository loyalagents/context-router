#!/usr/bin/env node

import { fileURLToPath } from 'node:url';
import {
  formatDirectOpenSchemaPacketResult,
  runDirectOpenSchemaPacket,
} from './direct-open-schema-packet.mjs';

export async function runClaudeCodeDirectPacket(options = {}) {
  let args;
  try {
    args = withClaudeCodeProvider(options.args ?? []);
  } catch (error) {
    return {
      exitCode: 2,
      lines: [error?.message ?? String(error), '', usage()],
    };
  }
  return runDirectOpenSchemaPacket({
    ...options,
    args,
  });
}

export function withClaudeCodeProvider(args) {
  const providerIndex = args.indexOf('--provider');
  if (providerIndex !== -1) {
    const provider = args[providerIndex + 1];
    if (provider !== 'claude-code') {
      throw new Error('eval:claude-code-direct-packet only supports --provider claude-code.');
    }
    return args;
  }
  return ['--provider', 'claude-code', ...args];
}

export function usage() {
  return [
    'Usage:',
    '  pnpm eval:claude-code-direct-packet --user <userId> --corpus <corpusId> --scenarios <scenarioIds> --artifacts-root <dir> --model <model> [options]',
    '',
    'Notes:',
    '  Claude Code direct packet baseline: strict empty MCP config, no backend/GraphQL/DB memory source during extraction.',
    '  It extracts open-schema facts once from packet documents.',
    '  Canonical backend fill mode materializes those facts after extraction, then calls the backend form-fill endpoint.',
    '',
    'Options:',
    '  --documents-root <dir>           Defaults to examples/eval/users/<user>/corpora/<corpus>',
    '  --fill-mode <mode>               local-fact-fill|backend; canonical comparison uses backend',
    '  --backend-url <url>              Backend fill mode; defaults to EVAL_BACKEND_URL or http://localhost:3000',
    '  --graphql-url <url>              Backend fill mode; defaults to EVAL_GRAPHQL_URL or http://localhost:3000/graphql',
    '  --auth-token <token>             Backend fill mode; defaults to EVAL_AUTH_TOKEN',
    '  --model <model>                  Defaults to EVAL_CLAUDE_CODE_MODEL or EVAL_MODEL',
    '  --thinking-mode <mode>           default|low|medium|high|xhigh|max; default omits --effort',
    '  --agent-timeout-ms <ms>          Defaults to 900000',
    '  --max-evidence-chars <int>       Defaults to 200000',
    '  --document-order <mode>          canonical|reverse|seeded-random|relevant-first|relevant-last',
    '  --document-order-seed <seed>     Defaults to packet-document-order-v1',
    '  --reset-memory                   Backend fill mode: clear current backend user memory values before materialization',
    '  --reset-demo-data                Backend fill mode: clear current backend user demo data',
    '  --run-id <id>',
  ].join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log(usage());
    process.exitCode = 0;
  } else {
    const result = await runClaudeCodeDirectPacket({ args });
    console.log(formatDirectOpenSchemaPacketResult(result));
    process.exitCode = result.exitCode;
  }
}
