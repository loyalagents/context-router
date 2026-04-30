import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { CommandAIFilterAdapter } from '../src/ai/command-adapter';
import { buildTextPreview } from '../src/file-preview';
import { AIFileFilter } from '../src/filters/ai-file-filter';

test('buildTextPreview truncates large text files conservatively', async (t) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'file-preview-'));
  t.after(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  const largeText = Array.from({ length: 250 }, (_, index) => `line-${index + 1}`).join('\n');
  const filePath = path.join(tempRoot, 'prefs.txt');
  await writeFile(filePath, largeText, 'utf8');

  const preview = await buildTextPreview({
    path: filePath,
    relativePath: 'prefs.txt',
    sizeBytes: Buffer.byteLength(largeText),
    extension: '.txt',
    originalMimeType: 'text/plain',
    uploadMimeType: 'text/plain',
    uploadFileName: 'prefs.txt',
    coercedToPlainText: false,
  });

  assert.ok(preview);
  assert.equal(preview.truncated, true);
  assert.equal(preview.lineCount, 200);
  assert.equal(preview.encoding, 'utf-8');
  assert.match(preview.text, /^line-1/);
});

test('buildTextPreview enforces the byte cap for long single-line files', async (t) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'file-preview-bytes-'));
  t.after(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  const byteHeavyText = 'a'.repeat(9000);
  const filePath = path.join(tempRoot, 'prefs.txt');
  await writeFile(filePath, byteHeavyText, 'utf8');

  const preview = await buildTextPreview({
    path: filePath,
    relativePath: 'prefs.txt',
    sizeBytes: Buffer.byteLength(byteHeavyText),
    extension: '.txt',
    originalMimeType: 'text/plain',
    uploadMimeType: 'text/plain',
    uploadFileName: 'prefs.txt',
    coercedToPlainText: false,
  });

  assert.ok(preview);
  assert.equal(preview.truncated, true);
  assert.equal(preview.byteCount, 8 * 1024);
  assert.equal(preview.lineCount, 1);
  assert.equal(preview.text.length, 8 * 1024);
});

test('AIFileFilter bypasses non-text-like files in V1 file-stage mode', async () => {
  const filter = new AIFileFilter({
    goal: 'Only keep durable communication preferences',
    adapter: {
      name: 'command',
      decideFile: async () => {
        throw new Error('adapter should not be called for non-text previews');
      },
      decideSuggestions: async () => {
        throw new Error('not used');
      },
    } as unknown as CommandAIFilterAdapter,
  });

  const decision = await filter.decide({
    path: '/tmp/photo.jpg',
    relativePath: 'photo.jpg',
    sizeBytes: 10,
    extension: '.jpg',
    originalMimeType: 'image/jpeg',
    uploadMimeType: 'image/jpeg',
    uploadFileName: 'photo.jpg',
    coercedToPlainText: false,
  });

  assert.deepEqual(decision, {
    action: 'analyze',
    reason: 'ai_bypass_non_text_preview',
    details: 'File-stage AI filtering is bypassed for non-text-like files in V1.',
    source: 'bypass',
  });
});

test('buildTextPreview supports markdown and yaml upload MIME types', async (t) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'file-preview-markdown-'));
  t.after(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  const markdownPath = path.join(tempRoot, 'prefs.md');
  const yamlPath = path.join(tempRoot, 'prefs.yaml');
  await writeFile(markdownPath, '# Preferences\n- brief\n', 'utf8');
  await writeFile(yamlPath, 'tone: brief\n', 'utf8');

  const markdownPreview = await buildTextPreview({
    path: markdownPath,
    relativePath: 'prefs.md',
    sizeBytes: 22,
    extension: '.md',
    originalMimeType: 'text/markdown',
    uploadMimeType: 'text/markdown',
    uploadFileName: 'prefs.md',
    coercedToPlainText: false,
  });

  const yamlPreview = await buildTextPreview({
    path: yamlPath,
    relativePath: 'prefs.yaml',
    sizeBytes: 12,
    extension: '.yaml',
    originalMimeType: 'application/yaml',
    uploadMimeType: 'application/yaml',
    uploadFileName: 'prefs.yaml',
    coercedToPlainText: false,
  });

  assert.ok(markdownPreview);
  assert.match(markdownPreview.text, /^# Preferences/);
  assert.ok(yamlPreview);
  assert.match(yamlPreview.text, /^tone: brief/);
});
