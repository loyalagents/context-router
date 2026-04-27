import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import test from 'node:test';
import { discoverFiles } from '../src/discover';

test('discoverFiles recurses visible files, skips hidden entries, and coerces markdown', async (t) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'local-orchestrator-'));
  t.after(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  await mkdir(path.join(tempRoot, 'nested'));
  await mkdir(path.join(tempRoot, '.hidden-dir'));
  await writeFile(path.join(tempRoot, 'notes.md'), '# heading\n- item\n');
  await writeFile(path.join(tempRoot, 'prefs.json'), '{"tone":"brief"}\n');
  await writeFile(path.join(tempRoot, 'nested', 'photo.jpg'), 'jpg-bytes');
  await writeFile(path.join(tempRoot, 'nested', 'ignore.docx'), 'docx');
  await writeFile(path.join(tempRoot, '.env'), 'SECRET=true');
  await writeFile(path.join(tempRoot, '.hidden-dir', 'inside.txt'), 'hidden');

  const discovery = await discoverFiles(tempRoot);

  assert.equal(discovery.hiddenEntriesSkipped, 2);
  assert.equal(discovery.files.length, 4);

  const noteRecord = discovery.files.find(
    (record) => record.relativePath === 'notes.md',
  );
  assert.ok(noteRecord?.file);
  assert.equal(noteRecord.file.uploadMimeType, 'text/plain');
  assert.equal(noteRecord.file.coercedToPlainText, true);

  const jsonRecord = discovery.files.find(
    (record) => record.relativePath === 'prefs.json',
  );
  assert.equal(jsonRecord?.discovery.action, 'analyze');
  assert.equal(jsonRecord?.uploadMimeType, 'application/json');

  const nestedJpeg = discovery.files.find(
    (record) => record.relativePath === path.join('nested', 'photo.jpg'),
  );
  assert.equal(nestedJpeg?.uploadMimeType, 'image/jpeg');

  const unsupported = discovery.files.find(
    (record) => record.relativePath === path.join('nested', 'ignore.docx'),
  );
  assert.equal(unsupported?.discovery.action, 'skip');
  assert.equal(unsupported?.discovery.reason, 'unsupported_extension');

  const noteStats = await stat(path.join(tempRoot, 'notes.md'));
  assert.equal(noteRecord?.sizeBytes, noteStats.size);
});

test('discoverFiles recognizes markdown yaml jpeg variants and skips dotfiles', async (t) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'local-orchestrator-'));
  t.after(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  await writeFile(path.join(tempRoot, 'guide.markdown'), '## preferences\n');
  await writeFile(path.join(tempRoot, 'config.yml'), 'tone: brief\n');
  await writeFile(path.join(tempRoot, 'config.yaml'), 'locale: us\n');
  await writeFile(path.join(tempRoot, 'image.jpeg'), 'jpeg-bytes');
  await writeFile(path.join(tempRoot, '.prettierrc'), '{ "semi": false }\n');

  const discovery = await discoverFiles(tempRoot);

  assert.equal(discovery.hiddenEntriesSkipped, 1);
  assert.equal(
    discovery.files.some((record) => record.relativePath === '.prettierrc'),
    false,
  );

  const markdownRecord = discovery.files.find(
    (record) => record.relativePath === 'guide.markdown',
  );
  assert.equal(markdownRecord?.file?.uploadMimeType, 'text/plain');
  assert.equal(markdownRecord?.file?.coercedToPlainText, true);

  const ymlRecord = discovery.files.find(
    (record) => record.relativePath === 'config.yml',
  );
  assert.equal(ymlRecord?.file?.uploadMimeType, 'text/plain');
  assert.equal(ymlRecord?.file?.coercedToPlainText, true);

  const yamlRecord = discovery.files.find(
    (record) => record.relativePath === 'config.yaml',
  );
  assert.equal(yamlRecord?.file?.uploadMimeType, 'text/plain');
  assert.equal(yamlRecord?.file?.coercedToPlainText, true);

  const jpegRecord = discovery.files.find(
    (record) => record.relativePath === 'image.jpeg',
  );
  assert.equal(jpegRecord?.file?.uploadMimeType, 'image/jpeg');
  assert.equal(jpegRecord?.file?.coercedToPlainText, false);
});
