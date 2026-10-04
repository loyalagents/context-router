import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { SqliteDatabase } from '@/infrastructure/storage/sqlite/sqlite-database';
import { SqliteStorageUnitOfWork } from '@/infrastructure/storage/sqlite/sqlite-unit-of-work';
import { SqliteMcpCredentials } from '@/infrastructure/storage/sqlite/sqlite-mcp-credentials';
import { SqlitePreferenceDefinitionRepository } from '@/infrastructure/storage/sqlite/sqlite-preference-definition.repository';
import { SqlitePreferenceRepository } from '@/infrastructure/storage/sqlite/sqlite-preference.repository';
import { SqliteLocationRepository } from '@/infrastructure/storage/sqlite/sqlite-location.repository';
import { SqliteAuditHistoryStorage } from '@/infrastructure/storage/sqlite/sqlite-audit-history-storage';
import { PreferenceService } from '@/modules/preferences/preference/preference.service';
import { PreferenceDefinitionService } from '@/modules/preferences/preference-definition/preference-definition.service';
import { LocationService } from '@/modules/preferences/location/location.service';
import { PreferenceAuditQueryService } from '@/modules/preferences/audit/preference-audit-query.service';
import { HistoryClearService } from '@/modules/preferences/audit/history-clear.service';
import { fixtureRows } from './fixture-rows';

