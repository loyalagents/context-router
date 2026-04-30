import { spawn } from 'node:child_process';

export function parseWrapperArgs(argv) {
  let model = null;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    switch (arg) {
      case '--model':
        model = requireValue(argv, ++index, '--model');
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return { model };
}

export async function readRequestFromStdin() {
  const raw = await readStdin();

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      error instanceof Error
        ? `Input request was not valid JSON: ${error.message}`
        : 'Input request was not valid JSON',
    );
  }

  validateRequest(parsed);
  return parsed;
}

export function buildProviderSchema(request, options = {}) {
  const strictOptionalFields = options.strictOptionalFields === true;
  const scoreSchema = strictOptionalFields
    ? {
        type: ['number', 'null'],
        minimum: 0,
        maximum: 1,
      }
    : {
        type: 'number',
        minimum: 0,
        maximum: 1,
      };
  const detailsSchema = strictOptionalFields
    ? {
        type: ['string', 'null'],
      }
    : {
        type: 'string',
      };

  if (request.stage === 'suggestion') {
    return {
      type: 'object',
      additionalProperties: false,
      required: ['decisions'],
      properties: {
        decisions: {
          type: 'array',
          minItems: request.suggestions.length,
          maxItems: request.suggestions.length,
          items: {
            type: 'object',
            additionalProperties: false,
            required: strictOptionalFields
              ? ['suggestionId', 'action', 'reason', 'score', 'details']
              : ['suggestionId', 'action', 'reason'],
            properties: {
              suggestionId: {
                type: 'string',
                enum: request.suggestions.map((suggestion) => suggestion.id),
              },
              action: {
                type: 'string',
                enum: ['apply', 'skip'],
              },
              reason: {
                type: 'string',
                minLength: 1,
              },
              score: scoreSchema,
              details: detailsSchema,
            },
          },
        },
      },
    };
  }

  return {
    type: 'object',
    additionalProperties: false,
    required: ['decision'],
    properties: {
      decision: {
        type: 'object',
        additionalProperties: false,
        required: strictOptionalFields
          ? ['action', 'reason', 'score', 'details']
          : ['action', 'reason'],
        properties: {
          action: {
            type: 'string',
            enum: ['analyze', 'skip'],
          },
          reason: {
            type: 'string',
            minLength: 1,
          },
          score: scoreSchema,
          details: detailsSchema,
        },
      },
    },
  };
}

export function buildPrompt(request) {
  if (request.stage === 'suggestion') {
    return [
      'You are a local AI filter for Context Router preference suggestions.',
      'Return JSON only. Do not include markdown fences or any explanation outside the JSON object.',
      'Use the run goal as the primary decision criterion.',
      'Decide exactly one action for every item in the "suggestions" array.',
      'The "filteredSuggestions" array is context only. Never revive it and never emit decisions for it.',
      'Use "apply" only for suggestions that look durable, user-specific, and aligned with the goal.',
      'Use "skip" for temporary, ambiguous, project-specific, or off-goal suggestions.',
      'When uncertain, prefer "skip".',
      '',
      'Request JSON:',
      JSON.stringify(request, null, 2),
    ].join('\n');
  }

  return [
    'You are a local AI filter for Context Router file triage.',
    'Return JSON only. Do not include markdown fences or any explanation outside the JSON object.',
    'Use the run goal as the primary decision criterion.',
    'Decide whether the file should be uploaded for backend analysis.',
    'Use "analyze" when the preview may contain durable user preferences or when the signal is uncertain.',
    'Use "skip" only when the preview is clearly irrelevant to the goal or lacks durable preference signal.',
    'Keep the reason short and specific.',
    '',
    'Request JSON:',
    JSON.stringify(request, null, 2),
  ].join('\n');
}

export function parseProviderJson(output, providerName) {
  const trimmed = output.trim();
  if (trimmed.length === 0) {
    throw new Error(`${providerName} returned empty output`);
  }

  try {
    return JSON.parse(trimmed);
  } catch (error) {
    throw new Error(
      error instanceof Error
        ? `${providerName} returned invalid JSON: ${error.message}`
        : `${providerName} returned invalid JSON`,
    );
  }
}

