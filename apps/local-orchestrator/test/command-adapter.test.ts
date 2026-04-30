import assert from 'node:assert/strict';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { CommandAIFilterAdapter } from '../src/ai/command-adapter';
import { RequestError } from '../src/server/request-error';

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

function buildSuggestionRequest() {
  return {
    stage: 'suggestion' as const,
    goal: 'Only keep communication preferences',
    file: {
      path: '/tmp/prefs.txt',
      relativePath: 'prefs.txt',
      extension: '.txt',
      sizeBytes: 15,
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
        confidence: 0.9,
        sourceSnippet: 'brief responses',
      },
    ],
    filteredSuggestions: [
      {
        id: 'analysis-1:filtered:1',
        slug: 'custom.unknown',
        operation: 'CREATE' as const,
        newValue: 'x',
        confidence: 0.1,
        sourceSnippet: 'unknown',
        filterReason: 'UNKNOWN_SLUG' as const,
      },
    ],
  };
}

function buildFileRequest() {
  return {
    stage: 'file' as const,
    goal: 'Only keep communication preferences',
    file: {
      path: '/tmp/prefs.txt',
      relativePath: 'prefs.txt',
      extension: '.txt',
      sizeBytes: 15,
      originalMimeType: 'text/plain',
      uploadMimeType: 'text/plain',
      uploadFileName: 'prefs.txt',
      coercedToPlainText: false,
    },
    preview: {
      text: 'brief responses',
      truncated: false,
      lineCount: 1,
      byteCount: 15,
      encoding: 'utf-8' as const,
    },
  };
}

test('CommandAIFilterAdapter parses valid suggestion-stage responses', async (t) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'command-adapter-valid-'));
  t.after(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  const scriptPath = await writeExecutableScript(
    tempRoot,
    'valid-adapter.js',
    `#!/usr/bin/env node
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  input += chunk;
});
process.stdin.on('end', () => {
  const payload = JSON.parse(input);
  process.stdout.write(JSON.stringify({
    promptVersion: 'prompt-v1',
    decisions: payload.suggestions.map((suggestion) => ({
      suggestionId: suggestion.id,
      action: 'apply',
      reason: 'Stable communication preference',
      score: 0.91,
      details: 'Durable personalization signal'
    }))
  }));
});
`,
  );

  const adapter = new CommandAIFilterAdapter({
    command: scriptPath,
    timeoutMs: 30000,
  });

  const response = await adapter.decideSuggestions(buildSuggestionRequest());

  assert.equal(response.promptVersion, 'prompt-v1');
  assert.deepEqual(response.decisions, [
    {
      suggestionId: 'analysis-1:candidate:1',
      action: 'apply',
      reason: 'Stable communication preference',
      score: 0.91,
      details: 'Durable personalization signal',
    },
  ]);
});

test('CommandAIFilterAdapter forwards command args to the child process', async (t) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'command-adapter-args-'));
  t.after(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  const scriptPath = await writeExecutableScript(
    tempRoot,
    'argv-adapter.js',
    `#!/usr/bin/env node
process.stdout.write(JSON.stringify({
  decisions: [
    {
      suggestionId: 'analysis-1:candidate:1',
      action: 'apply',
      reason: 'ok',
      details: JSON.stringify(process.argv.slice(2))
    }
  ]
}));
`,
  );

  const adapter = new CommandAIFilterAdapter({
    command: scriptPath,
    commandArgs: ['--model', 'sonnet', '--format', 'json'],
    timeoutMs: 30000,
  });

  const response = await adapter.decideSuggestions(buildSuggestionRequest());

  assert.equal(
    response.decisions[0].details,
    '["--model","sonnet","--format","json"]',
  );
});

