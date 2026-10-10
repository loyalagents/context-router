import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { browserFixture } from './browser-fixture.mjs';
import { greekPdfFixture } from '../../backend/test/local-model/fixtures/pdf-fixtures.mjs';
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

test('file-picker focus and successive uploads never start competing model status checks', { timeout: 60000 }, async (t) => {
  const f = await browserFixture(t, { model: true });
  await unlock(f);
  f.peer.state.reply = JSON.stringify({ suggestions: [{ slug: 'profile.full_name', operation: 'CREATE', newValue: 'Αθήνα', confidence: 1, sourceSnippet: 'Αθήνα' }], documentSummary: 'Synthetic PDF only' });
  const pdf = { name: 'synthetic-focus.pdf', mimeType: 'application/pdf', buffer: Buffer.from((await greekPdfFixture()).bytes) };
  let holdStatus = true, entered, release;
  const reached = new Promise(resolve => { entered = resolve; });
  const held = new Promise(resolve => { release = resolve; });
  f.peer.state.hook = async request => {
    if (holdStatus && request.url === '/props') { entered(); await held; }
    return false;
  };
  const capabilityRequests = [];
  f.page.on('request', request => { if (request.url().endsWith('/api/local/capabilities')) capabilityRequests.push(request.url()); });
  await f.page.getByLabel('I reviewed the files', { exact: false }).check();
  const recheckRequest = f.page.waitForRequest(request => /\/api\/local\/(session|capabilities)$/.test(request.url()));
  const recheckResponse = f.page.waitForResponse(response => /\/api\/local\/(session|capabilities)$/.test(response.url()));
  await f.page.evaluate(() => window.dispatchEvent(new Event('focus')));
  const route = new URL((await recheckRequest).url()).pathname;
  try {
    if (route.endsWith('/capabilities')) await reached;
    else { await recheckResponse; holdStatus = false; }
    const uploaded = f.page.waitForResponse(response => response.url().endsWith('/api/preferences/analysis'));
    await f.page.getByLabel('Choose documents', { exact: true }).setInputFiles(pdf);
    const result = await (await uploaded).json();
    console.log(JSON.stringify({ focusRoute: route, uploadStatus: result.status, completionCount: f.peer.state.completionBodies.length }));
    assert.equal(result.status, 'success', result.statusReason);
  } finally { holdStatus = false; release(); await recheckResponse; }
  assert.equal(route, '/api/local/session');
  await f.page.getByRole('button', { name: 'Try Another Upload' }).click();
  await f.page.getByLabel('I reviewed the files', { exact: false }).check();
  const second = f.page.waitForResponse(response => response.url().endsWith('/api/preferences/analysis'));
  await f.page.getByLabel('Choose documents', { exact: true }).setInputFiles(pdf);
  assert.equal((await (await second).json()).status, 'success');
  await f.page.getByRole('button', { name: 'Try Another Upload' }).waitFor();
  assert.equal(f.peer.state.completionBodies.length, 2);
  assert.match(f.peer.state.completionBodies[0].prompt, /Αθήνα/);
  assert.deepEqual((await f.graphql('{ activePreferences { id } }')).activePreferences, []);
  for (const event of ['pageshow', 'visibilitychange']) {
    const response = f.page.waitForResponse(r => r.url().endsWith('/api/local/session'));
    await f.page.evaluate(event => (event === 'visibilitychange' ? document : window).dispatchEvent(new Event(event)), event);
    assert.equal((await response).status(), 200);
  }
  assert.equal(capabilityRequests.length, 0, 'no automatic readiness probes');
  const checked = f.page.waitForResponse(response => response.url().endsWith('/api/local/capabilities'));
  await f.page.getByRole('button', { name: 'Check model status' }).last().click();
  assert.equal((await checked).status(), 200);
  assert.equal(capabilityRequests.length, 1, 'explicit check still qualifies the model');
});

for (const remainingMilliseconds of [0, 8 * 60 * 60 * 1000 + 1, 100])
  test(`passive session revalidation fails closed for invalid or elapsed lifetime ${remainingMilliseconds}`, { timeout: 60000 }, async (t) => {
    const f = await browserFixture(t);
    await unlock(f);
    await f.page.route('**/api/local/session', async route => {
      // Hold the valid short lifetime beyond its request-start bound.
      if (remainingMilliseconds === 100) await new Promise(resolve => setTimeout(resolve, 150));
      await route.fulfill({ json: { remainingMilliseconds } });
    });
    await f.page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await f.page.getByLabel('Unlock token').waitFor({ timeout: 3000 });
    assert.equal(await f.page.evaluate(() => sessionStorage.length), 0);
    assert.equal(await f.page.getByRole('button', { name: 'Lock dashboard' }).count(), 0);
  });

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
    const automaticStatusRequests = [];
    f.page.on('request', request => {
      if (request.url().endsWith('/api/local/capabilities')) automaticStatusRequests.push(request.url());
    });
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
    assert.equal(automaticStatusRequests.length, 0, 'cancellation and completion do not start background readiness checks');
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
