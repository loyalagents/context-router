import test from 'node:test';
import assert from 'node:assert/strict';
import {
  localFileMime,
  reviewLocalFile,
  validateLocalFile,
} from '../lib/local-upload.ts';
const policy = {
  mimeTypes: [
    'text/plain',
    'text/markdown',
    'application/json',
    'application/yaml',
    'application/x-yaml',
    'text/yaml',
    'application/pdf',
  ],
  maxFileSizeBytes: 10 * 1024 * 1024,
};

test('oversized and unsupported files are rejected before any raw read or consent dialog', async () => {
  let reads = 0;
  for (const file of [
    {
      name: 'oversized.txt',
      type: 'text/plain',
      size: policy.maxFileSizeBytes + 1,
    },
    { name: 'image.png', type: 'image/png', size: 10 },
  ]) {
    await assert.rejects(
      reviewLocalFile(
        {
          ...file,
          arrayBuffer() {
            reads++;
          },
        },
        policy,
        new AbortController().signal,
      ),
    );
  }
  assert.equal(reads, 0);
  for (const type of policy.mimeTypes)
    assert.equal(
      validateLocalFile({ name: 'synthetic', type, size: 100 }, policy),
      null,
    );
  assert.equal(
    localFileMime({ name: 'synthetic.md', type: '' }),
    'text/markdown',
  );
});

test('secret filenames and contents require explicit consent, and cancellation wins before publication', async () => {
  const previous = globalThis.window;
  let asks = 0,
    consent = false;
  globalThis.window = {
    confirm: () => {
      asks++;
      return consent;
    },
  };
  try {
    const ordinary = new File(['synthetic'], 'ordinary.txt', {
      type: 'text/plain',
    });
    assert.equal(
      await reviewLocalFile(ordinary, policy, new AbortController().signal),
      true,
    );
    assert.equal(asks, 0);
    for (const file of [
      new File(['synthetic'], 'credentials.txt', { type: 'text/plain' }),
      new File(['password=synthetic-only'], 'ordinary.txt', {
        type: 'text/plain',
      }),
    ]) {
      assert.equal(
        await reviewLocalFile(file, policy, new AbortController().signal),
        false,
      );
      consent = true;
      assert.equal(
        await reviewLocalFile(file, policy, new AbortController().signal),
        true,
      );
      consent = false;
    }
    assert.equal(asks, 4);
    const controller = new AbortController();
    await assert.rejects(
      reviewLocalFile(
        {
          name: 'synthetic.txt',
          type: 'text/plain',
          size: 1,
          async arrayBuffer() {
            controller.abort();
            return new Uint8Array([65]).buffer;
          },
        },
        policy,
        controller.signal,
      ),
      { name: 'AbortError' },
    );
    assert.equal(asks, 4);
  } finally {
    globalThis.window = previous;
  }
});
