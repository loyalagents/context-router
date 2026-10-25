#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { validateWebTestGroups } from '../apps/web/test/check-test-groups.mjs';

const repository = fileURLToPath(new URL('../', import.meta.url));
const oidPattern = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
export const decodeGitOutput = bytes => new TextDecoder('utf-8', { fatal: true }).decode(bytes);

export function git(cwd, args, environment = process.env) {
  // Read-only plumbing; no shell, hooks, external diff/textconv, index refresh or fetch.
  const env = { PATH: environment.PATH, HOME: environment.HOME, XDG_CONFIG_HOME: environment.XDG_CONFIG_HOME,
    GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' };
  const options = {
    cwd, encoding: 'buffer', maxBuffer: 16 * 1024 * 1024, timeout: 30000,
    stdio: ['ignore', 'pipe', 'pipe'],
  };
  const config = ['-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null'];
  if (args[0] === 'ls-files' && args.includes('--others')) {
    // Import only the effective ignore-file setting, not arbitrary user Git behavior.
    // Missing key uses Git's HOME/XDG default. Malformed config must fail visibly.
    try {
      const value = decodeGitOutput(execFileSync('git', [...config, 'config', '--includes', '--path', '--null', '--get', 'core.excludesFile'], { ...options, env }));
      if (!value.endsWith('\0') || value.slice(0, -1).includes('\0')) throw new Error('Malformed Git ignore configuration.');
      config.push('-c', `core.excludesFile=${value.slice(0, -1)}`);
    } catch (error) { if (error.status !== 1) throw error; }
  }
  return decodeGitOutput(execFileSync('git', [...config, ...args], { ...options,
    env: { ...env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' } }));
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
export const checks = {
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
  topology: ['pnpm --filter backend exec jest --selectProjects unit --runInBand --runTestsByPath test/contracts/runtime-composition.spec.ts', dependencies],
  webDocs: ['node --test scripts/local-migration/web-runtime-config.test.mjs', 'Node 24.21.0.'],
  operatorDocs: ['pnpm --filter local-orchestrator exec node --import tsx --test test/operator-docs.test.ts', dependencies],
  orchestrator: ['pnpm --filter local-orchestrator test', dependencies],
  desktop: ['pnpm --filter desktop test', built],
  native: ['pnpm --filter desktop build:native && pnpm --filter desktop test:native', `${built} Supported Apple Silicon Mac with Apple compiler/SDK; synthetic fixtures only.`],
  contracts: ['node scripts/local-migration/check-contract-baseline.mjs', `${dependencies} Current-tree contract check only; default invocation does not compare base compatibility.`],
  contractTests: ['node --test scripts/local-migration/check-contract-baseline.test.mjs', dependencies],
  baseContracts: ['node scripts/local-migration/check-nonruntime.mjs', `${dependencies} Complete Git history and the reported 40-character merge-base with its contract inputs. Uses temporary base artifacts; no source/package qualification receipt.`],
  evalTests: ['pnpm eval:test', dependencies],
  evalValidate: ['pnpm eval:validate', dependencies],
  harbor: ['pnpm eval-harbor:check', 'Python 3.12 and the eval-harbor static-check prerequisites; inspect its runbook.'],
  demo: ['node --test --test-concurrency=1 examples/demo-10-2026/*.test.mjs', browser],
};

const registryPath = 'docs/current/local-migration-contract-baseline.json';
const gatePath = 'scripts/local-migration/gate-phases.json';
export function plannerInputs(root = repository) {
  const json = file => JSON.parse(readFileSync(resolve(root, file), 'utf8'));
  const contractPaths = new Set([registryPath]);
  const walk = value => {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (['path', 'evidencePath'].includes(key) && typeof child === 'string') contractPaths.add(child);
      else walk(child);
    }
  };
  const registry = json(registryPath);
  walk(registry);
  for (const contract of Object.values(registry.contracts)) {
    for (const key of ['fixture', 'schema', 'source']) if (typeof contract[key] === 'string') contractPaths.add(contract[key]);
  }
  for (const capability of registry.capabilities) {
    for (const evidence of capability.evidence ?? []) if (typeof evidence === 'string') contractPaths.add(evidence);
  }
  const nodeTests = new Set();
  // Reuse the reviewed pre-build runner boundary, not arbitrary *.test.mjs files.
  for (const phase of json(gatePath).phases.filter(phase => ['contract-baseline', 'documentation'].includes(phase.id))) {
    for (const { argv } of phase.commands) if (argv[0] === 'node' && argv[1] === '--test') {
      for (const file of argv.slice(2)) if (file.endsWith('.test.mjs')) nodeTests.add(file);
    }
  }
  return { root, contractPaths, nodeTests };
}

function existingFile(root, file) {
  try { return lstatSync(resolve(root, file)).isFile() && realpathSync(resolve(root, file)).startsWith(realpathSync(root) + '/'); }
  catch (error) { if (['ENOENT', 'ENOTDIR'].includes(error.code)) return false; throw error; }
}
const shellQuote = value => `'${value.replaceAll("'", "'\\''")}'`;

export function webGroups(root = repository) {
  const manifest = JSON.parse(readFileSync(resolve(root, 'apps/web/package.json'), 'utf8'));
  const files = readdirSync(resolve(root, 'apps/web/test')).filter(name => name.endsWith('.test.mjs'));
  return validateWebTestGroups(manifest.scripts, files);
}

export function planChanges(changes, groups, inputs = plannerInputs()) {
  const selected = new Map();
  const wider = new Map();
  const warnings = new Set();
  const unresolved = [];
  const add = (ids, file, reason, target = selected) => ids.forEach(id => {
    if (!target.has(id)) target.set(id, { id, command: checks[id][0], prerequisites: checks[id][1], reasons: [] });
    target.get(id).reasons.push({ file, reason });
  });
  const direct = (id, command, prerequisites, file, reason) => {
    if (!selected.has(id)) selected.set(id, { id, command, prerequisites, reasons: [] });
    selected.get(id).reasons.push({ file, reason });
  };
  const broad = (file, reason) => {
    add(['backend', 'database', 'integration', 'e2e', 'model', 'mcp', 'localUi', 'helpers', 'browser'], file, reason, wider);
    unresolved.push(file);
    warnings.add('Manual impact review required: wider candidates are not a complete test set. Discover affected contracts, integration, native, packaging and recovery checks; select required local coverage under policy.');
  };
  for (const file of changes.paths) {
    if (inputs.contractPaths.has(file)) add(['contracts'], file, 'Referenced by the contract registry; deletion and rename sides also need checking.');
    if (file === registryPath) add(['contractTests'], file, 'Contract registry and its validator.');
    if (file.startsWith('apps/web/') && !file.startsWith('apps/web/test/')) {
      add(['webDocs', 'contracts', 'demo'], file, 'Web source has runtime-config, contract and historical demo consumers.');
    }
    if (/^apps\/web\/.*\.[cm]?[jt]sx?$/.test(file)) add(['webDocs'], file, 'Runtime-config checker scans all web source, including test source.');
    if (file.startsWith('examples/eval/') || file.startsWith('apps/backend/test/eval-runner/') ||
        ['apps/backend/src/schema.gql', 'apps/backend/src/config/preferences.catalog.json'].includes(file)) {
      add(['evalTests', 'evalValidate'], file, 'Evaluation fixtures consume this input.');
    }
    if (file.startsWith('examples/demo-10-2026/') || file.startsWith('apps/backend/scripts/demo/')) add(['demo'], file, 'Historical demo consumer.');
    if (file.startsWith('examples/eval-harbor/') || file.startsWith('examples/eval_harbor_agents/')) add(['harbor'], file, 'Harbor static-check consumer.');
    const sibling = file.endsWith('.test.mjs') ? file : file.replace(/\.mjs$/, '.test.mjs');
    if (/^[A-Za-z0-9_./-]+$/.test(file) && inputs.nodeTests.has(sibling)) {
      if (existingFile(inputs.root, sibling)) {
        const known = Object.keys(checks).find(id => checks[id][0] === `node --test ${sibling}`);
        if (known) add([known], file, 'Existing test in the gate manifest pre-build Node runner.');
        else direct(`node:${sibling}`, `node --test ${shellQuote(sibling)}`, dependencies, file, 'Existing test in the gate manifest pre-build Node runner.');
      }
      else { unresolved.push(file); warnings.add('A discovered test was deleted or is not a regular in-repository file; review replacement coverage.'); }
    }
    // Unusual names remain in the plan, but never become shell arguments or narrow exemptions.
    if (!/^[A-Za-z0-9_./-]+$/.test(file)) {
      broad(file, 'Unusual path requires manual classification.');
      continue;
    }
    if (/\.(?:md|markdown)$/i.test(file)) {
      add(['docs', 'docsTests', 'structure', 'policy', 'contractTests', 'baseContracts', 'topology', 'webDocs', 'operatorDocs'], file, 'Reviewed documentation-lane readers and validators; discover additional component readers.');
      warnings.add('Discover document readers using old/new paths, basenames and distinctive asserted content across tests/scripts. New, moved or deleted documents need structural review; these initial reader suggestions do not prove coverage.');
      if (['README.md', 'AGENTS.md', 'CLAUDE.md', 'docs/README.md'].includes(file) ||
          /^docs\/(?:IMPORTANT|current|useful|plans)\//.test(file)) continue;
      // Runtime/evaluation/component Markdown still needs its component checks below.
    }
    if (/^scripts\/test-plan(?:\.test)?\.mjs$/.test(file)) { add(['planner'], file, 'Planner behavior and Git collection.'); continue; }
    if (/^(?:print-repo-structure\.sh|scripts\/print-repo-structure\.test\.mjs)$/.test(file)) { add(['structure'], file, 'Repository overview renderer.'); continue; }
    if (/^scripts\/check-markdown-links(?:\.test)?\.mjs$/.test(file)) { add(['docsTests', 'docs'], file, 'Markdown validator behavior and current links.'); continue; }
    const backendTest = /^apps\/backend\/test\/(integration|e2e|local-database|local-model|local-mcp|local-ui)\/(.+)$/.exec(file);
    if (backendTest) {
      const [, area, relative] = backendTest;
      const discovered = area === 'e2e' ? /\.e2e-spec\.ts$/.test(relative) :
        ['integration', 'local-database'].includes(area) ? /\.spec\.ts$/.test(relative) :
          /^[^/]+\.test\.mjs$/.test(relative);
      // Area fixtures are shared with other backend, web and installed consumers.
      // Narrow only actual suite files; shared support needs explicit impact review.
      if (discovered && !/(?:^|\/)(?:fixtures|support)\//.test(relative)) {
        add([{ integration: 'integration', e2e: 'e2e', 'local-database': 'database', 'local-model': 'model', 'local-mcp': 'mcp', 'local-ui': 'localUi' }[area]], file, 'Discovered backend test file.');
        continue;
      }
    }
    if (/^apps\/backend\/(?:src\/.*\.spec\.ts|test\/contracts\/.*\.spec\.ts)$/.test(file)) {
      add(['backend'], file, 'Backend unit/contract suite.'); continue;
    }
    if (file.startsWith('apps/backend/')) {
      if (file.startsWith('apps/backend/src/')) {
        add(['contracts'], file, 'Backend source can introduce contract consumers beyond existing registry entries.');
        const spec = file.replace(/\.ts$/, '.spec.ts');
        if (spec !== file && existingFile(inputs.root, spec)) direct(`jest:${spec}`, `pnpm --filter backend exec jest --selectProjects unit --runInBand --runTestsByPath ${shellQuote(spec.slice('apps/backend/'.length))}`, generated, file, 'Existing same-name unit test; shared consumers still require review.');
        else add(['backend'], file, 'Backend unit/contract starting point; shared consumers still require review.');
      }
      broad(file, 'Backend source/configuration can affect shared contracts and storage consumers.'); continue;
    }
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
  if (selected.has('baseContracts')) {
    if (/^[a-f0-9]{40}$/.test(changes.mergeBase)) {
      selected.get('baseContracts').command = `MIGRATION_GATE_BASE_SHA=${changes.mergeBase} ${checks.baseContracts[0]}`;
      selected.get('baseContracts').reasons.push(...(selected.get('contracts')?.reasons ?? []));
      selected.delete('contracts'); // The base-bound wrapper also checks the current tree.
    }
    else {
      selected.delete('baseContracts');
      add(['contracts'], registryPath, 'Current-tree fallback; base comparison remains unresolved.');
      warnings.add('Base-bound contract wrapper requires a 40-character Git identity; arrange compatible base comparison separately.');
    }
  }
  direct('whitespaceCommitted', `git diff --check ${changes.mergeBase} ${changes.head} --`, 'Git; compares the reported immutable merge-base and HEAD.', '(committed changes)', 'Committed whitespace.');
  direct('whitespaceStaged', 'git diff --cached --check --', 'Git; current index.', '(staged changes)', 'Staged whitespace.');
  direct('whitespaceUnstaged', 'git diff --check --', 'Git; current worktree.', '(unstaged changes)', 'Unstaged whitespace.');
  return {
    adviceOnly: true,
    disclaimer: 'Advice only: no recommended command was executed. This is not sufficient qualification or a CI selection decision.',
    ...changes,
    commands: [...selected.values()], widerValidation: [...wider.values()].filter(check => !selected.has(check.id)), unresolved: [...new Set(unresolved)], warnings: [...warnings],
    alternatives: selected.has('database') || wider.has('database') ? [{ command: 'pnpm --filter backend test:local-database:tests-only',
      condition: 'Only after independently verifying that generated Prisma client and backend/worker build match current source, dependency and configuration inputs in this checkout. Existence or mtime is not freshness evidence. Otherwise use the build-owning standalone command above.' }] : [],
    reminders: [
      'No fetch performed. Verify the requested base is current; fetch it explicitly when needed. Ignored files are excluded; inspect relevant ignored/generated inputs and submodule contents manually.',
      'Collection is not an atomic working-tree snapshot. Keep inputs stable, review all listed paths, and rerun after edits or concurrent Git operations.',
      'Wider validation candidates are not derived CI routing or automatic local requirements. Resolve impacts and apply policy; CI does not substitute for required focused local evidence.',
      'Git diff does not check untracked file whitespace; add intended files to the index and rerun the staged whitespace check.',
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
  for (const [title, commands] of [['Directly relevant checks', plan.commands], ['Wider validation candidates — resolve impacts under policy', plan.widerValidation]]) {
    if (commands.length) lines.push('', title + ':');
    for (const check of commands) lines.push('', check.command, `  Prerequisites: ${check.prerequisites}`,
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
