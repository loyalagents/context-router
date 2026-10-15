#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

// Adding a consumer of one of these files requires adding its checks to the
// nonruntime lane or removing the exemption. Policy/checker edits are full.
export const NONRUNTIME_PATHS = Object.freeze([
  'AGENTS.md', 'CLAUDE.md', 'docs/README.md', 'docs/plans/README.md',
  'docs/plans/backlog/stabilization/README.md',
  'docs/plans/backlog/stabilization/agent-efficiency.md',
  'docs/useful/AGENT_WORKFLOW.md', 'print-repo-structure.sh',
  'scripts/print-repo-structure.test.mjs',
]);
const exec = promisify(execFile);
const MAX_GIT_BYTES = 8 * 1024 * 1024;
const shaPattern = /^[a-f0-9]{40}$/;
const fail = category => { throw new Error(`CI validation selection: ${category}`); };
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
  return new TextDecoder('utf-8', { fatal: true }).decode(result.stdout);
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
  const comparisons = [[baseSha, checkoutSha]];
  if (eventName === 'push') {
    if (event.after !== checkoutSha) fail('checkout');
    if (event.ref !== 'refs/heads/main' || environment.GITHUB_REF !== event.ref) fail('event');
  } else {
    pullRequestHeadSha = sha(event.pull_request?.head?.sha, 'checkout');
    if (event.pull_request?.base?.ref !== 'main' || !/^refs\/pull\/[1-9][0-9]*\/merge$/.test(environment.GITHUB_REF ?? '')) fail('event');
    if (parents.length !== 3 || parents[2] !== pullRequestHeadSha) fail('checkout');
    const bases = (await git(['merge-base', '--all', baseSha, pullRequestHeadSha])).trim().split(/\s+/);
    if (bases.length !== 1) fail('base');
    branchBaseSha = sha(bases[0], 'base');
    comparisons.push([branchBaseSha, pullRequestHeadSha]);
    advancedBase = parents[1] !== baseSha;
  }
  const changes = [];
  for (const [from, to] of comparisons) {
    changes.push(...parseDiff(await git(['diff', '--raw', '--no-renames', '--no-abbrev', '--no-ext-diff', '--no-textconv', '-z', from, to, '--'])));
  }
  const paths = [...new Set(changes.map(c => c.file))].sort();
  const eligible = changes.length > 0 && changes.every(c =>
    NONRUNTIME_PATHS.includes(c.file) && c.status === 'M' &&
    ['100644', '100755'].includes(c.oldMode) && c.oldMode === c.newMode && c.oldBlob !== c.newBlob);
  const reason = advancedBase ? 'advanced-base' : !changes.length ? 'empty-diff' : eligible ? 'allowlisted-content' : 'full-required';
  const profile = reason === 'allowlisted-content' ? 'nonruntime' : 'full';
  const identity = { policyVersion: 1, eventName, checkoutSha, baseSha, branchBaseSha, pullRequestHeadSha, profile, reason, changes };
  return { policyVersion: 1, profile, reason, baseSha, checkoutSha, paths,
    binding: createHash('sha256').update(JSON.stringify(identity)).digest('hex') };
}

export function validateSelectionResults(selection, exported, outcomes) {
  if (!['full', 'nonruntime'].includes(selection.profile) || !/^[a-f0-9]{64}$/.test(selection.binding)) fail('classification');
  try {
    assert.deepEqual(exported, { profile: selection.profile, binding: selection.binding });
    assert.deepEqual(outcomes, {
      selection: 'success', nonruntime: selection.profile === 'nonruntime' ? 'success' : 'skipped',
      source: selection.profile === 'full' ? 'success' : 'skipped',
      packaging: selection.profile === 'full' ? 'success' : 'skipped',
    });
  } catch { fail('job outcomes or classification mismatch'); }
}

async function main() {
  const [mode, ...extra] = process.argv.slice(2);
  if (!['--select', '--aggregate'].includes(mode) || extra.length) fail('invocation');
  const eventBytes = await readFile(process.env.GITHUB_EVENT_PATH);
  if (eventBytes.length > MAX_GIT_BYTES) fail('event');
  const selection = await selectValidation({ cwd: process.cwd(), event: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(eventBytes)) });
  if (mode === '--aggregate') validateSelectionResults(selection,
    { profile: process.env.SELECTION_PROFILE, binding: process.env.SELECTION_BINDING }, {
      selection: process.env.SELECTION_RESULT, nonruntime: process.env.NONRUNTIME_RESULT,
      source: process.env.SOURCE_RESULT, packaging: process.env.PACKAGING_RESULT,
    });
  const message = selection.profile === 'nonruntime'
    ? `${mode === '--aggregate' ? 'Nonruntime checks passed; source/package qualification not applicable' : 'Selected nonruntime checks'}: policy v1, verified content-only changes to ${selection.paths.join(', ')}.`
    : `Full source/package qualification required: ${selection.reason}${mode === '--aggregate' ? '; execution lanes succeeded, receipt verification follows' : ''}.`;
  // Only finite categories and allowlisted paths enter logs or Actions outputs.
  console.log(message);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY,
    `${message}\n\nCheckout: ${selection.checkoutSha}; base: ${selection.baseSha}; selection: ${selection.binding}.\n`);
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT,
    `profile=${selection.profile}\nbinding=${selection.binding}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main(); }
  catch {
    // Git/event/file errors may contain untrusted paths or data. Missing output
    // never grants an exemption, even when the failed selector is followed by full lanes.
    console.error('CI validation selection failed; no exemption is valid.');
    process.exitCode = 1;
  }
}