test('CommandAIFilterAdapter rejects invalid JSON', async (t) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'command-adapter-json-'));
  t.after(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  const scriptPath = await writeExecutableScript(
    tempRoot,
    'invalid-json.js',
    `#!/usr/bin/env node
process.stdout.write('{not-json');
`,
  );

  const adapter = new CommandAIFilterAdapter({
    command: scriptPath,
    timeoutMs: 30000,
  });

  await assert.rejects(
    adapter.decideSuggestions(buildSuggestionRequest()),
    (error: unknown) =>
      error instanceof RequestError &&
      error.kind === 'invalid_response' &&
      error.message.includes('invalid JSON'),
  );
});

test('CommandAIFilterAdapter rejects malformed decision schemas', async (t) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'command-adapter-schema-'));
  t.after(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  const scriptPath = await writeExecutableScript(
    tempRoot,
    'bad-schema.js',
    `#!/usr/bin/env node
process.stdout.write(JSON.stringify({
  decisions: [
    {
      suggestionId: 'analysis-1:candidate:1',
      action: 'apply',
      reason: 'first'
    },
    {
      suggestionId: 'analysis-1:candidate:1',
      action: 'skip',
      reason: 'duplicate'
    }
  ]
}));
`,
  );

  const adapter = new CommandAIFilterAdapter({
    command: scriptPath,
    timeoutMs: 30000,
  });

  await assert.rejects(
    adapter.decideSuggestions(buildSuggestionRequest()),
    (error: unknown) =>
      error instanceof RequestError &&
      error.kind === 'invalid_response' &&
      error.message.includes('duplicate suggestionId'),
  );
});

test('CommandAIFilterAdapter surfaces non-zero exit failures', async (t) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'command-adapter-exit-'));
  t.after(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  const scriptPath = await writeExecutableScript(
    tempRoot,
    'exit-4.js',
    `#!/usr/bin/env node
process.stderr.write('adapter exploded');
process.exit(4);
`,
  );

  const adapter = new CommandAIFilterAdapter({
    command: scriptPath,
    timeoutMs: 30000,
  });

  await assert.rejects(
    adapter.decideSuggestions(buildSuggestionRequest()),
    (error: unknown) =>
      error instanceof RequestError &&
      error.kind === 'process' &&
      error.message.includes('exited with code 4') &&
      error.message.includes('adapter exploded'),
  );
});

test('CommandAIFilterAdapter surfaces bad command invocations', async (t) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'command-adapter-missing-'));
  t.after(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  const adapter = new CommandAIFilterAdapter({
    command: path.join(tempRoot, 'missing-command'),
    timeoutMs: 30000,
  });

  await assert.rejects(
    adapter.decideSuggestions(buildSuggestionRequest()),
    (error: unknown) =>
      error instanceof RequestError &&
      error.kind === 'process' &&
      error.message.includes('failed to start'),
  );
});

test('CommandAIFilterAdapter enforces timeouts', async (t) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'command-adapter-timeout-'));
  t.after(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  const scriptPath = await writeExecutableScript(
    tempRoot,
    'timeout.js',
    `#!/usr/bin/env node
setTimeout(() => {
  process.stdout.write(JSON.stringify({ decisions: [] }));
}, 250);
`,
  );

  const adapter = new CommandAIFilterAdapter({
    command: scriptPath,
    timeoutMs: 25,
  });

  await assert.rejects(
    adapter.decideSuggestions(buildSuggestionRequest()),
    (error: unknown) =>
      error instanceof RequestError &&
      error.kind === 'timeout' &&
      error.message.includes('timed out'),
  );
});

test('CommandAIFilterAdapter parses valid file-stage responses', async (t) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'command-adapter-file-'));
  t.after(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  const scriptPath = await writeExecutableScript(
    tempRoot,
    'file-stage.js',
    `#!/usr/bin/env node
process.stdout.write(JSON.stringify({
  promptVersion: 'file-prompt-v1',
  decision: {
    action: 'skip',
    reason: 'Build log with no stable preferences',
    score: 0.08,
    details: 'No durable personalization signal'
  }
}));
`,
  );

  const adapter = new CommandAIFilterAdapter({
    command: scriptPath,
    timeoutMs: 30000,
  });

  const response = await adapter.decideFile(buildFileRequest());

  assert.deepEqual(response, {
    promptVersion: 'file-prompt-v1',
    decision: {
      action: 'skip',
      reason: 'Build log with no stable preferences',
      score: 0.08,
      details: 'No durable personalization signal',
    },
  });
});

