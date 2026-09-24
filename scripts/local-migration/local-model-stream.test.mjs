import assert from 'node:assert/strict';
import test from 'node:test';
import { CompletionStream } from './fixtures/local-model-feasibility/stream.mjs';

const initial = () => ({ index: 0, stop: false, content: '', tokens_predicted: 0, tokens_evaluated: 10,
  prompt_progress: { total: 10, cache: 0, processed: 0, time_ms: 0 }, id_slot: -1 });
const partial = (content = 'hello', tokens = 1) => ({ index: 0, stop: false, content,
  tokens_predicted: tokens, tokens_evaluated: 10 });
const terminal = (overrides = {}) => ({ index: 0, stop: true, content: '', tokens_predicted: 2,
  tokens_evaluated: 10, truncated: false, stop_type: 'eos', ...overrides });
const encode = (...events) => Buffer.from(events.map((value) => `data: ${JSON.stringify(value)}\n\n`).join(''));

test('recognizes own admission and buffers split UTF-8/events until a successful terminal response', () => {
  const seen = [];
  const stream = new CompletionStream({ onProgress: (value) => seen.push(value) });
  const bytes = encode(initial(), partial('hé🦙'), terminal());
  for (const byte of bytes) stream.push(Buffer.from([byte]));
  const result = stream.finish();
  assert.equal(result.text, 'hé🦙');
  assert.equal(result.inputTokens, 10);
  assert.equal(result.outputTokens, 2);
  assert.equal(stream.witnessed, true);
  assert.equal(seen[0].admitted, true);
  assert.equal(seen[0].decoded, 0);
  assert.equal(JSON.stringify(seen).includes('hé'), false);
});

test('HTTP headers, foreign slot IDs and partial output alone cannot supply admission', () => {
  for (const event of [partial(), { ...initial(), index: 1 }, { ...initial(), content: 'early' },
    { ...initial(), prompt_progress: { total: 10, cache: 1, processed: 0, time_ms: 0 } }]) {
    const stream = new CompletionStream();
    assert.throws(() => stream.push(encode(event)), /Invalid local model stream/);
    assert.equal(stream.witnessed, false);
  }
});

test('rejects repeated/out-of-order markers, errors and malformed JSON without provider text', () => {
  for (const body of [encode(initial(), initial()), encode(initial(), terminal(), terminal()),
    encode(initial(), { error: { message: 'SECRET_SENTINEL' } }), Buffer.from('data: nope\n\n'),
    Buffer.from('event: error\ndata: {"secret":"SECRET_SENTINEL"}\n\n')]) {
    const stream = new CompletionStream();
    assert.throws(() => stream.push(body), (error) => error.message === 'Invalid local model stream');
  }
});

test('rejects truncation, token limit, wrong totals and nonmonotonic output counts', () => {
  for (const ending of [terminal({ truncated: true }), terminal({ stop_type: 'limit' }),
    terminal({ tokens_evaluated: 11 }), terminal({ tokens_predicted: 0 })]) {
    const stream = new CompletionStream();
    stream.push(encode(initial(), partial()));
    assert.throws(() => stream.push(encode(ending)), /Invalid local model stream/);
  }
});

test('EOF never salvages partial output and malformed UTF-8 is rejected', () => {
  for (const body of [encode(initial(), partial()), encode(initial()).subarray(0, -1),
    Buffer.from([0xc3, 0x28]), Buffer.from([0xf0, 0x9f])]) {
    const stream = new CompletionStream();
    assert.throws(() => { stream.push(body); stream.finish(); }, /Invalid local model stream/);
  }
});

test('enforces wire/event/count/output bounds before unbounded accumulation', () => {
  for (const [limits, body] of [
    [{ wireBytes: 10 }, encode(initial())],
    [{ eventBytes: 30 }, Buffer.from(`data: ${'x'.repeat(31)}`)],
    [{ events: 1 }, encode(initial(), partial())],
    [{ outputBytes: 4 }, encode(initial(), partial('12345'))],
  ]) {
    const stream = new CompletionStream({ limits });
    assert.throws(() => stream.push(body), /Invalid local model stream/);
  }
});

test('validates bounded progress without treating delayed receipt as a prefill timestamp', () => {
  const seen = [];
  const stream = new CompletionStream({ onProgress: (value) => seen.push(value) });
  stream.push(encode(initial(), { ...initial(), prompt_progress: { total: 10, cache: 0, processed: 5, time_ms: 3 } }));
  assert.equal(seen[1].processed, 5);
  assert.equal(seen[1].admitted, false);
  assert.throws(() => stream.push(encode({ ...initial(), prompt_progress: { total: 10, cache: 0, processed: 4, time_ms: 4 } })), /Invalid local model stream/);
});
