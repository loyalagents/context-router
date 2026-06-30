import { spawn } from 'node:child_process';

export const CLAUDE_CODE_THINKING_MODES = new Set([
  'default',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
]);

export const DEFAULT_CLAUDE_CODE_TIMEOUT_MS = 900_000;
export const CLAUDE_CODE_DIRECT_TOOLS = 'Read,Glob,Grep';

export function validateThinkingMode(thinkingMode) {
  if (!CLAUDE_CODE_THINKING_MODES.has(thinkingMode)) {
    return `--thinking-mode must be one of ${[...CLAUDE_CODE_THINKING_MODES].join(', ')}.`;
  }
  return null;
}

export function thinkingMetadata({ thinkingMode = 'default', source = 'manual' } = {}) {
  return {
    mode: thinkingMode,
    budget: null,
    source,
  };
}

export function modelMetadata({
  model,
  modelLabel,
  modelSource,
  modelLabelSource,
  source,
} = {}) {
  const label = model ?? modelLabel ?? null;
  return {
    label,
    source: label
      ? (model ? modelSource : modelLabelSource) ?? source ?? 'manual'
      : 'unspecified',
  };
}

export function buildClaudeCodeArgs({
  model,
  thinkingMode = 'default',
  mcpConfig,
  strictMcpConfig = false,
  settings,
  settingSources,
  tools = CLAUDE_CODE_DIRECT_TOOLS,
  allowedTools = tools,
  permissionMode = 'dontAsk',
  outputFormat = 'stream-json',
  verbose = true,
  noSessionPersistence = true,
  disableSlashCommands = false,
  safeMode = false,
} = {}) {
  const thinkingError = validateThinkingMode(thinkingMode);
  if (thinkingError) throw new Error(thinkingError);

  const args = [
    '--print',
    '--permission-mode',
    permissionMode,
    '--output-format',
    outputFormat,
  ];
  if (verbose) args.push('--verbose');
  if (noSessionPersistence) args.push('--no-session-persistence');
  if (safeMode) args.push('--safe-mode');
  if (disableSlashCommands) args.push('--disable-slash-commands');
  if (model) args.push('--model', model);
  if (thinkingMode && thinkingMode !== 'default') args.push('--effort', thinkingMode);
  if (mcpConfig) args.push('--mcp-config', mcpConfig);
  if (strictMcpConfig) args.push('--strict-mcp-config');
  if (settings) args.push('--settings', settings);
  if (settingSources) args.push('--setting-sources', settingSources);
  if (tools !== undefined) args.push('--tools', tools);
  if (allowedTools !== undefined) args.push('--allowedTools', allowedTools);
  return args;
}

export async function runClaudeCodePrompt({
  prompt,
  cwd,
  env = process.env,
  command = 'claude',
  timeoutMs = DEFAULT_CLAUDE_CODE_TIMEOUT_MS,
  args = buildClaudeCodeArgs(),
} = {}) {
  if (typeof prompt !== 'string') {
    throw new Error('Claude Code prompt must be a string.');
  }
  if (!cwd) {
    throw new Error('Claude Code cwd is required.');
  }

  const startedAtMs = Date.now();
  const result = await spawnClaude({ command, args, cwd, env, prompt, timeoutMs });
  const durationMs = Math.max(0, Date.now() - startedAtMs);
  const text = extractClaudeCodeText(result.stdout);
  return {
    ...result,
    durationMs,
    text,
    command: [command, ...args.map(shellDisplayArg)].join(' '),
  };
}

export function extractClaudeCodeText(stdout) {
  const lines = String(stdout ?? '').split(/\r?\n/).filter((line) => line.trim());
  const chunks = [];
  let resultText = null;

  for (const line of lines) {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    const extracted = textFromStreamEvent(event);
    if (event?.type === 'result' && typeof extracted === 'string') {
      resultText = extracted;
      continue;
    }
    if (typeof extracted === 'string') chunks.push(extracted);
  }

  if (typeof resultText === 'string') return resultText;
  if (chunks.length) return chunks.join('');
  return String(stdout ?? '');
}

export function buildClaudeTranscript({ command, stdout, stderr, timedOut, exitCode }) {
  return [
    `$ ${command}`,
    `exitCode=${exitCode}`,
    `timedOut=${Boolean(timedOut)}`,
    typeof stdout === 'string' ? `[stdout]\n${stdout}` : null,
    typeof stderr === 'string' ? `[stderr]\n${stderr}` : null,
  ]
    .filter(Boolean)
    .join('\n\n')
    .concat('\n');
}

function spawnClaude({ command, args, cwd, env, prompt, timeoutMs }) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let spawnError = null;
    let timedOut = false;
    let closed = false;
    let forceKillTimeout = null;

    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      forceKillTimeout = setTimeout(() => {
        if (!closed) child.kill('SIGKILL');
      }, 2_000);
      forceKillTimeout.unref();
    }, timeoutMs);
    timeout.unref();

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', (error) => {
      spawnError = error;
    });
    child.stdin.on('error', () => {
      // The process may exit before reading stdin; close handling reports it.
    });
    child.on('close', (code, signal) => {
      closed = true;
      clearTimeout(timeout);
      if (forceKillTimeout) clearTimeout(forceKillTimeout);
      const exitCode = timedOut || spawnError ? 1 : Number.isInteger(code) ? code : 1;
      resolve({
        exitCode,
        signal,
        stdout,
        stderr,
        timedOut,
        error: spawnError,
      });
    });
    child.stdin.end(prompt);
  });
}

function textFromStreamEvent(event) {
  if (!event || typeof event !== 'object') return null;
  if (typeof event.result === 'string') return event.result;
  if (typeof event.text === 'string') return event.text;
  if (typeof event.delta?.text === 'string') return event.delta.text;
  if (typeof event.content === 'string') return event.content;

  const content = event.message?.content ?? event.content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (typeof part?.text === 'string') return part.text;
        if (typeof part?.input === 'string') return part.input;
        return '';
      })
      .join('');
  }
  return null;
}

function shellDisplayArg(value) {
  if (/^[A-Za-z0-9_./:=@+,-]+$/.test(value)) return value;
  return JSON.stringify(value);
}
