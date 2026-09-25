import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { readFile, access } from 'node:fs/promises';
import { fixture } from './fixtures/session-fixture.mjs';
const require = createRequire(import.meta.url);
require('reflect-metadata');
require('@nestjs/common').Logger.overrideLogger(false);
const { PDFDocument } = require('pdf-lib');
const { graphql } = require('graphql');
const { GraphQLSchemaHost } = require('@nestjs/graphql');
const load = (path) => require(`../../dist/${path}.js`);
const { createSqliteIdentityRuntime } = load('infrastructure/storage/sqlite/sqlite-local-runtime');
const { createNestLocalIdentityApplication, configureLocalIdentityPreview } = load('bootstrap/local-identity-preview');
const { createLocalModelSelection } = load('config/local-model.config');
const { AI_TEXT_GENERATOR_PORT, AI_STRUCTURED_OUTPUT_PORT } = load('domains/shared/ports/ai.tokens');
const { PreferenceExtractionService } = load('modules/preferences/document-analysis/preference-extraction.service');
const { PreferenceSearchWorkflow } = load('modules/workflows/preferences/preference-search/preference-search.workflow');
const { SchemaConsolidationWorkflow } = load('modules/workflows/preferences/schema-consolidation/schema-consolidation.workflow');
const { FormFillService } = load('modules/preferences/form-fill/form-fill.service');
const { PreferenceDefinitionRepository } = load('modules/preferences/preference-definition/preference-definition.repository');
const { PermissionGrantRepository } = load('modules/permission-grant/permission-grant.repository');

async function application(f, model) {
  const parent = dirname(f.config.databaseRoot);
  const local = { kind: 'sqlite', databaseRoot: join(parent, 'app-data'), stateRoot: join(parent, 'app-identity') };
  await createSqliteIdentityRuntime(local, true).service.initialize();
  const state = JSON.parse(await readFile(join(local.stateRoot, 'identity.json'), 'utf8'));
  const app = await createNestLocalIdentityApplication(local, model);
  app.listen = () => { throw new Error('Must never listen'); };
  configureLocalIdentityPreview(app); await app.init();
  const schema = app.get(GraphQLSchemaHost).schema;
  const query = (source, variableValues) => graphql({ schema, source, variableValues, contextValue: { req: {
    headers: { authorization: `Bearer ${state.credential}` }, rawHeaders: ['Authorization', `Bearer ${state.credential}`],
  } } });
  return { app, local, state, query };
}

