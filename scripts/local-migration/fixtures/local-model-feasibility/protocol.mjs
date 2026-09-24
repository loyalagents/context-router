import { probeJson } from './client.mjs';
import { userMessage } from './freeze.mjs';
export async function renderForCompletion(configuration, prompt, file, deadline, probe = probeJson) {
  const message = userMessage(prompt, file);
  const remaining = () => {
    const value = deadline - performance.now();
    if (!Number.isFinite(value) || value <= 0) throw new Error('Probe preparation deadline');
    return Math.min(value, 5000);
  };
  if (Buffer.byteLength(message) > 128 * 1024) throw new Error('Probe input limit');
  const rendered = (await probe(configuration, '/apply-template', { messages: [{ role: 'user', content: message }] }, { timeoutMs: remaining() })).value?.prompt;
  if (typeof rendered !== 'string' || !rendered.length || Buffer.byteLength(rendered) > 128 * 1024 ||
      rendered.lastIndexOf('</think>') < 0 || rendered.lastIndexOf('<think>') > rendered.lastIndexOf('</think>')) throw new Error('Probe non-thinking template mismatch');
  const tokens = (await probe(configuration, '/tokenize', { content: rendered, add_special: false, parse_special: true, with_pieces: false }, { timeoutMs: remaining() })).value?.tokens;
  remaining();
  if (!Array.isArray(tokens) || !tokens.length || tokens.length > 12000 || tokens.some((token) => !Number.isInteger(token) || token < 0)) throw new Error('Probe context limit');
  return { prompt: rendered, inputTokens: tokens.length };
}
