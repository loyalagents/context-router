#!/usr/bin/env node

import { fileURLToPath } from 'node:url';
import {
  formatDirectOpenSchemaPacketResult,
  runDirectOpenSchemaPacket,
} from './direct-open-schema-packet.mjs';

export async function runClaudeCodeDirectPacket(options = {}) {
  const args = withClaudeCodeProvider(options.args ?? []);
  return runDirectOpenSchemaPacket({
    ...options,
    args,
  });
}

export function withClaudeCodeProvider(args) {
  if (args.includes('--provider')) return args;
  return ['--provider', 'claude-code', ...args];
}

export function usage() {
  return [
    'Usage:',
    '  pnpm eval:claude-code-direct-packet --user <userId> --corpus <corpusId> --scenarios <scenarioIds> --artifacts-root <dir> --model <model> [options]',
    '',
    'Notes:',
    '  Claude Code direct packet baseline: no MCP config, no backend memory, no GraphQL/DB memory source.',
    '  It extracts open-schema facts once from packet documents, then fills every listed form from those facts.',
    '',
    'Options:',
    '  --documents-root <dir>           Defaults to examples/eval/users/<user>/corpora/<corpus>',
    '  --model <model>                  Defaults to EVAL_CLAUDE_CODE_MODEL or EVAL_MODEL',
    '  --thinking-mode <mode>           default|low|medium|high|xhigh|max; default omits --effort',
    '  --agent-timeout-ms <ms>          Defaults to 900000',
    '  --max-evidence-chars <int>       Defaults to 200000',
    '  --document-order <mode>          canonical|reverse|seeded-random|relevant-first|relevant-last',
    '  --document-order-seed <seed>     Defaults to packet-document-order-v1',
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
