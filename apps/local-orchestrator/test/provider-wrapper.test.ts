import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

function buildSuggestionRequest() {
  return {
    stage: 'suggestion' as const,
    goal: 'Only keep durable communication preferences',
    file: {
      path: '/tmp/prefs.txt',
      relativePath: 'prefs.txt',
      extension: '.txt',
      sizeBytes: 18,
      originalMimeType: 'text/plain',
      uploadMimeType: 'text/plain',
      uploadFileName: 'prefs.txt',
      coercedToPlainText: false,
    },
    analysis: {
      analysisId: 'analysis-1',
      documentSummary: 'Preference note',
      status: 'success' as const,
      filteredCount: 1,
    },
    suggestions: [
      {
        id: 'analysis-1:candidate:1',
        slug: 'system.response_tone',
        operation: 'CREATE' as const,
        newValue: 'brief',
        confidence: 0.95,
        sourceSnippet: 'brief responses',
      },
    ],
    filteredSuggestions: [
      {
        id: 'analysis-1:filtered:1',
        slug: 'custom.unknown',
        operation: 'CREATE' as const,
        newValue: 'unknown',
        confidence: 0.08,
        sourceSnippet: 'unknown',
        filterReason: 'UNKNOWN_SLUG' as const,
      },
    ],
  };
}

function buildFileRequest() {
  return {
    stage: 'file' as const,
    goal: 'Only keep durable communication preferences',
    file: {
      path: '/tmp/prefs.txt',
      relativePath: 'prefs.txt',
      extension: '.txt',
      sizeBytes: 18,
      originalMimeType: 'text/plain',
      uploadMimeType: 'text/plain',
      uploadFileName: 'prefs.txt',
      coercedToPlainText: false,
    },
    preview: {
      text: 'brief responses',
      truncated: false,
      lineCount: 1,
      byteCount: 18,
      encoding: 'utf-8' as const,
    },
  };
}

async function writeExecutableScript(
  dir: string,
  name: string,
  source: string,
): Promise<string> {
  const scriptPath = path.join(dir, name);
  await writeFile(scriptPath, source, 'utf8');
  await chmod(scriptPath, 0o755);
  return scriptPath;
}

async function runExecutable(params: {
  command: string;
  args: string[];
  input: string;
  env?: NodeJS.ProcessEnv;
}): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';

    const child = spawn(params.command, params.args, {
      env: params.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    child.on('error', reject);

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });

    child.on('close', (code) => {
      resolve({ code, stdout, stderr });
    });

    child.stdin.end(params.input);
  });
}

function buildEnv(tempRoot: string, transcriptPath: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PATH: `${tempRoot}:${process.env.PATH ?? ''}`,
    TRANSCRIPT_PATH: transcriptPath,
  };
}

const CLAUDE_WRAPPER = path.resolve(
  __dirname,
  '..',
  'scripts',
  'claude-filter.mjs',
);

const CODEX_WRAPPER = path.resolve(
  __dirname,
  '..',
  'scripts',
  'codex-filter.mjs',
);

test('claude-filter handles suggestion-stage responses and forwards model args', async (t) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'claude-filter-suggestion-'));
  const transcriptPath = path.join(tempRoot, 'claude-transcript.json');
  t.after(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  await writeExecutableScript(
    tempRoot,
    'claude',
    `#!/usr/bin/env node
const fs = require('node:fs');
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  input += chunk;
});
process.stdin.on('end', () => {
  fs.writeFileSync(process.env.TRANSCRIPT_PATH, JSON.stringify({
    args: process.argv.slice(2),
    prompt: input
  }));
  process.stdout.write(JSON.stringify({
    decisions: [
      {
        suggestionId: 'analysis-1:candidate:1',
        action: 'apply',
        reason: 'Stable communication preference',
        score: 0.94,
        details: 'Durable personalization signal'
      }
    ]
  }));
});
`,
  );

  const result = await runExecutable({
    command: CLAUDE_WRAPPER,
    args: ['--model', 'sonnet'],
    input: JSON.stringify(buildSuggestionRequest()),
    env: buildEnv(tempRoot, transcriptPath),
  });

  assert.equal(result.code, 0);
  assert.deepEqual(JSON.parse(result.stdout), {
    promptVersion: 'claude-filter-suggestion-v1',
    decisions: [
      {
        suggestionId: 'analysis-1:candidate:1',
        action: 'apply',
        reason: 'Stable communication preference',
        score: 0.94,
        details: 'Durable personalization signal',
      },
    ],
  });

  const transcript = JSON.parse(await readFile(transcriptPath, 'utf8'));
  assert.deepEqual(
    transcript.args.slice(0, 8),
    ['-p', '--bare', '--no-session-persistence', '--tools', '', '--json-schema', transcript.args[6], '--model'],
  );
  assert.equal(transcript.args[8], 'sonnet');
  assert.match(transcript.prompt, /Only keep durable communication preferences/);
  assert.match(transcript.prompt, /filteredSuggestions/);
});

