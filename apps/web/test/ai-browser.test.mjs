import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { browserFixture } from './browser-fixture.mjs';
const require = createRequire(
  new URL('../../backend/package.json', import.meta.url),
);
const { PDFDocument } = require('pdf-lib');

async function unlock(f, route = '/dashboard/preferences') {
  await f.page.goto(f.ready.origin + route);
  await f.page.getByLabel('Unlock token').fill(f.bootstrap);
  await f.page.getByRole('button', { name: 'Unlock local dashboard' }).click();
  await f.page.getByRole('button', { name: 'Lock dashboard' }).waitFor();
}

test(
  'no-model dashboard keeps literal search and manual memory usable while upload, smart search and form fill are disabled',
  { timeout: 60000 },
  async (t) => {
    const f = await browserFixture(t);
    await unlock(f);
    await f.graphql(
      'mutation { setPreference(input:{slug:"profile.first_name",value:"Synthetic literal"}) { id } }',
    );
    await f.page.reload();
    await f.page
      .getByLabel('Search query', { exact: true })
      .fill('Synthetic literal');
    await f.page
      .getByLabel('Literal search results')
      .getByText('"Synthetic literal"', { exact: false })
      .waitFor();
    assert.equal(
      await f.page
        .getByRole('button', { name: 'Smart search', exact: true })
        .isDisabled(),
      true,
    );
    await f.page.getByLabel('I reviewed the files', { exact: false }).check();
    assert.equal(
      await f.page.getByLabel('Choose documents', { exact: true }).isDisabled(),
      true,
    );
    await f.page.goto(f.ready.origin + '/dashboard/form-fill');
    await f.page.getByLabel('I reviewed this PDF', { exact: false }).check();
    assert.equal(await f.page.locator('#form-file').isDisabled(), true);
    assert.equal(
      await f.page
        .getByRole('button', { name: 'Fill PDF', exact: true })
        .isDisabled(),
      true,
    );
    assert.deepEqual(f.outbound, []);
    assert.deepEqual(f.errors, []);
  },
);

test(
  'qualified document analysis requires consent and reports independent applied and stale proposal outcomes',
  { timeout: 60000 },
  async (t) => {
    const f = await browserFixture(t, { model: true });
    await unlock(f);
    assert.equal(
      await f.page.getByLabel('Choose documents', { exact: true }).isDisabled(),
      true,
    );
    f.peer.state.reply = JSON.stringify({
      suggestions: [
        {
          slug: 'profile.first_name',
          operation: 'CREATE',
          newValue: 'Proposed first',
          confidence: 0.95,
          sourceSnippet: 'First: Proposed first',
        },
        {
          slug: 'profile.last_name',
          operation: 'CREATE',
          newValue: 'Proposed last',
          confidence: 0.95,
          sourceSnippet: 'Last: Proposed last',
        },
      ],
      documentSummary: 'Synthetic reviewed values',
    });
    await f.page.getByLabel('I reviewed the files', { exact: false }).check();
    await f.page
      .getByLabel('Choose documents', { exact: true })
      .setInputFiles({
        name: 'synthetic.md',
        mimeType: 'text/markdown',
        buffer: Buffer.from('First: Proposed first\nLast: Proposed last'),
      });
    await f.page
      .getByRole('button', { name: 'Apply 2 Preferences', exact: true })
      .waitFor();
    await f.graphql(
      'mutation { setPreference(input:{slug:"profile.first_name",value:"Intervening saved"}) { id } }',
    );
    await f.page
      .getByRole('button', { name: 'Apply 2 Preferences', exact: true })
      .click();
    await f.page.getByText('Applied.', { exact: true }).waitFor();
    await f.page
      .getByText('Saved state changed since review.', { exact: false })
      .waitFor();
    assert.equal(
      await f.page
        .getByLabel('Select profile.first_name', { exact: true })
        .isDisabled(),
      true,
    );
    assert.equal(
      await f.page
        .getByLabel('Select profile.last_name', { exact: true })
        .isDisabled(),
      true,
    );
    const saved = await f.graphql('{ activePreferences { slug value } }');
    assert.equal(
      saved.activePreferences.find((p) => p.slug === 'profile.first_name')
        .value,
      'Intervening saved',
    );
    assert.equal(
      saved.activePreferences.find((p) => p.slug === 'profile.last_name').value,
      'Proposed last',
    );
    assert.equal(f.peer.state.completionBodies.length, 1);
    assert.deepEqual(f.outbound, []);
    assert.deepEqual(f.errors, []);
    assert.deepEqual(f.policyViolations, []);
  },
);