for (const mode of ['ordinary', 'missing', 'malformed', 'offline']) test(`actual SQLite Nest ${mode} model configuration preserves authenticated non-AI operation`, async (t) => {
  const f = await fixture(t);
  const selection = mode === 'offline' ? { root: f.config.root, port: 1 }
    : mode === 'malformed' ? createLocalModelSelection({ LOCAL_MODEL_SESSION_ROOT: '/private/bad', LOCAL_MODEL_PORT: 'bad' }) : undefined;
  const previous = { root: process.env.LOCAL_MODEL_SESSION_ROOT, port: process.env.LOCAL_MODEL_PORT };
  process.env.LOCAL_MODEL_SESSION_ROOT = f.config.root; process.env.LOCAL_MODEL_PORT = String(f.config.port);
  let app;
  try {
    const opened = await application(f, selection); app = opened.app;
    const me = await opened.query('{me{userId}}');
    assert.equal(me.errors, undefined); assert.equal(me.data.me.userId, opened.state.principalId);
    const text = app.get(AI_TEXT_GENERATOR_PORT);
    assert.equal(text, app.get(AI_STRUCTURED_OUTPUT_PORT));
    const bytes = await readFile(join(opened.local.stateRoot, 'identity.json'));
    const response = await opened.query('{askVertexAI(message:"synthetic")}');
    assert.match(response.errors[0].message, /Failed to generate response/);
    assert.deepEqual(await readFile(join(opened.local.stateRoot, 'identity.json')), bytes);
    assert.equal(f.state.calls.length, 0);
    if (mode === 'offline') await access(join(f.config.root, 'backend-session.claim'));
    else await assert.rejects(access(join(f.config.root, 'backend-session.claim')));
  } finally {
    await app?.close();
    for (const [key, value] of [['LOCAL_MODEL_SESSION_ROOT', previous.root], ['LOCAL_MODEL_PORT', previous.port]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test('actual SQLite Nest shares one model session across extraction, grants, advisory consolidation and editable form fill', async (t) => {
  const f = await fixture(t); const { app, state, query } = await application(f, { root: f.config.root, port: f.config.port });
  try {
    const userId = state.principalId;
    const text = app.get(AI_TEXT_GENERATOR_PORT);
    assert.equal(text, app.get(AI_STRUCTURED_OUTPUT_PORT));
    assert.equal(text.initialization, undefined);
    const set = await query('mutation($input:SetPreferenceInput!){setPreference(input:$input){id value}}', { input: { slug: 'profile.first_name', value: 'Ada' } });
    assert.equal(set.errors, undefined);
    const suggestion = { slug: 'profile.last_name', operation: 'CREATE', newValue: 'Lovelace', confidence: 0.99, sourceSnippet: 'Lovelace' };
    let index = 0;
    const replies = [ { suggestions: [suggestion, { ...suggestion }], documentSummary: 'Synthetic' }, { suggestion } ];
    f.state.hook = async (req) => { if (req.url === '/completion') f.state.reply = JSON.stringify(replies[index++]); return false; };
    const extracted = await app.get(PreferenceExtractionService).extractPreferences(userId, Buffer.from('Lovelace'), 'text/plain', 'synthetic.txt');
    assert.equal(index, 2); assert.equal(extracted.suggestions.length, 1); assert.equal(extracted.suggestions[0].newValue, 'Lovelace');
    assert.equal(extracted.filteredSuggestions.length, 2);
    f.state.hook = null;
    const clientKey = 'synthetic-model-client';
    await app.get(PermissionGrantRepository).upsert(userId, clientKey, 'profile.last_name', 'READ', 'DENY');
    f.state.reply = JSON.stringify({ relevantSlugs: ['profile.first_name', 'profile.last_name', 'unknown.fake'], queryInterpretation: 'Synthetic' });
    const found = await app.get(PreferenceSearchWorkflow).run({ userId, clientKey, naturalLanguageQuery: 'Synthetic' });
    assert.deepEqual(found.matchedDefinitions.map((d) => d.slug), ['profile.first_name']);
    assert.equal(found.matchedActivePreferences[0].value, 'Ada');
    const definitions = app.get(PreferenceDefinitionRepository);
    for (const slug of ['custom.preference_a', 'custom.preference_b']) await definitions.create({ slug, description: 'Synthetic alias', valueType: 'STRING', scope: 'GLOBAL', ownerUserId: userId });
    f.state.reply = JSON.stringify({ consolidationGroups: [
      { slugs: ['custom.preference_a', 'custom.preference_b'], reason: 'Aliases', suggestion: 'MERGE', recommendedSlug: 'custom.preference_a' },
      { slugs: ['profile.first_name', 'custom.preference_a'], reason: 'Unsafe', suggestion: 'MERGE' },
    ], summary: 'Synthetic' });
    const before = JSON.stringify(await definitions.getAll(userId));
    const consolidated = await app.get(SchemaConsolidationWorkflow).run({ userId, clientKey, scope: 'ALL' });
    assert.equal(consolidated.consolidationGroups.length, 1);
    assert.deepEqual(consolidated.consolidationGroups[0].slugs, ['custom.preference_a', 'custom.preference_b']);
    assert.equal(JSON.stringify(await definitions.getAll(userId)), before);
    const pdf = await PDFDocument.create(); const page = pdf.addPage();
    pdf.getForm().createTextField('first_name').addToPage(page);
    f.state.reply = JSON.stringify({ fillActions: [{ fieldName: 'first_name', action: 'SET_TEXT', value: 'Ada', confidence: 0.99, sourceSlugs: ['profile.first_name'] }] });
    const filled = await app.get(FormFillService).fillPdfForm(userId, Buffer.from(await pdf.save()), 'synthetic.pdf');
    assert.equal(filled.status, 'success');
    const result = await PDFDocument.load(Buffer.from(filled.filledPdfBase64, 'base64'));
    assert.equal(result.getForm().getTextField('first_name').getText(), 'Ada');
    const controller = new AbortController(); controller.abort(); const calls = f.state.calls.length;
    await assert.rejects(app.get(PreferenceSearchWorkflow).run({ userId, clientKey, naturalLanguageQuery: 'Synthetic' }, { signal: controller.signal }), { kind: 'cancelled' });
    assert.equal(f.state.calls.length, calls);
    assert.equal((await query('{me{userId}}')).errors, undefined);
  } finally { await app.close(); }
});

test('actual Nest close cancels a pending model preparation, awaits owned work and leaves SQLite usable', async (t) => {
  const f = await fixture(t); const { app, query } = await application(f, { root: f.config.root, port: f.config.port });
  let entered; const waiting = new Promise((resolve) => { entered = resolve; });
  f.state.hook = async (req) => { if (req.url !== '/apply-template') return false; entered(); return true; };
  const model = app.get(AI_TEXT_GENERATOR_PORT);
  const operation = model.generateText('synthetic');
  const rejected = assert.rejects(operation, { kind: 'cancelled' });
  await waiting;
  assert.equal((await query('{me{userId}}')).errors, undefined);
  await app.close(); await rejected;
  await assert.rejects(model.generateText('later'), { kind: 'unavailable' });
  assert.equal(f.state.completionBodies.length, 0);
});