test('claude-filter handles file-stage responses', async (t) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'claude-filter-file-'));
  const transcriptPath = path.join(tempRoot, 'claude-file-transcript.json');
  t.after(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  await writeExecutableScript(
    tempRoot,
    'claude',
    `#!/usr/bin/env node
const fs = require('node:fs');
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  input += chunk;
});
process.stdin.on('end', () => {
  fs.writeFileSync(process.env.TRANSCRIPT_PATH, JSON.stringify({
    args: process.argv.slice(2),
    prompt: input
  }));
  process.stdout.write(JSON.stringify({
    decision: {
      action: 'analyze',
      reason: 'Possible durable preference signal',
      score: 0.72,
      details: 'Preview looks user-authored.'
    }
  }));
});
`,
  );

  const result = await runExecutable({
    command: CLAUDE_WRAPPER,
    args: [],
    input: JSON.stringify(buildFileRequest()),
    env: buildEnv(tempRoot, transcriptPath),
  });

  assert.equal(result.code, 0);
  assert.deepEqual(JSON.parse(result.stdout), {
    promptVersion: 'claude-filter-file-v1',
    decision: {
      action: 'analyze',
      reason: 'Possible durable preference signal',
      score: 0.72,
      details: 'Preview looks user-authored.',
    },
  });
});

test('claude-filter fails on malformed provider output', async (t) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'claude-filter-malformed-'));
  const transcriptPath = path.join(tempRoot, 'claude-malformed.json');
  t.after(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  await writeExecutableScript(
    tempRoot,
    'claude',
    `#!/usr/bin/env node
process.stdout.write('not-json');
`,
  );

  const result = await runExecutable({
    command: CLAUDE_WRAPPER,
    args: [],
    input: JSON.stringify(buildSuggestionRequest()),
    env: buildEnv(tempRoot, transcriptPath),
  });

  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /Claude filter failed:/);
  assert.match(result.stderr, /Claude returned invalid JSON/);
});

test('claude-filter fails when the provider exits non-zero', async (t) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'claude-filter-exit-'));
  const transcriptPath = path.join(tempRoot, 'claude-exit.json');
  t.after(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  await writeExecutableScript(
    tempRoot,
    'claude',
    `#!/usr/bin/env node
process.stderr.write('auth failed');
process.exit(9);
`,
  );

  const result = await runExecutable({
    command: CLAUDE_WRAPPER,
    args: [],
    input: JSON.stringify(buildSuggestionRequest()),
    env: buildEnv(tempRoot, transcriptPath),
  });

  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /claude exited with code 9/i);
});