test(
  'local PDF controls send v2, preserve occupied fields and authorize only named overwrites',
  { timeout: 60000 },
  async (t) => {
    const f = await browserFixture(t, { model: true });
    await unlock(f, '/dashboard/form-fill');
    await f.graphql(
      'mutation { setPreference(input:{slug:"profile.first_name",value:"New synthetic"}) { id } }',
    );
    const pdf = await PDFDocument.create();
    const page = pdf.addPage();
    const form = pdf.getForm();
    const occupied = form.createTextField('occupied');
    occupied.addToPage(page);
    occupied.setText('Keep synthetic');
    const empty = form.createTextField('empty');
    empty.addToPage(page);
    const buffer = Buffer.from(await pdf.save());
    f.peer.state.reply = JSON.stringify({
      fillActions: ['occupied', 'empty'].map((fieldName) => ({
        fieldName,
        action: 'SET_TEXT',
        value: 'New synthetic',
        sourceSlugs: ['profile.first_name'],
        confidence: 1,
      })),
    });
    await f.page.getByLabel('I reviewed this PDF', { exact: false }).check();
    await f.page
      .locator('#form-file')
      .setInputFiles({
        name: 'synthetic.pdf',
        mimeType: 'application/pdf',
        buffer,
      });
    const response = f.page.waitForResponse((response) =>
      response.url().endsWith('/api/form-fill/pdf'),
    );
    await f.page.getByRole('button', { name: 'Fill PDF', exact: true }).click();
    const first = await (await response).json();
    const firstForm = (
      await PDFDocument.load(Buffer.from(first.filledPdfBase64, 'base64'))
    ).getForm();
    assert.equal(
      firstForm.getTextField('occupied').getText(),
      'Keep synthetic',
    );
    assert.equal(firstForm.getTextField('empty').getText(), 'New synthetic');
    await f.page
      .getByText('Existing value preserved', { exact: false })
      .waitFor();
    assert.equal(
      await f.page
        .getByRole('button', { name: 'Fill PDF', exact: true })
        .isDisabled(),
      true,
      'input released after completion',
    );
    assert.equal(await f.page.locator('#form-file').inputValue(), '');
    await f.page
      .locator('#form-file')
      .setInputFiles({
        name: 'synthetic.pdf',
        mimeType: 'application/pdf',
        buffer,
      });
    await f.page
      .getByLabel('Fields to overwrite', { exact: true })
      .fill('occupied');
    const secondResponse = f.page.waitForResponse((response) =>
      response.url().endsWith('/api/form-fill/pdf'),
    );
    await f.page.getByRole('button', { name: 'Fill PDF', exact: true }).click();
    const second = await (await secondResponse).json();
    assert.equal(
      (await PDFDocument.load(Buffer.from(second.filledPdfBase64, 'base64')))
        .getForm()
        .getTextField('occupied')
        .getText(),
      'New synthetic',
    );
    assert.equal(f.peer.state.completionBodies.length, 2);
    assert.deepEqual(f.errors, []);
    assert.deepEqual(f.policyViolations, []);
  },
);

test(
  'cancelled file reads cannot clear a replacement batch, and an expired batch never publishes earlier proposals',
  { timeout: 60000 },
  async (t) => {
    const f = await browserFixture(t, { model: true });
    await unlock(f);
    f.peer.state.reply = JSON.stringify({
      suggestions: [
        {
          slug: 'profile.first_name',
          operation: 'CREATE',
          newValue: 'Proposed',
          confidence: 1,
          sourceSnippet: 'Synthetic proposed',
        },
      ],
      documentSummary: 'Synthetic',
    });
    await f.page.evaluate(() => {
      const read = File.prototype.arrayBuffer;
      window.releaseReads = {};
      File.prototype.arrayBuffer = function () {
        if (!['cancelled.txt', 'replacement-a.txt'].includes(this.name))
          return read.call(this);
        return new Promise((resolve) => {
          window.releaseReads[this.name] = async () =>
            resolve(await read.call(this));
        });
      };
    });
    await f.page.getByLabel('I reviewed the files', { exact: false }).check();
    const choose = f.page.getByLabel('Choose documents', { exact: true });
    const file = (name) => ({
      name,
      mimeType: 'text/plain',
      buffer: Buffer.from('Synthetic proposed'),
    });
    await choose.setInputFiles(file('cancelled.txt'));
    await f.page.waitForFunction(() => !!window.releaseReads['cancelled.txt']);
    await f.page.getByRole('button', { name: 'Cancel operation' }).click();
    await choose.setInputFiles([
      file('replacement-a.txt'),
      file('replacement-b.txt'),
    ]);
    await f.page.waitForFunction(
      () => !!window.releaseReads['replacement-a.txt'],
    );
    await f.page.evaluate(async () => {
      await window.releaseReads['cancelled.txt']();
    });
    await f.page.evaluate(async () => {
      await window.releaseReads['replacement-a.txt']();
    });
    await f.page.getByRole('button', { name: 'Apply 2 Preferences' }).waitFor();
    assert.equal(
      f.peer.state.completionBodies.length,
      2,
      'both replacement files complete',
    );
    await f.page.reload();
    await f.page.getByLabel('I reviewed the files', { exact: false }).check();
    await f.page
      .locator('input[aria-label="Choose documents"]')
      .locator('..')
      .locator('..')
      .getByLabel('Operation deadline')
      .selectOption('5');
    f.peer.state.hook = (request, response) => {
      if (
        request.url === '/completion' &&
        f.peer.state.completionBodies.length === 3
      ) {
        response.writeHead(200, { 'content-type': 'text/event-stream' });
        response.write(
          'data: ' +
            JSON.stringify({
              index: 0,
              stop: false,
              content: '',
              tokens_predicted: 0,
              tokens_evaluated: 10,
              prompt_progress: {
                total: 10,
                cache: 0,
                processed: 0,
                time_ms: 0,
              },
            }) +
            '\n\n',
        );
        return true;
      }
      return false;
    };
    await choose.setInputFiles([
      file('first-before-deadline.txt'),
      file('second-past-deadline.txt'),
    ]);
    await f.page
      .getByRole('alert')
      .filter({ hasText: /deadline/ })
      .waitFor({ timeout: 15000 });
    assert.equal(
      await f.page.getByRole('button', { name: /Apply .* Preference/ }).count(),
      0,
    );
    assert.equal(
      (await f.graphql('{ activePreferences { id } }')).activePreferences
        .length,
      0,
    );
  },
);
