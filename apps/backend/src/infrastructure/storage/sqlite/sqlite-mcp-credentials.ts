import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import {
  LocalMcpCredentials,
  type LocalMcpCredential,
  type LocalMcpClientSummary,
  type LocalMcpPolicy,
  validateLocalMcpPolicy,
  validLocalMcpTarget,
} from '../../../mcp/local/local-mcp-credentials';
import {
  SqliteDatabase,
  type SqliteConnection,
  type SqliteRow,
} from './sqlite-database';
import {
  SQLITE_EXPECTED_SCHEMA,
  SQLITE_MCP_SCHEMA,
  SQLITE_MCP_EXPECTED_SCHEMA,
  normalizeSchemaSql,
} from './sqlite-schema';
import {
  privateRoot,
  assertRoot,
  regular,
  pin,
  samePin,
  syncDirectory,
} from './sqlite-files';

const fail = (): never => {
  throw new Error('Local MCP administration failed');
};
const conflict = (): never => {
  throw new Error('Local MCP administration conflict');
};
const digest = (secret: string) =>
  createHash('sha256').update(secret).digest('hex');
const validId = (id: unknown): id is string =>
  typeof id === 'string' && /^[A-Za-z0-9_-]{22}$/.test(id);
const defaults: LocalMcpPolicy = {
  capabilities: ['preferences:read'],
  targets: [],
  allowSensitive: false,
};
const MAX_CLIENTS = 1024;

/** SQLite is authority; private token exports are delivery artifacts only. */
export class SqliteMcpCredentials extends LocalMcpCredentials {
  constructor(
    private readonly database: SqliteDatabase,
    private readonly principalId: string,
  ) {
    super();
  }

