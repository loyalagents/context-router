#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

// Adding a consumer of one of these files requires adding its checks to the
// contracts job or removing the exemption. Policy/checker edits are full.
// These original exact exemptions retain their regular/executable mode semantics.
export const NONRUNTIME_PATHS = Object.freeze([
  'AGENTS.md', 'CLAUDE.md', 'docs/README.md', 'docs/plans/README.md',
  'docs/plans/backlog/stabilization/README.md',
  'docs/plans/backlog/stabilization/agent-efficiency.md',
  'docs/useful/AGENT_WORKFLOW.md', 'print-repo-structure.sh',
  'scripts/print-repo-structure.test.mjs',
]);
const POLICY_VERSION = 3;
// Fixed job coverage, not commands or a general dependency scheduler.
export const CI_LANES = Object.freeze(['backend', 'postgres', 'web', 'packaging', 'desktop', 'orchestrator', 'eval', 'harbor', 'restart']);
const PRODUCT_LANES = ['backend', 'postgres', 'web', 'packaging', 'desktop', 'eval'];
const DESKTOP_LANES = ['backend', 'web', 'packaging', 'desktop'];
const allLanes = () => Object.fromEntries(CI_LANES.map(lane => [lane, true]));
// Maintained prose only: no hidden/traversal components, whitespace, control
// characters or Markdown syntax. Unusual names conservatively select full CI.
const maintainedMarkdown = /^(?:README\.md|docs\/(?:IMPORTANT|current|useful|plans)\/(?:[A-Za-z0-9][A-Za-z0-9._-]*\/)*[A-Za-z0-9][A-Za-z0-9._-]*\.md)(?![\s\S])/;
function eligibleDocumentationChange(change) {
  const { file, status, oldMode, newMode, oldBlob, newBlob } = change;
  if (oldBlob === newBlob) return false;
  if (NONRUNTIME_PATHS.includes(file) && status === 'M' && oldMode === newMode && ['100644', '100755'].includes(oldMode)) return true;
  const markdown = ['AGENTS.md', 'CLAUDE.md', 'docs/README.md'].includes(file) || maintainedMarkdown.test(file);
  return markdown && file.length <= 240 && (
    (status === 'M' && oldMode === '100644' && newMode === '100644') ||
    (status === 'A' && oldMode === '000000' && newMode === '100644') ||
    (status === 'D' && oldMode === '100644' && newMode === '000000'));
}
function lanesForChange(change) {
  if (eligibleDocumentationChange(change)) return [];
  const { file, status, oldMode, newMode } = change;
  const regular = mode => ['100644', '100755'].includes(mode);
  if (!/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(file) || file.length > 240 ||
      !((status === 'M' && regular(oldMode) && oldMode === newMode) ||
        (status === 'A' && oldMode === '000000' && regular(newMode)) ||
        (status === 'D' && regular(oldMode) && newMode === '000000'))) return CI_LANES;
  if (file.startsWith('apps/backend/')) {
    // Even backend fixtures are browser/native inputs. Keep broad product coverage.
    const restart = file.split('/').length === 3 || /^apps\/backend\/(?:prisma\/|test\/(?:contracts|local-model)\/fixtures\/|src\/(?:bootstrap\/|composition\/|config\/|mcp\/|common\/guards\/|modules\/(?:auth|external-identity)\/|main\.ts$|app\.module\.ts$|schema\.gql$))/.test(file);
    return [...PRODUCT_LANES, ...(restart ? ['restart'] : [])];
  }
  if (/^apps\/web\/test\/[^/]+\.test\.mjs$/.test(file)) return ['web'];
  if (file.startsWith('apps/web/')) {
    const lanes = ['web', 'packaging'];
    // Root launchers/configuration are consumed by backend and native fixtures.
    if (!/^apps\/web\/(?:app|components|lib|test)\//.test(file)) lanes.push('backend', 'desktop');
    if (/^apps\/web\/(?:middleware\.ts$|next\.config\.mjs$|lib\/(?:auth0|runtime-config)\.ts$|app\/api\/)/.test(file)) lanes.push('restart');
    return lanes;
  }
  if (file.startsWith('apps/desktop/') || file.startsWith('examples/demo-10-2026/')) return DESKTOP_LANES;
  if (file.startsWith('apps/local-orchestrator/')) return ['orchestrator'];
  if (file.startsWith('examples/eval/')) {
    const lanes = ['backend', 'eval', 'postgres'];
    if (file === 'examples/eval/forms/i-9/form.pdf') lanes.push('packaging', 'restart');
    if (/^examples\/eval\/users\/maya-chen-newhire\/corpora\/[^/]+\/validation-report\.json$/.test(file)) lanes.push('harbor');
    return lanes;
  }
  if (file.startsWith('examples/eval-harbor/') || file.startsWith('examples/eval_harbor_agents/')) return ['harbor'];
  // CI, gate/install/HCP helpers, frozen evidence, shared dependencies/toolchain,
  // new top-level owners and unrecognized inputs require complete coverage.
  return CI_LANES;
}
export function classifyChanges(changes) {
  if (!changes.length) return allLanes();
  const required = new Set(changes.flatMap(lanesForChange));
  return Object.fromEntries(CI_LANES.map(lane => [lane, required.has(lane)]));
}
const exec = promisify(execFile);
const MAX_GIT_BYTES = 8 * 1024 * 1024;
const shaPattern = /^[a-f0-9]{40}$/;
const failureCategories = new Set(['event', 'checkout', 'base', 'history', 'clean checkout required',
  'diff', 'classification', 'job outcomes or classification mismatch', 'invocation', 'Git output encoding (UTF-8 required)']);
class SelectionError extends Error {
  constructor(category) { super(`CI validation selection: ${category}`); this.category = category; }
}
const fail = category => { throw new SelectionError(category); };
function sha(value, category) {
  if (typeof value !== 'string' || !shaPattern.test(value) || /^0+$/.test(value)) fail(category);
  return value;
}

export async function runGit(cwd, args) {
  // No shell, external diff driver, text conversion or user Git configuration.
  // execFile rejects overflow/timeouts: never consume its partial stdout.
  const result = await exec('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
    cwd, encoding: 'buffer', timeout: 30000, maxBuffer: MAX_GIT_BYTES,
    env: { PATH: process.env.PATH, HOME: process.env.HOME,
      GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' },
  });
  try { return new TextDecoder('utf-8', { fatal: true }).decode(result.stdout); }
  catch { fail('Git output encoding (UTF-8 required)'); }
}

function parseDiff(output) {
  if (typeof output !== 'string' || Buffer.byteLength(output) > MAX_GIT_BYTES) fail('diff');
  if (output === '') return [];
  const fields = output.split('\0');
  if (fields.pop() !== '' || fields.length % 2) fail('diff');
  const changes = [];
  for (let i = 0; i < fields.length; i += 2) {
    const match = /^:(\d{6}) (\d{6}) ([a-f0-9]{40}) ([a-f0-9]{40}) ([AMDT])$/.exec(fields[i]);
    const file = fields[i + 1];
    if (!match || !file || path.posix.isAbsolute(file) || file.split('/').some(p => p === '..' || p === '.')) fail('diff');
    const [, oldMode, newMode, oldBlob, newBlob, status] = match;
    changes.push({ file, status, oldMode, newMode, oldBlob, newBlob });
  }
  return changes;
}

export async function selectValidation({ cwd, environment = process.env, event, git = args => runGit(cwd, args) }) {
  const eventName = environment.GITHUB_EVENT_NAME;
  if (!['push', 'pull_request'].includes(eventName)) fail('event');
  const checkoutSha = sha(environment.GITHUB_SHA, 'checkout');
  if (!event || typeof event !== 'object') fail('event');
  if ((await git(['rev-parse', '--is-shallow-repository'])).trim() !== 'false') fail('history');
  if ((await git(['status', '--porcelain=v1', '--untracked-files=all'])).trim()) fail('clean checkout required');
  const parents = (await git(['rev-list', '--parents', '-n', '1', 'HEAD'])).trim().split(/\s+/);
  parents.forEach(value => sha(value, 'checkout'));
  if (parents[0] !== checkoutSha) fail('checkout');
  const baseSha = sha(eventName === 'push' ? event.before : event.pull_request?.base?.sha, 'base');
  try {
    await git(['cat-file', '-e', `${baseSha}^{commit}`]);
    await git(['merge-base', '--is-ancestor', baseSha, checkoutSha]);
  } catch { fail('base'); }
  let pullRequestHeadSha = null, branchBaseSha = null, advancedBase = false;
  let ambiguousBaseShas = [];
  const comparisons = [[baseSha, checkoutSha]];
  if (eventName === 'push') {
    if (event.after !== checkoutSha) fail('checkout');
    if (event.ref !== 'refs/heads/main' || environment.GITHUB_REF !== event.ref) fail('event');
  } else {
    pullRequestHeadSha = sha(event.pull_request?.head?.sha, 'checkout');
    if (event.pull_request?.base?.ref !== 'main' || !/^refs\/pull\/[1-9][0-9]*\/merge$/.test(environment.GITHUB_REF ?? '')) fail('event');
    if (parents.length !== 3 || parents[2] !== pullRequestHeadSha) fail('checkout');
    const bases = (await git(['merge-base', '--all', baseSha, pullRequestHeadSha])).trim().split(/\s+/);
    bases.forEach(value => sha(value, 'base'));
    if (new Set(bases).size !== bases.length) fail('base');
    if (bases.length === 1) {
      branchBaseSha = bases[0];
      comparisons.push([branchBaseSha, pullRequestHeadSha]);
    } else {
      // Criss-cross history is valid but cannot obtain an exemption. Bind every
      // returned base; the event base remains the contract/receipt comparison.
      ambiguousBaseShas = bases.sort();
    }
    advancedBase = parents[1] !== baseSha;
  }
  const changes = [];
  for (const [from, to] of comparisons) {
    changes.push(...parseDiff(await git(['diff', '--raw', '--no-renames', '--no-abbrev', '--no-ext-diff', '--no-textconv', '-z', from, to, '--'])));
  }
  const paths = [...new Set(changes.map(c => c.file))].sort();
  const lanes = ambiguousBaseShas.length || advancedBase ? allLanes() : classifyChanges(changes);
  const profile = Object.values(lanes).every(Boolean) ? 'full' : Object.values(lanes).some(Boolean) ? 'selective' : 'nonruntime';
  const reason = ambiguousBaseShas.length ? 'ambiguous-base' : advancedBase ? 'advanced-base' : !changes.length ? 'empty-diff' : profile === 'full' ? 'full-required' : 'affected-consumers';
  const identity = { policyVersion: POLICY_VERSION, eventName, checkoutSha, baseSha, branchBaseSha, ambiguousBaseShas, pullRequestHeadSha, profile, reason, lanes, changes };
  return { policyVersion: POLICY_VERSION, profile, reason, lanes, baseSha, checkoutSha, paths,
    binding: createHash('sha256').update(JSON.stringify(identity)).digest('hex') };
}

export function validateSelectionResults(selection, exported, outcomes) {
  if (!['full', 'selective', 'nonruntime'].includes(selection.profile) || !/^[a-f0-9]{64}$/.test(selection.binding)) fail('classification');
  try {
    assert.deepEqual(Object.keys(selection.lanes), CI_LANES);
    assert.ok(Object.values(selection.lanes).every(value => typeof value === 'boolean'));
    assert.deepEqual(exported, { profile: selection.profile, binding: selection.binding, lanes: selection.lanes });
    assert.deepEqual(outcomes, { selection: 'success', contracts: 'success',
      ...Object.fromEntries(CI_LANES.map(lane => [lane, selection.lanes[lane] ? 'success' : 'skipped'])),
    });
  } catch { fail('job outcomes or classification mismatch'); }
}

async function main() {
  const [mode, ...extra] = process.argv.slice(2);
  if (!['--select', '--aggregate'].includes(mode) || extra.length) fail('invocation');
  const eventBytes = await readFile(process.env.GITHUB_EVENT_PATH);
  if (eventBytes.length > MAX_GIT_BYTES) fail('event');
  const selection = await selectValidation({ cwd: process.cwd(), event: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(eventBytes)) });
  if (mode === '--aggregate') {
    const needs = JSON.parse(process.env.NEEDS_JSON ?? '{}');
    const exported = needs['validation-selection']?.outputs ?? {};
    validateSelectionResults(selection,
      { profile: exported.profile, binding: exported.binding, lanes: JSON.parse(exported.lanes ?? 'null') },
      { selection: needs['validation-selection']?.result, contracts: needs.contracts?.result,
        ...Object.fromEntries(CI_LANES.map(lane => [lane, needs[lane]?.result])) });
  }
  const required = CI_LANES.filter(lane => selection.lanes[lane]);
  const message = `${mode === '--aggregate' ? 'Selected checks passed' : 'Selected checks'}: contracts${required.length ? ', ' + required.join(', ') : ' only; runtime checks not applicable'}; policy v${POLICY_VERSION}, ${selection.reason}.`;
  // Fixed lane names and verified hashes only; never print raw diff paths.
  console.log(message);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY,
    `${message}\n\nCheckout: ${selection.checkoutSha}; base: ${selection.baseSha}; selection: ${selection.binding}.\n`);
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT,
    `profile=${selection.profile}\nbinding=${selection.binding}\nlanes=${JSON.stringify(selection.lanes)}\n`);

}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main(); }
  catch (error) {
    // Git/event/file errors may contain untrusted paths or data. Missing output
    // never grants an exemption, even when the failed selector is followed by full lanes.
    const message = error instanceof SelectionError && failureCategories.has(error.category)
      ? error.message : 'CI validation selection failed';
    console.error(`${message}; no exemption is valid.`);
    process.exitCode = 1;
  }
}