test('codex-filter handles suggestion-stage responses and forwards model args', async (t) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-filter-suggestion-'));
  const transcriptPath = path.join(tempRoot, 'codex-transcript.json');
  t.after(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  await writeExecutableScript(
    tempRoot,
    'codex',
    `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  input += chunk;
});
process.stdin.on('end', () => {
  const outputIndex = args.indexOf('-o');
  const outputPath = outputIndex >= 0 ? args[outputIndex + 1] : null;
  fs.writeFileSync(process.env.TRANSCRIPT_PATH, JSON.stringify({
    args,
    prompt: input
  }));
  fs.writeFileSync(outputPath, JSON.stringify({
    decisions: [
      {
        suggestionId: 'analysis-1:candidate:1',
        action: 'apply',
        reason: 'Stable communication preference',
        score: 0.93,
        details: 'Durable personalization signal'
      }
    ]
  }));
});
`,
  );

  const result = await runExecutable({
    command: CODEX_WRAPPER,
    args: ['--model', 'gpt-5.4'],
    input: JSON.stringify(buildSuggestionRequest()),
    env: buildEnv(tempRoot, transcriptPath),
  });

  assert.equal(result.code, 0);
  assert.deepEqual(JSON.parse(result.stdout), {
    promptVersion: 'codex-filter-suggestion-v1',
    decisions: [
      {
        suggestionId: 'analysis-1:candidate:1',
        action: 'apply',
        reason: 'Stable communication preference',
        score: 0.93,
        details: 'Durable personalization signal',
      },
    ],
  });

  const transcript = JSON.parse(await readFile(transcriptPath, 'utf8'));
  assert.equal(transcript.args[0], 'exec');
  assert.equal(transcript.args[1], '--sandbox');
  assert.equal(transcript.args[2], 'read-only');
  assert.ok(transcript.args.includes('--output-schema'));
  assert.ok(transcript.args.includes('-o'));
  assert.ok(transcript.args.includes('--model'));
  assert.ok(transcript.args.includes('gpt-5.4'));
  assert.match(transcript.prompt, /Only keep durable communication preferences/);
});

test('codex-filter handles file-stage responses', async (t) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-filter-file-'));
  const transcriptPath = path.join(tempRoot, 'codex-file-transcript.json');
  t.after(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  await writeExecutableScript(
    tempRoot,
    'codex',
    `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  input += chunk;
});
process.stdin.on('end', () => {
  const outputIndex = args.indexOf('-o');
  const outputPath = outputIndex >= 0 ? args[outputIndex + 1] : null;
  fs.writeFileSync(process.env.TRANSCRIPT_PATH, JSON.stringify({
    args,
    prompt: input
  }));
  fs.writeFileSync(outputPath, JSON.stringify({
    decision: {
      action: 'skip',
      reason: 'Clearly unrelated to the goal',
      score: 0.05,
      details: 'Preview reads like a build log.'
    }
  }));
});
`,
  );

  const result = await runExecutable({
    command: CODEX_WRAPPER,
    args: [],
    input: JSON.stringify(buildFileRequest()),
    env: buildEnv(tempRoot, transcriptPath),
  });

  assert.equal(result.code, 0);
  assert.deepEqual(JSON.parse(result.stdout), {
    promptVersion: 'codex-filter-file-v1',
    decision: {
      action: 'skip',
      reason: 'Clearly unrelated to the goal',
      score: 0.05,
      details: 'Preview reads like a build log.',
    },
  });
});

test('codex-filter fails on malformed provider output', async (t) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-filter-malformed-'));
  const transcriptPath = path.join(tempRoot, 'codex-malformed.json');
  t.after(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  await writeExecutableScript(
    tempRoot,
    'codex',
    `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const outputIndex = args.indexOf('-o');
const outputPath = outputIndex >= 0 ? args[outputIndex + 1] : null;
fs.writeFileSync(outputPath, 'not-json');
`,
  );

  const result = await runExecutable({
    command: CODEX_WRAPPER,
    args: [],
    input: JSON.stringify(buildSuggestionRequest()),
    env: buildEnv(tempRoot, transcriptPath),
  });

  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /Codex filter failed:/);
  assert.match(result.stderr, /Codex returned invalid JSON/);
});

test('codex-filter fails when the provider exits non-zero', async (t) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-filter-exit-'));
  const transcriptPath = path.join(tempRoot, 'codex-exit.json');
  t.after(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  await writeExecutableScript(
    tempRoot,
    'codex',
    `#!/usr/bin/env node
process.stderr.write('provider auth failed');
process.exit(7);
`,
  );

  const result = await runExecutable({
    command: CODEX_WRAPPER,
    args: [],
    input: JSON.stringify(buildSuggestionRequest()),
    env: buildEnv(tempRoot, transcriptPath),
  });

  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /codex exited with code 7/i);
});