  private connection(requireV2 = true): SqliteConnection {
    const c = this.database.connect();
    try {
      if (requireV2 && c.get('PRAGMA user_version')?.user_version !== 2) fail();
      if (
        !c.get('SELECT user_id FROM users WHERE user_id=?', [this.principalId])
      )
        fail();
      return c;
    } catch (error) {
      c.close();
      throw error;
    }
  }
  upgrade(): 'upgraded' | 'already-upgraded' {
    const c = this.connection(false);
    try {
      c.exec('BEGIN EXCLUSIVE');
      const version = c.get('PRAGMA user_version')?.user_version;
      const schema = c
        .all('SELECT sql FROM sqlite_schema WHERE sql IS NOT NULL')
        .map((r) => normalizeSchemaSql(r.sql))
        .sort();
      if (
        JSON.stringify(schema) !==
        JSON.stringify(
          version === 1
            ? SQLITE_EXPECTED_SCHEMA
            : version === 2
              ? SQLITE_MCP_EXPECTED_SCHEMA
              : null,
        )
      )
        fail();
      if (version === 1) {
        c.exec(SQLITE_MCP_SCHEMA);
        c.exec('PRAGMA user_version=2');
      }
      c.exec('COMMIT');
      return version === 1 ? 'upgraded' : 'already-upgraded';
    } finally {
      try {
        if (c.inTransaction) c.exec('ROLLBACK');
      } finally {
        c.close();
      }
    }
  }
  private summary(row: SqliteRow): LocalMcpClientSummary {
    if (
      !row ||
      !validId(row.id) ||
      !Number.isSafeInteger(row.generation) ||
      row.generation < 1 ||
      ![0, 1].includes(row.revoked) ||
      typeof row.label !== 'string' ||
      row.label.length > 64 ||
      typeof row.secret_digest !== 'string' ||
      !/^[a-f0-9]{64}$/.test(row.secret_digest)
    )
      fail();
    return {
      id: row.id,
      label: row.label,
      generation: row.generation,
      revoked: row.revoked === 1,
      policy: validateLocalMcpPolicy(JSON.parse(row.policy)),
    };
  }
  private read(id: string): LocalMcpClientSummary {
    if (!validId(id)) fail();
    const c = this.connection();
    try {
      return this.summary(
        c.get('SELECT * FROM local_mcp_clients WHERE id=? AND principal_id=?', [
          id,
          this.principalId,
        ]),
      );
    } finally {
      c.close();
    }
  }
  list(): LocalMcpClientSummary[] {
    const c = this.connection();
    try {
      const rows = c.all(
        'SELECT * FROM local_mcp_clients WHERE principal_id=? ORDER BY created_at,id LIMIT 1025',
        [this.principalId],
      );
      if (rows.length > MAX_CLIENTS) fail();
      return rows.map((row) => this.summary(row));
    } finally {
      c.close();
    }
  }
  authenticate(token: string): LocalMcpCredential | null {
    const match =
      typeof token === 'string' &&
      /^cr_mcp_([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})$/.exec(token);
    if (!match) return null;
    const c = this.database.connect();
    try {
      if (c.get('PRAGMA user_version')?.user_version !== 2) fail();
      const row = c.get(
        'SELECT * FROM local_mcp_clients WHERE id=? AND principal_id=?',
        [match[1], this.principalId],
      );
      if (!row) return null;
      const summary = this.summary(row);
      if (
        summary.revoked ||
        !timingSafeEqual(
          Buffer.from(row.secret_digest, 'hex'),
          Buffer.from(digest(match[2]), 'hex'),
        )
      )
        return null;
      return { ...summary, principalId: this.principalId };
    } finally {
      c.close();
    }
  }
  private exportToken(destination: string, id: string): string {
    if (
      typeof destination !== 'string' ||
      !path.isAbsolute(destination) ||
      path.resolve(destination) !== destination ||
      destination.length > 4096 ||
      /[\u0000-\u001f\u007f]/u.test(destination)
    )
      fail();
    for (const root of [
      this.database.paths.databaseRoot,
      this.database.paths.identityRoot,
    ])
      if (destination === root || destination.startsWith(root + path.sep))
        fail();
    const root = privateRoot(path.dirname(destination));
    const secret = randomBytes(32).toString('base64url');
    const fd = fs.openSync(
      destination,
      fs.constants.O_CREAT |
        fs.constants.O_EXCL |
        fs.constants.O_WRONLY |
        fs.constants.O_NOFOLLOW,
      0o600,
    );
    try {
      const owned = pin(fs.fstatSync(fd));
      fs.writeFileSync(fd, `cr_mcp_${id}.${secret}\n`);
      fs.fsyncSync(fd);
      assertRoot(root);
      if (!samePin(regular(destination), owned)) fail();
    } finally {
      fs.closeSync(fd);
    }
    syncDirectory(root);
    return digest(secret);
  }
  private change<T>(run: (c: SqliteConnection) => T): T {
    const c = this.connection();
    try {
      c.exec('BEGIN IMMEDIATE');
      const result = run(c);
      c.exec('COMMIT');
      return result;
    } finally {
      try {
        if (c.inTransaction) c.exec('ROLLBACK');
      } finally {
        c.close();
      }
    }
  }
  provision(label: string, destination: string): LocalMcpClientSummary {
    if (
      typeof label !== 'string' ||
      !label ||
      label.length > 64 ||
      /[\u0000-\u001f\u007f]/u.test(label)
    )
      fail();
    if (this.list().length >= MAX_CLIENTS) fail();
    const id = randomBytes(16).toString('base64url'),
      secretDigest = this.exportToken(destination, id);
    return this.change((c) => {
      if (c.get('SELECT count(*) n FROM local_mcp_clients').n >= MAX_CLIENTS)
        fail();
      return this.summary(
        c.get(
          'INSERT INTO local_mcp_clients(id,principal_id,label,secret_digest,generation,revoked,policy,created_at,updated_at) VALUES(?,?,?,?,1,0,?,?,?) RETURNING *',
          [
            id,
            this.principalId,
            label,
            secretDigest,
            JSON.stringify(defaults),
            Date.now(),
            Date.now(),
          ],
        ),
      );
    });
  }
  rotate(id: string, destination: string): LocalMcpClientSummary {
    const previous = this.read(id);
    if (previous.revoked || previous.generation >= Number.MAX_SAFE_INTEGER)
      fail();
    const secretDigest = this.exportToken(destination, id);
    return this.change((c) => {
      const row = c.get(
        'UPDATE local_mcp_clients SET secret_digest=?,generation=generation+1,updated_at=? WHERE id=? AND principal_id=? AND generation=? AND revoked=0 RETURNING *',
        [secretDigest, Date.now(), id, this.principalId, previous.generation],
      );
      if (!row) conflict();
      return this.summary(row);
    });
  }
  revoke(id: string): LocalMcpClientSummary {
    const previous = this.read(id);
    if (previous.revoked) return previous;
    if (previous.generation >= Number.MAX_SAFE_INTEGER) fail();
    return this.change((c) => {
      const row = c.get(
        'UPDATE local_mcp_clients SET revoked=1,generation=generation+1,updated_at=? WHERE id=? AND principal_id=? AND generation=? AND revoked=0 RETURNING *',
        [Date.now(), id, this.principalId, previous.generation],
      );
      if (!row) conflict();
      return this.summary(row);
    });
  }
  permissions(id: string, input: unknown): LocalMcpClientSummary {
    const policy = validateLocalMcpPolicy(input),
      previous = this.read(id);
    if (previous.revoked) fail();
    return this.change((c) => {
      const row = c.get(
        'UPDATE local_mcp_clients SET policy=?,updated_at=? WHERE id=? AND principal_id=? AND generation=? AND revoked=0 RETURNING *',
        [
          JSON.stringify(policy),
          Date.now(),
          id,
          this.principalId,
          previous.generation,
        ],
      );
      if (!row) conflict();
      return this.summary(row);
    });
  }
  grant(id: string, target: string, action: string, effect: string): void {
    if (
      !validLocalMcpTarget(target) ||
      !['READ', 'SUGGEST', 'WRITE', 'DEFINE'].includes(action) ||
      !['ALLOW', 'DENY', 'REMOVE'].includes(effect)
    )
      fail();
    const previous = this.read(id);
    if (previous.revoked) fail();
    this.change((c) => {
      if (
        !c.get(
          'SELECT id FROM local_mcp_clients WHERE id=? AND principal_id=? AND generation=? AND revoked=0',
          [id, this.principalId, previous.generation],
        )
      )
        conflict();
      if (effect === 'REMOVE')
        c.run(
          'DELETE FROM permission_grants WHERE user_id=? AND client_key=? AND target=? AND action=?',
          [this.principalId, `local:${id}`, target, action],
        );
      else
        c.run(
          'INSERT INTO permission_grants(id,user_id,client_key,target,action,effect,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(user_id,client_key,target,action) DO UPDATE SET effect=excluded.effect,updated_at=excluded.updated_at',
          [
            randomUUID(),
            this.principalId,
            `local:${id}`,
            target,
            action,
            effect,
            Date.now(),
            Date.now(),
          ],
        );
    });
  }
}
