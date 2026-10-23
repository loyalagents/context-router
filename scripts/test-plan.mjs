#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { validateWebTestGroups } from '../apps/web/test/check-test-groups.mjs';

const repository = fileURLToPath(new URL('../', import.meta.url));
const oidPattern = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
export const decodeGitOutput = bytes => new TextDecoder('utf-8', { fatal: true }).decode(bytes);

export function git(cwd, args) {
  // Read-only plumbing; no shell, hooks, external diff/textconv, index refresh or fetch.
  return decodeGitOutput(execFileSync('git', ['-c', 'core.fsmonitor=false', ...args], {
    cwd, encoding: 'buffer', maxBuffer: 16 * 1024 * 1024, timeout: 30000,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { PATH: process.env.PATH, HOME: process.env.HOME, GIT_OPTIONAL_LOCKS: '0',
      GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0' },
  }));
}

export function parsePaths(output) {
  if (output === '') return [];
  const paths = output.split('\0');
  if (paths.pop() !== '' || paths.some(file => !file || file.startsWith('/') ||
      file.split('/').some(part => part === '..' || part === '.'))) {
    throw new Error('Malformed NUL-delimited Git paths; no partial plan produced.');
  }
  return paths;
}

export function collectChanges(cwd, base = 'origin/main', run = args => git(cwd, args)) {
  const commit = ref => {
    const oid = run(['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`]).trim();
    if (!oidPattern.test(oid)) throw new Error('Expected one commit identity.');
    return oid;
  };
  const head = commit('HEAD');
  const baseCommit = commit(base);
  const bases = run(['merge-base', '--all', baseCommit, head]).trim().split('\n');
  if (bases.length !== 1 || !oidPattern.test(bases[0])) throw new Error('A unique merge-base is required.');
  if (run(['ls-files', '--unmerged', '-z'])) throw new Error('Resolve the unmerged index before planning tests.');
  const diff = ['diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--name-only', '-z'];
  // Keep these separate: a staged reversal must not hide a committed or unstaged change.
  const sources = {
    committed: parsePaths(run([...diff, bases[0], head, '--'])),
    staged: parsePaths(run([...diff, '--cached', head, '--'])),
    unstaged: parsePaths(run([...diff, '--'])),
    untracked: parsePaths(run(['ls-files', '--others', '--exclude-standard', '-z'])),
  };
  if (commit('HEAD') !== head) throw new Error('HEAD changed while collecting paths; rerun on stable inputs.');
  return { base, baseCommit, head, mergeBase: bases[0], sources,
    paths: [...new Set(Object.values(sources).flat())].sort() };
}

const dependencies = 'Pinned Node 24.21.0 / pnpm 10.25.0; pnpm install --frozen-lockfile.';
const generated = `${dependencies} First run pnpm --filter backend prisma:generate.`;
const built = `${generated} Then pnpm --filter backend build (includes workers).`;
const browser = `${built} Run pnpm --filter web build and install the pinned Chromium with pnpm --filter web exec playwright install chromium; use isolated test state.`;
const postgres = `${generated} Isolated PostgreSQL test database, current migrations and DATABASE_URL; follow the contributor runbook. Never use a personal database.`;
const checks = {
  planner: ['node --test scripts/test-plan.test.mjs', 'Node 24.21.0 and Git; temporary repositories only.'],
  docs: ['node scripts/check-markdown-links.mjs', 'Node 24.21.0.'],
  docsTests: ['node --test scripts/check-markdown-links.test.mjs', 'Node 24.21.0.'],
  structure: ['node --test scripts/print-repo-structure.test.mjs', 'Node 24.21.0 and Bash.'],
  policy: ['node --test scripts/local-migration/ci-path-filters.test.mjs', dependencies],
  toolchain: ['node --test scripts/local-migration/toolchain-contract.test.mjs', dependencies],
  backend: ['pnpm test:backend:unit', generated],
  database: ['pnpm --filter backend test:local-database', `${dependencies} This standalone command generates Prisma and builds the backend; no PostgreSQL required.`],
  integration: ['pnpm test:backend:integration', postgres],
  e2e: ['pnpm --filter backend test:e2e:tests-only', postgres],
  model: ['pnpm --filter backend test:local-model', built],
  mcp: ['pnpm --filter backend test:local-mcp', built],
  localUi: ['pnpm --filter backend test:local-ui', built],
  helpers: ['pnpm --filter web test:helpers', dependencies],
  browser: ['pnpm --filter web test:browser', browser],
  topology: ['pnpm --filter backend exec jest --selectProjects unit --runInBand --runTestsByPath test/contracts/runtime-composition.spec.ts', generated],
  webDocs: ['node --test scripts/local-migration/web-runtime-config.test.mjs', 'Node 24.21.0.'],
  operatorDocs: ['pnpm --filter local-orchestrator exec node --import tsx --test test/operator-docs.test.ts', dependencies],
  orchestrator: ['pnpm --filter local-orchestrator test', dependencies],
  desktop: ['pnpm --filter desktop test', built],
  native: ['pnpm --filter desktop build:native && pnpm --filter desktop test:native', `${built} Supported Apple Silicon Mac with Apple compiler/SDK; synthetic fixtures only.`],
};

export function webGroups(root = repository) {
  const manifest = JSON.parse(readFileSync(resolve(root, 'apps/web/package.json'), 'utf8'));
  const files = readdirSync(resolve(root, 'apps/web/test')).filter(name => name.endsWith('.test.mjs'));
  return validateWebTestGroups(manifest.scripts, files);
}

export function planChanges(changes, groups) {
  const selected = new Map();
  const warnings = new Set();
  const unresolved = [];
  const add = (ids, file, reason) => ids.forEach(id => {
    if (!selected.has(id)) selected.set(id, { id, command: checks[id][0], prerequisites: checks[id][1], reasons: [] });
    selected.get(id).reasons.push({ file, reason });
  });
  const broad = (file, reason) => {
    add(['backend', 'database', 'integration', 'e2e', 'model', 'mcp', 'localUi', 'helpers', 'browser'], file, reason);
    unresolved.push(file);
    warnings.add('Manual impact review required: broad suggestions are a starting point; discover affected contracts, integration, native, packaging and recovery checks.');
  };
  for (const file of changes.paths) {
    // Unusual names remain in the plan, but never become shell arguments or narrow exemptions.
    if (!/^[A-Za-z0-9_./-]+$/.test(file)) {
      broad(file, 'Unusual path requires manual classification.');
      continue;
    }
    if (/\.(?:md|markdown)$/i.test(file)) {
      add(['docs', 'topology', 'webDocs', 'operatorDocs'], file, 'Documentation: known reader suites, not an exhaustive reader inventory.');
      warnings.add('Discover document readers using old/new paths, basenames and distinctive asserted content across tests/scripts. New, moved or deleted documents need structural review; these initial reader suggestions do not prove coverage.');
      if (!['README.md', 'AGENTS.md', 'CLAUDE.md', 'docs/README.md'].includes(file) &&
          !/^docs\/(?:IMPORTANT|current|useful|plans)\//.test(file)) {
        broad(file, 'Markdown outside maintained prose roots may be runtime, evaluation or fixture input.');
      }
      continue;
    }
    if (/^scripts\/test-plan(?:\.test)?\.mjs$/.test(file)) { add(['planner'], file, 'Planner behavior and Git collection.'); continue; }
    if (/^(?:print-repo-structure\.sh|scripts\/print-repo-structure\.test\.mjs)$/.test(file)) { add(['structure'], file, 'Repository overview renderer.'); continue; }
    if (/^scripts\/check-markdown-links(?:\.test)?\.mjs$/.test(file)) { add(['docsTests', 'docs'], file, 'Markdown validator behavior and current links.'); continue; }
    if (/^apps\/backend\/test\/(integration|e2e|local-database|local-model|local-mcp|local-ui)\//.test(file)) {
      const area = file.split('/')[3];
      add([{ integration: 'integration', e2e: 'e2e', 'local-database': 'database', 'local-model': 'model', 'local-mcp': 'mcp', 'local-ui': 'localUi' }[area]], file, 'Known backend test area.');
      continue;
    }
    if (/^apps\/backend\/(?:src\/.*\.spec\.ts|test\/contracts\/.*\.spec\.ts)$/.test(file)) {
      add(['backend'], file, 'Backend unit/contract suite.'); continue;
    }
    if (file.startsWith('apps/backend/')) { broad(file, 'Backend source/configuration can affect shared contracts and storage consumers.'); continue; }
    if (file.startsWith('apps/web/test/')) {
      const name = file.slice('apps/web/test/'.length);
      if (groups.helpers.includes(name)) { add(['helpers'], file, 'Validated helper test group.'); continue; }
      if (groups.browser.includes(name)) { add(['browser'], file, 'Validated browser test group.'); continue; }
    }
    if (['apps/web/lib/local-client-name.ts', 'apps/web/lib/local-transport.ts', 'apps/web/lib/local-upload.ts', 'apps/web/components/local/permissions-draft.ts'].includes(file)) {
      add(['helpers', 'browser'], file, 'Web helper source and its browser consumers.'); continue;
    }
    if (/^apps\/web\/(?:app\/dashboard|components)\//.test(file)) { add(['helpers', 'browser'], file, 'Dashboard behavior needs helper and browser coverage.'); continue; }
    if (file.startsWith('apps/web/')) { broad(file, 'Web boundary/configuration or unclassified test support.'); continue; }
    if (file.startsWith('apps/local-orchestrator/')) { add(['orchestrator'], file, 'Local orchestrator consumer.'); continue; }
    if (file.startsWith('apps/desktop/')) {
      add(['desktop', 'native'], file, 'Desktop changes require portable and target-Mac coverage.');
      broad(file, 'Review installed composition, packaging and lifecycle effects.'); continue;
    }
    if (file.startsWith('.github/') || file.startsWith('scripts/local-migration/')) {
      add(['policy'], file, 'CI/gate mechanism needs focused mechanism checks and full exact-candidate CI.');
      broad(file, 'Identify additional mechanism-specific tests and any local runner coverage changes.'); continue;
    }
    if (['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', '.nvmrc', '.npmrc', 'scripts/check-toolchain.mjs'].includes(file)) {
      add(['toolchain', 'planner', 'policy'], file, 'Shared toolchain/dependency configuration.');
    }
    broad(file, 'No narrow reviewed rule; unknown/shared inputs require wider validation.');
  }
  return {
    adviceOnly: true,
    disclaimer: 'Advice only: no recommended command was executed. This is not sufficient qualification or a CI selection decision.',
    ...changes,
    commands: [...selected.values()], unresolved, warnings: [...warnings],
    alternatives: selected.has('database') ? [{ command: 'pnpm --filter backend test:local-database:tests-only',
      condition: 'Only after independently verifying that generated Prisma client and backend/worker build match current source, dependency and configuration inputs in this checkout. Existence or mtime is not freshness evidence. Otherwise use the build-owning standalone command above.' }] : [],
    reminders: [
      'No fetch performed. Verify the requested base is current; fetch it explicitly when needed. Ignored files are excluded; inspect relevant ignored/generated inputs and submodule contents manually.',
      'Collection is not an atomic working-tree snapshot. Keep inputs stable, review all listed paths, and rerun after edits or concurrent Git operations.',
      'Apply docs/useful/AGENT_WORKFLOW.md validation matrix and current scoped plan obligations. Focused suggestions never waive full exact-candidate CI, independent review or required final gates.',
      'Name remaining target-Mac, installed artifact and manual acceptance evidence. A full local migration gate requires a current scoped requirement or named evidence gap; this planner does not choose or run it.',
    ],
  };
}

export function formatPlan(plan) {
  const quote = value => JSON.stringify(value);
  const lines = [plan.disclaimer, `Base: ${quote(plan.base)} -> ${plan.baseCommit}`, `HEAD: ${plan.head}`, `Merge-base: ${plan.mergeBase}`, '', 'Changed paths:'];
  lines.push(...plan.paths.map(file => `  ${quote(file)}`));
  if (!plan.paths.length) lines.push('  None found; this is not a qualification result.');
  for (const check of plan.commands) {
    lines.push('', check.command, `  Prerequisites: ${check.prerequisites}`,
      ...check.reasons.map(({ file, reason }) => `  ${quote(file)}: ${reason}`));
  }
  for (const alternative of plan.alternatives) lines.push('', `Conditional alternative: ${alternative.command}`, `  ${alternative.condition}`);
  if (plan.unresolved.length) lines.push('', `Unresolved impact: ${plan.unresolved.map(quote).join(', ')}`);
  lines.push('', ...plan.warnings.map(message => `Review: ${message}`), ...plan.reminders.map(message => `Reminder: ${message}`));
  return lines.join('\n');
}

export function parseArgs(args) {
  const options = { base: 'origin/main', json: false, help: false };
  const seen = new Set();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!['--base', '--json', '--help'].includes(arg) || seen.has(arg)) throw new Error(`Invalid or repeated argument: ${JSON.stringify(arg)}`);
    seen.add(arg);
    if (arg === '--base') {
      if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error('--base requires a Git ref.');
      options.base = args[++i];
    } else options[arg.slice(2)] = true;
  }
  return options;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) console.log('Usage: pnpm test:plan [--base <ref>] [--json]\nDefault base: origin/main (local ref; never fetched). Prints advice only.');
    else {
      const root = git(process.cwd(), ['rev-parse', '--show-toplevel']).replace(/\n$/, '');
      const plan = planChanges(collectChanges(root, options.base), webGroups());
      console.log(options.json ? JSON.stringify(plan, null, 2) : formatPlan(plan));
    }
  } catch (error) {
    console.error(`Test planning failed: ${JSON.stringify(error.message)}\nNo plan produced. Check the ref, Git history, index and web test census.`);
    process.exitCode = 1;
  }
}
