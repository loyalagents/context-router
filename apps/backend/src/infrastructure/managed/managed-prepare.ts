import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { managedCapability } from './managed-admission';
import { createSqliteIdentityRuntime, seedLocalCatalog } from '../storage/sqlite/sqlite-local-runtime';
import { SqliteMcpCredentials } from '../storage/sqlite/sqlite-mcp-credentials';
import { waitForNativeOwners } from '../storage/sqlite/sqlite-database';

/** Finite preparation only. Ready startup verifies; failed valid setup resumes explicitly. */
export async function prepareManagedStore(): Promise<{ targetId: string }> {
  const cap = managedCapability();
  if (cap.role !== 'prepare' || !['initialize', 'initialize-recovered', 'resume-setup', 'verify'].includes(cap.operation)) throw new Error('Managed prepare unavailable');
  const store = join(cap.envelope, 'stores', cap.storeId);
  const { database, service } = createSqliteIdentityRuntime({ kind: 'sqlite',
    databaseRoot: join(store, 'data'), stateRoot: join(store, 'identity') }, cap.operation === 'initialize');
  try {
    if (cap.operation === 'initialize-recovered') {
      // Native admission binds the successful named recovery and private pair.
      // Prove the existing DB is empty before creating any new identity material.
      const connection = database.connect();
      try {
        let entries: string[];
        try { entries = readdirSync(join(store, 'identity')); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; entries = []; }
        if (entries.length || connection.get('SELECT count(*) AS n FROM users')?.n !== 0)
          throw new Error('Managed recovered setup is not empty');
      } finally { connection.close(); }
    }
    if (['initialize', 'initialize-recovered'].includes(cap.operation)) await service.initialize();
    const ready = await service.verifyReadyState();
    const credentials = new SqliteMcpCredentials(database, ready.state.principalId);
    if (cap.operation !== 'verify') {
      await seedLocalCatalog(database);
      credentials.upgrade();
    }
    await service.verifyReadyState();
    credentials.list();
    return { targetId: database.targetId };
  } finally { await waitForNativeOwners(); }
}