describe('local UI history semantics on existing SQLite v2', () => {
  let root: string,
    database: SqliteDatabase,
    rows: ReturnType<typeof fixtureRows>,
    uow: SqliteStorageUnitOfWork;
  const userId = 'history-owner';
  const context = {
    actorType: 'USER',
    origin: 'GRAPHQL',
    correlationId: 'history-test',
    sourceType: 'USER',
  } as const;
  const snapshot = () => {
    const c = database.connect();
    try {
      return Object.fromEntries(
        c
          .all(
            "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
          )
          .map(({ name }) => [
            name,
            c.all(`SELECT * FROM ${name} ORDER BY rowid`),
          ]),
      );
    } finally {
      c.close();
    }
  };
  const definitions = () => new SqlitePreferenceDefinitionRepository(database);
  const service = () =>
    new PreferenceService(
      new SqlitePreferenceRepository(database),
      new LocationService(new SqliteLocationRepository(database)),
      definitions(),
      uow,
    );
  const history = () =>
    new PreferenceAuditQueryService(
      new SqliteAuditHistoryStorage(database),
    ).getHistory(userId, { first: 100 });
  beforeEach(async () => {
    root = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), 'cr-ui-history-')),
    );
    fs.chmodSync(root, 0o700);
    database = SqliteDatabase.bootstrap({
      databaseRoot: path.join(root, 'data'),
      identityRoot: path.join(root, 'identity'),
    });
    rows = fixtureRows(database);
    uow = new SqliteStorageUnitOfWork(database);
    await rows.user.create({
      data: { userId, email: 'history@example.invalid' },
    });
    const credentials = new SqliteMcpCredentials(database, userId);
    credentials.upgrade();
    const client = credentials.provision(
      'synthetic-history',
      path.join(root, 'mcp.token'),
    );
    credentials.grant(client.id, '*', 'READ', 'DENY');
  });
  afterEach(() => {
    jest.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
  });
  async function prepare() {
    await definitions().create({
      slug: 'test.private',
      valueType: 'STRING',
      scope: 'GLOBAL',
      description: 'Synthetic',
      ownerUserId: userId,
      isSensitive: true,
    });
    await service().setPreference(
      userId,
      { slug: 'test.private', value: 'private-history-canary' },
      context,
    );
    await rows.mcpAccessEvent.create({
      data: {
        userId,
        clientKey: 'synthetic',
        surface: 'TOOLS_CALL',
        operationName: 'test',
        outcome: 'SUCCESS',
        correlationId: 'history-test',
        latencyMs: 1,
      },
    });
  }
  it('captures sensitivity at mutation time, including archived IDs, and never guesses legacy sensitivity from today’s slug', async () => {
    await prepare();
    const definition = await definitions().getDefinitionBySlug(
      'test.private',
      userId,
    );
    const preference = await rows.preference.findFirst();
    await definitions().update(definition.id, { isSensitive: false });
    expect((await history()).items[0].sensitivity).toBe('SENSITIVE');
    await definitions().update(definition.id, { isSensitive: true });
    await definitions().archive(definition.id);
    await service().deletePreference(preference.id, userId, context);
    expect(
      (await history()).items.every(
        (event) => event.sensitivity === 'SENSITIVE',
      ),
    ).toBe(true);
    await rows.preferenceAuditEvent.create({
      data: {
        userId,
        subjectSlug: 'test.private',
        targetType: 'PREFERENCE',
        targetId: 'old',
        eventType: 'PREFERENCE_SET',
        ...context,
        sourceType: undefined,
        beforeState: { value: 'legacy-canary' },
      },
    });
    const legacy = (await history()).items.find(
      (event) => event.targetId === 'old',
    );
    expect(legacy.sensitivity).toBe('UNKNOWN');
    expect(legacy.beforeState).toEqual({ value: 'legacy-canary' });
  });
  it('clears both streams atomically, requires separate confirmation and preserves every other table byte-for-byte', async () => {
    await prepare();
    const before = snapshot();
    const clear = new HistoryClearService(uow);
    await expect(clear.clear(userId, 'CLEAR MEMORY')).rejects.toThrow();
    expect(snapshot()).toEqual(before);
    expect(await clear.clear(userId, 'CLEAR HISTORY')).toEqual({
      status: 'CLEARED',
      preferenceAuditEventsDeleted: 1,
      mcpAccessEventsDeleted: 1,
    });
    const after = snapshot();
    for (const table of Object.keys(before))
      expect(after[table]).toEqual(
        ['preference_audit_events', 'mcp_access_events'].includes(table)
          ? []
          : before[table],
      );
  });
  it('clears only the authenticated principal histories and preserves another principal streams', async () => {
    await prepare();
    const other = 'other-history-owner';
    await rows.user.create({
      data: { userId: other, email: 'other@example.invalid' },
    });
    await rows.preferenceAuditEvent.create({
      data: {
        userId: other,
        subjectSlug: 'test.other',
        targetType: 'PREFERENCE',
        targetId: 'other',
        eventType: 'PREFERENCE_SET',
        actorType: 'USER',
        origin: 'GRAPHQL',
        correlationId: 'other',
      },
    });
    await rows.mcpAccessEvent.create({
      data: {
        userId: other,
        clientKey: 'other',
        surface: 'TOOLS_CALL',
        operationName: 'test',
        outcome: 'SUCCESS',
        correlationId: 'other',
        latencyMs: 1,
      },
    });
    const before = snapshot();
    expect(
      await new HistoryClearService(uow).clear(userId, 'CLEAR HISTORY'),
    ).toMatchObject({
      status: 'CLEARED',
      preferenceAuditEventsDeleted: 1,
      mcpAccessEventsDeleted: 1,
    });
    const after = snapshot();
    for (const table of Object.keys(before))
      expect(after[table]).toEqual(
        ['preference_audit_events', 'mcp_access_events'].includes(table)
          ? before[table].filter((row) => row.user_id === other)
          : before[table],
      );
  });
  it('definition updates classify the actual transaction before-state after an intervening sensitivity edit', async () => {
    await prepare();
    const repo = definitions();
    const definition = await repo.getDefinitionBySlug('test.private', userId);
    await repo.update(definition.id, { isSensitive: false });
    const read = repo.getDefinitionById.bind(repo);
    jest.spyOn(repo, 'getDefinitionById').mockImplementation(async (id) => {
      const before = await read(id);
      await definitions().update(id, { isSensitive: true });
      return before;
    });
    await new PreferenceDefinitionService(repo, uow).update(
      definition.id,
      { isSensitive: false },
      userId,
      context,
    );
    const event = (await history()).items.find(
      (event) => event.eventType === 'DEFINITION_UPDATED',
    );
    expect(event.sensitivity).toBe('SENSITIVE');
    expect(event.beforeState).toMatchObject({ isSensitive: true });
    expect(event.afterState).toMatchObject({ isSensitive: false });
  });
  it('rolls back the first delete when the second delete fails, without writing a receipt or retrying', async () => {
    await prepare();
    const before = snapshot();
    let reached = 0;
    const connect = database.connect.bind(database);
    jest.spyOn(database, 'connect').mockImplementation(() => {
      const c = connect();
      c.exec(
        "CREATE TEMP TRIGGER fail_access_clear BEFORE DELETE ON mcp_access_events BEGIN SELECT RAISE(ABORT,'synthetic failure'); END",
      );
      const run = c.run.bind(c);
      c.run = (sql, values) => {
        if (sql.startsWith('DELETE FROM mcp_access_events')) {
          reached++;
          expect(
            c.get('SELECT count(*) n FROM preference_audit_events').n,
          ).toBe(0);
        }
        return run(sql, values);
      };
      return c;
    });
    expect(
      (await new HistoryClearService(uow).clear(userId, 'CLEAR HISTORY'))
        .status,
    ).toBe('UNCERTAIN');
    expect(reached).toBe(1);
    jest.restoreAllMocks();
    expect(snapshot()).toEqual(before);
  });
});
