import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ConfigService } from '@nestjs/config';
import { SqliteDatabase } from '@/infrastructure/storage/sqlite/sqlite-database';
import { SqliteStorageUnitOfWork } from '@/infrastructure/storage/sqlite/sqlite-unit-of-work';
import { SqliteLocationRepository } from '@/infrastructure/storage/sqlite/sqlite-location.repository';
import { SqlitePreferenceRepository } from '@/infrastructure/storage/sqlite/sqlite-preference.repository';
import { SqlitePreferenceDefinitionRepository } from '@/infrastructure/storage/sqlite/sqlite-preference-definition.repository';
import { ReviewedSuggestionService } from '@/modules/preferences/document-analysis/reviewed-suggestion.service';
import { preferenceRevision } from '@/modules/preferences/preference/preference-revision';
import { fixtureRows } from './fixture-rows';

describe('reviewed document apply v2 on real SQLite', () => {
  let root: string,
    database: SqliteDatabase,
    uow: SqliteStorageUnitOfWork,
    service: ReviewedSuggestionService,
    preferences: SqlitePreferenceRepository,
    definitions: SqlitePreferenceDefinitionRepository;
  const userId = 'review-owner';
  beforeEach(async () => {
    root = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), 'cr-reviewed-')),
    );
    database = SqliteDatabase.bootstrap({
      databaseRoot: path.join(root, 'data'),
      identityRoot: path.join(root, 'identity'),
    });
    await fixtureRows(database).user.create({
      data: { userId, email: 'review@example.invalid' },
    });
    uow = new SqliteStorageUnitOfWork(database);
    preferences = new SqlitePreferenceRepository(database);
    definitions = new SqlitePreferenceDefinitionRepository(database);
    await definitions.create({
      slug: 'synthetic.value',
      description: 'Review',
      valueType: 'STRING',
      scope: 'GLOBAL',
      ownerUserId: userId,
      isSensitive: true,
    });
    service = new ReviewedSuggestionService(
      uow,
      new ConfigService({ documentUpload: { maxSuggestions: 25 } }),
    );
  });
  afterEach(() => {
    jest.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
  });
  async function proposal(value: unknown = 'new value') {
    const [suggestion] = await service.prepare(userId, [
      {
        id: 'analysis:item',
        slug: 'synthetic.value',
        newValue: value,
        confidence: 0.9,
        sourceSnippet: 'synthetic',
        wasCorrected: false,
        operation: 'CREATE',
      } as any,
    ]);
    return {
      suggestionId: suggestion.id,
      slug: suggestion.slug,
      operation: suggestion.operation,
      newValue: value,
      confidence: suggestion.confidence,
      evidence: { snippet: suggestion.sourceSnippet },
      ...suggestion.review,
    };
  }
  const apply = async (input: any) =>
    (await service.apply(userId, 'analysis', [input])).results[0];
  const events = () => {
    const c = database.connect();
    try {
      return c.all('SELECT * FROM preference_audit_events');
    } finally {
      c.close();
    }
  };
  it('creates only if absent, commits inferred provenance and event sensitivity, and reports every item', async () => {
    const input = await proposal();
    expect(input.operation).toBe('CREATE');
    const result = await apply(input);
    expect(result.status).toBe('APPLIED');
    const stored = await preferences.findById(result.preference.id);
    expect(stored).toMatchObject({
      value: 'new value',
      sourceType: 'INFERRED',
      confidence: 0.9,
      lastActorType: 'USER',
      lastOrigin: 'DOCUMENT_ANALYSIS',
      evidence: { snippet: 'synthetic' },
    });
    expect(
      JSON.parse(events()[0].metadata).eventSensitivity.classification,
    ).toBe('SENSITIVE');
    expect((await apply(input)).status).toBe('CONFLICT');
    expect(events()).toHaveLength(1);
    const valid = await proposal('next');
    const invalid = {
      ...(await proposal()),
      suggestionId: 'invalid',
      newValue: 42,
    };
    const results = await service.apply(userId, 'analysis', [valid, invalid]);
    expect(results.schemaVersion).toBe(2);
    expect(results.results.map((r) => [r.suggestionId, r.status])).toEqual([
      ['analysis:item', 'APPLIED'],
      ['invalid', 'VALIDATION_FAILED'],
    ]);
  });
  it('compares canonical row state, not only millisecond timestamps', async () => {
    await apply(await proposal());
    const input = await proposal('reviewed replacement');
    const c = database.connect();
    try {
      c.run('UPDATE user_preferences SET evidence=? WHERE id=?', [
        JSON.stringify({ changed: true }),
        input.expectedPreferenceId,
      ]);
    } finally {
      c.close();
    }
    expect((await apply(input)).status).toBe('CONFLICT');
    expect(events()).toHaveLength(1);
  });
  it('rejects delete/recreate and rebinds neither row nor definition', async () => {
    await apply(await proposal());
    const input = await proposal();
    await preferences.delete(input.expectedPreferenceId);
    await preferences.upsertActive(
      userId,
      input.definitionId,
      'new value',
      null,
      {
        sourceType: 'INFERRED',
        confidence: 0.9,
        evidence: { snippet: 'synthetic' },
      },
    );
    expect((await apply(input)).status).toBe('CONFLICT');
    const create = await proposal();
    await definitions.archive(create.definitionId);
    await definitions.create({
      slug: 'synthetic.value',
      description: 'Replacement',
      valueType: 'STRING',
      scope: 'GLOBAL',
    });
    expect((await apply(create)).status).toBe('CONFLICT');
  });
  it('validates the current definition in the transaction and rejects foreign location/owner inputs', async () => {
    const input = await proposal();
    await definitions.update(input.definitionId, { valueType: 'BOOLEAN' });
    expect((await apply(input)).status).toBe('VALIDATION_FAILED');
    expect(events()).toHaveLength(0);
    expect(
      (await service.apply('another-owner', 'analysis', [input])).results[0]
        .status,
    ).toBe('CONFLICT');
    await definitions.update(input.definitionId, {
      valueType: 'STRING',
      scope: 'LOCATION',
    });
    expect(
      (await apply({ ...input, locationId: 'missing-or-foreign' })).status,
    ).toBe('VALIDATION_FAILED');
  });
  it('creates and updates an owned location while preserving another location and a shadowed global row', async () => {
    const own = await definitions.getDefinitionBySlug(
      'synthetic.value',
      userId,
    );
    await definitions.update(own.id, { scope: 'LOCATION' });
    const global = await definitions.create({
      slug: own.slug,
      description: 'Shadowed global',
      valueType: 'STRING',
      scope: 'GLOBAL',
    });
    await preferences.upsertActive(
      userId,
      global.id,
      'untouched global',
      null,
      { sourceType: 'USER' },
    );
    const locations = new SqliteLocationRepository(database);
    const first = await locations.create(userId, {
      type: 'HOME',
      label: 'Synthetic first',
      address: 'Synthetic address',
    });
    const second = await locations.create(userId, {
      type: 'HOME',
      label: 'Synthetic second',
      address: 'Synthetic address',
    });
    await preferences.upsertActive(
      userId,
      own.id,
      'untouched second',
      second.locationId,
      { sourceType: 'USER' },
    );
    const input = {
      ...(await proposal('first value')),
      locationId: first.locationId,
    };
    const created = await apply(input);
    expect(created.status).toBe('APPLIED');
    const current = await preferences.findById(created.preference.id);
    expect(current.locationId).toBe(first.locationId);
    const updated = await apply({
      ...input,
      operation: 'UPDATE',
      expectedPreferenceId: current.id,
      expectedRevision: preferenceRevision(current),
      newValue: 'updated first',
    });
    expect(updated.status).toBe('APPLIED');
    expect(updated.preference.id).toBe(current.id);
    expect(
      (
        await preferences.findActiveExact({
          userId,
          definitionId: own.id,
          locationId: second.locationId,
        })
      ).value,
    ).toBe('untouched second');
    expect(
      (
        await preferences.findActiveExact({
          userId,
          definitionId: global.id,
          locationId: null,
        })
      ).value,
    ).toBe('untouched global');
    expect(
      (await apply({ ...input, definitionId: global.id, locationId: null }))
        .status,
    ).toBe('CONFLICT');
    expect(events()).toHaveLength(2);
    for (const event of events())
      expect(JSON.parse(event.after_state).locationId).toBe(first.locationId);
  });
  it('rolls back write and audit together after sink failure, once, without claiming success', async () => {
    const input = await proposal();
    const connect = database.connect.bind(database);
    let writes = 0;
    jest.spyOn(database, 'connect').mockImplementation(() => {
      const c = connect();
      c.exec(
        "CREATE TEMP TRIGGER reject_review BEFORE INSERT ON preference_audit_events BEGIN SELECT RAISE(ABORT,'synthetic audit fault'); END",
      );
      const get = c.get.bind(c);
      c.get = (sql, args) => {
        if (sql.startsWith('INSERT INTO user_preferences')) writes++;
        return get(sql, args);
      };
      return c;
    });
    expect((await apply(input)).status).toBe('UNCERTAIN');
    expect(writes).toBe(1);
    jest.restoreAllMocks();
    expect(await preferences.count(userId)).toBe(0);
    expect(events()).toHaveLength(0);
  });
  it('does not report success or retry when commit acknowledgement is lost', async () => {
    const input = await proposal();
    const serializable = uow.serializable.bind(uow);
    let attempts = 0;
    jest.spyOn(uow, 'serializable').mockImplementation(async (operation) => {
      attempts++;
      await serializable(operation);
      throw new Error('synthetic lost acknowledgement');
    });
    expect((await apply(input)).status).toBe('UNCERTAIN');
    expect(attempts).toBe(1);
    expect(await preferences.count(userId)).toBe(1);
    expect(events()).toHaveLength(1);
  });
  it('canonical revisions ignore object insertion order but include row identity, provenance and array ordering', async () => {
    await apply(await proposal());
    const row = (await preferences.findByStatus(userId, 'ACTIVE'))[0];
    expect(preferenceRevision({ ...row, evidence: { b: 2, a: 1 } })).toBe(
      preferenceRevision({ ...row, evidence: { a: 1, b: 2 } }),
    );
    for (const variant of [
      { ...row, id: 'different' },
      { ...row, evidence: ['a', 'b'] },
      { ...row, sourceType: 'USER' as const },
    ])
      expect(preferenceRevision(variant)).not.toBe(preferenceRevision(row));
    expect(preferenceRevision({ ...row, evidence: ['b', 'a'] })).not.toBe(
      preferenceRevision({ ...row, evidence: ['a', 'b'] }),
    );
  });
});