export function validateProviderResponse(request, candidate) {
  if (!isObject(candidate)) {
    throw new Error('Provider response must be a JSON object');
  }

  if (request.stage === 'suggestion') {
    if (!Array.isArray(candidate.decisions)) {
      throw new Error('Provider response must include a decisions array');
    }

    const expectedIds = new Set(request.suggestions.map((suggestion) => suggestion.id));
    const seenIds = new Set();

    const decisions = candidate.decisions.map((decision, index) => {
      if (!isObject(decision)) {
        throw new Error(`decisions[${index}] must be an object`);
      }

      const suggestionId = requireNonEmptyString(
        decision.suggestionId,
        `decisions[${index}].suggestionId`,
      );

      if (!expectedIds.has(suggestionId)) {
        throw new Error(`Provider returned unknown suggestionId "${suggestionId}"`);
      }

      if (seenIds.has(suggestionId)) {
        throw new Error(`Provider returned duplicate suggestionId "${suggestionId}"`);
      }
      seenIds.add(suggestionId);

      if (decision.action !== 'apply' && decision.action !== 'skip') {
        throw new Error(
          `decisions[${index}].action must be "apply" or "skip"`,
        );
      }

      return {
        suggestionId,
        action: decision.action,
        reason: requireNonEmptyString(
          decision.reason,
          `decisions[${index}].reason`,
        ),
        score: optionalScore(decision.score, `decisions[${index}].score`),
        details: optionalString(decision.details, `decisions[${index}].details`),
      };
    });

    if (seenIds.size !== expectedIds.size) {
      const missingIds = Array.from(expectedIds).filter((id) => !seenIds.has(id));
      throw new Error(
        `Provider must return exactly one decision per suggestion. Missing: ${missingIds.join(', ')}`,
      );
    }

    return { decisions };
  }

  if (!isObject(candidate.decision)) {
    throw new Error('Provider response must include a decision object');
  }

  if (candidate.decision.action !== 'analyze' && candidate.decision.action !== 'skip') {
    throw new Error('decision.action must be "analyze" or "skip"');
  }

  return {
    decision: {
      action: candidate.decision.action,
      reason: requireNonEmptyString(candidate.decision.reason, 'decision.reason'),
      score: optionalScore(candidate.decision.score, 'decision.score'),
      details: optionalString(candidate.decision.details, 'decision.details'),
    },
  };
}

export function buildPromptVersion(providerName, stage) {
  return `${providerName}-${stage}-v1`;
}

export function writeWrapperResponse(response) {
  process.stdout.write(`${JSON.stringify(response)}\n`);
}

export function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

export async function runProviderCommand(command, args, input) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let stdout = '';
    let stderr = '';

    const child = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
    });

    const finish = (fn) => {
      if (settled) {
        return;
      }
      settled = true;
      fn();
    };

    child.on('error', (error) => {
      finish(() =>
        reject(
          new Error(
            error instanceof Error
              ? `failed to start ${command}: ${error.message}`
              : `failed to start ${command}`,
          ),
        ),
      );
    });

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });

    child.on('close', (code, signal) => {
      finish(() => {
        if (code !== 0) {
          const details = stderr.trim() || stdout.trim() || 'no output';
          reject(
            new Error(
              `${command} exited with code ${code ?? 'unknown'}${signal ? ` (${signal})` : ''}: ${details}`,
            ),
          );
          return;
        }

        resolve(stdout);
      });
    });

    child.stdin.on('error', (error) => {
      finish(() =>
        reject(
          new Error(
            error instanceof Error
              ? `${command} stdin failed: ${error.message}`
              : `${command} stdin failed`,
          ),
        ),
      );
    });

    child.stdin.end(input);
  });
}

function validateRequest(candidate) {
  if (!isObject(candidate)) {
    throw new Error('Input request must be a JSON object');
  }

  if (candidate.stage !== 'suggestion' && candidate.stage !== 'file') {
    throw new Error('Input request stage must be "suggestion" or "file"');
  }

  requireNonEmptyString(candidate.goal, 'goal');

  if (!isObject(candidate.file)) {
    throw new Error('Input request must include a file object');
  }

  requireNonEmptyString(candidate.file.relativePath, 'file.relativePath');

  if (candidate.stage === 'suggestion') {
    if (!Array.isArray(candidate.suggestions)) {
      throw new Error('Suggestion-stage request must include suggestions');
    }
    if (!Array.isArray(candidate.filteredSuggestions)) {
      throw new Error('Suggestion-stage request must include filteredSuggestions');
    }
    if (!isObject(candidate.analysis)) {
      throw new Error('Suggestion-stage request must include analysis');
    }
    return;
  }

  if (!isObject(candidate.preview)) {
    throw new Error('File-stage request must include preview');
  }
}

async function readStdin() {
  let raw = '';
  process.stdin.setEncoding('utf8');

  for await (const chunk of process.stdin) {
    raw += chunk;
  }

  return raw;
}

function requireValue(argv, index, flag) {
  const value = argv[index];

  if (value == null) {
    throw new Error(`Missing value for ${flag}`);
  }

  return value;
}

function requireNonEmptyString(value, field) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string`);
  }

  return value;
}

function optionalString(value, field) {
  if (value == null) {
    return undefined;
  }

  if (typeof value !== 'string') {
    throw new Error(`${field} must be a string when provided`);
  }

  return value;
}

function optionalScore(value, field) {
  if (value == null) {
    return undefined;
  }

  if (typeof value !== 'number' || Number.isNaN(value) || value < 0 || value > 1) {
    throw new Error(`${field} must be a number between 0 and 1`);
  }

  return value;
}

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