test('CommandAIFilterAdapter rejects invalid file-stage JSON', async (t) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'command-adapter-file-json-'));
  t.after(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  const scriptPath = await writeExecutableScript(
    tempRoot,
    'invalid-file-json.js',
    `#!/usr/bin/env node
process.stdout.write('{not-json');
`,
  );

  const adapter = new CommandAIFilterAdapter({
    command: scriptPath,
    timeoutMs: 30000,
  });

  await assert.rejects(
    adapter.decideFile(buildFileRequest()),
    (error: unknown) =>
      error instanceof RequestError &&
      error.kind === 'invalid_response' &&
      error.message.includes('invalid JSON'),
  );
});

test('CommandAIFilterAdapter rejects invalid file-stage actions', async (t) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'command-adapter-file-action-'));
  t.after(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  const scriptPath = await writeExecutableScript(
    tempRoot,
    'invalid-file-action.js',
    `#!/usr/bin/env node
process.stdout.write(JSON.stringify({
  decision: {
    action: 'review',
    reason: 'not valid'
  }
}));
`,
  );

  const adapter = new CommandAIFilterAdapter({
    command: scriptPath,
    timeoutMs: 30000,
  });

  await assert.rejects(
    adapter.decideFile(buildFileRequest()),
    (error: unknown) =>
      error instanceof RequestError &&
      error.kind === 'invalid_response' &&
      error.message.includes('action "analyze" or "skip"'),
  );
});

test('CommandAIFilterAdapter rejects file-stage responses without a reason', async (t) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'command-adapter-file-reason-'));
  t.after(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  const scriptPath = await writeExecutableScript(
    tempRoot,
    'missing-file-reason.js',
    `#!/usr/bin/env node
process.stdout.write(JSON.stringify({
  decision: {
    action: 'skip'
  }
}));
`,
  );

  const adapter = new CommandAIFilterAdapter({
    command: scriptPath,
    timeoutMs: 30000,
  });

  await assert.rejects(
    adapter.decideFile(buildFileRequest()),
    (error: unknown) =>
      error instanceof RequestError &&
      error.kind === 'invalid_response' &&
      error.message.includes('decision.reason'),
  );
});

test('CommandAIFilterAdapter surfaces file-stage non-zero exits', async (t) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'command-adapter-file-exit-'));
  t.after(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  const scriptPath = await writeExecutableScript(
    tempRoot,
    'file-exit-3.js',
    `#!/usr/bin/env node
process.stderr.write('file stage exploded');
process.exit(3);
`,
  );

  const adapter = new CommandAIFilterAdapter({
    command: scriptPath,
    timeoutMs: 30000,
  });

  await assert.rejects(
    adapter.decideFile(buildFileRequest()),
    (error: unknown) =>
      error instanceof RequestError &&
      error.kind === 'process' &&
      error.message.includes('exited with code 3') &&
      error.message.includes('file stage exploded'),
  );
});

test('CommandAIFilterAdapter enforces file-stage timeouts', async (t) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'command-adapter-file-timeout-'));
  t.after(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  const scriptPath = await writeExecutableScript(
    tempRoot,
    'file-timeout.js',
    `#!/usr/bin/env node
setTimeout(() => {
  process.stdout.write(JSON.stringify({
    decision: {
      action: 'analyze',
      reason: 'late response'
    }
  }));
}, 250);
`,
  );

  const adapter = new CommandAIFilterAdapter({
    command: scriptPath,
    timeoutMs: 25,
  });

  await assert.rejects(
    adapter.decideFile(buildFileRequest()),
    (error: unknown) =>
      error instanceof RequestError &&
      error.kind === 'timeout' &&
      error.message.includes('timed out'),
  );
});
